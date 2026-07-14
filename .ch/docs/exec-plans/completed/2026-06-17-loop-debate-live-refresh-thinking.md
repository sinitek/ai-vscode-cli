# Lobster Debate Live Refresh Thinking

- 日期：2026-06-17
- 状态：completed
- 负责人：Codex

## 背景

龙虾辩论群聊页面已支持 5 秒自动刷新，但用户希望页面能更接近实时群聊：当前执行中的角色应显示“思考中”气泡，并且角色/主持人一次发言结束后应主动刷新页面，5 秒轮询仅作为兜底。

## 目标

- 群聊面板根据当前辩论轮状态渲染正在发言/准备发言的等待气泡。
- 扩展端在辩论状态或 transcript 更新后主动刷新已打开的群聊面板。
- 保留 5 秒自动刷新作为兜底。

## 范围

- `src/webview/lobsterDebatePanel.ts`
- `src/extension.ts`
- 辩论模式设计与功能清单文档

## 非目标

- 不新增可写群聊输入框。
- 不改变辩论角色调度、共识算法或任务记录结构。
- 不引入 websocket 或额外后台服务。

## 验收标准

- [x] 当前有 `running` 参与者时，群聊时间线末尾显示对应角色“思考中”等待气泡。
- [x] 参与者都完成但主持人/共识仍在运行时，显示主持人或系统等待气泡。
- [x] 参与者或主持人发言产物写入后，已打开的群聊面板无需等待 5 秒即可刷新。
- [x] `npm run build` 通过。
- [x] `node --test dist/test/lobsterDebate.test.js` 通过。
- [x] 功能文档同步。

## 影响面

- 代码目录：`src/extension.ts`, `src/webview/lobsterDebatePanel.ts`
- 文档目录：`.ch/docs/design-docs/`, `.ch/docs/product-specs/`
- 配置与脚本：无

## 风险与缓解

- 风险：主动刷新过于频繁导致 webview 重绘扰动阅读位置。
- 缓解：复用现有滚动位置保存/恢复；仅在辩论状态/产物更新后触发刷新。

## 验证计划

- 最小相关验证：`npm run build`, `node --test dist/test/lobsterDebate.test.js`
- 扩展验证：人工在 Extension Host 中观察等待气泡和主动刷新。

## 测试与清单同步

- 单元测试：复用辩论解析/决策测试。
- 功能清单：更新产品能力和 feature inventory。
- 相关文档同步：更新辩论设计与运行时设计文档。

## 任务列表

- [x] 梳理辩论状态与面板刷新链路
- [x] 实现等待气泡
- [x] 实现主动刷新触发
- [x] 同步文档并验证

## 决策记录

- 2026-06-17：等待气泡不写入 transcript，仅由面板根据任务记录中的运行状态即时渲染，避免污染真实群聊记录。

## 当前结论

已完成。群聊面板会根据 `activeSpeaker` 显示当前参与者、主持人或共识汇总器的“思考中”等待气泡；角色发言、主持人控场、收束和共识状态落盘后会主动刷新已打开面板，5 秒自动刷新保留为兜底。已通过 `npm run build`、`node --test dist/test/lobsterDebate.test.js` 和 `git diff --check`。
