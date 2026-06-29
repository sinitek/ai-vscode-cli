# 龙虾红蓝辩论多智能体模式详细设计

- 状态：active
- 相关计划：`.ch/docs/exec-plans/completed/2026-06-16-lobster-debate-chat-mode.md`、`.ch/docs/exec-plans/completed/2026-06-16-lobster-debate-session-tabs.md`
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
- 只有主任务最终返回 `status=completed`，且 AI 对话主消息流同时存在 `lobsterAnswerConclusion=true` 的问题回答结论气泡和 `lobsterFinalSummary=true` 的最终总结气泡，任务才真正完成；最终总结气泡仍需要同时展示 `answerConclusion` 问题回答结论和整体任务总结。

这个模式的问题不在子任务执行，而在规划和复核决策仍由一个主任务单点完成。复杂任务里，单个主任务容易出现三个问题：

- 规划视角不足：只从一个思路拆任务，容易漏掉架构、测试、风险、用户体验或兼容性维度。
- 过早收敛：主任务可能直接派发自己认为合理的子任务，缺少异议和交叉质询。
- 验收偏置：后续复核也可能沿用最初方案的假设，遗漏“这个方案本身是否成立”的审查。

因此新增的“辩论多智能体”不应重写子任务执行系统，而应替换“主任务单独规划/复核”这个决策阶段。当前实现已升级为红蓝对抗语义：蓝队提出、捍卫和修正方案，红队从反方视角攻击假设、覆盖、证据和可验证性，裁判主持人负责控场和收束；红蓝对抗不限于代码任务。

## 目标

新增一个龙虾模式内的执行方式：`红蓝辩论多智能体`（内部值仍为 `debate_multi_agent`）。

目标行为：

- 用户仍然选择顶层 `龙虾` 模式。
- 龙虾模式下的执行方式可选：
  - `主从多智能体`：沿用当前主任务单独规划，再派发子任务。
  - `红蓝辩论多智能体`：蓝队提出可执行方案，红队攻击方案假设、证据和边界并暴露风险，裁判主持人收束后形成一致结论，再派发子任务。
- 红蓝辩论只发生在规划和复核决策阶段。
- 红蓝辩论形成的最终规划仍输出为现有龙虾主任务 JSON 决策。
- 子任务派发、并发冲突规划、子任务重试、沟通文件、最终总结气泡、任务保留清理，尽量复用现有链路。

成功标准：

- 规划不是由单个主任务直接给出，而是至少 1 个蓝队参与者和 1 个红队参与者在共享 `chat.md` 群聊记录里攻防；蓝队必须回应红队攻击，红队必须攻击蓝队方案。
- 每一轮派发子任务前，都能在沟通目录中找到对应的辩论记录和共识摘要。
- 只有不存在阻塞性异议时，才允许派发子任务或标记完成。
- 如果无法达成一致，任务进入 `needs-review`，而不是静默选择某一方观点继续执行。

## 非目标

第一阶段不处理以下内容：

- 不新增顶层交互模式。当前 AI 对话面板顶层只暴露 `coding / lobster`，旧 `plan` 配置按 `coding` 兼容归一化。
- 不重写子任务执行器。`runLobsterSubtasksBatchWithRetry` 和 `lobsterParallel` 规划规则继续复用。
- 不实现真正跨进程、跨机器或远端服务的多智能体系统。
- 不要求 Claude 分组接入插件侧模型选择。Claude 仍沿用 CLI 默认模型或用户命令参数。
- 不让辩论参与者直接修改工作区内容、任务记录或非指定沟通文件。辩论参与者只允许读上下文并写指定 artifact。
- 不在第一阶段做复杂可视化图谱。主面板先展示辩论启动、共识和派发摘要；内容区提供只读模拟群聊面板，读取 `chat.md` 和 `debateRounds` 中的角色 sessionId 做可视化与排障。

## 术语

