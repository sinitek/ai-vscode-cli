# Graph 节点全图感知与边界优化

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-24T00:00:00+08:00
- claim_ttl：1d
- handoff_to：无

## 背景

Graph 模式应以已规划的 Realized Graph、显式节点/边和宿主调度器为核心，而不是退化成 Loop 模式里的主从智能体。当前 Graph 已支持 AI 规划 DAG、调度、并发、冲突组、人工关卡、重试、睡眠和完成证据的基础链路，但节点 prompt 仍缺少完整拓扑、当前位置、上下游职责和未来节点边界，容易导致执行节点不知道后续测试/评审已在图中，从而重复执行或扩大职责。

## 目标

让每个 Graph 节点在执行时明确知道整个图、当前节点位置、直接上下游、并发/冲突约束、未来测试/评审/总结职责，并在设计文档中澄清 Graph 相比 Loop 主从智能体的本质区别和剩余缺口。

## 范围

- 更新 Graph 节点 prompt builder，注入全图拓扑、当前位置、边、上下游职责和节点边界规则。
- 更新 Graph prompt 单元测试，覆盖中文标题、全图感知、未来测试节点不被实现节点替代等场景。
- 更新 Graph 设计文档和产品规格，明确已完成/未完成语义矩阵。

## 非目标

- 不重写 Graph scheduler、kernel 或 runtime。
- 不新增图编辑器、运行前人工确认、复杂条件表达式求值或 descendant reset。
- 不把 Graph 描述为 Loop 主从智能体的换壳实现。

## 验收标准

- [x] 每个节点 prompt 都包含完整节点清单、边清单、当前位置、直接依赖、直接解锁、并发/冲突提示和未来节点职责。
- [x] implement 节点如果存在后续 test/review/summary 节点，会明确只做本节点必要验证，不替代下游节点。
- [x] 设计文档清楚区分 Graph 和 Loop 主从智能体，并列出节点、边、条件、依赖、并发、冲突组、人工关卡、重试、睡眠、完成证据的完成状态。
- [x] 相关测试、构建和差异检查通过或记录可解释失败。

## 影响面

- 代码目录：`src/graph/graphPromptBuilders.ts`
- 测试目录：`src/test/graphPromptBuilders.test.ts`
- 文档目录：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/*`
- 配置与脚本：无

## 风险与缓解

- 风险：prompt 过长导致节点上下文噪音增加。
- 缓解：拓扑以紧凑中文行展示，保留关键字段，不展开 artifacts 内容。
- 风险：职责边界过窄导致实现节点不做最低必要验证。
- 缓解：明确“不能替代下游节点，但仍需完成本节点 acceptance 和最小必要自检”。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：`node --test dist/test/graphPromptBuilders.test.js dist/test/graphPlanner.test.js dist/test/graphScheduler.test.js dist/test/graphKernel.test.js`
- 扩展验证：`node --test dist/test/graph*.test.js`、`git diff --check`、`codegraph sync`

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphPromptBuilders.test.ts`，覆盖节点全图拓扑、当前位置、同批节点、条件边和后续 test/review/summary 边界。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphPromptBuilders.test.js dist/test/graphPlanner.test.js dist/test/graphScheduler.test.js dist/test/graphKernel.test.js` 22/22；`node --test dist/test/graph*.test.js` 66/66；`node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js` 96/96；`node --test` 727/727；`git diff --check` 通过；`codegraph sync` 通过。
- 失败处理记录：无
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 对齐 Graph 原理文档和现有 prompt/scheduler 实现。
- [x] 增强节点 prompt 的全图拓扑、当前位置和职责边界。
- [x] 补充 Graph prompt 单元测试。
- [x] 同步设计文档与产品规格缺口矩阵。
- [x] 执行构建、相关测试和差异检查。
- [x] 归档执行计划并总结结果。

## 决策记录

- 2026-07-24：Graph 模式应表达“规划好的可执行图 + 宿主确定性调度 + 有边界的节点执行上下文”，不是 Loop 主从智能体的运行时换名。

## 当前结论

已完成。Graph 节点 prompt 现在携带全图拓扑、当前位置、上下游链路、并发/冲突线索和后续节点职责边界；设计文档已明确 Graph 是 realized graph + scheduler + bounded node executor，不是 Loop 主从智能体换壳，并列出核心 Graph 语义完成度与缺口。本轮未扩大 scheduler/runtime 范围。
