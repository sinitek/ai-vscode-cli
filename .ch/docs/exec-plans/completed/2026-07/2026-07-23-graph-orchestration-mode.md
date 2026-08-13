# Graph Orchestration Mode Phase 1

- 日期：2026-07-23
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-23
- claim_ttl：1 day
- handoff_to：Loop 主任务

## 背景

`.ch/docs/design-docs/graph-orchestration-mode.md` 已把 Graph 模式定义为显式任务图编排：以节点、边、调度器、持久化事件流和人工/机器关卡组织复杂 AI 编程任务。当前 VS Code 插件已有 Loop 模式、多 agent 子任务、写入冲突分组、睡眠唤醒、群聊观察和本地 CLI 适配经验；Phase 1 应复用这些资产，先建立最小可运行 Graph 内核，而不是重写 Loop 或引入外部 workflow 平台。

本计划承接并记录 Graph Phase 1 开发。Phase 1 已完成最小可用落地：Graph store/events/communications、scheduler、kernel/prompt/lifecycle、`interactiveMode=graph` 后端 runtime、Webview Graph 入口、`openGraphRun` action、只读 GraphRunPanel、i18n 和相关自动化回归均已实现并验证。该结论不包含图编辑器、完整 human gate UI、auto wake 或节点级 retry/continue mutation。

## 目标

- 建立 Graph Phase 1 最小运行内核：`GraphRunStore`、数据模型、`graph.json` 快照与 `events.jsonl` 追加事件流。
- 实现本地 scheduler 的 ready set 计算：`dependsOn`、终态判定、`maxAttempts`、`human_gate` / `sleep`、`writeFiles` 与 `conflictGroup` 串并行约束，默认最多并发 6 个节点。
- 将 `implement`、`test`、`review`、`summary` 等可执行节点适配到现有 CLI / Loop 子任务隔离执行链路。
- 提供 Webview Graph 入口与最小可观察面板：用户能启动 Graph、从运行气泡打开 Graph 运行图、查看状态统计、节点列表和节点详情。
- 完成新增文案 i18n、核心/页面测试和文档同步规则；实现完成且验收通过后，再同步用户可见功能清单。

## 范围

- Graph 数据与持久化：已新增 `src/graph/` 下的类型、store、事件日志、schema 校验和测试。
- Graph 调度：已新增 scheduler 纯函数，覆盖 ready set、冲突组、写入路径重叠、失败/阻塞/睡眠/人工关卡状态推进。
- CLI 节点执行适配：复用现有 `src/cli/`、`src/interactive/` 和 Loop 子任务执行根，只做 Graph 到现有 runner 的接线；节点级停止/继续 mutation 不属于 Phase 1。
- Webview 可观察面：已接入模式入口、运行消息 action、Graph 面板状态构建、节点详情和 Refresh；Stop / Continue / Retry / Approve 未稳定支持，不渲染为可用操作。
- i18n：新增用户可见文案进入现有 `src/i18n.ts` 与 Webview 字符串体系，不在 UI 中硬编码展示文案；未新增 package command，因此未修改 `package.nls*.json`。
- 测试与文档：补新增运行内核测试、调度测试、CLI 适配边界测试、Webview 静态渲染或页面测试，并按实现结果同步设计/规格/功能清单。

## 非目标

- 不在 Phase 1 引入 React Flow、图拖拽编辑器或完整低代码 workflow 编辑器。
- 不引入 Mastra、Inngest、Trigger.dev、Temporal、数据库服务或云端队列作为默认运行时。
- 不把 Graph 等同于 CodeGraph、调用图、知识图谱或 LangGraph 框架。
- 不迁移或重写现有 Loop task store、Loop 辩论、群聊、睡眠唤醒和主从多智能体逻辑。
- 不允许用户上传任意脚本作为节点直接执行；可执行节点仍通过受控 CLI / prompt / 工具链路。
- 不在功能尚未实现前更新 `FEATURE_INVENTORY.md` 声称 Graph 已可用；只在实现完成并验证后同步清单。

