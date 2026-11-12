# 通知授权与说明页事实来源同步

- 日期：2026-11-04
- 状态：completed
- 类型：docs
- 负责人：Codex

## 背景与目标

同步 [通知授权与说明入口](2026-11-04-feature-notification-authorization.md) 的首次授权决定、拒绝后系统设置入口、平台和远程宿主边界。

## 范围与非目标

- 范围：功能清单、通知能力规格、排障文档和 ontology 规则；保留稳定 bundle ID 与不发送测试通知的说明。
- 非目标：不改变授权实现、不清除系统权限、不把本机已授权诊断写成首次弹窗保证。

## 验收与结果

- 文档保留授权/勿扰/平台差异、按钮隐藏和未真机覆盖边界；原计划记录 ontology 校验、Python 测试及空白检查通过。

## 关联计划

- 实现来源：[2026-11-04-feature-notification-authorization.md](2026-11-04-feature-notification-authorization.md)
- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-notification-authorization.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
