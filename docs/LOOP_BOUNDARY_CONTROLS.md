# Loop 模式边界设置优化建议

## 1. 背景判断

Loop 模式已经很接近当前主流的 Agentic Coding Loop：用户给目标，AI 自己反复执行“计划 -> 编码 -> 执行 -> 验证 -> 修复”，用户更像是 human on the loop，负责设定目标、观察结果、在必要时介入。

当前工程已经具备不少循环能力：

- `coding / lobster` 顶层模式区分。
- Loop 内部支持 `main_sub_multi_agent` 和 `debate_multi_agent`。
- 主任务可以拆分子任务，子任务可并行执行，按 `writeFiles` / `conflictGroup` 做冲突规划。
- 子任务失败可自动重试，主任务连续失败会进入 `needs-review`。
- 群聊面板支持查看过程、继续执行、中止、补充需求。
- 红蓝辩论模式会让红队攻击假设、目标覆盖、证据链、边界场景、可行性和可验证性。

但“设边界”目前还不是一等公民。很多边界是散落在提示词、用户自然语言、CLI 自身 sandbox 参数、任务记录和人工习惯里的。对于长周期、多轮、多子任务的 agentic loop 来说，这会导致几个问题：

- 用户很难在任务开始前明确表达“能做什么、不能做什么、什么时候必须问我”。
- 主任务拆分子任务时，边界依赖提示词遵守，缺少结构化校验。
- 子任务执行完成后，系统缺少稳定的“是否越界”的机器检查。
- 继续执行或补充需求时，边界变更没有版本化，容易把新要求和原始约束混在一起。
- 高风险动作，例如依赖升级、删除文件、改配置、跑迁移、改发布流程，缺少统一的人工确认门。

因此，建议把“目标 + 边界 + 验收”设计成 Loop 任务创建时的结构化契约，并让 UI、任务记录、提示词、运行时校验、群聊展示和恢复逻辑都围绕这个契约工作。

## 2. 优化目标

边界设置优化不应该把 Loop 模式变成繁琐审批系统。目标是让用户用较低成本给 AI 一个清晰的行动框：

- AI 可以在授权范围内自主循环，不需要每一步都问用户。
- AI 一旦要越过边界，必须暂停并进入人工确认。
- 每个子任务都继承同一份任务边界，不靠主任务临时转述。
- 每轮结果都能用边界契约判断“目标是否满足、范围是否越界、证据是否足够”。
- 后续恢复、补充需求、复盘时，可以看清边界何时被创建、何时被修改、为什么修改。

一句话：把 human on the loop 的“设边界”从聊天里的软约束，升级成可展示、可传递、可校验、可审计的运行时契约。

## 3. 建议新增：边界契约

建议在 Loop 任务记录中新增一个结构化字段，概念上叫 `boundaryContract`。它不是替代原始 prompt，而是把原始 prompt 中最关键的行动边界提取成机器可读数据。

示例结构：

```ts
interface LobsterBoundaryContract {
  version: 1;
  objective: {
    goal: string;
    successCriteria: string[];
    nonGoals: string[];
    assumptions: string[];
  };
  scope: {
    readAllowlist: string[];
    writeAllowlist: string[];
    writeDenylist: string[];
    protectedPaths: string[];
  };
  permissions: {
    network: "deny" | "ask" | "allow";
    installDependencies: "deny" | "ask" | "allow";
    modifyDependencies: "deny" | "ask" | "allow";
    modifyGitHistory: "deny" | "ask";
    destructiveFileOps: "deny" | "ask";
    externalSideEffects: "deny" | "ask" | "allow";
  };
  budgets: {
    maxMainRounds: number;
    maxSubtasksPerRound: number;
    maxRetriesPerSubtask: number;
    maxChangedFiles?: number;
    maxRuntimeMinutes?: number;
  };
  validation: {
    requiredCommands: string[];
    optionalCommands: string[];
    requiredEvidence: string[];
    manualChecks: string[];
  };
  gates: {
    askBefore: string[];
    stopOnViolation: boolean;
  };
}
```

