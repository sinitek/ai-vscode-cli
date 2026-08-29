# Sinitek CLI VS Code 插件能力规格

- 状态：active
- 适用范围：当前仓库已实现能力
- 相关设计：`.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- 历史来源：原 `docs/插件功能清单.md`、`docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md`

## 1. 产品定位

插件的目标是在 VS Code 中提供统一的 AI 对话工作台，让用户在不离开编辑器的前提下，调用本机的 Codex、Claude、OpenCode CLI 完成对话、任务执行、配置管理与结果查看。Gemini 已从当前 AI 对话和配置中心支持范围移除。

## 2. 当前能力边界

### 已覆盖

- 内置聊天侧边栏与状态栏入口
- Codex / Claude / OpenCode 三个平台统一接入
- Codex / Claude 交互式续接会话；Codex 切换插件侧模型或配置档案时仍复用现有 `threadId`，并将当前 TOML 根级 `model_provider` 作为 app-server `thread/start` / `thread/resume` 的 `modelProvider`。该恢复不会重放旧工具调用或历史事件；若目标 provider/account 无法解密历史 reasoning/compaction 内容，则显示 app-server 原始错误。
- 多标签会话并行管理
- Prompt 上下文增强、附件上传、任务流观察
- P0 性能与内存硬化：停止/停用可靠收口、OpenCode 输出有界、Run Stream/Assistant delta 低复杂度渲染、附件上传双端限制
- Graph 模式运行内核、可视 DAG 面板与恢复交互
- 插件侧长期记忆开关与本地记忆层
- 规则管理、模型管理、思考模式、配置中心
- Skills、MCP、备份、导出、日志和国际化

### 明确未覆盖

- 不提供远程服务端托管
- OpenCode 作为新增支持目标接入；官方 TUI commands 文档列出 `/compact`（alias `/summarize`），说明为 compact current session；官方配置文档还提供 `compaction.auto`（默认 `true`）、`compaction.prune` 和 `compaction.reserved`，并有 `OPENCODE_DISABLE_AUTOCOMPACT` 环境变量用于关闭自动上下文压缩。插件侧手动/自动压缩支持应优先复用当前会话运行链路，若 OpenCode 当前模式无法走交互 Runner，则只能通过官方 slash command / 后台 fallback 路径执行，不能宣称完全等同 Codex app-server 压缩语义
- Gemini 已移除，不再作为当前支持 CLI
- 不负责替代官方 CLI 本身的安装、鉴权和全部高级能力
- Graph 当前不提供图编辑器、模板库、完整人工审批工作流、局部返工路径编辑、复杂布尔条件编辑器、任意条件重写/可视化重规划、rollback 预演或证据文件正文读取；真实 CLI 停止只会在存在 active Graph run/node 映射时发起请求，不能保证外部进程已退出

## 3. 用户可见能力

### 3.1 对话入口与基础导航

用户可以通过以下方式进入插件：

- Activity Bar 侧边栏面板
- 状态栏入口
- 命令面板命令

当前命令包括：

- `sinitek-cli-tools.selectCli`
- `sinitek-cli-tools.runCli`
- `sinitek-cli-tools.runCliThinkingOn`
- `sinitek-cli-tools.runCliThinkingOff`
- `sinitek-cli-tools.openPanel`

### 3.2 多 CLI 统一接入

用户可以：

- 在面板内切换当前 CLI
- 为不同 CLI 配置不同命令与参数
- 在同一 UI 下查看统一格式的消息与 trace

### 3.3 执行模式

- Codex / Claude：支持交互式会话续接
- OpenCode：作为 Codex、Claude 之外的新支持目标，按插件通用 CLI 配置、统一 UI、会话存档、配置中心和模型/规则能力接入；当前 one-shot / 并行任务通过 `opencode run --auto [message..]` 启动。OpenCode 明确分成两个配置文件：模型/Provider 配置中心只维护 `~/.opencode/config.json`，全局 MCP 市场维护官方 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`，不再要求或生成 `~/.opencode/.env`；聊天面板在 Loop / Graph 模式按“主模型 / 子模型”两行展示各自模型与思考力度，Vibe（coding）模式仅展示并使用主模型，底层 `model` / `small_model` 仅作为 OpenCode CLI 配置字段适配，模型候选来自 active config 的 `provider.<id>.models` 且没有模型管理入口，正常 option 显示模型 `name`（缺失时回退 model id）；思考力度动态 option 直接显示 raw `value`，按精确 provider/model 的 payload 原顺序渲染，不能以固定等级重排；选择配置默认 ref 会清除角色临时覆盖，选择其他项使用 exact `provider/model` ref
- OpenCode 普通任务、并行任务和 Loop 主任务都以当前 VS Code 工作区作为权威执行目录。插件除设置 child process 的 spawn cwd 外，还同步覆盖 child env `PWD`，避免 OpenCode `run` 的内部请求继承 extension host 的旧目录并把新会话错误创建到 `/`；因此新会话的模型、文件搜索与工具调用直接面向当前项目，不需要用户再次选择同名仓库。Loop 子任务例外：它们在链接到同一工作区内容的临时隔离根运行，以屏蔽项目规则自动发现。修复前已经绑定 `/` 的历史 OpenCode 会话不会改写原始 CLI 数据，升级后需要新建一次对话会话。
- OpenCode one-shot 与并行任务在进程 `code=0` 但当前尝试没有非 thinking assistant 正文时，不会把成功退出误当成完成，而是进入既有 hidden retry；重试耗尽后才显示并持久化明确错误。Loop 后续主任务轮次会复用最初用户消息作为会话锚点，但完成判定只认当前进程尝试的正文，历史轮次的 `LoopMainDecision` JSON 不能替当前空响应通过判定。
- Loop 主任务在已有远端 OpenCode session 的首次无 provider-error 空成功响应后，会在下一次 hidden retry 启动新 session 并重新发送完整主任务 prompt；捕获新 `sessionID` 后保留旧会话历史、同步 tab 和任务记录到新 session。该恢复不会用于普通任务、Loop 子任务、含 provider JSON error 的响应，也不会在同一运行内重复 rollover。
- OpenCode 所有任务路径默认注入官方 `--auto`，自动批准仍处于 `ask` 的权限请求；默认 `external_directory: ask` 因而支持跨工作目录读写。插件不把 runtime permission 强制覆盖为 `allow`，用户配置、agent 配置及 OpenCode 默认规则中的显式 `deny` 仍优先，包括 `.env` 等受显式拒绝规则保护的文件。
- OpenCode one-shot 只保留 60 秒启动 watchdog：只有启动后完全没有父 JSONL、error/status/progress 或子代理会话活动才进入 hidden retry；收到首个父事件或子代理更新后立即解除。OpenCode 父 `run --format json` 不转发内部子代理增量时，插件先启动受管 `opencode serve` 并通过 `/global/health` 确认就绪，再以 `run --attach` 执行父任务；公开 SSE 事件触发子会话消息快照刷新，并每 60 秒全量补捞 children/message/status。每个当前尝试新建的子 session 固定更新一个独立 assistant 气泡；多个子代理按 session ID 隔离，完成、失败或中断原位更新。服务启动失败时显示一次监控降级状态但不阻断父任务，SSE 重连指数退避到最长 60 秒；任务结束、报错或停止会清理服务、订阅和轮询，不读取 OpenCode 私有 SQLite。
- 性能与内存硬化：用户停止、扩展停用或 reload 时会统一阻止新任务并尽力停止主进程、并行进程、交互运行、Codex app-server active child 集合和受管 OpenCode server；Codex app-server 使用独立进程组并在 `EAGAIN` 等 spawn 失败时收口内部 promise/readline 与诊断日志，避免长期使用后残留进程或句柄耗尽；OpenCode one-shot / parallel / interactive raw stdout/stderr 只保留有界 tail，JSONL 未完成行限制为 64 KiB，activity 检测使用增量 tracker 避免按 chunk 重扫完整历史。Run Stream 每个 tab 有记录数、单条字节和总字节预算，overlay 关闭时不构建完整记录 DOM，导出会包含截断 metadata。Assistant delta 流式阶段使用轻量文本更新，idle/final 阶段再做完整 Markdown 渲染。附件上传在 Webview 预检和 Extension Host 保存前复验，最多 10 个文件、单文件 20 MiB、不限制总大小；超限时显示英文或中文拒绝提示。
- AI 对话面板支持 `coding / loop / graph` 三种顶层交互模式；旧配置中的 `plan` 会按 `coding` 兼容归一化。Graph 模式面向复杂任务的显式工作图编排，适合需要节点状态、依赖、事件和验证证据可观察的任务；简单问答、小修小补和探索性调试仍优先使用 coding 或 Loop。
- Codex / OpenCode 模型选择按模式切换：Codex 普通 Coding 仍显示并传递单个 `model`，切到 Loop 或 Graph 时显示主模型/子模型两个选择器，并为两个角色分别显示 Codex 思考力度选择器；OpenCode 在 Loop / Graph 中显示并使用主模型/子模型角色，Vibe（Coding）仅显示并传递主模型，底层 `model` / `small_model` 仅作为 OpenCode CLI 配置字段适配。Webview payload 使用 `loopMainModel` / `loopSubtaskModel`、`loopMainThinkingMode` / `loopSubtaskThinkingMode` 或对应 OpenCode main/subtask 状态，PanelState 通过 CLI 维度回放。Loop 主任务、主持/复核和续跑使用主模型及主任务思考力度，Loop 子任务使用子模型及子任务思考力度；Graph planner、运行时追加的 `replan-*` 续跑规划节点和最终 `summary` 节点使用主模型及主任务思考力度，其他 materialized 执行节点使用子模型及子任务思考力度。Loop / Graph 缺少子模型时运行时回退到主模型或单模型，并在 Graph run / 节点 prompt / diagnostics 中记录 `modelFallback` 原因；Vibe 不因缺少子模型阻断，也不覆盖 `small_model`。
- Graph 模式已完成 Phase 1 最小运行内核与 Phase 2 恢复交互：Webview 模式下拉可选择 Graph，发送后端进入 `interactiveMode=graph` 的 `runGraphPrompt` 分支；Graph 入口默认不注入插件侧长期记忆 recall，节点 `runPrompt` 结束也不会自动写入长期记忆。扩展先创建 planning-only Graph run，仅包含保留 `plan` AI planner 节点；planner 必须在节点 communication file 的 `## JSON` 中输出 `plannedGraph.nodes` 和 `plannedGraph.edges`，宿主校验后 materialize 为 AI 规划的 realized DAG（可包含分支、fan-out/fan-in、测试、评审、sleep、merge 和 summary；human_gate / human_approved / manual 会被 planner materialize 拒绝），规划无效时 run 进入 `needs-review` 而不执行固定线形 fallback。planner 需要输出中文节点标题；宿主对常见英文标题做中文兜底，GraphRunPanel 打开旧持久化 run 时也按同一规则显示中文标题。Graph 使用 `~/.sinitek_cli/graph-runs/<workspaceKey>/<cli>/<session-or-__pending__>/<graphRunId>/graph-runs.json`、`~/.sinitek_cli/graph-communications/<graphRunId>/graph.json`、`events.jsonl` 和 `nodes/<nodeId>.md` 保存状态、事件和节点沟通文件。节点执行继续复用现有 CLI runner / `runPrompt` 路径，并以 `taskRole="subtask"` 固定在当前项目工作区 direct cwd 中运行；新 Graph run 不再创建 Graph 专用独立 git worktree、checkpoint commit、merge-back 或 cleanup 流程。每个节点 prompt 都注入全图拓扑、当前位置、节点/边清单、直接上下游、上游/下游链路、同批 active 节点、冲突线索和后续 test/review/merge/summary 职责边界；`review` 节点还会从上游节点 `writeFiles`、communication file 和 `artifactRef` 生成独立评审范围，要求按这些候选改动文件过滤 `git status` / `git diff`，不因范围外 dirty workspace 改动单独判失败；每个节点结束后宿主会读取节点 communication file 的 `## JSON` 作为真实状态。direct 模式只保存 `executionCwd`，完成态表示改动已直接写入当前工作区；failed test/review/merge/summary 节点若分类建议 `direct_rework` 且存在 active `review_feedback` / `if_fail` 显式返工边，运行时会自动重置声明返工范围并继续调度，但不做 git rollback/checkpoint。历史 worktree run 仍可读取 `worktree` metadata，并保留 checkpoint、`git merge --squash` 合回和 cleanup helper 处理旧运行记录；若历史 worktree run 的 worktree 缺失、Graph diff 会覆盖本地改动、发生冲突、合并失败或 cleanup 失败，run 会回到 `needs-review` 并在 events / 系统消息中记录原因。
- Graph 动态扩图续跑已接入当前 run：failed/blocked 的 review/test/merge/summary 或 attempts 耗尽节点会先走既有 `direct_rework`，当直接返工不可用、推荐 `add_rework_node` / `add_write_scope` / `manual_review`，或图无进展卡住时，运行时会在当前 Graph 追加最多 3 个主模型 `replan-*` 节点继续规划；普通成功推进 tick 不会追加 `replan-*`，而不是新建一轮 Graph run。`replan-*` 节点通过 `plannedGraph` 增量输出新增节点/边；append materialize 只允许新增 node id，拒绝覆盖已有节点或新增边指向已有节点；失败/阻塞旧节点作为触发证据可通过 `if_fail` 或 `evidence_for` 关联，不作为新节点的结构 `depends_on`，宿主会让新增根节点自动依赖当前 replanner 并自动补新的续跑 summary 收束。
- Graph planner prompt 默认要求 AI 自主设计图时尽量并行：多个可拆分且互不冲突的任务应设计为 planner fan-out、test/review/merge/summary fan-in 的 DAG；不得仅因列表顺序、同属一个目标或共享最终验收就串行化独立分支。planner 漏填 `plannedGraph.maxConcurrent` 时，宿主 materialize 会按首批仅依赖 `plan` 且通过 scheduler 冲突判定的可执行根节点推断并发上限；运行时只因同一 `conflictGroup` 或重叠 `writeFiles` 串行化，未声明 `writeFiles` / `conflictGroup` 的 ready 节点可并行执行但必须被规划约束视为不写文件，最终执行仍受既有 5 个并发上限约束。
- Graph planner prompt 会在重构、迁移、拆模块场景检查旧 source-contract、文本快照、路径断言和测试 canonical source；如果验证契约需要随实现迁移，planner 应规划独立 test adaptation / 契约更新节点，声明具体测试 `writeFiles`，并通过 `if_fail` / `review_feedback` 把验证失败返工到测试适配节点。
- Graph 支持 advisory 验证节点：完整单测、全仓测试、全量 lint 等覆盖面大且可能包含历史/范围外失败的验证节点可声明 `blocking:false`，失败后仍作为 evidence/unresolved 进入 review / summary，但不会单独阻断结构依赖；相关 focused 验证仍应作为 blocking 依赖或 `if_pass` 关卡。
- Graph scheduler / kernel 已支持依赖、终态、attempt、`writeFiles` 路径重叠、`conflictGroup`、`sleep` ready action；`human_gate` 仅作为历史兼容类型保留且不再进入 ready action 和并发上限计算；Graph 记录保留 planner 输出的 DAG 和 maxConcurrent，扩展侧按 `min(run.maxConcurrent, 5)` 派发 scheduler 选出的同批可运行节点。每个 Graph 节点都会创建独立 Graph 节点 conversation tab 并复用 `runPrompt` 执行；这些 tab 是 Graph 节点执行容器，不是 Loop 主从智能体关系，主 Graph tab 只负责记录调度消息，节点 runner 结束后会自动关闭对应节点 tab，因此并行节点不会因为共享同一 tab 互相 stop；真实并发仍受显式 `writeFiles` / `conflictGroup` 冲突判定约束；未声明 scope 不再自动串行化。
- Graph 条件/边当前是有限结构化能力：`GraphEdgeRecord` / planner edge spec 会保留 `label`、`conditionExpression` 和 `metadata`；scheduler 支持 `source_status`、`source_acceptance` 条件表达式求值；`manual` 仅作为历史兼容类型读取，新 planner 会拒绝生成；不可满足或不可求值的条件边输出为带 edge kind、condition、conditionExpression 的可读 blocker；`custom` 表达式不会自动重算复杂谓词，而是保守进入失败/复核口径等待后续重规划或返工处理。`review_feedback` / `if_fail` edge 的 metadata 可记录 `feedbackReason`、`reworkTargetNodeId`、`reworkScopeNodeIds`；`evidence_for` metadata 可记录 `evidenceRef` / `rationale`，作为证据追踪信号，不替代调度依赖。
- Graph 失败分类已进入持久化和主 tab 文案：失败节点会保留 `GraphNodeRecord.failure`，`node.failed` event data 写入 `failureClassification`；分类覆盖 `stale_test_contract`、`missing_write_scope`、`environment_failure` 和 `implementation_bug`。needs-review / idle 文案展示 category、confidence、signals、recommendedRecovery、recommendedWriteFiles 和 nodeDraft。direct run 对存在显式反馈边的实现缺陷推荐 `direct_rework`，worktree/旧运行仍使用 `feedback_rollback`；最近 `test-schema-definitions` 失败按 `missing_write_scope` 处理，signals 包含 `stale_test_contract`，推荐新增测试契约适配节点而不是单纯 Retry。仓库新增 `npm run validate:whitespace`，用于检查 tracked 和 untracked 文件行尾空白，覆盖 `git diff --check` 对 untracked 文件的盲区。
- 普通“打开 Graph 运行图” `openGraphRun` action 仅由主 Graph tab / 图级系统消息按同一 run 输出一次，Graph 节点/子任务 conversation tab 不重复展示；`openGraphRun` handler 仍可打开指定 run / node，不带 run id 时会从当前 workspace / CLI 的持久化 store 找最近 Graph run，坏 store 文件以非阻塞 diagnostics 展示；active Graph tab 底部固定“打开 Graph 图”按钮仍保留。Graph conversation tab 会显示 `🗺️` 标识；主 Graph tab 的视觉运行态跟随整个图级生命周期，Graph 正式开始后保持运行中，直到 run 进入 `completed`、`error` 或 `stopped` 才释放；主 Graph tab 右下角 AI 对话“中止”会复用 GraphRunPanel Stop 控制链，把对应 run / active node 状态落盘为 `stopped`，且异步 tick 不得用旧状态覆盖 stopped；节点 tab 按各自执行流独立开始，并在节点 runner 结束后自动关闭；completed 后主 Graph tab 会追加 `graphFinalSummary=true` 的 assistant 最终总结气泡，内容来自主模型执行的 `summary` 节点 `finalAnswer`，展示问题结论、任务总结、验证证据和未完成事项。面板用 SVG 边/箭头/目的标签和 HTML 节点按钮展示真正可视 DAG，并改为 full-canvas 主画布：DAG 占满主体可用空间，不再保留下方常驻节点详情分栏；DAG 顶部不再显示“可视图”、Dagre 说明、键盘提示或长 Reset layout / 重置布局文案，而是收敛为右上角紧凑工具区。自动布局对齐目标系统工作流画布：使用 `@dagrejs/dagre` left-to-right layered layout，以可见代表边参与排布，参数按当前紧凑节点尺寸等比例收敛目标工作流的 ranksep / nodesep / edgesep / margin，dagre 输出后执行同方向碰撞消解；长标题和多下游节点会增加节点估算高度，dagre 异常时按 intake / 零入度起点做拓扑层级兜底；视觉层会在每个 `from -> to` 方向只保留一条代表边，原始 edge 数据仍保留；节点统一为矩形工作流卡片，不再对 start/end 使用胶囊形状，卡片按 `node.kind` 使用 VS Code 主题变量映射 info/accent/warning/success/neutral/danger tone，并显示 type badge、短标识、中文标题、轻量状态和 Start/Decision/End/Step 语义 chip；每个节点表面显示 12 个低调连接点，边按两节点相对位置自动选择 `fromPort` / `toPort`，同一对节点存在正反向边时会使用不同连接点并保留轻微 offset/曲线差异，反馈/回环边和同侧连接也会做曲线偏移；边上可见目的标签以单行短文本展示（最多两个短片段用 `/` 串联），完整说明仍在 SVG title / aria / data / accessible edge list；按边类型和条件已满足且源节点到达终态的已经过边按类型着色：`depends_on` 保持 VS Code 主题蓝色，`if_pass` 绿色、`if_fail` 红色、`review_feedback` 黄色、`human_approved` 橙色，未经过边保持原样；用户可拖拽节点微调当前 run 的可视位置，也可在 DAG 背景按住鼠标左键拖动画布视口平移；节点拖拽按 zoom 比例换算，边 path、端口属性和画布尺寸会同步重算，拖拽结束后的 click 会被抑制以避免误触发详情；节点位置和 zoom 通过 VS Code webview state 按 `graphRunId` 本地保存，缩放下拉固定为 25%、50%、75%、100%、125%，默认 75%，Reset 仅作为紧凑重置控件清除当前 run 手动节点位置且不重置 zoom；单击节点打开详情弹窗，弹窗展示当前节点详情、错误、attempt、prompt/artifact/通信文件、控制入口和 Evidence/证据区；不再渲染 run 概览、状态统计、节点列表、recent events 或 finalAnswer 区块。普通节点进入 `running` 后会立即刷新已打开面板，执行中节点使用主题变量驱动的流水边框动画。
- GraphRunPanel 自动布局在默认 LR 的用户体验外，内部已支持 `LR` / `RL` / `TB` / `BT` 方向、按当前节点尺寸调优的 rank/node/edge/margin 参数、多根零入度 fallback、`review_feedback` 与上游 `if_fail` non-ranking 回边、方向感知 collision、端口分离，以及首次打开居中 selected / running / sleeping / blocked / failed 节点；这些只影响当前 run 可视表达，不改变 DAG 结构或调度语义。
- Graph 人工审批入口已从新运行时下线：新 planner 会拒绝 `human_gate` / `human_approved` / `manual`，scheduler/kernel 不再生成等待人工批准的 action；历史 run 仍可展示旧节点状态，但 GraphRunPanel 不再渲染审批 CTA 或审批控制。
- GraphRunPanel 只渲染真实接通且当前状态允许的操作：Continue / Resume sleeping、needs-review 或 error run，“我要说话”补充消息，Retry failed node，历史 worktree/baseCommit 可用时的 Feedback rollback failed / 历史 blocked 验证类节点，Stop run。Graph 节点返回 blocked 时会归一为 failed，主 Graph tab 按失败状态进入错误态并释放运行态；运行时不再弹出 blocked modal、不再提供跳过当前并选择下游继续的 quick pick，也不再自动打开 human gate 审批入口。补充消息会写入 Graph run 的 `supplementalRequirements`、主沟通文件和 events，并注入后续 Graph 节点 prompt；不承诺立即打断已经运行中的节点。direct 模式下 Retry 只会清理节点运行状态并在当前工作区状态上重跑，不做 git reset，也不承诺撤销上一次节点已写入的文件改动；direct 自动返工同样不做 rollback，只在 `direct_rework` 建议和显式反馈边都可用时重置声明 scope 继续调度。Feedback rollback 只对历史 worktree/baseCommit 可用的旧 run 提供；direct 模式不提供 Feedback rollback 按钮；Graph UI 不再常驻展示 Stop 能力边界说明，主 Graph tab 右下角 AI 对话“中止”和 GraphRunPanel Stop 共享同一 Graph stop 控制链，具体 Stop 操作结果或错误仍通过运行消息/状态反馈表达；操作后刷新面板并尽量保留 selected node；无可执行节点时返回结构化原因而不是静默成功。
- Graph 返工记录与证据区已进入用户可见面板：Feedback rollback 和 direct rework 都会记录目标选择、候选节点、实际 reset scope、feedback reason 和触发 edge，被重置节点写入 `rework` 记录，后续节点 prompt 与 summary 可见返工来源、范围和原因；direct rework 还会写入 `node.direct_rework_requested` 事件。GraphRunPanel 节点详情弹窗的 Evidence/证据区会聚合选中节点的 artifact、communication file、验收 evidenceRef、节点事件和 finalAnswer evidence 引用。证据区展示引用与摘要，不读取外部证据文件正文。
- Graph auto wake 已接入扩展激活和 workspace 变化恢复：sleeping Graph run 会按最早 wakeAt 定时 resume/tick，VS Code 退出期间不运行外部守护进程，下次激活会恢复未到期定时器并补处理已到期 run。
- Graph 当前限制：没有图编辑器、模板库、运行前人工调整/确认、DAG 结构编辑、边/节点编辑、完整人工审批工作流、从失败节点自动生成补充需求、局部返工路径编辑、复杂布尔条件编辑器、任意条件重写/可视化重规划、rollback 预演或证据文件正文读取；当前节点拖拽、背景拖拽平移、12-port 自动连线、短边目的标签、Start/Decision/End/Step 语义 chip 和按节点类型着色的矩形卡片仅用于调整/增强 GraphRunPanel 内当前 run 的视觉表达，不修改 DAG 结构、调度语义或节点类型体系；worktree 模式完成态合回不会自动提交或自动解决冲突，但成功合回后会清理 Graph worktree、空的 `graph-worktrees` 父目录和对应 Graph 分支；direct 模式无隔离、无 checkpoint、无 merge-back、无自动 git rollback，只能在分类建议和显式反馈边足够明确时做声明范围 reset 返工。Stop 至少保证 Graph 状态和事件落盘为 stopped；主 Graph tab 右下角 AI 对话“中止”和 GraphRunPanel Stop 共享该保证；只有 active CLI run 已携带 `graphRunId` / `graphNodeId` 映射时才会发送停止请求，真实进程是否退出取决于底层 CLI 响应；缺少映射时会明确提示未确认真实 CLI 进程停止；该能力边界不再作为 Graph UI 固定说明常驻展示。
- OpenCode 对话面板同样提供 coding / Loop / Graph 模式入口。Loop 复用既有主任务、子任务、多轮复核、群聊和 active config effective main/subtask 运行链路，每次主任务或子任务请求仍通过非交互式 one-shot `opencode run --auto` 执行。并行/Loop 子任务会把 stdout JSONL 的 `text`、`reasoning` / `step_start`、`tool_use` 分别实时写入对应 conversation tab 的 assistant、thinking、trace 气泡，同时保留原始流诊断；退出时只补齐未展示的最终文本，不重复整段答复。Loop 多智能体执行模式下拉统一放在输入区底部操作图标左侧，Codex / Claude / OpenCode 三个 CLI 保持一致，模型行只展示对应 CLI 的模型与思考控件。
- OpenCode 支持 Loop 编排不等于支持插件交互式 runner：`isInteractiveSupported(opencode)` 继续为 `false`，只表示不存在 Codex/Claude interactive runner 与 common command，不得再用该标记隐藏 OpenCode 的 Loop 模式入口，也不得为开放入口把它改成 `true`。
- Loop 主任务 Tab 的运行态跟随持久化任务生命周期：任务记录为 `running` 时，即使当前没有主任务、子任务、裁判主持人或参与者 AI/CLI 进程，主 Tab 仍显示运行态并保持不可关闭；任务进入 `completed`、`needs-review`、`error` 或 `stopped` 后解除，其中三种中断终态优先于尚在异步释放的旧编排所有权，不再同时显示“任务已中断”和执行中。轮次与子任务重试在派发前重新检查终态，主动停止后不得把任务复活为 `running`。普通对话 Tab 与 Loop 子任务 Tab 仍按各自实际执行进程显示运行态。
- 支持停止当前任务、查看运行中 prompt、查看原始流式记录
- 工具设置中的全局项（debug、自动文件标签、执行后自动压缩上下文、隐式子代理、人工交互、Loop 最大轮次、Loop 子任务最大思考力度、语言、macOS task shell）保存在 `~/.sinitek_cli/settings.json`；最终答复协议和子任务 tab 自动关闭不是可配置项。旧文件中的 `finalAnswerPolicy`、`codexFinalAnswerPolicy` 和历史兼容值会被忽略，不能改变运行时行为；项目级工具设置保存在 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`
- 工具设置提供工作区级“Harness 骨架”开关，控制当前工作区基于 harness scaffold 的插件侧本地记忆层，默认关闭。用户开启时，扩展先弹窗确认；确认后才补齐工作区 `.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 的模板追加、只引用 `AGENTS.md` 的 `CLAUDE.md`，并创建或补充根级 `.gitignore` 以忽略 `.codegraph/`，随后在终端启动 `npm install -g @colbymchenry/codegraph@latest && codegraph install --target codex --location global && codegraph init`。工具设置“工作区”页还提供独立“安装 CodeGraph”按钮，用于安装/升级本机最新版 CodeGraph CLI、注册 Codex MCP 集成，并在当前打开工作区时初始化 `.codegraph/` 索引；Windows 终端使用 `cmd.exe` 执行同一 `&&` 顺序命令，macOS 使用默认 shell。骨架安装成功后会再弹窗询问是否由 AI 初始化 `ARCHITECTURE.md`；用户确认后，扩展把当前 AI 对话切到 coding 模式，并复用当前选择的 CLI 分组、配置和模型发起项目架构分析任务。关闭后不得创建、更新、召回或注入插件侧长期记忆，只允许查看、导出和删除已有记忆；该开关不控制 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、配置、压缩结果或账号侧能力。
- 工具设置全局页提供“执行后自动压缩上下文”开关，字段为 `autoCompactContextAfterRun`，保存在 `~/.sinitek_cli/settings.json`，默认开启。旧工作区 `autoCompactContextAfterRun` 和 `autoCompactContextBeforeRun` 仅作为迁移输入：全局字段缺失时按 after-run 优先、before-run 回退迁移当前工作区有效值；全局字段已有值时始终优先。成功迁移或用户更新全局设置后会移除当前工作区旧字段。开启后，若当前任务目标为已有 Codex/Claude/OpenCode 会话，会在任务成功结束且执行超过 5 分钟后自动执行一次上下文压缩；任务中断、报错或执行不超过 5 分钟不触发自动压缩；自动压缩以静默后台任务执行，单次最多等待 3 分钟，超时停止当前压缩并按未压缩处理，不追加普通任务完成耗时气泡、不覆盖刚完成任务的真实执行时间；手动压缩执行期间，聊天面板运行条会显示带动画的“压缩上下文中”状态。OpenCode 支持依据来自官方 TUI slash commands：`/compact` 会 compact current session，alias 为 `/summarize`，默认快捷键 `ctrl+x c`；官方配置还支持 `compaction.auto` 默认自动压缩、`compaction.prune`、`compaction.reserved` 与 `OPENCODE_DISABLE_AUTOCOMPACT`。插件侧 OpenCode 手动压缩应发送官方压缩命令或复用可用会话链路，自动 after-run 压缩沿用成功且超过 5 分钟的触发条件；若当前 OpenCode 非交互运行模式无法可靠附着既有会话，应明确作为 runtime fallback/受限路径处理并由 runtime/UI 子任务验证
- Codex / Claude / OpenCode 的普通任务 prompt 与 hidden retry prompt 都会追加统一最终回复约定：任务真正完成后，最终回复必须以 `[final_answer]` 开头，过程更新和非最终回复不得使用该标记；该内部约定不会改变 AI 对话中展示的原始用户问题。Loop 主任务/子任务等已有独立机器协议与结构化完成气泡的内部运行不会注入或要求该文本标记，避免破坏纯 JSON 决策解析。普通任务的最终答复协议固定严格：先接受 Codex 显式 `phase:"final_answer"` / `codexFinalAnswer=true`，以及 OpenCode 同一 `messageID` 的非 thinking assistant `text` 与 `step_finish.reason="stop"` 结构化终态；没有结构化 final 类型时，只检查当前用户消息之后的非 thinking assistant 文本是否包含 `[final_answer]`。OpenCode 的 `tool-calls` 阶段、跨 message ID 的正文与 `stop`、无正文 `stop` 和纯 thinking 文本都不能通过。普通 assistant 正文、成功退出和 Codex `turn.completed status:"completed"` 都不会合成为最终答复。thinking、trace、system、user、带 `subagentId` 的子代理 assistant 气泡、空回复、失败和中断也不能收口。对非主动中断/异常，或 CLI 成功退出但本轮仍没有最终结论气泡的情况，会沿既有规则隐式发送“继续/continue”自动重试最多 5 次，间隔依次为 5 秒、15 秒、30 秒、2 分钟、5 分钟；不会展示隐式用户消息；每次失败进入下一次自动重试前会追加错误 trace 气泡和排队提示，真正开始重试时再追加开始提示并恢复标签运行态；达到上限后展示最近一次真实错误
- 工具设置在全局页提供一个统一“隐式子代理”开关，字段为 `multiAgentEnabled`，保存在 `~/.sinitek_cli/settings.json`，默认关闭。旧工作区 `multiAgentEnabled` 和 `codexMultiAgentEnabled` 只作为迁移输入：全局字段缺失时迁移当前工作区有效值，全局字段已有值时始终以全局值为准；成功迁移或用户更新全局设置后会移除当前工作区旧字段。关闭时扩展会显式禁用 Codex 官方 `multi_agent`，并在每次 OpenCode 运行的临时 `OPENCODE_CONFIG` overlay 中合并顶层 `permission.task="deny"`；同时设置更高优先级的 `OPENCODE_CONFIG_CONTENT` 内联配置，以免项目配置重新放开 task 子代理。两种运行时覆盖均不写回用户 OpenCode 配置。开启时，扩展撤销自身禁用策略，保留各 CLI 自身可用的隐式子代理能力和 OpenCode 的既有 task 权限。Codex 仍按 App Server `threadId` 把子线程增量、`collabAgentToolCall`、`subAgentActivity` 与子 turn 完成状态写入独立 assistant 气泡；并发子代理按 thread ID 隔离；子线程不会覆盖主 threadId、更新父任务列表、触发父 final-answer 或提前结束父 turn。该开关不控制 Loop 的 `main_sub_multi_agent` / `debate_multi_agent` 编排设置。
- 工具设置全局页提供“人工交互”开关，字段为 `humanInteractionEnabled`，保存在 `~/.sinitek_cli/settings.json`，默认开启。开启后，Codex Vibe/coding 交互任务会拦截 Codex app-server `item/tool/requestUserInput` 与 MCP `mcpServer/elicitation/request` 结构化请求；若用户原始 prompt 明确要求 AI 先询问需求/细节，而 Codex、Claude 或 OpenCode 只输出普通问题列表，运行时会移除该问题列表 assistant 气泡并兜底打开同一人工交互表单；兜底解析会把问题文案中的“可选 / 选项 / 例如 / 如”候选项，以及紧随问题的 `A.` / `B.` / `C.` 字母选项列表转为 radio/checkbox 字段，避免可选问题退回 textarea。聊天 Webview 复用当前主题 overlay/modal 组件展示表单，支持 text、password、textarea、radio、checkbox、select、multiselect 字段。用户提交后，扩展把补充信息写入当前会话；结构化请求会把 answers/content 回传给 Codex，自然语言兜底会把补充信息作为下一轮输入继续同一 Codex thread、Claude session 或 OpenCode one-shot/parallel 会话。用户拒绝、关闭或停止任务时，扩展关闭弹窗、终止当前任务且不进入 hidden retry。Loop/Graph 编排不使用该弹窗，仍按各自任务协议处理人工复核或中断。
- Webview 在渲染 assistant 气泡时会隐藏 `[final_answer]`，但不会改写内存或会话存档中的原始消息，确保严格判定和续接仍能读取协议标记；user、system 和 trace 消息不应用该展示过滤。

