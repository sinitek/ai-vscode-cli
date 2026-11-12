# 通知闪烁开关功能规格与本体同步

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：docs

## 背景与目标

将工具设置补齐既有闪烁入口与独立通知边界写入功能清单、能力规格和通知管理ontology。

## 范围与非目标

- 功能清单、能力规格、ontology：已同步。仅补齐已有配置入口，不改变通知原生实现，无需更新架构或 runbook。
- 记忆：属于现有配置入口补齐，无需新增热区或事件记忆。

- 不承担Webview功能或测试开发；设置页文案精简属于关联feature。

## 验收标准

说明任务完成/人机交互两个闪烁配置的默认开启、全局保存、独立性与保存失败回显；不声称改变原生通知/授权/后台触发。

## 风险与缓解

不可将模拟Windows联动写成原生视觉已通过；只补已有入口，不扩写架构/runbook或热区。

## 验证计划与历史结果

- 结构校验：ontology validate 通过（105 rules）；`git diff --check` 通过；Impeccable detector 无发现。

原命令 `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`；本轮未重跑全域校验。

## 当前状态

清单、能力规格与ontology已同步，原completed保留。

## 关联计划

- [feature：通知设置闪烁开关与文案精简](2026-11-05-feature-notification-attention-settings.md#背景与目标)：分别承接通知设置闪烁开关与文案精简，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留通知与闪烁独立设置回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-notification-attention-settings.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