第一版不一定要一次实现全部字段，但建议从 `objective`、`scope.writeAllowlist`、`scope.writeDenylist`、`permissions`、`budgets`、`validation.requiredCommands` 这几类开始，因为它们最直接影响 agentic loop 是否可控。

## 4. UI 应该怎么呈现

### 4.1 任务启动前：边界卡片

在 Loop 模式输入区增加一个轻量的“边界卡片”，默认折叠，支持快速预设和高级编辑。

建议提供 4 个预设：

| 预设 | 适用场景 | 默认行为 |
| --- | --- | --- |
| 只读调研 | 让 AI 分析、规划、评审，不改文件 | `writeAllowlist=[]`，所有写入需确认 |
| 小范围修改 | 修 bug、补测试、改局部文档 | 允许用户选择文件或目录，越界停止 |
| 仓库内实现 | 常规功能开发 | 允许仓库内写入，但保护配置、依赖、发布、密钥类文件 |
| 高风险需确认 | 涉及依赖、脚本、发布、数据库、权限 | 高风险动作统一 `ask` |

卡片里不需要一开始暴露所有字段，首屏建议只放：

- 目标：从用户输入自动带入，可编辑。
- 成功标准：可选填，支持一行一个。
- 允许修改范围：路径选择器 + 当前文件/目录快捷项。
- 禁止修改范围：默认包含 `.git/`、密钥文件、构建产物、用户本地配置等。
- 验证命令：从项目类型推荐，例如 `npm test`、`npm run build`，用户可改。
- 预算：最大轮次、最大子任务数、是否允许自动重试。
- 需要先问我的事：依赖变更、删除文件、网络访问、改 git 历史等。

### 4.2 任务运行中：边界状态可见

Loop 群聊面板应显示当前任务的边界摘要，而不是只显示对话时间线。建议放一个固定的“任务边界”区域：

- 当前目标。
- 允许写入范围。
- 已声明的验证命令。
- 当前预算消耗：第几轮、子任务数、重试数。
- 最近一次边界变更。
- 是否存在待确认 gate。

这样用户观察任务时，不需要回翻原始 prompt 才知道 AI 当前被允许做什么。

### 4.3 继续执行和补充需求：边界变更要版本化

现有“继续执行”和“补充需求”很适合作为边界调整入口，但建议把它们区分成两类：

- 补充目标：新增需求或澄清验收标准。
- 修改边界：扩大/缩小允许写入范围、改变验证命令、调整预算、允许某个高风险动作。

每次修改边界都生成一个 `boundaryRevision`，写入任务记录和沟通文件：

```json
{
  "revision": 3,
  "reason": "用户允许本次任务修改 package.json 以补充测试脚本",
  "changedAt": "2026-06-29T10:00:00.000Z",
  "changes": [
    {
      "path": "scope.writeAllowlist",
      "before": ["src/**", "docs/**"],
      "after": ["src/**", "docs/**", "package.json"]
    }
  ]
}
```

这样主任务恢复时可以读取最新边界，同时仍能复盘边界为什么被放宽。

## 5. 运行时应该怎么约束

边界只写在提示词里是不够的。建议至少做三层约束：输入校验、执行前校验、执行后校验。

### 5.1 输入校验：任务创建时规范化

在扩展侧创建任务时，对 `boundaryContract` 做规范化：

- 路径统一成工作区相对路径。
- 禁止 `..`、绝对路径逃逸、home 目录逃逸等模糊写法。
- 默认保护 `.git/`、`.env*`、私钥、token、产物目录、系统目录。
- 如果用户选择“只读调研”，则 `writeAllowlist` 必须为空。
- 如果允许修改依赖文件，例如 `package.json`、lockfile，需要同时把 `modifyDependencies` 设置为 `ask` 或 `allow`。

