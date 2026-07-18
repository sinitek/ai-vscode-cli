# Retrieval Debug

这个文件只解释本次 recall 为什么选中了这些 observation，以及有哪些轻量词法启发式参与排序。
它是 generated-only 的 debug / eval 辅助层，不是新的长期事实来源。

## Run Context

- Generated at: 2026-07-17T03:39:04Z
- Focus: Loop mode automatic sleep scheduled wakeup countdown JSON resume execution
- Focus terms: `loop`, `mode`, `automatic`, `sleep`, `scheduled`, `wakeup`, `countdown`, `json`
- Anchor ID: -
- Selection mode: focus-filtered
- Candidate count: 10
- Ranked candidate count: 6
- Focus match count: 6
- Focus excluded count: 4

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
| 1 | `mem-bbc18d3434` | `96` | `94` | loop | `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md` | `0` |
| 2 | `mem-fe60588b95` | `95` | `93` | loop | `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md` | `0` |
| 3 | `mem-e2fabd8a2e` | `95` | `93` | loop | `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md` | `0` |
| 4 | `mem-5233a00937` | `93` | `91` | loop | `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md` | `0` |
| 5 | `mem-4b483bd801` | `93` | `91` | loop | `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` | `0` |
| 6 | `mem-d336cba178` | `93` | `91` | loop | `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md` | `0` |

## Score Breakdown

### mem-bbc18d3434 - Loop 主任务失败终止护栏

- Final score: `96`
- Base score: `94`
- Matched terms: `loop`
- Source: `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `12` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `2` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-fe60588b95 - Loop 红蓝辩论主持人轮流点名调度

- Final score: `95`
- Base score: `93`
- Matched terms: `loop`
- Source: `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `12` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-e2fabd8a2e - Loop Group Chat UI Follow-ups

- Final score: `95`
- Base score: `93`
- Matched terms: `loop`
- Source: `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `12` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-5233a00937 - Codex、Claude、OpenCode CLI 配置可视化扩展

- Final score: `93`
- Base score: `91`
- Matched terms: `loop`
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
- Matched terms: `loop`
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

### mem-d336cba178 - Harness 单元自测与 Chromium Playwright 能力吸收

- Final score: `93`
- Base score: `91`
- Matched terms: `loop`
- Source: `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md`
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

- Unique source count: 6
- Selected observation count: 6
- Max same-source observations: 1

### Source Path Counts

- `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md`: 1
- `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md`: 1
- `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md`: 1
- `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`: 1
- `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md`: 1
- `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md`: 1

### Source Kind Counts

- `active_plan`: 6

## Claim Status Snapshot

- No selected claims

## Watch Items

- 当前有 8 份 active plans。
- 存在 stale memory docs：`.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。
