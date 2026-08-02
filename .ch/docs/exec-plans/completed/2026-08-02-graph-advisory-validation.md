# Graph advisory 验证不中断优化

- 日期：2026-08-02
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-02
- claim_ttl：1d
- handoff_to：

## 背景

最近一次 Graph 运行中，相关 focused 回归已经通过，但 `test-unit-full` 执行 `npm run test:unit` 失败 6 个历史/范围外 subtests 后被当成硬依赖失败，导致整个 Graph 进入 `needs-review`，未继续评审和总结。

## 目标

让完整单测这类全量验证节点可以作为 advisory 证据参与最终总结：相关验证通过时，全量失败不应无条件中断 Graph；若失败明确命中本次改动范围，则仍应通过返工路径或复核暴露风险。

## 范围

- Graph 类型、planner materialize、store normalization、scheduler dependency 判断。
- Graph planner prompt 对完整单测 / 全量验证节点的规划约束。
- Graph failure classifier 对 `dist/test/*.js` 输出到 `src/test/*.ts` 候选修复范围的映射。
- 相关单元测试和 Graph 设计文档。

## 非目标

- 不重写 Graph 调度器整体架构。
- 不修改当前未完成 Graph run 的持久化状态。
- 不处理这次全量单测里暴露的 OpenCode / Loop 断言失败本身。

## 验收标准

- [x] Planner 可声明 advisory 验证节点，materialize/store 能持久化该字段。
- [x] advisory 节点失败后，结构依赖它的 review/summary 仍可继续调度；普通 failed 依赖仍阻断。
- [x] Graph planner prompt 明确要求完整单测默认作为 advisory/evidence，不用硬 `depends_on` 阻断交付收束。
- [x] failure classifier 能把 `dist/test/foo.test.js` 识别为 `src/test/foo.test.ts` 候选范围。
- [x] 相关单测、构建和 Graph 测试通过。

## 影响面

- 代码目录：`src/graph/`
- 文档目录：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/`、`docs/插件功能清单.md`
- 配置与脚本：无

## 风险与缓解

- 风险：advisory 失败被误报为成功完成。
- 缓解：节点状态仍保留 failed，summary prompt 继续要求列出 failed/unresolved；仅结构依赖调度不阻断。
- 风险：真正相关的全量失败被放过。
- 缓解：planner 仍应为相关 focused 测试设置 blocking 验证节点，full/advisory 失败进入 evidence/unresolved。

## 验证计划

- 最小相关验证：`node --test dist/test/graphScheduler.test.js dist/test/graphPlanner.test.js dist/test/graphStore.test.js dist/test/graphFailureClassification.test.js dist/test/graphPromptBuilders.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：`node --test dist/test/graph*.test.js`、`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：更新 `graphScheduler`、`graphPlanner`、`graphStore`、`graphFailureClassification`、`graphPromptBuilders` 测试。
- 单元自测结果：`npm run build` 通过；最小相关 Graph 测试 41/41 通过；`node --test dist/test/graph*.test.js` 112/112 通过；`git diff --check` 通过。
- 失败处理记录：未运行完整 `npm run test:unit`，本次优化目标正是避免全量历史/范围外失败无条件阻断 Graph；后续可由 advisory 节点记录 full suite 结果。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，新增 advisory 验证节点能力行。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/runbooks/PITFALLS.md`、`docs/插件功能清单.md`。

## 任务列表

- [x] 排查中断原因并确定 advisory 验证方案
- [x] 实现 Graph advisory 节点语义与失败范围映射
- [x] 补充单测与设计文档
- [x] 运行构建、相关测试和 diff 校验

## 决策记录

- 2026-08-02：选择新增节点级 `blocking` 布尔语义；`blocking:false` 只影响结构依赖是否阻断，仍保留节点 failed 状态和 summary unresolved 责任。
- 2026-08-02：完整单测、全仓测试、全量 lint 默认应由 planner 规划为 advisory evidence；本次相关 focused 验证继续使用 blocking 依赖或 `if_pass`。

## 当前结论

已完成。Graph planner/store/scheduler 支持 `blocking:false` advisory 验证节点；planner prompt 明确全量验证不应无条件阻断收束；failure classifier 会把 `dist/test/*.test.js` 映射回 `src/test/*.test.ts` 供返工判断。构建、Graph 相关测试和 diff 校验均通过。