建议把这部分做成纯函数，落点可以是新的 `src/lobsterBoundary.ts`，避免继续扩大 `extension.ts`。

### 5.2 派发前校验：子任务不能超出边界

主任务或共识汇总器返回 `subtasks` 时，扩展侧应该校验：

- 每个子任务的 `writeFiles` 必须落在 `boundaryContract.scope.writeAllowlist` 内。
- 不能命中 `writeDenylist` 或 `protectedPaths`。
- 如果子任务声明需要网络、依赖安装、删除文件、修改 git 历史等动作，而权限不是 `allow`，则不能直接派发。
- 如果 `writeFiles` 为空但 prompt 明显要求“修改、删除、生成、重命名”，应进入 `needs-review` 或要求主任务补充范围，而不是默认放行。

这里不要求系统理解所有自然语言，但至少能拦住结构化字段里的明显越界。

### 5.3 执行前校验：把边界注入 CLI 能力

不同 CLI 的真实执行护栏不同，插件不应假装自己能完全替代底层 sandbox。建议做法：

- 对支持 sandbox / approval 参数的 CLI，把边界映射到对应启动参数。
- 对不支持的 CLI，在任务气泡和群聊中明确显示“当前 CLI 不支持某类硬隔离，仅做插件侧检查”。
- 对高风险动作统一转为人工 gate，不把它们交给模型自行决定。

例如：

- Codex 可结合当前已有 `sandbox` / `approval` 参数。
- OpenCode 可复用通用 CLI 边界映射；如底层暂未提供等价参数，应在 UI 标识为“插件侧检查 + 事后校验”。
- Claude 如果某些能力不能由插件侧精确控制，应在 UI 标识为“软约束 + 事后校验”。

### 5.4 执行后校验：基于 diff 的越界检查

每个子任务完成后，扩展侧应做一次工作区变更检查：

- 记录任务开始前的 git 状态基线。
- 子任务结束后读取当前变更。
- 判断新增或变化的路径是否都在 `writeAllowlist` 内。
- 如果命中 `writeDenylist` 或 `protectedPaths`，立即停止当前 Loop 任务并进入 `needs-review`。
- 群聊面板展示“越界路径、子任务、时间、建议处理方式”。

需要注意，本仓库可能在任务开始前就有用户未提交改动。校验不能简单要求工作区干净，而应该保存基线并只关注本任务新增或继续变更的路径。对无法准确归因的路径，应该标为“需要人工确认”，不要自动回滚。

## 6. 红蓝辩论模式怎么利用边界

红蓝辩论本身已经适合做边界审查，但需要把审查对象从“自然语言任务”升级为“边界契约”。

建议改造裁判主持人、蓝队、红队和共识汇总器的职责：

- 裁判主持人：先检查 `boundaryContract` 是否足够执行。如果目标、范围、验收或权限缺失，优先要求澄清，而不是直接组队执行。
- 蓝队：提出方案时必须说明每个步骤落在哪个允许范围内，需要哪些验证证据。
- 红队：攻击的重点包含“方案是否越界、是否偷换目标、是否把需要确认的动作包装成普通子任务”。
- 共识汇总器：输出 `decision.json` 前必须给出 `boundaryAssessment`，说明每个子任务是否在边界内。

建议 `decision.json` 或共识摘要中增加类似字段：

```json
{
  "boundaryAssessment": {
    "withinScope": true,
    "requiresHumanApproval": false,
    "checkedWriteScopes": ["src/**", "docs/**"],
    "risks": [
      "当前任务不修改依赖文件，不需要依赖变更确认"
    ]
  }
}
```

如果红队指出的阻塞项本质上是“边界不足”，任务应进入 `needs-review`，并让 UI 引导用户选择：

- 放宽边界继续。
- 缩小目标继续。
- 转为只读调研。
- 停止任务。

## 7. 高风险动作的人工 Gate

建议把以下动作定义为默认 `ask`，除非用户在边界卡片里明确放行：

