# Graph 编排模式详细设计

- 状态：active（Phase 2 恢复与交互增强已落地，direct 自动返工已落地）
- 日期：2026-08-03
- 相关计划：`.ch/docs/exec-plans/completed/2026-07/2026-07-23-graph-orchestration-mode.md`
- 相关规格：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关目录：`src/graph/`、`src/extension.ts`、`src/sessionMessageActions.ts`、`src/sessionMessageHandlers.ts`、`src/panelDiagnostics.ts`、`src/webview/`、`src/i18n.ts`

## 背景

当前插件已经有 `Vibe / Loop` 两类顶层交互模式，并且 Loop 模式内部已经支持 `main_sub_multi_agent` 主从多智能体、`debate_multi_agent` 红蓝辩论多智能体、子任务并发、写入冲突分组、睡眠唤醒、群聊补充和人工复核。Loop 不是简单 while 循环，但它的核心仍是“主任务每轮返回决策，宿主按轮次派发子任务，再唤醒主任务复核”的回合状态机。

用户提出的 Graph 模式不是 CodeGraph、知识图谱、代码调用图，也不是直接采用 LangGraph 框架。这里的 Graph 来自近期 vibe coding / agentic coding 语境：把自然语言目标、多个 agent、工具步骤、验证、失败分支和返工路径组织成显式的可执行工作图。也就是说，Graph 的重点不是“更会搜代码”，而是“把一次复杂 AI 编程任务的执行拓扑显式化”。

## 当前已落地状态

截至 2026-08-03，Graph 已完成 Phase 1 最小运行内核、Phase 2 的可视 DAG / 持久化恢复 / 面板控制 / 睡眠唤醒增强、项目工作区 direct 执行、验证失败反馈边记录、结构化条件边与返工记录、direct 自动返工恢复、AI planner 并行优先 DAG 规划，以及规划 DAG 的并行节点执行上下文派发；它仍不是完整 workflow 平台或图编辑器。当前能力边界如下：

