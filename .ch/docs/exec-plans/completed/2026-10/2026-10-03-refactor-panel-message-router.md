# 面板消息路由解耦重构 — 行为保持重构

- 日期：2026-10-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-03
- claim_ttl：本次会话
- handoff_to：
- 类型：refactor

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-03-panel-message-router-refactor.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-03-docs-panel-message-router.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

统一面板消息路由与领域窄端口，保持消息协议和用户行为。仅承担行为保持重构；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的行为保持重构；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-03-refactor-panel-message-router.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 目标

- 引入统一、类型安全的面板消息路由入口。

- 按领域拆分消息处理器，并让各处理器只依赖最小端口。

- 保持现有 `PanelMessage` 协议、用户可见行为和扩展入口兼容。

## 范围

- 重构 `src/sessionMessageRouter.ts` 和 `src/sessionMessageHandlers.ts`。

- 抽取会话/模型配置/工作区文件/Prompt 任务等领域处理器的窄依赖。

- 统一 `extension.ts` 对特殊消息和普通消息的分发路径。

## 非目标

- 不修改 VS Code、TypeScript、Node 或现有第三方依赖版本。

- 不修改 `PanelMessage` 的消息字段和 Webview 协议。

- 不改变 CLI 执行、Loop、会话持久化等业务规则。

- 不在本次任务中重写所有运行时 Host。

## 验收标准

- [x] 所有现有面板消息仍能通过统一路由分派。

- [x] `extension.ts` 不再单独绕过统一路由处理面板消息。

- [x] 领域处理器不再接收完整 `PanelMessageHandlerDeps`，而是使用按领域收窄的 `Pick` 端口。

- [x] `npm run build` 通过。

- [x] `sessionMessageHandlersCoreCoverage` 及相关面板消息回归测试通过。

## 影响面

- 代码目录：`src/sessionMessageRouter.ts`、`src/sessionMessageHandlers.ts`、`src/sessionMessageActions.ts`、`src/extension.ts`。

- 配置与脚本：无。

## 风险与缓解

- 风险：消息分支迁移时遗漏行为或错误响应字段。

  - 缓解：保留现有分支测试，先抽取路由外壳，再按领域迁移；每阶段执行构建和核心测试。

  - 缓解：通过显式 `PanelUiPort` 注入确认、通知、消息回传能力，保留原有错误文案和 payload。

- 风险：大型测试夹具与新窄接口不一致。

## 验证计划

- 最小相关验证：`npm run build`；`node --test dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js`。

- 单元自测命令：`npm run test:core`。

- 扩展验证：本次不涉及 Webview DOM 或浏览器交互，不触发 Playwright；如构建和核心单测通过，再评估是否需要 Extension Development Host 验证。

## 测试与清单同步

- 单元自测结果：`npm run build` 通过；Router、消息处理和动作层最小集合共 67 项全部通过，包含特殊消息 `updateOpenCodeVariant` 与 `humanInteractionResponse` 的统一路由回归。

- 核心测试结果：`npm run test:core` 共 236 项，231 项通过、5 项失败；失败集中在未修改的 `dist/test/cli/opencodeCommandRunner.test.js` 用例 68-72，属于既有 OpenCode 运行时代码静态契约断言，与本次面板路由改动无调用关系，未扩大范围修复。

- 失败处理记录：已重新执行 `npm run test:core` 确认失败稳定；面板相关测试和构建均通过，保留该范围外失败作为交付风险说明。

- 全量测试：已启动 `npm run test:unit`；测试输出暴露至少一项范围外 Webview 静态文案断言失败，随后测试进程长期无 CPU 活动且未产生最终汇总，已终止挂起进程，不能将全量结果标记为通过。

- 其他校验：`npm run validate:whitespace` 通过，`git diff --check` 通过。

- 无需更新 `FEATURE_INVENTORY.md`。

## 任务列表

- [x] 建立统一面板消息路由和领域端口类型。

- [x] 迁移现有处理分支并收窄组合根依赖。

## 决策记录

- 2026-10-03：采用显式窄接口和注册式 Command 路由，不引入 DI 容器、不使用 `Record<string, any>` 隐藏依赖。

- 2026-10-03：本次优先完成统一路由和高耦合入口解耦，暂不重写全部业务处理函数。
