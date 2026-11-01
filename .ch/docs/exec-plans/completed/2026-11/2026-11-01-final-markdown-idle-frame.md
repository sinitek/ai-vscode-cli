# 最终答复延迟 Markdown 格式化回归修复

- 日期：2026-11-01
- 状态：completed
- 负责人：Codex

## 背景与证据

用户反馈最终答复停留在纯文本，再发送下一轮任务便恢复最终答复 Markdown 样式。本机目标会话的助手最终正文、Markdown 和最终标记均完整落盘；原始 CLI 记录也包含最终回复及完成事件。运行实例、正文和用户配置不复制进仓库。

现有 Webview 运行时测试将 requestAnimationFrame 同步执行，未覆盖浏览器动画帧晚于三秒空闲计时器执行的时序。优先用可控异步动画帧验证，而非假定正文缺失或解析失败。

## 目标与范围

- 复现空闲格式化后旧动画帧导致纯文本恢复、直到下一轮重绘才恢复的情况。
- 修复助手格式化调度，并按日志证据修复 Codex 最终答复收口及同消息晚到最终阶段的重复气泡；保留三秒空闲窗口和其他已有工作区改动。
- 同步渲染契约、功能清单和必要的排障说明。

## 非目标

- 不升级 search 项目、CLI 或已安装扩展，不重载 VS Code，不改变压缩与持久化协议。
- 不调整主题、Markdown 解析器或模型提示词。

## 验收标准

- 正文停止更新三秒后正常格式化，延后的动画帧不会恢复纯文本。
- end/error/stopped 收尾会清理所有待处理助手渲染；无需发送下一轮任务。
- 正常续写仍更新原气泡并重新等待空闲窗口。
- 同一 Codex agent message 晚到最终阶段时升级原气泡，不拆开正文；不同的过程说明与最终答复仍分别展示。
- 明确最终正文后到达完成或后续活动边界时有界收口，拒绝迟到工具/答复；单独最终标记不截断正文。
- 最小相关测试、npm run build 及 headless Chromium 页面验证通过。

## 风险与缓解

- 旧帧和新帧交叉执行：回归覆盖延后帧、收尾及后续续写。
- 浏览器与测试调度差异：保留同步测试默认行为，另加异步帧场景并用真实 Chromium 验证。

## 验证计划

- npm run build
- node --test --test-name-pattern='delayed assistant animation frames' dist/test/webview/clipagescriptruntimecoverage.test.js
- node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/chatMarkdown.test.js
- 本机真实日志核对与 headless Chromium 渲染时序复现。

## 当前进展

- 已核对日志、最终正文、渲染入口和调度链路。
- 新增可控异步动画帧回归测试；修复前 8/8 场景失败，涵盖最终答复/思考气泡的 idle/end/error/stopped。
- 已确认：空闲计时器完成格式化后未使旧动画帧失效；旧帧将 Markdown 改回纯文本但不重建格式化计时器。收尾 flush 原先只枚举计时器及 pending 状态，因此清理不到孤立的旧帧。下一轮整页重绘会读取已清除的 pending 标志，从而恢复 Markdown。
- 修复：空闲格式化前使旧帧失效；收尾 flush 纳入帧队列；每次排队使用独立令牌防止旧回调误消费新一轮续写的帧。
- 已完成 Codex 最终答复有界收口、同一 `itemId` 复用最终气泡，以及宿主侧迟到 final phase 合并；相关回归覆盖原生阶段、文本 marker、子线程、空消息和下一轮隔离。
- `npm run build` 通过；相关回归测试 221/221 通过；真实 Chromium idle/end/error/stopped 渲染验证通过。
- 全量 `npm test` 的 22 项失败在隔离基线中与本修复前后一致，均为其他任务的 Gemini、Loop+、会话或工具标题范围，不纳入本任务修复。

## 文档与记忆判断

- 已同步 `.ch/docs/references/cli-runtime-reference.md` 中的 Codex 最终答复和渲染契约说明；功能清单与 ontology 的现有变更属于其他任务，本任务未混入。
- 不写入 `ROLLING_SUMMARY.md`；本次可复用排障结论已记录在本计划和回归测试中。
