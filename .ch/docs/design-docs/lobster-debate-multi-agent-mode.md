# 龙虾辩论多智能体模式详细设计

- 状态：proposed
- 相关计划：待创建实现计划
- 相关规格：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关目录：`src/extension.ts`、`src/lobsterParallel.ts`、`src/webview/viewContent.ts`、`src/webview/types.ts`、`src/cli/types.ts`

## 背景

当前龙虾模式已经具备一条稳定的主从多智能体链路：

- 用户在聊天面板选择 `interactiveMode=lobster`。
- 扩展创建龙虾任务记录，写入 `~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json`。
- 主任务每轮返回一个 JSON 决策，包含 `status`、`estimatedRemainingRounds`、`acceptance`、`subtasks` 等字段。
- 扩展把 `subtasks` 批次转成子任务记录，并按 `writeFiles` / `conflictGroup` 规划组内并发、组间串行。
- 子任务在独立会话执行，写入 `~/.sinitek_cli/lobster-communications/<taskId>/subtasks/` 下的沟通文件。
- 批次内所有子任务完成后，扩展唤醒主任务复核。
- 只有主任务最终返回 `status=completed`，且主任务对话存在 `lobsterFinalSummary=true` 的最终总结气泡，任务才真正完成。

这个模式的问题不在子任务执行，而在规划和复核决策仍由一个主任务单点完成。复杂任务里，单个主任务容易出现三个问题：

- 规划视角不足：只从一个思路拆任务，容易漏掉架构、测试、风险、用户体验或兼容性维度。
- 过早收敛：主任务可能直接派发自己认为合理的子任务，缺少异议和交叉质询。
- 验收偏置：后续复核也可能沿用最初方案的假设，遗漏“这个方案本身是否成立”的审查。

因此新增的“辩论多智能体”不应重写子任务执行系统，而应替换“主任务单独规划/复核”这个决策阶段。

## 目标

新增一个龙虾模式内的执行方式：`辩论多智能体`。

目标行为：

- 用户仍然选择顶层 `龙虾` 模式。
- 龙虾模式下的执行方式可选：
  - `主从多智能体`：沿用当前主任务单独规划，再派发子任务。
  - `辩论多智能体`：多个规划/审查智能体先围绕目标辩论，形成一致结论后，再派发子任务。
- 辩论只发生在规划和复核决策阶段。
- 辩论形成的最终规划仍输出为现有龙虾主任务 JSON 决策。
- 子任务派发、并发冲突规划、子任务重试、沟通文件、最终总结气泡、任务保留清理，尽量复用现有链路。

成功标准：

- 规划不是由单个主任务直接给出，而是至少 3 个辩论参与者提出观点、质询并达成一致。
- 每一轮派发子任务前，都能在沟通目录中找到对应的辩论记录和共识摘要。
- 只有不存在阻塞性异议时，才允许派发子任务或标记完成。
- 如果无法达成一致，任务进入 `needs-review`，而不是静默选择某一方观点继续执行。

## 非目标

第一阶段不处理以下内容：

- 不新增顶层交互模式。`coding / plan / lobster` 仍保持不变。
- 不重写子任务执行器。`runLobsterSubtasksBatchWithRetry` 和 `lobsterParallel` 规划规则继续复用。
- 不实现真正跨进程、跨机器或远端服务的多智能体系统。
- 不要求 Claude 分组接入插件侧模型选择。Claude 仍沿用 CLI 默认模型或用户命令参数。
- 不让辩论参与者直接修改仓库代码。辩论参与者只允许读上下文并写沟通文件。
- 不在第一阶段做复杂可视化图谱。主面板先展示辩论启动、共识和派发摘要。

## 术语

