# Memory Recall Pack

## Summary

- Generated at: 2026-08-03T01:28:19Z
- Focus: review-extension-refactor graph task failed review auto repair
- Anchor ID: -
- Selection mode: focus-filtered
- Available observation entries: 12
- Available read cost: ~866 tokens
- Selected index entries: 3 (~335 tokens if fully expanded)
- Expanded entries in this pack: 3 (~335 tokens)
- Generated recall surfaces: 9
- Hot-zone docs: 2
- Recent handoffs: 0
- Active plans: 4
- Related design docs: 1
- Related runbooks: 0
- Source diversity: 3 unique sources / 3 selected observations
- Retrieval debug: `.ch/docs/generated/memory-index/retrieval-debug.md`

## Progressive Disclosure

1. 先扫下面的 Observation Index，确认哪些 ID 值得展开。
2. 只读取 Expanded Observation Details 中少量最高优先级条目。
3. 如果需要更多细节，再按 ID 打开 `observation-registry.md` 或 `observations.jsonl`。
4. 如果需要上下文顺序，用 `timeline.md` 或重新运行 `--anchor-id <id>`。

## Focus Match Summary

- Matched terms: `review-extension-refactor`, `graph`, `task`

## Observation Index

| ID | Type | Title | Read | Source | Why |
| --- | --- | --- | --- | --- | --- |
| `mem-fb18b9b4d2` | `plan` | extension.ts 入口运行时重构计划 | ~112 | `.ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md` | 命中 focus：review-extension-refactor, graph。 |
| `mem-19baaefc61` | `plan` | 可复用逻辑重构执行计划 | ~104 | `.ch/docs/exec-plans/active/2026-08-01-reusable-logic-refactor.md` | 命中 focus：graph。 |
| `mem-4b483bd801` | `plan` | MCP 市场全量检测与权威刷新 | ~119 | `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` | 命中 focus：task。 |

## Expanded Observation Details

### mem-fb18b9b4d2 - extension.ts 入口运行时重构计划

- Type: `plan`
- Topic: `plan`
- Read: ~112 tokens
- Source: `.ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md`
- Score: `105` (base `103`)
- Matches: `review-extension-refactor`, `graph`
- Score breakdown: type_priority=68, focus_terms=24, open_loop_bonus=0, read_cost_adjustment=2, evidence_bonus=6, concept_bonus=1, topic_bonus=2, source_diversity_bonus=2, claim_bonus=0, same_source_penalty=0
- Concepts: `open-loop`
- Files: `.ch/docs/design-docs/vscode-cli-extension-runtime.md`, `.ch/docs/memory/`, `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/runbooks/PITFALLS.md`, `src/extension.ts`, `src/extensionHost/`, `src/extensionHost/promptExecutionShared.ts`, `src/extensionHost/promptInteractiveRuntime.ts`

Facts:
- 日期：2026-08-02 状态：in-progress 负责人：协作 owner：graph_msg_1785683322596_8d0486c3981e8 claimed_at：2026-08-02T15:19:46+08:00 claim_ttl：Graph run 生命周期内有效 handoff_to：review-extension-refactor
- Modified at: 2026-08-02T16:49:15+00:00

Narrative:

日期：2026-08-02 状态：in-progress 负责人：协作 owner：graph_msg_1785683322596_8d0486c3981e8 claimed_at：2026-08-02T15:19:46+08:00 claim_ttl：Graph run 生命周期内有效 handoff_to：review-extension-refactor

### mem-19baaefc61 - 可复用逻辑重构执行计划

