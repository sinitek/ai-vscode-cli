# Graph 模式执行链路与逻辑说明

本文说明当前 VS Code 插件 Graph 模式从用户触发、AI planner 产出 `plannedGraph`、宿主 materialize DAG，到调度执行、持久化、UI 控制、续跑和 direct/worktree 边界的完整链路。

事实依据来自当前源码与已有设计文档，重点源码包括 `src/sessionMessageActions.ts`、`src/extension.ts`、`src/graph/`、`src/panelDiagnostics.ts`、`src/panelStateBuilder.ts`、`src/webview/graphRunPanel.ts`，设计背景见 `.ch/docs/design-docs/graph-orchestration-mode.md`。本文不把设计目标写成当前默认行为。

## 1. 总览：一次 Graph run 的主状态机

当前 Graph 模式不是 CodeGraph 代码图，也不是 LangGraph 框架接入；它是插件内部的显式 DAG 编排运行时。一次运行的主链路如下：

```text
Webview sendPrompt
  -> handleSendPromptMessage
  -> runGraphPrompt / runGraphPromptOrchestration
  -> 创建 planning-only Graph run（只有保留 plan 节点）
  -> tickGraphRun 执行 planner 节点
  -> planner 在节点 communication file 输出 ## JSON + plannedGraph
  -> maybeMaterializeGraphPlanAfterTick 校验并 materialize realized DAG
  -> scheduler 选择 ready batch
  -> kernel 并发派发节点到 runPrompt
  -> 节点写 communication file，宿主解析最后一个 ## JSON
  -> lifecycle 更新 node/run 状态并写 events/store/graph.json
  -> UI 面板投影状态，支持 Continue / 补充需求 / Retry / Feedback / Stop
  -> summary 节点通过 finalAnswer 完成 run
```

关键入口位于 `src/sessionMessageActions.ts:260-426` 和 `src/extension.ts:5162-5255`；scheduler/kernel 位于 `src/graph/graphScheduler.ts`、`src/graph/graphKernel.ts`；结果解析位于 `src/graph/graphNodeArtifact.ts:20-69`。

## 2. 触发入口与模型路由

Webview 发送 `sendPrompt` 时会携带 `interactiveMode`、CLI、主/子模型和思考模式字段：协议定义见 `src/webview/types.ts:50-66`，实际 postMessage 组装见 `src/webview/viewContentScript/taskListAndUi.ts:820-845`。扩展消息入口 `src/sessionMessageHandlers.ts:841-850` 将 `sendPrompt` 交给 `handleSendPromptMessage`。

`handleSendPromptMessage` 会归一化交互模式：当 `effectiveInteractiveMode === "graph"` 时进入 Graph 分支，调用 `deps.runGraphPrompt`，不走普通 coding 或 Loop 分支。Graph 分支还会跳过插件侧长期记忆注入和持久化：`modelPromptWithMemory` 对 Graph 直接使用 `contextBuild.modelPrompt`，并设置 `promptInput.skipLongTermMemoryPersist = true`，见 `src/sessionMessageActions.ts:320-363`。

模型路由分两层：

- Webview 输入层：`resolvePromptRoleModels` 对 Codex/OpenCode 支持主模型、子模型，按显式选择、历史选择和单模型 fallback 解析，见 `src/sessionMessageActions.ts:196-232`。
- Graph run 层：`buildGraphRunModelRouting` 固化 `planner: main`、`executor: subtask` 两条 route；`resolveGraphNodeModelRoute` 规定 `plan` 与 `summary` 用 planner route，其他 materialized 节点用 executor route，见 `src/extension.ts:3384-3512`。

执行节点派发时，`executeGraphNodeViaRunPrompt` 继续按节点记录或 run routing 选择 `modelRole/model/modelFallback`，再调用既有 `runPrompt`，见 `src/extension.ts:5664-5756`。

## 3. Planner 节点

