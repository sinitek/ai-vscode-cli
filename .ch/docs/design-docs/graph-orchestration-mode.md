# Graph 编排模式详细设计

- 状态：active（Phase 2 恢复与交互增强已落地）
- 日期：2026-07-23
- 相关计划：`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode-design.md`、`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode.md`
- 相关规格：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关目录：`src/graph/`、`src/extension.ts`、`src/sessionMessageActions.ts`、`src/sessionMessageHandlers.ts`、`src/panelDiagnostics.ts`、`src/webview/`、`src/i18n.ts`

## 背景

当前插件已经有 `Vibe / Loop` 两类顶层交互模式，并且 Loop 模式内部已经支持 `main_sub_multi_agent` 主从多智能体、`debate_multi_agent` 红蓝辩论多智能体、子任务并发、写入冲突分组、睡眠唤醒、群聊补充和人工复核。Loop 不是简单 while 循环，但它的核心仍是“主任务每轮返回决策，宿主按轮次派发子任务，再唤醒主任务复核”的回合状态机。

用户提出的 Graph 模式不是 CodeGraph、知识图谱、代码调用图，也不是直接采用 LangGraph 框架。这里的 Graph 来自近期 vibe coding / agentic coding 语境：把自然语言目标、多个 agent、工具步骤、人工关卡、验证和返工路径组织成显式的可执行工作图。也就是说，Graph 的重点不是“更会搜代码”，而是“把一次复杂 AI 编程任务的执行拓扑显式化”。

## 当前已落地状态

截至 2026-07-24，Graph 已完成 Phase 1 最小运行内核、Phase 2 的可视 DAG / 持久化恢复 / 面板控制 / 睡眠唤醒增强、worktree checkpoint 增强、验证失败反馈回退，以及规划 DAG 的并行节点执行上下文派发；它仍不是完整 workflow 平台或图编辑器。当前能力边界如下：

- 用户可在主 Webview 输入区选择 `Graph` 模式并发送任务；前端 payload 保留 `interactiveMode=graph`，后端 `handleSendPromptMessage` 会进入独立 `runGraphPrompt` 分支，不走普通 coding 或 Loop 编排。
- 后端会先创建 planning-only Graph run，只包含保留 `plan` AI planner 节点；planner 必须在节点 `## JSON` 中返回 `plannedGraph.nodes` 和 `plannedGraph.edges`，宿主校验后把后续执行节点替换为 AI 规划的 realized DAG，再使用 `GraphRunStore`、`graph.json`、`events.jsonl` 和 `graph-communications/<graphRunId>/nodes/*.md` 落盘。
- `src/graph/` 已提供 v1 类型、store、communications、events、scheduler、prompt builders、node lifecycle 和 `tickGraphRun` kernel。Scheduler 支持依赖、终态、attempt、`human_gate` / `sleep` ready action、`writeFiles` 路径重叠、`conflictGroup` 和并发上限计算；扩展侧不再把 executor 固定为 1，而是按 `min(run.maxConcurrent, 6)` 执行 scheduler 选出的同批可运行节点。
- 扩展侧 Graph runtime 通过现有 `runPrompt` 执行节点，但每个 Graph run 会先创建独立 git worktree（`~/.sinitek_cli/graph-worktrees/<graphRunId>`），每个被调度的 Graph 节点还会创建独立 Graph 子任务 conversation tab。这里的“子任务 tab”只是节点执行容器，不是 Loop 主从智能体里的运行时主/从关系；主 Graph tab 负责记录调度和收束消息，节点 tab 负责运行对应节点。同一批互不冲突节点可并行运行且不会因为复用同一 tab 互相 stop。节点在该 worktree cwd 中运行；宿主在每个节点终止后创建本地 git checkpoint commit，并在 node record 中保存 `worktreeCwd`、`baseCommit`、`commit`。当整个 Graph run 进入 `completed` 时，宿主会把该 worktree 最终 HEAD 通过 `git merge --squash` 合回当前工作区分支，保留为未提交改动；目标工作区存在不相关未提交内容时仍让 Git 尝试合回，只有 worktree 缺失、Graph diff 会覆盖本地改动、发生冲突或其它合并失败时，run 才改为 `needs-review` 并记录失败原因。Graph node 执行记录仍携带 `graphRunId` / `graphNodeId` 元数据，用于可用场景下映射到当前 active CLI run。
- 每个后续派发的 Graph 节点 prompt 都会注入当前 `graph.json` 的全图拓扑、节点清单、边清单、当前位置、直接上下游、上游/下游链路、同批 active 节点、`writeFiles` / `conflictGroup` 冲突线索和下游 test/review/merge/summary 职责。这样实现节点知道图中已有后续测试或评审节点时，只完成自身 acceptance 和最小必要自检，不替代下游节点的完整验证、评审或最终总结。
- Graph 运行系统消息带 `openGraphRun` action；点击后打开独立 `GraphRunPanel`。当前 Graph tab 在会话标签上显示 `🗺️` 标识，active Graph tab 的底部运行状态行固定提供“打开 Graph 图”按钮，入口与 Loop 的“打开群聊”按钮同级。
- Graph 正式开始后，主 Graph tab 的视觉运行态跟随图级生命周期，而不是跟随某个节点 tab 的 CLI 进程生命周期；`running`、`sleeping`、`needs-review` 等未完成状态保持主 tab 运行中，只有图级 `completed`、`error` 或 `stopped` 才释放为非运行态。节点 tab 仍按各自 `runPrompt` 执行流独立开始和结束。
- `GraphRunPanel` 采用简化上下布局：上半区固定为 SVG edge / arrow + HTML node button 的真正可视 DAG，约占主体 50% 高度；节点矩形保持紧凑，只显示中文标题和轻量状态，类型、负责人、attempt、prompt/artifact/通信文件等正文细节只在下半区节点详情展示；下半区不再渲染 run 概览、状态统计、节点列表、recent events 或 finalAnswer 区块。
- `openGraphRun` 支持指定 `graphRunId` / `nodeId` 打开目标 run 和初始选中节点；未指定 run 时会按当前 workspace / CLI 从持久化 store 找最近 Graph run。坏 store 文件按 diagnostics 非阻塞展示，可读 run 仍可打开。
- `GraphRunPanel` 只渲染当前真实可用且已接通的控制：run 级 Continue / “我要说话” / Stop，node 级 Retry failed/blocked node、Feedback rollback / 回退上游返工、Approve human_gate。用户通过“我要说话”提交的补充消息会写入 Graph run 的 `supplementalRequirements`、主沟通文件和 events，并注入后续节点 prompt；该能力不承诺打断已经运行中的子节点。操作后刷新面板并保留可用 selected node。
- `GraphAutoWakeScheduler` 会在扩展激活和 workspace 变化时恢复 sleeping Graph run 的定时器；到期后复用持久化 run 继续 tick 并刷新已打开面板。
- 新增用户可见文案已进入现有 Webview / 后端 i18n 路径，中英文覆盖已通过相关测试。

