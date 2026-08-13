# Graph Phase 2 恢复与可视化增强

- 日期：2026-07-23
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-23
- claim_ttl：1 day
- handoff_to：Loop 主任务

## 背景

Graph Phase 1 已完成最小运行内核：用户可在 Webview 选择 Graph，后端创建并执行固定五节点串行基线图 `plan -> implement -> test -> review -> summary`，Graph store/events/scheduler/kernel 已落盘；Phase 1 的 `openGraphRun` 先打开只读 GraphRunPanel。

但 Phase 1 面板主要是概览、状态统计、节点列表、节点详情、recent events 和 finalAnswer，不是真正的节点-边视觉 DAG。用户本轮明确要求 Graph 模式必须有可视化 graph，否则无法看出是 graph。因此 Phase 2 必须先补真正可视 DAG，再继续推进恢复、重新打开和最小交互 mutation。

## 目标

- Phase 2A：复核 Phase 1 已有能力、视觉缺口、runtime 恢复缺口和当前 build/test 基线。
- Phase 2B：在 GraphRunPanel 中实现原生 SVG + HTML/CSS 的只读可视 DAG，展示节点、边、箭头、状态、选中节点详情联动和基础键盘可访问性。
- Phase 2C：补齐 Graph run 从持久化记录中重新打开、最近运行定位、扩展重启后的状态找回和恢复 tick 能力。
- Phase 2D：在后端控制协议稳定后实现最小交互 mutation 子集，例如 retry failed node、continue/resume、approve human_gate、stop/cancel；未接通前不渲染假按钮。
- Phase 2E：完成文档、功能清单和最终验证；仅按已落地能力更新功能清单，不提前宣称 Phase 2 全量可用。

## 范围

- GraphRunPanel 视觉 DAG：`src/webview/graphRunPanel*.ts`、`src/panelStateBuilder.ts`、`src/panelDiagnostics.ts` 和相关测试。
- Graph run 恢复与重新打开：后续批次按 runtime 审计建议在 `src/graph/*`、`src/extension.ts`、`src/panelDiagnostics.ts` 等文件中落地。
- 最小交互 mutation：后续批次在具备状态迁移、权限边界和测试覆盖后接入，不与 Phase 2B 视觉 DAG 混做。
- 文档和测试：本计划记录各阶段状态，最终完成后按实际能力同步功能清单和产品规格。

## 非目标

- 不引入 React Flow、XState、Temporal、Inngest、Trigger.dev、workflow 引擎、数据库服务或新依赖。
- 不在 Phase 2B 实现图编辑器、拖拽 DAG、运行前图确认、模板库或复杂返工路径编辑。
- 不在没有后端控制协议时渲染 Retry / Continue / Approve / Stop 等假按钮或 disabled 占位控件。
- 不重写 Loop task store、Loop auto wake、CLI runner 或 Graph Phase 1 kernel。
- 不更新 `FEATURE_INVENTORY.md` 宣称 Phase 2 已全量可用，除非对应能力已经实现并通过验证。

## 验收标准

- [x] Phase 2A 审计/基线报告已完成并被本计划吸收。
- [x] Phase 2B GraphRunPanel 展示真正节点-边可视 DAG，串行五节点可直观看到 `plan -> implement -> test -> review -> summary`。
- [x] Phase 2B DAG 使用原生 SVG 渲染边/箭头，HTML button 渲染节点，支持点击/聚焦并与详情联动。
- [x] Phase 2B `openGraphRun` 的 `nodeId` 能影响初始选中节点，Refresh 后尽量保留当前选中节点。
- [x] Phase 2B 新增文案有中英文，样式仅使用 VS Code 主题变量或 `currentColor`，无硬编码 hex/rgb/hsl 颜色。
- [x] Phase 2C 支持从持久化 Graph run 中重新打开最近/指定 run，并支持恢复到可继续 tick 的状态。
- [x] Phase 2C 纯核心 primitives 已完成：store 可 list/filter/latest/read，坏 store 部分容错；kernel 支持 future/due sleep 恢复 tick。
- [x] Phase 2C extension/panel 重新打开最近 run、恢复服务和 auto wake 接线已完成。
- [x] Phase 2D 支持经测试覆盖的最小 mutation 子集，且不会渲染未接通操作。
- [x] Phase 2D 纯核心 primitives 已完成：resume/retry/approve/stop 状态机、事件和结构化结果已补测试。
- [x] Phase 2D extension/panel 操作入口、消息协议、Graph 状态 stop 和可用 active CLI stop 映射接线已完成。
- [x] Phase 2E 文档、功能清单和最终验证按实际落地能力完成同步。

## 影响面