| 术语 | 含义 |
| --- | --- |
| 龙虾执行方式 | 龙虾模式内部的二级模式，不等同于顶层 `interactiveMode` |
| 主从多智能体 | 当前模式。主任务单独规划和复核，子任务执行具体工作 |
| 辩论多智能体 | 新模式。多个规划/审查智能体先辩论，达成共识后输出同样的龙虾主任务决策 |
| 辩论参与者 | 只参与规划、质询、验收判断的智能体，不直接改代码 |
| 辩论协调器 | 扩展侧编排角色，负责启动参与者、收集产物、检查共识，不作为独立的“最终拍板主任务” |
| 共识摘要 | 多个参与者达成一致后的结构化结论，是生成 `subtasks` 或 `completed` 决策的依据 |
| 阻塞性异议 | 参与者认为当前方案会导致错误、遗漏硬性需求、文件冲突或不可验收，且没有被解决 |

## 现状约束

### 运行时约束

- 当前龙虾任务记录类型只有 `main` / `subtask` 两类角色。
- 当前主任务 JSON 解析集中在 `parseLobsterMainDecision`、`normalizeLobsterMainDecision`、`applyLobsterMainDecision`。
- 当前子任务批次最多 `LOBSTER_PARALLEL_SUBTASK_MAX = 6`。
- 当前龙虾最大主任务复核轮次由项目级设置控制，默认 20。
- 当前子任务失败会 1 分钟后自动重试，最多 5 次。
- 任务记录和沟通目录有 30 天保留清理。

### UI 约束

- 顶层模式选择仍是 `编码 / 规划 / 龙虾`。
- 龙虾执行方式应出现在龙虾模式底部模型区域中，位置在模型选择左侧。
- 执行方式选择不应依赖插件侧模型选择是否可见。即使 Claude 不展示模型选择，龙虾执行方式仍应可见。
- 执行中切换 UI 选择不应改变已创建任务。任务创建时必须把执行方式写入任务记录，恢复时沿用记录值。

### 文档与国际化约束

- Webview 新增文案必须同时提供中英文。
- 功能变化需要同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。
- 设计事实来源放在 `.ch/docs/design-docs/`，`docs/` 只做兼容入口。

## 方案选项

### 方案 A：单主任务模拟辩论

做法：

- 仍只运行一个主任务。
- 在主任务提示词里要求它内部模拟多个角色辩论。
- 最终仍输出当前 JSON 决策。

优点：

- 改动最小。
- 无需新增任务角色、沟通目录结构或并发执行。
- 成本最低、速度最快。

缺点：

- 本质仍是一个模型一次性自问自答，不是真正多智能体。
- “异议”容易被主任务提前过滤，无法形成独立观点。
- 很难证明规划不是由单一主任务独断。

结论：不采用。它无法满足“不是由一个主单独来规划”的核心要求。

### 方案 B：完全重写龙虾为辩论式工作流

做法：

- 把龙虾主任务、子任务、复核全部改成多智能体辩论。
- 子任务执行也由辩论组动态决定和监督。
- 现有 `subtasks` 协议只作为兼容层。

优点：

- 概念最纯粹。
- 后续可以扩展成复杂团队协作系统。

缺点：

- 改动面大，风险高。
- 容易破坏现有已验证的子任务并发、重试、记录和恢复逻辑。
- 第一阶段难以稳定收口。

结论：不采用。当前需求集中在规划方式，不需要重写执行链路。

### 方案 C：辩论式规划，复用现有子任务执行

做法：

- 新增龙虾执行方式 `debate_multi_agent`。
- 每个主任务复核轮开始时，扩展先启动多个辩论参与者。
- 参与者只读取任务记录、沟通文件和工作区上下文，分别写出观点。
- 至少经过“独立观点”和“交叉质询”两个阶段。
- 扩展收集辩论产物，再运行一个“共识汇总”步骤。
- 共识汇总必须输出现有 `LobsterMainDecision` JSON。
- 后续 `applyLobsterMainDecision`、子任务批次执行、最终总结全部复用现有链路。

优点：

- 符合“不是一个主单独规划”的要求。
- 复用现有可靠执行链路，风险集中在规划阶段。
- 辩论产物可落盘，可排障、可复盘。
- 未来可以扩展参与者角色、辩论轮次和模型分配。

