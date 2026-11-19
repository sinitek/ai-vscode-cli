# Observation Registry

这是 generated-only 的轻量 observation registry。它把热区、开放事项、风险、经验和 active plans 转成可按 ID 召回的结构化条目。

## mem-7525b245ac - Codex 组长大型原生回调私有 IPC 修复

- Type: `plan`
- Topic: `plan`
- Read: ~74 tokens
- Source: `.ch/docs/exec-plans/active/2026-11-18-bugfix-department-codex-large-callback.md`
- Source kind: `active_plan`
- Content hash: `7525b245acce85ca9a2092f9ba0f19a7039c95c70f1658ddff99569e0229e8b7`
- Concepts: `open-loop`, `problem-solution`
- Files: `src/test/runtime/departmentleadercallbackprotocol.test.ts`

Subtitle: Active execution plan

Facts:
- 日期：2026-11-18 类型：bugfix 状态：in-progress 负责人：Loop+ round-2 coding attempt 关联计划：无；父任务本轮另有独立 scripts 宿主验证交付。
- Modified at: 2026-11-19T04:25:33+00:00

Narrative:

日期：2026-11-18 类型：bugfix 状态：in-progress 负责人：Loop+ round-2 coding attempt 关联计划：无；父任务本轮另有独立 scripts 宿主验证交付。

## mem-52c8a09d98 - Loop+ 启动前配置锁超时后显式继续

- Type: `plan`
- Topic: `plan`
- Read: ~52 tokens
- Source: `.ch/docs/exec-plans/active/2026-11-18-bugfix-loop-plus-config-lock-resume.md`
- Source kind: `active_plan`
- Content hash: `52c8a09d98d32ff277973ae865e12a228765c500ca550f754ed68690bfcd411c`
- Concepts: `open-loop`, `problem-solution`

Subtitle: Active execution plan

Facts:
- 日期：2026-11-18 类型：bugfix 状态：in-progress 负责人：Codex（本次执行）；主任务负责验收
- Modified at: 2026-11-19T04:25:33+00:00

Narrative:

日期：2026-11-18 类型：bugfix 状态：in-progress 负责人：Codex（本次执行）；主任务负责验收

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
