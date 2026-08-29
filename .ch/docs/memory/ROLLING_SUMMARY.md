---
memory_type: rolling_summary
scope: project
status: active
last_verified_at: template-fill-when-adopted
source_of_truth: .ch/docs/memory/ROLLING_SUMMARY.md
derived_from: []
supersedes: []
related_paths: []
---

# 滚动摘要

这个文件是记忆金字塔的 **L1**：把较旧、分散、但下一轮仍可能需要的 working / episodic 信息压缩成短摘要。

它的目的不是保存完整历史，而是降低 recall 时反复读取旧计划、旧阶段总结和旧讨论的成本。

## 什么时候更新

- 一个非平凡任务完成或暂停后，active plan 或阶段总结中仍有跨会话价值
- 最近多份计划讲的是同一条脉络，适合合并为一段短摘要
- 某段阶段性背景仍要保留，但不值得进入长期项目画像、事件记忆、runbook 或设计文档

## 不该写什么

- 已经沉淀到 `PROJECT_CONTEXT.md`、`USER_PREFERENCES.md`、`EVENT_MEMORY.md`、`runbooks/` 或 `design-docs/` 的重复内容
- 单次任务内的完整过程流水账
- 没有来源、无法追溯的推断

## 维护规则

- 摘要应短，优先写“当前状态 + 为什么还要保留 + 去哪里看原文”。
- 如果摘要里的事实变成长期稳定规则，应上提到 L3 或 L4，并从这里删减。
- 如果摘要只剩历史价值，应移回原始归档，不继续占用热区。

## 当前滚动摘要

starter 默认不预置摘要。接入真实项目后，从第一段仍有跨会话价值的阶段摘要开始维护下表。

| 时间窗口 | 摘要 | 覆盖来源 | 保留原因 | 下一次复核 |
| --- | --- | --- | --- | --- |