缺点：

- 每轮主任务决策会变慢，成本增加。
- 需要新增辩论记录、角色类型和共识校验。
- UI 需要处理更多临时运行状态。

结论：采用。

## 最终决策

采用方案 C。

核心决策：

- `辩论多智能体` 是龙虾模式下的执行方式，不是新的顶层 `InteractiveMode`。
- 辩论只替代主任务规划/复核阶段。
- 辩论完成后必须生成现有龙虾主任务 JSON 决策。
- 子任务执行链路保持不变。
- 每个龙虾任务创建时固化执行方式，恢复任务时以任务记录为准。

## 用户体验设计

### 面板控件

龙虾模式下底部区域展示：

```text
[执行方式: 主从多智能体/辩论多智能体] [主任务模型] [子任务模型] [思考模式]
```

行为规则：

- 只有顶层模式为 `龙虾` 时显示执行方式。
- 执行方式始终可见，不绑定模型选择能力。
- `主任务模型 / 子任务模型` 仍只在 Codex / Gemini 等支持插件侧模型选择的 CLI 下展示。
- 切换执行方式只影响新建龙虾任务。
- 若当前 tab 正在恢复旧任务，以任务记录中的 `executionMode` 为准，并在 UI 上同步显示。

### 文案

中文：

- `主从多智能体`
- `辩论多智能体`
- `龙虾执行方式`
- `辩论规划已启动`
- `辩论共识已形成`
- `辩论未达成一致，已进入人工复核`

英文：

- `Main/Sub Multi-Agent`
- `Debate Multi-Agent`
- `Lobster execution mode`
- `Debate planning started`
- `Debate consensus reached`
- `Debate did not reach consensus. Manual review is required.`

### 运行状态消息

主任务标签中展示简明系统消息：

```text
🦞 辩论规划已启动：第 1 轮，4 个参与者
🦞 辩论观点已收集：架构规划、实现拆分、测试验收、风险审查
🦞 辩论共识已形成：派发 3 个子任务，预计剩余 2 轮
```

如果失败：

```text
🦞 辩论未达成一致：存在阻塞性异议，已进入人工复核
```

第一阶段不要求展示完整辩论全文。完整内容落盘到沟通目录，主面板展示摘要和路径。

## 数据模型设计

### 执行方式枚举

新增稳定枚举：

```ts
type LobsterExecutionMode =
  | "main_sub_multi_agent"
  | "debate_multi_agent";
```

默认值：

```ts
const DEFAULT_LOBSTER_EXECUTION_MODE: LobsterExecutionMode = "main_sub_multi_agent";
```

兼容规则：

- 老任务记录没有 `executionMode` 时，按 `main_sub_multi_agent` 处理。
- UI 状态为空或非法时，按 `main_sub_multi_agent` 处理。
- 发送消息携带非法值时，扩展侧丢弃并使用默认值。

### PanelState

建议新增：

```ts
type PanelState = {
  // existing fields...
  lobsterExecutionMode: LobsterExecutionMode;
};
```

如果需要按 CLI 记忆：

```ts
type WorkspaceSettings = {
  // existing fields...
  lobsterExecutionModeByCli?: Partial<Record<CliName, LobsterExecutionMode>>;
};
```

建议按 CLI 记忆，原因是 Codex / Gemini / Claude 的成本和能力差异明显。

### PanelMessage

发送 prompt 时新增可选字段：

```ts
type PanelMessage =
  | {
      type: "sendPrompt";
      prompt: string;
      interactiveMode?: InteractiveMode;
      lobsterExecutionMode?: LobsterExecutionMode;
      lobsterMainModel?: string;
      lobsterSubtaskModel?: string;
      // existing fields...
    };
```

工具设置更新时新增：

```ts
| {
    type: "updateSetting";
    key: `lobsterExecutionMode.${CliName}`;
    value: LobsterExecutionMode;
  }
```