- 用户可在主 Webview 输入区选择 `Graph` 模式并发送任务；前端 payload 保留 `interactiveMode=graph`，后端 `handleSendPromptMessage` 会进入独立 `runGraphPrompt` 分支，不走普通 coding 或 Loop 编排。Codex 切到 Graph 时显示主模型/子模型两个选择器，普通 Coding 仍保持单模型选择器；OpenCode Graph 也使用主模型/子模型口径，底层 `model` / `small_model` 仅作为 OpenCode CLI 配置字段适配。
- Graph 模式默认不触发插件侧长期记忆 recall 注入，也不会在 Graph 节点结束后自动写入长期记忆；节点 prompt 只允许只读已有仓库记忆或运行态 recall，任务完成后的长期记忆沉淀由主智能体在收束后专门处理。
- 后端会先创建 planning-only Graph run，只包含保留 `plan` AI planner 节点；planner 必须在节点 `## JSON` 中返回 `plannedGraph.nodes` 和 `plannedGraph.edges`，宿主校验后把后续执行节点替换为 AI 规划的 realized DAG，再使用 `GraphRunStore`、`graph.json`、`events.jsonl` 和 `graph-communications/<graphRunId>/nodes/*.md` 落盘。Codex / OpenCode Graph 的 planner 和最终 `summary` 节点使用主模型，其他 materialized 执行节点使用子模型；`modelRouting`、节点 `modelRole/model/modelFallback` 和 prompt 注入会记录实际模型角色与回退原因。
- AI planner prompt 会默认要求先寻找可并行分支：多个可拆分且互不冲突的任务应从 planner fan-out 并行开始，再通过 test / review / merge / summary fan-in 收束；不得仅因任务同属一个用户目标或列表顺序靠后就串行化独立分支。planner 未显式输出 `plannedGraph.maxConcurrent` 时，materialize 会按首批依赖 `plan` 且不冲突的可执行根节点推断并发上限；运行时只因同一 `conflictGroup` 或重叠 `writeFiles` 串行化；未声明 `writeFiles` / `conflictGroup` 的 ready 节点可同批并行，但节点 prompt 仍要求真实写文件的节点声明 scope，否则应视为不写文件。
- AI planner prompt 已强化重构/迁移/拆模块防护：当现有 source-contract、文本快照、路径断言或测试 canonical source 可能引用旧文件时，必须规划独立 test adaptation / 契约更新节点，声明具体测试 `writeFiles`，并把验证节点的 `if_fail` / `review_feedback` 返工路径指向测试适配节点，而不是只回到原实现节点。
- 完整单测、全仓测试、全量 lint 等覆盖面大且可能包含历史/范围外失败的验证节点可声明 `blocking:false`。这类 advisory 节点失败后仍保留 failed 状态和 evidence/unresolved 责任，但不会单独阻断结构依赖继续进入 review / summary；相关 focused 验证节点仍应使用普通 blocking 依赖或 `if_pass` 阻断交付收束。
- `src/graph/` 已提供 v1 类型、store、communications、events、scheduler、prompt builders、node lifecycle、edge semantics 和 `tickGraphRun` kernel。Edge 记录已保留 planner 输出的 `label`、`conditionExpression` 和 `metadata`；`graphEdgeSemantics.ts` 集中定义 blocking edge、rework trigger edge 与 active structural/blocking edge，scheduler、prompt topology 和 review scope 必须复用同一口径；Scheduler 支持依赖、终态、attempt、advisory `blocking:false` 结构依赖放行、结构化 `source_status` / `source_acceptance` 条件求值、不可求值 custom 条件保守进入失败/复核口径、`sleep` ready action、`writeFiles` 路径重叠、`conflictGroup` 和并发上限计算；新 planner 输出会拒绝 `human_gate`、`human_approved` 和 `manual` 条件，运行时不再生成等待外部批准的 action；扩展侧不再把 executor 固定为 1，而是按 `min(run.maxConcurrent, 5)` 执行 scheduler 选出的同批可运行节点。
- Graph runtime 已在节点失败时写入结构化失败分类：`GraphNodeRecord.failure` 和 `node.failed.data.failureClassification` 会保留 category、confidence、signals、attemptsExhausted 与 recommendedRecovery。direct run 中，failed test/review/merge/summary 节点若被分类为可返工且 recommendedRecovery 为 `direct_rework`，并且存在 active `review_feedback` / `if_fail` 显式返工边，宿主会自动执行 direct rework：优先重置 edge metadata 声明的 `reworkScopeNodeIds`，为空时重置返工目标及其下游，并始终包含返工目标和失败源节点；随后写入 `node.direct_rework_requested` 事件、清理旧 artifact/execution/failure/acceptance evidence，再继续 tick。手动 Retry failed 节点也复用同一运行状态清理边界，只提升 attempt 上限并清空旧 artifactRef、failure、execution/checkpoint 字段和验收 evidence，避免 stale 产物被后续 prompt 或 review 当成当前结果。needs-review / idle 主 tab 文案会展示 category、confidence、signals、recommendedRecovery、recommendedWriteFiles 和 nodeDraft，旧运行记录没有 `failure` 时仍回退到原 lastError 摘要。
- 扩展侧 Graph runtime 通过现有 `runPrompt` 执行节点。新 Graph run 固定使用 `executionMode=direct`，节点直接以当前项目工作区为 cwd 执行，不再创建 `~/.sinitek_cli/graph-worktrees/<graphRunId>`、本地 checkpoint commit、merge-back 或 cleanup 流程。每个被调度的 Graph 节点还会创建独立 Graph 子任务 conversation tab。这里的“子任务 tab”只是节点执行容器，不是 Loop 主从智能体里的运行时主/从关系；主 Graph tab 负责记录调度和收束消息，节点 tab 负责运行对应节点。同一批互不冲突节点可并行运行且不会因为复用同一 tab 互相 stop。Codex / OpenCode 节点 tab 按 Graph executor/subtask 模型角色启动；缺少子模型时兼容回退到主模型或单模型，并在节点 prompt、Graph events/diagnostics 和持久化 run 中留下回退说明。direct 模式下，节点只保存 `executionCwd`，完成态代表改动已经直接落在当前工作区。历史 worktree run 的 `worktree` metadata、checkpoint、merge-back 和 cleanup helper 仍可被读取和处理，但不再是新 Graph run 的默认执行路径。Graph node 执行记录仍携带 `graphRunId` / `graphNodeId` 元数据，用于可用场景下映射到当前 active CLI run。
- 每个后续派发的 Graph 节点 prompt 都会注入当前 `graph.json` 的全图拓扑、节点清单、完整边清单、当前位置、直接上下游、上游/下游链路、同批 active 节点、`writeFiles` / `conflictGroup` 冲突线索和下游 test/review/merge/summary 职责。直接上下游与上下游链路只按 `dependsOn` / `unlocks` 加 active structural/blocking edges 计算；inactive edges、`evidence_for`、`conflicts_with`、`review_feedback` 和作为返工 trigger 的 `if_fail` 不进入拓扑链路，避免 review / evidence / rework 记录污染执行依赖判断。完整边清单仍原样展示，供节点理解条件、证据和反馈语义。这样实现节点知道图中已有后续测试或评审节点时，只完成自身 acceptance 和最小必要自检，不替代下游节点的完整验证、评审或最终总结。`review` 节点会额外生成“Review 节点评审范围”，从按同一拓扑口径确认的上游节点 `writeFiles`、communication file 和 `artifactRef` 推导候选改动文件；评审使用 `git status` / `git diff` 时应按这些路径过滤，范围外 dirty 文件默认视为同一 workspace 中的无关改动，不单独导致 `failed`。
- 普通“打开 Graph 运行图” `openGraphRun` action 只由主 Graph tab / 图级系统消息按同一 run 输出一次，Graph 节点/子任务 conversation tab 不再重复展示；点击后打开独立 `GraphRunPanel`，并仍支持指定 `graphRunId` / `nodeId`。当前 Graph tab 在会话标签上显示 `🗺️` 标识，active Graph tab 的底部运行状态行固定提供“打开 Graph 图”按钮，入口与 Loop 的“打开群聊”按钮同级。
- Graph 正式开始后，主 Graph tab 的视觉运行态跟随图级生命周期，而不是跟随某个节点 tab 的 CLI 进程生命周期；`running`、`sleeping` 等等待态保持主 tab 运行中，但 failed 节点导致 run 进入 `needs-review` 时，主 tab 立即进入错误态并释放运行态；历史 blocked 节点按失败注意事项展示，不再弹出人工决策流程；图级 `completed`、`error` 或 `stopped` 也会释放为非运行态。主 Graph tab 右下角的 AI 对话“中止”复用 GraphRunPanel 的 Stop 控制链，会把对应 run / active node 状态落盘为 `stopped`，并且异步 tick 不得用旧状态覆盖已落盘的 stopped。节点 tab 仍按各自 `runPrompt` 执行流独立开始和结束；完成态会在主 Graph tab 追加 `summary` 节点产出的最终总结 assistant 气泡，包含结论、任务总结、验证证据和未完成事项。
- `GraphRunPanel` 采用 full-canvas 运行图布局：主体区域由 SVG edge / arrow + HTML node button 的可视 DAG 占满，不再长期保留下方节点详情分栏；DAG 顶部不再显示“可视图”、Dagre 说明、键盘提示或长“重置布局 / Reset layout”文案，而是收敛为右上角紧凑工具区。节点自动布局已对齐目标系统工作流画布：使用 `@dagrejs/dagre` 的 left-to-right layered layout，以可见代表边参与排布，按当前紧凑节点尺寸等比例收敛目标工作流的 ranksep / nodesep / edgesep / margin 参数，dagre 输出后执行同方向碰撞消解；长标题和多下游节点会增加估算高度，dagre 异常时按 intake / 零入度起点做拓扑层级兜底，并继续渲染所有 valid edges；节点统一渲染为矩形工作流卡片，不再对 start/end 使用胶囊形状；卡片参考目标工作流的类型/tone 思路，用 VS Code 主题变量按 `node.kind` 映射 info/accent/warning/success/neutral/danger tone，并显示 type badge、短标识、标题、状态和 Start / Decision / End / Step 轻量语义 chip。负责人、attempt、prompt/artifact/通信文件等正文细节通过单击节点打开详情弹窗查看，拖拽移动节点后的 click 会被抑制，避免误触发详情；面板不再渲染 run 概览、状态统计、节点列表、recent events 或 finalAnswer 区块。
- GraphRunPanel 的自动布局已吸收目标系统 workflow 画布的 dagre + fallback / collision / 端口 / 视口经验：默认仍为 LR，但内部支持 `LR` / `RL` / `TB` / `BT` 方向；参数调优为当前紧凑节点尺寸下的 `ranksep=124`、`nodesep=88`、`edgesep=44`、`marginX=56`、`marginY=56`、draft extra gap 160；fallback 从所有零入度 roots 入队，多根并行分支不会被误放入 draft 长串；`review_feedback` 和指向上游/更早节点的 `if_fail` 作为 non-ranking return edge，不拉歪主链但仍渲染；collision 按方向横向向下推、纵向向右推；端口评分使用距离和朝向惩罚，并对 fan-out / fan-in / return 边分离端口；首次打开优先居中 selected 节点，其次 running / sleeping / blocked / failed 节点。
- 可视 DAG 的每个节点表面渲染 12 个低调连接点（top/right/bottom/left 各 25%/50%/75%）。每条边会根据 from/to 节点相对位置从 12-port 中自动选择 `fromPort` / `toPort`，并在 SVG path 上保留 `data-from-port` / `data-to-port` 便于排查；同一对节点的多条边、反馈/回环边和同侧连接会有轻微 offset/曲线差异，避免所有线条挤在节点中心或同一个边界点。
- GraphRunPanel 的边中段显示短目的标签：优先从 edge `label` / `condition` / `conditionExpression.description` / 反馈 metadata 说明取义，缺失时展示 edge kind 短标签；可见标签会自动分段为最多两行，单段尽量不超过 4 个字/符，最终可见短标签不超过 8 个字/符，完整长说明继续保留在 SVG title、aria / data 属性和 accessible edge list。已按调度条件经过的边使用 VS Code 主题蓝色显示，未经过边保持原样。节点也会按入度/出度/条件出边给出 Start / Decision / End / Step 轻量语义 chip，用于视觉提示开始、判断和结束，不改变真实 DAG 结构。
- 用户可在 `GraphRunPanel` 内拖拽节点微调当前 run 的可视布局，也可在 DAG 背景上按住鼠标左键拖动画布视口平移；节点拖拽会按当前 zoom 比例换算坐标，并按同一 12-port 规则同步重算 SVG edge path、端口属性和画布尺寸。手动节点位置和缩放值通过 VS Code webview state 按 `graphRunId` 本地保存，刷新/重渲染后可恢复；缩放下拉固定为 25%、50%、75%、100%、125%，默认 75%；重置能力保留为紧凑控件，用于清除当前 run 的手动节点位置回到 dagre 自动布局，不重置 zoom，也不改变 DAG 结构或调度语义。
- `openGraphRun` 支持指定 `graphRunId` / `nodeId` 打开目标 run 和初始选中节点；未指定 run 时会按当前 workspace / CLI 从持久化 store 找最近 Graph run。坏 store 文件按 diagnostics 非阻塞展示，可读 run 仍可打开。
- `GraphRunPanel` 只渲染当前真实可用且已接通的控制：run 级 Continue / “我要说话” / Stop，node 级 Retry failed node、历史 worktree/baseCommit 可用时的 Feedback rollback / 回退上游返工。direct 自动返工是运行时失败恢复路径，不是 GraphRunPanel 上的 checkpoint rollback 按钮。Graph 节点返回 blocked 时宿主会归一为 failed，按 retry、`if_fail` 或后续失败复核路径处理，不再弹出 blocked modal、quick pick 跳过下游或审批 CTA；历史 blocked 节点仍可作为旧运行记录的失败注意事项展示。用户通过“我要说话”提交的补充消息会写入 Graph run 的 `supplementalRequirements`、主沟通文件和 events，并注入后续 Graph 节点 prompt；该能力不承诺打断已经运行中的子节点。GraphRunPanel Stop 和主 Graph tab 的 AI 对话“中止”都进入同一 run stop 控制链。Graph UI 不再在画布 notice 或节点详情弹窗中常驻展示 Stop 能力边界说明；具体 Stop 操作结果或错误仍通过运行消息/状态反馈表达。操作后刷新面板并保留可用 selected node。
- 节点详情弹窗已有证据区，会聚合当前选中节点的 `artifactRef`、`communicationFile`、`acceptance[].evidenceRef`、节点事件和 `finalAnswer.evidence` 引用；证据区展示引用与摘要，不读取证据文件正文。
- `GraphAutoWakeScheduler` 会在扩展激活和 workspace 变化时恢复 sleeping Graph run 的定时器；到期后复用持久化 run 继续 tick 并刷新已打开面板。
- 新增用户可见文案已进入现有 Webview / 后端 i18n 路径，中英文覆盖已通过相关测试。

