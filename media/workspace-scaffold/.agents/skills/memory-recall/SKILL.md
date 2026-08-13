---
name: memory-recall
description: Use when you need a bounded, prioritized recall path for a complex task so you can recover context from hot memory docs, generated memory index, recent handoffs, active plans, and focus-matched design or runbook docs instead of scanning the whole repo.
---

# Memory Recall

目标：把“开始复杂任务时先读什么”这件事，变成一个低噪音、可重复执行的受控召回入口，并优先利用记忆金字塔降低旧上下文读取成本。

## 什么时候用

- 开始一个复杂任务，但上下文分散在热区、handoff、active plans 和专题文档里
- 刚切回一个中断过的任务，需要快速恢复跨会话状态
- 需要围绕某个焦点主题做 bounded recall，而不是全文搜索全仓
- 收口或交接前，想确认当前任务最该先看的事实来源是什么

## 不该什么时候用

- 只改一个上下文已经非常清晰的小文件
- 你已经明确知道当前只需要读某一份计划或某一个模块文档
- 你需要的是全仓搜索，而不是受控召回顺序

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --focus "<short focus>"`
   - 如需围绕某条记忆展开前后文：`python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --anchor-id <mem-id>`
2. 先读生成结果：
   - `.ch/docs/generated/memory-index/.local/recall-pack.md`
   - `.ch/docs/generated/memory-index/.local/retrieval-debug.md`
   - `.ch/docs/generated/memory-index/.local/recall-summary.json`
3. 按建议顺序展开：
   - 本文件里的 Observation Index
   - 少量 Expanded Observation Details
   - `recall-index.md`
   - `observation-registry.md` / `observations.jsonl`
   - 需要 claim 级证据时看 `claim-registry.md` / `claims.jsonl`
   - `timeline.md`
   - 最近 handoff
   - active plans
   - 相关 `design-docs/`
   - 相关 `runbooks/`
4. 如果 recall pack 暴露了 stale 文档、open loops 或 consolidation gaps，再决定是否继续运行：
   - `memory-consolidator`
   - `memory-freshness-auditor`

## 产出要求

- 明确本次 recall 的 focus 是什么
- 明确本次 anchor ID 是什么，如果没有则说明为空
- 中文 focus 必须支持最小可靠命中：保留英文/数字 token 行为，同时对连续 CJK 短语生成可命中的中文词元，避免整句中文 focus 直接退化成 baseline
- 给出 ID 化 Observation Index，显示 type、title、source、read cost
- 只展开少量最高优先级 observation details
- 输出 eval-friendly `recall-summary.json`，至少暴露 selected observations、selected source paths、matched terms、score、source diversity、estimated read tokens、watch items、selected claim IDs
- 输出 `retrieval-debug.md`，解释 lexical recall 的 matched terms、score breakdown、source diversity 和未入选候选
- 如果提供了 `--anchor-id`，给出 timeline window
- 给出建议阅读顺序和每类来源的入选理由
- 明确 open loops、active risks、stale docs、coverage gaps 等提醒
- 如果没有提供 focus，也要明确说明此次只生成 baseline recall

## 输出边界

- `recall-pack.md`、`recall-summary.json`、`retrieval-debug.md` 都是 generated-only 的召回辅助层。
- 默认输出到 ignored 的 `.ch/docs/generated/memory-index/.local/`，避免个人任务 focus 覆盖团队共享索引。
- 它们用于帮助 agent 做 bounded recall、人工审阅召回理由，以及让后续 `memory-eval` 直接读取结构化结果。
- 它们不是新的长期事实来源，不替代原始 Markdown、`observation-registry.md`、`claim-registry.md`、设计文档或 runbook。
- debug / summary 可以预留 claim 状态、unsupported / stale watch items 等 future-proof 字段，但不应引入外部检索 provider、向量库或数据库。

## 不要这样做

- 不要把 recall skill 退化成“再造一个全文搜索”
- 不要把 recall pack 当成新的长期事实来源
- 不要把 retrieval debug 或 recall summary 当成长期记忆写回来源
- 不要一次把所有设计文档、runbook、历史 handoff 都塞进上下文
- 不要无筛选地展开所有 observation；先看 ID 索引，再按需展开