| 术语 | 含义 |
| --- | --- |
| 龙虾执行方式 | 龙虾模式内部的二级模式，不等同于顶层 `interactiveMode` |
| 主从多智能体 | 当前模式。主任务单独规划和复核，子任务执行具体工作 |
| 红蓝辩论多智能体 | `debate_multi_agent` 当前用户可见语义。蓝队提出和修正方案，红队攻击方案假设、证据和边界，裁判主持人收束后输出同样的龙虾主任务决策 |
| 蓝队参与者 | 提出、捍卫和修正方案，明确目标、约束、验收口径和证据要求，并回应红队质疑的参与者 |
| 红队参与者 | 攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性的参与者；仅任务涉及代码、文件、权限、部署或流程执行时才额外检查写入范围、并发冲突、越权修改、回滚/恢复失败等工程风险 |
| 裁判主持人 | 扩展启动的控场角色，负责红蓝组队、总结攻防、判断 continue / finalize / block |
| 辩论参与者 | 只参与规划、质询、验收判断的智能体，不直接修改工作区内容；当前新建清单 role 只能是 `blue_team` 或 `red_team` |
| 辩论协调器 | 扩展侧编排角色，负责启动红蓝参与者、收集产物、检查共识，不作为独立的“最终拍板主任务” |
| 共识摘要 | 多个参与者达成一致后的结构化结论，是生成 `subtasks` 或 `completed` 决策的依据 |
| 阻塞性异议 | 参与者认为当前方案会导致目标无法满足、证据不足、不可验证、风险不可接受或工程执行冲突，且没有被解决 |

## 现状约束

### 运行时约束

- 当前龙虾任务记录类型只有 `main` / `subtask` 两类角色。
- 当前主任务 JSON 解析集中在 `parseLobsterMainDecision`、`normalizeLobsterMainDecision`、`applyLobsterMainDecision`。
- 当前子任务批次最多 `LOBSTER_PARALLEL_SUBTASK_MAX = 6`。
- 当前龙虾最大主任务复核轮次由项目级设置控制，默认 20。
- 当前子任务失败会 1 分钟后自动重试，最多 5 次。
- 任务记录和沟通目录有 30 天保留清理。

### UI 约束

- 顶层模式选择为 `编码 / 龙虾`。
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
- 至少经过“主持人指定首批发言”和“主持人继续点名/最终立场”两个群聊阶段。
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

- `红蓝辩论多智能体` 是龙虾模式下的执行方式，不是新的顶层 `InteractiveMode`；内部协议值仍是 `debate_multi_agent`。
- 红蓝辩论只替代主任务规划/复核阶段。
- 红蓝辩论完成后必须生成现有龙虾主任务 JSON 决策。
- 子任务执行链路保持不变。
- 每个龙虾任务创建时固化执行方式，恢复任务时以任务记录为准。

## 用户体验设计

### 面板控件

龙虾模式下底部区域展示：