- 代码目录：
  - Phase 2B：`src/webview/graphRunPanelTypes.ts`、`src/panelStateBuilder.ts`、`src/panelDiagnostics.ts`、`src/webview/graphRunPanel.ts`、`src/webview/graphRunPanelStyles.ts`、`src/webview/graphRunPanelRenderer.ts`。
  - Phase 2C/2D：已涉及 Graph store/control/auto wake、extension runtime、panel coordinator 和 session handler。
- 文档目录：
  - 本执行计划：`.ch/docs/exec-plans/active/2026-07-23-graph-phase2-recovery-visualization.md`。
  - 已按实际能力同步设计文档、产品规格和功能清单。
- 配置与脚本：
  - 不新增 npm 依赖，不修改 package scripts。

## 风险与缓解

- 风险：视觉 DAG 只画节点但不画边，仍无法体现 graph 拓扑。
  - 缓解：Phase 2B 明确渲染 SVG edge path 和 arrow marker；`run.edges` 为空时从节点 `dependsOn` fallback 生成 `depends_on` 边。
- 风险：从 `dependsOn` fallback 推边会丢失条件边语义。
  - 缓解：优先投影 `run.edges`，仅在旧记录或空边记录时 fallback。
- 风险：UI 先于 runtime mutation 暴露 Retry/Approve/Continue/Stop，造成假能力。
  - 缓解：Phase 2B 不渲染 mutation 按钮；后续 2D 等后端控制协议稳定后再接入。
- 风险：布局处理循环/异常边过度复杂。
  - 缓解：使用确定性 layered/topo 布局；异常边降级仍展示节点和边，不做图编辑器。
- 风险：样式破坏主题兼容性。
  - 缓解：只使用 VS Code CSS 变量、`currentColor` 和现有语义样式，并用测试扫描硬编码颜色。

## 验证计划

- 最小相关验证：
  - `npm run build`
  - `node --test dist/test/graphRunPanel.test.js dist/test/graphMainWebview.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`
- 单元自测命令：
  - Phase 2B 修改面板/协议时追加覆盖 DAG HTML、edge 投影、fallback、nodeId 初始选中、空态、事件读取失败和 mutation 按钮缺席。
- 扩展验证：
  - 若修改主 Webview runtime 或 session message runtime，追加运行主页面静态/运行时相关 dist 测试。

## 测试与清单同步

- 单元测试新增/更新：
  - Phase 2B 更新 `src/test/graphRunPanel.test.ts`、`src/test/graphMainWebview.test.ts`、`src/test/sessionMessageHandlersCoreCoverage.test.ts`。
  - Phase 2C/2D 纯核心更新 `src/test/graphStore.test.ts`、`src/test/graphNodeLifecycle.test.ts`、`src/test/graphKernel.test.ts`，新增 `src/test/graphRunControl.test.ts`。
- 单元自测结果：
  - Phase 2B：`npm run build` 通过，退出码 0。
  - Phase 2B：`node --test dist/test/graphRunPanel.test.js dist/test/graphMainWebview.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js` 通过，退出码 0，17/17 tests passed。
  - Phase 2C/2D 纯核心：首次 `npm run build` 失败，退出码 2；失败分类为实现/测试类型错误，已修复 `GraphEventRecord` import 与 `assert.deepEqual(executed, [])` 收窄问题。
  - Phase 2C/2D 纯核心：`npm run build` 通过，退出码 0。
  - Phase 2C/2D 纯核心：`node --test dist/test/graphStore.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphKernel.test.js dist/test/graphRunControl.test.js` 通过，退出码 0，24/24 tests passed。
  - Phase 2C/2D 纯核心回归：`node --test dist/test/graphStore.test.js dist/test/graphEvents.test.js dist/test/graphScheduler.test.js dist/test/graphPromptBuilders.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphKernel.test.js dist/test/graphRunControl.test.js` 通过，退出码 0，40/40 tests passed。
  - Phase 2C/2D extension/panel 接线：首次 `npm run build` 曾因旧 coordinator deps 与 graph metadata 类型误插入失败，已在授权范围内修复。
  - Phase 2C/2D extension/panel 接线：`npm run build` 通过，退出码 0。
  - Phase 2C/2D extension/panel/control/auto-wake：`node --test dist/test/graphRunPanel.test.js dist/test/graphMainWebview.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageActionsCoreCoverage.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphAutoWake.test.js` 通过，退出码 0，58/58 tests passed。
  - Phase 2C/2D 纯层最终回归：`node --test dist/test/graphStore.test.js dist/test/graphEvents.test.js dist/test/graphScheduler.test.js dist/test/graphPromptBuilders.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphKernel.test.js dist/test/graphRunControl.test.js` 通过，退出码 0，40/40 tests passed。
  - Phase 2C/2D 主 Webview 回归：`node --test dist/test/cliPageStaticRenderCoverage.test.js dist/test/clipagescriptruntimecoverage.test.js dist/test/opencodeloopmodewebview.test.js` 通过，退出码 0，19/19 tests passed。
