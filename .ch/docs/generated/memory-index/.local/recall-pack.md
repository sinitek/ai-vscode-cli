# Memory Recall Pack

## Summary

- Generated at: 2026-09-24T22:41:21Z
- Focus: Loop+ 子任务结束后关闭 tab
- Anchor ID: -
- Selection mode: focus-filtered
- Available observation entries: 3
- Available read cost: ~193 tokens
- Selected index entries: 1 (~108 tokens if fully expanded)
- Expanded entries in this pack: 1 (~108 tokens)
- Generated recall surfaces: 9
- Hot-zone docs: 2
- Active plans: 1
- Related design docs: 4
- Related runbooks: 1
- Source diversity: 1 unique sources / 1 selected observations
- Retrieval debug: `.ch/docs/generated/memory-index/.local/retrieval-debug.md`

## Progressive Disclosure

1. 先扫下面的 Observation Index，确认哪些 ID 值得展开。
2. 只读取 Expanded Observation Details 中少量最高优先级条目。
3. 如果需要更多细节，再按 ID 打开 `observation-registry.md` 或 `observations.jsonl`。
4. 如果需要上下文顺序，用 `timeline.md` 或重新运行 `--anchor-id <id>`。

## Focus Match Summary

- Matched terms: `loop`

## Observation Index

| ID | Type | Title | Read | Source | Why |
| --- | --- | --- | --- | --- | --- |
| `mem-538cb1444d` | `plan` | Loop+ 完成事件驱动验收 | ~108 | `.ch/docs/exec-plans/active/2026-09-24-loop-plus-mode.md` | 命中 focus：loop。 |

## Expanded Observation Details

### mem-538cb1444d - Loop+ 完成事件驱动验收

- Type: `plan`
- Topic: `plan`
- Read: ~108 tokens
- Source: `.ch/docs/exec-plans/active/2026-09-24-loop-plus-mode.md`
- Score: `93` (base `91`)
- Matches: `loop`
- Score breakdown: type_priority=68, focus_terms=12, open_loop_bonus=0, read_cost_adjustment=2, evidence_bonus=6, concept_bonus=1, topic_bonus=2, source_diversity_bonus=2, claim_bonus=0, same_source_penalty=0
- Concepts: `open-loop`
- Files: `.ch/docs/MEMORY.md`, `.ch/docs/TESTING.md`, `.ch/docs/design-docs/TEMPLATE.md`, `.ch/docs/design-docs/graph-orchestration-mode.md`, `.ch/docs/design-docs/index.md`, `.ch/docs/design-docs/loop-debate-multi-agent-mode.md`, `.ch/docs/design-docs/loop-plus-scheduling.md`, `.ch/docs/design-docs/vscode-cli-extension-runtime.md`

Facts:
- 日期：2026-09-24 更新：2026-09-25 状态：in-progress 负责人：Codex owner：loopplus-plan-design（只维护本计划与候选设计；不代表功能已实现） claimed_at：2026-09-25 claim_ttl：保持到真实 Webview 场景被复核或本计划归档；占用不表示 Loop+ 已经可用
- Modified at: 2026-09-24T22:41:21+00:00

Narrative:

日期：2026-09-24 更新：2026-09-25 状态：in-progress 负责人：Codex owner：loopplus-plan-design（只维护本计划与候选设计；不代表功能已实现） claimed_at：2026-09-25 claim_ttl：保持到真实 Webview 场景被复核或本计划归档；占用不表示 Loop+ 已经可用

## Recommended Reading Order

1. `recall-index.md` / 本文件的 Observation Index。
2. 本文件的 Expanded Observation Details。
3. `open-loops.md` 和 `freshness-report.md`。
4. 再看相关 active plans，确认 working-layer 目标、任务列表和验证计划。
5. 如果提供了 focus，再展开匹配到的 design docs 和 runbooks。

## Generated Recall Surfaces

- `.ch/docs/generated/memory-index/.local/recall-index.md` | Recall Index
  Why: ID 化 observation 索引，优先扫描标题、类型、来源和读取成本。
  Summary: 渐进披露第一层：只看有什么和读取成本。

- `.ch/docs/generated/memory-index/.local/retrieval-debug.md` | Retrieval Debug
  Why: 解释 lexical recall 的 matched terms、打分和多样性重排。
  Summary: 评测和审阅优先看这里，不替代原始事实来源。

- `.ch/docs/generated/memory-index/.local/observation-registry.md` | Observation Registry
  Why: 按 ID 展开 observation facts / narrative / source。
  Summary: 渐进披露第二层：只展开已经筛选过的 ID。

- `.ch/docs/generated/memory-index/.local/open-loops.md` | Open Loops
  Why: 当前存在开放事项、活跃风险或 active plans，需要先看 open loops。
  Summary: 集中看 pending items、active risks 和 active plan 计数。

- `.ch/docs/generated/memory-index/.local/claim-registry.md` | Claim Registry
  Why: 当前 observation 已经可关联到 claim 级证据，可直接检查状态和来源。
  Summary: claim-aware recall 的证据补充层，不替代原始事实来源。