OpenCode 配置卡片默认进入可视化模式，以 Provider 列表和当前 Provider 的模型列表为核心，并保留 JSON 高级模式。可视化表单支持 Provider `id`、`name`、`npm`、`options.baseURL`、`options.apiKey`，以及模型 `id`、`name`、`reasoning` 与顶层主模型；API Key 使用密码输入。`model` 使用与其他字段一致的可搜索单选下拉，候选来自当前配置的 Provider/模型列表；`small_model` 不再渲染可视化编辑入口，但继续作为 OpenCode CLI 兼容字段与插件子模型角色保留并随配置保存。Provider `npm` 仍是可编辑、可搜索组合框，允许任意 npm 包。顶层 `share`、`autoupdate`、`logLevel`、`snapshot` 采用继承语义的单选/三态控件；模型思考力度采用可输入 tags 多值控件，保留用户输入顺序并只提供无损 `ultra` 建议，不把 provider-specific/custom effort 归一为全局固定枚举。编辑后的首项写入 `options.reasoningEffort`，全部值生成编辑器管理的简单 `variants`；未编辑时保留原有 `options.reasoningEffort` 和 complex variants，清空时只移除编辑器管理的简单 reasoning 字段。未知顶层字段、MCP、permission、Provider/模型扩展字段、其他 options 和复杂 variants 原样保留。Provider/模型重命名会同步顶层 `model` / `small_model` exact ref；无效 JSON 不覆盖最后一次有效可视化状态；范例一键导入后立即加载到可视化编辑器。保存配置记录后，只有该档案当前处于激活状态时才应用到运行配置。
- Codex 交互式运行会优先直接启动已解析的 CLI，可显式固定 `CODEX_HOME` / 工作区 trust，并在回合完成时优先采用渐进式关闭，降低长任务被异常打断的概率
- Loop 模式会沿用当前 tab 的会话上下文，并按会话隔离写入任务记录：`~/.sinitek_cli/loop-tasks/<workspaceKey>/<cli>/<sessionId>/loop-tasks.json`（首次主任务尚未拿到真实会话 ID 时会暂存到 pending 路径，拿到真实会话 ID 后自动迁移到该会话文件）；主任务、子任务、轮次概要、预计剩余轮次和用户后续补充需求都写入该会话记录文件，同时在 `~/.sinitek_cli/loop-communications/<taskId>/` 维护主子任务沟通文件；全局工具设置支持配置 Loop 任务最大主任务复核轮次（默认 20，范围 1-100，新建任务写入当前值；已有任务在恢复、继续或下一轮运行前会随全局设置上调而提升记录上限，但不会因全局设置降低而下调）；子任务成功完成后固定自动关闭对应 AI 对话标签页，不再提供关闭开关；Loop 主任务标签页会显示 `Loop` 前缀，且主任务或任一子任务仍在运行时禁止关闭主任务标签页；若在该主任务标签继续执行普通（非 Loop）任务，前缀会恢复为普通标签；点击不同类型会话标签会自动切换为 Loop/Vibe 模式，新建标签默认 Vibe 模式；主任务返回 JSON 决策并在每次复核中预判 `estimatedRemainingRounds` 剩余轮次，扩展兼容旧 `subtask` 字段，并优先解析 `subtasks` 批次；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，优先把能确认 `writeFiles` / `conflictGroup` 互不重叠的子任务放入同一批次，同一轮最多 6 个；扩展会按声明的写入文件/冲突组自动规划组内并发、组间串行；扩展为批次内每个子任务创建独立新会话，单子任务仍自动切换到子任务标签展示气泡和流式消息，多子任务批次会创建多个子任务标签并并发运行；每次 `status=continue` 的主任务 JSON 协议气泡会原位替换为 Markdown 子任务派发摘要，并同步追加到 `main-task.md`；只有批次内所有子任务都正常完成后才切回主任务并自动唤醒主任务审核验收，不满足则继续启动下一批子任务，验收通过才结束；主任务 AI 调用若连续失败 5 次，会把任务记录更新为 `needs-review`，停止自动派发和自动恢复，避免在失败状态下重复复用旧主任务决策或继续加派子任务；轮次按主任务复核轮计数，同一轮可包含一个或多个并发子任务；第 1 轮先做总体阶段规划，再优先派发首批互不冲突子任务，不再默认只派发 1 个；Loop 模型选择按 CLI 能力解耦：Claude 分组不展示插件侧模型选择或模型管理入口，沿用 CLI 默认模型或用户手动配置的命令参数；Codex 普通 Coding 使用单模型，Codex Loop 显示主模型/子模型；OpenCode Vibe（coding）仅使用主模型，OpenCode Loop/Graph 编排使用主模型/子模型，底层 `model` / `small_model` 仅作为 OpenCode CLI 配置字段适配；主任务、主持/复核和续跑使用主模型，Loop 子任务使用子模型，缺少子模型时回退到主模型或单模型；最终完成时主任务必须返回 `answerConclusion`（直接回答用户原始问题）、整体总结、各轮子任务摘要和用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md` 和任务记录，并移除最终主任务 JSON 协议气泡，在 AI 对话主消息流中先追加 `loopAnswerConclusion=true` 的 assistant Markdown 问题回答结论气泡，再追加 `loopFinalSummary=true` 的 assistant Markdown 最终总结气泡；最终总结气泡会继续展示问题回答结论、子任务摘要、验收结果、需求覆盖和整体任务总结；只有主任务显式返回 `status=completed` 且主任务对话已同时存在 `loopAnswerConclusion=true` 问题回答结论气泡和包含“问题回答结论”“整体任务总结”小节的 `loopFinalSummary=true` 最终总结气泡才视为真正结束，如果任务记录已完成但这些气泡缺失或最终总结仍为旧格式，扩展会自动按“继续”恢复同一任务并再次唤醒主任务；主任务中断后可在同一标签输入“继续/continue/resume”等短提示词恢复同一任务并从当前轮次继续，也可在 Loop 群聊面板点击“继续执行”后先确认或编辑默认“继续”消息，再复用同一任务 ID 唤醒主任务/主持人判断下一步；若主任务已经触发上述连续失败上限，则群聊“继续执行”和子任务手动补跑后的主任务恢复都不会再自动恢复主任务，只能保留人工复核信号；若用户在群聊面板点击“我要说话”，扩展会先把消息写入任务记录、主任务沟通文件和群聊 transcript，供下一轮主任务/主持人在恢复时读取并调整安排；子任务结束前必须写清沟通文件，供主任务唤醒后读取；子任务出错会间隔 1 分钟自动重试最多 5 次；子任务中断后在子任务标签手动继续时会强制按内部 coding（即 Vibe）任务执行，不允许再次启动 Loop 任务；消息气泡会标记“Loop / 子任务”
- Loop 可解析任务决策的自动睡眠与定时唤醒已下线：主任务/主持人不得返回 `status=sleep`、`wakeAfterSeconds` 或 `sleepReason`。需要等待外部结果、授权或人工判断且当前没有可执行子任务时，必须返回 `status=blocked` 并在 `finalSummary` 说明等待对象或人工判断点。旧任务 Store 中的 `sleeping` 状态在读取时降级为 `needs-review`，并丢弃 `autoSleepStartedAt`、`autoWakeAt`、`autoSleepReason`；扩展不再创建 Loop 自动唤醒定时器，也不再在 AI 对话或 Loop 群聊展示自动睡眠气泡、倒计时或计划唤醒时间。
- Loop 子任务出现需求不明、授权不足、依赖/写入冲突或其他必须确认后才能安全继续的问题时，不得猜测实施，也不得在用户可见 assistant 回复中提问或复述问题。子任务必须立即停止，把待确认问题、已知事实、影响/阻塞步骤、可选方案和推荐方案写入自身沟通文件的 `## 待主任务确认` 章节，合并更新自身记录为 `status=completed`、summary 标明待主任务确认、communicationFile 指向该文件，然后只以固定中性文本结束。现有 `end -> completed -> 唤醒主任务` 调度保持不变；主任务读取该章节后能自行确定时把结论带入后续子任务，确需用户或人工确认时返回 `status=blocked`，不得把待确认子任务误判为验收通过。
- AI 对话面板中的 Loop 主任务 tab 在主任务或同一 Loop 任务任一子任务仍在运行时强制跟随最新消息；如果用户手动滚离底部，仍会在消息区显示置底按钮，点击后回到最新消息。普通 Vibe 任务和 Loop 子任务 tab 保持原有按用户滚动位置决定是否自动置底的策略。
- Loop 的独立子任务不是 OpenCode/Codex 内部 child session。每个子任务启动时，主任务 tab 会立即新增一个带子任务标题的 `Loop 子代理 · 执行中` assistant 气泡；运行时每秒从对应子任务 tab 的消息存储同步非 thinking、非内部子代理的可见 assistant 快照，完成、失败或中断时原位更新状态。子任务 tab 仍保留自身完整 assistant/thinking/trace 流；主任务进度气泡带稳定 `subagentId`，不参与父任务最终答复判定。
- 旧 Lobster 命名只作为升级兼容输入：首次枚举任务时，旧 `lobster-tasks` / `lobster-tasks.json` 和 `lobster-communications` 会自动迁移到 `loop-tasks` 与 `loop-communications`；旧设置、工作区、模型、任务运行记录及会话消息中的前缀键会归一化为 `loop*`。新公开命令为 `sinitek-cli-tools.openLoopGroupChat`，旧命令 ID 仅保留隐藏别名。
- Loop 任务启动和恢复气泡会显示“打开 Loop 群聊”入口，命令 `sinitek-cli-tools.openLoopGroupChat` 打开通用 Loop 群聊内容区面板；不同 `taskId` 的 Loop 群聊页面可同时打开并保留，同一 `taskId` 重复打开时复用并刷新该任务已有页面。`main_sub_multi_agent` 会在 `~/.sinitek_cli/loop-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，群成员列表统一显示“成员”，包含“主任务”和动态加入的“子任务 1~N”；主任务决策、子任务加入、子任务完成和批次完成都会追加到 transcript，其中子任务成功完成的发言气泡展示该子任务最终回复，运行状态和验证依据仍写入任务记录与子任务沟通文件。`debate_multi_agent` 使用同一个任务页面把红蓝对抗 `debates/round-*/chat.md` 与共识通过后的根部 `group-chat.md` 合并为单条时间线；主任务轮次、发言批次和执行阶段只作为系统消息显示，不提供轮次切换或按轮次分区。该面板支持当前发言者/执行者“思考中”等待气泡、状态落盘后主动刷新、5 秒兜底自动刷新、50px 距底阈值自动跟随与置底按钮、手动刷新；同一 Loop 任务只要仍存在运行进程就始终显示“我要说话”按钮并允许发言，即使持久化状态短暂落成 completed 或已触发主任务 AI 连续失败上限；无运行进程时，未完成且未触发主任务 AI 连续失败上限的任务也会显示“我要说话”按钮，把消息持久化到当前任务供下一轮读取，并在提交刷新后以右侧“我”对话气泡展示；当任务当前无运行进程且仍可继续时，面板额外显示“继续执行”按钮，先弹出可编辑确认框并在确认后把消息作为“本次继续指令”传给主任务/裁判主持人；同一 Loop 任务存在运行进程时则显示“中止”按钮，点击后停止该 `loopTaskId` 关联的主任务、子任务和辩论/共识相关运行并把任务标记为 stopped；“我要说话”“继续执行”和“中止”按运行态约束显示，不再在面板顶部提供“打开 transcript”或“打开任务记录”按钮。
- Loop 群聊会从任务记录读取创建任务时的原始 `rootPrompt`，将其作为时间线最顶部、标记为“任务发起”的右侧“我”气泡展示；该气泡只是派生展示，不写入或重复写入 `group-chat.md`，后续“补充需求”气泡仍按实际提交顺序紧随其后。

- Loop 模式的执行方式属于 `loop` 内部设置，不新增顶层 `InteractiveMode`。Webview 在 Loop 模式下展示“Loop 执行方式”下拉，包含 `main_sub_multi_agent`（主从多智能体）和 `debate_multi_agent`（红蓝辩论多智能体）；默认值为 `main_sub_multi_agent`，老任务记录缺少 `executionMode` 时也按该值处理。新建任务会把 `executionMode` 固化到 `LoopTaskRecord`，恢复任务时以记录为准，执行中切换下拉只影响新任务。该下拉独立于模型选择能力：Claude 不显示插件侧模型选择；Codex Coding 使用单模型，Codex Loop 显示主模型/子模型；OpenCode Vibe（coding）仅显示主模型，Loop/Graph 显示主模型/子模型与各自思考力度。
- Loop 编排角色与模型角色按 CLI 能力映射。Codex Loop 主任务、主持/复核和续跑使用 `loopMainModel` 和 `loopMainThinkingMode`，Loop 子任务使用 `loopSubtaskModel` 和 `loopSubtaskThinkingMode`；缺少子模型时兼容回退到主模型或单模型。OpenCode Vibe（coding）只传递主模型，不要求子模型；OpenCode Loop/Graph 使用主模型和子模型，缺少子模型时沿用主模型回退。旧 `lobsterMainModel` / `lobsterSubtaskModel`、`selectedLoopByConfigId` / `loopRolesByConfigId` 与 OpenCode 旧 `primary` / `small` 字段仅用于兼容读取和迁移。OpenCode 的 `small_model` 仅是底层 CLI 兼容字段，对应插件子模型角色。
- “工具设置 - 全局”提供 `loopSubtaskMaxThinkingMode`，默认 `xhigh`，可选 `low / medium / high / xhigh`。每次 Loop 独立子任务启动时，运行时将当前所选模型的思考力度与该上限取较低值；`max` 和 `ultra` 均会降至 `xhigh`，已有的较低选择保持不变。该限制不改变 Loop 主任务、普通任务或已保存的模型思考力度。
- Loop 群聊“继续执行”不再固定复用任务创建时的 CLI/model 快照：扩展先定位承载该 `taskId` 的主任务 Tab，即使该 Tab 已切换 CLI 分组也通过原 CLI 的消息/session 绑定识别；随后以该 Tab 当前 CLI 为权威，读取该 CLI 当前激活配置和当前模型。跨 CLI 显式恢复仍复用同一任务 ID，并把 `LoopTaskRecord.cli`、`sessionId` 与 `taskStoreFile` 原子迁移到当前 CLI/session 归属，后续主任务、子任务、裁判、参与者和共识汇总统一使用新的运行配置。主任务 Tab 下同一任务处于 `needs-review`、`error`、`stopped` 或可恢复 `running` 状态时，用户继续发送任意 Loop 输入也按“继续执行”处理，复用原 `taskId` 并把该输入作为继续说明；找不到可恢复任务时才新建 Loop 任务。Loop 子任务 Tab 手动继续仍固定转为 coding 续跑。
- `debate_multi_agent` 只替代 Loop 主任务初始规划阶段；首轮红蓝规划共识形成后，后续实现、复核和继续派发由裁判主持人作为主智能体走主从多智能体链路，子任务派发、批次并发、冲突分组、子任务重试、子任务沟通文件、最终总结气泡和 30 天保留清理继续复用现有链路。该模式已升级为红蓝对抗：当任务尚无可复用红蓝规划共识时，先由裁判主持人根据任务目标设计 2-6 个红蓝参与者并写入 `moderator-participants.md`，新清单中 `role` 只能使用 `blue_team` 或 `red_team`，且必须至少包含 1 个蓝队和 1 个红队；主持人还要在清单中指定首批 `openingSpeakerIds`，通常由蓝队先开场。蓝队负责提出、捍卫和修正方案，补足约束、验收口径和证据要求；红队负责攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性。只有任务涉及代码、文件、权限、部署或流程执行时，红队才额外检查写入范围、并发冲突、越权修改、回滚/恢复失败和工程验收风险。扩展校验后把这些成员作为 `## 参与者加入：...` 追加到共享 `chat.md`；参与者只读可用上下文、仓库、任务记录和沟通文件，只写本次提示词指定的 artifact。每个发言批次开始时扩展向 `chat.md` 追加系统消息说明主任务轮次、当前发言批次、最大安全发言批次数和本批次被主持人点名的发言者；只有被主持人显式点名的 1-3 位参与者会进入该批次，并可在批次内并行写入各自的 `participants/<participantId>-turn-<n>.md`。扩展等待本批次全部 artifact 完成后再按点名顺序以 `## 发言：...` 追加到 `chat.md`，随后裁判主持人写 `participants/moderator-turn-<n>.md`，以 `continue / finalize / block` 判断红队攻击是否已被蓝队化解、是否追加下一个发言批次、收集最终立场或进入人工复核；当 `action=continue` 时，主持人必须同时给出下一批 `nextSpeakerIds`。参与者和裁判主持人的临时对话 tab 回答完成后固定自动关闭，下一批次同一角色通过 `debateRounds` 记录的 sessionId 新建临时 tab 续接。最大发言批次数只是防无限循环的安全上限，达到上限后运行时强制收束。红蓝对抗产物写入 `~/.sinitek_cli/loop-communications/<taskId>/debates/round-<n>/`，新任务通常只生成 `round-1`，历史任务或恢复补跑按实际 Loop 轮次记录；产物包括 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/*-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/*.md`、`cross-review.md`、`consensus.md` 和 `decision.json`；共识通过后的执行群聊写入 `~/.sinitek_cli/loop-communications/<taskId>/group-chat.md`。任务记录中的 `debateRounds` 保存红蓝对抗状态、`chatFile`、`participantRosterFile`、`participantRosterSessionId`、当前 `activeSpeaker`、参与者状态、参与者 sessionId、裁判主持人决策、裁判主持人 sessionId 和共识摘要。辩论任务启动气泡同样显示“打开 Loop 群聊”入口；通用群聊面板把 `chat.md`、`debateRounds` 和 `group-chat.md` 合并为一个按消息追加顺序展示的时间线，按角色气泡展示参与者加入、参与者发言、裁判主持人控场、最终立场、主任务决策、子任务动态加入、子任务完成、批次事件、收束状态与 sessionId；当前裁判主持人/参与者/共识汇总器/主任务/子任务运行时会在时间线末尾显示“思考中”等待气泡；角色发言或状态落盘后会主动刷新已打开页面，5 秒自动刷新仅作为兜底；若刷新前滚动位置距离底部不超过 50px 会自动跟随最新消息，否则保留阅读位置并显示置底按钮；页面继续提供手动刷新；当任务尚未完成且未触发主任务 AI 连续失败上限时，页面都支持“补充需求”把新要求持久化到任务记录和主沟通文件，供后续主持人主智能体读取。
- `debate_multi_agent` 规划共识通过后会解析 `decision.json` 为现有 `LoopMainDecision`，并复用 `applyLoopMainDecision` 进入原有 `completed / continue / blocked` 处理。恢复任务或进入后续轮次时，如果任务记录中已存在可继续的红蓝规划共识和合法 `decision.json`，扩展会跳过新的红蓝辩论，改由主持人主智能体读取首轮红蓝规划产物、主从执行群聊和子任务沟通文件后继续复核；只有缺少可复用规划共识、旧产物缺少裁判主持人控场、`chat.md`、参与者加入事件、收束标记、产物缺失或不可解析时，才补跑规划辩论。裁判主持人红蓝参与者清单缺失或非法、群聊发言 artifact 缺失、裁判主持人 artifact 缺失或不可解析、最终参与者 artifact 缺失或立场不可解析、裁判主持人输出 `block`、共识后的最终参与者立场仍为 `block`、存在未解决 `blocking` disagreement、缺少 `cross-review.md`、`consensus.md` 不含合法共识 JSON、`decision.json` 非法、或 `status=continue` 但没有可派发 `subtasks` 时，不派发子任务，任务进入 `needs-review` 并在主任务沟通文件和主 tab 系统消息中记录原因。若红队或蓝队参与者原始 `block` 可通过裁判主持人追问、蓝队修正、前置子任务、验收标准或风险说明解决，共识汇总器应将其写入 `resolvedDisagreements`，并可把最终立场降为 `agree_with_reservations` 后继续。内容区群聊页面只读，不直接写任务记录或追加辩论消息；真实 VS Code 面板端到端手工验收仍应以单独验收记录为准。