- 修改依赖清单或 lockfile。
- 安装、升级、卸载依赖。
- 修改构建、发布、CI、脚本、权限相关配置。
- 删除、重命名大量文件。
- 修改数据库迁移、生产配置、密钥、证书、token。
- 改 git 历史，例如 rebase、reset、checkout 覆盖、force push。
- 访问网络、调用外部服务、下载远端脚本。
- 写入工作区外路径或用户 home 目录。
- 执行不可逆命令或高成本命令。

当触发 gate 时，群聊面板不应只显示“需要人工复核”，而应该给出结构化选择：

- 允许一次。
- 本任务内允许。
- 修改边界后继续。
- 拒绝并让 AI 改方案。
- 停止任务。

这会比单纯 `needs-review` 更可操作。

## 8. 验收边界

Agentic coding loop 的另一个常见问题是“AI 自己觉得完成了”。建议把验收也纳入边界契约。

### 8.1 必填验收口径

任务开始时至少要形成三类验收标准：

- 目标覆盖：原始目标和补充需求是否全部覆盖。
- 范围合规：变更是否都在允许范围内。
- 证据充分：测试、构建、静态检查、人工检查是否满足要求。

### 8.2 子任务沟通文件要求

现有子任务沟通文件已经要求写执行目标、修改文件、验证结果。建议进一步结构化：

```md
## 边界合规

- 允许写入范围：
- 实际写入文件：
- 是否命中禁止范围：
- 是否触发人工 gate：

## 验证证据

- 已运行命令：
- 命令结果：
- 未运行原因：
- 需要主任务复核的点：
```

主任务最终完成时，必须同时满足：

- `boundaryAssessment.withinScope=true`
- 必填验证命令都有结果，或明确写出未运行原因并被用户接受
- 没有未解决的人工 gate
- 没有未解决的红队 `block`

## 9. 任务记录和审计

建议在任务记录中新增两个与边界相关的持久化结构：

```ts
interface LobsterBoundaryEvent {
  id: string;
  type:
    | "created"
    | "revised"
    | "gate_requested"
    | "gate_approved"
    | "gate_rejected"
    | "violation_detected"
    | "validation_passed"
    | "validation_failed";
  at: string;
  actor: "user" | "system" | "main" | "moderator" | "subtask";
  summary: string;
  details?: unknown;
}
```

用途：

- 群聊面板可以展示边界事件时间线。
- 恢复任务时，主任务能读取最新边界和历史 gate 决策。
- 出现越界时，用户能知道是哪个子任务、哪个 round、哪个文件触发。
- 后续可以把边界事件作为排障和产品改进数据。

## 10. 落地优先级

建议分阶段推进，避免一次性把 UI、任务记录、CLI 参数、diff 校验和审批系统都做完。

### 第一阶段：边界契约和 UI 摘要

目标：让用户能显式设置边界，并让任务全程可见。

范围：

- 新增 `boundaryContract` 数据结构。
- Loop 任务创建时生成默认边界契约。
- UI 增加边界卡片和群聊边界摘要。
- 主任务、子任务、红蓝辩论 prompt 全部注入边界契约。
- 补充需求时允许追加目标和验收标准。

验收：

- 新建 Loop 任务能在任务记录里看到 `boundaryContract`。
- 子任务 prompt 中能看到允许范围和禁止范围。
- 群聊面板能展示当前边界摘要。

### 第二阶段：写入范围校验和越界停止

目标：把最关键的文件范围从软约束变成硬校验。

范围：

- 校验子任务 `writeFiles` 是否在允许范围内。
- 记录任务开始时的 git 状态基线。
- 子任务完成后做 diff 范围检查。
- 越界时进入 `needs-review`，群聊展示越界路径。

验收：

- 子任务声明写入禁止路径时不会被派发。
- 子任务完成后如果出现禁止路径变更，任务自动停止并提示人工复核。
- 已有用户未提交改动不会被误删或自动回滚。

