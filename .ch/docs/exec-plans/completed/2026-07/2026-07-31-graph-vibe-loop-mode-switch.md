# Graph/vibe/Loop 模式切换修复

- 日期：2026-07-31
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-31
- claim_ttl：PT4H
- handoff_to：

## 背景

用户反馈：同一个会话先使用 Graph 模式执行后，再切换到 vibe 或 Loop 模式继续输入没有效果，仍然自动按 Graph 模式执行。预期是可以在同一会话上下文中切换执行模式。

## 目标

修复同一 conversation tab 内 Graph / vibe / Loop 模式切换后的执行分发，使运行路径跟随用户当前选择，同时保留该 tab 的会话上下文和消息历史。

## 范围

- 聊天面板发送消息时的模式选择与扩展端分发逻辑。
- conversation tab 上 Graph / Loop 元数据对后续运行的影响边界。
- 最小相关单元测试或类型检查验证。
- 必要的运行时事实文档同步。

## 非目标

- 不调整 Graph kernel、Loop 决策协议或模型分配策略。
- 不改变 CLI 技术栈或引入新的执行框架。
- 不迁移历史会话数据格式，除非修复需要最小兼容字段。

## 验收标准

- [x] 在同一 tab 中，Graph 执行后切换 vibe，再发送消息应走普通 `runPrompt`，不再继续进入 Graph。
- [x] 在同一 tab 中，Graph 执行后切换 Loop，再发送消息应走 `runLoopPrompt` 并复用该 tab 的上下文。
- [x] 仍处于 Graph 运行或阻塞状态时，Graph 状态展示和 Graph 面板入口不被破坏。
- [x] 相关测试、`npm run build` 和最小可执行验证通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/sessionMessageHandlers.ts`、`src/sessionTabs.ts`、`src/webview/*`、相关测试文件。
- 文档目录：`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md` 按需同步。
- 配置与脚本：预计无配置变化。

## 风险与缓解

- 风险：清理 Graph 元数据过早会影响未完成 Graph run 的可视状态。
- 缓解：只让“当前 UI 发送模式”决定下一次运行分发，保留已有 tab 元数据作为展示/恢复信息，避免破坏存档。

## 验证计划

- 最小相关验证：新增或更新模式分发单元测试，覆盖 Graph 后切 vibe / Loop。
- 单元自测命令：优先运行相关测试；最终运行 `npm run build`。
- 扩展验证：检查 Graph 相关状态字段仍能序列化到 PanelState。

## 测试与清单同步

- 单元测试新增/更新：`src/test/clipagescriptruntimecoverage.test.ts` 新增 Graph 后切 Vibe/coding 与 Loop 的前台分发回归；`src/test/openCodeThinkingWebview.test.ts` 同步当前 Webview helper/protocol 测试夹具。
- 单元自测结果：通过 `npm run build && node --test dist/test/clipagescriptruntimecoverage.test.js dist/test/graphMainWebview.test.js`；通过 `npm run build && node --test dist/test/openCodeThinkingWebview.test.js`；通过 `npm run test:page`（168/168）。
- 失败处理记录：`openCodeThinkingWebview` 夹具曾因当前 helper/protocol 漂移阻塞定向测试，已同步 `modelRole` 与 helper source 后通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 的模式入口行为。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md` 和 `.ch/docs/runbooks/PITFALLS.md`。

## 任务列表

- [x] 定位 Graph / vibe / Loop 模式分发和 tab 状态来源。
- [x] 实现模式切换后按当前 UI 模式执行的修复。
- [x] 补充回归测试并运行最小验证。
- [x] 同步必要文档并归档执行计划。

## 决策记录

- 2026-07-31：优先让当前发送动作携带的模式决定运行分发，tab 上 Graph 元数据继续用于展示和恢复，不作为普通输入的强制运行模式。

## 当前结论

已完成修复：`resolveDispatchInteractiveMode()` 在前台发送且没有显式 payload mode 时直接使用当前 `state.interactiveMode`；Graph tab 元数据只保留展示/恢复与后台派发自动归类能力。验证通过，文档已同步，计划已归档。