已知限制同样是当前规格的一部分：

- 尚无图编辑器、模板库、运行前人工调整、DAG 结构编辑、边/节点编辑或图 diff；当前节点拖拽、背景拖拽平移、12-port 连线、短边目的标签、Start/Decision/End/Step 语义 chip 和按节点类型着色的矩形卡片都仅用于调整/增强 GraphRunPanel 内当前 run 的视觉表达，不修改 DAG 结构、调度语义或节点类型体系。
- 尚无完整人工审批工作流；新 Graph planner 不再生成 `human_gate`，运行时不再自动打开审批入口。
- Retry 覆盖 failed 等可恢复节点：direct 模式没有 checkpoint，只会清理目标节点的运行状态、旧 artifactRef、failure、execution/checkpoint 字段和验收 evidence，并在当前工作区状态上重跑节点，不承诺撤销该节点上一次已经写入的文件改动。节点返回 blocked 会归一为 failed，不再提供 blocked modal 跳过下游流程；历史 worktree run 若节点记录了 `baseCommit`，宿主仍可在该独立 worktree 内 `reset --hard` 到节点执行前 checkpoint 并清理未跟踪文件，然后把节点重置为 pending。验证类节点（test/review/merge/summary）failed 或历史 blocked 时，面板只在历史 worktree/baseCommit 可用时提供 Feedback rollback；direct 模式不提供 checkpoint rollback，但若失败分类推荐 `direct_rework` 且存在 active `review_feedback` / `if_fail` 显式返工边，运行时会自动重置声明返工范围并继续调度。缺少可执行返工边或分类不能安全判断时，仍进入 needs-review，由用户或后续节点在当前工作区中处理返工范围。
- 新 Graph run 没有完成态合回步骤，完成态表示改动已直接写入当前工作区。历史 worktree run 的合回逻辑仍保留：目标工作区不相关 dirty 内容可与 Graph diff 同时存在，由 Git 原生 merge 检查决定是否能安全应用；合回不会自动提交或自动解决冲突；成功合回后会清理 Graph worktree、空的 `graph-worktrees` 父目录和对应 Graph 分支，清理失败会进入 `needs-review`。
- Stop 至少保证 Graph run / node 状态和事件落盘为 stopped；主 Graph tab 的 AI 对话“中止”和 GraphRunPanel Stop 共享该语义。只有 active CLI run 已携带 `graphRunId` / `graphNodeId` 映射时才会发送真实 CLI 停止请求，且真实进程是否退出取决于底层 CLI 响应；缺少映射时明确提示未确认真实进程停止。该边界是实现和文档事实，不再作为 Graph UI 固定说明常驻展示。
- 尚未提供模板选择、AI 规划图生成前的用户确认、运行中即时打断重规划、局部返工路径编辑、复杂布尔条件编辑器、自动条件重规划、rollback 预演、证据文件正文读取、自动生成修复分支或可复用流程资产。

