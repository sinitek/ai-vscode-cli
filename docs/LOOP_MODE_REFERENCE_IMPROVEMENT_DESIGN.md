# Loop 模式参考改进设计

- 状态：proposed
- 日期：2026-07-08
- 参考系统：`~/work/loop-engineering`
- 适用范围：本插件现有 Loop 模式的局部增强设计，不代表立即实施
- 相关现状：`docs/LOOP_BOUNDARY_CONTROLS.md`、`.ch/docs/design-docs/loop-debate-multi-agent-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## 1. 背景

本插件已经具备较强的 Loop 模式基础：

- `coding / loop` 顶层模式区分。
- `main_sub_multi_agent` 主从多智能体执行。
- `debate_multi_agent` 红蓝辩论规划，再复用主从执行链路。
- 主任务可以拆分子任务，按 `writeFiles` / `conflictGroup` 做并发冲突规划。
- 子任务失败自动重试，主任务连续失败后进入 `needs-review`。
- Loop 群聊面板可以查看过程、继续执行、补充需求和中止任务。
- 本地任务记录和沟通文件已经落在 `~/.sinitek_cli/loop-tasks/` 与 `~/.sinitek_cli/loop-communications/`。

目标系统 `loop-engineering` 的先进点不在某个单一功能，而在它把“让 AI 做任务”提升为一套可运行、可预算、可观测、可暂停、可分级放权的控制系统。它强调的核心不是更强提示词，而是把 Loop 设计成长期运行的工程机制。

本设计文档用于回答两个问题：

1. 目标系统哪些设计值得本插件局部参考。
2. 哪些改进可以贴合本插件现有架构，低风险逐步落地。

## 2. 目标系统 Loop 模式的先进点

### 2.1 从“单次任务”升级为“运行体系”

目标系统把 Loop 定义为持续运行的系统，而不是一次 AI 对话。它要求每个 Loop 都有：

- 明确目标和非目标。
- 调度方式和运行频率。
- 状态文件。
- 运行日志。
- 预算上限。
- 人工介入规则。
- 暂停和终止条件。

对本插件的启发：当前 Loop 更像“用户发起的一轮长任务编排”。可以局部补齐“运行体系”的元数据，让每个 Loop 任务天然携带目标、预算、状态、日志和 gate 规则，而不是只依赖 prompt 和任务记录流水。

### 2.2 Readiness Level 分级放权

目标系统把 Loop 成熟度分成：

| 等级 | 含义 | 行为边界 |
| --- | --- | --- |
| L0 Draft | 只有设计意图 | 不运行或只做文档 |
| L1 Report | 只报告，不自动改动 | 适合首次启用和高风险场景 |
| L2 Assisted | 可做小修，但需要验证和人工 gate | 适合局部代码/文档修复 |
| L3 Unattended | 可无人值守运行 | 必须具备完整预算、日志、denylist、验证和暂停机制 |

对本插件的启发：Loop 任务启动时可以增加“放权级别”概念。当前默认可对应 L2，但建议第一阶段先支持 L1/L2：

- L1：只读调研、生成计划、发现问题、整理报告，不派发会写文件的子任务。
- L2：允许局部修改，但必须声明 `writeFiles`、通过边界校验并给出验证证据。

暂不建议直接支持 L3 无人值守，因为本插件是 VS Code 本地交互工具，用户可见、可介入是优势，不应过早做后台自治。

### 2.3 状态和记忆是 Loop 的脊柱

目标系统强调 `STATE.md` 或结构化状态文件必须在每轮开始读取、每轮结束写入，并记录：

- 当前正在做什么。
- 上次尝试了什么。
- 哪些事项等待人工处理。
- 哪些旧项目已关闭、合并或过期，需要剪枝。

本插件已经有任务记录和沟通文件，但当前更偏执行轨迹，不完全等同于“可读的状态摘要”。可参考目标系统增加一个面向用户和主任务都易读的 Loop 状态摘要。

建议新增每个任务的轻量状态摘要文件：

```text
~/.sinitek_cli/loop-communications/<taskId>/state.md
```

第一版内容：

```markdown
# Loop State

