# Graph 规划并行化强化

- 日期：2026-08-02
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-02
- claim_ttl：本轮任务
- handoff_to：无

## 背景

用户要求 Graph 模式的规划尽量并行以提高执行效率，尤其是多个可拆分且不会冲突的任务。当前 scheduler 已按 `maxConcurrent`、`writeFiles` 和 `conflictGroup` 过滤冲突，但 planner prompt 和 planner 漏填 `maxConcurrent` 时的物化默认仍可能让执行图偏串行。

## 目标

强化 Graph planner 输出策略：优先生成 fan-out/fan-in 的并行 DAG，明确不串联独立任务，并在 planner 未显式设置 `maxConcurrent` 时按无冲突可并行节点推断合理并发上限。

## 范围

- Graph planner prompt 的并行规划规则与示例。
- Graph plan materialization 的默认并发上限推断。
- Graph planner / prompt builder 相关单元测试。
- 用户可见能力文档同步。

## 非目标

- 不绕过 scheduler 的 `writeFiles` / `conflictGroup` 冲突保护。
- 不改变 Graph 节点真实执行器或 CLI 运行方式。
- 不提高全局最大并发上限超过现有 `GRAPH_DEFAULT_MAX_CONCURRENT_NODES`。

## 验收标准

- [x] planner prompt 明确要求独立可拆任务并行化，禁止无必要串行依赖。
- [x] planner 漏填 `maxConcurrent` 时，materialize 后能按同一批无冲突根节点推断大于 1 的并发上限。
- [x] 冲突组、重叠 writeFiles 和未声明写范围的写节点不会被推断为可并发。
- [x] 相关单元测试覆盖并通过。
- [x] 文档同步说明 Graph 规划会积极并行但仍受冲突保护约束。

## 影响面

- 代码目录：`src/graph/`
- 测试目录：`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`docs/`
- 配置与脚本：不涉及依赖或脚本变更。

## 风险与缓解

- 风险：过度并行可能让存在隐性共享状态的节点同时执行。
- 缓解：推断并发只统计 scheduler 已使用的冲突规则；未声明写范围的写节点保守视为互斥；prompt 要求不确定路径时使用 `["**"]` 与保守 `conflictGroup`。
- 风险：并发默认从 1 提高后暴露 planner 输出的错误依赖。
- 缓解：只对无依赖根节点和无冲突候选推断，显式 `maxConcurrent` 仍尊重 planner 输出并受最大值限制。

## 验证计划

- 最小相关验证：`node --test dist/test/graphPlanner.test.js dist/test/graphPromptBuilders.test.js dist/test/graphScheduler.test.js`
- 单元自测命令：`npm run build` 后运行上述最小相关测试。
- 扩展验证：`git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：新增 `graphPlanner.test` 覆盖 planner 漏填 `maxConcurrent` 时的无冲突根节点并发推断，以及冲突根节点保守串行；更新 `graphPromptBuilders.test` 覆盖 planner 并行优先提示。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphPlanner.test.js dist/test/graphPromptBuilders.test.js dist/test/graphScheduler.test.js` 通过 22/22。
- 失败处理记录：无失败。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`。

## 任务列表

- [x] 定位 Graph planner / scheduler 并发逻辑。
- [x] 修改 planner prompt 和 maxConcurrent 推断。
- [x] 增加或更新相关单元测试。
- [x] 执行构建、测试和空白检查。
- [x] 同步功能清单与设计文档并归档计划。

## 决策记录

- 2026-08-02：保留 scheduler 的现有冲突兜底，不把并行优化做成绕过 `writeFiles` / `conflictGroup` 的调度改动。
- 2026-08-02：planner 明确输出 `plannedGraph.maxConcurrent` 时继续尊重并裁剪到既有上限；漏填时只按 materialized graph 的首批无冲突根节点推断，避免从初始 planning-only run 的 `maxConcurrent=1` 继承成串行。

## 当前结论

已完成 planner 侧提示和物化默认并发推断：AI 自主设计 Graph 时会被要求优先 fan-out/fan-in 并行化独立分支；materialize 会在 planner 漏填 `maxConcurrent` 时从首批无冲突根节点推断默认并发，同时继续使用 scheduler 的 `writeFiles`、`conflictGroup` 和未声明写范围保护。