## 最新失败案例与恢复策略

最新失败 run 中，`test-schema-definitions` 执行到 2/2 attempts 后进入 `needs-review`。根因不是 SQL 实现继续错误：SQL 定义已经从 `apps/server/src/db.js` 迁移到 `apps/server/src/db/schema/observability.js`，但 `apps/server/test/performance/performance-observation-schema.test.js` 仍读取旧 `db.js` source-contract / canonical source 文本断言；该 `test` 节点又没有声明测试文件 `writeFiles`，因此无法在验证节点内修复旧契约。

该类失败应分类为主 category `missing_write_scope`，signals 包含 `stale_test_contract`，recommendedRecovery 使用 `add_rework_node`，recommendedWriteFiles 包含 `apps/server/test/performance/performance-observation-schema.test.js`。正确优化路径是让 planner 在重构/迁移时提前生成测试契约适配节点，例如 `implement-schema-definitions -> adapt-schema-contract-tests -> test-schema-definitions`，并把 `test-schema-definitions` 的旧契约失败边返工到 `adapt-schema-contract-tests`。

运行态已经落地结构化可见性：`markGraphNodeFailed` 会写入 `GraphNodeRecord.failure` 与 `node.failed.data.failureClassification`；needs-review / idle 文案会列出失败 category、confidence、signals、attemptsExhausted、recommendedRecovery、recommendedWriteFiles 和 nodeDraft。Retry 不能新增 writeFiles，因此对 `missing_write_scope` 不应被包装成单纯重试。

2026-08-03 的 `graph_msg_1785683322596_8d0486c3981e8` 中，`review-extension-refactor` 失败的直接原因是 `src/extensionHost/promptOneShotRuntime.ts` 有 17 处行尾空白；该文件当时是 untracked，新 run 又固定使用 direct 模式，因此只跑 `git diff --check` 不能覆盖这个失败点。失败分类已经能把它识别为 `implementation_bug`，但旧逻辑对 direct run 仍推荐或尝试不可执行的 checkpoint rollback，结果只是重复评审节点而没有回到 `extract-one-shot-runtime` 修复。修复后，direct run 会在 `review_feedback` / `if_fail` 明确指向返工目标时推荐并执行 `direct_rework`，同时新增 `npm run validate:whitespace` 覆盖 tracked 和 untracked 文件的行尾空白检查。

## Graph 语义完成度矩阵

