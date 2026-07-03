---
name: memory-indexer
description: Use when you need to generate or refresh low-noise memory recall artifacts under .ch/docs/generated/memory-index/ from hot memory docs, active exec plans, pending items, risks, and related references.
---

# Memory Indexer

目标：把热区记忆、记忆金字塔和当前开放事项整理成一组**低噪音、可再生、默认优先召回**的 generated 文档，并补充最小可审阅的 claim-aware 索引层。

## 什么时候用

- `.ch/docs/generated/memory-index/` 不存在
- `memory/` 热区刚发生变化
- `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md` 刚发生变化
- `exec-plans/active/`、`PENDING_ITEMS.md`、`ACTIVE_RISKS.md` 刚发生变化
- 开始复杂任务前，需要快速恢复跨会话上下文
- 收尾前，需要检查热区、开放事项和 freshness 是否同步

## 不该什么时候用

- 只改一个你已经完全掌握的小文件，且当前上下文非常清晰
- 热区和开放事项都没有变化，现有 generated memory index 仍然新鲜

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/memory-indexer/scripts/generate_memory_index.py`
2. 先读：
   - `.ch/docs/generated/memory-index/index.md`
   - `.ch/docs/generated/memory-index/recall-index.md`
3. 再按任务需要读取：
   - `observation-registry.md`
   - `claim-registry.md`
   - `timeline.md`
   - `topic-corpus.md`
   - `open-loops.md`
   - `freshness-report.md`
   - `by-topic.md`
   - `by-source.md`
4. 如果本次任务修改了热区记忆、active plan 或开放事项，收尾前重新生成一次。

## 产出要求

- 说明生成了哪些文件
- 如果跳过生成，要说明理由
- 如果 freshness 或 open loops 暴露了问题，要在结果里明确指出
- 路径引用归一化只能移除显式 `./` 前缀，必须保留 `.ch/` 这类隐藏目录前缀，避免把 `.ch/docs/...` 误写成 `ch/docs/...`
- `recall-index.md` 必须提供 ID、type、title、source、read cost
- `observation-registry.md` / `observations.jsonl` 必须能按 ID 展开事实、来源和 hash
- `claim-registry.md` / `claims.jsonl` 必须提供最小 `MemoryClaimLite` 字段集：claim 文本、类型、状态、source evidence、hash、confidence、review_after
- `timeline.md` 必须支持围绕 ID 的后续 recall
- `topic-corpus.md` 必须按 topic 聚合可复用知识，但不替代原始事实来源
- `<private>`、`<no-memory>`、`memory_visibility: private` 等内容必须从 generated 结果中跳过或剥离
- claim 抽取必须保守、零依赖、可解释；优先 front matter、表格行、标题下短 bullet，内容不足时宁可少生成
- generated claim 只做 claim-aware recall/debug，不做 entity/relation/ontology，也不引入 SQLite、DuckDB、向量缓存或二进制索引

## 不要这样做

- 不要把 generated memory index 当成唯一事实来源
- 不要把长讨论或长历史直接写进 generated 结果
- 不要手工长期维护 generated 文件；它们应由脚本重建
- 不要把 generated topic corpus 直接当作跨仓导出的唯一内容；reference pack 应导出原始 docs、runbooks 和 skills
- 不要把 `claims.jsonl` 扩展成 graph/event store；starter 只保留说明文件，不提交真实生成结果
