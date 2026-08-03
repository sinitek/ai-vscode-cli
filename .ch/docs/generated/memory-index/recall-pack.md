# Memory Recall Pack

## Summary

- Generated at: 2026-08-03T10:14:20Z
- Focus: exec plan active cleanup
- Anchor ID: -
- Selection mode: baseline-fallback
- Available observation entries: 2
- Available read cost: ~85 tokens
- Selected index entries: 2 (~85 tokens if fully expanded)
- Expanded entries in this pack: 2 (~85 tokens)
- Generated recall surfaces: 8
- Hot-zone docs: 2
- Recent handoffs: 0
- Active plans: 0
- Related design docs: 2
- Related runbooks: 0
- Source diversity: 2 unique sources / 2 selected observations
- Retrieval debug: `.ch/docs/generated/memory-index/retrieval-debug.md`

## Progressive Disclosure

1. 先扫下面的 Observation Index，确认哪些 ID 值得展开。
2. 只读取 Expanded Observation Details 中少量最高优先级条目。
3. 如果需要更多细节，再按 ID 打开 `observation-registry.md` 或 `observations.jsonl`。
4. 如果需要上下文顺序，用 `timeline.md` 或重新运行 `--anchor-id <id>`。

## Observation Index

| ID | Type | Title | Read | Source | Why |
| --- | --- | --- | --- | --- | --- |
| `mem-c1d7e714b7` | `rule` | 记忆流转规则 | ~39 | `.ch/docs/MEMORY.md` | baseline recall entry。 |
| `mem-431f2548e1` | `rule` | 热区记忆面 | ~46 | `.ch/docs/memory/README.md` | baseline recall entry。 |

## Expanded Observation Details

### mem-c1d7e714b7 - 记忆流转规则

- Type: `rule`
- Topic: `rule`
- Read: ~39 tokens
- Source: `.ch/docs/MEMORY.md`
- Score: `62` (base `56`)
- Selected claims: `claim-04d77e38d577`, `claim-0b54f47ce76f`, `claim-0b87a7723e07`, `claim-13080f25ffe8`, `claim-16cc09133222`, `claim-1cf94165b719` ... (+78 more)
- Score breakdown: type_priority=45, focus_terms=0, open_loop_bonus=0, read_cost_adjustment=4, evidence_bonus=4, concept_bonus=1, topic_bonus=2, source_diversity_bonus=2, claim_bonus=4, same_source_penalty=0
- Concepts: `general`
- Files: `.ch/docs/generated/`, `.ch/docs/handoffs/`

Facts:
- 这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**
- Source of truth: .ch/docs/MEMORY.md

Narrative:

这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**

### mem-431f2548e1 - 热区记忆面

- Type: `rule`
- Topic: `gotcha`
- Read: ~46 tokens
- Source: `.ch/docs/memory/README.md`
- Score: `61` (base `55`)
- Selected claims: `claim-093d0b145dbc`, `claim-0e19638c3dbc`, `claim-0f988e077476`, `claim-1782b644ce89`, `claim-1b53727dc88c`, `claim-2435e8e9d987` ... (+33 more)
- Score breakdown: type_priority=45, focus_terms=0, open_loop_bonus=0, read_cost_adjustment=4, evidence_bonus=3, concept_bonus=1, topic_bonus=2, source_diversity_bonus=2, claim_bonus=4, same_source_penalty=0
- Concepts: `gotcha`
- Files: `.ch/docs/MEMORY.md`

Facts:
- 这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。
- Source of truth: .ch/docs/memory/README.md

Narrative:

这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。

## Recommended Reading Order

1. `recall-index.md` / 本文件的 Observation Index。
2. 本文件的 Expanded Observation Details。
3. `open-loops.md` 和 `freshness-report.md`。
4. 如果任务是跨会话续接，再看最近 handoff。
5. 再看相关 active plans，确认 working-layer 目标、任务列表和验证计划。
6. 如果提供了 focus，再展开匹配到的 design docs 和 runbooks。

