# Windows 通知引导规格与免打扰排障同步

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：docs

## 背景与目标

同步Windows真实通知状态/首次设置引导的架构、产品与规则事实，并记录免打扰抑制横幅的真实排障结论。

## 范围与非目标

- 已同步架构、功能清单、能力规格、ontology 和排障记录；Mac 授权流程及 Linux 边界保持原有行为。

- 架构、功能清单、能力规格、ontology与排障runbook实际编写；不承担transport/host实现或回归开发。
- 无新增用户偏好/脚本化需求，不更新滚动摘要；排障结论已入runbook，不重复写事件记忆。

## 验收标准

说明Windows无macOS式授权弹窗、使用ms-settings:notifications、只记录成功引导一次、查询不申请/不发送；不能把Enabled/历史/送达日志等同横幅成功，需记录用户解除免打扰后确认。

## 风险与缓解

不声称强制突破展示策略或Mac/Linux原生真机通过；历史规则数103照录，不套用其他来源105。

## 验证计划与历史结果

- `$env:PYTHONUTF8='1'`、`$env:PYTHONIOENCODING='utf-8'` 环境下运行 `python .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains、16 concepts、15 relations、103 rules、2 workflows、3 documents；`python -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- `git diff --check`：通过。变更范围核对仅包含本次通知状态/引导、回归和对应事实文档，无依赖或发布流程变更。

原文 ontology 与范围检查通过，任务归档；临时服务/场景清理及结果截图留存按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-windows-notification-settings.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。本轮不重跑九项脚本测试或业务验证。

## 当前状态

稳定规格、架构、ontology和runbook同步完成；免打扰根因确认以feature用户实际反馈为依据，原completed保留。

## 关联计划

- [feature：Windows 通知状态与首次设置引导](2026-11-05-feature-windows-notification-settings.md#背景与目标)：分别承接Windows 通知状态与首次设置引导，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留 Windows 通知状态与首次引导回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-windows-notification-settings.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