| 语义 | 当前状态 | 已完成 | 仍缺口 |
| --- | --- | --- | --- |
| 节点 | 已完成基础能力 | `GraphNodeRecord`、节点类型、状态生命周期、communication file、artifact/checkpoint、面板节点展示已落地；GraphRunPanel 视觉层会按 `node.kind` 使用 VS Code 主题变量映射不同 tone，统一渲染矩形类型卡片，提示 Start / Decision / End / Step，并渲染 12 个连接点 | 尚无图编辑器、模板库和节点级表单化配置；类型 tone、语义 chip 和端口点只是视觉提示 |
| 边 | 部分完成 | `GraphEdgeRecord`、`GraphPlannedEdgeSpec`、planner materialize、可视 DAG 边、`depends_on` / `if_pass` / `if_fail` / `evidence_for` / `conflicts_with` 类型已入模；`human_approved` 仅作为历史兼容类型保留，新 planner 会拒绝生成；edge 可保留 `label`、`conditionExpression`、`metadata`；GraphRunPanel 会显示分段短边目的标签并基于 12-port 自动选择端口；active `review_feedback` / `if_fail` 可作为验证失败回退上游节点的优先目标，direct run 会沿这些显式边触发自动返工 reset | 证据边和冲突边主要是记录/可视化信号；反馈边已有历史 rollback 控制和 direct reset 控制，但尚无边编辑器、自动条件重规划或可视反馈路径编辑 |
| 条件 | 部分完成 | Scheduler 已识别 active `if_pass` / `if_fail` 入边，并支持有限结构化 `conditionExpression` 求值：`source_status`、`source_acceptance`；`manual` 仅为历史兼容类型，新 planner 会拒绝生成；custom 条件会保守进入失败/复核口径并输出可读 blocker | 尚无复杂布尔条件编辑器、数据谓词、运行中自动重规划或条件边 UI 编辑 |
| 依赖 | 已完成基础能力 | `dependsOn` 与 active `depends_on` 边共同决定 ready set；缺失依赖、未通过且未 skipped 的依赖会进入 blocker；历史 Feedback rollback 会沿依赖图重置上游返工节点及下游节点，direct rework 会优先按反馈边 metadata 声明范围重置 | 尚无跨图模板依赖、外部资源依赖和可编辑 descendant reset 预览 |
| 并发 | 已完成基础能力 | AI planner prompt 要求默认寻找可并行分支并生成 fan-out/fan-in DAG；planner 漏填 `plannedGraph.maxConcurrent` 时，materialize 会按首批无冲突根节点推断并发上限；Scheduler 继续选择同批 ready nodes，扩展侧按 `min(run.maxConcurrent, 5)` 并行派发独立节点 tab；未声明 `writeFiles` / `conflictGroup` 的 ready 节点不再仅因空 scope 被串行化 | 尚无全局资源预算、跨进程队列、优先级和并发成本面板 |
| 冲突组 | 已完成基础能力 | `conflictGroup` 和 `writeFiles` 路径重叠可阻止同批/运行中冲突；未声明 scope 不再自动制造冲突，真实写入节点必须通过 prompt/规划约束声明 `writeFiles` 或 `conflictGroup` | 只能做声明式与路径级冲突判断，尚无语义冲突检测、自动合并策略或冲突解释 UI |
| 风险关卡 | 历史兼容 | `human_gate` / `human_approved` 类型仍可读取旧运行记录；新 Graph planner 会拒绝生成，scheduler/kernel 不再把它们暴露为人工等待 action | 尚无审批表单、风险说明采集、驳回原因、多人审批和人工步骤产物采集；当前运行时不走人工审批流程 |
| 重试 / 返工 | 部分完成 | failed 节点可 Retry；节点 blocked 结果会归一为 failed 并走 retry / `if_fail` / failed 复核路径；新 Graph run 使用 direct 模式，只在当前工作区状态上重跑节点，不自动撤销已写文件；direct run 的验证/评审失败若分类建议 `direct_rework` 且存在显式 `review_feedback` / `if_fail` 边，会重置声明 scope、返工目标和失败源节点并继续调度；历史 worktree run 在 baseCommit 可用时仍可回滚到节点前 checkpoint 并重新调度；验证类节点只在历史 worktree/baseCommit 可用时 Feedback rollback 到上游 checkpoint，记录返工目标选择、候选、reset scope、feedback reason 和触发 edge，并把被重置节点写入 `rework` | direct 模式无 git rollback/checkpoint；尚无局部图编辑、条件边重规划、自动修复分支生成和可视 rollback 预演 |
| 失败分类 | 已完成基础能力 | 失败节点可保存 `GraphFailureClassification`；`node.failed` event data 同步写入分类；needs-review / idle 文案展示 category、confidence、signals、recommendedRecovery、recommendedWriteFiles 和 nodeDraft；`stale_test_contract` / `missing_write_scope` 可推荐新增测试适配返工节点；direct run 可对有显式反馈边的 `implementation_bug` 推荐 `direct_rework` | 首版不自动应用 node/edge draft，不自动扩大 writeFiles，也不读取大型证据文件正文做深度分析；`direct_rework` 仅在已有反馈边和声明范围足够明确时自动执行 |
| 睡眠 | 已完成基础能力 | `sleep` 节点支持 `wakeAt`、sleeping 状态、auto wake 恢复和到期继续 tick | 尚无日历式 UI、外部守护进程、跨设备唤醒和复杂等待条件 |
| 完成证据 | 部分完成 | 节点 `## JSON`、communication file、events.jsonl、artifactRef、summary finalAnswer、`executionCwd` 和完成态 execution event 构成基础证据链；历史 worktree run 可能额外保留 checkpoint commit 与 merge-back event；节点详情已有 Evidence/证据区聚合选中节点证据引用、事件和最终证据 | direct 模式无 checkpoint/merge-back 证据；证据区不读取文件正文；尚无证据边聚合视图、验收覆盖率检查和证据缺失自动阻断矩阵 |
| 节点全图感知 | 已完成基础能力 | 后续派发节点的 prompt 会包含全图拓扑、当前位置、上下游链路、并发/冲突提示和下游职责边界 | 已运行中的节点不会被即时打断重注入；后续仍可做运行中 replan / prompt diff / 用户确认 |

外部舆论和研究已经出现几条稳定信号：

- Vibe coding 实践手册把“workflow”和“agent”区分开：步骤可预知时应使用 workflow；路径未知时才使用 agent loop，并要求有独立 stop condition、状态文件和 maker-checker 验证。
- Agentic coding 讨论普遍承认底层是 prompt/context/plan/execute/test/refine 的 loop，但真正差异来自 loop 外围的 retrieval、tool use、planning、sandboxing、review 和 definition of done。
- 多 agent 同时修改同一项目时，问题不再是“单 agent 能不能继续 loop”，而是调度器、共享状态、依赖图、冲突隔离、合并验证和风险关卡。
- “Vibe Graphing”研究把自然语言意图编译成可编辑 workflow specification，再编译为 executable directed graph；这正好对应本设计里的 Graph 模式语义。
- 近期 benchmark 和 workflow 优化论文也开始区分 reusable template、run-specific realized graph、execution trace，说明 Graph 不只是 UI 图，而是可复盘、可优化、可比较的运行结构。

## 问题

Loop 模式解决的是“让一个主任务持续拆分、执行、复核，直到完成”。它适合目标逐步澄清、实施路径动态变化的任务。但当任务本身存在多个独立维度、明确依赖、互斥写入、评审关卡或可复用流程时，Loop 会暴露几个限制：

- 任务结构被折叠进主任务 prompt 和轮次记录，用户难以在运行前看到整体拓扑。
- 并发只发生在主任务当前返回的 `subtasks` 批次里，跨轮次依赖无法作为一等对象表达。
- 返工路径通常表现为“主任务再派一轮”，而不是“某个评审节点驳回某个实现节点并回连到修复节点”。
- 验收、外部批准、红蓝质询、测试、合并等不同性质的步骤都混在 Loop 轮次中，排障时需要阅读 transcript 才能还原结构。
- 多 agent 的成本、风险和依赖关系缺少可视化预算面，容易出现“看起来一直在忙，但不知道图上哪里卡住”。

Graph 模式要解决的是：在复杂任务开始前或首轮规划后，把工作拆成显式节点和边，由宿主按图调度、恢复、观察和收束。

## 目标

- 新增一个面向复杂任务的 Graph 编排模式设计，语义上区别于现有 Loop。
- Graph 能表达节点、边、条件、依赖、并发、冲突组、失败分支、风险关卡、重试、睡眠和完成证据。
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
| Node | Graph 中可调度或可观察的工作单元，例如规划、实现、测试、评审、风险复核、总结 |
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
  executionMode?: "worktree" | "direct";
  directExecution?: { cwd: string; reason?: string; createdAt?: number };
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
  failure?: GraphFailureClassification;
  rework?: GraphNodeReworkRecord;
  executionCwd?: string;
  worktreeCwd?: string;
  baseCommit?: string;
  commit?: string;
};
```

### GraphFailureClassification

```ts
type GraphFailureCategory =
  | "stale_test_contract"
  | "missing_write_scope"
  | "environment_failure"
  | "implementation_bug";

