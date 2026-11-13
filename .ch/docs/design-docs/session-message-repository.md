# SessionMessageRepository 的消息状态所有权

- 日期：2026-11-13
- 状态：已实现；验证限制见[执行计划](../exec-plans/completed/2026-11/2026-11-13-refactor-session-message-repository.md)。
- 范围：行为保持重构，沿用[每 Tab 永久清理设计](chat-bubble-retention.md)。

## 所有权与依赖方向

`createSessionLifecycleController` 创建一个 `createSessionMessageRepository` 实例。Repository 负责消息加载/保存、缓存访问、读取诊断访问、规范化顺序、Claude transcript 恢复调用、Grok 连续思考合并，以及私有 `Set<string>` / `WeakSet<ChatMessage[]>` 裁剪来源状态。

Repository 依赖 CLI / ChatMessage 类型、现有 sessionStore 底层函数、Grok 合并函数及错误格式化；健康更新、transcript 恢复和日志通过显式回调端口进入。它不导入 lifecycle、extension 或 Webview 宿主，不接收整个控制器依赖，不引入容器、继承或全局实例。`webview/types` 只有 type import。

Lifecycle 保持公开工厂的原参数和返回方法，继续管理 Tab/CLI/session/run 身份、会话摘要与记录、健康状态的宿主持久化、映射、过期清理调度和 UI 回执。删除 artifact 与全量/跨 workspace 文件清理的原流程也留在 lifecycle，缓存与标记移除通过 Repository 端口执行；因此文件删除日志、捕获边界、调用时机和映射操作不移动。

## 读写契约

缓存仍是既有参数传入的 Map，没有第二套缓存。每次操作通过回调读取当前 workspace，使用 `getSessionKey(activeWorkspaceKey(), cli, sessionId)`，不在创建时固定 workspace。缓存命中直接返回同一数组，并调用健康更新。

未命中时顺序为：

1. `readMessageFile`，沿用 loadErrors、错误详情和原事件，并从既有文件读取永久裁剪标记。
2. `sanitizeMessages(messages, cli)`。
3. 仅未永久裁剪的 Claude、没有 assistant/trace、且有非空 user 内容时调用原恢复端口。异常仍记录 `claude-session-recover-failed` 并回退规范化后的历史；成功记录原事件及计数。
4. Grok 使用既有 `collapseGrokConsecutiveThinkingMessages`。
5. 仅恢复/规范化/合并有变化时回写。回写失败仍使用已解析的结果，不改成读取错误。
6. 关联数组裁剪来源，设置缓存，然后更新健康。

普通保存保持另一种既有顺序：继承输入数组裁剪来源 → 规范化 → 关联规范化结果 → 更新健康 → 缓存 → 尝试写盘。返回值仍为 void。写失败由 sessionStore 记录 `session-messages-write-error`，内存和健康更新保留，loadErrors 不被清空或改写。回调接线通过闭包调用原 deps，保留原调用接收者与异常传播。

## 永久裁剪与迁移

Repository 不接受任意外部 Set/WeakSet，也不将集合暴露给 lifecycle。端口职责如下：

| 方法 | 职责 |
| --- | --- |
| `persistPrunedMessages` | 对已授权的剩余集合调用原写入函数，携带 `retentionPruned: true`，返回 boolean，不先动缓存或标记 |
| `markPrunedArray` | 在成功删除后记录一个原地修改数组的来源；草稿无磁盘会话时也使用此端口 |
| `inheritPruning` | 新数组从明确列出的来源数组继承裁剪来源，用于草稿拼接和 `mergeSessionMessages` 结果 |
| `rememberPrunedSession` | 成功删除后关联会话标记并缓存原 live 数组 |
| `evictSession` | 按显式 workspace 或当前 workspace 删除缓存及会话标记；只有过期清理传 `clearLoadError` |
| `clearCachedSessions` | 保持原 clear-all 范围：清 Map/Set，保留 WeakSet 来源及 loadErrors |

生命周期的 `pruneChatMessages` 继续检查 Tab/CLI/session 精确匹配、id+content 快照、用户消息、应保护的最终答复、活动消息及运行引用。持久化失败立即回执错误，原 stored/live/primary/runtime 数组和活动索引不动。写成功后由 lifecycle 原地压缩全部目标数组、记录来源、更新缓存及活动索引，再回执。Repository 不接管授权或 UI。

草稿绑定和本地会话迁移仍由 lifecycle 创建合并数组，显式调用 `inheritPruning`。保存时来源传播到会话键和规范化结果，磁盘标记由 sessionStore 原有 JSON 格式写入，重启读取后继续阻止 transcript 复活。没有额外序列化格式或裁剪业务规则副本。

## 兼容性证据与限制

静态 AST 核对公开工厂参数及返回类型与 HEAD 相同，三个迁出函数除健康回调限定外正文相同；sessionStore 和与平台失败有关的旧测试/模块未修改。

新增 12 个 Repository 行为测试使用系统临时目录及真实 sessionStore 序列化；保留全部 27 个原 lifecycle 集成用例，并增加写失败时四组独立数组/活动索引保护和缓存命中健康刷新两例。最终两文件测试 41/41 通过。sessionStore 检查 7/8 通过，其余 session 检查 235/237 通过；三个原用例在 Windows 上的权限或 mock 路径问题见执行计划，不声明全域绿灯。真实 transcript 解析、CLI、VS Code/Webview 手验、完整覆盖率及标准 build 未在本 attempt 验证。

业务概念、权限和磁盘协议保持不变；ontology 的 `pruneChatMessages` / `writeMessageFile` source_refs 仍存在，因此未修改共享 ontology、功能清单、ARCHITECTURE 或共享记忆。本独立文档承接实现所有权，供主任务按需协调架构入口。