## 验收标准

- [x] `GraphRunStore` 能创建、读取、更新 Graph run，持久化 `GraphRunRecord`、`GraphNodeRecord`、`GraphEdgeRecord`，并维护 `graph.json` 与 `events.jsonl`。
- [x] `events.jsonl` 使用追加式结构化事件，能记录 run/node 状态变化、attempt、错误摘要、人工关卡和最终证据，且对敏感字段做基础脱敏。
- [x] Scheduler ready set 能正确处理 `dependsOn`、节点终态、`maxAttempts`、`human_gate`、`sleep`、`writeFiles` 路径重叠、`conflictGroup` 和最多 6 个并发节点。
- [x] CLI 节点执行适配能把 Graph 节点转换为现有 Codex / Claude / OpenCode 执行链路，保留节点 prompt 的授权范围、沟通文件和验证要求；当前 extension runtime 的基线图以 `maxConcurrent=1` 串行运行，节点级停止/继续 mutation 不属于 Phase 1。
- [x] Webview 提供 Graph 模式入口、运行气泡的“打开 Graph 运行图”动作、状态统计、节点列表、节点详情和只读事件/产物摘要。
- [x] 新增 Webview 和后端文案提供中英文 i18n；GraphRunPanel 样式复用 VS Code 主题变量。
- [x] 新增或更新单元测试覆盖 store、schema、scheduler、执行适配、runtime 接线和 Webview 渲染/协议关键路径。
- [x] `npm run build` 与指定 Graph/Webview/Runtime/纯层关键测试通过。
- [x] 文档同步完成：设计文档、`FEATURE_INVENTORY.md`、产品规格和兼容入口均按实际 Phase 1 能力与限制更新。
- [x] Summary prompt 与 lifecycle/runtime 只在依赖节点通过后生成 finalAnswer；失败、blocked、stopped、skipped 或未验证节点会进入 unresolved 或阻止 summary 执行。

## 影响面

- 代码目录：
  - 拟新增：`src/graph/`（类型、store、events、scheduler、executor adapter、状态构建纯函数）。
  - 拟修改：`src/extension.ts`（命令/运行入口/停止继续接线）、`src/webviewCommandCoordinator.ts`（消息 action）、`src/panelStateBuilder.ts` / `src/panelDiagnostics.ts`（Graph 状态进入面板）。
  - 拟修改：`src/webview/`（输入区模式入口、Graph 面板或可观察视图、Webview 协议类型）。
  - 拟修改：`src/i18n.ts`、`package.nls.json`、`package.nls.zh-cn.json`（新增文案）。
  - 拟新增/修改：`src/test/graph*.test.ts`、相关 `loop*` / `webview*` 测试。