已知限制同样是当前规格的一部分：

- 尚无图编辑器、模板库、拖拽 DAG、运行前人工调整或图 diff。
- 尚无完整 human gate 表单、审批说明采集或多步骤人工工作流；当前只支持已处于可批准状态的 `human_gate` 节点按钮推进。
- Retry 覆盖 failed / blocked 等可恢复节点：若节点记录了 `baseCommit` 且 run 有 worktree，宿主会在该独立 worktree 内 `reset --hard` 到节点执行前 checkpoint 并清理未跟踪文件，然后把节点重置为 pending。验证类节点（test/review/merge/human_gate/summary）failed 或 blocked 时，面板可触发 Feedback rollback：宿主优先按 active `review_feedback` / `if_fail` 边或上游依赖选择最近可回退工作节点，回滚到该上游节点的 `baseCommit`，并将该节点及其下游重置为 pending 后继续调度。
- 完成态合回不要求目标工作区完全干净；不相关 dirty 内容可与 Graph diff 同时存在，由 Git 原生 merge 检查决定是否能安全应用。合回不会自动提交、自动解决冲突或自动清理 worktree / Graph 分支。
- Stop 至少保证 Graph run / node 状态和事件落盘为 stopped；只有 active CLI run 已携带 `graphRunId` / `graphNodeId` 映射时才会同时尝试停止真实 CLI 进程，缺少映射时不会伪装为已杀掉外部进程。
- 尚未提供模板选择、AI 规划图生成前的用户确认、运行中即时打断重规划、局部返工路径编辑、自动生成修复分支或可复用流程资产。

## Graph 语义完成度矩阵

