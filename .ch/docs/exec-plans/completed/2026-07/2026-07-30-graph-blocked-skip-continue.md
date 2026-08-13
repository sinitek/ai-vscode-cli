# Graph 阻塞后跳过继续修复

- 日期：2026-07-30
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-30
- claim_ttl：1d
- handoff_to：

## 背景

最近 Codex Graph 运行在最后一个节点 blocked 后，用户在阻塞弹窗里选择“进入/继续下游节点”后没有可见效果。日志显示 run 停在 `needs-review`，阻塞节点为 `review-resume-guidance`，下游 `summarize-resume-guidance` 仍因依赖未通过而保持 `pending`。当前代码的下游分支只打开 GraphRunPanel，不修改 run 或节点状态。

## 目标

让阻塞弹窗的下游操作具备明确、可追踪的“跳过当前阻塞节点并继续下游”行为，避免用户选择后无状态变化。

## 范围

- Graph run 控制链新增跳过 blocked/failed 节点的状态变更。
- Graph scheduler 允许结构依赖在上游 `skipped` 时继续调度，但不把 `skipped` 当成 `if_pass` 或人工批准。
- 阻塞弹窗下游选择改为执行跳过并继续 tick。
- 更新相关单元测试和 Graph 事实来源文档。

## 非目标

- 不实现图编辑器、依赖边手工重写或 rollback 预演。
- 不改变 direct 模式 Retry/Feedback rollback 的既有边界。
- 不把 `skipped` 作为成功完成或通过验收。

## 验收标准

- [x] blocked/failed 节点可被显式跳过并记录事件。
- [x] 依赖 skipped 节点的普通下游节点可以继续运行。
- [x] `if_pass` 和 `human_approved` 不因上游 skipped 而放行。
- [x] 阻塞弹窗下游分支不再只打开面板，而是跳过当前节点并继续运行。
- [x] 相关测试、build 和 diff check 通过或记录明确失败原因。

## 影响面

- 代码目录：`src/graph/`、`src/extension.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`
- 配置与脚本：无预期变更

## 风险与缓解

- 风险：用户误以为跳过等于成功。
- 缓解：节点状态使用 `skipped`，lastError 和事件写明跳过原因，最终总结 prompt 已要求把 skipped 作为 unresolved。
- 风险：条件边被误放行。
- 缓解：只放宽结构依赖，保留 `if_pass` / `human_approved` 的 passed 要求。

## 验证计划

- 最小相关验证：`graphRunControl`、`graphScheduler`、`graphExtensionRuntime`。
- 单元自测命令：`npm run build`；`node --test dist/test/graphRunControl.test.js dist/test/graphScheduler.test.js dist/test/graphExtensionRuntime.test.js`
- 扩展验证：检查最近日志对应 run 的状态链路与修复语义一致。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphRunControl.test.ts`、`src/test/graphScheduler.test.ts`、`src/test/graphExtensionRuntime.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphRunControl.test.js dist/test/graphScheduler.test.js dist/test/graphExtensionRuntime.test.js` 37/37 通过；`node --test dist/test/graph*.test.js` 103/103 通过；`git diff --check` 通过。
- 失败处理记录：首次相关测试仅 `graphExtensionRuntime` 正则断言未匹配跨行函数签名，已收紧断言后重跑通过。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/design-docs/graph-orchestration-mode.md` 和 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 新增跳过当前阻塞节点的控制函数
- [x] 调整调度器结构依赖语义
- [x] 接线阻塞弹窗下游继续行为
- [x] 更新测试和文档
- [x] 执行相关验证并归档计划

## 决策记录

- 2026-07-30：采用 `skipped` 表达“人工跳过继续”，不把阻塞节点伪装为 `passed`。

## 当前结论

已完成。根因是下游选择分支只打开节点详情，没有任何 run mutation；同时下游节点依赖 blocked 节点，继续调度必然无可执行节点。修复后下游继续会显式把当前 blocked/failed 节点写成 `skipped`、记录 `node.skipped` 事件并继续 tick；普通结构依赖允许 `skipped` 继续，但 `if_pass` 和 `human_approved` 仍只接受 `passed`。
