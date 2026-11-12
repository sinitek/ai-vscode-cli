# 任务列表折叠与进度文档同步

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：/root
- claimed_at：2026-07-13
- claim_ttl：当前会话
- handoff_to：无

## 目标

把新增的任务列表折叠箭头与完成/总数进度行为同步到用户可见的能力规格和功能清单。

## 范围

- 同步 `FEATURE_INVENTORY.md` 与 `sinitek-cli-plugin-capabilities.md`。
- 不承接功能实现或测试开发；依赖 [功能计划](2026-07-13-feature-task-list-collapse.md)，测试边界见 [历史验证证据](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)。

## 验收标准

- [x] 能力规格与功能清单说明折叠控件、进度格式及已有状态语义。
- [x] 不把文档同步当作功能计划本身的实现范围。

## 验证计划

- 历史证据：原计划记载能力规格和功能清单已同步。
- 本迁移仅复核关联路径和交付边界，不重跑历史功能验证。

## 真实结果

原计划记录已同步 `FEATURE_INVENTORY.md` 与 `sinitek-cli-plugin-capabilities.md`；迁移没有重新核对当前外部文档版本，后续全仓集成仍需检查引用一致性。

## 关联计划

- [功能计划](2026-07-13-feature-task-list-collapse.md)：文档描述其已实现的折叠与计数能力。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