新 Graph run 先由 `runGraphPromptOrchestration` 创建 planning-only run：节点列表来自 `buildGraphPlanningRunNodes`，只包含保留 `plan` 节点；边列表初始为空；`maxConcurrent` 初始是 planner 专用上限。源码见 `src/extension.ts:5200-5235` 和 `src/graph/graphPlanner.ts:43-64`。

所有 Graph 节点 prompt 都由 `buildGraphNodePrompt` 构造，内容包括：

- Graph run 文件、events 文件、communication 目录、main communication file。
- 当前节点 ID、类型、状态、attempt、模型角色、上下游链路。
- 全图节点清单、边清单、active nodes、授权范围、writeFiles/conflictGroup、acceptance。
- 长期记忆边界、验证要求、输出小节和固定 `## JSON` 协议。

这些通用 prompt 字段见 `src/graph/graphPromptBuilders.ts:72-182`。当节点是唯一保留 planner 节点时，会追加 AI Planner 专用尾部，要求“先把原始目标编译成可执行 Graph DAG”，并要求 JSON 额外包含 `plannedGraph`，见 `src/graph/graphPromptBuilders.ts:568-660`。

Planner 节点本身不直接实现用户任务；它的输出是可执行 DAG 计划产物。宿主只读取节点 communication file 最后一个 `## JSON` fenced block，并从其中规范化 `plannedGraph`；解析逻辑见 `src/graph/graphNodeArtifact.ts:20-69`。

## 4. `plannedGraph` schema 与 materialize

`plannedGraph` 的类型定义位于 `src/graph/types.ts:170-200`：

- `nodes[]` 使用 `GraphPlannedNodeSpec`，包含 `id/title/kind/ownerRole/promptRef/writeFiles/conflictGroup/maxAttempts/dependsOn/acceptance/wakeAt`。
- `edges[]` 使用 `GraphPlannedEdgeSpec`，包含 `from/to/kind/label/condition/conditionExpression/metadata/active`。
- `maxConcurrent` 可选，受上限归一化约束。

允许的 run/node/edge/condition 状态与枚举定义在 `src/graph/types.ts:15-122`，Graph run record 的持久化字段定义在 `src/graph/types.ts:268-295`。

Materialize 由 `materializeGraphPlan` 完成，核心校验和补全规则在 `src/graph/graphPlanner.ts:66-376`：

- planner 输出节点数量必须在 1 到 40 之间，ID 合法且不能重复。
- planner 不得重定义保留 ID `plan`。
- 新 planner 不得生成 `human_gate` 节点、`human_approved` 边或 `manual` 条件。
- edge 必须引用已知节点，不能指向保留 planner 节点。
- `dependsOn` 与 active `depends_on` 边会合并为结构依赖。
- 无依赖节点会自动依赖保留 `plan` 节点。
- 如果没有 summary 节点，宿主自动补默认 summary 节点，并让叶子节点汇入 summary。
- active `depends_on` 边必须无环，否则 materialize 失败。

Materialize 的时序在 `src/extension.ts:5550-5592`：只有 planning-only run 且 planner 节点已经 `passed` 时，宿主才读取 planner artifact。缺少有效 `plannedGraph` 或 materialize 失败会通过 `failGraphPlannerRun` 写入 `node.failed` 和 `run.updated` 事件，见 `src/extension.ts:5594-5636`。

## 5. Scheduler：依赖、条件、并发和冲突

Scheduler 的主要输出是一个 runnable batch，供 kernel 在同一 tick 中执行。入口为 `selectGraphRunnableBatch`，见 `src/graph/graphScheduler.ts:170-245`。

### 5.1 ready 判定

`getGraphNodeBlockers` 按节点状态、结构依赖和条件边计算 blocker，见 `src/graph/graphScheduler.ts:247-351`：

