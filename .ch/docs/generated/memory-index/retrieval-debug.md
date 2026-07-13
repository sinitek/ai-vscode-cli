# Retrieval Debug

这个文件只解释本次 recall 为什么选中了这些 observation，以及有哪些轻量词法启发式参与排序。
它是 generated-only 的 debug / eval 辅助层，不是新的长期事实来源。

## Run Context

- Generated at: 2026-07-13T07:49:17Z
- Focus: 继续当前未完成任务 performance memory audit loop opencode progress monitor repair
- Focus terms: `继续当前未完成任务`, `继续`, `续当`, `当前`, `前未`, `未完`, `完成`, `成任`
- Anchor ID: -
- Selection mode: focus-filtered
- Candidate count: 11
- Ranked candidate count: 2
- Focus match count: 2
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
| 1 | `mem-5233a00937` | `93` | `91` | 当前 | `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md` | `0` |
| 2 | `mem-4b483bd801` | `93` | `91` | 完成 | `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` | `0` |

## Score Breakdown

### mem-5233a00937 - Codex、Claude、OpenCode CLI 配置可视化扩展

- Final score: `93`
- Base score: `91`
- Matched terms: `当前`
- Source: `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md`
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

### mem-4b483bd801 - MCP 市场全量检测与权威刷新

- Final score: `93`
- Base score: `91`
- Matched terms: `完成`
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

- Unique source count: 2
- Selected observation count: 2
- Max same-source observations: 1

### Source Path Counts

- `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`: 1
- `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md`: 1

### Source Kind Counts

- `active_plan`: 2

## Claim Status Snapshot

- No selected claims

## Watch Items

- 当前有 9 份 active plans。
- 存在 stale memory docs：`.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。
