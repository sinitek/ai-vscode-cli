# 主任务完成提醒事实来源同步

- 日期：2026-11-04
- 状态：completed
- 类型：docs
- 负责人：Codex

## 背景与目标

同步 [主任务与 Vibe 完成提醒](2026-11-04-feature-task-completion-desktop-attention.md) 的完成事件过滤、平台差异、权限和不保证展示边界。

## 范围与非目标

- 范围：`ARCHITECTURE.md`、功能清单、ontology 完成提醒规则及平台官方依据。
- 非目标：不改变提醒实现、不追加事件记忆、不把构建或系统接受投递写成发布/用户可见保证。

## 验收与结果

- 文档保留前台、失败、停止、压缩静默、Windows/Linux 未真机、macOS 无宿主 Dock 弹跳及未安装/未发布边界；原计划记录结构检查通过。

## 关联计划

- 实现来源：[2026-11-04-feature-task-completion-desktop-attention.md](2026-11-04-feature-task-completion-desktop-attention.md)
- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-task-completion-desktop-attention.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