- `pending` / `ready` 可进入调度；`running`、`sleeping`、终态会产生对应 blocker。
- `failed` 节点若 `attempts < maxAttempts`，仍可重新 ready；否则 blocker 为 `attempts_exhausted`，见 `src/graph/graphScheduler.ts:485-494`。
- 结构依赖必须为 `passed` 或 `skipped` 才满足，见 `src/graph/graphScheduler.ts:509-543`。
- active `depends_on` 边会和节点 `dependsOn` 一起参与结构依赖。

### 5.2 条件边

条件入边由 `if_pass`、`if_fail`、`human_approved` 或存在 `conditionExpression` 的边组成；`review_feedback` 和带返工 metadata 的 `if_fail` 是返工触发信号，不作为普通阻塞条件边处理，见 `src/graph/graphScheduler.ts:546-567`。

当前支持的条件求值范围：

- `if_pass`：源节点必须 `passed`。
- `if_fail`：源节点必须 `failed` 或 `blocked`。
- `source_status`：支持 `equals`、`one_of`。
- `source_acceptance`：支持 `all_required_passed`、`any_required_failed`、`has_evidence`。
- `manual` 仅历史兼容，新 planner 已禁止生成。
- `custom` 会返回 `edge_condition_not_evaluable`，需要后续重规划或返工，不能写成已自动求值。

条件实现见 `src/graph/graphScheduler.ts:574-737`。`evidence_for` 不是解锁依赖边，materialize 时也不会计入 `unlocks`，见 `src/graph/graphPlanner.ts:359-376`。

### 5.3 并发和写入冲突

`maxConcurrent` 同时受 run 配置和扩展侧执行上限限制：扩展侧用 `min(run.maxConcurrent, GRAPH_EXTENSION_EXECUTOR_MAX_CONCURRENT_NODES)`，见 `src/extension.ts:5546-5548`。Scheduler 还会扣除当前 running 节点后再选 batch，见 `src/graph/graphScheduler.ts:170-177`。

写入冲突按三类判断，见 `src/graph/graphScheduler.ts:354-427`、`src/graph/graphScheduler.ts:790-826`：

- 相同 `conflictGroup`。
- `writeFiles` 路径相同或父子路径重叠。
- `implement/test/review/merge` 这类会写文件的节点没有 `writeFiles` 也没有 `conflictGroup`，会按 unscoped write 与其他写入类节点冲突。

这些约束用于避免同批或与 running 节点并发冲突，但不是文件系统级隔离。

## 6. Kernel 与节点执行

`tickGraphRun` 是 Graph runtime 的核心 tick，见 `src/graph/graphKernel.ts:72-200`：

1. 调用 scheduler 选择 batch。
2. 未到期的 sleep 节点通过 `markGraphNodeSleeping` 进入 `sleeping`。
3. 到期的 sleep 节点由宿主系统完成。
4. 对 batch 中每个 CLI 节点先调用 `markGraphNodeStarted`，将节点置为 `running` 并增加 attempt。
5. 使用 `Promise.all` 并发构造 prompt 并调用 executor。
6. 对每个执行结果调用 `finalizeGraphNodeResult`，写回节点状态、artifact、acceptance、checkpoint 元数据和 run 状态。

扩展侧 executor 是 `executeGraphNodeViaRunPrompt`，见 `src/extension.ts:5664-5839`。它会：

- 解析 direct/worktree execution cwd。
- 创建 Graph 子任务 tab，并在主 Graph tab/节点 tab 追加系统消息。
- 按 planner/executor route 选择模型。
- 调用现有 `runPrompt`，传入 `graphRunId`、`graphNodeId`、`executionCwd`、`isolateProjectInstructions: true`、`skipLongTermMemoryPersist: true`。
- 执行结束后读取节点 communication file 的最后一个 `## JSON`。
- 如果 runner 报错但 artifact 写成 `passed`，宿主仍将结果改为 `failed`。
- worktree 模式才会记录 base commit 并创建 checkpoint commit；direct 模式不做 checkpoint。

节点 JSON 允许的执行结果状态是 `passed`、`failed`、`blocked`、`sleeping`，见 `src/graph/graphNodeLifecycle.ts:14-29` 和 `src/graph/graphNodeArtifact.ts:13-18`。