## Objective
- Goal:
- Non-goals:
- Success criteria:

## Current Status
- Status:
- Current round:
- Active subtasks:
- Waiting on human:

## Last Run
- Started:
- Ended:
- Outcome:
- Actions taken:
- Validation evidence:

## Open Items
- [ ] ...

## Pruned / Resolved
- ...
```

这个文件不替代 `loop-tasks.json`，而是作为可读状态面，供恢复、群聊展示、人工复核和后续记忆提炼使用。

### 2.4 预算和成本是运行前置条件

目标系统把 token 预算、子智能体 spawn 上限、最大迭代次数、每日运行上限放进 Loop 设计，而不是事后统计。

本插件已有：

- Loop 最大主任务复核轮次。
- 单轮最多 6 个子任务。
- 子任务失败最多 5 次重试。
- 主任务连续失败 5 次进入 `needs-review`。

这些已经是预算雏形，但还分散在设置和实现里。可以参考目标系统把预算集中展示并写入任务记录：

```ts
interface LoopLoopBudget {
  maxMainRounds: number;
  maxSubtasksPerRound: number;
  maxSubtaskRetries: number;
  maxChangedFiles?: number;
  maxRuntimeMinutes?: number;
  maxAutoResumeCount?: number;
}
```

第一阶段不需要精确 token 统计，可以先做“运行预算”和“动作预算”，因为它们可以由扩展侧稳定约束。

### 2.5 Maker / Checker 分离

目标系统认为可靠 Loop 的关键结构是 maker/checker split：写代码的智能体不能自己宣布完成，必须有独立 verifier。

本插件当前已有主任务复核和红蓝辩论，但仍可以进一步明确角色边界：

- 子任务是 maker，负责局部执行。
- 主任务是 reviewer，负责验收子任务输出。
- 红队/蓝队是 planner checker，负责规划阶段质询。
- 后续可新增 verifier 子任务类型，用于运行验证命令、检查 diff 范围和验收证据。

局部参考点：不需要立刻引入独立模型或新进程，但可以在任务协议里增加 `verification` 字段，让主任务必须说明验证证据来源，而不是只写总结。

### 2.6 Worktree 隔离

目标系统把 worktree 当成代码修改型 Loop 的基础设施：每个修复尝试一个独立 worktree，避免多个智能体并发改同一工作区。

本插件当前主要通过 `writeFiles` / `conflictGroup` 做并发规划，适合 VS Code 当前工作区内的交互式体验。直接引入 worktree 会改变用户编辑器上下文，风险较高。

建议作为二阶段可选能力，而不是第一阶段默认能力：

- 第一阶段：保留当前工作区执行，只增强边界、日志、验证、冲突检查。
- 第二阶段：在“高隔离执行”预设下，为子任务创建临时 worktree，并在群聊中展示路径和 diff 摘要。
- 人工确认后再把 patch 应用回当前工作区或生成 PR/补丁文件。

### 2.7 运行日志和可观测性

目标系统要求每轮追加 `loop-run-log.md` 或结构化 JSON，记录：

- run id
- pattern
- duration
- items found
- actions taken
- escalations
- token estimate
- outcome

本插件已有任务记录、消息气泡和沟通文件，但缺少一个压缩、追加式、可快速扫描的运行日志。

建议新增：

```text
~/.sinitek_cli/loop-communications/<taskId>/run-log.jsonl
```

每轮追加一行：

```json
{
  "runId": "2026-07-08T15:10:00+08:00",
  "taskId": "...",
  "round": 3,
  "executionMode": "debate_multi_agent",
  "durationMs": 120000,
  "subtasksPlanned": 2,
  "subtasksCompleted": 2,
  "actionsTaken": ["subtask_completed", "main_review_passed"],
  "escalations": [],
  "outcome": "continue"
}
```

这比复读完整 transcript 更利于排障、性能分析和后续任务恢复。

### 2.8 Kill Switch 和 Pause Criteria

目标系统明确要求：

- 什么情况要慢下来。
- 什么情况要暂停。
- 什么情况要彻底终止。

本插件已有停止按钮和 `needs-review` 状态，但可以把暂停条件显性化：

- 主任务连续失败达到上限。
- 同一子任务重试达到上限。
- 子任务声明写入范围为空但要求改文件。
- 实际 diff 命中 denylist。
- 超过最大变更文件数。
- 验证命令失败且无法解释。
- 用户在群聊中点击暂停或拒绝 gate。

这些条件应进入任务记录和群聊状态，而不是只显示一条临时错误。

### 2.9 多 Loop 协调

目标系统强调多个 Loop 不能抢同一分支、同一 PR 或同一文件。原则包括：

- 一个分支同一时间只允许一个写入型 Loop。
- 不同 Loop 使用独立状态文件。
- 共享 denylist。
- action loop 写入 `acting_on`，其他 Loop 发现冲突就跳过。

本插件现在是本地用户主动发起，冲突规模较小，但已有多 tab、多子任务和群聊并发能力。可局部增加“任务级占用声明”：

```ts
interface LoopTaskLock {
  taskId: string;
  scope: "workspace" | "files";
  files: string[];
  createdAt: number;
  expiresAt?: number;
}
```

第一阶段不需要全局锁服务，只需在同一插件进程内检查正在运行的 Loop 任务和 `writeFiles` 是否重叠。

## 3. 不建议照搬的部分

### 3.1 不建议照搬定时调度

目标系统强调 `/loop`、cron、GitHub Actions、定时任务。本插件是 VS Code 本地交互工具，定时调度会带来：

- VS Code 未打开时不可运行。
- 本地权限和外部 CLI 状态不稳定。
- 用户可能不希望编辑器插件后台持续消耗资源。
- 与当前交互式群聊/标签页体验不一致。

建议只保留“手动恢复”和“用户确认后的继续执行”，不在第一阶段做定时后台 Loop。

### 3.2 不建议默认引入自动 PR / 自动合并

目标系统讨论 MCP/GitHub 连接器和自动 PR，但本插件目前重点是本地 CLI 对话和执行。自动 PR、自动评论、自动合并属于外部副作用，应独立设计权限、账号和审计，不应作为 Loop 局部增强的一部分。

### 3.3 不建议把仓库内 `STATE.md` 作为默认任务状态

目标系统适合把状态文件提交到仓库。本插件当前任务状态存储在 `~/.sinitek_cli/`，更符合本地工具定位。默认把每次任务状态写进用户仓库可能制造无关文件变更。

建议：

- 默认继续写入 `~/.sinitek_cli/`。
- 如果用户开启 Harness 骨架和长期记忆，再按现有规则把高价值结论沉淀到 `.ch/docs/`。
- 不把每轮 Loop runtime 状态写入项目仓库。

## 4. 建议的局部改进方案

### 4.1 Phase 1：Loop Readiness 元数据

新增任务创建时的结构化元数据：

```ts
type LoopLoopLevel = "report" | "assisted";

