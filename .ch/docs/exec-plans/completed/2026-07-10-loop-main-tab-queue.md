# Loop 主任务 Tab 队列约束修复

- 日期：2026-07-10
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-10
- claim_ttl：本次会话
- handoff_to：无

## 背景

Loop 主任务 tab 已按持久化任务状态持续展示运行态，但提示词提交和队列出队仍只判断当前 AI/CLI 进程。编排空档中没有活动进程时，新提示词会绕过队列直接启动新任务；阶段性进程结束时，已排队提示词也可能提前出队。

## 目标

让 Loop 主任务 tab 的提示词提交、手动继续队列和自动出队统一遵守 Loop 任务生命周期状态。

## 范围

- Webview 中统一 tab 忙碌判定，并让运行中的 Loop 主任务新提示词直接入队。
- 扩展侧向 tab 状态补充 Loop 任务终态，并在 Loop 编排结束后刷新面板状态。
- 仅在 Loop 任务成功完成后自动继续该 tab 的队列。
- 补充回归测试并同步产品与运行时文档。

## 非目标

- 不改变普通 Vibe tab 和 Loop 子任务 tab 的“加入队列 / 暂停并发送”交互。
- 不迁移或持久化现有仅存在于 Webview 内存中的提示词队列。
- 不调整 Loop 主任务、子任务或辩论编排协议。

## 验收标准

- [x] Loop 主任务记录为 `running` 时，新提示词不直接派发，自动加入当前 tab 队列。
- [x] Loop 主任务仍在运行时，自动出队和“继续执行队列”均被阻止。
- [x] Loop 主任务变为 `completed` 后自动发送队首提示词；失败、停止或人工复核时保留队列。
- [x] 普通运行中 tab 继续显示原有冲突弹窗，空闲 tab 继续直接发送。
- [x] 相关单测、TypeScript build 和 diff 检查通过。

## 影响面

- 代码目录：`src/sessionTabs.ts`、`src/extension.ts`、`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`
- 配置与脚本：无新增配置；沿用 `npm run build` 和 Node test runner

## 风险与缓解

- 风险：阶段性 `runStatus=end` 导致队列过早出队。
- 缓解：出队统一检查包含持久化 Loop 状态的 tab 忙碌判定。
- 风险：任务失败后错误自动继续队列。
- 缓解：tab 状态显式携带 Loop 任务状态，仅 `running -> completed` 触发自动继续。
- 风险：完成状态刷新晚于最后一个 CLI 进程结束。
- 缓解：`runLobsterPrompt` 返回后强制刷新 PanelState。

## 验证计划

- 最小相关验证：`node --test dist/test/conversationTabLock.test.js dist/test/loopPromptQueue.test.js dist/test/sessionMessageActions.test.js`
- 单元自测命令：同上
- 扩展验证：`npm run build`、`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/loopPromptQueue.test.ts`，覆盖 Loop 主 tab 自动入队、忙碌门禁、后台模式保留、完成终态自动出队和编排终态刷新；更新 tab 运行态测试。
- 单元自测结果：`node --test dist/test/conversationTabLock.test.js dist/test/loopPromptQueue.test.js dist/test/sessionMessageActions.test.js` 26/26 通过；`npm run build` 通过。
- 失败处理记录：全量 `node --test dist/test/*.test.js` 为 378/401 通过。22 个失败来自没有对应 `src/test` 的陈旧 `dist/test/lobsterBoundaryRecord.test.js`；另 1 个失败来自 `dist/test/configService.test.js` 对配置页旧标题“OpenAI-compatible 网关范例”的历史断言。失败集合与本次修改前的仓库基线一致，未为通过测试改动范围外代码。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新能力事实来源和 VS Code 扩展运行时设计。

## 任务列表

- [x] 定位持久化运行态与短生命周期运行态不一致的根因。
- [x] 实现 Loop 主任务提交与队列状态机约束。
- [x] 补充回归测试并同步文档。
- [x] 执行验证、记录结果并归档计划。

## 决策记录

- 2026-07-10：Loop 主任务生命周期运行中时，新提示词直接入队，不允许通过“暂停并发送”启动并行的新 Loop 任务。
- 2026-07-10：自动继续队列只接受明确的 `completed` 终态，其他终态保留队列。
- 2026-07-10：队列条目保存入队时的 coding / Loop 模式，避免后台 tab 自动出队时错误降为 coding。
- 2026-07-10：PanelState 的终态刷新放在 `runLobsterPrompt` 编排边界，覆盖对话提交、群聊继续和子任务续跑唤醒主任务等全部入口。

## 当前结论

修复完成。Webview 现在统一使用包含持久化 Loop 状态的 tab 忙碌判定；运行中的 Loop 主 tab 新提示词直接入队，阶段性进程结束不会提前出队，明确完成后才自动继续。失败、停止和人工复核保留队列，后台 tab 出队保留原始交互模式。相关测试、build、diff 检查和文档同步均已完成；全量测试仅保留已分类的 23 个历史基线失败。