## 7. 节点和 run 生命周期

Graph run 状态定义在 `src/graph/types.ts:15-23`，包括 `draft`、`running`、`sleeping`、`needs-review`、`completed`、`error`、`stopped`。节点状态定义在 `src/graph/types.ts:46-56`，包括 `pending`、`ready`、`running`、`sleeping`、`passed`、`failed`、`blocked`、`skipped`、`stopped`。

生命周期更新逻辑位于 `src/graph/graphNodeLifecycle.ts`：

- `markGraphNodeStarted`：节点变 `running`，attempt 加一，run 变 `running`，追加 `node.started` 事件，见 `src/graph/graphNodeLifecycle.ts:39-66`。
- `markGraphNodeCompleted`：节点变 `passed`，写 artifact/acceptance/checkpoint；如果是 summary 节点并带 `finalAnswer`，run 变 `completed` 并追加 `run.completed`，见 `src/graph/graphNodeLifecycle.ts:68-127`。
- `markGraphNodeFailed`：节点变 `failed`，记录 `lastError`、attempts、execution/checkpoint 信息，见 `src/graph/graphNodeLifecycle.ts:129-170`。
- `markGraphNodeBlocked` 当前委托到 `markGraphNodeFailed`，即 blocked 结果会归一到 failed 处理，见 `src/graph/graphNodeLifecycle.ts:172-180`。
- `markGraphNodeSleeping`：节点和 run 进入 `sleeping`，记录 wakeAt，见 `src/graph/graphNodeLifecycle.ts:182-213`。

扩展主循环 `tickGraphRunToPause` 会在每个 tick 后尝试 materialize planner 输出、刷新面板、调度 auto wake，并在 `completed`、`needs-review`、`sleeping`、`error`、`stopped` 等暂停/终态时返回，见 `src/extension.ts:5258-5352`。

为避免 Stop 后被异步 tick 覆盖，`persistGraphRunTickState` 会先读取最新 run；如果最新状态已是 `stopped`，后续非 stopped 状态不会覆盖它，见 `src/extension.ts:2988-2997`。

## 8. events、store 与 communication 文件

Graph 运行有两套本地落盘面：

### 8.1 run store

结构化 store 由 `src/graph/graphStore.ts` 管理。store 根目录是 `~/.sinitek_cli/graph-runs/`，具体文件由 `buildGraphRunStoreFile` 生成：

```text
~/.sinitek_cli/graph-runs/<workspaceKey>/<cli>/<sessionId-or-__pending__>/<graphRunId>/graph-runs.json
```

路径构造见 `src/graph/graphStore.ts:113-137`。`createGraphRunRecord` 会写 store，并调用 `ensureGraphCommunicationFiles` 初始化 communication 文件，见 `src/graph/graphStore.ts:306-365`；`updateGraphRunRecord` 会归一化 patch、写 store、刷新 communication 快照，见 `src/graph/graphStore.ts:368-421`。

### 8.2 communication 目录

communication 根目录是 `~/.sinitek_cli/graph-communications/<graphRunId>/`，路径定义见 `src/graph/graphCommunications.ts:11-45`，包含：

- `graph.json`：当前 run 快照，由 `writeGraphSnapshot` 写入。
- `events.jsonl`：追加式事件流。
- `main.md`：图级沟通文件，保存原始目标与补充需求。
- `nodes/<nodeId>.md`：节点沟通文件，节点必须在其中写固定小节和最后的 `## JSON`。

`ensureGraphCommunicationFiles` 会创建这些文件并确保每个节点有 communication file，见 `src/graph/graphCommunications.ts:57-95`。

### 8.3 events

事件由 `appendGraphEvent` 以 JSONL 追加写入，见 `src/graph/graphEvents.ts:40-49`。事件类型定义在 `src/graph/types.ts:103-122`，包括 `run.created`、`run.updated`、`node.started`、`node.completed`、`node.failed`、`node.sleeping`、`node.retry_requested`、`node.feedback_requested`、`run.resumed`、`run.completed`、`run.error`、`run.stopped` 等。

