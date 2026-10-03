# 面板消息路由解耦重构

- 日期：2026-10-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-03
- claim_ttl：本次会话
- handoff_to：

## 背景

`src/sessionMessageHandlers.ts` 同时承载 Webview 消息路由、会话/模型/配置/文件/任务处理和 VS Code API 适配，`PanelMessageHandlerDeps` 已膨胀到百余个字段。新增一个面板消息需要修改共享依赖接口、总分发函数、`extension.ts` 组合根和大型测试夹具，维护成本与回归风险持续上升。

## 目标

- 引入统一、类型安全的面板消息路由入口。
- 按领域拆分消息处理器，并让各处理器只依赖最小端口。
- 保持现有 `PanelMessage` 协议、用户可见行为和扩展入口兼容。
- 补齐路由分派和代表性领域处理的回归测试。

## 范围

- 重构 `src/sessionMessageRouter.ts` 和 `src/sessionMessageHandlers.ts`。
- 抽取会话/模型配置/工作区文件/Prompt 任务等领域处理器的窄依赖。
- 统一 `extension.ts` 对特殊消息和普通消息的分发路径。
- 更新相关单元测试与架构说明。

## 非目标

- 不修改 VS Code、TypeScript、Node 或现有第三方依赖版本。
- 不修改 `PanelMessage` 的消息字段和 Webview 协议。
- 不改变 CLI 执行、Loop、Graph、会话持久化等业务规则。
- 不在本次任务中重写所有运行时 Host。

## 验收标准

- [x] 所有现有面板消息仍能通过统一路由分派。
- [x] `extension.ts` 不再单独绕过统一路由处理面板消息。
- [x] 领域处理器不再接收完整 `PanelMessageHandlerDeps`，而是使用按领域收窄的 `Pick` 端口。
- [x] `npm run build` 通过。
- [x] `sessionMessageHandlersCoreCoverage` 及相关面板消息回归测试通过。

## 影响面

- 代码目录：`src/sessionMessageRouter.ts`、`src/sessionMessageHandlers.ts`、`src/sessionMessageActions.ts`、`src/extension.ts`、相关测试。
- 文档目录：`ARCHITECTURE.md`、本执行计划。
- 配置与脚本：无。

## 风险与缓解

- 风险：消息分支迁移时遗漏行为或错误响应字段。
  - 缓解：保留现有分支测试，先抽取路由外壳，再按领域迁移；每阶段执行构建和核心测试。
- 风险：VS Code API 适配边界改变导致扩展宿主行为回归。
  - 缓解：通过显式 `PanelUiPort` 注入确认、通知、消息回传能力，保留原有错误文案和 payload。
- 风险：大型测试夹具与新窄接口不一致。
  - 缓解：新增领域级测试夹具，保留总入口回归用例验证组合根接线。

## 验证计划

- 最小相关验证：`npm run build`；`node --test dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js`。
- 单元自测命令：`npm run test:core`。
- 扩展验证：本次不涉及 Webview DOM 或浏览器交互，不触发 Playwright；如构建和核心单测通过，再评估是否需要 Extension Development Host 验证。

## 测试与清单同步

- 单元测试新增/更新：增加统一路由分派、未注册消息和领域依赖边界回归测试，更新现有面板消息处理测试。
- 单元自测结果：`npm run build` 通过；Router、消息处理和动作层最小集合共 67 项全部通过，包含特殊消息 `updateOpenCodeVariant` 与 `humanInteractionResponse` 的统一路由回归。
- 核心测试结果：`npm run test:core` 共 236 项，231 项通过、5 项失败；失败集中在未修改的 `dist/test/cli/opencodeCommandRunner.test.js` 用例 68-72，属于既有 OpenCode 运行时代码静态契约断言，与本次面板路由改动无调用关系，未扩大范围修复。
- 失败处理记录：已重新执行 `npm run test:core` 确认失败稳定；面板相关测试和构建均通过，保留该范围外失败作为交付风险说明。
- 全量测试：已启动 `npm run test:unit`；测试输出暴露至少一项范围外 Webview 静态文案断言失败，随后测试进程长期无 CPU 活动且未产生最终汇总，已终止挂起进程，不能将全量结果标记为通过。
- 其他校验：`npm run validate:whitespace` 通过，`git diff --check` 通过。
- 功能清单：用户可见行为和协议不变，无需更新 `FEATURE_INVENTORY.md`；若路由架构事实变化，仅同步 `ARCHITECTURE.md`。
- 相关文档同步：已更新 `ARCHITECTURE.md` 中的 Webview 消息入口边界。

## 任务列表

- [x] 建立统一面板消息路由和领域端口类型。
- [x] 迁移现有处理分支并收窄组合根依赖。
- [x] 补充回归测试并完成构建、相关核心回归验证。
- [x] 更新架构文档并准备归档执行计划。

## 决策记录

- 2026-10-03：采用显式窄接口和注册式 Command 路由，不引入 DI 容器、不使用 `Record<string, any>` 隐藏依赖。
- 2026-10-03：本次优先完成统一路由和高耦合入口解耦，暂不重写全部业务处理函数。

## 当前结论

已完成统一 Router、diagnostics/session/prompt/workspace 领域处理器迁移、组合根端口接线、回归测试和架构文档同步。工作区端口已改为必需字段，避免依赖缺失时静默丢弃消息。`npm run build` 和 66 项面板相关回归测试通过；核心测试仍有 5 项范围外 OpenCode 静态契约失败，已记录并未修改无关代码。计划可归档。
