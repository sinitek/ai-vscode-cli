# Observation Registry

这是 generated-only 的轻量 observation registry。它把热区、开放事项、风险、经验和 active plans 转成可按 ID 召回的结构化条目。

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
