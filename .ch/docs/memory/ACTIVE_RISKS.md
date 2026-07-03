---
memory_type: active_risk
scope: project
status: active
last_verified_at: template-fill-when-adopted
source_of_truth: .ch/docs/memory/ACTIVE_RISKS.md
derived_from: []
supersedes: []
related_paths: []
---

# 活跃风险

这个文件只记录**当前仍有效**、且在后续任务中需要优先留意的风险。

## 什么时候更新

- 某项风险已被确认存在，但还没有彻底关闭
- 某项能力上线、迁移或重构后仍需观察
- 某个外部依赖、环境约束或历史坑点仍可能复发

## 不该写什么

- 已经彻底关闭的风险
- 没有实际影响面的空泛担忧
- 已经迁入 `PITFALLS_HISTORY.md` 的历史问题

## 维护规则

- 每条风险至少写清楚：风险、影响、当前缓解、来源。
- 风险关闭后，应尽快移除，必要时沉淀到对应 runbook 或历史归档。
- 如果风险已经进入正式计划，应优先链接计划，而不是在这里重复长篇背景。

## 当前风险

starter 默认不预置风险。接入真实项目后，从第一条真实有效的风险开始维护下表。

| 风险 | 影响 | 当前缓解 | 来源 |
| --- | --- | --- | --- |