| 语义 | 当前状态 | 已完成 | 仍缺口 |
| --- | --- | --- | --- |
| 节点 | 已完成基础能力 | `GraphNodeRecord`、节点类型、状态生命周期、communication file、artifact/checkpoint、面板节点展示已落地 | 尚无图编辑器、模板库和节点级表单化配置 |
| 边 | 部分完成 | `GraphEdgeRecord`、planner materialize、可视 DAG 边、`depends_on` / `if_pass` / `if_fail` / `human_approved` / `evidence_for` / `conflicts_with` 类型已入模；active `review_feedback` / `if_fail` 可作为验证失败回退上游节点的优先目标 | 证据边和冲突边主要是记录/可视化信号；反馈边已有最小 rollback 控制，但尚无边编辑器、自动条件重算或可视反馈路径编辑 |
| 条件 | 部分完成 | Scheduler 已识别 active `if_pass` / `if_fail` 入边，并按源节点 `passed` / `failed` / `blocked` 状态决定是否 ready | 尚无复杂条件表达式、数据谓词、布尔组合、运行时重算条件或条件边编辑 |
| 依赖 | 已完成基础能力 | `dependsOn` 与 active `depends_on` 边共同决定 ready set；缺失依赖、未通过依赖会进入 blocker；Feedback rollback 会沿依赖图重置上游返工节点及下游节点 | 尚无跨图模板依赖、外部资源依赖和可编辑 descendant reset 预览 |
| 并发 | 已完成基础能力 | Scheduler 选择同批 ready nodes，扩展侧按 `min(run.maxConcurrent, 6)` 并行派发独立节点 tab | 尚无全局资源预算、跨进程队列、优先级和并发成本面板 |
| 冲突组 | 已完成基础能力 | `conflictGroup`、`writeFiles` 路径重叠和未声明写入范围可阻止同批/运行中冲突 | 只能做声明式与路径级冲突判断，尚无语义冲突检测、自动合并策略或冲突解释 UI |
| 人工关卡 | 部分完成 | `human_gate` 节点可进入 waiting，GraphRunPanel 提供 Approve 推进 | 尚无审批表单、风险说明、驳回原因、多人审批和人工步骤产物采集 |
| 重试 / 返工 | 部分完成 | failed/blocked 节点可 Retry；有 worktree/baseCommit 时可回滚到节点前 checkpoint 并重新调度；验证类节点可 Feedback rollback 到上游 checkpoint，并把上游节点及其下游重置为 pending | 尚无局部图编辑、条件边重规划、自动修复分支生成和可视 rollback 预演 |
| 睡眠 | 已完成基础能力 | `sleep` 节点支持 `wakeAt`、sleeping 状态、auto wake 恢复和到期继续 tick | 尚无日历式 UI、外部守护进程、跨设备唤醒和复杂等待条件 |
| 完成证据 | 部分完成 | 节点 `## JSON`、communication file、events.jsonl、artifactRef、checkpoint commit、summary finalAnswer 和完成态 merge-back event 构成证据链 | 尚无一等证据面板、证据边聚合视图、验收覆盖率检查和证据缺失自动阻断矩阵 |
| 节点全图感知 | 已完成基础能力 | 后续派发节点的 prompt 会包含全图拓扑、当前位置、上下游链路、并发/冲突提示和下游职责边界 | 已运行中的节点不会被即时打断重注入；后续仍可做运行中 replan / prompt diff / 用户确认 |

外部舆论和研究已经出现几条稳定信号：

- Vibe coding 实践手册把“workflow”和“agent”区分开：步骤可预知时应使用 workflow；路径未知时才使用 agent loop，并要求有独立 stop condition、状态文件和 maker-checker 验证。
- Agentic coding 讨论普遍承认底层是 prompt/context/plan/execute/test/refine 的 loop，但真正差异来自 loop 外围的 retrieval、tool use、planning、sandboxing、review 和 definition of done。
- 多 agent 同时修改同一项目时，问题不再是“单 agent 能不能继续 loop”，而是调度器、共享状态、依赖图、冲突隔离、合并验证和人工关卡。
- “Vibe Graphing”研究把自然语言意图编译成可编辑 workflow specification，再编译为 executable directed graph；这正好对应本设计里的 Graph 模式语义。
- 近期 benchmark 和 workflow 优化论文也开始区分 reusable template、run-specific realized graph、execution trace，说明 Graph 不只是 UI 图，而是可复盘、可优化、可比较的运行结构。

## 问题

Loop 模式解决的是“让一个主任务持续拆分、执行、复核，直到完成”。它适合目标逐步澄清、实施路径动态变化的任务。但当任务本身存在多个独立维度、明确依赖、互斥写入、评审关卡或可复用流程时，Loop 会暴露几个限制：

- 任务结构被折叠进主任务 prompt 和轮次记录，用户难以在运行前看到整体拓扑。
- 并发只发生在主任务当前返回的 `subtasks` 批次里，跨轮次依赖无法作为一等对象表达。
- 返工路径通常表现为“主任务再派一轮”，而不是“某个评审节点驳回某个实现节点并回连到修复节点”。
- 验收、人工批准、红蓝质询、测试、合并等不同性质的步骤都混在 Loop 轮次中，排障时需要阅读 transcript 才能还原结构。
- 多 agent 的成本、风险和依赖关系缺少可视化预算面，容易出现“看起来一直在忙，但不知道图上哪里卡住”。