type GraphFailureRecoveryAction =
  | "retry_node"
  | "feedback_rollback"
  | "direct_rework"
  | "add_write_scope"
  | "add_rework_node"
  | "manual_review";

type GraphFailureRecoveryRecommendation = {
  action: GraphFailureRecoveryAction;
  summary: string;
  targetNodeId?: string;
  recommendedWriteFiles?: string[];
  nodeDraft?: GraphPlannedNodeSpec;
  edgeDrafts?: GraphPlannedEdgeSpec[];
};

type GraphFailureClassification = {
  category: GraphFailureCategory;
  confidence: "low" | "medium" | "high";
  summary: string;
  signals: string[];
  attemptsExhausted?: boolean;
  recommendedRecovery?: GraphFailureRecoveryRecommendation;
};
```

该字段是向后兼容的失败分析快照，不替代 `lastError` 原文，也不会自动改写 graph。运行时分类器会从 error、节点 result、acceptance、artifact summary 和候选路径中抽取 signals；store / artifact normalize 只保留合法 category 与 recovery action。`missing_write_scope` 场景首版推荐 `add_rework_node` / `recommendedWriteFiles` / nodeDraft / edgeDrafts，供主 tab 或面板展示给用户，不自动扩大失败节点的写入授权。

### GraphNodeReworkRecord

```ts
type GraphNodeReworkRecord = {
  sourceNodeId: string;
  targetNodeId: string;
  resetAt: number;
  resetScopeNodeIds: string[];
  reason?: string;
  edgeId?: string;
  edgeKind?: GraphEdgeKind;
};
```

该记录只描述已发生的返工重置事实：哪个失败/阻塞节点触发、实际返工目标、实际 reset 范围、原因和触发边。它不等同于可编辑 rollback 预演。历史 worktree Feedback rollback 仍按目标节点及其下游保守重置；direct rework 会优先使用 edge metadata 的 `reworkScopeNodeIds`，未声明时才回退到目标节点及其下游，并始终把返工目标和失败源节点纳入 reset scope。

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
  label?: string;
  condition?: string;
  conditionExpression?: GraphEdgeConditionExpression;
  metadata?: GraphEdgeMetadata;
  active: boolean;
};

type GraphEdgeConditionExpression = {
  type: "source_status" | "source_acceptance" | "manual" | "custom";
  operator?: "equals" | "not_equals" | "in" | "not_in";
  status?: GraphNodeStatus;
  statuses?: GraphNodeStatus[];
  acceptanceId?: string;
  expected?: boolean | string | number;
  description?: string;
};

type GraphEdgeMetadata = {
  label?: string;
  rationale?: string;
  evidenceRef?: string;
  feedbackReason?: string;
  reworkTargetNodeId?: string;
  reworkScopeNodeIds?: string[];
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

`graph.json` 保存 realized graph 快照；`events.jsonl` 保存追加式运行事件；`nodes/<nodeId>.md` 保存节点 prompt、输出、验证证据和人工批注；worktree 模式下 `graph-worktrees/<graphRunId>/` 保存该 run 的独立 git worktree；direct 模式下不会创建该目录，节点直接写当前工作区。文件状态和结构化事件共同构成执行事实来源；worktree 模式额外用 git checkpoint 支撑回退，内存 scheduler 只是执行视图。

## 调度语义

Scheduler 每次从持久化状态读取图并计算 ready nodes：

1. 节点 `dependsOn` 全部处于 `passed`，且没有 active 条件边或 `if_fail` 未满足。
2. 节点自身不是终态，且尝试次数未超过 `maxAttempts`。
3. 节点声明的 `writeFiles` 与当前 running 节点无重叠。
4. `conflictGroup` 相同的节点默认串行，除非模板明确允许并发。
5. `conditionExpression` 只支持 `source_status`、`source_acceptance` 的有限求值；`manual` 仅作为历史兼容类型读取，新 planner 会拒绝生成；`custom` 或缺少必要字段的表达式会保守进入失败/复核口径，并在 blocker 中带出 edge kind、condition 和 conditionExpression。
6. `human_gate` 节点不再由运行时推进；新 planner 会拒绝生成，旧记录只作为历史兼容展示。
7. `sleep` 节点写入绝对 `wakeAt`，到期后重新计算 ready set。
8. 同一批 ready nodes 默认最多并发 5 个，沿用 Loop 已验证的保守上限。

节点完成后只允许通过结构化结果更新状态：

- `passed`：产物满足 acceptance，宿主读取节点 communication file 的 `## JSON` 后更新节点状态；worktree 模式会创建 checkpoint commit，direct 模式只记录 execution cwd；随后激活后续 `if_pass` 边。
- `failed`：运行失败但可重试，激活 retry 或 `if_fail` 边；执行器返回 blocked 时也归一为 failed。
- `blocked`：仅作为历史记录兼容状态读取，新 Graph 运行时不再产生人工阻塞。
- `skipped`：条件边未命中或历史人工跳过；不等同于 `passed`。

## CLI 适配

Graph 节点不是新的 CLI 类型。每个可执行节点都转换为当前 runner 能理解的一次任务：

- `implement` 节点：类似 Loop 子任务；worktree 模式运行 cwd 是 Graph run 的独立 git worktree，direct fallback 模式运行 cwd 是当前工作区。基线五节点图默认授权实现、测试、评审节点写入整个执行目录；只有 worktree 模式通过 checkpoint commit 支撑回退。
- `review` / `test` 节点：优先只读，除非模板显式允许写入测试或修复建议。
- `debate` 节点：可复用现有红蓝辩论 artifact 和共识校验能力。
- `summary` 节点：读取 Graph events 和 node artifacts，生成最终答复。
- `human_gate` 节点：历史兼容类型；新 Graph planner 不生成，运行时不再等待 UI 输入。

OpenCode 仍走 one-shot / attach 机制；Codex / Claude 继续按现有交互或一次性执行能力，不因 Graph 引入统一模型 SDK。

