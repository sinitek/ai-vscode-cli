---
name: claim-release-auditor
description: Use when multiple active plans may be owned concurrently and you need to audit stale claims, missing ownership fields, blocked plans without handoff targets, or plans that should release their claim.
---

# Claim Release Auditor

目标：把 active plans 里的轻量 claim / release 约定，从“写了字段”推进到“能发现失效占用、缺字段和交接缺口”。

## 什么时候用

- 同时存在多份 active plans，且已经开始使用 `owner`、`claimed_at`、`claim_ttl`、`handoff_to`
- 想检查哪些计划的 claim 已过期、缺失或应该释放
- 想确认 blocked 计划是否已经明确交接对象
- 收尾前，想避免旧 claim 长期占着计划不释放

## 不该什么时候用

- 当前只有一份非常小的 active plan，且没有任何 claim 字段
- 你要修改计划内容本身，而不是做 claim 治理

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/claim-release-auditor/scripts/audit_plan_claims.py`
2. 先读：
   - `.ch/docs/generated/claim-audit.md`
3. 再按需要处理：
   - 过期 claim
   - 缺失 `owner` / `claimed_at` / `claim_ttl`
   - blocked 计划缺少 `handoff_to`
   - 已完成但未释放的 claim
4. 如需更严格，可加：
   - `--strict`

## 产出要求

- 明确当前扫描了多少 active plans
- 区分 issue 与 warning
- 指出哪些 claim 已过期、即将到期或字段不完整
- 如果没有问题，要明确说明通过

## 不要这样做

- 不要只看 generated claim audit，不回写真实计划里的 claim 字段
- 不要把 `claim_ttl` 写成无法解释的自由文本
- 不要让 blocked 或 completed 计划长期保留无人确认的旧 claim