事件写入会校验事件类型和 runId，并对 summary/error/data 中常见 token、secret、password、api key 等敏感字段做脱敏，见 `src/graph/graphEvents.ts:88-176`。

## 9. UI 面板与状态投影

聊天面板中的普通 action 使用 `openGraphRun`，协议定义见 `src/webview/types.ts:67-70`。扩展侧 `src/sessionMessageHandlers.ts:841-845` 调用 `openGraphRunPanel`。系统消息 action 的构造与去重逻辑见 `src/extension.ts:5864-5947`：主 Graph tab 通常只显示一次打开运行图 action，节点 tab 不重复展示普通打开 action。

GraphRunPanel 的状态由 `buildGraphRunPanelStateWithDeps` 从 run record 和 events 投影，见 `src/panelStateBuilder.ts:364-420`。它会输出：

- run 元数据：id、cli、status、rootPrompt、store/graph/events/communication 路径、finalAnswer。
- run control：Continue / Supplement / Stop 是否可用。
- nodes：类型、状态、owner、attempt、writeFiles、conflictGroup、artifactRef、communicationFile、acceptance、节点级 control。
- edges：from/to/kind/active/visited/label/condition/metadata。
- selected node、最近 events、selected evidence。

若旧运行记录缺少 `run.edges`，面板会从节点 `dependsOn` 构造 fallback `depends_on` 边，见 `src/panelStateBuilder.ts:455-483`。

Panel coordinator 位于 `src/panelDiagnostics.ts:862-976`：它按指定 `graphRunId/nodeId` 或最近 run 打开/刷新面板，读取 events 并转发面板消息。面板消息包括 refresh、continue、supplementRun、retryNode、feedbackNode、stopRun，见 `src/webview/graphRunPanelTypes.ts:120-126` 和 `src/panelDiagnostics.ts:889-915`。

前端渲染位于 `src/webview/graphRunPanel.ts`：

- `GraphRunPanel` 创建 VS Code webview panel 并接收消息，见 `src/webview/graphRunPanel.ts:115-161`。
- 顶部渲染 Continue / 补充需求 / Stop 控制，见 `src/webview/graphRunPanel.ts:931-943`。
- DAG 使用 `@dagrejs/dagre` 计算布局，默认 75% zoom，支持刷新、重置布局、补充需求、Stop、Retry、Feedback，见 `src/webview/graphRunPanel.ts:168-260`、`src/webview/graphRunPanel.ts:831-875`、`src/webview/graphRunPanel.ts:965-1064`。
- `vscode.getState/setState` 只保存选中节点、节点位置和 zoom 等视图状态，不改变 run store 或调度语义，见 `src/webview/graphRunPanel.ts:244-251`。

## 10. 续跑、补充需求、重试、反馈、跳过和停止

Graph 控制能力由 `src/graph/graphRunControl.ts` 和扩展侧控制入口共同实现。

### 10.1 Continue / 自动唤醒

可续跑状态定义为 `sleeping`、`needs-review`、`error`，见 `src/graph/graphRunControl.ts:21-25`。`resumeGraphRunRecord` 会把 run 状态置为 `running` 并追加 `run.resumed` 事件，见 `src/graph/graphRunControl.ts:128-168`。

面板 Continue 走 `continueGraphRunFromStore`，随后调用 `tickGraphRunToPauseFromControl` 重新进入 tick，见 `src/extension.ts:2904-2982`。自动唤醒由 `GraphAutoWakeScheduler` 和扩展侧 `initializeGraphAutoWakeScheduler`/`attemptGraphRunAutoWake` 实现：它只处理 `sleeping` run，按最早 wakeAt 调度，到期且 workspace/target 不冲突时继续运行，见 `src/graph/graphAutoWake.ts:21-127` 和 `src/extension.ts:2613-2689`。

