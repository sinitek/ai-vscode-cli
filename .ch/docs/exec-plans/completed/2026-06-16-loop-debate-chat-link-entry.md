# Loop辩论群聊气泡入口

- 日期：2026-06-16
- 状态：completed
- 负责人：Codex

## 背景

Loop辩论模式已有内容区只读群聊面板和命令入口，但用户希望任务刚开始时就在 AI 对话气泡中看到可点击入口，不需要手动打开命令或从最近任务中选择。

## 目标

在辩论多智能体Loop任务启动时，把“打开辩论群聊”的动作挂到任务开始气泡上，并通过任务 ID 精确打开对应内容区群聊面板。

## 范围

- 扩展 `ChatMessage`，支持可恢复的消息动作。
- 在聊天 webview 中渲染气泡动作链接，并把点击事件发回扩展端。
- 扩展端处理气泡动作，调用现有 `openLoopGroupChatPanel({ taskId })`。
- 在 `debate_multi_agent` 任务创建时立即追加带动作的系统气泡。
- 同步相关设计/产品文档。

## 非目标

- 不让群聊面板直接写入辩论消息。
- 不改变主持人控场、sessionId 续接和辩论收束协议。
- 不新增 VS Code 命令。

## 验收标准

- [x] 辩论任务开始后，主对话气泡立即显示“打开辩论群聊”入口。
- [x] 点击入口可按气泡内 `taskId` 打开对应内容区群聊面板。
- [x] 刷新或恢复会话后，入口仍可点击。
- [x] 非辩论Loop任务不显示辩论群聊入口。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/types.ts`、`src/webview/viewContent.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`
- 配置与脚本：无新增命令或配置

## 风险与缓解

- 风险：系统消息自动合并导致入口被合并到过长气泡中。
- 缓解：带动作的任务启动消息设置 `merge:false`，保持入口独立。

- 风险：点击时依赖当前 active task 会打开错任务。
- 缓解：消息动作保存 `taskId`，扩展端按显式 `taskId` 打开。

## 验证计划

- 最小相关验证：`npm run build` 通过。
- 扩展验证：`node --test dist/test/loopDebate.test.js` 通过；`git diff --check` 通过。

## 测试与清单同步

- 单元测试：现有 Loop debate 纯函数测试保持通过。
- 功能清单：更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。
- 相关文档同步：更新 `.ch/docs/design-docs/loop-debate-multi-agent-mode.md`。

## 任务列表

- [x] 复核现有群聊面板、任务启动气泡和消息渲染链路。
- [x] 实现消息动作类型、渲染和扩展端处理。
- [x] 在辩论任务启动消息上挂入口。
- [x] 同步文档并完成验证。

## 决策记录

- 2026-06-16：入口做成持久化消息动作，不使用裸 command URI，避免恢复时丢任务上下文。

## 当前结论

已完成。辩论任务新建/恢复气泡会持久化 `openLoopGroupChat` 消息动作，点击后按消息内 `taskId` 打开对应内容区群聊面板；普通Loop任务不显示该入口。已通过构建、辩论测试和空白检查。
