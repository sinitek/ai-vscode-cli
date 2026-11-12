# Observation Registry

这是 generated-only 的轻量 observation registry。它把热区、开放事项、风险、经验和 active plans 转成可按 ID 召回的结构化条目。

## mem-404964a44a - Loop 全 CLI 模型与思考力度路由修复

- Type: `plan`
- Topic: `plan`
- Read: ~44 tokens
- Source: `.ch/docs/exec-plans/active/2026-11-03-bugfix-loop-cli-model-routing.md`
- Source kind: `active_plan`
- Content hash: `404964a44a28c2e82f3218fb5f3805cfef0abe12dd14c175176f981cc6db34c4`
- Concepts: `active-risk`, `open-loop`, `problem-solution`
- Files: `../migrations/test-plan-removals/2026-11-11-nov-active.json`, `.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`, `2026-11-03-chore-loop-routing-live-acceptance-release.md`, `scripts/publish_vscode_extension.py`

Subtitle: Active execution plan

Facts:
- 日期：2026-11-03 类型：bugfix 状态：blocked 负责人：Codex
- Modified at: 2026-11-11T12:33:00+00:00

Narrative:

日期：2026-11-03 类型：bugfix 状态：blocked 负责人：Codex

## mem-85ae764cb4 - Loop routing live acceptance and 1.7.6 release gate

- Type: `plan`
- Topic: `plan`
- Read: ~50 tokens
- Source: `.ch/docs/exec-plans/active/2026-11-03-chore-loop-routing-live-acceptance-release.md`
- Source kind: `active_plan`
- Content hash: `85ae764cb473c69d8d5686fff8b51d8ad883e74cc826513af09daa951f86c547`
- Concepts: `active-risk`, `open-loop`
- Files: `../migrations/test-plan-removals/2026-11-11-nov-active.json`, `.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`, `2026-11-03-bugfix-loop-cli-model-routing.md`, `scripts/publish_vscode_extension.py`

Subtitle: Active execution plan

Facts:
- 日期：2026-11-03 类型：chore 状态：blocked 负责人：Codex
- Modified at: 2026-11-11T12:33:00+00:00

Narrative:

日期：2026-11-03 类型：chore 状态：blocked 负责人：Codex

## mem-c1d7e714b7 - 记忆流转规则

- Type: `rule`
- Topic: `rule`
- Read: ~39 tokens
- Source: `.ch/docs/MEMORY.md`
- Source kind: `memory_doc`
- Content hash: `c1d7e714b7e6c4976f0acfe2caff3fd8bfa441accb5b8b14f663d6735c3e709e`
- Concepts: `general`
- Files: `.ch/docs/generated/`, `.ch/docs/generated/memory-index/.local/`, `.ch/docs/ontology/`

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