## Generated Recall Surfaces

- `.ch/docs/generated/memory-index/recall-index.md` | Recall Index
  Why: ID 化 observation 索引，优先扫描标题、类型、来源和读取成本。
  Summary: 渐进披露第一层：只看有什么和读取成本。

- `.ch/docs/generated/memory-index/retrieval-debug.md` | Retrieval Debug
  Why: 解释 lexical recall 的 matched terms、打分和多样性重排。
  Summary: 评测和审阅优先看这里，不替代原始事实来源。

- `.ch/docs/generated/memory-index/observation-registry.md` | Observation Registry
  Why: 按 ID 展开 observation facts / narrative / source。
  Summary: 渐进披露第二层：只展开已经筛选过的 ID。

- `.ch/docs/generated/memory-index/claim-registry.md` | Claim Registry
  Why: 当前 observation 已经可关联到 claim 级证据，可直接检查状态和来源。
  Summary: claim-aware recall 的证据补充层，不替代原始事实来源。

- `.ch/docs/generated/memory-index/timeline.md` | Memory Timeline
  Why: 围绕 ID 或时间顺序恢复前后文。
  Summary: 按 modified/source 顺序排列 observation entries。

- `.ch/docs/generated/memory-index/freshness-report.md` | Freshness Report
  Why: 当前热区记忆存在 stale 项，需要先确认哪些内容仍可信。
  Summary: 检查哪些 memory docs 已过期或需要再核验。

- `.ch/docs/generated/memory-index/topic-corpus.md` | Topic Corpus
  Why: 按 topic 聚合可复用知识，便于后续 reference pack。
  Summary: 专题 corpus 起点，不替代原始事实来源。

- `.ch/docs/generated/memory-index/index.md` | Memory Index
  Why: 热区记忆、开放事项和当前计划的低噪音总入口。
  Summary: 默认先读的 generated 记忆索引入口。

## Hot-Zone Docs

- `.ch/docs/memory/README.md` | 热区记忆面
  Why: 热区边界和阅读顺序入口。
  Summary: 这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。

- `.ch/docs/MEMORY.md` | 记忆流转规则
  Why: 记忆分层与流转规则入口。
  Summary: 这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**

## Recent Handoffs

- None

## Active Plans

- None

## Related Design Docs

- `.ch/docs/design-docs/graph-orchestration-mode.md` | Graph 编排模式详细设计 | matches=active
  Why: 与当前 focus 相关的设计决策入口，命中：active。
  Summary: 状态：active（Phase 2 恢复与交互增强已落地，direct 自动返工已落地） 日期：2026-08-03 相关计划：`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode-design.md`、`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode.md`

- `.ch/docs/design-docs/loop-debate-multi-agent-mode.md` | Loop 红蓝辩论多智能体模式详细设计 | matches=active
  Why: 与当前 focus 相关的设计决策入口，命中：active。
  Summary: 状态：active 相关计划：`.ch/docs/exec-plans/completed/2026-06-16-loop-debate-chat-mode.md`、`.ch/docs/exec-plans/completed/2026-06-16-loop-debate-session-tabs.md` 相关规格：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`

## Related Runbooks

- None

## Watch Items

- 存在 stale memory docs：`.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。

## Suggested Next Commands

- `python3 .agents/skills/memory-indexer/scripts/generate_memory_index.py`：当热区或开放事项变化后刷新基础 recall 面。
- `python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --anchor-id <mem-id>`：围绕某个 observation ID 生成 timeline window。
- `python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py`：当 recall 暴露出 promotion backlog 时继续做 consolidation。
- `python3 .agents/skills/memory-freshness-auditor/scripts/audit_memory_freshness.py`：当 recall 暴露 stale docs 或 attribution 缺口时继续做 freshness audit。
