# 主模型提问 Markdown 与图片加载文档同步

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：docs

## 背景与目标

同步既有提问入口 Markdown 挂载与异步图片置底的稳定规则，并保留复发问题的排障经验。

## 范围与非目标

- 更新功能清单、共享 Markdown 本体规则与图片延迟加载 runbook。
- 记忆判定：稳定行为写入清单/本体，不额外写入记忆热区或事件记忆。

- 不负责气泡/滚动源码或测试开发；架构与 CLI 调用未变，无需更新 ARCHITECTURE 或热区/事件记忆。

## 验收标准

清单/共享Markdown规则说明新内容及重开定位最新、无变化更新不干扰；runbook说明图片/SVG延迟加载需要 load 后校正，不能只靠下一帧。

## 风险与缓解

只记录已证实的稳定行为，不声明真实主模型、宿主或Windows实机已验收；保留工作区其他任务修改。

## 验证计划与历史结果

- 原计划命令：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 及范围内空白检查。
- ontology 校验、范围内空白检查通过；Impeccable 检测未报告问题。

## 当前状态

实际清单、本体规则与图片延迟加载 runbook 已同步；本轮仅迁移历史记录，不重跑其验证。

## 关联计划

- [bugfix：主模型提问弹窗 Markdown 与自动滚动](2026-11-05-bugfix-main-model-ask-markdown-scroll.md#背景与目标)：分别承接主模型提问弹窗 Markdown 与自动滚动，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留主模型提问共享挂载与滚动回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-main-model-ask-markdown-scroll.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