- 失败处理记录：
  - Phase 2B 未留下失败测试；验证中若出现断言偏差按 `.ch/docs/TESTING.md` 分类修复。
- 功能清单：
  - 已同步 `FEATURE_INVENTORY.md`、`sinitek-cli-plugin-capabilities.md` 和 `docs/插件功能清单.md`，只声明已落地的可视 DAG、持久化恢复、Continue/Retry/Approve/Stop 子集和 Graph auto wake。
  - 未把图编辑器、模板库、完整 human gate 表单、复杂级联 retry 或局部返工编辑写成已完成。
- 相关文档同步：
  - 本计划、设计文档、产品规格和兼容功能清单已同步 Phase 2 实际完成能力与限制。

## 任务列表

- [x] Phase 2A：审计/基线
  - [x] 读取并吸收视觉面板审计结论：Phase 1 面板不是真正视觉 DAG。
  - [x] 读取并吸收 runtime/recovery 审计结论：mutation 暂缓，视觉 DAG 可先独立落地。
  - [x] 识别 Round 1 执行计划缺口并补齐本计划。
- [x] Phase 2B：真正可视 DAG
  - [x] 在 GraphRunPanel state 中增加可渲染边数据。
  - [x] 从 `run.edges` 投影边，缺失时从 `dependsOn` fallback 生成 `depends_on` 边。
  - [x] 支持 `openGraphRun` 请求的 `nodeId` 作为初始选中节点，并在 Refresh 后保留可用选中项。
  - [x] 使用原生 SVG 渲染边、path、marker，使用 HTML button 渲染 DAG 节点。
  - [x] 实现点击/键盘基础选择、`vscode.setState` 保存选中节点、节点列表与详情联动。
  - [x] 新增 DAG 样式和中英文文案，保持 VS Code 主题变量。
  - [x] 补充面板、主 Webview action 和 session handler 相关测试。
  - [x] 完成 build 和最小相关测试。
- [x] Phase 2C：Graph run 恢复/重新打开
  - [x] 纯核心：支持 Graph run list/filter/latest/read by id，按 updatedAt/createdAt 倒序、limit 限制，并对坏 store 文件部分容错返回 errors/diagnostics。
  - [x] 纯核心：kernel 对未到期 sleep node 进入 node/run sleeping；到期 sleep 可系统推进为 passed，并可继续后续 tick。
  - [x] 接线：支持最近/当前 Graph run 在 extension/panel 中列出与打开。
  - [x] 接线：支持扩展重启后从持久化 run 恢复到可继续状态和 auto wake。
  - [x] 接线：处理 events/store 部分读取失败的 UI 降级展示。
- [x] Phase 2D：最小交互 mutation
  - [x] 纯核心：设计并验证 retry/continue/approve/stop 的状态迁移和权限边界。
  - [x] 纯核心：新增结构化 control result 和 control state，供后续判断 canContinue/canRetry/canApprove/canStop。
  - [x] 接线：只渲染真实接通且当前状态可用的操作。
  - [x] 接线：补充 mutation 后端、面板消息和状态回写测试。
- [x] Phase 2E：文档、功能清单和最终验证
  - [x] 按实际能力同步设计文档与产品规格。
  - [x] 仅在能力真实落地后更新功能清单。
  - [x] 完成最终 build/test 证据记录。

## 决策记录

- 2026-07-23：Phase 2B 使用原生 SVG + HTML/CSS，不引入 React Flow 或其他 workflow 依赖。
- 2026-07-23：DAG 边优先来自 `run.edges`，旧记录或空边记录通过节点 `dependsOn` fallback 生成。
- 2026-07-23：GraphRunPanel 节点使用 HTML button 而不是纯 SVG 节点，以保留点击、focus 和基础键盘可访问性。
- 2026-07-23：Runtime mutation 按钮不在视觉 DAG 批次渲染，避免 UI 暴露未接通能力。
- 2026-07-23：Phase 2C/2D 只渲染真实接通且当前状态允许的 Continue/Retry/Approve/Stop；Stop 至少持久化 Graph 状态，真实 CLI stop 仅在 active run 映射存在时同步尝试。

## 当前结论

Phase 2 已完成用户可见恢复与最小交互：GraphRunPanel 展示真正可视 DAG，支持打开指定或最近持久化 run，坏 store 以 diagnostics 非阻塞降级；Continue/Resume、Retry、Approve、Stop 只在真实可用时渲染并触发后端状态迁移、刷新面板和保留选中节点；sleeping run 已接 Graph auto wake。仍有限制：无图编辑器、模板库、完整 human gate 表单、复杂级联 retry 或局部返工编辑；真实 CLI 进程 stop 依赖 active run 的 `graphRunId` / `graphNodeId` 映射，缺少映射时只保证 Graph 状态落盘并向用户说明。