### 龙虾任务记录

`LobsterTaskRecord` 新增：

```ts
type LobsterTaskRecord = {
  // existing fields...
  executionMode?: LobsterExecutionMode;
  debateRounds?: LobsterDebateRoundRecord[];
};
```

`executionMode` 必须在 `createLobsterTaskRecord` 时写入，后续恢复不随 UI 当前选择改变。

### 辩论记录

```ts
type LobsterDebateParticipantRole =
  | "architecture"
  | "implementation"
  | "testing"
  | "risk"
  | "product"
  | "custom";

type LobsterDebateParticipantRecord = {
  id: string;
  role: LobsterDebateParticipantRole;
  title: string;
  model?: string | null;
  status: "pending" | "running" | "completed" | "error" | "stopped";
  artifactFile: string;
  summary?: string;
  stance?: "agree" | "agree_with_reservations" | "block";
  blockingIssues?: string[];
  updatedAt: number;
};

type LobsterDebateDisagreementRecord = {
  id: string;
  title: string;
  participants: string[];
  severity: "blocking" | "non_blocking";
  resolution?: string;
};

type LobsterDebateConsensusRecord = {
  artifactFile: string;
  reached: boolean;
  summary: string;
  participantStances: Array<{
    participantId: string;
    stance: "agree" | "agree_with_reservations" | "block";
    note?: string;
  }>;
  resolvedDisagreements: LobsterDebateDisagreementRecord[];
  openDisagreements: LobsterDebateDisagreementRecord[];
  decision?: LobsterMainDecision;
};

type LobsterDebateRoundRecord = {
  lobsterRound: number;
  debateRound: number;
  status: "running" | "consensus" | "blocked" | "error" | "stopped";
  startedAt: number;
  completedAt?: number;
  briefFile: string;
  participants: LobsterDebateParticipantRecord[];
  consensus?: LobsterDebateConsensusRecord;
};
```

## 文件结构设计

现有沟通目录：

```text
~/.sinitek_cli/lobster-communications/<taskId>/
├── main-task.md
└── subtasks/
```

新增：

```text
~/.sinitek_cli/lobster-communications/<taskId>/
├── main-task.md
├── debates/
│   └── round-<lobsterRound>/
│       ├── brief.md
│       ├── participants/
│       │   ├── architecture.md
│       │   ├── implementation.md
│       │   ├── testing.md
│       │   └── risk.md
│       ├── cross-review.md
│       ├── consensus.md
│       └── decision.json
└── subtasks/
```

文件职责：

- `brief.md`：扩展生成的辩论简报，包含用户目标、任务记录路径、当前轮次、已有子任务结果、约束。
- `participants/*.md`：每个参与者的独立观点和交叉质询结果。
- `cross-review.md`：第二阶段质询摘要，可由扩展汇总或由共识步骤写入。
- `consensus.md`：自然语言共识结论，必须列出一致意见、保留意见、已解决分歧、未解决分歧。
- `decision.json`：最终要交给现有龙虾链路解析的 JSON 决策。

保留策略：

- 与现有 `lobster-communications` 目录共用 30 天保留清理。
- 删除任务沟通目录时，辩论目录一起删除。

## 辩论参与者设计

第一阶段默认 4 个参与者：

| 参与者 | 职责 | 必须回答的问题 |
| --- | --- | --- |
| 架构规划者 | 判断总体拆分、依赖顺序、模块边界 | 目标应分几阶段？哪些改动必须先做？哪些可以并发？ |
| 实现拆分者 | 把目标拆成最小可执行子任务 | 每个子任务的输入、输出、写入范围、验收标准是什么？ |
| 测试验收者 | 设计验证路径和完成判定 | 如何证明完成？哪些测试、构建、人工检查必需？ |
| 风险审查者 | 找冲突、遗漏、不可逆风险 | 哪些文件/配置会冲突？哪些假设可能错？是否需要阻塞？ |

可选后续扩展：

