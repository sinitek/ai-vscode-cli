# OpenCode 与 Codex 子代理流式气泡

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：1 day
- handoff_to：

## 背景

OpenCode `run --format json` 主要转发父会话事件，父会话等待内部子代理时可能长时间没有新的对话气泡。Codex App Server 已携带子线程 `threadId` 与协作代理生命周期，但当前 runner 忽略线程归属，导致子代理输出可能并入主助手气泡，子线程完成事件也可能干扰父任务收口。

## 目标

为 OpenCode 与 Codex 提供统一的独立子代理 AI 气泡：子代理开始后立即可见，新增文本持续更新到对应气泡，完成、失败或中断状态明确；OpenCode 即使实时事件遗漏，也至少每 60 秒从本地运行服务补捞一次。

## 范围

- 通用子代理气泡状态与增量更新逻辑。
- OpenCode 本地运行服务端口、事件订阅、父子会话发现、消息快照与 60 秒轮询兜底。
- OpenCode one-shot 与并行 tab 两条运行链路。
- Codex App Server 子线程 delta、协作代理生命周期和子线程完成事件分流。
- 对话 Webview 对并发、交错子代理气泡的定向增量更新。
- 中英文文案、回归测试、运行时与产品能力文档。

## 非目标

- 不直接读取 OpenCode 私有 SQLite 数据库。
- 不展示子代理 reasoning、完整工具输入或敏感内部事件；只展示可见助手文本与生命周期。
- 不改变现有模型、provider、权限或自动重试策略。
- 不把子代理内容视为父任务最终答复。

## 验收标准

- [x] OpenCode 子会话被发现后生成独立 AI 气泡，事件到达时及时刷新，事件缺失时每 60 秒补捞。
- [x] OpenCode one-shot、并行 tab、恢复会话和多子代理并发均定向到正确会话，不重复追加文本。
- [x] Codex 根据 `threadId` 将子代理 delta 与父助手 delta 分开，协作代理开始、完成、失败和中断均更新正确气泡。
- [x] Codex 子线程 `thread/started`、`turn/completed` 不改写或提前结束父线程运行。
- [x] 子代理气泡不参与父任务最终答复与 hidden retry 成功判定。
- [x] 中英文、相关单测、TypeScript build 和差异检查通过。

## 影响面

- 代码目录：`src/cli/`、`src/interactive/`、`src/webview/`、`src/extension.ts`、`src/i18n.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/references/`、`.ch/docs/product-specs/`
- 配置与脚本：无新增技术栈；沿用 Node HTTP、OpenCode CLI 与 Codex App Server

## 风险与缓解

- 风险：OpenCode SSE 事件重复或缺失导致文本重复。
- 缓解：事件仅触发重新读取子会话快照，以完整文本前缀计算增量；60 秒全量轮询兜底。
- 风险：本地端口尚未就绪或用户配置了外部 attach。
- 缓解：连接失败可重试且不终止主任务；命令参数显式端口保持可测试、可定位。
- 风险：Codex 多个子线程事件交错，错误合并到同一消息。
- 缓解：气泡状态按 provider + child thread/session ID 隔离，Webview 允许定向更新非末尾子代理消息。
- 风险：子代理文本被当成父任务完成答复。
- 缓解：消息标记 `subagentId`，最终结论判断显式排除该类消息；runner 不把子线程 delta 送入主回复观察器。

## 验证计划

- 最小相关验证：子代理气泡 reducer、OpenCode 快照/SSE 解析、Codex runtime 分流与父子 turn 完成过滤。
- 单元自测命令：`node --test dist/test/subagentProgress.test.js dist/test/openCodeSubagentMonitor.test.js dist/test/codexRunnerRuntime.test.js dist/test/finalConclusion.test.js`
- 扩展验证：OpenCode command runner/tab stream、Codex protocol/runner 测试、`npm run build`、`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：新增通用子代理气泡、OpenCode 监控器、Codex mock App Server 父子线程测试；更新 Codex 事件/runtime、OpenCode runner 与最终结论回归。
- 单元自测结果：`npm run build` 通过；10 个相关测试文件共 112/112 通过；`git diff --check` 通过。
- 失败处理记录：首轮保留的旧静默提示源码断言失败，归类为需求变化后的断言过期，已改为监控器接线断言；结构复核发现父 session text event 会触发多余 children poll，以及并发快照可能倒序覆盖，已增加 known-child 限定和 per-child generation 后重跑通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 CLI runtime reference、VS Code CLI runtime 设计、能力规格和 PITFALLS。

## 任务列表

- [x] 核对 OpenCode 本地服务 API 与 Codex 0.144.1 App Server schema。
- [x] 实现通用子代理气泡状态与 Webview 定向更新。
- [x] 实现 OpenCode 事件监听与 60 秒轮询补捞。
- [x] 实现 Codex 子线程生命周期、delta 和完成事件分流。
- [x] 补齐测试、国际化与事实来源文档。
- [x] 执行构建、相关测试和差异复核。

## 决策记录

- 2026-07-13：OpenCode 使用其公开本地 HTTP API，不直接解析 `~/.local/share/opencode/opencode.db`。
- 2026-07-13：OpenCode SSE 只作为低延迟刷新触发器，消息正文以 `/session/{id}/message` 快照为准，避免重复 delta。
- 2026-07-13：Codex 以 App Server 通知 `threadId` 作为父子消息唯一分流依据，子线程输出不进入父回复观察器。
- 2026-07-13：Codex 官方手册拉取返回 HTTP 403；协议实现依据本机官方 `codex-cli 0.144.1` 生成的 experimental JSON schema 与 mock App Server 回归，不基于猜测字段。
- 2026-07-13：OpenCode 只展示当前运行尝试中新建的直接 child session，恢复父会话时不回放历史子代理正文。

## 当前结论

实现完成。OpenCode 在 one-shot 与并行 tab 中使用本地 SSE 触发子会话快照刷新，并以 60 秒 children/status/messages 轮询兜底；Codex 使用 App Server 原生 threadId 流式分流。两个 provider 共用按子代理 ID 隔离的 assistant 气泡，支持交错增量、生命周期收口和父最终答复隔离。构建、112 条相关回归和差异检查均通过。
