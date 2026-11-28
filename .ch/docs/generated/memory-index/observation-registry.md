# Observation Registry

这是 generated-only 的轻量 observation registry。它把热区、开放事项、风险、经验和 active plans 转成可按 ID 召回的结构化条目。

## mem-8f3107f15f - CLI 跨平台运行时策略收敛

- Type: `plan`
- Topic: `plan`
- Read: ~78 tokens
- Source: `.ch/docs/exec-plans/active/2026-11-24-refactor-cli-runtime-policy-convergence.md`
- Source kind: `active_plan`
- Content hash: `8f3107f15f76b52dc181023d06d38199c79338fd95730fc6b124770fcc241dc9`
- Concepts: `open-loop`, `decision`
- Files: `../../../../.agents/skills/vscode-extension-host-smoke/SKILL.md`, `.ch/docs/TESTING.md`, `.ch/docs/design-docs/cli-process-runtime.md`, `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/references/cli-runtime-reference.md`, `scripts/department_workspace_capacity_settings_smoke.cjs`, `scripts/loop_plus_acceptance_navigation_smoke.cjs`, `scripts/verify_codex_owned_native_drain.js --live`, `scripts/verify_zcode_runner_lifecycle.js --live`, `src/cli/cliProcessRuntime.ts`, `src/cli/cliRunArgStrategies.ts`, `src/cli/processArgv.ts`

Subtitle: Active execution plan

Facts:
- 日期：2026-11-24 类型：refactor 关联计划：无 状态：in-progress 负责人：协作 owner： claimed_at： claim_ttl： handoff_to：主任务 CLI 运行时策略收敛实现与验收
- Modified at: 2026-11-25T08:06:35+00:00

Narrative:

日期：2026-11-24 类型：refactor 关联计划：无 状态：in-progress 负责人：协作 owner： claimed_at： claim_ttl： handoff_to：主任务 CLI 运行时策略收敛实现与验收

## mem-707183a27e - Loop+ 主决策 JSON 格式诊断

- Type: `plan`
- Topic: `plan`
- Read: ~117 tokens
- Source: `.ch/docs/exec-plans/active/2026-11-25-bugfix-loop-plus-decision-json-diagnostics.md`
- Source kind: `active_plan`
- Content hash: `707183a27ec734a80653633625336d9ce3652f7ebd0acc1b28b030e5fd4bff88`
- Concepts: `open-loop`, `decision`, `problem-solution`, `source-linked`
- Files: `../../../../docs/LOOP_PLUS_DECISION_RELIABILITY.md`, `../../design-docs/loop-plus-scheduling.md#cli-输出与会话能力`, `../../design-docs/loop-plus-scheduling.md#协议失败后的自动续跑`, `../../design-docs/loop-plus-scheduling.md#状态感知决策形状`, `../../ontology/domains/cli-plugin-runtime.json`, `../../product-specs/FEATURE_INVENTORY.md#loop-协议失败自动续跑`, `.ch/docs/design-docs/`, `.ch/docs/exec-plans/active/`, `.ch/docs/exec-plans/completed/2026-11/2026-11-25-feature-loop-plus-subtask-acceptance-standards.md`, `.ch/docs/ontology/`, `.ch/docs/product-specs/`, `2026-11-24-refactor-cli-runtime-policy-convergence.md`

Subtitle: Active execution plan

Facts:
- 日期：2026-11-25 类型：bugfix 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-25-feature-loop-plus-subtask-acceptance-standards.md`（共同背景为 Loop+ 决策与交付可靠性；本计划区分拒绝类别并留存安全诊断，不更改独立验收责任） 状态：in-progress
- Modified at: 2026-11-27T05:26:19+00:00

Narrative:

日期：2026-11-25 类型：bugfix 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-25-feature-loop-plus-subtask-acceptance-standards.md`（共同背景为 Loop+ 决策与交付可靠性；本计划区分拒绝类别并留存安全诊断，不更改独立验收责任） 状态：in-progress

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

## mem-c1d7e714b7 - 记忆流转规则

- Type: `rule`
- Topic: `rule`
- Read: ~39 tokens
- Source: `.ch/docs/MEMORY.md`
- Source kind: `memory_doc`
- Content hash: `c1d7e714b7e6c4976f0acfe2caff3fd8bfa441accb5b8b14f663d6735c3e709e`
- Concepts: `general`
- Files: `.ch/docs/exec-plans/README.md`, `.ch/docs/generated/`, `.ch/docs/generated/memory-index/.local/`, `.ch/docs/ontology/`

Subtitle: operational_hot_zone / memory-rules

Facts:
- 这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**
- Source of truth: .ch/docs/MEMORY.md

Narrative:

这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**
