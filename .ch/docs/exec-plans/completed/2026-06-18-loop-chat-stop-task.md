# Loop群聊任务级中止按钮

- 日期：2026-06-18
- 状态：completed
- 负责人：Codex

## 背景

Loop群聊 UI 已支持未完成任务的继续入口，但运行中的Loop任务仍需要用户回到对应 AI 对话 tab 才能停止。用户要求群聊 UI 直接提供中止按钮，并且中止和继续按钮互斥出现。

## 目标

在Loop群聊 UI 中，当同一Loop任务存在运行中的主任务、子任务或相关辩论/共识任务时显示“中止”按钮；点击后停止该Loop任务关联的所有运行 tab，并把任务标记为 stopped。任务不在运行且未完成时显示“继续执行”按钮。两类按钮互斥出现。

## 范围

- Loop群聊 WebviewPanel 顶部动作区与消息协议。
- 扩展侧按 `loopTaskId` 停止所有相关运行的编排逻辑。
- Loop任务记录状态刷新与中止提示。
- 产品/设计/踩坑文档同步。

## 非目标

- 不改变普通 AI 对话停止按钮行为。
- 不改变Loop子任务手动继续逻辑。
- 不新增Loop任务持久化格式。

## 验收标准

- [x] 运行中的Loop群聊 UI 显示“中止”按钮，不显示“继续执行”按钮。
- [x] 未完成且当前无运行进程的Loop任务显示“继续执行”按钮，不显示“中止”按钮。
- [x] 点击“中止”会停止同一 `loopTaskId` 的主任务、子任务和相关运行任务，并刷新群聊状态。
- [x] 已完成Loop任务不显示“中止”或“继续执行”按钮。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/loopDebatePanel.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：无

## 风险与缓解

- 风险：只停止当前可见 tab，遗漏同一Loop任务的并行子任务。
- 缓解：按运行记录中的 `loopTaskId` 遍历 active/parallel/interactive 运行并逐一停止。
- 风险：中止后按钮状态未及时刷新。
- 缓解：停止后更新任务状态并刷新已打开的Loop群聊面板。

## 验证计划

- 最小相关验证：`npm run build`、`git diff --check`
- 扩展验证：`node --test dist/test/loopDebate.test.js`

## 测试与清单同步

- 单元测试：本次主要改扩展编排和 Webview 消息接线，先用构建和现有Loop测试覆盖。
- 功能清单：同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：同步运行时设计、能力规格和踩坑文档。

## 任务列表

- [x] 梳理现有停止入口和运行记录结构。
- [x] 实现群聊 UI 互斥的中止/继续按钮。
- [x] 实现按Loop任务 ID 停止所有相关运行。
- [x] 同步文档并运行验证。

## 决策记录

- 2026-06-18：中止按钮只在同一Loop任务存在运行进程时显示；继续按钮只在未完成且无运行进程时显示。

## 当前结论

已完成。群聊面板在同一Loop任务存在运行进程时只显示“中止”，点击后按 `loopTaskId` 停止 active / parallel / interactive 运行，任务记录更新为 `stopped` 并刷新群聊；未完成且无运行进程时只显示“继续执行”。验证通过：`npm run build`、`node --test dist/test/loopDebate.test.js`、`git diff --check`。真实 VS Code Extension Host 手工验收仍建议执行。
