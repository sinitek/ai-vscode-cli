# Loop 配置漂移警告事实来源同步

- 日期：2026-11-04
- 状态：completed
- 类型：docs
- 负责人：Codex

## 背景与目标

记录忙碌配置漂移中间方案的真实限制，并链接最终收窄后的 [档案身份边界](2026-11-04-feature-model-selection-config-boundary.md)，避免把已移除的原生内容比对/警告降级当成当前行为。

## 范围与非目标

- 范围：功能清单、CLI 运行时参考和配置协调 ontology 规则中的中间方案、最终决策和未验证边界。
- 非目标：不重新定义当前实现、不修改 ontology 本体之外的代码、不追加事件记忆。

## 验收与结果

- 现有计划已明确这是中间方案；文档保留失败、租约和全量夹具问题证据，并指向最终方案。
- 原计划记录 ontology validate 与 `git diff --check` 通过。

## 关联计划

- 来源：[2026-11-04-bugfix-loop-config-drift-warning.md](2026-11-04-bugfix-loop-config-drift-warning.md)
- 最终行为：[2026-11-04-feature-model-selection-config-boundary.md](2026-11-04-feature-model-selection-config-boundary.md)
- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-loop-config-drift-warning.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
