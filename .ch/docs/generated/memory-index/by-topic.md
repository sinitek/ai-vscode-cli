# By Topic

按热区主题列出当前记忆入口、关键小节、直接引用路径和 observation ID。

## 记忆流转规则

- 路径：`.ch/docs/MEMORY.md`
- 分类：`memory-rules`
- 金字塔层级：`operational_hot_zone`
- 状态：`active`
- Freshness：`stale`
- Read：~19 tokens
- 摘要：这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**
- Observation IDs：`mem-c1d7e714b7`
- Source of truth：`.ch/docs/MEMORY.md`
- 小节：`记忆流转规则`, `1. 四层记忆`, `1.1 记忆金字塔`, `2. 默认写入规则`, `2.1 当前任务事实`, `2.2 跨会话仍要先读的信息`
- 直接引用：`.ch/docs/generated/`, `.ch/docs/handoffs/`

## 活跃风险

- 路径：`.ch/docs/memory/ACTIVE_RISKS.md`
- 分类：`hot-memory`
- 金字塔层级：`operational_hot_zone`
- 状态：`active`
- Freshness：`starter`
- Read：~15 tokens
- 摘要：这个文件只记录**当前仍有效**、且在后续任务中需要优先留意的风险。
- Source of truth：`.ch/docs/memory/ACTIVE_RISKS.md`
- 小节：`活跃风险`, `什么时候更新`, `不该写什么`, `维护规则`, `当前风险`

## 事件记忆

- 路径：`.ch/docs/memory/EVENT_MEMORY.md`
- 分类：`memory-pyramid`
- 金字塔层级：`L2 event_memory`
- 状态：`active`
- Freshness：`starter`
- Read：~20 tokens
- 摘要：这个文件是记忆金字塔的 **L2**：从滚动摘要、handoff、执行计划和 runbook 中抽取重要事件。
- Source of truth：`.ch/docs/memory/EVENT_MEMORY.md`
- 小节：`事件记忆`, `什么时候更新`, `不该写什么`, `维护规则`, `当前事件`

## 经验教训

- 路径：`.ch/docs/memory/LESSONS_LEARNED.md`
- 分类：`hot-memory`
- 金字塔层级：`L4 procedural_experience`
- 状态：`active`
- Freshness：`starter`
- Read：~14 tokens
- 摘要：这个文件只记录**已经验证、值得重复使用或长期规避**的经验结论。
- Source of truth：`.ch/docs/memory/LESSONS_LEARNED.md`
- 小节：`经验教训`, `什么时候更新`, `不该写什么`, `写法要求`, `当前经验`

## 未完成事项

- 路径：`.ch/docs/memory/PENDING_ITEMS.md`
- 分类：`hot-memory`
- 金字塔层级：`operational_hot_zone`
- 状态：`active`
- Freshness：`starter`
- Read：~14 tokens
- 摘要：这个文件只保留**跨会话仍然开放**、且需要后续继续跟进的事项。
- Source of truth：`.ch/docs/memory/PENDING_ITEMS.md`
- 小节：`未完成事项`, `什么时候更新`, `不该写什么`, `维护规则`, `当前开放事项`

## 项目上下文

- 路径：`.ch/docs/memory/PROJECT_CONTEXT.md`
- 分类：`hot-memory`
- 金字塔层级：`L3 project_profile`
- 状态：`active`
- Freshness：`starter`
- Read：~15 tokens
- 摘要：这个文件只保留**跨会话优先需要知道**、且相对稳定的项目级事实。
- Source of truth：`.ch/docs/memory/PROJECT_CONTEXT.md`
- 小节：`项目上下文`, `什么时候更新`, `不该写什么`, `建议结构`, `项目目标`, `关键路径`

## 热区记忆面

- 路径：`.ch/docs/memory/README.md`
- 分类：`hot-memory`
- 金字塔层级：`operational_hot_zone`
- 状态：`active`
- Freshness：`stale`
- Read：~18 tokens
- 摘要：这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。
- Observation IDs：`mem-431f2548e1`
- Source of truth：`.ch/docs/memory/README.md`
- 小节：`热区记忆面`, `文件分工`, `使用原则`, `体积控制`, `推荐阅读顺序`, `与 skills 的关系`
- 直接引用：`.ch/docs/MEMORY.md`, `.ch/docs/generated/memory-index/`

## 滚动摘要

- 路径：`.ch/docs/memory/ROLLING_SUMMARY.md`
- 分类：`memory-pyramid`
- 金字塔层级：`L1 rolling_summary`
- 状态：`active`
- Freshness：`starter`
- Read：~22 tokens
- 摘要：这个文件是记忆金字塔的 **L1**：把较旧、分散、但下一轮仍可能需要的 working / episodic 信息压缩成短摘要。
- Source of truth：`.ch/docs/memory/ROLLING_SUMMARY.md`
- 小节：`滚动摘要`, `什么时候更新`, `不该写什么`, `维护规则`, `当前滚动摘要`

## 用户偏好

- 路径：`.ch/docs/memory/USER_PREFERENCES.md`
- 分类：`hot-memory`
- 金字塔层级：`L3 user_profile`
- 状态：`active`
- Freshness：`starter`
- Read：~15 tokens
- 摘要：这个文件只记录**用户明确表达过**、且希望长期保持的协作或实现偏好。
- Source of truth：`.ch/docs/memory/USER_PREFERENCES.md`
- 小节：`用户偏好`, `什么时候更新`, `不该写什么`, `建议结构`, `编码偏好`, `验证偏好`
