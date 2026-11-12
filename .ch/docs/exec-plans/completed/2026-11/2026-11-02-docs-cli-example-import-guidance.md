# CLI 范例导入规则与维护说明

- 日期：2026-11-02
- 状态：completed
- 类型：docs
- 负责人：Codex

## 关联计划

- 功能交付与共同背景见 [`2026-11-02-feature-cli-example-import-dialog.md`](2026-11-02-feature-cli-example-import-dialog.md)。本计划只承接用户可见能力清单、配置规则和维护踩坑文档。
- 测试开发及测试结果见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`）。

## 目标与范围

维护范例导入行为对应的 `FEATURE_INVENTORY.md` 和 ontology 规则 `plugin.rule.cli_example_import_inputs`；在后续统一按钮样式追加中，将 Portal 主题作用域复用经验写入 `runbooks/PITFALLS.md`。不承接功能代码或测试开发。

## 验收标准

- 文档如实描述已交付的导入交互、配置约束和可复用的 Portal 主题作用域经验。
- 与功能计划互链；原独立测试计划已移除，其开发职责和历史验证通过[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)追溯，`source_old_path` 为 `.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`。不将测试开发、测试执行结果或 UI 实现细节混作文档范围。

## 验证与真实结果

- 原计划记录功能清单和 `plugin.rule.cli_example_import_inputs` 已同步；按钮样式追加阶段同步 `FEATURE_INVENTORY.md` 并将 Portal 主题作用域经验写入 `runbooks/PITFALLS.md`。
- 该追加明确无需 ontology 变更；历史 ontology 检查结果在关联记录中，不由本次迁移重跑。
- 本次迁移没有重新检查这些本轮写域以外的事实文档的差异，也未重跑历史验证。

## 当前结论

历史文档同步已完成，状态 `completed`；功能及测试交付分别见关联计划。

## 验证计划

本轮仅核对本记录与关联来源的历史证据、职责分配及具体链接；原业务命令与执行结果以本记录和关联计划的历史记录为准，不重跑测试、构建、浏览器或真实CLI。

## 追加范围原始证据（历史）

- 同步功能清单，并将 Portal 主题作用域的复用经验写入 `runbooks/PITFALLS.md`。此次仅外观与无障碍名称，不变更业务概念、输入输出或生命周期，无需修改 ontology；不重复写入记忆热区或 EVENT_MEMORY。未运行全仓测试与真实 Extension Development Host，不读写真实用户配置。