Graph 模式要解决的是：在复杂任务开始前或首轮规划后，把工作拆成显式节点和边，由宿主按图调度、恢复、观察和收束。

## 目标

- 新增一个面向复杂任务的 Graph 编排模式设计，语义上区别于现有 Loop。
- Graph 能表达节点、边、条件、依赖、并发、冲突组、人工关卡、重试、睡眠和完成证据。
- Graph 不替换本地 CLI Runner；每个可执行节点继续通过现有 Codex / Claude / OpenCode 适配层运行。
- Graph 运行必须可恢复、可排障、可观察，状态落盘不依赖单个长上下文对话。
- Graph 先作为可版本化模板和运行图，不先做复杂低代码编辑器。
- Graph 设计必须明确何时比 Loop 更好，何时不该使用。

## 非目标

- 不把 Graph 等同于 CodeGraph、符号索引、调用图、知识图谱或 LangGraph 框架。
- 不在第一阶段引入远程控制面、云端队列、数据库服务或多机器调度。
- 不让用户上传任意脚本作为节点直接执行；节点执行仍走受控 CLI / prompt / 工具链路。
- 不重写 Loop 现有运行时、任务记录、红蓝辩论和群聊能力。
- 不把 Graph 未实现能力写入当前功能清单。
- 不承诺 Graph 在所有任务上都优于 Loop；小任务和探索性任务仍应优先 Loop 或 Vibe。

## 术语

| 术语 | 含义 |
| --- | --- |
| Graph 模式 | 显式构建并执行任务图的编排模式，节点是工作单元，边是依赖、条件、反馈、冲突或证据关系 |
| Loop 模式 | 当前主任务多轮决策、子任务派发、主任务复核的回合式多智能体模式 |
| Graph Template | 可复用的静态模板，定义某类任务的节点类型、边规则和验收关卡 |
| Realized Graph | 针对一次用户目标实例化后的运行图，可由模板、AI 规划或人工编辑产生 |
| Execution Trace | 运行过程中产生的事件流、节点结果、重试、人工输入和最终证据 |
| Node | Graph 中可调度或可观察的工作单元，例如规划、实现、测试、评审、人工批准、总结 |
| Edge | 节点之间的有向关系，例如 `depends_on`、`if_pass`、`if_fail`、`review_feedback`、`conflicts_with`、`evidence_for` |
| Scheduler | 宿主侧确定哪些节点 ready、哪些节点可并发、哪些节点必须等待或进入人工复核的组件 |
| Gate | 人工或机器验收关卡。Gate 不一定产出代码，但决定后续边是否可通行 |

## 当前 Loop 资产复用

Graph 第一阶段不应绕开现有能力，而应复用这些稳定资产：

- CLI 运行链路：继续使用 `src/cli/`、`src/interactive/` 和 `extension.ts` 中已有的 Codex / Claude / OpenCode 执行能力。
- 子任务隔离：复用 Loop 子任务临时根目录、规则隔离、`--ignore-rules`、Claude empty `settingSources`、OpenCode `--pure` 等边界。
- 并发冲突经验：复用 `writeFiles` / `conflictGroup` 语义，把它提升为 Graph 节点调度属性。
- 持久化经验：借鉴 `loop-tasks/` 和 `loop-communications/` 的工作区、CLI、session 维度隔离。
- 群聊和观察：复用当前“打开 Loop 群聊”的内容区面板经验，Graph 先做只读运行图和节点详情，不先做全功能编辑器。
- 最终答复约束：Graph 完成态仍必须生成用户可读结论、变更摘要、验证证据和未完成事项。

## 外部方案对比