## UI 设计

当前 UI 目标是“可观察、可恢复、可执行最小安全控制”，不是图编辑器。

- 输入区模式：已新增 `Graph` 选项，运行时进入独立 Graph 分支。
- 运行气泡：普通“打开 Graph 运行图”动作只由主 Graph tab / 图级消息按同一 run 输出一次，不在 Graph 节点/子任务会话里重复展示；该 action 可携带 `graphRunId`、可选 `nodeId` 和自定义 label。新运行时不再为 `human_gate` 生成审批 CTA。
- 会话标签与状态行：Graph tab 显示 `🗺️` 标识；active Graph tab 识别到 `graphRunId` 后，在底部运行状态行固定显示“打开 Graph 图”按钮。
- 内容区面板：主体是 full-canvas SVG/HTML 可视 DAG，不再保留下方常驻节点详情分栏；DAG 节点使用 `@dagrejs/dagre` 自动布局，并支持节点拖拽微调、背景左键按住拖拽平移、按 `graphRunId` 本地持久化节点位置和 zoom。右上角紧凑工具区提供 25%、50%、75%、100%、125% 缩放下拉，默认 75%，Reset 仅为紧凑重置控件；节点矩形保持紧凑，只在图上显示标题、状态和 Start/Decision/End/Step 视觉 chip，正文细节通过单击节点打开的详情弹窗查看，拖拽移动不会误触发详情；详情弹窗包含 Evidence/证据区和当前真实可用的节点控制；概览、状态统计、节点列表、recent events 和 finalAnswer 不在面板内渲染。
- 图视图：已使用原生 SVG 渲染边、path、marker、arrow 和边目的标签，使用 HTML button 渲染节点；每个节点显示 12 个连接点，边会按节点相对位置自动选择 `fromPort` / `toPort` 并为多边/反馈边增加轻微曲线差异；已经过边显示为主题蓝色，未经过边保持原样；旧记录缺少 `run.edges` 时可从 `dependsOn` fallback 生成 `depends_on` 边。
- 自动布局：默认展示仍为 LR，但内部已支持 `LR` / `RL` / `TB` / `BT`；fallback 会从所有零入度 roots 入队；`review_feedback` 与上游 `if_fail` 回边不参与主 ranking；collision、端口评分和初始视口居中均按目标系统 workflow 画布经验调优。
- 节点状态：pending、ready、running、passed、failed、blocked、sleeping、skipped。
- 操作：只显示真实接通且当前状态允许的 Continue / “我要说话” / Retry / Feedback rollback / Stop；不可用操作直接隐藏。GraphRunPanel Stop 与主 Graph tab AI 对话“中止”必须共用同一 Graph stop 控制链。Stop 文案必须同时说明状态已落盘，以及真实 CLI 进程停止只是对已映射 active run 发起请求、未必已确认退出。
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
- 高风险操作：数据库迁移、权限变更、删除文件、发布动作在重新启用模板前必须设计显式安全确认机制；当前运行时不走 human gate。
- 证据边：某个测试节点的结果是最终总结里某个验收项的证据，而不是散落在 transcript。
- 局部返工：一个 review 节点可以只驳回相关实现节点，不必把整个 Loop 推回下一轮。

## Graph 比 Loop 先进在哪里

Graph 的先进性不在“名字更潮”，而在控制面升级：

1. **从回合控制升级为拓扑控制**：Loop 主要按轮次推进；Graph 按依赖图推进，宿主知道哪些节点已完成、哪些节点阻塞、哪些节点可并发。
2. **从隐式计划升级为显式计划**：Loop 的计划藏在主任务消息和沟通文件里；Graph 的计划是可读、可存档、可复盘、可比较的 realized graph。
3. **从批次并发升级为依赖并发**：Loop 只能并发当前轮次的子任务；Graph 可以跨阶段发现 ready nodes，同时受 `writeFiles`、`conflictGroup` 和 gate 约束。
4. **从整体返工升级为局部返工**：Loop 失败常表现为下一轮重新规划；Graph 可以把失败边接回具体节点，只重跑受影响部分。
5. **从 transcript 排障升级为状态排障**：Loop 需要读聊天记录还原因果；Graph 直接暴露节点状态、边条件、attempt、证据和阻塞原因。
6. **从 agent 自证升级为外部关卡**：Graph 能把测试、评审、红队、外部批准作为独立节点，避免同一个 agent 计划、实现又自评。
7. **从一次性任务升级为可复用流程资产**：Graph Template 可以沉淀“复杂功能交付”“安全修复”“发布准备”等流程，下一次不必重新靠 prompt 约束。

但 Graph 不是所有场景都更优。简单问答、小修小补、探索性 debug、路径未知且需要快速试错的任务，Loop 更轻、更快、提示成本更低。Graph 应用于复杂、高风险、多人/多 agent、强验收或可复用流程。

## 分阶段落地

### Phase 0：设计和只读投影

- 完成本设计和引用入口。
- 从现有 Loop task record 生成只读 Graph 投影视图，验证用户是否需要图式排障。
- 不改变 Loop 运行行为。

### Phase 1：最小 Graph 运行内核

- 已新增 `GraphRunStore`、`GraphNodeRecord`、`GraphEdgeRecord`、`graph.json` 和 `events.jsonl`。
- 已支持用户从 Webview 选择 `Graph` 并启动 AI-planned realized graph：扩展先运行 planning-only `plan` 节点，读取并校验 planner artifact 中的 `plannedGraph`，再 materialize 为包含分支、fan-out/fan-in、测试、评审、sleep、merge 或 summary 的真实 DAG；planner prompt 已强化为默认并行优先，要求独立无冲突分支不要串行，并要求 `plannedGraph.maxConcurrent` 反映首批无冲突分支数；规划无效时 planner 节点记为 failed 并继续按失败路径调度，而不是进入人工审批。
- planner prompt 已要求重构/迁移场景检查旧 source-contract、文本快照、路径断言和测试 canonical source，必要时规划独立测试适配/契约更新节点并声明测试 `writeFiles`。
- 已支持 `plan`、`implement`、`test`、`review`、`summary` 的 CLI 节点执行；`sleep` 已有 kernel/scheduler/lifecycle 与自动唤醒路径；`human_gate` 仅保留历史类型兼容，新 planner 输出会被拒绝。
- Scheduler 已作为本地纯函数落地；Graph 记录会保留 planner 输出的 DAG 和 maxConcurrent，planner 漏填 maxConcurrent 时会从 materialized graph 的首批无冲突根节点推断默认值，扩展侧按 `min(run.maxConcurrent, 5)` 派发同批 ready nodes；调度冲突只来自显式 `conflictGroup` 或重叠 `writeFiles`，未声明 scope 的 ready 节点不再被隐式全局写锁串行化，并且每个节点都会创建独立 Graph 节点 tab，避免并行节点共享同一主 tab 互相 stop。
- 已复用现有 CLI runner 和 Loop 子任务隔离经验，节点 prompt 明确授权范围、输入 artifact、完成标准、验证要求、全图拓扑、当前位置和下游职责边界。prompt 中的直接上下游/上下游链路只使用 active structural/blocking edge 口径，完整 edge 清单仍保留所有边用于语义说明。

