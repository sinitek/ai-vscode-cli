# Loop 任务 Tab 关闭与重置恢复

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：当前会话
- handoff_to：

## 背景

Loop 任务 Tab 在部分终止或状态不同步场景下仍会被关闭锁定。此时用户点击关闭不会生效；点击重置会话时，Webview 先清空本地视图，但扩展端因相同锁定条件拒绝重置，切回原 Tab 后旧会话又出现。

## 目标

让实际已结束或已失去运行所有权的任务 Tab 可以关闭和重置；真正仍在执行的 Loop 主任务继续保持关闭和重置保护；重置 UI 不再在扩展端拒绝后产生假成功视图。

## 范围

- 检查 Loop 任务持久化状态、运行时进程集合和 Tab 关闭锁的权威关系。
- 修复关闭与重置共用的错误锁定路径。
- 让重置会话在扩展端成功完成切换后再更新 Webview 视图。
- 添加覆盖关闭锁定与重置失败/成功状态的最小回归测试。

## 非目标

- 不改变正常运行中 Loop 主任务的队列、停止或子任务编排语义。
- 不删除旧会话历史，也不改变“重置会话”创建新空白 Tab 的产品定义。
- 不重构通用会话存储或 CLI runner。

## 验收标准

- [x] 已完成且无运行中 CLI 的任务 Tab 可以关闭。
- [x] 同一场景下重置会话会关闭旧 Tab 并进入新的空白 Tab，切换标签后不会恢复旧会话。
- [x] 正在运行的 Loop 主任务仍不能关闭或重置。
- [x] 扩展端拒绝重置时，Webview 不会先清空原会话视图。
- [x] 相关单元测试、TypeScript build 和 diff 检查通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/viewContentScript/`、`src/test/`，必要时新增窄范围纯函数模块。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/` 或本计划。
- 配置与脚本：无新增配置或依赖。

## 风险与缓解

- 风险：把短暂编排空档误判为结束，使运行中的任务可关闭。
- 缓解：保留活动运行集合和现有 Loop 生命周期保护，仅对可证明为残留的状态做收敛。
- 风险：前后端状态不同步仍导致用户看到错误空白页面。
- 缓解：重置动作以扩展端实际成功的 Tab 切换为准，Webview 不预先清除旧 Tab 状态。

## 验证计划

- 最小相关验证：任务运行控制状态、Tab 关闭锁、会话重置 UI 事件和会话 Tab 控制器回归测试。
- 单元自测命令：构建后执行对应 `dist/test/*.test.js`。
- 扩展验证：`npm run build`、相关 Node test、`git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：更新 `conversationTabLock.test.ts`，覆盖运行状态收敛后的 Tab 摘要与重置请求不再乐观清空；更新 `lobsterDebate.test.ts`，覆盖无运行所有权的持久化 `running` 记录识别。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/conversationTabLock.test.js dist/test/lobsterDebate.test.js dist/test/sessionMessageActions.test.js` 63/63 通过；`git diff --check` 通过。
- 失败处理记录：首次最小测试命令在构建产物尚未可见时报告缺少 `dist/test/conversationTabLock.test.js`；确认当前构建目录后重跑通过，未发现实现或测试断言缺陷。
- 功能清单：已新增“Loop 任务 Tab 状态收敛与会话重置一致性”条目。
- 相关文档同步：已更新 Loop 运行时设计、能力规格与 `PITFALLS.md`；CodeGraph 已同步并复核关键调用链。

## 任务列表

- [x] 确认残留 `running` 状态形成路径和关闭/重置的共用锁定条件。
- [x] 实现最小状态收敛和重置视图一致性修复。
- [x] 补充回归测试并执行相关验证。
- [x] 同步必要文档并归档计划。

## 决策记录

- 2026-07-13：关闭和重置以同一套任务运行所有权为准，避免前端显示空闲而扩展端静默拒绝的分歧。
- 2026-07-13：以当前 Extension Host 的主编排所有权和关联 CLI 运行集合共同保护编排空档；仅持久化 `running` 且无所有权的记录统一收敛为 `stopped`。
- 2026-07-13：重置会话保留编辑器上下文的下一次提示意图，但不再在扩展端确认前清空旧 Tab 的消息或切换交互模式。

## 当前结论

修复完成。`runLobsterPrompt` 现在显式维护 Loop 主编排所有权并在未捕获异常时将仍在运行的任务写入错误终态；Tab 状态构建发现持久化 `running` 已无任何当前运行所有权时，会将任务及其活跃子任务/辩论状态收敛为 `stopped`，从而解除关闭和重置锁。Webview 重置只发送请求，真实的新空白 Tab 和消息状态由扩展端成功后的回推建立，不再出现旧会话被暂时隐藏后又恢复的假成功。构建、63 条相关测试、差异检查和 CodeGraph 调用链复核均通过。