| 方案 | 可借鉴点 | 不直接采用的原因 | 结论 |
| --- | --- | --- | --- |
| Mastra Workflows | 原生 TypeScript agent workflow，支持 sequential / parallel / branch / loop execution graph，步骤可调用 agent / tool，并支持状态持久化和可视化 | 面向 SDK 内 agent / tool 生态；本项目核心是驱动本地 CLI，不应把节点执行迁移到 Mastra agent 抽象 | 借鉴 graph vocabulary 和 studio 观察方式，不作为第一阶段运行内核 |
| Vercel AI SDK `WorkflowAgent` / `@ai-sdk/workflow` | 面向 agent 的 durability、tool approval、sandbox、telemetry；与 TypeScript AI 生态贴近 | 新能力仍偏 SDK / hosted workflow 语义，且当前项目已经接入 Codex / Claude / OpenCode CLI，不应把模型调用改成 AI SDK provider 调用 | 作为未来 provider-native agent 节点候选，不作为当前 CLI Graph 内核 |
| Inngest | Durable execution、step-level checkpoint、retries、waits、observability，适合长运行后台工作流 | 需要平台协调、serve/Connect 暴露函数；本插件是本地 VS Code extension，不应引入外部运行平台作为默认依赖 | 可借鉴 step checkpoint 和 wait 语义 |
| Trigger.dev | Open-source TypeScript AI workflow 平台，提供长期任务、重试、队列、human-in-the-loop、trace 和 self-host | 云 / self-host 平台心智过重，且会改变本地插件边界和部署模型 | 可借鉴 run visibility、human waitpoint、idempotency 和 versioning |
| OpenWorkflow | TypeScript durable workflow，PostgreSQL / SQLite 保存状态，worker replay 已完成 steps | 仍需要新增 worker/backend 存储层；项目当前只需本地文件状态即可满足第一阶段 | 第二阶段可评估作为可嵌入 durable backend |
| XState / Stately | JavaScript / TypeScript state machine、actor model、可视化、可序列化 snapshot；`@statelyai/agent` 强调 machine decides, host executes | XState 表达有限状态和 actor 很强，但复杂 DAG 调度、节点产物、并发资源锁仍要自建；`@statelyai/agent` 仍是 alpha | 可用于单节点状态机或 Graph scheduler 状态建模，但第一阶段不强依赖 |
| Temporal TypeScript SDK | 最成熟的 durable execution / replay / activity 模型之一 | 引入服务、worker、队列和部署模型，远超本地插件第一阶段需要 | 不采用；只借鉴 durable history 和 activity/retry 术语 |

推荐：第一阶段自建一个小而明确的本地 `GraphKernel`，以 JSON graph + JSONL event log + 现有 CLI runner 为核心，不新增外部运行时依赖。后续如果 Graph 需要长时间后台任务、跨进程 worker 或数据库级恢复，再单独评估 OpenWorkflow / XState / Inngest / Trigger.dev。

## 数据模型设计

### GraphRunRecord

```ts
type GraphRunStatus =
  | "draft"
  | "running"
  | "sleeping"
  | "needs-review"
  | "completed"
  | "error"
  | "stopped";

type GraphRunRecord = {
  id: string;
  workspaceKey: string;
  cli: CliName;
  sessionId: string | null;
  rootPrompt: string;
  status: GraphRunStatus;
  createdAt: number;
  updatedAt: number;
  templateId?: string;
  templateVersion?: string;
  graphVersion: 1;
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  eventsFile: string;
  communicationDir: string;
  worktree?: { cwd: string; branch: string; baseCommit: string; createdAt?: number };
  finalAnswer?: GraphFinalAnswer;
};
```

### GraphNodeRecord

```ts
type GraphNodeKind =
  | "intake"
  | "plan"
  | "implement"
  | "test"
  | "review"
  | "debate"
  | "human_gate"
  | "merge"
  | "sleep"
  | "summary";

type GraphNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "sleeping"
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "stopped";

type GraphNodeRecord = {
  id: string;
  title: string;
  kind: GraphNodeKind;
  status: GraphNodeStatus;
  ownerRole: "main" | "subtask" | "reviewer" | "moderator" | "human" | "system";
  promptRef?: string;
  artifactRef?: string;
  writeFiles?: string[];
  conflictGroup?: string;
  maxAttempts: number;
  attempts: number;
  dependsOn: string[];
  unlocks: string[];
  acceptance?: GraphAcceptanceCheck[];
  startedAt?: number;
  completedAt?: number;
  lastError?: string;
  worktreeCwd?: string;
  baseCommit?: string;
  commit?: string;
};
```

### GraphEdgeRecord

```ts
type GraphEdgeKind =
  | "depends_on"
  | "if_pass"
  | "if_fail"
  | "review_feedback"
  | "conflicts_with"
  | "evidence_for"
  | "human_approved";

type GraphEdgeRecord = {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  condition?: string;
  active: boolean;
};
```

### 存储位置

第一阶段建议新增：

```text
~/.sinitek_cli/graph-runs/<workspaceKey>/<cli>/<sessionId-or-pending>/graph-runs.json
~/.sinitek_cli/graph-communications/<graphRunId>/graph.json
~/.sinitek_cli/graph-communications/<graphRunId>/events.jsonl
~/.sinitek_cli/graph-communications/<graphRunId>/nodes/<nodeId>.md
~/.sinitek_cli/graph-worktrees/<graphRunId>/
```

