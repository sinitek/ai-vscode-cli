# Loop / Loop+ 群聊气泡显示限额

- 日期：2026-11-11
- 状态：已实现；原限额及补充需求保护的构建、相关单测与 Chromium 宽窄屏验证均通过，分批结果见实施记录。
- 功能实施记录：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-feature-loop-group-chat-message-limit.md`；规格文档交付见 `.ch/docs/exec-plans/completed/2026-11/2026-11-11-docs-loop-group-chat-message-limit.md`。该功能原测试开发的历史证据见[十一月删除审计](../exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json)，按 `source_old_path` `.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-message-limit.md` 定位。补充需求保护的缺陷修复见 `.ch/docs/exec-plans/completed/2026-11/2026-11-11-bugfix-loop-group-chat-preserve-requirements.md`，其测试历史证据见同一审计、按 `source_old_path` `.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-preserve-requirements.md` 定位；规格文档交付见 `.ch/docs/exec-plans/completed/2026-11/2026-11-11-docs-loop-group-chat-preserve-requirements.md`。

## 配置与事实来源

工具设置 → AI任务配置的 `loopGroupChatMessageLimit` 写入全局 `~/.sinitek_cli/settings.json`，默认 200，范围 1–10000；规范化共用 `normalizeChatMessageLimit`，显式传入群聊默认值 200。普通 Tab 的 `chatMessageLimit` 和永久清理规则保持不变。

宿主通过 `PanelState.loopGroupChatMessageLimit` 回传设置，通过协调器的 `getMessageLimit` 投影到 `LoopGroupChatPanelState.messageLimit`；旧状态缺失时回退默认值。保存失败走现有中文错误与真实状态回传；成功后刷新所有打开的群聊面板。

## 保留窗口

- 数量包含初始任务、transcript 气泡、运行中思考气泡，不包含面板成员列表、通知和“我要提问”独立弹窗。
- 上限 N，批量 B=`max(1, ceil(N/4))`。当前可见气泡总数 C≥N 时，按 `B * (floor((C-N)/B)+1)` 删除最旧的可清理气泡；所有 transcript `user-message` 补充需求均跳过，保留原时间顺序，且继续计入阈值。初始任务发起不在保护范围内。没有补充需求时仍是默认 199 条不变、200→150、249→199、250→150。
- 保护游标之前的补充需求与游标之后的窗口共同渲染；同一批次跨过补充需求时继续向后寻找普通气泡，不能靠跳过需求缩减清理批量。始终至少保留最新一条；补充需求本身已达到或超过上限时，允许受保护需求及最新气泡超限，不删除需求来强行满足限额。
- `LoopGroupChatPanel` 保存窗口起点，增量 patch 复用，思考气泡消失后不回填旧消息。设置值改变或任务改变时重算，关闭重开也重算。
- 筛选发生在 `renderSegment` 和 Markdown 编码之前，只生成受保护补充需求及最新窗口的气泡 HTML；完整聊天记录仍由既有事实来源保存。

## Loop+ 验收锚点保护

Loop+ 左侧成员通过最近一次已验收完成事件定位「验收结果」气泡，成功与失败使用同一定位链路。`src/loopPlusAcceptancePlan.ts` 将完成事件 ID 数组以 URI 编码 JSON 写入 `loop-plus-acceptance` HTML 注释；`src/loopGroupChatAcceptance.ts` 将当前成员最近一次已验收 attempt 的完成事件与反馈精确关联，渲染前移除注释。批量反馈可成为多个成员的共同目标，同名标题不影响精确身份匹配。旧反馈无注释时仅按唯一完整标题兼容，存在歧义不生成入口。

`buildLoopGroupChatPanelContentPatch` 一次计算成员入口与时间线锚点。可定位的最新验收气泡与 `user-message` 一样传入既有保护谓词，即使位于窗口游标之前也保留；它们仍计入总数、必要时允许超限。普通气泡继续执行原有批次清理规则，不回填旧消息。不增加持久化字段、调度消息或额外的历史读取接口。

入口使用原生按钮，目标具有 `tabindex=-1` 和主题焦点框；点击后滚动并聚焦目标，窄屏收起抽屉。尊重减少动态效果偏好；无反馈或加载错误不生成悬空入口。回归入口为 `src/test/loop/loopGroupChatAcceptance.test.ts`。

## 边界与非目标

本规则只限制群聊页面显示，不永久删除任何群聊文件、普通会话历史、任务数据、CLI 日志或模型上下文。增加限额或重新打开可显示存档中的较早消息。成员面板、调度、验收和主任务问答行为不变。沿用既有主题控件和全局配置路径，不新增平台路径分支。

## 验证入口

- `src/test/loop/loopGroupChatBubbleRetention.test.ts`：触发阈值、长历史、批次、游标、数值边界、不变性、补充需求穿插及超限保护。
- `src/test/loop/loopGroupChatPanel.test.ts`：首次/增量渲染、思考气泡、Loop+ 与双模式补充需求保护。
- `src/test/core/toolSettings.test.ts`、`src/test/session/sessionMessageActionsCoreCoverage.test.ts`、`src/test/webview/clipagescriptruntimecoverage.test.ts`：持久化、失败路径、控件与状态回传。
