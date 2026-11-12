# 同步FEATURE_INVENTORY、配置能力规格和cli_example_import_inputs规则

- 日期：2026-11-03
- 状态：completed
- 负责人：Codex
- 类型：docs

## 关联计划

- 共同背景与依赖（feature）：[`2026-11-03-feature-new-config-import-dialog.md`](2026-11-03-feature-new-config-import-dialog.md)。 实现、回归与事实文档分别验收，不复制混合范围。
- 共同背景与依赖（测试证据）：[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-new-config-import-dialog.md`）。

## 目标与范围

同步FEATURE_INVENTORY、配置能力规格和cli_example_import_inputs规则，区分新增直接保存与范例抽屉只改草稿。

本计划仅承接实际文档与事实说明维护，不承接关联计划中的运行时实现或其它类型交付。

## 验收标准

- 对应文档准确说明已交付行为、限制和来源，不把尚未验证环境表述为通过。
- 记录本范围真实结果并保留原失败、风险、负责人和日期；原状态为 completed，不是本轮新执行业务验证。

## 验证计划

按原计划对应的文档对照、ontology/结构检查记录历史结果；本轮只核对计划迁移、链接与证据分配，不运行历史命令。

## 真实结果与边界

原记录确认本范围交付完成；本轮仅对照原计划正文迁移，原始证据分配见下文及关联计划。

## 当前结论

状态 `completed` 继承历史记录；本轮迁移不认证新的业务行为、真实服务或Extension Host。

## 原始文档交付证据（历史）

- 功能清单及相关文档：已同步 `FEATURE_INVENTORY.md`、`sinitek-cli-plugin-capabilities.md` 和 `plugin.rule.cli_example_import_inputs`，明确区分新增直接保存与范例抽屉只更新草稿。
