# CLI 导入协议选择能力文档

- 日期：2026-11-03
- 状态：completed
- 类型：docs
- 负责人：Codex

## 关联计划

- 功能与共同背景见 [`2026-11-03-feature-cli-import-protocol-select.md`](2026-11-03-feature-cli-import-protocol-select.md)。本计划只记录能力清单、能力规格和 ontology 事实源更新。
- 新增回归开发见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-cli-import-protocol-select.md`）。

## 目标与范围

同步 `FEATURE_INVENTORY.md`、`sinitek-cli-plugin-capabilities.md` 与 `plugin.rule.cli_example_import_inputs`，记录共享导入弹窗中按 CLI 选择协议、默认值及字段落点的稳定行为。无产品实现或测试开发。

## 验收标准

- 功能清单、能力规格与 ontology 规则准确反映交付行为且互相一致。
- 说明与 feature/test 记录互链，不将页面验证冒充文档验收。

## 验证与真实结果

- 原计划记录上述清单、能力规格和规则已同步；ontology 结构检查与 9 项 ontology 单测通过，具体历史命令由原记录保留。
- 本次迁移未重新检查外部文档差异或重跑历史验证。

## 当前结论

历史能力文档同步完成，状态 `completed`；实现和回归开发由关联计划承接。

## 验证计划

本轮仅核对本记录与关联来源的历史证据、职责分配及具体链接；原业务命令与执行结果以本记录和关联计划的历史记录为准，不重跑测试、构建、浏览器或真实CLI。
