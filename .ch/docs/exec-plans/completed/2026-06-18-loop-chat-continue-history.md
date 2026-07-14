# Loop群聊继续与历史入口

- 日期：2026-06-18
- 状态：completed
- 负责人：Codex

## 背景

Loop群聊面板已经能展示主从/辩论任务过程，但中断未完成的任务需要回到 AI 对话主任务 tab 才能尝试继续。历史记录弹窗也只展示普通会话和提示词，无法直接从历史任务列表重新打开Loop群聊 UI。

## 目标

在Loop群聊 UI 中为未完成且已中断/需复核的任务提供继续按钮，点击后先显示可编辑确认框，默认填“继续”；用户确认后复用现有Loop主任务恢复链路，并把确认后的文本作为本次继续指令交给主任务/主持人判断下一步。历史记录弹窗新增“Loop群聊” tab，列出保留期内所有Loop群聊任务，并可一键加载打开群聊 UI。

## 范围

- Loop群聊 WebviewPanel 顶部动作区。
- 扩展侧Loop任务恢复入口。
- AI 对话 Webview 历史弹窗。
- PanelState 中的Loop任务历史摘要。
- 产品/设计文档同步。

## 非目标

- 不改Loop任务 JSON 协议。
- 不改变普通编辑任务、普通历史会话加载逻辑。
- 不改变Loop子任务 tab 的行为。
- 不新增持久化存储格式。

## 验收标准

- [x] `error`、`stopped`、`needs-review` 的未完成Loop任务在群聊 UI 中显示继续按钮。
- [x] 点击继续按钮会先弹出默认“继续”的可编辑确认框；确认后打开/复用主任务对话 tab，并以确认后的消息恢复同一个Loop任务。
- [x] `completed` 与当前仍有运行进程的Loop任务不显示继续按钮。
- [x] 历史记录弹窗有“Loop群聊” tab，列表展示所有保留期内Loop任务，点击加载会打开Loop群聊 UI。
- [x] 普通历史会话、提示词历史、普通编辑任务行为不变。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/loopDebatePanel.ts`、`src/webview/viewContent.ts`、`src/webview/types.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：无

## 风险与缓解

- 风险：从独立群聊面板恢复时没有活跃主任务 tab。
- 缓解：复用已有 `resolveLoopMainPromptTarget`，必要时按任务 session 创建主任务 tab。
- 风险：历史列表和普通会话列表混淆删除/加载语义。
- 缓解：新增独立 tab 和专用 `openLoopGroupChat` 动作，只打开群聊，不改变会话绑定。

## 验证计划

- 最小相关验证：`npm run build`、`git diff --check`
- 扩展验证：`node --test dist/test/loopDebate.test.js`；手动打开中断Loop任务群聊，点击继续；打开历史记录弹窗的Loop群聊 tab 并加载历史任务。

## 测试与清单同步

- 单元测试：本轮主要为 VS Code Webview 和扩展编排接线，先用 TypeScript build 验证；如抽出纯函数再补测试。
- 功能清单：同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：同步运行时设计与能力规格；如发现踩坑同步 `PITFALLS.md`。

## 任务列表

- [x] 阅读Loop群聊、任务记录、历史弹窗相关代码并确认恢复入口。
- [x] 实现未完成Loop群聊继续按钮和扩展侧继续处理。
- [x] 在历史记录弹窗新增Loop群聊 tab 并支持加载打开群聊 UI。
- [x] 同步产品/设计/踩坑文档并运行构建验证。

## 决策记录

- 2026-06-18：继续按钮复用现有 `runLoopPrompt(..., { resumeTaskId, resumeRequested: true })`，不新增Loop协议。
- 2026-06-18：历史记录弹窗只负责打开Loop群聊 UI，不直接恢复任务，避免加载历史时产生副作用。
- 2026-06-18：继续按钮不直接恢复；先在群聊 Webview 内弹出可编辑确认框，确认后的内容作为 `loopContinuePrompt` 注入主任务提示或辩论 brief，避免覆盖任务原始目标。

## 当前结论

已完成。群聊面板对未完成且当前无运行进程的任务显示“继续执行”，点击后先显示可编辑确认框，每次打开默认填“继续”，用户确认后复用同一 `resumeTaskId` 唤醒主任务/主持人；历史记录弹窗新增“Loop群聊” tab，可从保留期内任务摘要重新打开群聊 UI。验证通过：`npm run build`、`node --test dist/test/loopDebate.test.js`、`git diff --check`。真实 VS Code Extension Host 手工验收仍建议执行。
