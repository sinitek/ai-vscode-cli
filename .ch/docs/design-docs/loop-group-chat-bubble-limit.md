# Loop / Loop+ 群聊气泡显示限额

- 日期：2026-11-11
- 状态：已实现；构建、338 项相关测试与 Chromium 宽窄屏验证通过。
- 实施记录：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-message-limit.md`。

## 配置与事实来源

工具设置 → AI任务配置的 `loopGroupChatMessageLimit` 写入全局 `~/.sinitek_cli/settings.json`，默认 200，范围 1–10000；规范化共用 `normalizeChatMessageLimit`，显式传入群聊默认值 200。普通 Tab 的 `chatMessageLimit` 和永久清理规则保持不变。

宿主通过 `PanelState.loopGroupChatMessageLimit` 回传设置，通过协调器的 `getMessageLimit` 投影到 `LoopGroupChatPanelState.messageLimit`；旧状态缺失时回退默认值。保存失败走现有中文错误与真实状态回传；成功后刷新所有打开的群聊面板。

## 保留窗口

- 数量包含初始任务、transcript 气泡、运行中思考气泡，不包含面板成员列表、通知和“我要提问”独立弹窗。
- 上限 N，批量 B=`max(1, ceil(N/4))`。当前窗口 C≥N 时前移 `B * (floor((C-N)/B)+1)`，并确保至少保留最新一条。默认 199 条保持不变，200→150，249→199，250→150；大量历史一次计算，无需循环逐条删除。
- `LoopGroupChatPanel` 保存窗口起点，增量 patch 复用，思考气泡消失后不回填旧消息。设置值改变或任务改变时重算，关闭重开也重算。
- 筛选发生在 `renderSegment` 和 Markdown 编码之前，只生成最新窗口的气泡 HTML；完整聊天记录仍由既有事实来源保存。

## 边界与非目标

本规则只限制群聊页面显示，不永久删除任何群聊文件、普通会话历史、任务数据、CLI 日志或模型上下文。增加限额或重新打开可显示存档中的较早消息。成员面板、调度、验收和主任务问答行为不变。沿用既有主题控件和全局配置路径，不新增平台路径分支。

## 验证入口

- `src/test/loop/loopGroupChatBubbleRetention.test.ts`：触发阈值、长历史、批次、游标、数值边界与不变性。
- `src/test/loop/loopGroupChatPanel.test.ts`：首次/增量渲染、思考气泡和 Loop+。
- `src/test/core/toolSettings.test.ts`、`src/test/session/sessionMessageActionsCoreCoverage.test.ts`、`src/test/webview/clipagescriptruntimecoverage.test.ts`：持久化、失败路径、控件与状态回传。