### 10.2 补充需求

GraphRunPanel 的“我要说话/补充需求”不会承诺打断已经运行中的节点。扩展侧 `supplementGraphRunFromPanel` 会归一化 prompt，拒绝 completed/stopped run，把文本追加到 `run.supplementalRequirements`、`main.md` 和 `events.jsonl`，见 `src/extension.ts:2698-2791`。后续节点 prompt 会读取 `run.supplementalRequirements` 并注入“用户补充消息”，见 `src/graph/graphPromptBuilders.ts:131-136`。

### 10.3 Retry

`retryGraphNodeForRun` 只允许 `failed` 或 `blocked` 节点重试，且如果已有 passed 下游节点会拒绝，避免隐式级联重置，见 `src/graph/graphRunControl.ts:170-266`。如果历史 worktree 和节点 `baseCommit` 存在，会先 reset worktree；direct 模式没有 checkpoint，所以只把目标节点状态清回 `pending` 并在当前工作区状态上重跑。

### 10.4 Feedback rollback

`feedbackGraphNodeForRun` 从失败的 test/review/merge/human_gate/summary 节点选择上游返工目标，并沿依赖图计算 reset scope，见 `src/graph/graphRunControl.ts:337-443`。但它要求 `run.worktree.cwd` 和目标节点 `baseCommit` 同时存在；direct 模式会返回 `feedback_not_available`，扩展侧中文提示也明确“direct 模式不支持 Feedback rollback”，见 `src/extension.ts:3119-3147`。

`review_feedback` 和带 `reworkTargetNodeId`/`feedbackReason` 的 `if_fail` 可作为返工路径 metadata，但是否能真实 rollback 取决于 worktree checkpoint 是否可用。

### 10.5 Skip

`skipGraphNodeForRun` 允许 failed/blocked 节点标记为 `skipped` 并继续下游，但同样会拒绝已有 passed 下游的隐式级联场景，见 `src/graph/graphRunControl.ts:268-335`。当前 Graph UI 类型中没有暴露 skipRun 消息，扩展侧保留了 skip 控制函数。

### 10.6 Stop

Stop 由 GraphRunPanel 或主 Graph tab 进入同一控制链。`stopGraphRunRecord` 会把 run 置为 `stopped`，把 active/running 节点置为 `stopped`，写 `node.stopped` 和 `run.stopped` 事件，见 `src/graph/graphRunControl.ts:489-555`。扩展侧 `stopGraphRunFromPanel` 还会尝试停止带 `graphRunId` 映射的 active CLI run；如果没有 active CLI 映射，至少保证 store 状态落盘为 stopped，见 `src/extension.ts:2871-2902`、`src/extension.ts:3090-3117`。

## 11. Direct 与 Worktree 执行边界

当前新 Graph run 默认是 direct 模式。`createGraphRunExecutionSetup` 固定返回：

```ts
{
  executionMode: "direct",
  directExecution: {
    cwd: workspaceCwd,
    reason: "Graph mode executes in the current project workspace."
  }
}
```

源码见 `src/graph/graphWorktree.ts:93-106`。因此新 Graph run 不会自动创建 `~/.sinitek_cli/graph-worktrees/<graphRunId>`，也没有默认 checkpoint commit、merge-back 或 cleanup。

Direct 模式完成时，`finalizeCompletedGraphRunWorktreeMergeBack` 只写 `run.updated`，说明“without worktree merge-back”，并返回 direct completion message，见 `src/extension.ts:5410-5430`。节点执行时 `resolveGraphNodeExecutionContext` 优先使用 `run.directExecution.cwd`，见 `src/extension.ts:5638-5662`。

Worktree 相关 helper 仍保留，用于历史 run 或未来能力：

