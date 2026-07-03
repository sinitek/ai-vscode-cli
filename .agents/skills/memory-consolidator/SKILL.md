---
name: memory-consolidator
description: Use when you need a low-noise consolidation pass that suggests what should be compressed, extracted, or promoted from recent handoffs, active plans, pitfalls, and memory hot-zone docs into the memory pyramid, pending items, active risks, lessons learned, runbooks, or design docs.
---

# Memory Consolidator

目标：把 handoff、active plan、pitfalls 和 memory 热区之间“哪些内容该压缩、抽取或上提”这件事，变成可重复执行、可审阅的半自动化流程。

## 什么时候用

- 一个非平凡任务准备暂停，需要决定哪些内容该进入长期记忆
- 一个任务完成后，需要检查 L1 滚动摘要、L2 事件记忆、L3 用户/项目画像、L4 程序性经验是否可以优化
- 最近刚新增或更新了 handoff、active plan、pitfalls、pending items、active risks、lessons
- 想检查 open loops、风险、经验和决策是否还停留在 working / episodic 层
- 需要给下一次会话准备一个低噪音的 promotion backlog

## 不该什么时候用

- 只改了一个你完全掌握的小文件，且不会产生跨会话影响
- 当前没有 handoff、active plan 或 pitfall 变化，热区记忆也没有待治理项

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py`
2. 打开生成结果：
   - `.ch/docs/generated/memory-index/consolidation-report.md`
3. 逐条确认建议：
   - 阶段性上下文是否压缩进 `ROLLING_SUMMARY.md`
   - 失败原因、成功方案或关键决策是否抽取到 `EVENT_MEMORY.md`
   - 稳定项目事实或用户偏好是否进入 `PROJECT_CONTEXT.md` / `USER_PREFERENCES.md`
   - open loops 是否进入 `PENDING_ITEMS.md`
   - 风险是否进入 `ACTIVE_RISKS.md`
   - 长期经验是否进入 `LESSONS_LEARNED.md`
   - 是否需要进一步上提到 `runbooks/` 或 `design-docs/`
4. 完成上提后，重新生成：
   - `memory-indexer`
   - 必要时再跑 `memory-freshness-auditor`

## 产出要求

- 明确列出本次扫描了哪些 handoff、plan 和 pitfalls
- 明确列出记忆金字塔各层的当前数量和候选项
- 给出建议目标容器、原因、来源和草稿字段
- 对 private 文档执行整篇跳过，对 `<private>`、`<no-memory>`、`<memory-private>` 等区块执行剥离
- generated 的 `consolidation-report.md` 和 `consolidation-summary.json` 只能暴露跳过/剥离计数，不得作为私有内容外泄通道
- 如果没有候选项，也要明确说明当前无需 consolidation

## 不要这样做

- 不要把脚本建议直接当成事实来源；最终事实仍在手写 Markdown 文档
- 不要无脑把所有候选都复制进热区，先确认它是否真的跨会话高复用
- 不要让 handoff 或 active plan 长期替代 `memory/`、`runbooks/` 或 `design-docs/`
- 不要把 private 标签中的原文改写进建议、coverage gap、report 或 summary
