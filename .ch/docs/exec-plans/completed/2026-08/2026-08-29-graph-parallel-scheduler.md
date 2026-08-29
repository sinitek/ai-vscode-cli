# Graph 并行调度语义修复

- 日期：2026-08-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-29
- claim_ttl：本轮完成

## 背景

Graph 模式中 AI planner 已规划 4 个并行 `review` 节点，但运行时实际没有并行执行。排查确认旧 scheduler 会把没有 `writeFiles` / `conflictGroup` 的写入类节点视为隐式全局写锁，导致多个评审节点被串行化。

## 目标

让已 ready 且没有显式冲突的 Graph 节点按 `maxConcurrent` 并行派发；只有显式 `conflictGroup` 或重叠 `writeFiles` 才阻止同批执行，并修复成功推进 tick 后误追加 `replan-*` 的问题。

## 范围

- Graph scheduler 冲突判定。
- Graph runtime 动态 replan 触发条件。
- 相关单元测试与产品/设计文档口径。

## 非目标

- 不引入新的资源预算、优先级队列或全局并发面板。
- 不改变 Graph planner schema 或节点类型体系。
- 不改变 direct run 的工作区执行方式。

## 验收标准

- [x] 4 个无显式冲突的 `review` 节点可在同批 batch 中被选中。
- [x] `conflictGroup` 相同或 `writeFiles` 重叠的节点仍会串行。
- [x] 成功推进的普通 tick 不会追加 `replan-*`。
- [x] 相关 Graph 单测与 `npm run build` 通过。
- [x] 设计文档和功能清单不再保留旧的未声明写入范围隐式串行口径。

## 影响面

- 代码目录：`src/graph/`、`src/extensionHost/`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`docs/`
- 配置与脚本：无

## 风险与缓解

- 风险：未声明 `writeFiles` 的真实写入节点可能并行写同一文件。
- 缓解：节点 prompt 和文档继续要求会改文件的节点声明 `writeFiles` 或 `conflictGroup`；scheduler 只尊重显式冲突，避免把“未声明”误当作全局锁。

## 验证计划

- 最小相关验证：`graphScheduler`、`graphPlanner`、`graphExtensionRuntime` 单测。
- 单元自测命令：`node --test dist/test/graphScheduler.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphPlanner.test.js`
- 扩展验证：`node --test dist/test/graphKernel.test.js dist/test/graphRunControl.test.js`、补充 Graph 测试、`npm run build`、`npm run validate:whitespace -- <本次相关文件>`、`git diff --check`、旧串行口径 `rg` 扫描。

## 测试与清单同步

- 单元测试新增/更新：新增无 scope 并行 review batch 回归测试、成功 tick 不追加 replan 回归测试，更新 maxConcurrent 推断断言。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphScheduler.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphPlanner.test.js dist/test/graphKernel.test.js dist/test/graphRunControl.test.js` 通过，48/48；`node --test dist/test/graphPromptBuilders.test.js dist/test/graphFailureClassification.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphStore.test.js dist/test/graphNodeArtifact.test.js` 通过，37/37；`npm run validate:whitespace -- <本次相关文件>` 通过；`git diff --check` 通过；当前 Graph 设计文档、产品规格、功能清单和相关代码中的旧 `unscopedWrite` / 未声明写入范围保守串行口径扫描无残留；历史已归档计划和本次 PITFALLS 根因记录保留旧术语用于追溯。
- 失败处理记录：无新增失败；旧 `graphPlanner` 断言已按新显式冲突语义更新。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与 `docs/插件功能清单.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/runbooks/PITFALLS.md`。

## 任务列表

- [x] 排查 Graph 4 个评审节点未并行的根因。
- [x] 修复 scheduler 隐式 unscoped write 串行化。
- [x] 修复成功推进 tick 后误触发动态 replan。
- [x] 补充相关 Graph 单测。
- [x] 同步产品和设计文档。
- [x] 完成验证并归档执行计划。

## 决策记录

- 2026-08-29：Graph ready 节点并发以显式冲突为准；未声明 `writeFiles` 不再由 scheduler 当作全局写锁，但 prompt/文档仍要求真实写入节点声明 scope。
- 2026-08-29：动态 replan 只在失败/阻塞触发节点或真正 idle/no-progress 时尝试；普通成功推进 tick 不追加 `replan-*`。

## 当前结论

已完成 scheduler/runtime 优化、回归测试、产品/设计文档同步、PITFALLS 记录和执行计划归档。旧的未声明 scope 隐式串行口径已替换为显式冲突语义：只有 `conflictGroup` 或重叠 `writeFiles` 会阻止同批并行。
