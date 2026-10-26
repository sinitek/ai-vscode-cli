# 修复对话复制与模型选择

- 日期：2026-10-26
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-26
- claim_ttl：本次任务
- handoff_to：无

## 背景

AI 对话气泡选区无法可靠复制到系统剪贴板，复制回退还会创建临时输入框并改变焦点；已执行 Tab 的主模型下拉被禁用且消息层拒绝切换。

## 目标

让聊天气泡选区可靠写入剪贴板且不抢焦点，并允许已执行 Tab 切换主模型用于后续执行。

## 范围

- 主对话与 Loop / Loop+ 群聊共用的复制脚本。
- Coding、Loop / Loop+、Graph 和 OpenCode 主模型选择及宿主消息处理。
- 相关回归测试、功能清单和 ontology。

## 非目标

- 不解除已执行 Tab 的 CLI 类型锁定。
- 不改变模型候选来源、配置档案隔离或正在执行任务的模型。
- 不修复本次范围外的 Grok / DSH 测试夹具问题。

## 验收标准

- [x] 聊天气泡选区优先同步写入复制事件，回退不创建输入框。
- [x] 已执行 Tab 的主模型下拉不因 `executionLocked` 禁用。
- [x] 宿主接受主模型切换，后续执行不再强制使用首个模型快照。
- [x] 已执行 Tab 的 CLI 类型切换仍被拒绝。
- [x] 构建、相关测试及真实浏览器复制验证完成。

## 影响面

- 代码目录：`src/webview/`、`src/panelMessageHandlers/`、`src/sessionMessageActions.ts`、`src/extension.ts`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/ontology/`。
- 配置与脚本：无变化。

## 风险与缓解

- 风险：Webview 剪贴板权限和原生复制行为随运行环境不同。
- 缓解：同步 `clipboardData` 优先，当前选区原生复制兜底，不阻止失败的系统默认复制；使用 Chromium 读回剪贴板验证。
- 风险：旧 Tab 的首个模型快照仍被用于覆盖新选择。
- 缓解：移除执行消息路由和预载消息中的旧模型强制覆盖，保留 CLI 锁定测试。

## 验证计划

- 最小相关验证：`npm run build` 后运行复制、模型 Webview、Panel 消息和 Tab 锁测试。
- 单元自测命令：`node --test dist/test/webview/chatCopy.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/session/conversationTabLock.test.js`。
- 扩展验证：使用 Chromium 对实际复制脚本选中聊天气泡文本、派发系统复制并读回剪贴板。

## 测试与清单同步

- 单元测试新增/更新：复制回退与异常路径、已执行 Tab 下拉状态、宿主模型切换。
- 单元自测结果：相关 77 项通过；额外 Grok 测试有 2 项夹具失败，分类为范围外近期 DSH 依赖变化，不在本次修复。
- 失败处理记录：Grok 夹具分别缺少 `getLoopRoleThinkingOptionsForCli` / `getActiveConversationTabExecutionLock` 依赖，非本次改动引入。
- 功能清单：同步复制回退和仅锁 CLI 的验收事实。
- 相关文档同步：同步插件能力规格及 `cli-plugin-runtime` ontology。

## 任务列表

- [x] 定位复制与模型禁用根因。
- [x] 修复复制回退和模型切换链路。
- [x] 更新回归测试与产品事实。
- [x] 完成最终验证并归档。

## 决策记录

- 2026-10-26：按用户要求解除主模型禁用，保留 CLI 类型锁定；复制不采用会抢焦点的临时 `textarea`。

## 当前结论

真实 Chromium 中验证了“气泡选区 → 输入框聚焦且选区为空 → Meta+C”，剪贴板读回为原气泡文字且无页面脚本错误；复制与模型相关测试通过，文档和 ontology 已同步。
