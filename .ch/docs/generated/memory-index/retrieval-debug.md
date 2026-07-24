# Retrieval Debug

这个文件只解释本次 recall 为什么选中了这些 observation，以及有哪些轻量词法启发式参与排序。
它是 generated-only 的 debug / eval 辅助层，不是新的长期事实来源。

## Run Context

- Generated at: 2026-07-24T09:16:44Z
- Focus: graph ai planned dag
- Focus terms: `graph`, `ai`, `planned`, `dag`
- Anchor ID: -
- Selection mode: baseline-fallback
- Candidate count: 10
- Ranked candidate count: 10
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
| 1 | `mem-b7b003c3a1` | `85` | `83` | - | `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md` | `0` |
| 2 | `mem-bbc18d3434` | `84` | `82` | - | `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md` | `0` |
| 3 | `mem-fe60588b95` | `83` | `81` | - | `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md` | `0` |
| 4 | `mem-e2fabd8a2e` | `83` | `81` | - | `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md` | `0` |
| 5 | `mem-0b64dd15aa` | `81` | `79` | - | `.ch/docs/exec-plans/active/2026-06-04-trace-error-bubble-dedupe.md` | `0` |
| 6 | `mem-5233a00937` | `81` | `79` | - | `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md` | `0` |
| 7 | `mem-4b483bd801` | `81` | `79` | - | `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` | `0` |
| 8 | `mem-d336cba178` | `81` | `79` | - | `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md` | `0` |
| 9 | `mem-c1d7e714b7` | `62` | `56` | - | `.ch/docs/MEMORY.md` | `84` |
| 10 | `mem-431f2548e1` | `62` | `56` | - | `.ch/docs/memory/README.md` | `39` |

## Score Breakdown

### mem-b7b003c3a1 - 官方 skills 版本刷新与最新判断修复

- Final score: `85`
- Base score: `83`
- Matched terms: -
- Source: `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `3` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-bbc18d3434 - Loop 主任务失败终止护栏

- Final score: `84`
- Base score: `82`
- Matched terms: -
- Source: `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `2` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-fe60588b95 - Loop 红蓝辩论主持人轮流点名调度

- Final score: `83`
- Base score: `81`
- Matched terms: -
- Source: `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-e2fabd8a2e - Loop Group Chat UI Follow-ups

- Final score: `83`
- Base score: `81`
- Matched terms: -
- Source: `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-0b64dd15aa - Trace Error Bubble Dedupe

- Final score: `81`
- Base score: `79`
- Matched terms: -
- Source: `.ch/docs/exec-plans/active/2026-06-04-trace-error-bubble-dedupe.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `4` |
| `evidence_bonus` | `4` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-5233a00937 - Codex、Claude、OpenCode CLI 配置可视化扩展

- Final score: `81`
- Base score: `79`
- Matched terms: -
- Source: `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `2` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-4b483bd801 - MCP 市场全量检测与权威刷新

- Final score: `81`
- Base score: `79`
- Matched terms: -
- Source: `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `2` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

### mem-d336cba178 - Harness 单元自测与 Chromium Playwright 能力吸收

- Final score: `81`
- Base score: `79`
- Matched terms: -
- Source: `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md`
- Selected claim IDs: -

| Heuristic | Contribution |
| --- | --- |
| `type_priority` | `68` |
| `focus_terms` | `0` |
| `open_loop_bonus` | `0` |
| `read_cost_adjustment` | `2` |
| `evidence_bonus` | `6` |
| `concept_bonus` | `1` |
| `topic_bonus` | `2` |
| `source_diversity_bonus` | `2` |
| `claim_bonus` | `0` |
| `same_source_penalty` | `0` |

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

- Final score: `62`
- Base score: `56`
- Matched terms: -
- Source: `.ch/docs/memory/README.md`
- Selected claim IDs: `claim-093d0b145dbc`, `claim-0e19638c3dbc`, `claim-0f988e077476`, `claim-1782b644ce89`, `claim-1b53727dc88c`, `claim-2435e8e9d987` ... (+33 more)

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

## Top Unselected Candidates

- None

## Source Diversity

- Unique source count: 10
- Selected observation count: 10
- Max same-source observations: 1

### Source Path Counts

- `.ch/docs/MEMORY.md`: 1
- `.ch/docs/exec-plans/active/2026-06-04-trace-error-bubble-dedupe.md`: 1
- `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md`: 1
- `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md`: 1
- `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md`: 1
- `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md`: 1
- `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`: 1
- `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md`: 1
- `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md`: 1
- `.ch/docs/memory/README.md`: 1

### Source Kind Counts

- `active_plan`: 8
- `memory_doc`: 2

## Claim Status Snapshot

- `active`: 123

## Watch Items

- 当前有 8 份 active plans。
- 存在 stale memory docs：`.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。
