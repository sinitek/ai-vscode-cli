# 群聊气泡剪贴板修复

- 日期：2026-11-22
- 类型：bugfix
- 状态：completed
- 关联计划：[产研部复用普通 Loop+ 执行](2026-11-22-refactor-department-loopplus-execution.md)（同一用户反馈）

## 目标、范围与验收

在群聊正文和嵌入组长群聊提问窗口复制选中文字，不放宽 iframe 沙箱。沿用现有面板来源校验通过 VS Code 剪贴板写入；保留输入框正常复制，拒绝非法载荷和过期实例。运行构建、Webview 单测和 Chromium 实际键盘复制验证。

## 验证结果

- Chromium 以宽窄窗口和深浅主题跑通正文按钮、提问按钮、选中后按键复制、刷新等待选区、输入框原生行为及失效弹窗载荷过滤，四个组合均无浏览器错误。
- 主工作区通过 `npm run build`，使用 `DEPARTMENT_UI_DIST=dist DEPARTMENT_UI_CLIPBOARD_ONLY=1 node scripts/department_group_chat_smoke.cjs` 复跑上述四个 Chromium 组合。Webview 单测覆盖原 Markdown 保留、消息更新及排队提示。
