# CLI 当前配置归属事实来源同步

- 日期：2026-11-04
- 状态：completed
- 类型：docs
- 负责人：Codex

## 背景与目标

为 [当前配置归属修复](2026-11-04-bugfix-explicit-cli-config-ownership.md) 同步稳定行为，明确当前档案优先、任务不恢复旧档案、配置指纹和忙碌租约边界。

## 范围与非目标

- 范围：`FEATURE_INVENTORY.md`、`sinitek-cli-plugin-capabilities.md`、CLI 运行时参考、`PITFALLS.md`、配置应用/选择/Tab 恢复相关 ontology 规则及其导航事实。
- 非目标：不修改架构、调度实现、用户配置或测试代码；不把验证日志扩写为产品承诺。

## 验收标准与结果

- 功能清单、插件能力、运行时参考、PITFALLS 和 ontology 只描述已实现的当前档案优先、执行前失败阻断、配置身份/租约边界，并保留外部并发未覆盖说明。
- 原计划记录 ontology validate 与 `git diff --check` 通过；本文仅承接文档写作交付。

## 关联计划

- 实现来源：[2026-11-04-bugfix-explicit-cli-config-ownership.md](2026-11-04-bugfix-explicit-cli-config-ownership.md)
- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-explicit-cli-config-ownership.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