- `.ch/docs/generated/memory-index/.local/timeline.md` | Memory Timeline
  Why: 围绕 ID 或时间顺序恢复前后文。
  Summary: 按 modified/source 顺序排列 observation entries。

- `.ch/docs/generated/memory-index/.local/freshness-report.md` | Freshness Report
  Why: 当前热区记忆存在 stale 项，需要先确认哪些内容仍可信。
  Summary: 检查哪些 memory docs 已过期或需要再核验。

- `.ch/docs/generated/memory-index/.local/topic-corpus.md` | Topic Corpus
  Why: 按 topic 聚合可复用知识，便于后续 reference pack。
  Summary: 专题 corpus 起点，不替代原始事实来源。

- `.ch/docs/generated/memory-index/.local/index.md` | Memory Index
  Why: 热区记忆、开放事项和当前计划的低噪音总入口。
  Summary: 默认先读的 generated 记忆索引入口。

## Hot-Zone Docs

- `.ch/docs/memory/README.md` | 热区记忆面
  Why: 热区边界和阅读顺序入口。
  Summary: 这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。

- `.ch/docs/MEMORY.md` | 记忆流转规则 | matches=任务
  Why: 记忆分层与流转规则入口。
  Summary: 这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**

## Active Plans

- `.ch/docs/exec-plans/active/2026-09-24-loop-plus-mode.md` | Loop+ 完成事件驱动验收 | matches=loop
  Why: 当前任务推进中的 working-layer 事实来源。
  Summary: 日期：2026-09-24 更新：2026-09-25 状态：in-progress 负责人：Codex owner：loopplus-plan-design（只维护本计划与候选设计；不代表功能已实现） claimed_at：2026-09-25 claim_ttl：保持到真实 Webview 场景被复核或本计划归档；占用不表示 Loop+ 已经可用

## Related Design Docs

- `.ch/docs/design-docs/loop-debate-multi-agent-mode.md` | Loop 红蓝辩论多智能体模式详细设计 | matches=loop, 子任, 任务
  Why: 与当前 focus 相关的设计决策入口，命中：loop / 子任 / 任务。
  Summary: 状态：active 相关计划：`.ch/docs/exec-plans/completed/2026-06/2026-06-16-loop-debate-chat-mode.md`、`.ch/docs/exec-plans/completed/2026-06/2026-06-16-loop-debate-session-tabs.md`

- `.ch/docs/design-docs/loop-plus-scheduling.md` | Loop+ 完成事件调度 | matches=loop, 子任, 任务, 务结, 结束
  Why: 与当前 focus 相关的设计决策入口，命中：loop / 子任 / 任务 / 务结 / 结束。
  Summary: 状态：proposed 相关计划：`.ch/docs/exec-plans/active/2026-09-24-loop-plus-mode.md` 相关规格：尚无。落地前不要写入 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

- `.ch/docs/design-docs/vscode-cli-extension-runtime.md` | VS Code CLI 插件运行时架构 | matches=loop, 子任, 任务
  Why: 与当前 focus 相关的设计决策入口，命中：loop / 子任 / 任务。
  Summary: 状态：accepted 相关目录：`src/`、`media/`、`docs/` 历史来源：原 `docs/支持交互.md`、`docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md`

- `.ch/docs/design-docs/graph-orchestration-mode.md` | Graph 编排模式详细设计 | matches=loop, 子任, 任务, 结束, 束后
  Why: 与当前 focus 相关的设计决策入口，命中：loop / 子任 / 任务 / 结束 / 束后。
  Summary: 状态：active（Phase 2 恢复与交互增强已落地，direct 自动返工已落地） 日期：2026-08-03 相关计划：`.ch/docs/exec-plans/completed/2026-07/2026-07-23-graph-orchestration-mode.md` 相关规格：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`

## Related Runbooks

- `.ch/docs/runbooks/local-development.md` | 本地开发与打包手册 | matches=loop, 子任, 任务
  Why: 与当前 focus 相关的排障或规避动作入口，命中：loop / 子任 / 任务。
  Summary: 本文档吸收了原 `docs/DEBUG.md`、`docs/DEVELOPMENT.md` 以及旧开发手册中仍有效的运行方式，作为当前仓库的本地开发 runbook。

## Watch Items

- 当前有 1 份 active plans。
- 存在 stale memory docs：`.ch/docs/MEMORY.md`。
- 这些热区文件仍是 starter 占位：`.ch/docs/memory/ACTIVE_RISKS.md`、`.ch/docs/memory/EVENT_MEMORY.md`、`.ch/docs/memory/LESSONS_LEARNED.md`、`.ch/docs/memory/PENDING_ITEMS.md`、`.ch/docs/memory/PROJECT_CONTEXT.md`。

## Suggested Next Commands

- `python3 .agents/skills/memory-indexer/scripts/generate_memory_index.py`：当热区或开放事项变化后刷新基础 recall 面。
- `python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --anchor-id <mem-id>`：围绕某个 observation ID 生成 timeline window。
- `python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py`：当 recall 暴露出 promotion backlog 时继续做 consolidation。
- 手动复核 freshness 字段和 attribution 缺口：当 recall 暴露 stale docs 或来源缺口时，直接修正对应事实来源并刷新 memory index。
