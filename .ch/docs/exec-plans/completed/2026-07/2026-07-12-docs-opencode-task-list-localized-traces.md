# OpenCode 任务列表与工具标题事实文档

- 日期：2026-07-12
- 状态：completed
- 负责人：Codex

## 背景与目标

独立承接 [`2026-07-12-feature-opencode-task-list-localized-traces.md`](2026-07-12-feature-opencode-task-list-localized-traces.md) 中的能力规格、CLI 运行时参考和功能清单同步。该记录仅承接事实文档交付，不复制运行时实现计划。

## 范围与非目标

- 范围：原计划记载更新的 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、OpenCode 能力规格与 CLI 运行时参考；反映 `todowrite` 任务更新、本地化标题、未知工具名回退和 trace 保留行为。
- 非目标：不修改运行时或测试代码，不把引用既有文档当作文档写作。

## 验收与验证

- [x] 原计划明确记录功能清单、能力规格和 CLI 运行时参考已更新。
- [x] 原计划未提供 docs 专属自动化验证；本轮不新增验证结论。
- 本轮迁移未重新校验上述外部文档内容。

## 关联计划

- 运行时实现：[`2026-07-12-feature-opencode-task-list-localized-traces.md`](2026-07-12-feature-opencode-task-list-localized-traces.md)。
- 历史验证证据：[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)。

## 当前结论

文档同步按原计划记录已完成；其具体文件属于外部文档域，未在本轮重新审查或修改。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