- 产品体验参与者：用于 UI/流程类任务。
- 安全参与者：用于权限、凭据、外部调用类任务。
- 数据参与者：用于数据库、迁移、报表类任务。

第一阶段不做动态角色选择，避免不可预测。后续可以由任务关键词或用户选项扩展。

## 辩论流程设计

### 总览

```text
用户提交龙虾任务
  ↓
创建 LobsterTaskRecord，写入 executionMode
  ↓
如果 executionMode=main_sub_multi_agent
  → 走现有 runLobsterRound 主任务决策
  ↓
如果 executionMode=debate_multi_agent
  → 构造辩论 brief
  → 并发启动辩论参与者
  → 收集独立观点
  → 交叉质询
  → 共识汇总
  → 输出现有 LobsterMainDecision JSON
  → 复用 applyLobsterMainDecision
  → 复用子任务批次执行
```

### 阶段 1：构造辩论简报

扩展在每个主任务复核轮开始前生成 `brief.md`。

必须包含：

- 原始用户目标。
- 当前 `taskId`、`lobsterRound`、任务记录文件路径。
- 主任务沟通文件路径。
- 子任务沟通目录路径。
- 已完成、运行中、失败、中断的子任务概要。
- 上一轮 `estimatedRemainingRounds`。
- 当前 CLI、当前工作区。
- 当前执行方式：`debate_multi_agent`。
- 明确约束：参与者只读仓库和任务记录，只写自己的辩论 artifact。

### 阶段 2：独立观点

扩展并发启动 4 个辩论参与者。

每个参与者 prompt 必须要求输出结构：

```md
# 角色结论

## 立场

agree / agree_with_reservations / block

## 建议规划

...

## 子任务建议

...

## 并发与冲突判断

...

## 验收标准

...

## 阻塞性异议

...
```

要求：

- 参与者不能直接返回最终 `LobsterMainDecision`。
- 参与者不能修改仓库业务文件。
- 参与者必须写入自己的 artifact 文件。
- 如果发现不能继续，必须用 `block` 并列出阻塞性异议。

### 阶段 3：交叉质询

第一阶段观点全部完成后，扩展把所有 artifact 路径提供给参与者或共识步骤。

第一阶段实现建议：

- 不再启动第二轮完整参与者会话，先由共识步骤读取所有观点并生成 `cross-review.md`。
- `cross-review.md` 必须列出：
  - 哪些观点一致。
  - 哪些观点冲突。
  - 哪些冲突是阻塞性。
  - 每个阻塞性冲突的处理结论。

后续增强：

- 支持最多 2 轮真实交叉质询，即参与者读取其他观点后再次写 `participants/<role>-review.md`。

### 阶段 4：共识汇总

共识汇总步骤负责把辩论结果转成最终决策。

它不是“主任务单独规划”，而是受约束的汇总器：

- 必须读取 `brief.md` 和所有 `participants/*.md`。
- 必须在 `consensus.md` 中逐条引用各参与者观点。
- 必须列出 `participantStances`。
- 如果存在任何 `stance=block` 且未解决，不能派发子任务。
- 如果所有参与者 `agree` 或 `agree_with_reservations`，且保留意见已进入风险说明或验收标准，可以输出 `status=continue` 或 `status=completed`。
- 输出的 `decision.json` 必须仍符合现有 `LobsterMainDecision` 协议。

共识达成的最低条件：

- 至少所有默认参与者都完成。
- 没有未解决的阻塞性异议。
- 原始用户需求都能映射到后续子任务或完成验收项。
- `subtasks[*].prompt` 自包含。
- 多个子任务并发时，必须声明 `writeFiles` 或 `conflictGroup`，并说明不会冲突。

### 阶段 5：复用现有执行

共识汇总返回：

