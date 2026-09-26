# Codex app-server 长连接复用

- 日期：2026-09-26
- 状态：completed
- 负责人：Codex
- owner：codex-app-server-reuse
- claimed_at：2026-09-26
- claim_ttl：本次实现完成并归档

## 背景

每个 Codex 回合都新起 `codex app-server`，重复 `initialize` 和 `thread/start` / `thread/resume`。后者会重载 config、创建 session、固定 MCP profile 并 websocket prewarm。Loop 子任务重试还会新建 tab，再次冷启动。

## 目标

- 同一条 app-server 连接只 `initialize` 一次。
- 已加载 thread 的后续回合只发 `turn/start`。
- provider、工作区、启动参数或进程退出后才冷启动并 `thread/resume`。
- 停止已加载回合时发 `turn/interrupt`，不杀进程。
- Loop 子任务重试复用原 tab / thread。

## 范围

- `src/interactive/codexAppServerPool.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/manager.ts`
- `src/extensionHost/loopOrchestration.ts`
- 相关单测与运行时文档

## 非目标

- 不把 Loop 子任务并进父 thread。
- 不改变 OpenCode / Claude 的执行方式。
- 不在已订阅的热 thread 上靠 `thread/resume` 覆盖 provider。

## 验收标准

- [x] 同一 runner 的第二回合不再 spawn，且不再发送 `initialize` / `thread/start` / `thread/resume`。
- [x] 两个相同启动参数的 runner 共享一次 `initialize`，各自 `thread/start` 一次。
- [x] 已加载 thread 上停止会发送 `turn/interrupt` 且不 SIGTERM。
- [x] 冷启动阶段停止仍终止进程。
- [x] Loop 子任务重试不新建 tab。
- [x] 模型变化仍复用 runner；配置档案、cwd、multi-agent 变化仍更换 runner。

## 影响面

- 代码目录：`src/interactive/`、`src/extensionHost/loopOrchestration.ts`
- 文档目录：`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/runbooks/PITFALLS.md`

## 风险与缓解

- 风险：热 thread 上 `thread/resume` 的 override 会被 app-server 忽略。
- 缓解：provider 进入连接键；变化时换进程再冷 `thread/resume`。模型、effort、cwd、sandbox、approval 继续走 `turn/start`。
- 风险：多 runner 共用 stdio 时子线程事件串线。
- 缓解：按 `threadId` / `parentThreadId` 路由，未归属事件先缓冲。

## 验证计划

- 最小相关验证：`npm run build` 后跑 Codex runner、thread selection、Loop orchestration 相关单测。
- 单元自测命令和结果见下方「测试与清单同步」。未做真实 `codex` CLI 手工回合计时。

## 任务列表

- [x] 会话级长连接与 turn/start 复用
- [x] 子任务共享连接，重试复用 thread
- [x] 测试与文档

## 决策记录

- 2026-09-26：连接键包含命令、app-server 参数、cwd、CODEX_HOME、modelProvider。已加载 thread 不因模型变化而 resume。

## 测试与清单同步

- 单元测试新增/更新：`src/test/interactive/codexRunnerReuse.test.ts`，并更新 lifecycle / thread selection / prompt runtime mock。
- 单元自测结果：`npm run build` 通过。`node --test dist/test/interactive/codexRunnerLifecycle.test.js dist/test/interactive/codexRunnerReuse.test.js dist/test/interactive/codexRunnerSubagent.test.js dist/test/interactive/codexAppServerNdjson.test.js dist/test/interactive/codexThreadSelection.test.js dist/test/loop/loopSubtaskLifecycle.test.js dist/test/loop/loopSubtaskProgress.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/core/contextCompactionRunner.test.js` 58 项里 57 通过；失败的 provider resume 断言已改为包含 `model_reasoning_summary=detailed`，复跑 lifecycle / reuse / subagent 16 项通过。
- 失败处理记录：provider 断言过期，不是本次连接复用引入的行为错误。
- 功能清单：已更新 Codex thread 续接描述。
- 相关文档同步：CLI reference、运行时设计、capabilities、PITFALLS。

## 当前结论

长连接复用已落地。未做真实 `codex` CLI 的手工回合计时。