- Loop 子任务手动中断后在子任务标签继续时，后续成功结束与自动重试成功共用同一收尾流程：先更新子任务记录和沟通记录，再固定自动关闭该子任务标签，最后仅在主任务可恢复且未达到连续 AI 失败上限时唤醒主任务。手动恢复再次出错或再次中断时不关闭子任务标签。

### 3.3.1 Loop 子任务项目规则隔离

- 主任务始终以真实工作区运行，按 Codex、Claude、OpenCode 的正常机制读取项目规则。主任务负责为每个子任务给出自包含的目标、授权范围、写入范围、验收标准和沟通文件路径。
- 每个子任务会获得临时执行根，其中只有真实工作区可工作内容的链接；根 `AGENTS.md`、`CLAUDE.md`、`.agents`、`.claude`、`.codex` 不会暴露给子 CLI。文件写入会经链接回到真实工作区，执行结束或启动失败后临时根会删除。
- 调用层进一步降低自动加载：Codex 使用 `--ignore-rules`，Claude SDK 使用空 `settingSources`，OpenCode 使用 `--pure`。这不是工具设置开关，所有 Loop 子任务固定执行该策略。
- 子任务只听从主任务的派发，在一个连续执行回合内完成当前授权范围；先实施，再只运行能直接证明本次改动的最小必要检查，不为可选调研、额外检查或无关重试增加轮次。遇到必须确认的阻塞时按既有沟通文件协议转交主任务。
- 已移除 `media/loop-workflow-skills/`、其加载器和同步/校验脚本；不再向主任务或子任务注入任何内置 Workflow Skill，也没有对应 UI、i18n 或用户配置开关。旧任务记录中的兼容字段不触发加载。

