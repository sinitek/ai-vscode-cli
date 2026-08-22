---
memory_type: lesson
scope: project
status: active
last_verified_at: template-fill-when-adopted
source_of_truth: .ch/docs/memory/LESSONS_LEARNED.md
derived_from: []
supersedes: []
related_paths: []
---

# 经验教训

这个文件只记录**已经验证、值得重复使用或长期规避**的经验结论。

## 什么时候更新

- 某个问题已经重复出现，且已经确认更好的长期做法
- 某个实现选择已经被验证有效，值得以后默认复用
- 某类错误虽然已修复，但还值得作为通用经验保留

## 不该写什么

- 还没验证的猜测
- 纯历史流水账
- 已经过时且无人再需要的旧经验

## 写法要求

- 经验应尽量写成“触发场景 -> 推荐动作 -> 来源”的格式。
- 如果它本质上是稳定规则，应迁到 `AGENTS.md`、`ARCHITECTURE.md`、`.ch/docs/SECURITY.md`、`.ch/docs/TESTING.md` 或必要 `skills/`。
- 如果它只是当前阶段风险，先迁到 `ACTIVE_RISKS.md`。

## 当前经验

starter 默认不预置经验。接入真实项目后，从第一条被验证的长期经验开始维护下表。

| 场景 | 推荐动作 | 来源 |
| --- | --- | --- |
