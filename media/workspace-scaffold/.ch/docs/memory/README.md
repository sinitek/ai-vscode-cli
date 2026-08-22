---
doc_type: memory_hot_zone
scope: global
status: active
last_verified_at: template-fill-when-adopted
source_of_truth: .ch/docs/memory/README.md
derived_from:
  - .ch/docs/MEMORY.md
supersedes: []
related_paths:
  - .ch/docs/MEMORY.md
---

# 热区记忆面

这里放默认优先召回的短记忆，目的不是替代执行计划、规格、架构或测试记录，而是避免每次都从全仓文档冷启动。

完整的记忆上提与清理规则见 `.ch/docs/MEMORY.md`。

## 文件分工

- `ROLLING_SUMMARY.md`：L1 滚动摘要，压缩仍有跨会话价值的阶段信息。
- `EVENT_MEMORY.md`：L2 事件记忆，记录失败原因、成功方案、迁移、回滚、事故和关键决策。
- `PROJECT_CONTEXT.md`：L3 项目上下文，记录跨模块约束、关键路径、核心命令和长期有效结构结论。
- `USER_PREFERENCES.md`：L3 用户偏好，记录用户明确表达并希望长期保持的协作和实现偏好。
- `PENDING_ITEMS.md`：开放事项，记录跨会话未完成承诺和后续跟进点。
- `LESSONS_LEARNED.md`：L4 经验教训，记录已验证、值得复用的经验与长期规避动作。
- `ACTIVE_RISKS.md`：有效风险，记录当前仍未关闭的风险和观察点。

## 使用原则

- 热区只保留高密度、高复用、短时必须先读的信息。
- 每条内容都应指回更完整的事实来源，例如执行计划、规格、架构、测试或代码路径。
- 不把长过程、长讨论、整段日志直接堆进这里。
- 失效、过期、已关闭的内容要及时删除、归档到计划，或标记为 `superseded`。
- 如果一条信息只适用于单次任务，优先写到当前执行计划。
- 如果一条信息已经上提到稳定规则、规格或 skill，应清理热区重复文本，只保留必要短链接。

## 体积控制

建议保持下面上限：

- `ROLLING_SUMMARY.md`：不超过 10 条阶段摘要
- `EVENT_MEMORY.md`：不超过 30 条重要事件
- `PROJECT_CONTEXT.md`：不超过 20 条有效要点
- `USER_PREFERENCES.md`：不超过 15 条明确偏好
- `PENDING_ITEMS.md`：不超过 20 条开放事项
- `LESSONS_LEARNED.md`：不超过 20 条稳定经验
- `ACTIVE_RISKS.md`：不超过 15 条有效风险

超过上限时，应先合并、提炼或清理，而不是继续堆叠。

## 推荐阅读顺序

复杂任务先按下面顺序建立上下文：

1. `ROLLING_SUMMARY.md`
2. `EVENT_MEMORY.md`
3. `PROJECT_CONTEXT.md`
4. `USER_PREFERENCES.md`
5. `ACTIVE_RISKS.md`
6. `PENDING_ITEMS.md`
7. 相关 `exec-plans/`、`product-specs/`、`ARCHITECTURE.md` 或规则文档

## 隐私边界

- 不允许进入长期记忆的内容，用 `<private>...</private>`、`<no-memory>...</no-memory>` 或 `<memory-private>...</memory-private>` 包裹。
- 整份文档不应被长期复用时，在 front matter 写 `memory_visibility: private` 或 `private: true`。
- 不要把密钥、令牌、生产地址、客户数据或运行时实例数据写入仓库。

## 与其他入口的边界

- `exec-plans/`：任务推进过程、阶段状态、验证和下一步。
- `product-specs/`：业务目标、范围、角色和验收。
- `ARCHITECTURE.md`：稳定架构、分层边界和扩展规则。
- `.ch/docs/TESTING.md`：测试规则和失败分流。
- `.ch/docs/SECURITY.md`：安全与可靠性规则。

热区记忆不是新的事实来源层级，而是这些事实来源的受控入口面。