`graph.json` 保存 realized graph 快照；`events.jsonl` 保存追加式运行事件；`nodes/<nodeId>.md` 保存节点 prompt、输出、验证证据和人工批注；`graph-worktrees/<graphRunId>/` 保存该 run 的独立 git worktree。文件状态和 git checkpoint 共同构成可回退事实来源，内存 scheduler 只是执行视图。

## 调度语义

Scheduler 每次从持久化状态读取图并计算 ready nodes：

1. 节点 `dependsOn` 全部处于 `passed`，且没有 active `if_fail` / `human_gate` 未满足。
2. 节点自身不是终态，且尝试次数未超过 `maxAttempts`。
3. 节点声明的 `writeFiles` 与当前 running 节点无重叠。
4. `conflictGroup` 相同的节点默认串行，除非模板明确允许并发。
5. `human_gate` 节点只能由 UI 或用户明确输入推进。
6. `sleep` 节点写入绝对 `wakeAt`，到期后重新计算 ready set。
7. 同一批 ready nodes 默认最多并发 6 个，沿用 Loop 已验证的保守上限。

节点完成后只允许通过结构化结果更新状态：

- `passed`：产物满足 acceptance，宿主读取节点 communication file 的 `## JSON` 后创建 checkpoint commit，并激活后续 `if_pass` 边。
- `failed`：运行失败但可重试，激活 retry 或 `if_fail` 边。
- `blocked`：需要用户或上游设计变更，Graph 进入 `needs-review` 或等待 human gate。
- `skipped`：条件边未命中。

## CLI 适配

Graph 节点不是新的 CLI 类型。每个可执行节点都转换为当前 runner 能理解的一次任务：

- `implement` 节点：类似 Loop 子任务，但运行 cwd 是 Graph run 的独立 git worktree；基线五节点图默认授权实现、测试、评审节点写入整个 worktree，宿主通过 checkpoint commit 支撑回退。
- `review` / `test` 节点：优先只读，除非模板显式允许写入测试或修复建议。
- `debate` 节点：可复用现有红蓝辩论 artifact 和共识校验能力。
- `summary` 节点：读取 Graph events 和 node artifacts，生成最终答复。
- `human_gate` 节点：不调用 CLI，只等待 UI 输入。

OpenCode 仍走 one-shot / attach 机制；Codex / Claude 继续按现有交互或一次性执行能力，不因 Graph 引入统一模型 SDK。

## UI 设计

当前 UI 目标是“可观察、可恢复、可执行最小安全控制”，不是图编辑器。

- 输入区模式：已新增 `Graph` 选项，运行时进入独立 Graph 分支。
- 运行气泡：Graph 任务开始后显示“打开 Graph 运行图”动作；该 action 可携带 `graphRunId` 和可选 `nodeId`。
- 会话标签与状态行：Graph tab 显示 `🗺️` 标识；active Graph tab 识别到 `graphRunId` 后，在底部运行状态行固定显示“打开 Graph 图”按钮。
- 内容区面板：只分上下两块，上方是约 50% 高度的 SVG/HTML 可视 DAG，下方是节点详情；DAG 节点矩形保持紧凑，只在图上显示标题和状态，正文细节进入详情区；概览、状态统计、节点列表、recent events 和 finalAnswer 不在面板内渲染。
- 图视图：已使用原生 SVG 渲染边、path、marker 和 arrow，使用 HTML button 渲染节点；旧记录缺少 `run.edges` 时可从 `dependsOn` fallback 生成 `depends_on` 边。
- 节点状态：pending、ready、running、passed、failed、blocked、sleeping、skipped。
- 操作：只显示真实接通且当前状态允许的 Continue / “我要说话” / Retry / Feedback rollback / Approve / Stop；不可用操作直接隐藏。Stop 的真实进程终止能力受 active CLI run 映射限制。
- i18n：所有新增 Webview 文案必须提供中英文；状态值内部用英文枚举，展示走现有翻译词典。

## 与 Loop 的关系

Graph 不是 Loop 的重命名，也不是 Loop 的 UI 美化。

Loop 的最小结构是：

```text
主任务决策 -> 子任务批次 -> 主任务复核 -> 下一轮或完成
```

Graph 的最小结构是：

```text
节点集合 + 边集合 + 调度器 + 持久化事件流 + 人工/机器关卡
```

更精确地说，Graph 的运行期不需要一个“主智能体”每轮重新决定下一批子任务。主控逻辑在规划期被编译为 realized graph；运行期由宿主 scheduler 根据 durable graph state 计算 ready set、冲突、等待和关卡。每个节点执行上下文只是被图授权的 bounded worker，知道全图和当前位置，但不能像 Loop 主任务那样随意改写下一轮派发。

