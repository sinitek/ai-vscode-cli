---
doc_type: memory_index_rules
scope: global
status: active
last_verified_at: 2026-08-29
source_of_truth: .ch/docs/memory/README.md
derived_from:
  - .ch/docs/MEMORY.md
supersedes: []
related_paths:
  - .ch/docs/generated/memory-index/
---

# 热区记忆面

这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。

这些文件应该比 `design-docs/`、`runbooks/`、`product-specs/` 更短、更稳定、更接近“本次和下次会话都先该知道什么”。

完整的记忆上提与清理规则见 `.ch/docs/MEMORY.md`。

## 文件分工

- `ROLLING_SUMMARY.md`：L1 滚动摘要。压缩较旧、分散但仍有跨会话价值的阶段信息。
- `EVENT_MEMORY.md`：L2 事件记忆。记录失败原因、成功方案、迁移/回滚/事故/关键决策等重要事件。
- `PROJECT_CONTEXT.md`：项目级稳定上下文。记录跨模块约束、关键路径、核心命令、长期有效的结构结论。
- `USER_PREFERENCES.md`：用户明确表达过、希望长期保持的协作和实现偏好。
- `PENDING_ITEMS.md`：跨会话未完成事项、明确承诺和后续跟进点。
- `LESSONS_LEARNED.md`：已验证、值得复用的经验与反模式结论。
- `ACTIVE_RISKS.md`：当前仍有效、尚未关闭的风险和观察点。

## 使用原则

- 热区记忆只保留**高密度、高复用、短时必须先读**的信息。
- 每条内容都应能指回更完整的事实来源，例如执行计划、设计文档、规格、runbook、代码路径。
- 不把长过程、长讨论、整段日志直接堆进这里；那些内容应回到原始文档。
- 失效、过期、已关闭的内容要尽快删除，或迁回原始文档归档，不让热区持续膨胀。
- 如果一条信息只适用于单次任务，不要写进热区，优先写到当前 `exec plan`。
- 如果一条信息已经从 L1/L2 上提到 L3/L4，应清理低层重复文本，只保留必要短链接。
- 长期记忆文档默认应带统一 front matter，具体字段见 `.ch/docs/MEMORY.md`。

## 体积控制

为了保证“先读成本”稳定，建议保持下面的上限：

- `ROLLING_SUMMARY.md`：不超过 10 条阶段摘要
- `EVENT_MEMORY.md`：不超过 30 条重要事件
- `PROJECT_CONTEXT.md`：不超过 20 条有效要点
- `USER_PREFERENCES.md`：不超过 15 条明确偏好
- `PENDING_ITEMS.md`：不超过 20 条开放事项
- `LESSONS_LEARNED.md`：不超过 20 条稳定经验
- `ACTIVE_RISKS.md`：不超过 15 条有效风险

超过上限时，应先合并、提炼或清理，而不是继续堆叠。

## 推荐阅读顺序

遇到复杂任务时，优先按下面顺序建立上下文：

1. `ROLLING_SUMMARY.md`
2. `EVENT_MEMORY.md`
3. `PROJECT_CONTEXT.md`
4. `USER_PREFERENCES.md`
5. `ACTIVE_RISKS.md`
6. `PENDING_ITEMS.md`
7. 再跳转到关联的 `exec-plans/`、`design-docs/`、`runbooks/`、`product-specs/`

## 与 skills 的关系

- 这些热区文件本身仍然是 Markdown 事实来源。
- 围绕它们的 recall、consolidation、freshness check 等流程，允许通过 `skills` 调用 `python3` 脚本来做结构化提取、校验和收口。
- 脚本的职责是提高效率和准确率，不替代人工可审阅的 Markdown 产物。
- 团队共享的默认召回压缩产物生成到 `.ch/docs/generated/memory-index/`；当前任务级 recall pack 默认写入 `.ch/docs/generated/memory-index/.local/`，不作为长期事实来源。
- `memory-indexer` 会从热区、active plans、pending items、active risks 和 lessons 生成 ID 化 observation registry，并估算读取成本。
- `memory-recall` 会先展示 observation index，再少量展开详情；需要前后文时可用 `--anchor-id <mem-id>` 生成 timeline window。

## 隐私边界

- 不允许进入长期记忆或 generated recall 面的内容，用 `<private>...</private>` 或 `<no-memory>...</no-memory>` 包裹。
- 整份文档不应被索引时，在 front matter 写 `memory_visibility: private` 或 `private: true`。
- 被隐私标签包裹的内容会被脚本剥离；不要在摘要、事实或来源字段中重新写入敏感内容。

## 与其他目录的边界

- `exec-plans/`：放任务推进过程、阶段状态、验证和下一步。
- `design-docs/`：放“为什么这样设计”的稳定决策。
- `runbooks/`：放可执行操作法、排障和长期规避动作。
- `product-specs/`：放业务目标、范围和验收。

热区记忆不是新的一层事实来源，而是这些事实来源的**受控入口面**。
