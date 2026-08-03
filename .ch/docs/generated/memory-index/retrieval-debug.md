# Retrieval Debug

这个文件只解释本次 recall 为什么选中了这些 observation，以及有哪些轻量词法启发式参与排序。
它是 generated-only 的 debug / eval 辅助层，不是新的长期事实来源。

## Run Context

- Generated at: 2026-08-03T01:28:19Z
- Focus: review-extension-refactor graph task failed review auto repair
- Focus terms: `review-extension-refactor`, `graph`, `task`, `failed`, `review`, `auto`, `repair`
- Anchor ID: -
- Selection mode: focus-filtered
- Candidate count: 12
- Ranked candidate count: 3
- Focus match count: 3
- Focus excluded count: 9

## Heuristics

- `type_priority`
- `focus_terms`
- `open_loop_bonus`
- `read_cost_adjustment`
- `evidence_bonus`
- `concept_bonus`
- `topic_bonus`
- `source_diversity_bonus`
- `claim_bonus`
- `same_source_penalty`

## Selected Observations

| Rank | ID | Final | Base | Matched Terms | Source | Claims |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `mem-fb18b9b4d2` | `105` | `103` | review-extension-refactor, graph | `.ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md` | `0` |
| 2 | `mem-19baaefc61` | `94` | `92` | graph | `.ch/docs/exec-plans/active/2026-08-01-reusable-logic-refactor.md` | `0` |
| 3 | `mem-4b483bd801` | `93` | `91` | task | `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` | `0` |

## Score Breakdown

### mem-fb18b9b4d2 - extension.ts 入口运行时重构计划

- Final score: `105`
- Base score: `103`
- Matched terms: `review-extension-refactor`, `graph`
- Source: `.ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `24` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `2` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-19baaefc61 - 可复用逻辑重构执行计划

- Final score: `94`
- Base score: `92`
- Matched terms: `graph`
- Source: `.ch/docs/exec-plans/active/2026-08-01-reusable-logic-refactor.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `12` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `2` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `2` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-4b483bd801 - MCP 市场全量检测与权威刷新

- Final score: `93`
- Base score: `91`
- Matched terms: `task`
- Source: `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `12` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `2` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

## Top Unselected Candidates

- None

## Source Diversity

- Unique source count: 3
- Selected observation count: 3
- Max same-source observations: 1

### Source Path Counts

- `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`: 1
- `.ch/docs/exec-plans/active/2026-08-01-reusable-logic-refactor.md`: 1
- `.ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md`: 1

### Source Kind Counts

- `active_plan`: 3

## Claim Status Snapshot

- No selected claims

## Watch Items

- 当前有 10 份 active plans。
- 存在 stale memory docs：`.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。
