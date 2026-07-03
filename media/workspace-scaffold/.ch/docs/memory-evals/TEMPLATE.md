---
doc_type: memory_eval_suite
suite: starter
status: draft
owner: team
last_reviewed_at: YYYY-MM-DD
---

# Memory Eval Suite Template

说明：把下面条目复制后按真实项目填写。每个条目都应该是手写、可审阅的 golden question，用来判断 recall 是否命中了正确来源。

## 使用约束

- `expected_source_paths` 优先写原始事实来源，不要写 generated eval 报告
- `focus` 尽量短，贴近真实任务入口
- `expected_observation_ids` 先留空也可以，等索引稳定后再补
- starter 模板不预置真实项目数据

## Questions

### q-001

- question: 这个仓库的长期记忆应该优先写到哪里，什么时候从 working 层上提？
- focus: memory flow rules
- expected_source_paths:
  - .ch/docs/MEMORY.md
  - .ch/docs/memory/PROJECT_CONTEXT.md
- expected_observation_ids: []
- notes: 检查 recall 是否先命中记忆规则和长期项目画像入口，而不是无关 generated 文档。

### q-002

- question: 开始复杂任务时，应该先读哪些低噪音记忆入口来恢复上下文？
- focus: bounded recall entry
- expected_source_paths:
  - .agents/skills/memory-recall/SKILL.md
  - .ch/docs/generated/memory-index/README.md
- expected_observation_ids: []
- notes: 检查 recall 是否优先命中 recall skill 说明和 generated memory index 的入口说明。

### q-003

- question: 哪些内容不应该进入 generated memory 产物或长期记忆索引？
- focus: privacy memory boundaries
- expected_source_paths:
  - .ch/docs/MEMORY.md
- expected_observation_ids: []
- notes: 检查 recall 是否能把 privacy / no-memory 规则拉回来。