- 文档目录：
  - 本执行计划：`.ch/docs/exec-plans/completed/2026-07/2026-07-23-graph-orchestration-mode.md`。
  - 设计与规格：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`（实现完成后同步）。
  - 测试规则引用：`.ch/docs/TESTING.md`。
- 配置与脚本：
  - `package.json` scripts 当前已有 `npm run build`、`npm run test:core`、`npm run test:page`；Phase 1 优先复用，不先新增脚本。
  - `package.json` commands/activationEvents 仅在新增用户可见命令时修改；若先复用现有面板入口，可避免新增 activation event。

## 风险与缓解

- 风险：Graph store 与 Loop task store 重复维护类似状态格式，后续难以迁移。
  - 缓解：Graph 类型单独建模，但复用 Loop 已验证的目录隔离、状态值命名、冲突组语义和 JSON 校验习惯；不要反向改造 Loop。
- 风险：Scheduler 并发写入冲突判断不完整，导致多个节点同时改同一文件。
  - 缓解：所有写入节点必须声明 `writeFiles` 或 `conflictGroup`；无法判断时默认串行；复用并测试 Loop 的路径归一化/重叠经验。
- 风险：CLI adapter 绕开既有子任务隔离或最终答复约束。
  - 缓解：Graph 节点只转换为现有 runner/Loop 子任务执行参数，不引入第二套 CLI 协议；节点级停止/继续在具备完整持久化状态机前不对用户暴露。
- 风险：Webview 过早投入复杂图编辑，扩大 Phase 1 范围。
  - 缓解：Phase 1 只做可观察面板：列表、状态统计、详情和必要操作；图编辑器进入后续阶段。
- 风险：i18n 或主题样式遗漏，导致硬编码文案/颜色进入 UI。
  - 缓解：新增文案逐项列入 `i18n.ts` / `package.nls*.json` / Webview 字符串；样式复用现有 VS Code CSS 变量或既有语义类。
- 风险：未实现能力被提前写入功能清单。
  - 缓解：本计划只记录“实现完成时同步”；`FEATURE_INVENTORY.md` 只在验收通过后更新为实际能力。

## 验证计划

- 最小相关验证：
  - `npm run build`
  - 新增 Graph 单测编译后最小运行：`node --test dist/test/graph*.test.js`
  - 涉及 Loop 复用时运行：`npm run test:core`
  - 涉及 Webview 入口/面板时运行：`npm run test:page` 或更小的相关 dist 测试集合
- 单元自测命令：
  - Store/schema：覆盖创建、读取、更新、损坏 JSON、未知枚举、事件追加和敏感字段过滤。
  - Scheduler：覆盖依赖完成、失败重试、blocked、sleep、human_gate、`writeFiles` 重叠、`conflictGroup` 串行和并发上限。
  - CLI adapter：覆盖节点 prompt 构造、授权写入范围、沟通文件路径、失败回写和最终 summary 触发条件。
  - Webview：覆盖 Graph 模式入口、运行 action、状态统计、节点详情渲染和中英文文案。
- 扩展验证：
  - 手工或集成级 smoke：创建一个含 plan -> implement/test -> review -> summary 的小型 Graph run，确认状态落盘、事件流、面板刷新和最终答复证据链。
  - 失败路径 smoke：让 test 节点失败，确认仅相关后续节点阻塞，不生成成功最终答复。

## 测试与清单同步

- 单元测试新增/更新：
  - Phase 1B 已新增 `src/test/graphStore.test.ts`、`src/test/graphEvents.test.ts`，覆盖 store/schema/communications/events 边界。
  - Phase 1C 已新增 `src/test/graphScheduler.test.ts`，覆盖 ready set、失败重试、条件边、running 冲突、批次内冲突、unscoped 写入串行、并发上限、human_gate 和 sleep 节点不进入 CLI batch。
  - Phase 1D 已新增 `src/test/graphPromptBuilders.test.ts`、`src/test/graphNodeLifecycle.test.ts`、`src/test/graphKernel.test.ts`，覆盖自包含节点 prompt、summary 约束、生命周期状态/事件推进、依赖注入 executor、executor throw、blocked/failed 回写、human_gate/sleep 非普通 CLI 执行。
  - Phase 1E 已新增 `src/test/graphRunPanel.test.ts`、`src/test/graphMainWebview.test.ts`，并更新 `src/test/cliPageStaticRenderCoverage.test.ts`、`src/test/opencodeloopmodewebview.test.ts`、`src/test/sessionMessageHandlersCoreCoverage.test.ts`，覆盖 Graph Webview 入口、前端 payload/action、GraphRunPanel 状态统计/节点详情/空态/i18n 和 openGraphRun handler deps。
- 单元自测结果：
  - Phase 1A 前置审计已合并：运行内核审计、UI/i18n 审计和验证基线报告均已读取并纳入后续边界判断。
  - Phase 1B 数据模型与持久化已落地：新增 Graph v1 类型、run store、communications 初始化、`graph.json` 快照、`events.jsonl` append/read 和基础 redaction。
  - Phase 1C scheduler 已落地：新增纯函数 `src/graph/graphScheduler.ts`，仅从 `GraphRunRecord` 计算 ready nodes、CLI execution batch、human/sleep ready action、blocker 和 conflict reason；不访问文件系统、不调用 CLI、不依赖 VS Code API。
  - Phase 1D kernel/adapter 纯层已落地：新增 `src/graph/graphPromptBuilders.ts`、`src/graph/graphNodeLifecycle.ts`、`src/graph/graphKernel.ts`，把 scheduler 选中的 CLI 节点转换为自包含 prompt，通过依赖注入 `GraphNodeExecutor` 执行，并用 lifecycle 回写节点状态、attempt、activeNodeIds、lastError、finalAnswer 和 events；不接入 `extension.ts`、Webview、VS Code API 或真实 CLI 进程。
  - 验证命令：`npm run build`，结果通过，退出码 0。
  - 验证命令：`node --test dist/test/graphScheduler.test.js`，结果通过，9/9 tests passed，退出码 0。
  - 验证命令：`node --test dist/test/graphStore.test.js dist/test/graphEvents.test.js dist/test/graphScheduler.test.js`，结果通过，18/18 tests passed，退出码 0。
  - Phase 1D 验证命令：`npm run build`，结果通过，退出码 0。
  - Phase 1D 验证命令：`node --test dist/test/graphPromptBuilders.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphKernel.test.js`，结果通过，12/12 tests passed，退出码 0。
  - Phase 1D 回归命令：`node --test dist/test/graphStore.test.js dist/test/graphEvents.test.js dist/test/graphScheduler.test.js dist/test/graphPromptBuilders.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphKernel.test.js`，结果通过，30/30 tests passed，退出码 0。
  - Phase 1D/1E 之间的后端 runtime 接线已落地：`interactiveMode=graph` 可由 panel sendPrompt 后端分支进入 `runGraphPrompt`，extension 创建最小 `plan -> implement -> test -> review -> summary` realized graph，初始化 Graph store/communications/events，通过 `tickGraphRun` 调度，并以 `taskRole="subtask"` 复用现有 `runPrompt` 执行 CLI 节点；extension 第一阶段强制 `maxConcurrent=1`。
  - Phase 1D/1E runtime 验证命令：`npm run build`，结果通过，退出码 0。
  - Phase 1D/1E runtime 验证命令：`node --test dist/test/sessionMessageActions.test.js dist/test/sessionMessageActionsCoreCoverage.test.js dist/test/graphExtensionRuntime.test.js`，结果通过，36/36 tests passed，退出码 0。
  - Phase 1D/1E runtime Graph 回归命令：`node --test dist/test/graphStore.test.js dist/test/graphEvents.test.js dist/test/graphScheduler.test.js dist/test/graphPromptBuilders.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphKernel.test.js`，结果通过，30/30 tests passed，退出码 0。
  - Phase 1E Webview/Panel 已落地：主 Webview `interactiveModeSelect` 增加 Graph 选项，前端 normalize / queue / sendPrompt 保留 `interactiveMode=graph`；Graph 模式下 Loop execution mode 仍仅在 Loop 模式显示；`openGraphRun` message action 支持默认 i18n label 并派发 `PanelMessage.openGraphRun`；新增只读 `GraphRunPanel`，展示 run 概览、状态统计、节点列表、节点详情、recent events、finalAnswer、prompt/artifact/communication refs，未稳定支持的 Stop/Continue/Retry/Approve 操作不渲染；production handler/extension 已注入 Graph panel coordinator，从 Graph run store/events 构建面板状态。
  - Phase 1E 验证命令：`npm run build`，结果通过，退出码 0。
  - Phase 1E Webview/Panel 验证命令：`node --test dist/test/graphRunPanel.test.js dist/test/graphMainWebview.test.js dist/test/cliPageStaticRenderCoverage.test.js dist/test/clipagescriptruntimecoverage.test.js dist/test/opencodeloopmodewebview.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`，结果通过，33/33 tests passed，退出码 0。
  - Phase 1E 后端 Graph runtime 回归命令：`node --test dist/test/sessionMessageActions.test.js dist/test/sessionMessageActionsCoreCoverage.test.js dist/test/graphExtensionRuntime.test.js`，结果通过，36/36 tests passed，退出码 0。
  - Phase 1E Graph 纯层回归命令：`node --test dist/test/graphStore.test.js dist/test/graphEvents.test.js dist/test/graphScheduler.test.js dist/test/graphPromptBuilders.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphKernel.test.js`，结果通过，30/30 tests passed，退出码 0。
  - Phase 1F 最终验证命令：`npm run build`，通过，退出码 0。
  - Phase 1F Graph Webview/Panel 验证命令：`node --test dist/test/graphRunPanel.test.js dist/test/graphMainWebview.test.js dist/test/cliPageStaticRenderCoverage.test.js dist/test/clipagescriptruntimecoverage.test.js dist/test/opencodeloopmodewebview.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`，通过，33/33 tests passed，退出码 0。
  - Phase 1F 后端 Graph runtime 验证命令：`node --test dist/test/sessionMessageActions.test.js dist/test/sessionMessageActionsCoreCoverage.test.js dist/test/graphExtensionRuntime.test.js`，通过，36/36 tests passed，退出码 0。
  - Phase 1F Graph 纯层验证命令：`node --test dist/test/graphStore.test.js dist/test/graphEvents.test.js dist/test/graphScheduler.test.js dist/test/graphPromptBuilders.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphKernel.test.js`，通过，30/30 tests passed，退出码 0。
  - 后续阶段每批代码改动后必须记录实际命令、结果、退出码和失败分类。
- 失败处理记录：
  - 若新增 Graph 测试失败，先按 `.ch/docs/TESTING.md` 分类为实现缺陷、断言过期、夹具问题、环境问题或历史失败，再决定修复/隔离/记录。
- 功能清单：
  - Phase 1 已完成并通过验收，已同步 Graph 模式能力、限制、入口、状态可观察性和仍未支持的图编辑能力。
- 相关文档同步：
  - 实现完成后更新 `.ch/docs/design-docs/graph-orchestration-mode.md` 的状态与实际落点。
  - 新增 Graph 用户可见入口已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表（Tasklist）

- [x] Phase 1A：合并前置审计结论
  - [x] 读取运行内核审计报告，确认 Graph store、scheduler、CLI adapter 的文件边界。
  - [x] 读取 UI/i18n 审计报告，确认 Webview 入口、面板协议和文案清单。
  - [x] 读取验证基线报告，确认当前 build/test 状态和最小重跑命令。
- [x] Phase 1B：数据模型与持久化
  - [x] 新增 Graph 类型：`GraphRunRecord`、`GraphNodeRecord`、`GraphEdgeRecord`、状态枚举、事件枚举和 acceptance/result 类型。
  - [x] 新增 `GraphRunStore`，支持 workspace/cli/session/run 维度的 run store 路径解析、读写、创建、更新和校验。
  - [x] 新增 `events.jsonl` 追加写入与读取摘要，确保状态变化有可复盘 trace。
  - [x] 增加 store/schema/events 单元测试。
- [x] Phase 1C：Scheduler ready set 与冲突组
  - [x] 新增 ready set 纯函数，处理依赖、终态、attempt、sleep、human_gate 和条件边。
  - [x] 实现 `writeFiles` 路径归一化与重叠判断，复用或对齐 Loop 冲突语义。
  - [x] 实现 `conflictGroup` 默认串行与并发上限 6 的批次规划。
  - [x] 增加 scheduler 单元测试，覆盖通过/失败/阻塞/冲突/并发上限。
- [x] Phase 1D：CLI 节点执行适配
  - [x] 定义 Graph 节点到现有 CLI/Loop 子任务执行参数的转换层（纯 kernel 层：`GraphNodeExecutor` 依赖接口，后续由 extension 接真实 runner）。
  - [x] 将节点 prompt 包含授权范围、输入 artifact、输出 artifact、完成标准和验证要求。
  - [x] 接入节点状态回写、attempt、错误摘要、human_gate/sleep 系统推进和 summary finalAnswer 触发条件。
  - [x] 增加 adapter 单元测试或带依赖注入的伪 runner 测试。
- [x] Phase 1D/1E：后端 Runtime 接线
  - [x] 扩展 `InteractiveMode` / prompt run state / workspace settings 读取路径，保留 `graph` 模式不被归一回 `coding`。
  - [x] 在 `handleSendPromptMessage` 增加 Graph 分支：记录 prompt history、保存 workspace mode、预加载用户消息，并调用 `runGraphPrompt`；Graph 不走 `runLoopPrompt` 或普通 `runPrompt`。
  - [x] 在 `extension.ts` 接入 Graph store/events/kernel，创建最小 realized graph，并以 `maxConcurrent=1` 串行 tick。
  - [x] Graph node executor 复用现有 `runPrompt`，传入 `buildGraphNodePrompt` 生成的节点 prompt，并使用 `taskRole="subtask"` 复用子任务执行根隔离。
  - [x] Graph run 启动、完成、needs-review/error/idle 均追加用户可见系统消息；Webview Graph 面板和按钮渲染仍留给 Phase 1E。
- [x] Phase 1E：Webview Graph 入口与可观察面板
  - [x] 增加 Graph 模式入口或实验入口，用户可明确选择 Graph 启动。
  - [x] 在 Graph 运行消息上提供打开运行图 action。
  - [x] 实现最小 Graph 面板：状态统计、节点列表、节点详情、事件/产物摘要。
  - [x] 确认停止、继续、重试失败节点、批准 human_gate、补充需求不属于稳定 Phase 1 协议；未稳定支持的操作已隐藏，不伪装可用。
  - [x] 增加 Webview 静态渲染/协议测试和中英文文案断言。
- [x] Phase 1F：文档、验证与收尾
  - [x] 运行最小相关验证命令并记录结果。
  - [x] 根据实际实现更新设计文档状态、产品规格和功能清单。
  - [x] 确认未通过节点不会生成成功最终答复，最终总结包含验证证据和未完成事项。
  - [x] 完成后将本计划从 `active/` 归档到 `completed/`。

## 决策记录

- 2026-07-23：Phase 1 采用本地自建小型 Graph kernel，不引入外部 workflow 平台或数据库服务。
- 2026-07-23：Graph 节点执行继续复用现有 CLI / interactive / Loop 子任务隔离链路，Graph 只负责调度、状态和可观察性。
- 2026-07-23：`writeFiles` 与 `conflictGroup` 是 Graph scheduler 的一等调度属性；无法确定写入范围的节点默认串行。
- 2026-07-23：第一版 UI 只做可观察面板，不做图编辑器；节点图可先用列表和依赖缩进表达。
- 2026-07-23：`FEATURE_INVENTORY.md` 只在 Graph 实现完成且验证通过后同步，不在计划阶段声明已具备能力。

## 当前结论

Graph Phase 1A-F 已完成并归档。当前用户可在主 Webview 选择 `Graph` 模式并发送，前端 payload 保留 `interactiveMode=graph`，后端 `runGraphPrompt` 创建并串行执行 `plan -> implement -> test -> review -> summary` 基线 realized graph。Graph run state、`graph.json`、`events.jsonl` 和节点沟通文件落盘；`openGraphRun` action 可渲染并打开独立只读 GraphRunPanel，面板展示 run 概览、状态统计、节点列表、节点详情、recent events、finalAnswer、artifactRef/promptRef/communicationFile，并对缺失 run / 读取失败使用 i18n 提示。设计文档、产品规格、`FEATURE_INVENTORY.md` 和兼容入口已同步；最终 build 与三组指定关键测试已在本计划归档前复跑并记录结果。人工批准 UI、auto wake、节点级 Stop/Continue/Retry/Approve mutation、图编辑器、模板库和局部返工编辑仍未实现，不得据此宣称完整 workflow 平台。