- `createGraphRunWorktree` 可创建 git worktree 和分支，见 `src/graph/graphWorktree.ts:108-139`。
- `commitGraphNodeCheckpoint` 可在 worktree 中创建节点 checkpoint commit，见 `src/graph/graphWorktree.ts:145-172`。
- `resetGraphWorktreeToCommit` 可 reset/clean 到 checkpoint，见 `src/graph/graphWorktree.ts:174-185`。
- `mergeGraphRunWorktreeToWorkspace` 与 `cleanupGraphRunWorktree` 可做 squash merge 和清理，见 `src/graph/graphWorktree.ts:187-230`。
- 扩展侧只有在 `executionContext.mode === "worktree"` 时才读取 base commit 或创建 checkpoint，见 `src/extension.ts:5678-5690`、`src/extension.ts:5795-5818`。

因此，direct 模式下 `writeFiles` 和 `conflictGroup` 是调度约束，不是隔离机制；节点写入会直接落在当前项目工作区。direct 模式也没有自动 rollback，验证失败或评审失败需要通过后续节点或用户手动在当前工作区中返工。

## 12. 当前边界与排障要点

- Graph 节点结果必须写入节点 communication file 的固定 `## JSON`；宿主只解析最后一个 JSON block，缺失或不可解析会使节点失败。
- `plannedGraph` 是 planner artifact，不是用户任务执行结果；planner `passed` 之后仍必须 materialize 成 run.nodes/run.edges 才会执行后续节点。
- `evidence_for` 是证据追踪边，不替代 `depends_on`，也不单独解锁调度。
- 新 planner 禁止人工审批节点/边；`human_gate`、`human_approved`、`manual` 仅作为历史兼容类型存在。
- `custom` 条件当前不可自动求值，会保守进入 blocker/复核口径。
- direct 模式没有 worktree 隔离、checkpoint、merge-back、cleanup 或 Feedback rollback。
- Graph 面板的节点拖拽、缩放和选中状态是本地 UI 状态，不改 DAG 结构和调度语义。
- Graph 模式默认不做长期记忆写入；节点 prompt 明确要求不得主动生成或刷新长期记忆产物，相关规则由 `src/graph/graphPromptBuilders.ts:83-86` 注入。

## 13. 快速源码索引

| 主题 | 关键路径 |
| --- | --- |
| Webview sendPrompt 协议 | `src/webview/types.ts:50-66` |
| Webview 发送 prompt | `src/webview/viewContentScript/taskListAndUi.ts:820-845` |
| 消息分发 | `src/sessionMessageHandlers.ts:841-850` |
| Graph 分支与跳过长期记忆 | `src/sessionMessageActions.ts:320-410` |
| 模型路由 | `src/sessionMessageActions.ts:196-232`、`src/extension.ts:3384-3512` |
| Graph run 创建与 tick | `src/extension.ts:5162-5352` |
| Planner 节点与 materialize | `src/graph/graphPlanner.ts`、`src/extension.ts:5550-5636` |
| 节点 prompt | `src/graph/graphPromptBuilders.ts` |
| Scheduler | `src/graph/graphScheduler.ts` |
| Kernel | `src/graph/graphKernel.ts` |
| 节点结果解析 | `src/graph/graphNodeArtifact.ts` |
| 生命周期 | `src/graph/graphNodeLifecycle.ts` |
| events | `src/graph/graphEvents.ts` |
| store | `src/graph/graphStore.ts` |
| communication 文件 | `src/graph/graphCommunications.ts` |
| run 控制 | `src/graph/graphRunControl.ts`、`src/extension.ts:2698-3147` |
| auto wake | `src/graph/graphAutoWake.ts`、`src/extension.ts:2613-2689` |
| direct/worktree | `src/graph/graphWorktree.ts`、`src/extension.ts:5410-5430`、`src/extension.ts:5638-5839` |
| GraphRunPanel 状态 | `src/panelStateBuilder.ts:364-420` |
| GraphRunPanel coordinator | `src/panelDiagnostics.ts:862-976` |
| GraphRunPanel UI | `src/webview/graphRunPanel.ts` |