### 第三阶段：人工 Gate

目标：让高风险动作有明确的人机交互闭环。

范围：

- 定义默认高风险动作列表。
- 在任务派发前识别需要确认的动作。
- 群聊面板支持允许一次、本任务允许、拒绝、停止。
- gate 决策写入 `boundaryEvents`。

验收：

- 修改依赖、删除文件、写工作区外路径等动作默认要求确认。
- 用户拒绝后，主任务会改方案或缩小范围，而不是继续执行原方案。

### 第四阶段：CLI sandbox / approval 映射

目标：把插件侧边界尽量映射到底层 CLI 能力。

范围：

- 按 CLI 能力映射 sandbox、approval、network 等参数。
- 对无法硬约束的 CLI 能力做 UI 明示。
- 在错误详情和任务记录中记录实际使用的执行护栏。

验收：

- 用户能看到本次任务真实使用了哪种审批和沙箱策略。
- 不支持硬隔离的 CLI 不会被误展示为已硬隔离。

### 第五阶段：边界模板和项目级默认策略

目标：降低长期使用成本。

范围：

- 支持项目级默认边界策略。
- 支持按 CLI、工作区、任务类型保存预设。
- 可从历史成功任务复制边界。

验收：

- 常用项目不需要每次重新填写允许范围和验证命令。
- 高风险仓库可以默认启用更严格策略。

## 11. 推荐代码落点

按当前架构，建议这样落：

| 能力 | 推荐落点 |
| --- | --- |
| 边界类型、规范化、路径匹配、校验纯函数 | 新增 `src/lobsterBoundary.ts` |
| 任务记录新增字段、创建/恢复/补充需求编排 | `src/extension.ts` |
| Webview 协议类型 | `src/webview/types.ts` |
| 输入区边界卡片、群聊边界摘要、gate 操作 | `src/webview/viewContent.ts`、`src/webview/lobsterDebatePanel.ts` |
| 国际化文案 | `src/i18n.ts` 和 Webview 内置词典 |
| 红蓝辩论共识校验扩展 | `src/lobsterDebate.ts` 或新增纯函数模块 |
| 产品规格同步 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md` |
| 运行时设计同步 | `.ch/docs/design-docs/vscode-cli-extension-runtime.md` |

如果只是实现第一阶段，尽量不要把所有逻辑继续塞进 `extension.ts`。边界校验、路径匹配、默认策略都应该是可单测的纯函数。

## 12. 需要避免的设计误区

- 不要只加一段提示词。提示词是必要的，但不是边界系统。
- 不要假装插件能完全控制所有 CLI 行为。底层 CLI 不支持的硬限制，要明确标为软约束或事后校验。
- 不要默认自动回滚用户工作区。检测到越界应先停止并提示，由用户决定处理方式。
- 不要把每个动作都变成确认弹窗。边界系统的价值是让低风险动作自动化，让高风险动作显式化。
- 不要让红蓝辩论替代运行时校验。红队可以发现问题，但文件范围、预算和 gate 仍应由扩展侧机器校验。

## 13. 最小可行方案

如果只做一个最小版本，建议先做这 5 件事：

1. Loop 任务记录新增 `boundaryContract`，包含目标、允许写入范围、禁止写入范围、验证命令、最大轮次。
2. 新建任务时在 UI 展示边界卡片，默认允许仓库内普通代码/文档修改，保护 `.git/`、密钥、依赖、发布配置。
3. 主任务和子任务 prompt 必须包含边界契约，子任务必须声明 `writeFiles`。
4. 派发子任务前校验 `writeFiles`，越界则进入 `needs-review`。
5. 子任务结束后做 diff 范围检查，发现越界路径就停止任务并在群聊中展示。

这 5 件事能先把“设边界”从自然语言提醒提升为可见、可传递、可校验的工程能力。后续再补人工 gate、CLI sandbox 映射和项目级模板。
