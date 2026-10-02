# Codex 空思考气泡排查与修复

- 日期：2026-10-02
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈 AI 对话中存在空思考气泡。检查最新本机插件日志、Codex rollout 和持久化消息，区分上游没有公开思考摘要与前端误渲染空消息，保证无正文不显示、有正文不丢失。

## 范围与非目标

- 范围：Codex reasoning 空白增量、Webview 空占位/历史空消息可见性、相关回归测试与事实来源同步。
- 非目标：不修改 CLI 版本、模型配置、主题、国际化文案或用户运行数据；不解密或伪造没有公开下发的 reasoning。

## 已核对事实

- 当日本机插件日志主要记录 CLI 启动，没有 reasoning 原始事件；具体内容以 Codex rollout 与本机消息存档交叉核对。
- 当日近期 rollout 存在 `summary: []` 且只有 `encrypted_content` 的 reasoning；现有事件处理已经忽略空快照。
- 近期持久化消息中的 thinking 正文非空；`sanitizeMessages` 会清理空正文，所以存档没有空消息不代表实时 Webview 不会渲染空占位。
- 交互宿主先发 `appendMessage(content: "")` 再发 `assistantDelta`；Webview 可见性过滤没有空正文规则。纯空白 reasoning delta 也会被当作非空字符串发出。

## 验收标准

- 空/纯空白 assistant 占位不显示气泡，保留 ID 与后续增量关联。
- 历史空 thinking 与只有 thinking trace 标题的消息不显示；实际正文、正常 trace 和有效消息操作保留。
- 同一思考消息在工具 trace 前后接收正文时恢复显示，正文/换行不丢失。
- reasoning 空白前缀仅缓存，收到正文后完整下发；已有正文后的换行仍正常下发。
- 构建、最小相关单测和真实 Chromium 渲染验证通过。

## 影响面与风险

- 代码：`src/interactive/codexRunnerRuntime.ts`、`src/webview/viewContentScript/messageRendering.ts`、`src/webview/viewContentScript/traceRendering.ts`。
- 测试：现有 Codex runtime 与 Webview runtime 测试。
- 文档：功能清单、CLI 接入事实来源、必要的踩坑记录。
- 风险：误删流式消息导致后续文字丢失；通过保留状态、仅过滤 DOM 与增量回归缓解。无正文但有效操作按钮不能隐藏。
- 回滚：回退本次空正文过滤，不改变持久化格式或配置。

## 验证计划

- `npm run build`
- `node --test dist/test/interactive/codexRunnerRuntime.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`
- 扩展执行相关 session / Webview / reasoning 测试；使用已有本机 Playwright 与 Chromium 回放真实形状的消息序列，不调用模型或修改用户存档。
- 记录回归用例修复前失败、修复后结果；失败按 `.ch/docs/TESTING.md` 分类。

## 测试与清单同步

- 单元测试：新增 5 个测试，覆盖空 reasoning 摘要/空白前缀、思考占位、纯空白回复、历史空 trace/最终标记、有效操作与工具插入后的延迟正文恢复。
- 单元自测结果：构建通过；以下扩展相关范围 131 项全部通过，单独排除已在基线复现的旧用例：

  ```bash
  npm run build
  node --test --test-force-exit \
    --test-skip-pattern='boots the runtime and dispatches state' \
    dist/test/interactive/codexRunnerRuntime.test.js \
    dist/test/webview/clipagescriptruntimecoverage.test.js \
    dist/test/core/codexReasoningContent.test.js \
    dist/test/interactive/codexAppServerProtocol.test.js \
    dist/test/interactive/codexAppServerEvents.test.js \
    dist/test/interactive/codexRunnerSubagent.test.js \
    dist/test/session/sessionStoreCoreCoverage.test.js \
    dist/test/webview/finalAnswerPolicy.test.js \
    dist/test/webview/traceToolTitleLocalization.test.js \
    dist/test/webview/openCodeThinkingWebview.test.js \
    dist/test/session/conversationTabPagination.test.js \
    dist/test/session/conversationTabLock.test.js \
    dist/test/graph/graphMainWebview.test.js
  ```

- 失败处理：完整最小范围最初为 59 通过、1 失败；旧的 `boots the runtime and dispatches state, message, stream, history, settings, and queue events` 用例在 Tasklist 面板期待 `block`、实际 `none`。从 `git show HEAD:src/webview/viewContentScript/messageRendering.ts` 转译并替换待测模块后仍同断言失败，分类为历史/范围外失败，不修改相关 Tasklist 逻辑。Webview 夹具已有未注入的全局 `setInterval` 保持进程，使用 Node 现有 `--test-force-exit`，不改产品计时器。
- 回归证据：3 个新增 Webview 用例在 `HEAD` 渲染模块下全部失败；当前代码全部通过。空白 reasoning 前缀与空快照用例修复前也失败、修复后通过。
- 功能清单：已同步空思考与回复气泡过滤；CLI 接入事实来源和 `PITFALLS.md` 已记录边界与排查方式。
- 国际化：不新增/修改用户可见文案，无需增加 i18n 键。
- ontology / 记忆：复核后确认不改变稳定概念、关系、生命周期、来源路径；无须改 ontology。稳定复发问题已进入 runbook，无需在热区和技能中重复沉淀。

## 本机真实验证

- 使用已有缓存 Playwright 1.61.1 与 Chromium；复用项目生成的静态 HTML、主题样式、`buildWebviewRuntimeScript` 和实际 `marked`，通过只读宿主桥接夹具回放 `appendMessage -> 空 assistantDelta -> 工具 trace -> 正文 delta -> 历史 setMessages`。
- 通过 `.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario /tmp/sinitek-empty-thinking-scenario-{desktop,sidebar}.json` 分别验证 1280×900 和 460×900。两次最终结果均 `status: passed`，browser/http/request errors 均为空；截图已目视核对，无空思考气泡，正文、Markdown 与操作按钮保留。
- Chromium 首次回放暴露空增量隐藏气泡后仍按 `state.messages.length` 覆盖空态的问题，已在增量渲染入口提前返回并补断言；这说明不能只在整页渲染入口过滤。
- UI detector 无发现；`git diff --check` 和改动范围 `check_trailing_whitespace.js` 通过。
- 未调用真实模型发新任务、未修改用户存档，未在已安装扩展的 Extension Development Host 中重载验证；本机验证覆盖真实日志读取和生成 Webview 的 Chromium 回放。逻辑不涉及平台路径，新实现无新增 Linux/macOS/Windows 分支。

## 当前进展

Tasklist:
- [completed] 检查最新日志与相关调用链
- [completed] 修复空思考气泡并补回归测试
- [completed] 验证构建与实际渲染行为
