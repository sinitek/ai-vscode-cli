# Harness Framework Simplification 文档迁移

- 日期：2026-08-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-29
- claim_ttl：1d

## 背景与目标

通用 harness 框架简化同时迁移 `.ch` 与 `.agents` 规则、skills、入口和治理模板文档。行为保持重构见 [`2026-08-29-refactor-harness-framework-simplification.md`](2026-08-29-refactor-harness-framework-simplification.md)；原历史验证证据见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)。

## 范围与非目标

- 迁移通用 `.ch/docs` 入口、治理/安全/工具/记忆/执行计划模板，以及 `.agents/profiles`、skills 文档和根级 `AGENTS.md` 内容。
- 保留插件产品规格、设计文档、runbook、ontology事实源和历史完成计划，不改写为目标系统业务材料。
- 不将文档迁移概括为框架实现或测试。

## 验收与验证

- [x] 原计划记载通用文档入口和模板迁移完成，并明确保留插件事实源及历史计划。
- 验证状态：来源未给文档交付单列自动化检查结果；相应脚本、ontology、构建和测试结果保留在关联计划/原始检查记录，不当作文档专属验证。

## 当前结论

已完成（按来源归档记录）。未声称独立文档构建或链接验证。

## 本轮所有权澄清

- 类型：docs
- 保留已拆出的 AGENTS/.ch/.agents 说明与 ontology 文档迁移；本计划独占文档正文，不承接可执行工具结构调整。
- 仅继承原 completed 状态；原测试/文档证据继续有效，本轮未重跑。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
