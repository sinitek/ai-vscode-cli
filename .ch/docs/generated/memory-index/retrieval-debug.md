# Retrieval Debug

这个文件只解释本次 recall 为什么选中了这些 observation，以及有哪些轻量词法启发式参与排序。
它是 generated-only 的 debug / eval 辅助层，不是新的长期事实来源。

## Run Context

- Generated at: 2026-08-03T10:14:20Z
- Focus: exec plan active cleanup
- Focus terms: `exec`, `plan`, `active`, `cleanup`
- Anchor ID: -
- Selection mode: baseline-fallback
- Candidate count: 2
- Ranked candidate count: 2
- Focus match count: 0
- Focus excluded count: 0

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
| 1 | `mem-c1d7e714b7` | `62` | `56` | - | `.ch/docs/MEMORY.md` | `84` |
| 2 | `mem-431f2548e1` | `61` | `55` | - | `.ch/docs/memory/README.md` | `39` |

## Score Breakdown

### mem-c1d7e714b7 - 记忆流转规则

- Final score: `62`
- Base score: `56`
- Matched terms: -
- Source: `.ch/docs/MEMORY.md`
- Selected claim IDs: `claim-04d77e38d577`, `claim-0b54f47ce76f`, `claim-0b87a7723e07`, `claim-13080f25ffe8`, `claim-16cc09133222`, `claim-1cf94165b719` ... (+78 more)

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `45` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `4` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `4` |
| `same_source_penalty` | `0` |

### mem-431f2548e1 - 热区记忆面

- Final score: `61`
- Base score: `55`
- Matched terms: -
- Source: `.ch/docs/memory/README.md`
- Selected claim IDs: `claim-093d0b145dbc`, `claim-0e19638c3dbc`, `claim-0f988e077476`, `claim-1782b644ce89`, `claim-1b53727dc88c`, `claim-2435e8e9d987` ... (+33 more)

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `45` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `3` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `4` |
| `same_source_penalty` | `0` |

## Top Unselected Candidates

- None

## Source Diversity

- Unique source count: 2
- Selected observation count: 2
- Max same-source observations: 1

### Source Path Counts

- `.ch/docs/MEMORY.md`: 1
- `.ch/docs/memory/README.md`: 1

### Source Kind Counts

- `memory_doc`: 2

## Claim Status Snapshot

- `active`: 123

## Watch Items

- 存在 stale memory docs：`.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。
