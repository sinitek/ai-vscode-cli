# 人工交互超时与编排界面自动打开

- 日期：2026-09-30
- 状态：completed
- 负责人：Codex
- owner：human-interaction-timeout-auto-open
- claimed_at：2026-09-30
- claim_ttl：本次实现完成并归档

## 背景

Loop、Loop+、Graph 的主任务澄清表单已经落地。Vibe 人工交互弹窗和这些澄清表单目前会一直等待。用户要求在 AI 任务配置中提供默认 10 分钟的超时，超时后由 AI 自行选择最佳方案继续。三种编排模式开始执行时还要自动打开群聊或运行图。

## 目标

- 工具设置“AI任务配置”增加人工交互超时，默认 10 分钟，范围 1–240。
- Vibe 人工交互弹窗和 Loop/Loop+/Graph 主任务澄清表单超时后关闭，不记为拒绝，不进入 `needs-review`，并要求模型按最佳方案继续且不要重复同一问题。
- 经典 Loop、Loop+、Graph 开始或恢复执行时自动打开对应界面。已打开面板不在每个 tick 抢焦点。

## 范围

- 全局工具设置、面板状态、Webview 设置控件和中英文文案。
- `requestHumanInteraction` 与 `waitForOrchestratorClarification` 的超时。
- 经典 Loop、Loop+、Graph 执行入口的一次性打开。

## 非目标

- 不改变拒绝、关闭、停止的现有语义。
- 不持久化跨进程的超时截止时间。扩展重启后重新计时。
- 不移除手动“打开群聊 / 打开 Graph”按钮。

## 验收标准

- [x] 未配置时超时为 10 分钟，非法值归一化到 1–240。
- [x] 超时提交状态为 `completed` 且 `timedOut=true`，文案要求模型自行继续。
- [x] 超时不会把 Loop/Loop+/Graph 打成 `needs-review`。
- [x] 用户在超时前提交或拒绝时，原路径保持不变。
- [x] 三种模式执行入口会打开对应 UI，且不是每个内部 tick 都打开。

## 影响面

- 代码目录：`src/toolSettings.ts`、`src/humanInteraction.ts`、`src/orchestratorClarification.ts`、`src/extension.ts`、`src/extensionHost/`、`src/webview/`、`src/panelStateBuilder.ts`
- 文档目录：产品清单、Loop+/Graph 设计、能力说明、ontology
- 配置与脚本：`~/.sinitek_cli/settings.json` 的 `humanInteractionTimeoutMinutes`

## 风险与缓解

- 风险：超时被误当成拒绝，任务暂停。
- 缓解：超时走提交通道，只更换文案；拒绝仍是 `aborted`。
- 风险：每个 tick 抢焦点。
- 缓解：只在一次执行入口打开；已存在面板的 reveal 使用 `preserveFocus`。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：相关 `node --test dist/test/...`
- 扩展验证：设置、澄清、Loop+ orchestration、Webview 渲染

## 测试与清单同步

- 单元测试新增/更新：超时、设置归一化、Webview 输入、Loop+ 超时继续
- 单元自测结果：`npm run build` 通过；相关 `node --test` 新增用例通过
- 失败处理记录：`clipagescriptruntimecoverage` 的任务列表显示和 `isAssistantMarkdownRenderPending`，以及静态文案 `Pros: fastest startup`，判为既有失败，未改
- 功能清单：更新 `FEATURE_INVENTORY.md`
- 相关文档同步：Loop+、Graph、能力说明、ontology

## 任务列表

- [x] 核对现有澄清、设置和打开入口
- [x] 实现超时与自动打开
- [x] 补测试、文档并验证

## 决策记录

- 2026-09-30：超时字段使用 `humanInteractionTimeoutMinutes`，默认 10，范围 1–240。
- 2026-09-30：超时使用 `status=completed` 加 `timedOut=true`，不新增提交状态，避免被拒绝分支截走。
- 2026-09-30：热路径只 resolve 正在等待的 waiter，由原继续逻辑写一次补充要求。
- 2026-09-30：扩展重启不恢复旧截止时间，重新等待一个完整时限。

## 当前结论

已完成。`humanInteractionTimeoutMinutes` 默认 10 分钟，范围 1–240。Vibe 弹窗和主任务澄清表单超时后以 `timedOut` 继续，不进入 `needs-review`。经典 Loop、Loop+、Graph 在执行入口自动打开界面。

验证：`npm run build` 通过。`node --test` 覆盖 toolSettings、humanInteraction、orchestratorClarification、sessionMessageActionsCoreCoverage、loopPlusOrchestration、loopPlusEntryRouting、graphExtensionRuntime、multiAgentSettingWebview，新增用例通过。

未修的既有失败：`clipagescriptruntimecoverage` 中任务列表计时后仍为 `display=none`，以及隔离执行 `renderAssistantMessageContent` 时 `isAssistantMarkdownRenderPending is not defined`；`cliPageStaticRenderCoverage` 期望英文文案 `Pros: fastest startup`，当前 i18n 已无该句。这些断言不在本次改动路径上。