### 3.4 会话与并发

- 会话列表与当前会话切换
- 历史会话列表会显示该会话是否为 Loop / Graph 会话、是否已在 AI 对话 tabs 中打开，并移除“复制 ID”按钮；Graph 会话从 Graph run store 的 `cli + sessionId` 或已保存消息中的 `graphRunId` / `openGraphRun` action 识别，加载后底部“打开 Graph 图”按钮在后续普通回复后继续可用。Graph 元数据只保留图入口、状态展示和恢复线索；同一 tab 前台发送新提示时，分发模式以当前 UI 选择的 coding/Vibe、Loop 或 Graph 为准，切出 Graph 后仍复用该会话上下文但不会被 Graph 元数据强制改回 Graph
- 历史记录弹窗支持查看单个历史会话的已保存消息，并可将该会话消息导出为 TXT；历史记录中的操作按钮允许换行展示，避免挤压列表宽度
- 历史记录弹窗不再提供独立“Loop 群聊”恢复 tab；Loop 会话统一从“历史会话”加载，恢复主会话后通过输入区已有“打开群聊”按钮进入对应群聊
- 从历史加载未打开的会话时会新建 tab 承载该会话；若该会话已在 tabs 中打开，则直接切换到已有 tab
- OpenCode 首次执行会从 JSONL `sessionID` 接管真实 `ses_*`，同一 tab 后续执行使用该真实 ID续接；插件内部 `local_*` 占位 ID不会作为 `--session` 传入 CLI。修复前留下的 `local_*` tab 会在下一次执行创建新底层会话，并在捕获真实 ID后迁移已有插件消息历史。
- 多个 conversation tab（超过 5 个时启用左右翻页按钮，每页最多显示 5 个；第一页隐藏“上一页”，最后一页隐藏“下一页”，中间页显示两个方向，不展示不可用方向的禁用按钮）；Loop 主任务 tab 在 CLI 标签前显示 `☀️` 图标，子任务 tab 显示 `🌛` 图标，均不额外显示 `Loop` 文本
- 即使只有 1 个 conversation tab 也展示顶部标签；运行中 tab 使用主题 focus 色蓝色虚线流水边框，异常终止或进入自动重试等待期的 tab 显示错误红框，手动停止不标红，后续恢复输出或成功结束会恢复正常样式
- 单个 tab 切换 CLI 分组或切换历史会话时，不应中断其他 tab 中正在执行的任务
- 历史会话删除、清空、重置当前 Tab；其中“重置当前 Tab”会关闭当前 tab 并新建一个空白 tab，不会复用原 tab 清空后继续写入，因此旧会话历史仍可从会话列表恢复
- Loop 主任务 Tab 只有在当前扩展实例仍拥有主任务编排或关联 CLI 运行时才禁止关闭和重置；只要任务记录仍为 `running`，即使主任务直接 CLI 进程已结束（例如所有子任务均已中断），主任务 Tab 顶部仍显示“停止”，点击后会停止关联运行并把父子任务统一落盘为 `stopped`；任务记录遗留 `running` 但已无任何运行所有权且未被用户主动停止时，会收敛为 `stopped` 并解除锁定，同时清理仍标记为活跃的子任务/辩论状态；持久化记录缺失或包含未知 `status` 时，读盘归一化不得按 `running` 恢复，而应按 `stopped` 收敛。重置请求不再先清空 Webview 的旧消息，只有扩展端实际完成“新建空白 Tab + 关闭旧 Tab”后才切换视图，避免被拒绝后切回旧 Tab 又看到原会话
- 对话运行状态区的“提示词”按钮会展示当前会话内全部用户输入，并按输入时间倒序排列，最新提示词置顶
- Prompt 历史记录保存在插件本地历史存储；历史记录弹窗“历史提示词”页签支持展开、复用和星标收藏，收藏状态持久化到记录字段 `favorite`，旧记录缺失字段时按未收藏读取。页签顶部提供“仅收藏”过滤和收藏计数，过滤状态仅作为 Webview 本地 UI 状态保存，不写入工具设置；过滤后无收藏时展示独立空态文案；“清空未收藏”只删除未收藏提示词，收藏提示词不被手动清空、30 天 retention 或数量上限裁剪删除；通过“加入列表”进入队列的提示词会在入队时立即写入历史提示词列表，队列后续自动或手动执行时不会重复写入
- 未收藏历史提示词、历史会话与任务运行痕迹默认仅保留最近 30 天（约 1 个月）；收藏历史提示词不参与 30 天自动清理
- 长期记忆不套用普通历史 30 天清理；关闭长期记忆也不自动删除已有记忆，用户需要通过查看/导出/删除入口显式处理
- 任务队列与并发标签页状态区分
- 队列中的提示词仅在上一个任务成功结束后才会继续执行；如果任务失败或被停止，剩余提示词继续保留在队列中；入队时已写入历史提示词的队列项在执行时携带 `skipPromptHistory`，避免重复记录
- 队列弹窗支持手动“继续执行队列”，用于在失败/停止后恢复后续提示词执行
- Loop 主任务记录为 `running` 且当前扩展实例仍拥有其编排或关联运行时时，该主任务 tab 中提交的新提示词直接进入当前 tab 队列并立即写入历史提示词列表，不允许绕过生命周期运行态启动新任务；阶段性 AI/CLI 进程结束不会提前出队，只有 Loop 任务变为 `completed` 才自动继续队列，`needs-review`、`error` 或 `stopped` 时继续保留。没有运行所有权的残留 `running` 记录会先收敛为 `stopped`，不再永久阻塞关闭、重置或手动恢复
- 单个 Loop 子任务被用户中断或自动重试耗尽失败时，只更新该子任务为待人工续跑状态；父任务仍保持 `running`，并保留该子任务在 `activeSubtaskIds` 中，因此不会因子任务局部中断而被标记为 `error`、`stopped` 或 `needs-review`。子任务 Tab 手动继续成功后，运行时仅在所有活动子任务均已完成、且主任务未达到连续 AI 失败上限时才唤醒主任务复核。串行执行批次遇到中断时，尚未派发的后续子任务标为 `skipped` 并从活动集合移除，留待主任务下一轮重新评估；用户通过 Loop 群聊中止整个任务仍会统一停止父任务和活动子任务

