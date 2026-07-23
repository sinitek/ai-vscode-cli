# Graph 编排模式详细设计

- 状态：proposed
- 日期：2026-07-23
- 相关计划：`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode-design.md`
- 相关规格：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关目录：`src/extension.ts`、`src/cli/`、`src/interactive/`、`src/webview/`、`src/loopTaskStore.ts`、`src/loopDebate.ts`

## 背景

当前插件已经有 `Vibe / Loop` 两类顶层交互模式，并且 Loop 模式内部已经支持 `main_sub_multi_agent` 主从多智能体、`debate_multi_agent` 红蓝辩论多智能体、子任务并发、写入冲突分组、睡眠唤醒、群聊补充和人工复核。Loop 不是简单 while 循环，但它的核心仍是“主任务每轮返回决策，宿主按轮次派发子任务，再唤醒主任务复核”的回合状态机。

用户提出的 Graph 模式不是 CodeGraph、知识图谱、代码调用图，也不是直接采用 LangGraph 框架。这里的 Graph 来自近期 vibe coding / agentic coding 语境：把自然语言目标、多个 agent、工具步骤、人工关卡、验证和返工路径组织成显式的可执行工作图。也就是说，Graph 的重点不是“更会搜代码”，而是“把一次复杂 AI 编程任务的执行拓扑显式化”。

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
```

`graph.json` 保存 realized graph 快照；`events.jsonl` 保存追加式运行事件；`nodes/<nodeId>.md` 保存节点 prompt、输出、验证证据和人工批注。文件状态仍是事实来源，内存 scheduler 只是执行视图。

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

- `passed`：产物满足 acceptance，激活后续 `if_pass` 边。
- `failed`：运行失败但可重试，激活 retry 或 `if_fail` 边。
- `blocked`：需要用户或上游设计变更，Graph 进入 `needs-review` 或等待 human gate。
- `skipped`：条件边未命中。

## CLI 适配

Graph 节点不是新的 CLI 类型。每个可执行节点都转换为当前 runner 能理解的一次任务：

- `implement` 节点：类似 Loop 子任务，使用隔离执行根和指定授权范围。
- `review` / `test` 节点：优先只读，除非模板显式允许写入测试或修复建议。
- `debate` 节点：可复用现有红蓝辩论 artifact 和共识校验能力。
- `summary` 节点：读取 Graph events 和 node artifacts，生成最终答复。
- `human_gate` 节点：不调用 CLI，只等待 UI 输入。

OpenCode 仍走 one-shot / attach 机制；Codex / Claude 继续按现有交互或一次性执行能力，不因 Graph 引入统一模型 SDK。

## UI 设计

第一阶段 UI 目标是“可观察、可继续、可中止”，不是图编辑器。

- 输入区模式：新增 `Graph` 选项，或先在实验开关下展示 `Loop / Graph`。如果实现成本需要分阶段，运行时可以复用 Loop 入口，但用户可见命名必须明确 Graph。
- 运行气泡：Graph 任务开始后显示“打开 Graph 运行图”动作。
- 内容区面板：左侧是节点列表和状态统计，右侧是节点详情；顶部显示 running / blocked / sleeping / completed。
- 图视图：可先使用列表 + 缩进依赖，不强制第一阶段上 React Flow / SVG DAG。
- 节点状态：pending、ready、running、passed、failed、blocked、sleeping、skipped。
- 操作：中止、继续、重试失败节点、批准 human gate、补充需求。
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

- 新增 `GraphRunStore`、`GraphNodeRecord`、`GraphEdgeRecord` 和 `events.jsonl`。
- 支持用户目标生成首版 realized graph，但运行前必须展示摘要并允许用户确认。
- 支持 `implement`、`test`、`review`、`summary`、`human_gate` 五类节点。
- Scheduler 只做本地进程内调度；恢复时从文件重建 ready set。
- 复用现有 CLI runner 和 Loop 子任务隔离根。

### Phase 2：Graph 面板和恢复增强

- 新增内容区 Graph 运行面板。
- 支持节点重试、局部继续、人工批准、睡眠唤醒。
- 支持从失败节点生成补充需求并局部返工。
- 把 Graph final summary 写回主对话气泡。

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
- 高风险节点必须走 `human_gate`：删除大量文件、数据库迁移、发布、权限/密钥相关修改。
- 节点 prompt 中必须包含授权范围、输入 artifact、输出 artifact、完成标准和验证要求。
- Scheduler 每次派发前重新读取持久化状态，避免停止后旧异步回调复活任务。
- 事件日志不得记录密钥、token、生产地址或客户数据。
- Graph 运行完成前不得把未通过验收的节点结果写成最终答复。

## 文档与测试影响

本设计为 proposed 文档，不改变运行时代码：

- 当前不更新 `FEATURE_INVENTORY.md`，因为 Graph 尚未实现。
- 当前不执行 `npm run build` 或单元测试；实现阶段必须按影响面补测试。
- 实现阶段需要同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`FEATURE_INVENTORY.md`、`package.nls*.json`、Webview i18n 和相关运行时设计。

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
