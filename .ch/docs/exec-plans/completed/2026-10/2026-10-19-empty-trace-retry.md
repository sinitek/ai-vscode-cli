# 首次模型报错后重试的空消息列表修复

- 日期：2026-10-19
- 状态：completed
- 负责人：Codex

## 背景与目标

模型首次执行失败后，异常会话再次执行会清空当前 Tab 的消息。`appendMessage` 在空列表接收首条 trace 时无保护地读取 `last.kind`，触发 `window-message-handler-failed`。修复空列表边界，保持既有会话隔离及消息合并行为。

## 范围与非目标

- 范围：Webview 消息追加、现有运行时回归测试、功能清单和避坑历史归档。
- 非目标：不修改 CLI、异常会话判定、重试策略、样式或依赖。

## 验收标准

- 空列表接收首条 trace 不报错，消息进入列表并正常渲染。
- 首次模型报错、清空消息、重新执行后可正常接收 trace 与助手回复。
- 同类 trace 合并、异类隔离及工具调用不合并的行为保持不变。
- 相关单测、`npm run build`、最小真实 Chromium 验证通过。

## 影响面与风险

- 代码：`src/webview/viewContentScript/traceRendering.ts`。
- 测试：`src/test/webview/clipagescriptruntimecoverage.test.ts`。
- 文档：`.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 风险与缓解：防止空值修复改变消息合并语义，通过运行时消息派发回归覆盖。

## 验证计划

- 先新增回归测试并确认修复前失败，再修复实现。
- `npm run build`。
- `node --test dist/test/webview/clipagescriptruntimecoverage.test.js`。
- 扩展验证：页面相关测试与 Chromium 中实际生成的 Webview 脚本。
- `git diff --check`。

## 任务列表

Tasklist:
- [completed] 定位首次报错后重试的异常链路
- [completed] 修复消息状态并补充回归测试
- [completed] 验证构建并同步必要文档

## 决策与文档同步

- CodeGraph 未覆盖模板字符串内的 `appendMessage`，已直接核对当前脚本、消息派发和 `prepareSessionForPromptRun` 的清空链路。
- 本次恢复原有空消息列表接收行为，不改变会话健康、重试恢复规则或事实来源路径，无需修改 ontology；无需更新架构或长期记忆热区。
- 已同步功能清单中的会话健康与异常续接隔离条目；已修复踩坑按 runbook 规则记录到 `PITFALLS_HISTORY.md`，不写入有效问题索引或 `ROLLING_SUMMARY.md`。

## 验证结果

- 修复前：`npm run build` 成功，新增的 5 项运行时回归全部失败，稳定复现 `appendMessage` 读取 `kind` 的原始异常堆栈。
- 修复后：`npm run build` 成功；`node --test dist/test/webview/clipagescriptruntimecoverage.test.js`，76/76 通过。
- `npm run test:page`：重新构建成功，273/273 通过，包含新增的 5 项回归。
- `node --test dist/test/session/sessionHealth.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js`：30/30 通过。
- `node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario /tmp/sinitek-empty-trace-smoke.json --install-if-missing`：passed；browserErrors/httpErrors/requestFailures 均为空。实际加载完整生成的 Webview HTML，通过模拟宿主重放空列表 trace 与首次失败后的重试消息；确认 trace、最终答复均显示且 Tab 不残留错误状态。截图已检查，结果保留在 `/tmp/sinitek-empty-trace-smoke-result/result.json`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `git diff --check` 与 `node scripts/check_trailing_whitespace.js`（限定本次改动文件）：通过；归档路径存在且 active 计划已移除。
- 失败分类：修复前回归失败为实现缺陷；修复后新测试曾因假 DOM 的选择器能力、思考气泡挂载和既有指令折叠规则而断言失败，属于测试夹具/断言问题，仅修正新增测试。初次浏览器启动因临时工具缓存缺少入口文件失败，改用 skill 自带的隔离安装恢复，未修改项目依赖。
- 未覆盖：未启动真实模型或 VS Code Extension Development Host；本次只修改 Webview 对既有事件的处理，CLI 与会话生命周期由相关单测守护。未运行全量 `npm run test:unit`。

## 当前结论

一行空值保护修复根因，5 项回归、页面测试、会话隔离测试及真实 Chromium 消息派发验证通过；现有消息合并、工具调用隔离与异常会话重建行为保持不变。