### 3.5 Prompt 输入增强

- `@` 路径插入
- 读取当前文件 / 当前选区作为上下文标签（可在工具设置开启，默认关闭）
- 附件上传
- 工作区路径选择器
- 常用命令，例如压缩上下文
- 长期记忆启用时，插件可在发送 prompt 前按相关性召回当前工作区 `.ch/docs/memory/` 与 `.ch/docs/runbooks/PITFALLS.md` 中的插件侧本地记忆，并作为明确边界的参考块注入；关闭时不召回、不注入，也不更新 generated recall 产物或记忆摘要。

### 3.5.1 插件侧长期记忆

- 记忆数据属于插件本地状态，热区位于当前工作区 harness scaffold 的 `.ch/docs/memory/`，generated recall 位于运行态目录 `~/.sinitek_cli/memory-generated/<workspace>/memory-index/`，踩坑记录位于 `.ch/docs/runbooks/PITFALLS.md`；与 30 天会话历史、prompt history、Loop 任务记录和外部 CLI 配置解耦。
- 插件侧长期记忆热区文件包括 `ROLLING_SUMMARY.md`、`EVENT_MEMORY.md`、`PROJECT_CONTEXT.md`、`USER_PREFERENCES.md`、`PENDING_ITEMS.md`、`ACTIVE_RISKS.md`、`LESSONS_LEARNED.md`；`PITFALLS.md` 单独归入 runbook 体系，用于记录仍有复发风险或长期规避价值的真实踩坑，条目结构覆盖现象、触发条件、根因、长期规避、验证方式和关联资料。
- 开关默认关闭，只在工具设置的“工作区”页签配置并写入 workspace settings；解析配置时采用“显式 false 防误开优先”，兼容旧 `memoryEnabled`、`globalMemoryEnabled`、`workspaceMemoryEnabled` 字段。只有显式开启并确认初始化后，才会安装 scaffold 与触发 CodeGraph 设置。
- 关闭状态下只允许查看、导出和删除已有记忆；不得新建、编辑、自动提取、召回、注入或更新 memory 目录元数据。
- 自动提取受二级开关控制：`memoryAutoExtractAfterCompact` 仅控制 compact 后提取，`memoryAutoExtractAfterLoopTask` 仅控制 Loop 任务总结后提取；二者默认关闭，且必须在总开关和对应作用域开启时才允许写入或更新。
- 任务总结或失败回复中出现明确 `pitfall / gotcha / 踩坑 / 报错 / 失败 / 阻塞 / 回滚` 等信号，并伴随根因、规避或验证线索时，插件可自动写入 `.ch/docs/runbooks/PITFALLS.md` 并刷新 generated recall；普通成功总结仍只写入摘要/事件层，避免把所有错误都固化成长期坑点。
- 该能力只控制插件侧长期记忆，不控制 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、配置或压缩能力。