```json
{
  "status": "continue",
  "estimatedRemainingRounds": 2,
  "debate": {
    "round": 1,
    "consensusReached": true,
    "summary": "四个参与者同意先并发处理 UI 文案、任务记录字段和文档同步。",
    "participantStances": [
      { "participantId": "architecture", "stance": "agree" },
      { "participantId": "implementation", "stance": "agree" },
      { "participantId": "testing", "stance": "agree_with_reservations", "note": "需要补协议解析单测" },
      { "participantId": "risk", "stance": "agree" }
    ],
    "openDisagreements": []
  },
  "acceptance": {
    "passed": false,
    "summary": "规划已达成一致，仍需执行实现子任务。",
    "checks": [
      { "name": "需求拆分", "passed": false, "detail": "需要执行后续子任务" }
    ]
  },
  "parallelReason": "UI、协议类型、文档同步写入范围互不重叠，可以并发。",
  "subtasks": [
    {
      "id": "ui-lobster-execution-mode",
      "title": "补齐龙虾执行方式 UI",
      "conflictGroup": "src/webview",
      "writeFiles": ["src/webview/viewContent.ts", "src/webview/types.ts"],
      "prompt": "..."
    }
  ]
}
```

扩展处理：

- `debate` 字段作为可选元数据解析和存储。
- `status`、`estimatedRemainingRounds`、`acceptance`、`subtasks` 继续按现有逻辑执行。
- `applyLobsterMainDecision` 不应因为存在 `debate` 字段改变子任务派发语义。

## Prompt 设计

### 参与者通用系统约束

```text
你是龙虾模式“辩论多智能体”中的一个规划/审查参与者。
你不是执行子任务的编码智能体。
你只能读取仓库、任务记录和沟通文件，不能修改仓库业务文件。
你必须把自己的结论写入指定辩论文件。
你的职责是独立提出观点、发现风险、给出是否同意继续的立场。
如果存在硬性需求遗漏、不可验证、文件冲突或错误依赖，必须标记为 block。
```

### 架构规划者重点

```text
重点判断模块边界、阶段划分、依赖顺序、可并发性。
必须明确哪些子任务能并发，哪些必须串行。
```

### 实现拆分者重点

```text
重点把目标拆成最小可执行子任务。
每个子任务必须有清晰输入、输出、写入范围和验收标准。
```

### 测试验收者重点

```text
重点判断如何证明任务完成。
必须列出构建、单测、手工验证或文档检查要求。
```

### 风险审查者重点

```text
重点寻找遗漏、冲突、不可逆修改、上下文不足和恢复风险。
只要发现会导致错误执行的缺口，必须给出 block。
```

### 共识汇总约束

```text
你是辩论结果汇总器，不是单独规划者。
你必须基于所有参与者产物形成共识。
如果存在未解决的 block，返回 status=blocked。
如果可以继续，返回现有龙虾主任务 JSON 决策。
输出必须是一个 JSON 对象，不要包裹 markdown。
```

## 扩展端编排设计

### 新增核心函数

建议新增：

```ts
async function runLobsterDebateRound(options: {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LobsterTaskRecord;
  round: number;
}): Promise<{
  status: "completed" | "continue" | "blocked" | "error" | "stopped";
  decision?: LobsterMainDecision;
  task: LobsterTaskRecord;
}>;
```

`runLobsterPrompt` 中替换点：

```ts
const mainResult = task.executionMode === "debate_multi_agent"
  ? await runLobsterDebateRound({ input, target, task: latest, round })
  : await runClassicLobsterMainDecision({ input, target, task: latest, round });
```

为了降低风险，建议先把当前主任务逻辑抽成：

```ts
async function runClassicLobsterMainDecision(...): Promise<LobsterDecisionRunResult>
```

再接入 debate 分支。

### 辩论参与者运行方式

第一阶段建议复用现有对话 tab 基础设施，但新增角色：

```ts
type LobsterTaskRole = "main" | "subtask" | "debate";
```

运行规则：

