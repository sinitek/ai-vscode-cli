# Memory Recall Pack

## Summary

- Generated at: 2026-07-24T09:16:44Z
- Focus: graph ai planned dag
- Anchor ID: -
- Selection mode: baseline-fallback
- Available observation entries: 10
- Available read cost: ~650 tokens
- Selected index entries: 10 (~650 tokens if fully expanded)
- Expanded entries in this pack: 3 (~124 tokens)
- Generated recall surfaces: 9
- Hot-zone docs: 2
- Recent handoffs: 0
- Active plans: 4
- Related design docs: 2
- Related runbooks: 0
- Source diversity: 10 unique sources / 10 selected observations
- Retrieval debug: `.ch/docs/generated/memory-index/retrieval-debug.md`

## Progressive Disclosure

1. 先扫下面的 Observation Index，确认哪些 ID 值得展开。
2. 只读取 Expanded Observation Details 中少量最高优先级条目。
3. 如果需要更多细节，再按 ID 打开 `observation-registry.md` 或 `observations.jsonl`。
4. 如果需要上下文顺序，用 `timeline.md` 或重新运行 `--anchor-id <id>`。

## Observation Index

| ID | Type | Title | Read | Source | Why |
| --- | --- | --- | --- | --- | --- |
| `mem-b7b003c3a1` | `plan` | 官方 skills 版本刷新与最新判断修复 | ~45 | `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md` | baseline recall entry。 |
| `mem-bbc18d3434` | `plan` | Loop 主任务失败终止护栏 | ~39 | `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md` | baseline recall entry。 |
| `mem-fe60588b95` | `plan` | Loop 红蓝辩论主持人轮流点名调度 | ~40 | `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md` | baseline recall entry。 |
| `mem-e2fabd8a2e` | `plan` | Loop Group Chat UI Follow-ups | ~48 | `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md` | baseline recall entry。 |
| `mem-0b64dd15aa` | `plan` | Trace Error Bubble Dedupe | ~47 | `.ch/docs/exec-plans/active/2026-06-04-trace-error-bubble-dedupe.md` | baseline recall entry。 |
| `mem-5233a00937` | `plan` | Codex、Claude、OpenCode CLI 配置可视化扩展 | ~107 | `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md` | baseline recall entry。 |
| `mem-4b483bd801` | `plan` | MCP 市场全量检测与权威刷新 | ~119 | `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` | baseline recall entry。 |
| `mem-d336cba178` | `plan` | Harness 单元自测与 Chromium Playwright 能力吸收 | ~120 | `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md` | baseline recall entry。 |
| `mem-c1d7e714b7` | `rule` | 记忆流转规则 | ~39 | `.ch/docs/MEMORY.md` | baseline recall entry。 |
| `mem-431f2548e1` | `rule` | 热区记忆面 | ~46 | `.ch/docs/memory/README.md` | baseline recall entry。 |

## Expanded Observation Details

### mem-b7b003c3a1 - 官方 skills 版本刷新与最新判断修复

- Type: `plan`
- Topic: `plan`
- Read: ~45 tokens
- Source: `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md`
- Score: `85` (base `83`)
- Score breakdown: type_priority=68, focus_terms=0, open_loop_bonus=0, read_cost_adjustment=4, evidence_bonus=6, concept_bonus=3, topic_bonus=2, source_diversity_bonus=2, claim_bonus=0, same_source_penalty=0
- Concepts: `open-loop`, `problem-solution`, `procedure`
- Files: `.ch/docs/exec-plans/`, `.ch/docs/product-specs/`, `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/references/`, `.ch/docs/references/authoritative-skills.md`, `scripts/`, `src/config/`, `src/webview/`

Facts:
- 日期：2026-06-27 状态：in-progress 负责人：Codex / 人类 / 协作
- Modified at: 2026-07-14T03:33:01+00:00

Narrative:

日期：2026-06-27 状态：in-progress 负责人：Codex / 人类 / 协作

### mem-bbc18d3434 - Loop 主任务失败终止护栏