Loop 可以被视为 Graph 的一种退化形态：每轮主任务是一个 plan/review 节点，当前批次子任务是 parallel implement 节点，复核结果决定回到下一轮或进入 summary。但 Graph 一旦显式化，就能表达 Loop 难以自然表达的结构：

- 跨轮次依赖：节点 A 的接口设计必须先于节点 B/C/D，且 B/C 可以并发。
- 多评审关卡：实现节点必须先过测试节点，再过 reviewer 节点，失败边回到修复节点。
- 条件路径：如果 UI 回归失败走截图修复；如果 API 合约失败走 schema 修复。
- 人工批准：数据库迁移、权限变更、删除文件、发布动作必须经 human gate。
- 证据边：某个测试节点的结果是最终总结里某个验收项的证据，而不是散落在 transcript。
- 局部返工：一个 review 节点可以只驳回相关实现节点，不必把整个 Loop 推回下一轮。

## Graph 比 Loop 先进在哪里

Graph 的先进性不在“名字更潮”，而在控制面升级：

1. **从回合控制升级为拓扑控制**：Loop 主要按轮次推进；Graph 按依赖图推进，宿主知道哪些节点已完成、哪些节点阻塞、哪些节点可并发。
2. **从隐式计划升级为显式计划**：Loop 的计划藏在主任务消息和沟通文件里；Graph 的计划是可读、可存档、可复盘、可比较的 realized graph。
3. **从批次并发升级为依赖并发**：Loop 只能并发当前轮次的子任务；Graph 可以跨阶段发现 ready nodes，同时受 `writeFiles`、`conflictGroup` 和 gate 约束。
4. **从整体返工升级为局部返工**：Loop 失败常表现为下一轮重新规划；Graph 可以把失败边接回具体节点，只重跑受影响部分。
5. **从 transcript 排障升级为状态排障**：Loop 需要读聊天记录还原因果；Graph 直接暴露节点状态、边条件、attempt、证据和阻塞原因。
6. **从 agent 自证升级为外部关卡**：Graph 能把测试、评审、红队、人工批准作为独立节点，避免同一个 agent 计划、实现又自评。
7. **从一次性任务升级为可复用流程资产**：Graph Template 可以沉淀“复杂功能交付”“安全修复”“发布准备”等流程，下一次不必重新靠 prompt 约束。

但 Graph 不是所有场景都更优。简单问答、小修小补、探索性 debug、路径未知且需要快速试错的任务，Loop 更轻、更快、提示成本更低。Graph 应用于复杂、高风险、多人/多 agent、强验收或可复用流程。

## 分阶段落地

### Phase 0：设计和只读投影

- 完成本设计和引用入口。
- 从现有 Loop task record 生成只读 Graph 投影视图，验证用户是否需要图式排障。
- 不改变 Loop 运行行为。

### Phase 1：最小 Graph 运行内核

- 已新增 `GraphRunStore`、`GraphNodeRecord`、`GraphEdgeRecord`、`graph.json` 和 `events.jsonl`。
- 已支持用户从 Webview 选择 `Graph` 并启动 AI-planned realized graph：扩展先运行 planning-only `plan` 节点，读取并校验 planner artifact 中的 `plannedGraph`，再 materialize 为包含分支、fan-out/fan-in、测试、评审、human_gate、sleep、merge 或 summary 的真实 DAG；规划无效时 run 停在 `needs-review`，不继续执行固定线形 fallback。
- 已支持 `plan`、`implement`、`test`、`review`、`summary` 的 CLI 节点执行；`human_gate` 和 `sleep` 已有 kernel/scheduler/lifecycle 基础能力，并在 Phase 2 接入最小批准与自动唤醒路径。
- Scheduler 已作为本地纯函数落地；Graph 记录会保留 planner 输出的 DAG 和 maxConcurrent，扩展侧按 `min(run.maxConcurrent, 6)` 派发同批 ready nodes，并为每个节点创建独立 Graph 节点 tab，避免并行节点共享同一主 tab 互相 stop。
- 已复用现有 CLI runner 和 Loop 子任务隔离经验，节点 prompt 明确授权范围、输入 artifact、完成标准、验证要求、全图拓扑、当前位置和下游职责边界。

### Phase 2：Graph 恢复与交互增强

- 已在 GraphRunPanel 上新增可控的恢复与 mutation 能力，并保持不可用操作不渲染。
- 已支持从持久化 store 打开指定 run 或当前 workspace / CLI 最近 run，读取坏 store 时以 diagnostics 非阻塞降级。
- 已支持 sleeping / needs-review / error run 的 Continue / Resume，复用现有 Graph executor / `runGraphPrompt` 安全路径继续 tick，不新建 run。
- 已支持最小节点 mutation：Retry failed/blocked node、Feedback rollback failed/blocked 验证类节点到上游 checkpoint、Approve human_gate、Stop run，并在操作后刷新面板、尽量保留 selected node。
- 已支持 Graph auto wake：扩展激活或 workspace 变化时恢复 sleeping run 定时器，到期后 resume/tick。
- 尚未支持从失败节点自动生成补充需求、局部返工路径编辑、图编辑器或模板库。

