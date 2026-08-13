# Graph AI 规划 DAG 优化

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-24T16:45:00+08:00
- claim_ttl：本轮 Graph AI 规划 DAG 优化完成前
- handoff_to：后续 Graph 模板/图编辑器阶段

## 背景

当前 Graph runtime 启动后直接创建固定 `plan -> implement -> test -> review -> summary` 串行图。用户指出这不符合 Graph 模式语义：复杂需求应先由 AI 规划真实 DAG，再由宿主按节点、边、并发与关卡执行，而不是每次都显示固定线形图。

## 目标

让 Graph 模式先执行一个 AI planner 节点，要求 planner 在 artifact 中产出可校验的 Graph DAG 规范；宿主解析、校验并把后续执行节点替换为 AI 规划出的多节点/多边图。

## 范围

- 增加 Graph planner 输出规范解析、校验和 realized graph 注入。
- 更新 Graph planner prompt，明确复杂任务需要拆成分支、并发、测试、评审、人工关卡或 sleep 节点。
- 调整 extension Graph 启动链路，先创建 planning-only 图，planner 通过后再展开 AI DAG。
- 补充单元测试覆盖解析、prompt、runtime 接线和失败保护。
- 同步 Graph 设计文档与功能清单。

## 非目标

- 不做拖拽图编辑器。
- 不做运行前人工调整/确认 UI。
- 不引入新的 workflow 框架或模型 SDK。
- 不实现复杂条件边运行时表达式求值；仍以当前 scheduler 的 active dependsOn/human_gate/sleep/冲突语义为边界。

## 验收标准

- [x] Graph run 初始不再直接创建固定五节点执行图，而是先创建 planning-only 图。
- [x] planner 节点可在 `## JSON` 中返回 `plannedGraph.nodes` / `plannedGraph.edges`，宿主校验后替换为真实 DAG。
- [x] 规划图允许多个 implement/test/review/debate/human_gate/sleep/merge/summary 节点和非线性依赖，并自动补齐 summary 节点。
- [x] 规划图解析失败或 schema 不合法时，run 停在 `needs-review`，不继续执行 fallback 线形图。
- [x] 相关 build 和 Graph 单测通过。

## 影响面

- 代码目录：`src/graph/`、`src/extension.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`docs/`
- 配置与脚本：无新增依赖

## 风险与缓解

- 风险：AI 输出不稳定导致 Graph 无法展开。
- 缓解：限定 JSON schema、严格校验、失败停在 `needs-review`，不伪装执行成功。
- 风险：规划图越权或缺少 summary。
- 缓解：默认写入节点未声明 `writeFiles` 时不得写；宿主自动补 summary，并重建 dependsOn/unlocks 一致性。

## 验证计划

- 最小相关验证：Graph parser/prompt/runtime 静态接线测试。
- 单元自测命令：`npm run build`；`node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`
- 扩展验证：必要时扩大到全量 `node --test`。

## 测试与清单同步

- 单元测试新增/更新：新增 `graphPlanner.test.ts`，更新 `graphNodeArtifact.test.ts`、`graphPromptBuilders.test.ts`、`graphExtensionRuntime.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js` 95/95 通过；`node --test` 726/726 通过；`git diff --check` 通过。
- 失败处理记录：无失败；因同 tab `runPrompt` 并发会 stop 已有运行，本轮保留 executor cap=1，只 materialize 复杂 DAG 结构。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`。

## 任务列表

- [x] 确认当前实现是固定五节点串行图，且没有 AI DAG 规划注入。
- [x] 增加 planner artifact 中 `plannedGraph` 解析与 GraphRunRecord 生成逻辑。
- [x] 更新 planner prompt 和 Graph 启动 runtime。
- [x] 更新测试、设计文档和功能清单。
- [x] 运行 build/相关单测并记录结果。

## 决策记录

- 2026-07-24：本轮不增加图编辑器或人工确认 UI；先实现“AI planner 产出 DAG，宿主校验后执行”的最小正确语义。

## 当前结论

已完成：Graph 现在先创建 planning-only run，执行保留 `plan` AI planner 节点；planner artifact 中的 `plannedGraph` 通过宿主 schema 校验后 materialize 为真实 DAG，支持分支、fan-out/fan-in、测试、评审、human_gate、sleep、merge 和 summary。规划缺失或非法时 run 进入 `needs-review`，不会继续跑固定线形 fallback。当前同 tab executor 仍保守串行派发，避免 `runPrompt` 并发互相 stop；真实并发节点 runner 留给后续阶段。
