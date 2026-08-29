# 文档系统总览

这个目录是仓库内的知识系统。它的目标是让接手者先读少量入口，再按任务需要展开细节。

## 快速入口

core harness 默认入口只包含：

- 根级规则 / `AGENTS.md`：任务级约束、授权范围和协作规则。
- `.ch/docs/TESTING.md`：测试与单元自测的唯一规则源。
- `.ch/docs/TOOL_POLICY.md`：工具风险分级与使用边界。
- `.ch/docs/ontology/README.md`：AI 开发业务本体、任务前查询和任务后维护入口。
- `.ch/docs/product-specs/`：业务规格、功能清单和验收事实源；功能清单入口为 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- `.ch/docs/MEMORY.md` 和 `.ch/docs/memory/`：记忆分层规则与默认优先召回的热区记忆面。
- `.ch/docs/exec-plans/README.md`：执行计划目录、模板和收尾规则。
- 必要 skills：默认 core 只包含 `chromium-playwright-smoke`、`codegraph`、`execution-plan`、`memory-consolidator`、`memory-indexer`、`memory-recall`、`ontology`、`repo-indexer`；按对应 skill 自身说明执行。

其它目录按任务需要启用，或作为事实来源保留；不要把它们提升为默认必读入口。

## 按需导航

- 设计文档入口：`.ch/docs/design-docs/index.md`；新设计从 `.ch/docs/design-docs/TEMPLATE.md` 开始，核心信念见 `.ch/docs/design-docs/core-beliefs.md`。
- 功能清单入口：`.ch/docs/product-specs/FEATURE_INVENTORY.md` 是唯一事实源；单项规格放在 `.ch/docs/product-specs/`，任务收尾是否更新清单见 `.ch/docs/exec-plans/README.md`。
- 执行计划入口：`.ch/docs/exec-plans/README.md`；模板在 `.ch/docs/exec-plans/TEMPLATE.md`，活动计划在 `.ch/docs/exec-plans/active/`，完成归档在 `.ch/docs/exec-plans/completed/YYYY-MM/`，小型后续项在 `.ch/docs/exec-plans/tech-debt-tracker.md`。
- ToB / 前端体验入口：`.ch/docs/FRONTEND.md`；用户可见能力、状态和验收登记到 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，复杂体验取舍进入 `.ch/docs/design-docs/`。
- 安全可靠性入口：`.ch/docs/SECURITY.md`、`.ch/docs/TESTING.md`、`.ch/docs/exec-plans/README.md` 和 `.ch/docs/runbooks/README.md` 分别承接安全基线、验证规则、计划验证记录、运行发布排障沉淀。
- 运行与排障：`.ch/docs/runbooks/README.md` 用于运行、发布、排障和避坑。

## 目录结构

- `.ch/docs/design-docs/`：设计历史、核心信念、设计模板。
- `.ch/docs/exec-plans/`：活动中的执行计划、已完成归档、技术债跟踪。
- `.ch/docs/generated/`：工具生成产物的占位入口，生成规则以对应 skill 为准。
- `.ch/docs/memory/`：默认优先召回的热区记忆面，放 L1 滚动摘要、L2 事件记忆、L3 画像和 L4 经验入口。
- `.ch/docs/ontology/`：人工维护的业务概念、关系、规则和跨域场景，供 AI 开发任务按需检索。
- `.ch/docs/product-specs/`：业务规格、用例、范围和验收文档。
- `.ch/docs/references/`：官方规范对齐、外部参考、AI 友好参考资料。
- `.ch/docs/runbooks/`：运行、发布、排障、值班和环境操作手册。

## 维护原则

- 文档是系统的一部分，不是任务结束后的附属品。
- 一旦发现真实踩坑，要及时沉淀为避坑指南，而不是留在聊天记录里。
- 索引优先于大段正文。
- 热区记忆只保留最该先读的信息，长过程和长历史仍应回到原始文档。
- ontology 只做业务语义压缩和事实来源导航，不替代产品规格、架构、SQL、代码或 CodeGraph。
- 长期记忆文档应带统一 front matter，便于 freshness、superseded 和 source-of-truth 治理。
- 每个目录至少保留一个清晰入口页。
- 测试规则以 `TESTING.md` 为准；工具风险以 `TOOL_POLICY.md` 为准；执行计划以 `exec-plans/README.md` 为准；功能清单以 `product-specs/FEATURE_INVENTORY.md` 为准。
- 新增主题前，优先判断是否应该放入已有主题目录，而不是横向再造新目录。

## 轻量使用方式

小型项目或一次性任务不需要把所有机制都打开。默认只维护：

- 根级 `AGENTS.md`
- `.ch/docs/TESTING.md`
- `.ch/docs/ontology/README.md`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- `.ch/docs/MEMORY.md`
- `.ch/docs/memory/` 中确实有长期价值的条目
- `.ch/docs/exec-plans/README.md`
- 默认 core skills 中与当前任务直接相关的少数入口

只有当任务跨阶段、跨模块或存在明显风险时，再创建 `exec-plans/active/` 或 generated index。治理报表、跨仓导入/导出、评测、工作台 UI、协作看板等能力已移出 core skeleton，不再随 harness 提供。复杂度应该跟随真实协作成本增长，而不是跟随目录数量增长。
