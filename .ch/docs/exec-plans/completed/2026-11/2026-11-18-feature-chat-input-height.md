# AI 对话输入框高度

- 日期：2026-11-18
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 目标与范围

AI 对话面板支持拖拽输入框上沿，且在重新打开面板后恢复用户高度。不改变输入草稿、会话、其他输入框或 CLI 设置。

## 验收标准

- 默认及最小高度保持三行，向上拉大、向下缩小；过矮视图临时限制显示高度。
- 调整完成才保存全局高度，不写工作区配置；重开及重载时恢复高度，旧配置无需迁移。
- 输入、换行和选区不受拖拽影响；取消拖拽不保存。

## 影响面与风险

Webview 渲染、工具设置命令、用户设置 JSON 与功能文档。CSS 保留原高度下限，视图限高不覆盖已保存偏好；回滚时旧版本忽略新字段。

## 验证结果

- `npm run build` 通过。首次构建的测试断言类型收窄问题已修复。
- `node --test dist/test/core/toolSettings.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`：279 项通过，新增高度校验、磁盘重新读取、设置路由和初始渲染覆盖。
- Playwright 驱动实际生成的 Webview，使用替代 VS Code 消息桥和临时 Home；验证默认 58.5px、实时拖拽至 250.5px、仅提交时写入、取消恢复、保留草稿与选区、重载、窄面板限高与回弹、拖回下限以及键盘调整。首次窄面板 ARIA 断言未等待原生 resize 事件，等待事件后通过。未运行真实 VS Code 图形扩展宿主或全仓单测。
- 功能清单、能力规格、运行时设计与 Ontology 已同步；Ontology 校验通过。无需额外热区记忆。