### 3.6 输出渲染与任务观测

- Markdown 消息展示
- 最终成功回复使用强调卡片样式，Markdown 外层带主题强调边框
- trace 分段展示
- thinking 与 tool-use 事件区分渲染
- Codex app-server 的 reasoning/thinking 摘要会精准移除独占一行的空 HTML 注释 `<!-- -->` 及其水平空白变体；不会改写普通 assistant/user 消息、行内空注释或非空 HTML 注释。历史 Codex thinking 消息在加载时使用同一规则清洗并回写会话存档。
- 任务列表提取与展示；Claude 交互式运行除兼容 `TodoWrite` 外，也会根据 `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` / `TaskStop` 工具事件实时刷新任务列表；普通 Codex prompt 要求 Tasklist 描述默认用中文表达，状态码仍保持 `[pending]` / `[in_progress]` / `[completed]` 英文解析协议，代码符号、命令、路径、包名和用户原文术语可保留原文；Codex app-server assistant 消息会从实际日志中的 `Tasklist:` / `Tasklist update:` / `Tasklist 更新：` 段落解析 `[completed]`、`[in_progress]`、`[pending]`、`[x]`、`[ ]` 与中文状态词，兼容多行列表和同行分号分隔。已解析的纯任务列表 assistant 气泡从对话中隐藏；普通说明混合 Tasklist 时，仅在展示文本中剥离任务列表片段并保留说明正文。每次新 AI run 启动会先按目标 conversation tab 清空旧任务列表并重置解析起点。OpenCode 会从 JSONL `tool_use` 的 `todowrite` 事件读取 `state.input.todos`，并兼容 metadata/output 结果，把 `content/status` 归一化为 `{ text, done }` 后实时刷新当前或并行对话 tab 的任务列表，显式空列表会清空本轮任务。任务列表标题提供收起/展开箭头；收起后仅保留标题、进度数量和箭头，进度显示为已完成/总数（例如 `2/4`），展开状态按 conversation tab 的运行时状态保留。OpenCode 同时通过专用 `taskListUpdate` 和对应 tool trace 元数据驱动浮层，运行中的会话消息刷新会保留 external 列表，Webview 状态重建后会重放仍在执行的列表
- OpenCode one-shot 与并行运行共用 visible-event 语义：`text` 实时形成普通 assistant 气泡，`reasoning` / `step_start` 形成 thinking 气泡，`tool_use` 形成独立 trace 气泡；原始流面板只用于诊断，不能替代对话消息。并行/Loop 子任务消息按 `tabId` 定向并带上任务元数据，进程退出时对完整 final text 去重；Loop 运行时还会把子任务可见 assistant 快照同步到主任务的独立进度气泡。
- OpenCode 父 `run --format json` 不会转发内部子代理的增量消息；插件显式启动受管 `opencode serve`、等待健康后让父任务 `run --attach`，再通过 `/event` 和 session API 获取子会话可见文本。SSE 触发低延迟快照刷新并每 60 秒全量补捞；每个子 session 形成独立 assistant 气泡，状态和正文原位更新。服务启动失败时只显示一次降级状态并继续父任务，SSE 重连按指数退避避免日志刷屏。Codex 使用 App Server 原生 `threadId` 做同样的独立气泡分流。两条链路均支持交错更新，且子代理气泡不作为父任务最终答复。
- 普通“打开 Graph 运行图” action 只由主 Graph tab / 图级系统消息按同一 run 输出一次并打开 GraphRunPanel，Graph 节点/子任务会话不重复展示；active Graph tab 底部仍固定提供“打开 Graph 图”按钮。面板从 Graph run store 和 events 构建状态，界面改为 full-canvas 可视 DAG：画布占满主体可用空间，使用对齐目标工作流画布的 `@dagrejs/dagre` 自动布局，支持按当前节点尺寸调优的层间距/节点间距/边距、布局后碰撞消解、长标题/多下游节点动态高度、dagre 失败时拓扑层级兜底、12-port 自动连线、仅渲染 `depends_on` / `if_pass` / `if_fail` / `review_feedback` / `human_approved` 等流程边、隐藏 `evidence_for` / `conflicts_with` 等追踪/关系边、依赖边不显示可见文字、非依赖流程边保持正向单行短标签（完整说明保留在 title / aria / list）、已经过边按类型高亮：`depends_on` 保持 VS Code 主题蓝色，`if_pass` 绿色、`if_fail` 红色、`review_feedback` 黄色、`human_approved` 橙色，未经过边保持原样、Start/Decision/End/Step 语义 chip、按 `node.kind` 使用 VS Code 主题变量着色的矩形类型卡片、拖拽节点微调并同步重算边 path/端口属性/标签坐标、背景左键按住拖拽平移、拖拽移动不误触发详情、按 `graphRunId` 本地持久化节点位置和 zoom；右上角缩放下拉固定 25%、50%、75%、100%、125%，默认 75%，定位运行节点按钮会将当前 `running` 节点自动滚动到画布可见区域中间，Reset 只作为紧凑控件清除手动节点位置，不再是占空间长文案按钮；面板保留当前真实可用的 Continue、“我要说话”和 Stop run 控制；单击节点打开详情弹窗，弹窗展示节点详情、证据区、补充消息和当前真实可用的 Retry、Feedback rollback 节点控制。Stop 控制和结果消息明确区分 Graph 状态已落盘与真实 CLI 停止仅尝试/未确认。读取失败或 run 缺失时使用 i18n 错误/空态；Phase 2 起支持指定/最近 run 恢复打开。
- GraphRunPanel 自动布局默认展示仍为 LR，但内部已支持 `LR` / `RL` / `TB` / `BT` 方向；fallback 会从所有零入度 roots 入队，`review_feedback` 和指向上游/更早节点的 `if_fail` 回边不参与主 ranking，collision、端口评分与 selected/running/sleeping/blocked/failed 初始居中均按目标系统 workflow 画布经验调优；工具栏可手动定位当前 `running` 节点到可见画布中间。
- tool-use 气泡保留原始工具详情，但标题会按界面语言本地化常见稳定工具名；中文界面下 `read`、`glob`、`grep`、`bash`、`apply_patch`、`todowrite`、`webfetch` 等分别显示为中文语义标题，未知工具名原样回退
- 原始流消息导出；运行中的普通任务和 Loop 子任务可根据原始流空闲时间显示“慢”/“极慢”提示，Loop 主任务不显示这两类提示；历史会话消息可按 TXT 日志导出
- 错误详情查看 / 复制

