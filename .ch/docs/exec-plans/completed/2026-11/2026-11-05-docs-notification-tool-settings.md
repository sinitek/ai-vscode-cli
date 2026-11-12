# 工具设置通知授权规格与排障同步

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：docs

## 背景与目标

将授权入口迁到工具设置及两个独立开关的真实行为写入功能清单、能力规格、通知排障和ontology。

## 范围与非目标

- 原文已实际同步功能清单、能力规格、通知排障与ontology；不承担页签实现或测试开发。
- 既有架构边界不变，无需ARCHITECTURE；无新可复用经验，不更新memory热区/事件记忆。
- 保留并行Loop+排查文档和PITFALLS导航，不纳入本任务。

## 验收标准

文档说明使用说明仅保留模式、工具设置通知授权、两个独立默认开启开关、保存失败回显、查询不申请权限及拒绝后设置入口；不改系统权限来源。

## 风险与缓解

不得暗示授权弹窗/原生通知已跨平台真机重验；不覆盖并行文档，不把通知投递和窗口提醒混为一项配置。

## 验证计划与历史结果

- 功能清单、能力规格、通知排障和 ontology 已同步。`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过；UI detector 无报告项；`git diff --check` 通过。

上述九项既有ontology脚本测试是历史执行证据，不是本来源新增测试开发，本轮不重跑。

## 当前状态

实际产品/排障/规则文档完成；原completed不变，不声称架构/热区有新增交付。

## 关联计划

- [feature：通知授权迁移至工具设置](2026-11-05-feature-notification-tool-settings.md#背景与目标)：分别承接通知授权迁移至工具设置，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留通知授权页签与独立开关回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-notification-tool-settings.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