- Type: `plan`
- Topic: `plan`
- Read: ~39 tokens
- Source: `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md`
- Score: `84` (base `82`)
- Score breakdown: type_priority=68, focus_terms=0, open_loop_bonus=0, read_cost_adjustment=4, evidence_bonus=6, concept_bonus=2, topic_bonus=2, source_diversity_bonus=2, claim_bonus=0, same_source_penalty=0
- Concepts: `open-loop`, `problem-solution`
- Files: `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`, `.ch/docs/runbooks/PITFALLS.md`, `src/extension.ts`, `src/test/`

Facts:
- 日期：2026-06-27 状态：in-progress 负责人：Codex
- Modified at: 2026-07-07T01:50:50+00:00

Narrative:

日期：2026-06-27 状态：in-progress 负责人：Codex

### mem-fe60588b95 - Loop 红蓝辩论主持人轮流点名调度

- Type: `plan`
- Topic: `plan`
- Read: ~40 tokens
- Source: `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md`
- Score: `83` (base `81`)
- Score breakdown: type_priority=68, focus_terms=0, open_loop_bonus=0, read_cost_adjustment=4, evidence_bonus=6, concept_bonus=1, topic_bonus=2, source_diversity_bonus=2, claim_bonus=0, same_source_penalty=0
- Concepts: `open-loop`
- Files: `.ch/docs/design-docs/`, `.ch/docs/design-docs/loop-debate-multi-agent-mode.md`, `.ch/docs/product-specs/`, `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`, `src/extension.ts`, `src/loopDebate.ts`, `src/test/loopDebate.test.ts`

Facts:
- 日期：2026-06-29 状态：in-progress 负责人：Codex
- Modified at: 2026-07-14T01:27:53+00:00

Narrative:

日期：2026-06-29 状态：in-progress 负责人：Codex

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

- `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md` | Harness 单元自测与 Chromium Playwright 能力吸收
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: 日期：2026-07-14 状态：in-progress 负责人：协作 owner：Loop 主任务 `msg_1783998484827_4b2d85596667a` claimed_at：2026-07-14T03:18:27Z claim_ttl：本 Loop 任务完成前；每轮主任务复核时续期 handoff_to：由 Loop 主任务派发的审计归并、实施与独立验收代理

- `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md` | 官方 skills 版本刷新与最新判断修复
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: 日期：2026-06-27 状态：in-progress 负责人：Codex / 人类 / 协作

- `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md` | Loop Group Chat UI Follow-ups
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: Date: 2026-06-25 Status: in-progress Owner: Codex

- `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md` | Loop 红蓝辩论主持人轮流点名调度
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: 日期：2026-06-29 状态：in-progress 负责人：Codex

## Related Design Docs

- `.ch/docs/design-docs/graph-orchestration-mode.md` | Graph 编排模式详细设计 | matches=graph, ai, dag
  Why: 与当前 focus 相关的设计决策入口，命中：graph / ai / dag。
  Summary: 状态：active（Phase 2 恢复与交互增强已落地） 日期：2026-07-23 相关计划：`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode-design.md`、`.ch/docs/exec-plans/completed/2026-07-23-graph-orchestration-mode.md`

- `.ch/docs/design-docs/loop-debate-multi-agent-mode.md` | Loop 红蓝辩论多智能体模式详细设计 | matches=ai
  Why: 与当前 focus 相关的设计决策入口，命中：ai。
  Summary: 状态：active 相关计划：`.ch/docs/exec-plans/completed/2026-06-16-loop-debate-chat-mode.md`、`.ch/docs/exec-plans/completed/2026-06-16-loop-debate-session-tabs.md` 相关规格：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`

## Related Runbooks

- None

## Watch Items

- 当前有 8 份 active plans。
- 存在 stale memory docs：`.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。

## Suggested Next Commands

- `python3 .agents/skills/memory-indexer/scripts/generate_memory_index.py`：当热区或开放事项变化后刷新基础 recall 面。
- `python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --anchor-id <mem-id>`：围绕某个 observation ID 生成 timeline window。
- `python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py`：当 recall 暴露出 promotion backlog 时继续做 consolidation。
- `python3 .agents/skills/memory-freshness-auditor/scripts/audit_memory_freshness.py`：当 recall 暴露 stale docs 或 attribution 缺口时继续做 freshness audit。