### 3.7 模型、思考模式与规则

- 模型列表与当前选择按当前配置档案 id 维护，插件侧持久化到 `~/.sinitek_cli/models.json`
- Claude 分组不展示插件侧模型选择或模型管理入口，执行时不会注入 webview 侧选择值；如需固定模型，需由用户自行在 Claude 命令参数中配置
- 打开“管理模型”时，如果前端看到空列表但磁盘或运行态仍有模型数据，扩展会弹出可复制的诊断详情，包含配置 id、存储路径、模型计数和最近读取/配置加载错误
- thinking mode 按 CLI 记忆；AI 对话面板与配置中心中的思考力度一律展示 raw value，不显示“低 / 高 / 最高”等中文别名。Codex/Claude 面板的固定列表为 `low`、`medium`、`high`、`xhigh`、`max`、`ultra`，其中 `ultra` 紧跟 `max` 且为末位；`ultra` 是用户要求的产品级扩展，实际 Codex/Claude 接受程度取决于已安装 CLI/模型。配置中心的 Codex 固定候选为 `minimal`、`low`、`medium`、`high`、`xhigh`、`max`、`ultra`，其中 `max` 紧跟 `xhigh`；Claude 的新建候选不包含 `max`，加载存量 `max` 时会把兼容选项插在 `ultra` 前并保留未知值。OpenCode 没有全局固定 reasoning effort 枚举，只有精确 provider/model 的动态 variants；它们显示 raw `option.value` 并保持 payload 原顺序，即使其中的 `max`、`ultra` 或自定义值不符合固定列表排序。
- Global / Project 规则读写
- 规则目标覆盖 Codex / Claude / OpenCode
- Loop 主任务沿用项目规则；Loop 子任务固定使用运行时隔离，不受规则读写设置影响

### 3.8 配置中心

配置中心支持：

