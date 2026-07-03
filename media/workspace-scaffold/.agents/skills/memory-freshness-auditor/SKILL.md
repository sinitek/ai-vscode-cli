---
name: memory-freshness-auditor
description: Use when you need to audit whether memory docs, claim-lite memory artifacts, pending items, active risks, and active plans are fresh, properly attributed, and ready for cross-session recall.
---

# Memory Freshness Auditor

目标：把“热区记忆和 claim-lite 记忆是否还可信”这件事从人工感觉，变成可重复执行的审计动作。

## 什么时候用

- 收尾前，想检查热区记忆是否需要更新
- 热区文档、pending items、active risks 刚刚发生变化
- claim-aware index 或 recall/eval 产物刚刚刷新
- 开始复杂任务前，想确认当前记忆是否新鲜
- 做记忆治理时，需要发现 stale / missing attribution / placeholder 问题

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/memory-freshness-auditor/scripts/audit_memory_freshness.py`
2. 根据输出处理：
   - stale 文档
   - 缺少 `source_of_truth` / `status` / `last_verified_at` 的文档
   - 缺少 `status` / `source_path` / `source_span` 或 `source_anchor` 的 claim-lite 条目
   - 缺少 `review_after` 的 claim-lite 条目
   - `recall-summary.json` 里已被选为高优先输入、但状态已是 `needs_verification` / `superseded` / `archived` 的 claim-lite 条目
   - 缺少 owner / 来源 / 下一步 的 pending item
   - 缺少来源的 active risk
3. 如需更严格，可以加：
   - `--strict`
4. claim-level 审计依赖的真实产物分成两类：
   - claim 完整性检查读取 `claims.jsonl`，缺失时退回 `summary.json` 里的固定 `claims` 列表
   - “失效 claim 仍被选为高优先输入”检查只读取真实 `recall-summary.json`
5. 如果当前仓库还没有 recall 产物：
   - 脚本仍会执行 memory docs / open loops / claim 完整性审计
   - 仅跳过高优先 claim 选择审计，并在报告里明确说明缺少 `recall-summary.json`

## 产出要求

- 明确有哪些 issue
- 明确有哪些 warning
- 明确 claim 完整性审计与高优先 claim 选择审计是否执行，以及各自基于哪个真实产物执行
- 如果没有问题，要明确说明通过

## 不要这样做

- 不要把审计结果当成唯一事实来源
- 不要只跑审计不修问题
- 不要把 starter 占位当成真实已维护记忆
- 不要把 `needs_verification` 或 `superseded` 的 claim 静默继续当成默认高优先记忆输入
- 不要在 `summary.json` 里猜测 recall schema；高优先输入检查只能基于真实 recall 产物
