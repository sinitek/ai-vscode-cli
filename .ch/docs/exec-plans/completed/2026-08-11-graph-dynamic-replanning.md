# Graph 动态扩图续跑

- 日期：2026-08-11
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-11
- claim_ttl：本轮任务
- handoff_to：无

## 背景

Graph run 在审核失败或无可运行节点时，当前运行时容易停在 needs-review / error，用户期望主模型不要新建整轮任务，而是在当前图谱里追加更多节点继续执行。

## 目标

支持 Graph run 在直接返工不可用且执行卡住时，自动追加主模型 `replan-*` 节点，由该节点输出 plannedGraph 增量并物化到当前 run，继续执行到新的 summary。

## 范围

- 扩展 Graph planner，使 plannedGraph 可增量追加到已有图。
- 扩展 Graph runtime，在失败/卡住时追加当前图内 replanning 节点。
- 更新 Graph prompt，让主模型明确输出当前图的新增节点。
- 补充相关单元测试与产品文档。

## 非目标

- 不改变已有调度器对 depends_on / if_pass / if_fail 的语义。
- 不恢复 worktree 隔离或改变直接模式执行目录。
- 不让普通节点自行创建子任务或绕过 Graph store。

## 验收标准

- [x] 审核失败且直接返工不可用时，当前 run 会追加 `replan-*` 节点继续。
- [x] replanning 节点的 plannedGraph 只新增节点，不覆盖已有节点。
- [x] 新增节点能物化进当前 run，并由新的 summary 收束。
- [x] build 与相关 Graph 测试通过。

## 影响面

- 代码目录：`src/graph/`、`src/extensionHost/`
- 文档目录：`.ch/docs/product-specs/`、`docs/`
- 配置与脚本：无

## 风险与缓解

- 风险：动态扩图重复触发导致无限 replanning。
- 缓解：限制最多追加 replanning 节点数，并且 replanning 节点自身失败不再自动扩图。

## 验证计划

- 最小相关验证：`node --test dist/test/graphPlanner.test.js dist/test/graphPromptBuilders.test.js dist/test/graphExtensionRuntime.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：`npm run validate:whitespace -- <modified files>`、`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：已补充 `graphPlanner` append materialize 回归、`graphPromptBuilders` replanner prompt 回归，并更新 `graphExtensionRuntime` source contract / 模型路由断言。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphPlanner.test.js dist/test/graphPromptBuilders.test.js dist/test/graphExtensionRuntime.test.js` 23/23 通过；`npm run validate:whitespace -- <modified files>` 通过；`git diff --check` 通过。
- 失败处理记录：无
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`

## 任务列表

- [x] 定位失败后不返工的当前路径
- [x] 实现当前图增量 replanning
- [x] 补充回归测试
- [x] 同步产品文档并验证

## 决策记录

- 2026-08-11：按用户偏好选择“当前图追加节点继续执行”，不默认新建 Graph run。

## 当前结论

已实现当前 Graph run 内动态扩图续跑：运行时优先沿用 `direct_rework`，不可用或图无进展时追加最多 3 个 `replan-*` 主模型规划节点；replanner 输出的 `plannedGraph` 以 append 模式物化，只新增节点/边，不覆盖旧节点，也不让新增边指向已有节点。旧 failed/blocked 节点作为触发证据保留，新增根节点自动依赖当前 replanner，并由新的续跑 summary 收束。