- 配置档案列表、排序、激活、删除、初始化
- 从 AI 对话面板点击“配置”会立即打开并前台聚焦 VS Code 编辑器主区域内的 `WebviewPanel`，随后进入 VS Code Zen Mode，隐藏侧栏、面板、状态栏等工作台外围，形成接近全屏弹窗的配置表面；重复点击复用同一面板并重新聚焦，不重复切换 Zen Mode。VS Code 扩展公开 API 不支持任意 Webview 的原生模态弹窗；Zen Mode 命令不可用时回退为普通编辑器面板。配置页自身会铺满 WebviewPanel 剩余视口，大型配置浮层使用近满屏宽高以减少左右和底部空白；配置页不启动独立浏览器或本地 HTTP 页面
- 配置中心布局和控件继续复用携宁 CLI 配置页的交互，但颜色、字体、边框、焦点、状态、弹层和背景全部使用 VS Code `--vscode-*` 语义变量，自动适配浅色、深色和高对比度主题
- 从对话面板的配置按钮打开配置中心时，若当前视口处于小于等于 `920px` 的窄宽度模式，左侧配置目录首次默认展开；展开后仍可通过关闭按钮、遮罩或 `Esc` 收起
- 当前配置查看与应用
- 配置内容按卡片独立保存，不提供顶部统一保存；Claude 的 `settings.json`、OpenCode 的 `config.json`、Codex 的 `config.toml` / `auth.json` 都在对应卡片右上角保存，只更新该卡片对应字段；若保存的是当前激活配置，会同步把必要的完整 payload 应用到外部 CLI 配置文件。Gemini 配置卡片已移出当前支持范围。
- 点击或新建选择 Claude / OpenCode / Codex 配置档案时，配置卡片默认进入源码模式：Claude / OpenCode 为 JSON，Codex 为 TOML；用户仍可手动切换到可视化模式。
- Codex 配置卡片管理用户级 `~/.codex/config.toml` 与既有 `~/.codex/auth.json` 入口。`config.toml` 是 Codex 主配置文件，必须按 TOML 解析与保存，不得按 JSON 处理；卡片保留可视化编辑和 TOML 源码编辑。视觉模式新增/升级 `model_verbosity`、顶层 `web_search`、`approval_policy`、`model_reasoning_effort` 与 Provider `wire_api` 单选，`developer_instructions` 多行文本，以及既有布尔字段；Provider 可视化只保留 id、name、base_url、wire_api 和 requires_openai_auth，不提供 `env_key` 输入。`model_reasoning_effort` 的新建 raw-value 候选为 `minimal / low / medium / high / xhigh / max / ultra`，其中 `max` 紧跟 `xhigh`。`wire_api` 新建值仅建议 `responses`，而旧 `chat`、未知值、granular `approval_policy`、`[tools].web_search` object 与其他复杂 TOML 保留到源码模式，不能因保存其他字段被静默重写。配置中心不展示、读取、写入、备份或导入导出 `~/.codex/.env`，也不删除用户已有文件；历史档案中的 `envContent` 会被忽略。
- Claude 配置卡片默认提供可视化编辑器，并可切换高级 JSON 模式；页面视觉样式、卡片背景和表单密度与 OpenCode 配置卡片对齐。可视化模式覆盖用户级 `~/.claude/settings.json` 的常用模型、自由文本/列表、权限与网关字段，并新增/升级 `permissions.defaultMode` 单选、`autoCompactEnabled`、`autoMemoryEnabled`、`fileCheckpointingEnabled`、`verbose` 三态布尔，以及 `editorMode`、`viewMode`、`tui` 单选。`effortLevel` 的新建 raw-value 候选为 `low / medium / high / xhigh / ultra`；存量 `max` 仅作为兼容值插在 `ultra` 前，未知值也保留。`includeCoAuthoredBy` 不再作为新表单字段；`attribution`、hooks、复杂 permissions、MCP、企业策略、额外环境变量和未展示字段通过原始 JSON 定向合并保留，无效 JSON 不覆盖最后一次有效可视化状态。第三方网关或云平台仍可独立配置 `ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL` 三档默认模型名称。
- Claude、OpenCode、Codex 三组配置卡片的可视化参数 label 右侧都应提供问号提示；鼠标 hover 展示该参数用途、写入位置和注意事项，枚举型参数必须在提示中列出可选值。三组“查看范例”入口统一放在配置文件名右侧，视觉位置和交互风格对齐 OpenCode，避免 Claude / Codex 与 OpenCode 出现不同布局。
- OpenCode 配置页为模型/Provider 单文件保存，只维护 `~/.opencode/config.json`；OpenCode 全局 MCP 另由 MCP 市场维护官方 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`。配置中心不展示或生成 `~/.opencode/.env`，避免把环境变量档案误解为 OpenCode 第二配置文件。配置卡片示例是可解析的 `myAPI` 主/子模型严格 JSON，包含 `$schema`、顶层 `model` / `small_model`、`provider.myAPI.models` 定义、`options` 与可选 `variants`，其中 `small_model` 作为 OpenCode CLI 兼容字段对应插件子模型；可视化编辑器不提供该字段的配置入口，但会保留并随配置保存；不再内嵌 MCP 示例；`baseURL` 与 `apiKey` 使用官方 `{env:VARIABLE_NAME}` 语法。顶层 `share`、`autoupdate`、`logLevel`、`snapshot` 使用继承语义的受控单选/三态；`model` 使用与其他字段一致的可搜索单选下拉并跨越可视化表单整行，候选仅来自当前配置的 Provider/模型列表；Provider `npm` 仍是可编辑组合框，保留常见 adapter 建议并允许任意 npm。模型思考力度使用可输入 tags，多值基于当前模型已有 `options.reasoningEffort` 与 variant key 提供建议，并仅无损追加 `ultra` 建议；没有固定全局 enum，也不重写 provider-specific/custom/复杂 variants。用户编辑后首项写入默认 `options.reasoningEffort`、全部值生成编辑器管理的简单 variants，未编辑时保留原对象。页面仍说明 `npm` 的建议按 API 协议选择，但四个 `@ai-sdk/*` 建议不是官方封闭列表，不能根据模型名称或推理档位自动换包。兼容网关缺少 `options.baseURL` 会在保存/运行前阻断。完整官方 URL、访问日期和 JSONC/runtime discovery 等延期边界见 [CLI 配置可视化执行计划](../exec-plans/active/2026-07-12-cli-config-visualization.md)。
- 对话面板里的配置档案下拉按 CLI 维度维护 `activeConfigIdByCli`：用户先看到待切换配置，但在宿主完成 `applyConfig` 并回写工作区 active config 之前，提示词发送与队列出队都会等待该配置应用完成；应用失败时会回滚到当前 active config，并展示错误提示，不会出现“下拉已切过去但实际运行仍使用旧配置”的状态。
- 配置中心不再自动或手动把 Claude / Codex 配置转换为 OpenCode 配置；OpenCode 配置列表只展示原生 OpenCode 档案。历史自动迁移档案不会被删除，但会从新的 OpenCode 配置列表中隐藏，避免继续刷新或复用旧转换项
- 备份与导出
- 技能管理
  - 官方 Claude / Codex / OpenCode skills 列表内置仓库快照；具体条目数量以当前 catalog 为准
  - 官方 catalog 为每个条目记录 `version`、`versionSource`、`contentHash`、`sourceCommit`
  - 配置页官方条目会显示“当前版本 / 最新版本”；未安装时显示最新版本，已安装时同时显示当前版本和最新版本
  - 官方最新判断优先基于每个条目的 `contentHash`，缺失时才回退到 `sourceRef`
  - OpenCode 条目的版本展示以当前官方 catalog 元数据为准；Claude / Codex / OpenCode 在上游缺少显式版本号时显示稳定短 `contentHash`
  - Gemini catalog 条目、内置 ZIP 快照及 legacy 同步入口均已移除；历史信息仅保留在 Git 历史和归档计划中，不属于当前配置页官方 Skills 支持口径
- MCP 市场、安装、卸载、健康检查

### 3.9 稳定性与可运维性

- 中英文国际化
- debug 日志开关
- 会话与模型等本地状态持久化
- 模型状态读取失败时保留当前内存状态，避免一次临时读失败把面板模型列表刷新为空
- 日志保留与临时文件清理
- 插件管理的历史痕迹（logs / 未收藏 prompt history / session history / task runs / loop task records / loop communications）默认仅保留最近 30 天（约 1 个月）；收藏 prompt history 保留到用户取消收藏后再按普通历史规则清理
- Webview 渲染失败时的回退页
- 配置中心空白页排查优先看本插件 Webview 前端渲染异常、配置 JSON/TOML 解析异常和配置卡片初始化数据；用户控制台中的 `AugmentExtensionSidecar` 对 `https://d17.api.augmentcode.com/*` 返回 403 是 Augment 扩展侧请求失败，通常不应直接归因于本插件配置页空白，除非同时发现本插件自身日志或 Webview 错误链路指向它。

## 4. 本地数据与配置范围

### 插件自身数据

保存在：

```text
~/.sinitek_cli/
```

### 外部 CLI 配置

配置中心会读写：

- `~/.claude/*`
- `~/.codex/config.toml`：Codex 主配置，格式为 TOML，支持可视化编辑与 TOML 源码编辑
- 配置中心不读写 `~/.codex/.env`；用户已有文件保持不变
- `~/.codex/auth.json`：Codex 鉴权文件，仅按既有受控入口处理，不作为主配置格式
- `~/.opencode/config.json`：OpenCode 模型/Provider 配置中心
- `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json`：OpenCode 官方全局 MCP 配置，插件只维护顶层 `mcp`
- OpenCode 配置中心不再读写 `~/.opencode/.env`；历史多文件配置只作为迁移参考
- 旧 `~/.gemini/*` 仅作历史迁移参考；当前配置中心不再作为 Gemini 配置管理入口

这些内容属于本机 CLI 生态的一部分，不属于仓库内代码产物。

## 4.6 OpenCode 动态 variant 能力

- OpenCode 主模型与子模型分别维护思考力度：主模型使用 `openCodeThinking`，子模型兼容沿用 `openCodeSmallThinking` 存储键，两者都由对应精确 `provider/model` 的 variants 决定，面板动态渲染任意 variant 名称；Vibe（coding）仅展示并使用主模型思考力度，Loop/Graph 才展示并使用子模型思考力度。
- 面板动态 variant 始终显示 raw `option.value`，并按 capability payload 提供的原顺序逐项渲染，不使用中文别名、不套用 Codex/Claude 固定序列，也不因 `max`/`ultra`/自定义值出现而排序或过滤。静态回退列表的 raw 固定顺序为 `... xhigh, max, ultra`，但一旦存在精确模型动态 payload，payload 是唯一权威。
- 能力解析以 `opencode models <provider> --verbose` 的精确模型 metadata 为首选，当前激活配置的显式 `provider.<id>.models.<model>.variants` 为回退；两者都没有时为 Default-only。禁止使用 provider `npm`、provider 名或模型名推断档位。
- 主模型由 `--model provider/model` 选择；OpenCode CLI 的 `run --variant` 是主模型推理力度参数。CLI 没有 `--small-model` / `--small-variant`；仅在需要主从角色的 Loop/Graph runtime config overlay 中覆盖顶层 `small_model` 兼容字段，并把主/子模型各自选中的 variant 写入对应 `provider.<id>.models.<model>.options.reasoningEffort`，避免改写用户原始配置。Vibe overlay 只应用主模型及主模型 variant，不读取或覆盖 `small_model`。
- Vibe 普通对话和普通并行任务只使用下拉选择的 effective main，不读取或覆盖 subtask/small_model；Loop 主任务、主持/复核和续跑使用 main，Loop 子任务使用 subtask；Graph planner 和最终 `summary` 节点使用 main，Graph 其他执行节点使用 subtask。OpenCode `small_model` 仅是底层 CLI 兼容字段，内部 `small: true` 请求是否读取它由 OpenCode 决定。
- OpenCode `text` JSONL 若混入 `<thinking>`、`<think>`、`<analysis>` 或 `<reasoning>` wrapper，实时解析会按顺序拆分 thinking 与 assistant 片段，最终正文排除思考块；reasoning、Codex thinking 与已落盘历史消息只去除上述 wrapper 标签。普通 HTML/代码标签不做通用清洗。
- main/subtask 覆盖按 active config id 隔离，空值跟随顶层配置；配置切换或候选变化会清理失效覆盖，旧 `primary` / `small` 覆盖仅作为兼容别名读取和迁移。
- runtime overlay 固定 effective `model`；只有 Loop/Graph 需要主从角色时才同时固定 effective `small_model`，通过随机 `OPENCODE_CONFIG` 文件注入，目录/文件权限为 `0700`/`0600`，exit/error/timeout/cancel 后清理且不改写用户配置。Vibe 不覆盖用户已有的 `small_model`。
- 每次准备 OpenCode 运行时会写入 `opencode-runtime-profile` 日志，只记录 config ID、main/subtask model 与各自 variant；Vibe 的 subtask model/variant 不传递并记录为空，Loop/Graph 记录实际主/子模型值，便于区分“未传递”和“OpenCode 尚未触发内部 `small: true` 请求”，不记录 API Key、baseURL 或配置正文。
- 运行前总是校验 effective main 和 overlay 后配置；Loop/Graph 还按需要准备 effective subtask。主模型缺失、角色模型不在 active config 候选或 provider/model 被过滤时阻止启动；Vibe 不因缺少子模型阻断。
- active config id、配置内容 hash、OpenCode 命令/version、provider/model 共同隔离能力缓存和选择状态；解析失败保守回退，旧请求不会覆盖后续配置或模型。
- variant 选择按 active config id + 精确 `provider/model` + role 保存，main 兼容旧的 primary/config/model 存储；空值删除选择，失效值自动清理。运行时仅应用当前 options 内的非空值，并尊重用户显式 `--variant` 参数。
- `--variant` 负责推理力度，`--thinking` 只负责 thinking blocks 展示。固定 OpenCode ThinkingMode 和 `thinkingArgs.opencode.*` 已退出运行链路，Codex / Claude 行为不变。

## 4.7 OpenCode 全局 MCP 管理

- MCP 市场可为 OpenCode 安装、覆盖和卸载 local 与 remote 全局 MCP。
- 插件直接管理 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`：local 写入 `type=local`、命令数组、`environment` 和 `enabled`；remote 写入 `type=remote`、URL、`headers` 和 `enabled`。
- 安装只合并目标 `mcp[id]`，保留其他顶层配置和已有 MCP；卸载只删除目标键且支持幂等调用，不执行 OpenCode 不支持的 `mcp remove`。
- 配置读取支持 JSON/JSONC；无效配置不会被覆盖，成功修改后通过同目录临时文件原子替换。
- MCP 市场打开时只做快速安装状态判断，不做健康探测：Claude 读取 `~/.claude.json` 的 `mcp` / `mcpServers` / `mcp_servers`，Codex 读取 `~/.codex/config.toml` 的 `[mcp_servers.<id>]`，OpenCode 读取 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`。健康状态只由“一键检测健康”按钮触发；OpenCode 健康检测仍可用 `opencode mcp list --pure` 映射连接状态，已列出但连接失败的条目显示为已安装且 `unhealthy`，未配置的市场条目显示未安装。
- 内置 `media/mcp_marketplace.json` 已刷新为 16 个官方或权威 MCP 候选：GitHub、Microsoft Learn、Playwright、Docker MCP Gateway、Cloudflare Docs/Browser、Stripe、Sentry、MongoDB、Grafana、Elasticsearch、Slack、Notion、Linear、Brave Search、Atlassian。所有 description 保持中文，凭据只使用环境变量占位；涉及支付、生产错误、数据库、协作写入或浏览器自动化的条目在描述中提示 OAuth、只读、最小权限或人工确认。
- `npm run validate:mcp-marketplace` 读取真实市场 JSON 并校验顶层数组、唯一 id、必填字段、中文 description、官方/权威 homepage、local/remote config、env/headers 类型、占位密钥，以及禁止旧 `github.com/modelcontextprotocol/servers/tree/main/src/` 和旧 `@modelcontextprotocol/server-*` 来源回流。

## 5. 验收视角

当前版本至少应满足：

- 用户能在 VS Code 内完成多 CLI 切换与对话
- 会话、历史、模型和规则在重开面板后仍可恢复
- 配置中心能对本地配置、Skills、MCP 做最小可用管理
- 出现异常时，用户可以看到足够的错误提示和排障入口

## 6. 后续维护规则

只要用户可感知能力发生变化，就应同时更新：

- 本文档
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 必要的运行手册或设计文档