### Phase 3：模板和模式库

- 支持内置模板：复杂功能、Bug 修复、测试补齐、文档同步、发布准备。
- 支持工作区模板文件，但只解析 JSON / YAML 数据，不执行模板脚本。
- 支持把成功运行的 realized graph 提炼为模板候选。

### Phase 4：可选图编辑器

- 在 Graph 运行前允许拖拽调整节点和边。
- 增加模板 diff、版本和审计信息。
- 评估是否引入 React Flow 或专门图组件；不在第一阶段引入。

## 验证与安全边界

- Graph 生成必须先做 schema 校验，禁止未知节点类型和未知边类型静默通过。
- 所有写入节点必须声明 `writeFiles` 或 `conflictGroup`；无法判断时默认串行。
- 后续启用高风险节点模板时必须走 `human_gate`：删除大量文件、数据库迁移、发布、权限/密钥相关修改。当前最小批准按钮不等同于完整审批表单或风险确认流程。
- 节点 prompt 中必须包含授权范围、输入 artifact、输出 artifact、完成标准和验证要求。
- 生命周期变更会回写持久化 store 与快照；跨进程恢复和面板操作每次派发前重新读取状态，避免旧异步回调复活任务。
- Stop 不应夸大外部进程终止能力：只有存在 active CLI run 映射时才尝试终止真实 CLI，否则只保证 Graph 状态落盘并给用户明确提示。
- 事件日志不得记录密钥、token、生产地址或客户数据。
- 节点通过 `runPrompt` 执行时必须把启动失败、runner 异常和最终失败回传给 Graph kernel；失败节点应进入 `failed/blocked/needs-review`，不得被外层 UI 错误处理吞掉后继续当作 passed。
- Graph 运行完成前不得把未通过验收的节点结果写成最终答复。

## 文档与测试影响

Phase 2 已同步产品规格和功能清单，相关事实来源为 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。用户可见能力按“Graph 最小运行内核 + 可视 DAG + 持久化恢复 + 最小控制 + auto wake + 验证失败反馈回退”声明，不把未实现的图编辑器、模板库、完整 human gate 表单、局部返工路径编辑或自动条件重规划写成已完成。

最终验证记录：

- `npm run build`：通过。
- `node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`：通过，99/99。
- `node --test dist/test/*.test.js`：通过，729/729。
- `git diff --check`：通过。

## 参考资料

访问日期：2026-07-23。

- Vibe Coding: A Practical Field Guide, workflow vs agent、loop engineering、state file、goal-driven run: https://github.com/Lling0000/Vibe_coding_guide/blob/main/vibe-coding-guide-en.md
- Sourcegraph, Agentic Coding in 2026, agentic coding loop and review/verification distinction: https://sourcegraph.com/blog/agentic-coding
- ThinkingTokens, Vibe Coding Agents Are Not What They Seem, dependency graph and orchestration layer: https://thinkingtokens.ai/2026/02/vibe-coding-agents-are-not-what-they-seem/
- ViBench Extended, single-loop construction vs typed subtask graph pipeline: https://vibench.ai/extended
- MASFactory, Vibe Graphing and executable directed graphs: https://arxiv.org/abs/2603.06007
- From Static Templates to Dynamic Runtime Graphs, reusable templates vs realized graphs vs execution traces: https://arxiv.org/abs/2603.22386
- GraphFlow, workflow graph as executable specification and append-only runtime log: https://arxiv.org/abs/2605.14968
- Mastra Workflows, sequential / parallel / branching / looping execution graphs: https://mastra.ai/ai-workflows
- Vercel AI SDK 7, WorkflowAgent durability and agent platform direction: https://vercel.com/blog/ai-sdk-7
- Inngest Functions, durable functions and step-level workflow execution: https://www.inngest.com/docs/learn/inngest-functions
- Trigger.dev, open-source TypeScript AI workflows with retries, queues, observability and human-in-the-loop: https://github.com/triggerdotdev/trigger.dev
- OpenWorkflow, durable functions, steps, workers and database-backed recovery: https://openworkflow.dev/docs/overview
- XState, TypeScript state machines, statecharts and actor model: https://stately.ai/docs/xstate
- Stately Agent, typed agent state machines where machine decides and host executes: https://stately.ai/docs/packages/agent
