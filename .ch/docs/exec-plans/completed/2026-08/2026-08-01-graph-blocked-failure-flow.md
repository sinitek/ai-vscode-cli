# Graph blocked 失败流程改造

- 日期：2026-08-01
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-01
- claim_ttl：本轮任务
- handoff_to：无

## 背景

Graph 模式运行时当前存在人工关卡等待与 blocked 节点提示路径。用户明确要求 graph 运行时去除人工交互方式；节点 blocked 应视为失败并走失败流程，只有最终 summary/完结阶段才需要主模型介入调度。

## 目标

- 去除 graph 运行时的人工等待调度路径。
- 将节点执行返回 blocked 统一归入失败处理，而不是形成需要人工介入的阻塞状态。
- 保持最终 `summary` 节点使用主模型，其它普通执行节点继续使用子模型。

## 范围

- `src/graph/*` 中 scheduler/kernel/lifecycle/prompt 行为。
- `src/extension.ts` 中 graph tick、blocked prompt、运行时调度和面板控制注册相关逻辑。
- `src/panelStateBuilder.ts`、`src/panelDiagnostics.ts`、`src/webview/graphRunPanel*.ts` 中 GraphRunPanel 控制状态、消息和渲染入口。
- 相关 graph 单元测试与功能文档。

## 非目标

- 不重做 Graph DAG 规划器整体架构。
- 不改 Loop 模式的 blocked 语义。
- 不替换现有 CLI 或模型选择技术栈。

## 验收标准

- [x] Graph ready batch 不再产生需要人工确认的 pending action。
- [x] Graph 节点返回 blocked 时按 failed 流程记录和继续调度 if_fail 路径。
- [x] Graph 普通运行不再弹出 blocked 人工提示。
- [x] GraphRunPanel 不再渲染或发送 human gate 审批控制。
- [x] Graph summary/最终完结节点仍使用主模型路由。
- [x] 相关单元测试与 TypeScript build 通过。

## 影响面

- 代码目录：`src/graph/`、`src/extension.ts`、`src/panelDiagnostics.ts`、`src/panelStateBuilder.ts`、`src/webview/graphRunPanel*.ts`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`.ch/docs/references/`
- 配置与脚本：无预期变更

## 风险与缓解

- 风险：已有 UI 或控制逻辑仍假设 `human_gate.waiting` 与 `node.blocked`。
- 缓解：优先改运行时核心路径，保留历史数据展示兼容，测试覆盖新旧行为边界。

## 验证计划

- 最小相关验证：graph scheduler/kernel/lifecycle/prompt 相关单测。
- 单元自测命令：`npm run build`；`node --test dist/test/graph*.test.js`
- 扩展验证：已覆盖 scheduler/kernel/lifecycle/planner/prompt/extension runtime/GraphRunPanel/Graph run control 历史兼容测试。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphKernel.test.ts`、`src/test/graphScheduler.test.ts`、`src/test/graphNodeLifecycle.test.ts`、`src/test/graphPlanner.test.ts`、`src/test/graphPromptBuilders.test.ts`、`src/test/graphExtensionRuntime.test.ts`、`src/test/graphRunPanel.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graph*.test.js` 通过，103/103。
- 失败处理记录：无。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `docs/插件功能清单.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`。

## 任务列表

- [x] 定位 graph runtime 中 human gate、blocked prompt、failure route 入口。
- [x] 修改 blocked 语义为失败流程，去除人工等待运行时分支。
- [x] 移除 GraphRunPanel human gate 审批控制入口。
- [x] 更新单元测试和文档说明。
- [x] 执行相关 build/test 并记录结果。

## 决策记录

- 2026-08-01：按用户确认，Graph 节点 blocked 视为失败流程；只有最终 summary/完结节点需要主模型介入调度。

## 当前结论

已完成实现：Graph scheduler/kernel 不再产生 human gate pending action；节点执行结果 `blocked` 归一为 failed 生命周期；planner/prompt 禁止新图生成 `human_gate`、`human_approved` 或 `manual`；扩展层不再弹 blocked modal 或注册 human gate 面板审批；GraphRunPanel 对历史 `human_gate` 仅展示节点详情，不渲染审批 CTA，也不发送 `graphRun:approveHumanGate` 消息。最终 `summary` 节点仍使用主模型路由，普通执行节点继续使用子模型。