interface LoopLoopReadiness {
  level: LoopLoopLevel;
  goal: string;
  nonGoals: string[];
  successCriteria: string[];
  budget: LoopLoopBudget;
  safety: {
    writeDenylist: string[];
    askBefore: string[];
    stopOnViolation: boolean;
  };
}
```

行为：

- `report`：主任务只能输出分析、计划、风险和建议，不派发写入型子任务。
- `assisted`：允许派发子任务，但必须声明 `writeFiles`，并通过边界校验。
- 群聊面板展示 readiness 摘要。
- 主任务 prompt 注入 readiness 摘要。

这一步不需要改 CLI runner，主要改任务记录、prompt builder 和 UI 展示。

### 4.2 Phase 2：追加式 Run Log

为每个 Loop 任务新增 `run-log.jsonl`，记录每轮摘要。

落点建议：

- 新增纯函数模块：`src/loopRunLog.ts`
- 写入时机：
  - 任务创建。
  - 主任务决策完成。
  - 子任务批次开始/完成。
  - 任务进入 `completed / needs-review / error / stopped`。
- 群聊面板可读取最近 N 条日志作为“运行概览”。

价值：

- 调试不必读取完整 transcript。
- 性能优化可以统计轮次、耗时、重试次数。
- 后续长期记忆可以从 run log 提炼事件。

### 4.3 Phase 3：状态摘要 `state.md`

生成每个任务的人类可读状态摘要。

落点建议：

- 新增模块：`src/loopStateSummary.ts`
- 从 `LoopTaskRecord`、`run-log.jsonl`、最后一次主任务决策生成。
- 每次主任务或子任务状态变化后覆盖写入。

注意：

- `state.md` 是派生物，不作为唯一事实来源。
- 真实状态仍以 `loop-tasks.json` 为准。
- 如果派生失败，不应阻断任务执行，只写 debug 日志。

### 4.4 Phase 4：Verifier 子任务协议

引入可选 verifier 子任务类型，不必第一版独立运行新模型。

协议示例：

```ts
type LoopSubtaskKind = "implementation" | "verification";