- 每个参与者创建临时 debate tab。
- tab 标题显示 `🦞 辩论·架构`、`🦞 辩论·测试` 等。
- 成功完成后可自动关闭 debate tab，但必须先持久化 artifact。
- 主任务或任一 debate/subtask 仍运行时，主任务 tab 禁止关闭。
- debate tab 手动继续时强制按 coding 或 plan-like 普通任务执行，禁止嵌套启动龙虾任务。

如果后续实现隐藏后台运行目标，也必须保留同等日志、状态和停止能力。

### 模型选择

第一阶段复用主任务模型：

- 辩论参与者默认使用 `lobsterMainModel`。
- 子任务仍使用 `lobsterSubtaskModel`。
- 不新增“辩论模型”选择，避免 UI 复杂度过高。

后续可以扩展模型角色：

```ts
type LobsterModelRole = "main" | "subtask" | "debate";
```

但第一阶段不做。

## 决策校验设计

`normalizeLobsterMainDecision` 增加对可选 `debate` 字段的容错解析。

当任务 `executionMode=debate_multi_agent` 时额外校验：

- 必须存在当前轮的 `LobsterDebateRoundRecord`。
- 共识记录 `reached=true`。
- `openDisagreements` 不存在 `severity=blocking`。
- `participantStances` 中不能出现未解决的 `block`。
- 如果 `status=completed`，`acceptance.passed=true` 且 `requirementCoverage` 全部通过。
- 如果 `status=continue`，`subtasks.length >= 1`。

校验失败时：

- 不派发子任务。
- 更新任务为 `needs-review`。
- 写入系统消息说明缺失原因。

## 失败与恢复

### 参与者失败

参与者失败路径：

- 非主动中断或异常：复用现有隐式继续/重试能力。
- 达到重试上限：辩论轮标记 `error`，任务进入 `needs-review`。
- 用户主动停止：辩论轮标记 `stopped`，任务进入 `stopped` 或 `needs-review`。

不建议在参与者缺失时继续形成共识。否则“大家一致”不可证明。

### 共识失败

共识失败包括：

- 有未解决阻塞性异议。
- 共识汇总没有输出合法 JSON。
- 输出 JSON 与辩论记录矛盾。
- 输出子任务缺少自包含 prompt。

处理：

- 任务进入 `needs-review`。
- `main-task.md` 追加失败原因。
- 主面板展示“辩论未达成一致”。

### 恢复任务

恢复规则：

- 继续使用任务记录里的 `executionMode`。
- 如果上一轮 debate 已经完成且有 `decision.json`，恢复时优先解析该 decision，避免重复辩论。
- 如果上一轮 debate 缺少共识或任一参与者 artifact，重新执行该 debate round。
- 已完成任务缺失 `lobsterFinalSummary=true` 时，仍沿用现有自动恢复最终总结机制。

## 与现有链路的关系

| 能力 | 主从多智能体 | 辩论多智能体 |
| --- | --- | --- |
| 顶层 interactiveMode | `lobster` | `lobster` |
| 任务记录目录 | 复用 | 复用 |
| 沟通目录 | 复用 | 复用并新增 `debates/` |
| 规划方式 | 主任务单独规划 | 多参与者辩论后共识规划 |
| 子任务 JSON 协议 | 现有协议 | 现有协议加可选 `debate` 元数据 |
| 子任务执行 | 现有批次执行 | 完全复用 |
| 并发冲突规划 | `lobsterParallel` | 完全复用 |
| 最终完成判定 | `completed` + final summary 气泡 | 相同，且要求共识无阻塞异议 |
| 清理策略 | 30 天 | 相同 |

## 迁移策略

第一阶段迁移：

- 新增 UI 选项，默认仍为 `主从多智能体`。
- 老任务记录不写 `executionMode`，运行时视为 `main_sub_multi_agent`。
- 新建任务写入 `executionMode`。
- 当前已存在的模型角色 `main/subtask` 不变。
- 文档同步后再实现代码，不做数据迁移脚本。

兼容检查：

- 老的 `lobster-tasks.json` 能继续读取。
- 老任务恢复不进入辩论模式。
- 用户切换 UI 到辩论模式后，只有新任务使用辩论。

