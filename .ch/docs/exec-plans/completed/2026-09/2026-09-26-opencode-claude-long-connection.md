# OpenCode / Claude 长连接复用

- 日期：2026-09-26
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：2026-09-26
- claim_ttl：本次实现

## 背景

Codex 已通过 `app-server` 复用长连接。OpenCode 1.18.32 与 Claude Code 2.1.283 需要先升级，再判断是否有同类模式。

## 目标

- 确认最新 CLI 的长连接形态。
- OpenCode 复用已有 `serve`，不再每次尝试启动后关闭。
- Claude 交互会话保持一条 streaming input 进程，停止时 interrupt。
- 新建会话悬停计数包含这三类存活进程。

## 范围

- `src/extensionHost/openCodeSubagentRuntime.ts`
- `src/interactive/claudePromptConnection.ts`
- `src/interactive/claudeRunner.ts`
- 计数、停用清理、相关测试和事实文档

## 非目标

- 不把 OpenCode 父任务事件流改写成 ACP。
- 不升级 `@anthropic-ai/claude-agent-sdk` 到 0.3。0.3 的 `prewarm` 仍是一次性 spare，不是多会话连接。
- 不使用 `claude --bg` / `attach`。那是终端后台会话，不是插件的结构化事件流。

## 验收标准

- [x] 相同 OpenCode 启动参数的第二次准备不重新 `startServer`，单次 `dispose` 不杀进程。
- [x] Claude 第二回合不第二次 `query()`，停止调用 `interrupt()` 且不 abort 进程。
- [x] 悬停计数是三类存活连接之和。
- [x] `npm run build` 与相关 `node --test` 通过。

## 影响面

- 代码目录：`src/interactive/`、`src/extensionHost/`、`src/sessionMessageHandlers.ts`、`src/extension.ts`
- 文档目录：`.ch/docs/references/`、`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`、`.ch/docs/ontology/`

## 风险与缓解

- 风险：Claude interrupt 后若 CLI 不发 result，下一条消息会等协议收口。
- 缓解：用户 promise 先按 AbortError 返回；result 到达后才放行下一条。进程退出时失败并在下一回合冷 `resume`。

## 验证计划

- 最小相关验证：Claude runner 与 OpenCode runtime 单测。
- 单元自测命令：`npm run build` 后运行对应 `node --test`。
- 扩展验证：不在本轮启动真实模型请求。

## 测试与清单同步

- 单元测试新增/更新：`src/test/interactive/claudeRunner.test.ts`、`src/test/extensionHost/extensionHostExtractionContracts.test.ts`
- 单元自测结果：`npm run build` 通过。`node --test dist/test/interactive/claudeRunner.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js` 21/21 通过。
- 失败处理记录：
- 功能清单：已更新长连接计数行
- 相关文档同步：runtime reference、design doc、capabilities、PITFALLS、ontology

## 任务列表

- [x] 升级 CLI 并核对帮助
- [x] 复用 OpenCode serve
- [x] 复用 Claude streaming input
- [x] 验证并归档

## 决策记录

- 2026-09-26：OpenCode 采用 `serve` 池，不引入 ACP 客户端。Claude 采用 SDK 0.2 streaming input，不升级到 0.3 `prewarm`。

## 当前结论

OpenCode 1.18.32 用 `serve` 池复用长连接，不改写成 ACP。Claude Code 2.1.283 用 SDK streaming input 保持单会话进程。`npm run build` 与 21 个相关单测通过。未对真实模型发请求。
