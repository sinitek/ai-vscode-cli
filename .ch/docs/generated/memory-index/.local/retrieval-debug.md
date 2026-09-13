# Retrieval Debug

这个文件只解释本次 recall 为什么选中了这些 observation，以及有哪些轻量词法启发式参与排序。
它是 generated-only 的 debug / eval 辅助层，不是新的长期事实来源。

## Run Context

- Generated at: 2026-09-13T04:32:11Z
- Focus: Codex Kimi 最终气泡 request_user_input 答案序列化
- Focus terms: `codex`, `kimi`, `最终气泡`, `request_user_input`, `答案序列化`, `答案`, `案序`, `序列`
- Anchor ID: -
- Selection mode: focus-filtered
- Candidate count: 3
- Ranked candidate count: 1
- Focus match count: 1
- Focus excluded count: 2

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
| 1 | `mem-d2d35997b1` | `105` | `103` | codex, kimi | `.ch/docs/exec-plans/active/2026-09-13-fix-kimi-codex-interaction.md` | `0` |

## Score Breakdown

### mem-d2d35997b1 - 修复 Kimi Codex 最终气泡与用户输入

- Final score: `105`
- Base score: `103`
- Matched terms: `codex`, `kimi`
- Source: `.ch/docs/exec-plans/active/2026-09-13-fix-kimi-codex-interaction.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `24` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `3` |
| `concept_bonus` | `2` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

## Top Unselected Candidates

- None

## Source Diversity

- Unique source count: 1
- Selected observation count: 1
- Max same-source observations: 1

### Source Path Counts

- `.ch/docs/exec-plans/active/2026-09-13-fix-kimi-codex-interaction.md`: 1

### Source Kind Counts

- `active_plan`: 1

## Claim Status Snapshot

- No selected claims

## Watch Items

- 当前有 1 份 active plans。
- 存在 stale memory docs：`.ch/docs/MEMORY.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。