- Type: `plan`
- Topic: `plan`
- Read: ~104 tokens
- Source: `.ch/docs/exec-plans/active/2026-08-01-reusable-logic-refactor.md`
- Score: `94` (base `92`)
- Matches: `graph`
- Score breakdown: type_priority=68, focus_terms=12, open_loop_bonus=0, read_cost_adjustment=2, evidence_bonus=6, concept_bonus=2, topic_bonus=2, source_diversity_bonus=2, claim_bonus=0, same_source_penalty=0
- Concepts: `open-loop`, `pattern`
- Files: `.ch/docs/TESTING.md`, `.ch/docs/memory/`, `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `src/foo`, `src/foo/bar`, `src/foobar`, `src/graph/`, `src/graph/graphScheduler.ts`

Facts:
- 日期：2026-08-01 状态：in-progress 负责人：Codex（Graph 主任务） owner：main claimed_at：2026-08-01T09:31:44+08:00 claim_ttl：本次 Graph run 完成前 handoff_to：verify-build-tests、review-refactor
- Modified at: 2026-08-01T09:56:10+00:00

Narrative:

日期：2026-08-01 状态：in-progress 负责人：Codex（Graph 主任务） owner：main claimed_at：2026-08-01T09:31:44+08:00 claim_ttl：本次 Graph run 完成前 handoff_to：verify-build-tests、review-refactor

### mem-4b483bd801 - MCP 市场全量检测与权威刷新

- Type: `plan`
- Topic: `plan`
- Read: ~119 tokens
- Source: `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`
- Score: `93` (base `91`)
- Matches: `task`
- Score breakdown: type_priority=68, focus_terms=12, open_loop_bonus=0, read_cost_adjustment=2, evidence_bonus=6, concept_bonus=1, topic_bonus=2, source_diversity_bonus=2, claim_bonus=0, same_source_penalty=0
- Concepts: `open-loop`
- Files: `.ch/docs/design-docs/vscode-cli-extension-runtime.md`, `.ch/docs/exec-plans/`, `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`, `.ch/docs/references/`, `.ch/docs/references/cli-runtime-reference.md`, `.ch/docs/runbooks/`, `.ch/docs/runbooks/PITFALLS.md`

Facts:
- 日期：2026-07-11 状态：implementation-complete / pending-main-review 负责人：Codex / 人类 / 协作 owner：Loop main task / rolling subtasks claimed_at：2026-07-11 claim_ttl：本轮 Loop 任务完成前 handoff_to：下一轮 MCP 市场实现/验证子任务
- Modified at: 2026-07-11T03:33:13+00:00

Narrative:

日期：2026-07-11 状态：implementation-complete / pending-main-review 负责人：Codex / 人类 / 协作 owner：Loop main task / rolling subtasks claimed_at：2026-07-11 claim_ttl：本轮 Loop 任务完成前 handoff_to：下一轮 MCP 市场实现/验证子任务

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

- `.ch/docs/generated/memory-index/open-loops.md` | Open Loops
  Why: 当前存在开放事项、活跃风险或 active plans，需要先看 open loops。
  Summary: 集中看 pending items、active risks 和 active plan 计数。

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

- `.ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md` | extension.ts 入口运行时重构计划 | matches=review-extension-refactor, graph
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: 日期：2026-08-02 状态：in-progress 负责人：协作 owner：graph_msg_1785683322596_8d0486c3981e8 claimed_at：2026-08-02T15:19:46+08:00 claim_ttl：Graph run 生命周期内有效 handoff_to：review-extension-refactor

- `.ch/docs/exec-plans/active/2026-08-01-reusable-logic-refactor.md` | 可复用逻辑重构执行计划 | matches=graph
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: 日期：2026-08-01 状态：in-progress 负责人：Codex（Graph 主任务） owner：main claimed_at：2026-08-01T09:31:44+08:00 claim_ttl：本次 Graph run 完成前 handoff_to：verify-build-tests、review-refactor

- `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` | MCP 市场全量检测与权威刷新 | matches=task
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: 日期：2026-07-11 状态：implementation-complete / pending-main-review 负责人：Codex / 人类 / 协作 owner：Loop main task / rolling subtasks claimed_at：2026-07-11 claim_ttl：本轮 Loop 任务完成前 handoff_to：下一轮 MCP 市场实现/验证子任务

- `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md` | Harness 单元自测与 Chromium Playwright 能力吸收
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: 日期：2026-07-14 状态：in-progress 负责人：协作 owner：Loop 主任务 `msg_1783998484827_4b2d85596667a` claimed_at：2026-07-14T03:18:27Z claim_ttl：本 Loop 任务完成前；每轮主任务复核时续期 handoff_to：由 Loop 主任务派发的审计归并、实施与独立验收代理

## Related Design Docs

- `.ch/docs/design-docs/graph-orchestration-mode.md` | Graph 编排模式详细设计 | matches=graph
  Why: 与当前 focus 相关的设计决策入口，命中：graph。
  Summary: 状态：active（Phase 2 恢复与交互增强已落地） 日期：2026-07-30 相关计划：`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode-design.md`、`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode.md`

## Related Runbooks

- None

## Watch Items

- 当前有 10 份 active plans。
- 存在 stale memory docs：`.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。

## Suggested Next Commands

- `python3 .agents/skills/memory-indexer/scripts/generate_memory_index.py`：当热区或开放事项变化后刷新基础 recall 面。
- `python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --anchor-id <mem-id>`：围绕某个 observation ID 生成 timeline window。
- `python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py`：当 recall 暴露出 promotion backlog 时继续做 consolidation。
- `python3 .agents/skills/memory-freshness-auditor/scripts/audit_memory_freshness.py`：当 recall 暴露 stale docs 或 attribution 缺口时继续做 freshness audit。
