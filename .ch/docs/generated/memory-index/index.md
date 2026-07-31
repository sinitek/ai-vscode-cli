# Memory Index

这个目录由 `memory-indexer` 生成，用于把热区记忆、开放事项和 freshness 压缩成默认优先召回面。

## 当前概览

- 热区/规则文档：9
- 活跃计划：9
- Pending items：0
- Active risks：0
- Lessons：0
- Observation entries：11
- Claim entries：123
- Estimated read cost：~757 tokens
- Fresh docs：0
- Stale docs：2
- Starter docs：7

## 记忆金字塔

- L1 rolling_summary：1
- L2 event_memory：1
- L3 project_profile：1
- L3 user_profile：1
- L4 procedural_experience：1
- operational_hot_zone：4

## Progressive Disclosure

1. 先看 `recall-index.md`：只读 ID、类型、标题、来源和读取成本。
2. 需要细节时再按 ID 展开 `observation-registry.md` 或 `observations.jsonl`。
3. 需要 claim 级证据时看 `claim-registry.md` 或 `claims.jsonl`。
4. 需要上下文顺序时看 `timeline.md`，需要专题复用时看 `topic-corpus.md`。

## 推荐阅读顺序

1. `recall-index.md`
2. `claim-registry.md`
3. `open-loops.md`
4. `freshness-report.md`
5. `timeline.md`
6. `topic-corpus.md`
7. `by-topic.md`
8. `by-source.md`

## 判定规则

- freshness 超过 `30` 天未验证时标记为 `stale`
- 带 starter 占位语义的热区文档不生成 observation entry，除非它是记忆规则或热区说明入口
- `<private>` / `<no-memory>` 等隐私标签内的内容会从 generated 结果中剥离
- claim 抽取只覆盖 front matter、表格行和标题下的短 bullet；内容不足以稳定抽取时宁可跳过
- generated memory index 只做召回压缩，不替代原始事实来源