interface LoopVerificationEvidence {
  commandsRun: string[];
  passed: boolean;
  failures: string[];
  changedFilesChecked: string[];
  notes: string;
}
```

行为：

- 主任务可以在实现子任务后派发 verification 子任务。
- verification 子任务优先运行验证命令、检查 `writeFiles` 和总结证据。
- 主任务最终完成前必须引用 verification evidence。

这一步可增强 maker/checker 分离，避免“主任务看了子任务总结就宣布完成”。

### 4.5 Phase 5：任务级冲突占用

在同一插件进程内维护正在运行 Loop 的写入范围：

- 新任务启动时检查是否与运行中任务的 `writeFiles` 或工作区级占用冲突。
- 冲突时提示用户选择：
  - 等待当前任务完成。
  - 只读运行。
  - 人工确认仍继续。

第一版不做跨进程锁，不写复杂 lock file，避免引入恢复和清理问题。

## 5. UI 设计建议

### 5.1 输入区增加轻量“Loop 运行级别”

位置：Loop 模式底部设置区域，靠近执行方式选择。

控件：

```text
运行级别：[只读报告 L1] [辅助修改 L2]
```

说明：

- 默认建议为 `辅助修改 L2`，保持当前用户习惯。
- 用户选择 `只读报告 L1` 时，发送按钮仍启动 Loop，但主任务只能分析和报告。
- 高风险路径或空写入范围时，可自动降级为 L1 并提示。

### 5.2 群聊面板增加“运行概览”

在时间线前增加折叠区：

```text
运行概览
- 级别：辅助修改 L2
- 目标：...
- 当前轮次：3 / 20
- 子任务：2 running, 5 completed
- 最近验证：npm run build passed
- 待人工处理：无
- 预算：本轮 2/6 子任务，重试 0/5
```

该区域只展示摘要，不替代现有时间线。

### 5.3 `needs-review` 需要展示明确原因分类

目标系统的失败模式分类值得参考。本插件可以把 `needs-review` 原因标准化：

| 原因 | 说明 |
| --- | --- |
| `main_ai_failure_limit` | 主任务连续失败达到上限 |
| `subtask_retry_limit` | 子任务重试达到上限 |
| `boundary_violation` | 写入范围或权限越界 |
| `verification_failed` | 验证命令失败 |
| `debate_blocked` | 红蓝辩论存在阻塞性异议 |
| `ambiguous_scope` | 需求或范围不足以继续自动执行 |
| `budget_exceeded` | 轮次、子任务数或运行时间超限 |

这样用户不需要从长日志中猜任务为什么停下。

## 6. 数据模型增量建议

在 `LoopTaskRecord` 中增量加入可选字段，保持旧任务兼容：

```ts
type LoopLoopLevel = "report" | "assisted";

type LoopNeedsReviewReason =
  | "main_ai_failure_limit"
  | "subtask_retry_limit"
  | "boundary_violation"
  | "verification_failed"
  | "debate_blocked"
  | "ambiguous_scope"
  | "budget_exceeded";

