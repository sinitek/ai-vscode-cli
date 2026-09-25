# Observation Registry

这是 generated-only 的轻量 observation registry。它把热区、开放事项、风险、经验和 active plans 转成可按 ID 召回的结构化条目。

## mem-91b4245892 - 可维护性重构

- Type: `plan`
- Topic: `plan`
- Read: ~128 tokens
- Source: `.ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md`
- Source kind: `active_plan`
- Content hash: `91b42458921345a8fb0f503b28de7b5daf54f86bdd855f19fabe10c288a7e789`
- Concepts: `open-loop`
- Files: `.ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md`, `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `src/config/claudeSkills.ts`, `src/config/codexSkills.ts`, `src/config/geminiSkills.ts`, `src/config/skillDiscovery.ts`, `src/extension.ts`, `src/extensionHost/openCodePromptRunTemplate.ts`, `src/extensionHost/promptOneShotRuntime.ts`, `src/extensionHost/promptParallelRuntime.ts`, `src/extensionHost/promptRunRuntime.ts`, `src/loopPlusDecision.ts`

Subtitle: Active execution plan

Facts:
- 日期：2026-09-25 状态：completed 负责人：Codex owner： claimed_at： claim_ttl： 当前阶段：第 1–7 阶段完成。阶段 4、5、6 已在当前工作区落地并复核。阶段 7 只回写 `ARCHITECTURE.md` 与两份维护性文档，不改 `src`。 设计：`docs/MAINTAINABILITY_REFACTOR.md`。其中历史行号保留为锚点，并已注明工作区前移。本文件仍留在...
- Modified at: 2026-09-25T01:16:44+00:00

Narrative:

日期：2026-09-25 状态：completed 负责人：Codex owner： claimed_at： claim_ttl： 当前阶段：第 1–7 阶段完成。阶段 4、5、6 已在当前工作区落地并复核。阶段 7 只回写 `ARCHITECTURE.md` 与两份维护性文档，不改 `src`。 设计：`docs/MAINTAINABILITY_REFACTOR.md`。其中历史行号保留为锚点，并已注明工作区前移。本文件仍留在...

## mem-d3aa6ffe1b - 计划标题

- Type: `plan`
- Topic: `plan`
- Read: ~60 tokens
- Source: `.ch/docs/exec-plans/active/2026-09-25-loop-needs-review-tab-reopen.md`
- Source kind: `active_plan`
- Content hash: `d3aa6ffe1b112c0adce81307eb8f68aee1c38cc95b914b6d297867c0e15e7216`
- Concepts: `open-loop`
- Files: `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/runbooks/PITFALLS.md`, `src/extensionHost/promptRunRuntime.ts`, `src/panelDiagnostics.ts`

Subtitle: Active execution plan

Facts:
- 日期：2026-09-25 状态：completed 负责人：Codex / 人类 owner： claimed_at：2026-09-25 claim_ttl：本次会话
- Modified at: 2026-09-25T06:43:59+00:00

Narrative:

日期：2026-09-25 状态：completed 负责人：Codex / 人类 owner： claimed_at：2026-09-25 claim_ttl：本次会话

## mem-538cb1444d - Loop+ 完成事件驱动验收

- Type: `plan`
- Topic: `plan`
- Read: ~108 tokens
- Source: `.ch/docs/exec-plans/active/2026-09-24-loop-plus-mode.md`
- Source kind: `active_plan`
- Content hash: `538cb1444da9f28936a9f6222dbb52fc9bbeb208824f167d734e7e2f8d79c10b`
- Concepts: `open-loop`
- Files: `.ch/docs/MEMORY.md`, `.ch/docs/TESTING.md`, `.ch/docs/design-docs/TEMPLATE.md`, `.ch/docs/design-docs/graph-orchestration-mode.md`, `.ch/docs/design-docs/index.md`, `.ch/docs/design-docs/loop-debate-multi-agent-mode.md`, `.ch/docs/design-docs/loop-plus-scheduling.md`, `.ch/docs/design-docs/vscode-cli-extension-runtime.md`, `.ch/docs/exec-plans/README.md`, `.ch/docs/exec-plans/TEMPLATE.md`, `.ch/docs/exec-plans/completed/2026-09/`, `.ch/docs/exec-plans/completed/2026-09/2026-09-25-loop-plus-user-message-wake.md`

Subtitle: Active execution plan

Facts:
- 日期：2026-09-24 更新：2026-09-25 状态：in-progress 负责人：Codex owner：loopplus-plan-design（只维护本计划与候选设计；不代表功能已实现） claimed_at：2026-09-25 claim_ttl：保持到真实 Webview 场景被复核或本计划归档；占用不表示 Loop+ 已经可用
- Modified at: 2026-09-25T09:46:19+00:00

Narrative:

日期：2026-09-24 更新：2026-09-25 状态：in-progress 负责人：Codex owner：loopplus-plan-design（只维护本计划与候选设计；不代表功能已实现） claimed_at：2026-09-25 claim_ttl：保持到真实 Webview 场景被复核或本计划归档；占用不表示 Loop+ 已经可用

## mem-c1d7e714b7 - 记忆流转规则

- Type: `rule`
- Topic: `rule`
- Read: ~39 tokens
- Source: `.ch/docs/MEMORY.md`
- Source kind: `memory_doc`
- Content hash: `c1d7e714b7e6c4976f0acfe2caff3fd8bfa441accb5b8b14f663d6735c3e709e`
- Concepts: `general`
- Files: `.ch/docs/generated/`, `.ch/docs/ontology/`

Subtitle: operational_hot_zone / memory-rules

Facts:
- 这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**
- Source of truth: .ch/docs/MEMORY.md

Narrative:

这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**

## mem-431f2548e1 - 热区记忆面

- Type: `rule`
- Topic: `gotcha`
- Read: ~46 tokens
- Source: `.ch/docs/memory/README.md`
- Source kind: `memory_doc`
- Content hash: `431f2548e168fff0575bcb89614492ce054a6dae45f0abc5ea500b41f5381c1e`
- Concepts: `gotcha`
- Files: `.ch/docs/MEMORY.md`, `.ch/docs/generated/memory-index/`, `.ch/docs/generated/memory-index/.local/`

Subtitle: operational_hot_zone / hot-memory

Facts:
- 这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。
- Source of truth: .ch/docs/memory/README.md

Narrative:

这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。