## 验证策略

### 单元测试

建议抽出纯函数并补测：

- `normalizeLobsterExecutionMode`
- `normalizeLobsterDebateRoundRecord`
- `buildLobsterDebatePaths`
- `validateLobsterDebateConsensus`
- `normalizeLobsterMainDecision` 对可选 `debate` 字段的兼容解析

关键用例：

- 老任务无 `executionMode` 默认主从。
- 新任务 `debate_multi_agent` 写入记录。
- 存在 unresolved blocking disagreement 时不能派发子任务。
- 所有参与者 agree 时能继续复用 `subtasks`。
- `status=completed` 但 requirementCoverage 缺失时无效。

### 集成验证

手工验证最小链路：

1. 选择龙虾模式和 `辩论多智能体`。
2. 发送一个可拆分任务。
3. 观察主 tab 出现辩论启动消息。
4. 检查 `lobster-communications/<taskId>/debates/round-1/` 下生成 brief、participants、consensus、decision。
5. 检查共识后仍按现有 `subtasks` 启动子任务。
6. 子任务完成后唤醒下一轮辩论复核。
7. 最终完成时仍出现 `lobsterFinalSummary=true` 的最终总结气泡。

### 回归验证

- `npm run build`
- 现有 `lobsterParallel` 单元测试
- 人工验证主从多智能体不受影响
- 人工验证 Claude 下执行方式可见，但模型选择仍隐藏

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 辩论成本过高 | 用户等待时间变长 | 默认 4 个参与者，第一阶段只做一轮独立观点和一次共识，不做多轮循环 |
| 辩论无法达成一致 | 自动任务停滞 | 明确进入 `needs-review`，保留完整分歧记录 |
| 参与者误改代码 | 破坏工作区 | prompt 明确只写 artifact；后续可在 debate run 前后做 git diff 检查 |
| UI tab 过多 | 面板拥挤 | debate tab 成功后自动关闭，主 tab 保留摘要和文件路径 |
| 现有任务恢复混乱 | 老任务被错误带入新模式 | `executionMode` 创建时固化，老任务默认主从 |
| 共识汇总重新变成单点决策 | 背离需求 | 共识必须引用参与者 artifact，并禁止 unresolved block 继续 |

## 分阶段落地建议

### 第一阶段：协议和记录

- 新增 `LobsterExecutionMode`。
- 新增 UI 选择与 workspace 记忆。
- `LobsterTaskRecord` 写入 `executionMode`。
- 新增辩论目录路径和记录类型。
- 不改变现有主从逻辑。

### 第二阶段：辩论编排

- 抽出当前主任务决策函数。
- 实现 `runLobsterDebateRound`。
- 启动 4 个参与者，落盘 artifact。
- 实现共识汇总，输出 `decision.json`。
- 成功后复用 `applyLobsterMainDecision`。

### 第三阶段：校验和恢复

- 校验共识与决策一致性。
- 支持 debate round 恢复。
- debate tab 自动关闭和主 tab 锁定。
- 增加单元测试和手工验证脚本说明。

### 第四阶段：体验增强

- 支持配置辩论参与者数量。
- 支持选择辩论模型角色。
- 支持展开查看辩论摘要。
- 支持任务类型自动选择参与者角色。

## 接受标准

第一版实现完成时必须满足：

- 龙虾模式中可选择 `主从多智能体` 或 `辩论多智能体`。
- 新建任务记录能固化 `executionMode`。
- 选择 `主从多智能体` 时，现有行为不变。
- 选择 `辩论多智能体` 时，至少 4 个参与者完成规划/审查 artifact。
- 派发子任务前必须存在 `consensus.md` 和 `decision.json`。
- 存在未解决阻塞性异议时不会派发子任务。
- 共识通过后，子任务执行仍复用现有批次并发逻辑。
- 最终完成仍要求 `lobsterFinalSummary=true`。
- 文档、功能清单、构建验证全部完成。