interface LoopTaskRecord {
  loopLevel?: LoopLoopLevel;
  loopBudget?: LoopLoopBudget;
  needsReviewReason?: LoopNeedsReviewReason;
  needsReviewDetail?: string;
  stateSummaryFile?: string;
  runLogFile?: string;
}
```

兼容规则：

- 旧任务缺少 `loopLevel` 时按 `assisted` 处理，以维持现有行为。
- 旧任务缺少 `loopBudget` 时从全局工具设置和常量推导。
- `runLogFile` / `stateSummaryFile` 缺失时按 taskId 默认路径生成。

## 7. Prompt 协议增量建议

主任务 prompt 中新增明确运行级别约束：

```text
当前 Loop 运行级别：L1 只读报告。
你只能分析、整理问题、提出计划和风险。
不得输出 status=continue 且不得派发会修改文件的 subtasks。
如果需要修改代码才能完成目标，请输出 blocked，并说明需要用户切换到 L2 辅助修改。
```

L2 则要求：

```text
当前 Loop 运行级别：L2 辅助修改。
你可以派发子任务，但每个子任务必须声明 writeFiles 或明确说明只读。
不得让子任务修改未声明范围。
如果任务需要触碰 denylist 或高风险动作，输出 blocked，并说明人工确认项。
```

Verifier 约束：

```text
最终 completed 前必须说明：
1. 哪些验证命令已运行。
2. 哪些变更文件已检查。
3. 哪些用户成功标准已覆盖。
4. 是否存在未解决风险。
```

## 8. 与现有边界契约设计的关系

`docs/LOOP_BOUNDARY_CONTROLS.md` 已经提出 `boundaryContract`，本设计不替代它，而是把目标系统的 Loop 运行思想补充进去：

- `boundaryContract` 解决“能做什么、不能做什么、何时问用户”。
- `loopLevel` 解决“当前 Loop 被授权到什么成熟度和动作级别”。
- `loopBudget` 解决“最多运行到什么程度必须停”。
- `run-log.jsonl` 解决“每轮做了什么，可不可观测”。
- `state.md` 解决“当前状态能否被人和下一轮快速理解”。
- `needsReviewReason` 解决“为什么停下，下一步该谁处理”。

建议实施顺序是：

1. 先做 `loopLevel + loopBudget + needsReviewReason`。
2. 再做 `run-log.jsonl + state.md`。
3. 再把 `boundaryContract` 的机器校验接入派发前和执行后检查。

## 9. 验收标准

第一阶段完成后应满足：

- 新建 Loop 任务记录包含运行级别和预算字段。
- L1 任务不会派发写入型子任务。
- L2 子任务缺少 `writeFiles` 时，主任务或扩展能给出明确提示或进入人工复核。
- 任务进入 `needs-review` 时有标准化原因。
- 每个 Loop 任务都有可读的状态摘要或追加式运行日志。
- 群聊面板能展示运行概览，不需要用户翻完整 transcript 才知道任务状态。
- 旧任务仍可读取、恢复和完成。

建议验证：

```bash
npm run build
node --test dist/test/loopParallel.test.js dist/test/loopDebate.test.js dist/test/loopMainFailure.test.js
```

若新增纯函数模块，应补充对应单测，例如：

- `loopLoopBudget.test.ts`
- `loopRunLog.test.ts`
- `loopStateSummary.test.ts`

## 10. 结论

目标系统最值得参考的不是定时任务或自动化工具本身，而是它把 Loop 设计成控制系统的方式：

- 分级放权。
- 状态先行。
- 预算前置。
- 日志可观测。
- maker/checker 分离。
- denylist 和人工 gate 明确。
- 多 Loop 冲突可协调。
- 失败原因可分类、可复盘。

本插件已经有较强的多智能体 Loop 执行基础，最适合局部借鉴的方向是：在现有 `loop` 任务记录和群聊体系上补齐 `运行级别 + 预算 + 状态摘要 + run log + 标准化 needs-review`。这能明显提升 Loop 的可控性和可复盘性，同时避免过早引入定时后台运行、自动 PR、自动合并或强制 worktree 等高风险能力。
