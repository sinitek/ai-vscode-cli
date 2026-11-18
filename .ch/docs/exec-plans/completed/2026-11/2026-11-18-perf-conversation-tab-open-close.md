# 对话标签即时开关

- 日期：2026-11-18
- 类型：perf
- 状态：completed
- 负责人：Codex

## 背景与目标

宿主繁忙时，新建依赖全量面板状态，关闭依赖宿主确认。将标签视觉反馈移到 Webview 点击时；保留宿主的真实会话所有权、运行锁、最后标签保护与持久化。

## 范围与验收

- 新建立即显示标签及加载态；待目标快照和宿主初始化完成才允许发送。旧快照不应吞掉占位标签或重选已切换的标签。
- 关闭立即隐藏标签；宿主拒绝时恢复，确认后释放缓存，后台关闭不重画当前正文。关闭不删除历史，不改变 Loop 自动关闭和会话重置逻辑。
- 改动覆盖 Webview、会话宿主及协议；功能清单、设计文档和 ontology 记录交互与边界。回滚可独立还原本计划改动，无存储迁移。

## 验证与进展

- `npm run build` 通过。`node --test` 运行 `sessionTabCliSwitch`、`sessionMessageHandlersCoreCoverage`、`conversationTabClose`、`clipagescriptruntimecoverage`、`conversationTabLock`、`conversationTabPagination`、`sessionMessageActions`、`sessionTabOwnership`、`tabRunStatus`，359/359 通过。过程中修正了加载容器恢复时 `aria-busy` 丢失的问题和新夹具状态；最终重跑通过。
- 本地 `node .tmp/tab-open-close-smoke.cjs` 运行实际生成的 Webview。模拟宿主扣留回执时，旧版关页仍显示两个标签、新建仍显示一个；改动后分别立即显示一个和两个。520px 与 300px 均通过，减少动态效果时保留文字但不旋转，宿主释放回执后发送恢复。结构化 Chromium smoke 无页面、网络或 HTTP 错误。未在真实高 CPU 的 VS Code 扩展宿主或 Windows 上测试，也未调用真实 CLI 模型。
- 功能清单、运行时设计、ontology 已更新；ontology 结构校验与 9 项校验测试通过。可复用细节已沉淀在运行时设计，不另写热区记忆。
