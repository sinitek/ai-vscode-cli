# Graph 阻塞主任务 Tab 错误态修复

- 日期：2026-07-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-29
- claim_ttl：same-session
- handoff_to：

## 背景

Graph 节点进入 failed/blocked 后，run 会进入 `needs-review` 并弹出阻塞处理弹窗；但主 Graph tab 仍保留运行态，用户在主任务列表中看不到该任务已经需要人工处理。

## 目标

- Graph run 因 failed/blocked 节点进入 `needs-review` 时，主 Graph tab 进入错误态并释放运行态。
- Webview 刷新后仍能从 conversation tab summary 识别该 Graph blocked 状态。
- 补充回归测试并同步 Graph 行为文档。

## 范围

- `src/extension.ts` Graph 主 tab 状态事件和 tab summary。
- `src/webview/types.ts`、`src/webview/viewContentScript/messageRendering.ts` 前端状态渲染。
- `src/test/graphExtensionRuntime.test.ts` 回归断言。
- `.ch/docs/design-docs/graph-orchestration-mode.md` 与产品清单事实来源。

## 非目标

- 不改变 Graph run 的持久化状态枚举，阻塞 run 仍为 `needs-review`。
- 不改变 GraphRunPanel 的 Retry / Continue / Stop 控制语义。
- 不把 sleeping 等等待态改成错误态。

## 验收标准

- [x] blocked/failed node 导致的 `needs-review` 会向主 tab 发 `runStatus:error`。
- [x] conversation tab summary 携带 Graph blocked 状态，刷新后 tab 仍显示错误态。
- [x] 相关构建、Graph 定向测试和 diff 检查通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`
- 配置与脚本：无

## 风险与缓解

- 风险：把 sleeping/human gate 等非 blocked 等待态误标为错误。
- 缓解：仅当 run 为 `needs-review` 且存在 failed/blocked attention node 时标记错误。

## 验证计划

- 最小相关验证：`node --test dist/test/graphExtensionRuntime.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：`node --test dist/test/graph*.test.js`、`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphExtensionRuntime.test.ts`，覆盖 blocked Graph main tab 错误态、summary 状态字段和当前 thinking-mode helper 断言。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphExtensionRuntime.test.js` 16/16 通过；`node --test dist/test/graphRunControl.test.js dist/test/graphRunPanel.test.js` 23/23 通过；`node --test dist/test/graph*.test.js` 101/101 通过；`git diff --check` 通过。
- 失败处理记录：首次 `graphExtensionRuntime` 因旧 regex 仍匹配旧 summary 内联写法失败，随后更新断言；第二次因既有 Loop role thinking 封装后旧 regex 过期失败，更新为匹配 `resolvePromptRunThinkingModeForRole(..., { applySubtaskCap: true })` 后通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md` 与 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 定位 Graph blocked 与主 tab 状态同步路径
- [x] 实现主 tab 错误态映射
- [x] 补充测试、文档并验证

## 决策记录

- 2026-07-29：Graph 持久化状态继续使用 `needs-review`；主对话 tab 的红色错误态作为 UI 状态映射，不改变 Graph 控制链。

## 当前结论

已完成修复。`resolveGraphMainRunStatusEvent` 现在会把 `needs-review + failed/blocked attention node` 映射为主 tab `runStatus:error`；conversation tab summary 会携带 `graphRunStatus` 和 `graphRunBlocked`，Webview 刷新后仍能把该主 Graph tab 渲染为错误态。
