# Loop+ 验收原因气泡 — 新功能开发

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-31-loopplus-acceptance-reasons.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-31-docs-loopplus-acceptance-reasons.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

为 Loop+ 各验收结果新增简短证据型原因。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-31-feature-loopplus-acceptance-reasons.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- Loop+ 群聊现有验收反馈主要展示通过/未通过，无法快速看出默认验收、事件验收和附加方案验收的依据。

## 目标

- 让主模型为每个验收结论提供不超过 50 字的证据型原因，并在 Loop+ 群聊结果气泡中逐项展示。

- 原因语言根据任务、证据和对话上下文选择，不强制使用中文；界面固定标签仍沿用中文。

## 范围

- 扩展 Loop+ accept / completed 结果解析，支持事件原因、默认验收原因和附加验收原因。

- 在现有验收结果追加入口统一生成简短反馈，保留模型按上下文选择的原因语言。

## 非目标

- 不改变 Loop+ 调度、验收上限、重试或子任务派发语义。

- 不要求主模型额外运行测试或产物；只要求原因引用已有证据或明确限制。

- 不改经典 Loop 或普通 Vibe 的验收展示。

## 验收标准

- [x] 每个事件结论、默认验收检查和附加验收结果都有不超过 50 字原因。

- [x] 缺失或超长原因不会被严格的 Loop+ 运行时验收解析落地。

- [x] 群聊结果气泡逐项展示通过/未通过及原因。

- [x] 兼容现有解析单测与验收方案旧 API，并避免伪造兜底原因。

## 影响面

- 代码目录：`src/loopPlusDecision.ts`、`src/loopPlusAcceptancePlan.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/extensionHost/loopPlusDecisionStrategies.ts`、`src/loopPlusScheduler.ts`

- 配置与脚本：无

## 风险与缓解

- 风险：旧主模型输出没有原因，严格解析会重新提问。

- 缓解：提示词提供明确 JSON 字段、50 字限制和可复制示例；旧单测夹具补齐原因。

- 风险：仓库存在并发改动导致全量构建受阻。

- 缓解：不覆盖无关文件，单独完成本次相关模块构建和测试，并记录阻塞文件。

## 验证计划

- 最小相关验证：`npm run build`；Loop+ 决策、验收方案、提示词和编排测试。

- 单元自测命令：`node --test dist/test/loop/loopPlusDecision.test.js dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js`

- 扩展验证：本轮不需要 Chromium，未修改独立 Webview 交互布局，仅改变宿主生成的 Markdown 气泡内容。

## 测试与清单同步

- 默认/事件/附加验收气泡逐项原因。

- 单元自测结果：混合工作区 `npm run build` 通过，Loop+ 核心回归 196 项及群聊原因渲染定向测试 1 项通过。随后把 `HEAD` 与本任务暂存补丁导出到独立临时目录，构建、含完整群聊面板的 209 项定向回归均通过；再枚举 `dist/test/**/loopPlus*.test.js` 的 18 个测试文件，全部 284 项通过。独立快照的 ontology 校验及 9 项 Python 单测也通过。

- 失败处理记录：混合工作区曾因并行变更出现群聊断言和 ontology 来源引用失败；未覆盖或回滚范围外改动。独立的本任务快照通过完整群聊面板及 ontology 验证，确认本任务不依赖这些并发改动。

## 任务列表

- [completed] 定位 Loop+ 验收结果追加入口

- [completed] 增加事件、默认和附加验收原因契约

- [completed] 追加群聊简短原因气泡

- [completed] 运行全量构建并完成 Loop+ 相关回归

## 决策记录

- 2026-10-31：原因使用 `reason` / 默认检查 `detail` 字段，按 Unicode 字符数限制 50 字；宿主只接受严格短原因，避免气泡生成兜底空话。

- 2026-10-31：按用户补充要求取消原因的强制中文规则，提交仅包含本任务差异，不包含并发功能改动。

## 当前结论

- 功能实现、构建和 Loop+ 相关回归已完成，独立任务快照的 284 项 Loop+ 测试、ontology 校验及 9 项 Python 单测全部通过。提交范围仅包含本任务代码、测试和配套文档；共享文件只暂存验收原因相关片段，保留其它并发工作区改动。