```text
[执行方式: 主从多智能体/红蓝辩论多智能体] [主任务模型] [子任务模型] [思考模式]
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
- `红蓝辩论多智能体`
- `龙虾执行方式`
- `红蓝对抗已启动`
- `红蓝对抗共识已形成`
- `红蓝对抗达成阻塞共识，已进入人工复核`
- `红蓝对抗未达成一致，已进入人工复核`

英文：

- `Main/Sub Multi-Agent`
- `Red/Blue Debate Multi-Agent`
- `Lobster execution mode`
- `Red/Blue debate started`
- `Red/Blue consensus reached`
- `Red/Blue debate reached a blocking consensus. Manual review is required.`
- `Red/Blue debate did not reach consensus. Manual review is required.`

### 运行状态消息

主任务标签中展示简明系统消息：

```text
🦞 辩论主持人正在设计参与者：第 1 轮
🦞 辩论参与者已动态加入：第 1 轮，3 个参与者
🦞 辩论群聊已启动：主任务第 1 轮，3 个参与者，主持人控场，最多 N 个发言批次安全上限
🦞 辩论群聊发言开始：主任务第 1 轮，发言批次 1/N，主持人已点名发言者，本批次结束后由主持人判断是否继续
🦞 辩论最终立场已收集：主持人动态选定的参与者
🦞 辩论共识已形成：派发 3 个子任务，预计剩余 2 轮
```

如果失败：

```text
🦞 辩论达成阻塞共识，已进入人工复核：第 5 轮
🦞 辩论未达成一致：存在阻塞性异议，已进入人工复核
```

完整内容落盘到沟通目录，主面板展示摘要和路径；辩论任务启动气泡会立即显示“打开龙虾群聊”入口，按气泡内 `taskId` 打开对应内容区面板。命令 `sinitek-cli-tools.openLobsterDebateChat` 保持兼容命名，也可手动打开只读模拟群聊面板。辩论任务的同一个面板合并展示规划复核阶段的 `debates/round-*/chat.md` 和共识通过后的根部 `group-chat.md`，不再按轮次分区；主任务轮次、发言批次和执行阶段只作为系统消息呈现。群聊面板在同一 `lobsterTaskId` 存在运行进程时显示“中止”按钮，停止主持人、参与者、共识汇总器和共识通过后的执行子任务等相关运行；未完成且无运行进程时才显示“继续执行”按钮，两者互斥。任务进入 `needs-review` / `error` / `stopped` 时，面板会在时间线末尾追加一条虚拟的 `主持人停止说明` error 样式气泡，用 `finalSummary`、共识摘要和决策状态说明停止原因；该气泡不写回原始 transcript。面板根据任务记录中的 `activeSpeaker` / `activeSubtaskId` / `activeSubtaskIds` 在时间线末尾显示当前参与者、主持人、共识汇总器、主任务或子任务“思考中”等待气泡；角色发言、主持人控场、共识状态或子任务状态落盘后主动刷新已打开面板，5 秒自动刷新只作为兜底；若刷新前滚动位置距离底部不超过 50px 会自动跟随最新气泡，否则保留阅读位置并显示置底按钮。内容区页面保持只读，不再提供“打开 transcript”“打开任务记录”按钮。

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
  sessionId?: string | null;
  summary?: string;
  stance?: "agree" | "agree_with_reservations" | "block";
  blockingIssues?: string[];
  updatedAt: number;
};

type LobsterDebateModeratorDecisionRecord = {
  artifactFile: string;
  dialogueTurn: number;
  action: "continue" | "finalize" | "block";
  reason: string;
  nextFocus: string[];
  sessionId?: string | null;
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
  chatFile?: string;
  dialogueTurns?: number;
  participants: LobsterDebateParticipantRecord[];
  moderatorDecisions?: LobsterDebateModeratorDecisionRecord[];
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
├── group-chat.md
├── debates/
│   └── round-<lobsterRound>/
│       ├── brief.md
│       ├── chat.md
│       ├── participants/
│       │   ├── architecture-turn-<n>.md
│       │   ├── implementation-turn-<n>.md
│       │   ├── testing-turn-<n>.md
│       │   ├── risk-turn-<n>.md
│       │   ├── moderator-turn-<n>.md
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
- `chat.md`：扩展维护的模拟群聊 transcript。参与者和主持人不直接写该文件；每个角色 artifact 完成后由扩展按顺序追加。
- `group-chat.md`：共识通过后复用主从执行链路维护的任务执行群聊 transcript；主任务决策、子任务加入、子任务完成后的最终回复和批次完成会追加到这里，并在同一龙虾群聊面板中按时间线继续展示；运行状态与验证依据仍保留在任务记录和子任务沟通文件中。
- `participants/*-turn-<n>.md`：第 n 个发言批次的角色发言，供下一位角色和主持人读取。
- `participants/moderator-turn-<n>.md`：第 n 个发言批次的主持人控场 artifact，必须输出 `continue / finalize / block`。
- `participants/<role>.md`：主持人收束后每个参与者写出的最终立场，供共识校验读取。
- `cross-review.md`：共识汇总器基于完整群聊时间线写出的质询摘要。
- `consensus.md`：自然语言共识结论，必须列出一致意见、保留意见、已解决分歧、未解决分歧。
- `decision.json`：最终要交给现有龙虾链路解析的 JSON 决策。

保留策略：

- 与现有 `lobster-communications` 目录共用 30 天保留清理。
- 删除任务沟通目录时，辩论目录一起删除。

## 辩论参与者设计

辩论模式先由主持人根据原始目标、任务记录和沟通文件设计动态参与者清单，再开始群聊发言。运行时要求主持人输出 `moderator-participants.md`，参与者数量为 2-6 个；扩展校验 id 唯一、role 合法、title/focus 非空后，把这些参与者追加为 `## 参与者加入：...` 群聊事件。后续发言、最终立场、共识汇总和恢复校验都以这份动态清单为准，不再使用固定 4 人兜底。

主持人可参考的红蓝参与者原型：

| 参与者 | 职责 | 必须回答的问题 |
| --- | --- | --- |
| 蓝队方案方 | 提出可执行方案，明确目标、约束、成功标准，并主动回应红队质疑 | 当前最可行的方案是什么？依赖、阶段和验收证据是什么？ |
| 红队攻击方 | 攻击方案假设、目标覆盖、证据链、边界场景、可行性和可验证性 | 哪些假设可能错？哪些目标或证据缺口会导致方案不可接受？ |
| 蓝队验证方 | 把蓝队方案补成可验收计划，定义验证方法、证据口径、回退或替代方案 | 如何证明方案成立？哪些保留意见可转为验收标准或前置步骤？ |
| 红队边界方 | 从边界条件、反例、安全/合规/伦理、成本和长期影响角度继续挑战蓝队方案 | 哪些极端场景、反例或长期影响会推翻当前方案？ |

另有一个主持人控场角色：

| 角色 | 职责 | 必须回答的问题 |
| --- | --- | --- |
| 主持人控场 | 在每个发言批次后总结争议、判断是否继续追问、收束或阻塞 | 是否还存在会影响派发决策的未回答问题？继续讨论能否降低风险？当前是否已经足够进入最终立场？ |

动态 role 支持 `architecture`、`implementation`、`testing`、`risk`、`product`、`security`、`data`、`ux`、`documentation` 和 `custom`。主持人可按任务需要组合，例如 UI 任务加入产品体验/UX，权限任务加入安全，数据库任务加入数据迁移。

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
  → 构造辩论 brief 和 chat.md
  → 主持人先设计 2-6 个动态参与者并写入 moderator-participants.md
  → 扩展把动态参与者加入 chat.md
  → 同批次动态参与者并行发言，各自写独立 artifact
  → 扩展等待本批次全部 artifact 完成后按清单顺序追加 chat.md
  → 主持人读取完整群聊并决定 continue / finalize / block
  → 如 continue 且未达到安全上限，追加下一轮发言
  → 如 finalize，收集动态参与者最终立场
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
- 明确约束：主持人先写动态参与者清单并指定首批发言者；参与者只读仓库和任务记录，只写自己的本轮 artifact；`chat.md` 只由扩展追加；每个发言批次只有被主持人点名的 1-3 位参与者可发言。
- 明确主持人控场规则：每个发言批次后由主持人输出 `continue / finalize / block`；`continue` 时必须指定下一批发言者，最大发言批次数只是安全上限。

### 阶段 2：受控群聊发言

扩展创建 `chat.md`，记录群聊规则、主持人动态选角规则、主持人控场规则和最大安全上限。随后主持人写入 `moderator-participants.md`，扩展把动态参与者作为 `## 参与者加入：<title>（<id>）` 追加到群聊记录。

运行时按主持人决策推进：

- 第 1 个发言批次：主持人在 `moderator-participants.md` 中额外指定 `openingSpeakerIds` 作为首批点名发言者，通常由蓝队先开场。
- 第 n 个发言批次：扩展先追加 `## 任务事件` 系统消息说明主任务轮次、当前发言批次、最大安全发言批次数和本批次被点名的发言者；只有主持人点名的 1-3 位参与者进入本批次，可并行运行；每个参与者读取当前 `chat.md` 后写入独立的 `participants/<id>-turn-<n>.md`，扩展等待全部 artifact 完成后再按点名顺序以 `## 发言：...` 追加到 `chat.md`。
- 第 n 个发言批次的主持人控场：主持人读取完整 `chat.md`，写入 `participants/moderator-turn-<n>.md`，并输出 `continue / finalize / block`。
- `continue`：主持人必须列出下一批次关注点和 1-3 个 `nextSpeakerIds`；若未达到最大安全发言批次数，扩展只唤醒这些被点名角色进入下一个发言批次。
- `finalize`：扩展停止追加普通发言批次，改为让动态参与者读取完整 `chat.md` 和主持人控场摘要，写入最终 `participants/<id>.md`。
- `block`：扩展仍收集最终 `participants/<id>.md` 作为审计材料，然后写入 `## 群聊收束` 并进入 `needs-review`。

达到最大安全发言批次数时，如果主持人仍输出 `continue`，运行时写入“运行时强制收束”记录并进入最终立场收集。模型不得要求超过安全上限继续讨论；如果仍有未解决分歧，后续只能通过 `blocked / needs-review` 暴露给人工。

最终参与者 artifact 必须要求输出结构：

```md
# 角色结论

## 群聊发言

...

## 点名回应

...

## 追问或修正

...

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
- 参与者不能修改工作区内容、任务记录或非指定沟通文件。
- 参与者必须写入自己的 artifact 文件。
- 如果发现不能继续，必须用 `block` 并列出阻塞性异议。

### 阶段 3：共识汇总

共识汇总步骤负责把辩论结果转成最终决策。

它不是“主任务单独规划”，而是受约束的汇总器：

- 必须读取 `brief.md`、`chat.md` 和所有最终 `participants/<role>.md`。
- 必须在 `cross-review.md` 中按群聊时间线总结关键发言和互相回应。
- 必须在 `consensus.md` 中逐条引用各参与者最终观点。
- 必须列出共识后的最终 `participantStances`。
- 如果存在任何 `stance=block` 且未解决，不能派发子任务。
- 如果参与者原始 artifact 为 `block`，但阻塞点可以通过前置子任务、验收标准或风险说明解决，共识汇总器必须把该阻塞点写入 `resolvedDisagreements`，并可把该参与者最终立场标为 `agree_with_reservations` 后继续。
- 如果所有参与者 `agree` 或 `agree_with_reservations`，且保留意见已进入风险说明或验收标准，可以输出 `status=continue` 或 `status=completed`。
- 输出的 `decision.json` 必须仍符合现有 `LobsterMainDecision` 协议。
- 不允许要求继续辩论；`chat.md` 已由主持人收束后仍不确定时，必须走 `blocked`。

共识达成的最低条件：

- 至少所有动态参与者都完成。
- 没有未解决的阻塞性异议。
- 原始用户需求都能映射到后续子任务或完成验收项。
- `subtasks[*].prompt` 自包含。
- 涉及多个工程子任务并发时，必须声明 `writeFiles` 或 `conflictGroup`，并说明不会冲突。

### 阶段 4：复用现有执行

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
      { "participantId": "blue_planner", "stance": "agree" },
      { "participantId": "red_attacker", "stance": "agree_with_reservations", "note": "需要补充证据链和边界验收" },
      { "participantId": "blue_verifier", "stance": "agree" },
      { "participantId": "red_edge_cases", "stance": "agree" }
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
  "parallelReason": "UI、协议类型、文档同步的预期写入文件互不重叠，可以并发。",
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
你是龙虾模式“红蓝辩论多智能体”中的一个红队或蓝队参与者。
你不是执行子任务的智能体。
你只能读取可用上下文、仓库、任务记录和沟通文件；只能写入指定辩论 artifact，不能修改工作区内容、任务记录或非指定沟通文件。
你必须读取 chat.md 中已有群聊发言，把自己的下一条发言写入指定辩论文件。
你的职责是在裁判主持人控场下提出观点、点名回应对方、发现风险，并在主持人收束后给出是否同意继续的最终立场。
蓝队负责提出、捍卫和修正方案；红队负责攻击假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性。
如果存在硬性目标遗漏、证据不足、不可验证、不可接受风险或错误依赖，必须标记为 block；只有工程执行任务才把文件冲突、越权修改、恢复失败等工程风险作为阻塞项。
```

### 主持人控场约束

```text
你是龙虾模式“辩论多智能体”的主持人控场。
你必须读取完整 chat.md，总结当前共识、争议和未回答问题。
每个发言批次只能输出 continue / finalize / block 之一。
continue 表示仍有明确、可回答、会影响派发决策的问题，需要追加下一个发言批次。
finalize 表示讨论已经足够，应收集最终参与者立场并进入共识汇总。
block 表示当前讨论无法形成安全、可执行、可验收的自动化决策，必须进入人工复核。
达到最大安全发言批次数时，不得继续要求追加发言，只能 finalize 或 block。
```

### 蓝队方案方重点

```text
重点提出可执行方案，并明确目标、约束、阶段、依赖和成功标准。
必须主动回应红队攻击点，把可修正问题转成方案调整、前置步骤或验收证据。
```

### 红队攻击方重点

```text
重点攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性。
只有任务涉及代码、文件、权限、部署或流程执行时，才额外检查写入范围、并发冲突、越权修改、回滚/恢复失败和工程验收风险。
```

### 蓝队验证方重点

```text
重点把方案补成可验收计划。
必须列出完成判断、验证方法、证据口径、保留意见和必要的回退或替代路径。
```

### 红队边界方重点

```text
重点从边界条件、反例、安全/合规/伦理、成本和长期影响角度继续挑战方案。
只要发现会导致目标无法满足、不可验证或风险不可接受的缺口，必须给出 block。
```

### 共识汇总约束

```text
你是辩论结果汇总器，不是单独规划者。
你必须基于完整 chat.md 和所有最终参与者产物形成共识。
如果存在未解决的 block，返回 status=blocked。
如果 block 已被转化为自包含前置子任务、验收标准或风险说明，记录到 resolvedDisagreements 后可以继续。
chat.md 已包含主持人控场与收束标记，不允许要求继续辩论。
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

运行时复用现有对话 tab 基础设施，不新增 `taskRole=debate`。

运行规则：

- 每次角色发言创建一个临时普通 tab。
- 普通发言批次写入 `participants/<role>-turn-<n>.md`；主持人控场写入 `participants/moderator-turn-<n>.md`。
- 主持人输出 `finalize`、`block` 或运行时达到最大安全发言批次数后，参与者再写入最终 `participants/<role>.md`。
- 同一批次内参与者 artifact 可并行生成；扩展等待本批次全部完成后统一追加到 `chat.md`，而不是让参与者直接写 transcript。
- 成功完成后可自动关闭临时 tab，但必须先持久化 artifact。
- 主任务或任一 debate/subtask 仍运行时，主任务 tab 禁止关闭。
- debate tab 手动继续时强制按 coding 普通任务执行，禁止嵌套启动龙虾任务。

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
- 当前轮存在完整 `chat.md`，且包含主持人控场与 `## 群聊收束` 标记。
- 至少存在一个合法 `participants/moderator-turn-<n>.md` 控场 artifact。
- `openDisagreements` 不存在 `severity=blocking`。
- 共识后的 `participantStances` 中不能出现未解决的 `block`。
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
- `main-task.md` 追加失败原因；如果 `consensus.md` 已达成但包含未解决阻塞，还要记录“辩论达成阻塞共识”、共识摘要、`decision.finalSummary` 和 `estimatedRemainingRounds`。
- 主面板展示“辩论达成阻塞共识”或“辩论未达成一致”。

### 恢复任务

恢复规则：

- 继续使用任务记录里的 `executionMode`。
- 如果上一轮 debate 已经完成，且存在完整 `chat.md`、主持人控场、最终 participant artifacts、`cross-review.md`、`consensus.md` 和 `decision.json`，恢复时优先解析该 decision，避免重复辩论。
- 如果上一轮 debate 缺少共识、主持人控场或任一参与者 artifact，重新执行该 debate round。
- 如果旧产物来自非群聊版本或固定两轮版本，缺少 `chat.md`、主持人控场或收束标记，恢复时重跑当前辩论轮。
- 已完成任务缺失 `lobsterAnswerConclusion=true` 问题回答结论气泡、缺失 `lobsterFinalSummary=true` 最终总结气泡，或最终总结气泡缺少问题回答结论展示时，仍沿用现有自动恢复最终消息机制。

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
| 最终完成判定 | `completed` + 独立问题回答结论气泡 + 含问题回答结论和整体总结的 final summary 气泡 | 相同，且要求共识无阻塞异议 |
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
4. 检查 `lobster-communications/<taskId>/debates/round-1/` 下生成 `brief.md`、`chat.md`、`participants/*-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/<role>.md`、`cross-review.md`、`consensus.md`、`decision.json`。
5. 检查共识后仍按现有 `subtasks` 启动子任务。
6. 子任务完成后唤醒下一轮辩论复核。
7. 最终完成时 AI 对话主消息流仍出现 `lobsterAnswerConclusion=true` 的问题回答结论气泡和 `lobsterFinalSummary=true` 的最终总结气泡，且最终总结气泡内同时包含问题回答结论和整体任务总结。

### 回归验证

- `npm run build`
- 现有 `lobsterParallel` 单元测试
- 人工验证主从多智能体不受影响
- 人工验证 Claude 下执行方式可见，但模型选择仍隐藏

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 辩论成本过高 | 用户等待时间变长 | 主持人按任务动态选择 2-6 个参与者，并决定是否继续；最大安全发言批次数兜底防无限循环 |
| 辩论无法达成一致 | 自动任务停滞 | 明确进入 `needs-review`，保留完整分歧记录 |
| 参与者误改工作区 | 破坏用户文件或任务记录 | prompt 明确只写指定 artifact；后续可在 debate run 前后做 git diff 检查 |
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
- 主持人先写入动态参与者清单并指定首批发言者；之后每个发言批次都由主持人显式点名 1-3 位发言者进入本批，扩展按点名顺序追加 `chat.md` 后再启动主持人控场，由主持人决定继续、收束或阻塞。
- 实现共识汇总，输出 `decision.json`。
- 成功后复用 `applyLobsterMainDecision`。

### 第三阶段：校验和恢复

- 校验共识与决策一致性。
- 支持 debate round 恢复。
- debate tab 自动关闭和主 tab 锁定。
- 增加单元测试和手工验证脚本说明。

### 第四阶段：体验增强

- 内容区只读模拟群聊面板：读取 `chat.md` 与 `debateRounds`，按微信群式时间线展示参与者发言、主持人控场、最终立场、收束状态和各角色 sessionId；运行中读取 `activeSpeaker` 显示“思考中”等待气泡，并在角色产物或状态落盘后主动刷新，5 秒自动刷新作为兜底；刷新前距离底部 50px 内自动跟随最新气泡，否则显示置底按钮；不直接写任务记录或追加辩论消息。
- 支持用户配置辩论参与者数量偏好。
- 支持选择辩论模型角色。
- 支持展开查看辩论摘要。
- 支持任务类型自动选择参与者角色。

## 接受标准

第一版实现完成时必须满足：

- 龙虾模式中可选择 `主从多智能体` 或 `红蓝辩论多智能体`。
- 新建任务记录能固化 `executionMode`。
- 选择 `主从多智能体` 时，现有行为不变。
- 选择 `红蓝辩论多智能体` 时，裁判主持人先设计 2-6 个动态参与者并指定首批发言者；新清单 `role` 只能是 `blue_team` 或 `red_team`，且至少包含 1 个蓝队和 1 个红队；每个发言批次都必须由主持人显式点名发言者，裁判主持人完成控场决策，且 `chat.md` 包含参与者加入、点名发言、主持人控场与收束标记。
- 派发子任务前必须存在 `consensus.md` 和 `decision.json`。
- 存在未解决阻塞性异议时不会派发子任务。
- 共识通过后，子任务执行仍复用现有批次并发逻辑。
- 最终完成仍要求 AI 对话主消息流同时存在 `lobsterAnswerConclusion=true` 和 `lobsterFinalSummary=true`。
- 文档、功能清单、构建验证全部完成。
