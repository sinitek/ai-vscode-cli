# memory-index 目录说明

这个目录用于存放围绕热区记忆生成的 recall 与 consolidation 产物。

starter 默认只保留这个说明文件，不预置真实生成结果，避免把模板仓库自己的记忆索引或 consolidation 报告带进新项目。

`recall-index.md`、`observation-registry.md`、`observations.jsonl`、`claims.jsonl`、`claim-registry.md`、`timeline.md` 和 `topic-corpus.md` 组成渐进披露召回面：

- 先看 ID 化索引和读取成本
- 再按 ID 展开少量细节
- 需要 claim 级证据时看 claim registry / JSONL
- 需要前后文时看 timeline
- 需要专题复用时看 topic corpus

`consolidation-report.md` 会包含记忆金字塔检查：L1 滚动摘要候选、L2 事件记忆候选、L3 用户/项目画像候选、L4 程序性经验候选。

## 生成方式

在真实项目仓库根目录运行：

```bash
python3 .agents/skills/memory-indexer/scripts/generate_memory_index.py
```

如需进一步判断哪些内容该从 handoff、plan、pitfalls 上提到热区或长期文档，可再运行：

```bash
python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py
```

如需围绕某个当前任务 focus 生成一份 bounded recall 包，可运行：

```bash
python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --focus "<short focus>"
```

如需围绕某条 observation entry 生成前后文窗口，可运行：

```bash
python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --anchor-id <mem-id>
```

如需把某个稳定 topic 下的原始来源打包成可复用 reference pack，可先刷新 memory index，再运行：

```bash
python3 .agents/skills/reference-pack/scripts/build_reference_pack.py --preset memory-core --topic "<topic>"
```

默认会生成到：

- `.ch/docs/generated/memory-index/index.md`
- `.ch/docs/generated/memory-index/recall-index.md`
- `.ch/docs/generated/memory-index/observation-registry.md`
- `.ch/docs/generated/memory-index/observations.jsonl`
- `.ch/docs/generated/memory-index/claims.jsonl`
- `.ch/docs/generated/memory-index/claim-registry.md`
- `.ch/docs/generated/memory-index/timeline.md`
- `.ch/docs/generated/memory-index/topic-corpus.md`
- `.ch/docs/generated/memory-index/by-topic.md`
- `.ch/docs/generated/memory-index/by-source.md`
- `.ch/docs/generated/memory-index/open-loops.md`
- `.ch/docs/generated/memory-index/freshness-report.md`
- `.ch/docs/generated/memory-index/manifest.json`
- `.ch/docs/generated/memory-index/summary.json`
- `.ch/docs/generated/memory-index/.local/recall-pack.md`
- `.ch/docs/generated/memory-index/.local/recall-summary.json`
- `.ch/docs/generated/memory-index/.local/retrieval-debug.md`
- `.ch/docs/generated/memory-index/consolidation-report.md`
- `.ch/docs/generated/memory-index/consolidation-summary.json`

## 使用原则

- 它是热区记忆与开放事项的召回压缩层，不替代原始计划、设计、runbook 或规格文档。
- observation registry 只负责给每条可召回记忆分配 ID、来源、读取成本和结构化摘要，不替代原始事实来源。
- claim registry 只负责给可稳定抽取的事实片段提供最小 claim 级 evidence，不做 graph/ontology，也不替代原始事实来源。
- recall pack 只负责给出“当前最该先读什么”和少量展开详情，不替代原始事实来源。
- topic corpus 只作为专题复用或 reference pack 的起点；真正跨仓导出时应通过 `--topic` 选择原始事实来源、runbook、design docs 和 skills。
- consolidation report 只提供“建议压缩、抽取或上提什么”，不直接替代人工判断或长期事实来源。
- `<private>`、`<no-memory>`、`memory_visibility: private` 等内容会被脚本跳过或剥离，不应出现在 generated 结果里。
- 当 `memory/`、`exec-plans/active/`、pending items、active risks 发生变化时，应重新生成。
- 如果上下文非常清晰，也可以不生成，避免噪音。
- starter 仓库不预置真实 `claims.jsonl` / `claim-registry.md`；这些文件只在真实项目运行脚本后生成，提交前应确认没有把模板仓库自己的 generated 结果带进 `app/`。