### Phase 2：Graph 恢复与交互增强

- 已在 GraphRunPanel 上新增可控的恢复与 mutation 能力，并保持不可用操作不渲染。
- 已支持从持久化 store 打开指定 run 或当前 workspace / CLI 最近 run，读取坏 store 时以 diagnostics 非阻塞降级。
- 已支持 sleeping / needs-review / error run 的 Continue / Resume，复用现有 Graph executor / `runGraphPrompt` 安全路径继续 tick，不新建 run。
- 已支持最小节点 mutation：Retry failed node、Feedback rollback failed/历史 blocked 验证类节点到上游 checkpoint、direct run 中基于 `direct_rework` 建议和显式 `review_feedback` / `if_fail` 边自动重置返工范围、Stop run，并在操作后刷新面板、尽量保留 selected node；Retry 与 direct rework 都会清理旧 artifact/execution/failure/acceptance evidence，避免 stale 证据污染后续执行；blocked 执行结果会归一为 failed 并走 retry / `if_fail` / failed 复核路径，不再弹出阻塞 modal、跳过下游 quick pick 或 human gate 审批入口。
- 已支持结构化条件/边基础字段：planner/store 保留 edge `label`、`conditionExpression`、`metadata`，scheduler 对支持的条件表达式求值并输出可读 blocker，prompt 注入边语义、metadata 和返工记录；scheduler 与 prompt builder 共享 `graphEdgeSemantics.ts`，保持 active structural/blocking edge、blocking edge 和 rework trigger 的判断一致。
- 已支持结构化失败分类：失败节点落盘 `failure`，`node.failed` event data 写入 `failureClassification`，needs-review / idle 文案展示分类、signals、推荐恢复动作、推荐写入文件和建议返工节点草案；direct run 对存在显式反馈边的实现缺陷会推荐 `direct_rework`，worktree/旧运行仍推荐 `feedback_rollback`。
- 已支持证据区：节点详情聚合当前节点 artifact、沟通文件、验收 evidenceRef、事件与 finalAnswer evidence 引用，但不读取外部证据文件正文。
- 已支持 Graph auto wake：扩展激活或 workspace 变化时恢复 sleeping run 定时器，到期后 resume/tick。
- 尚未支持从失败节点自动生成补充需求、局部返工路径编辑、复杂布尔条件编辑器、自动条件重规划、rollback 预演、完整审批表单/驳回/多人审批、证据文件正文读取、图编辑器或模板库。

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
- 会修改文件的节点必须声明 `writeFiles` 或 `conflictGroup`；未声明 scope 的节点在调度层不再被当作隐式全局写锁，必须被 prompt/规划约束视为不写文件。需要串行保护时应显式声明 `conflictGroup` 或重叠 `writeFiles`。
- 后续启用高风险节点模板前必须重新设计显式安全确认机制；当前 Graph 运行时不再使用 `human_gate` 作为人工审批流程。
- 节点 prompt 中必须包含授权范围、输入 artifact、输出 artifact、完成标准和验证要求。
- 生命周期变更会回写持久化 store 与快照；跨进程恢复和面板操作每次派发前重新读取状态，避免旧异步回调复活任务。
- Stop 不应夸大外部进程终止能力：只有存在 active CLI run 映射时才向真实 CLI 发送停止请求，真实进程是否退出取决于底层 CLI 响应；没有映射时只保证 Graph 状态落盘，并明确提示未确认真实 CLI 进程停止。
- 事件日志不得记录密钥、token、生产地址或客户数据。
- 节点通过 `runPrompt` 执行时必须把启动失败、runner 异常和最终失败回传给 Graph kernel；失败节点应进入 `failed` 并触发 retry / `if_fail` / failed 复核路径，不得被外层 UI 错误处理吞掉后继续当作 passed。
- Graph 运行完成前不得把未通过验收的节点结果写成最终答复。

## 文档与测试影响

Phase 2 和后续 Graph 视觉优化已同步产品规格和功能清单，相关事实来源为 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。用户可见能力按“Graph 最小运行内核 + `@dagrejs/dagre` full-canvas 可视 DAG 自动布局 + LR/RL/TB/BT 内部方向能力 + 多根 fallback + non-ranking 回边 + 方向感知 collision + 12-port 自动连线 + 分段短边标签 + 已经过边主题蓝色高亮 + 按节点类型着色的矩形卡片 + Start/Decision/End/Step 语义 chip + 节点拖拽微调且不误触发详情 + 背景拖拽平移 + 初始居中 selected/running/sleeping/blocked/failed 节点 + 单击节点详情弹窗 + 按 `graphRunId` 本地持久化节点位置和 zoom + 默认 75% 缩放 / 25-125% 固定下拉 + 紧凑重置控件 + 主 Graph tab 唯一普通打开入口 + 持久化恢复 + 最小控制 + auto wake + 验证失败反馈回退 + direct 自动返工 + 结构化失败分类 + 结构化条件边 + blocked 归一 failed + 证据区 + Stop 边界文案”声明，不把未实现或已下线的图编辑器、模板库、完整 human gate 表单/驳回/多人审批、运行时人工审批、局部返工路径编辑、复杂布尔条件编辑器、自动条件重规划、rollback 预演、自动应用返工节点草案或证据文件正文读取写成已完成。

最终验证记录：

- `npm run build`：通过。
- `node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`：通过，108/108。
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
