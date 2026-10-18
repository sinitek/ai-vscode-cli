# Grok 分组当前上下文用量

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-18
- claim_ttl：本次任务
- handoff_to：无

## 背景与目标

用户希望 Grok 分组像 Codex 一样展示准确的已用上下文；仅在 CLI 提供原生接口时接入，不使用累计 token 消耗或文本长度估算。

## 范围与非目标

- 核对 ACP 官方 schema 与本机 Grok 1.0.62 的状态订阅及实际通知。
- 将原生 `session_status.context_window.context_tokens` / `context_window_size`（兼容标准 `usage_update.used/size`）转换为现有 `contextTokenUsage` 面板事件，复用 Codex 展示组件与 Tab 隔离。
- 无有效读数时保持等待占位，不伪造零值；停止后保留最后快照。
- 不改用户模型配置、服务协议、凭据、Codex 统计规则或已有压缩策略。
- 保留工作区内此前自动修复、压缩、会话健康及并发界面改动。

## 验收标准

- Grok 原生通知可更新当前分组已用 token 与窗口上限，不改变已有正文、工具及回放链路，不额外回放包含本机路径的完整状态。
- 忽略异会话、非法、缺失的用量；允许合法零值和压缩后用量下降。
- 不把 prompt 结果中的累计消耗、费用或其它事件作为当前上下文用量。
- 首次运行等待、有效读数、结束保留、后台 Tab 隔离均有回归。
- 构建、相关单测与本机真实 CLI / Chromium 最小验证通过；文档与 ontology 同步。

## 影响面与风险

- 代码：Grok 协议适配、runner、统一交互入口、Webview 已有上下文标签。
- 文档：功能清单、CLI 运行时参考、Grok runbook、ontology。
- 风险：旧 Grok 可能不发用量；无通知时不估算。原生 used 的精度由 CLI 决定。
- 风险：多 Tab 和过期回调；继续复用现有执行身份校验并核对 ACP sessionId。

## 验证计划

- `npm run build`
- `node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/interactive/codexTokenUsage.test.js`
- 隔离 GROK_HOME 与临时工作目录，真实 Grok + 本地模拟 API 验证，不使用真实密钥或付费请求。
- 真实 Webview HTML 与内存 IPC 的 Chromium smoke，检查 Grok 等待、读数、结束保留和 Tab 隔离。
- ontology validate / 单测与 `git diff --check`；既有失效引用单独记录。

## 任务列表

Tasklist:
- [completed] 核查 Grok 用量接口与现有实现
- [completed] 接入准确上下文数据并补充测试
- [completed] 完成构建验证与文档同步

## 决策与当前结论

- CodeGraph 已用于定位 Codex 用量与分组组件；当前工作区源码为实现事实来源。
- memory-recall focus 为 `Grok 上下文 token usage context window 分组用量显示`，anchor 为空，无专项记忆命中。
- 官方 ACP v1 schema 的 UsageUpdate 明确定义 `used` 为当前上下文 token，`size` 为窗口大小，`cost` 为累计费用，三者不可混用。
- 本机 Grok 1.0.62 默认未发标准 `usage_update`，因此不能仅凭 schema 存在就假定可用。已从本机官方二进制确认并实测 `clientCapabilities._meta["x.ai/statusLine"] = true`：收到 `_x.ai/session_notification` 的 `session_status`，schema_version 为 1。
- 真实通知最后一份快照可能晚于 prompt RPC result；runner 缓存快照并保留轻量回调，取消、错误和销毁时清除，下一 prompt 替换。宿主仅允许当前执行或成功结束后仍绑定原 Grok Tab / session / runner 且没有新执行的更新。
- 不依赖特定模型名称，不新增网络请求或设置；数据的计数精度遵循 Grok 自己的当前上下文快照。

## 最终验证

- `npm run build`：通过。
- 最小相关测试：协议、runner、Webview runtime、统一交互宿主、Codex token usage 共 135 项通过。
- 扩展相关测试：`node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokReplayStream.test.js dist/test/interactive/codexTokenUsage.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/promptAutoRepair.test.js dist/test/core/contextCompactionRunner.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js`，217/217 通过。
- 回归覆盖：标准与原生用量、累计值不误用、非法/未知/异会话数据、零值、用量下降、末尾迟到快照、runner 复用及取消、Tab / CLI / 会话 / runner 改变与新执行接管、Grok/Codex 展示占位、结束保留及后台隔离。
- 真实 CLI：Grok 1.0.62，隔离 HOME / GROK_HOME / 工作目录，本地模拟 chat_completions API，未使用真实密钥或付费 API。实际窗口 128000；最新当前快照为 2007，累计输入为 27490，回调准确反映 12652 → 12852 → 2007，不把累计值相加；同时验证 prompt 完成后的最终回调。
- Chromium：真实生产 HTML / JS / CSS + 内存 IPC，8 个结构化场景全部通过：Grok 等待、正常值、后台 Tab、不递增值、结束保留、零值、430px 窄屏及 Codex 对照。无 browser / HTTP / request 错误；标签处于视口且不与提示词按钮重叠，已检查桌面与窄屏截图。
- `git diff --check`：通过。新增 ontology 规则 JSON 有效，6 个 source refs 均存在。
- ontology `--validate` 仍有 15 处既有失效引用；ontology 单测 8/9，通过以外的一项仍为同一完整性失败，与前序已记录基线一致。未扩大修复。
- 首轮页面测试因测试 API 未导出 `updateContextTokenUsage` 有 2 项夹具失败，补齐导出后全部通过；探针首轮模拟 SSE 缺少 created 字段、首次浏览器场景缺少 schemaVersion，均修正为正式协议要求，未为夹具放宽产品实现。

## 文档、记忆与边界

- 已同步功能清单、能力规格、CLI 运行时参考、Grok runbook 与 ontology。
- 架构边界未变，不更新 ARCHITECTURE.md；可复用订阅与迟到快照经验已进入 runbook，无需额外写热区或 EVENT_MEMORY.md。
- 未运行完整 unit suite、真实扩展宿主或付费模型；本次不宣称已安装插件或完成 Extension Development Host 端到端验收。
- 旧 Grok 若不提供有效状态，仅显示等待占位；现有存活进程需在插件更新重载后重新 initialize 才能声明状态能力。
- 验证日志：`/tmp/sinitek-grok-usage-{build,tests,broader,live,browser,ontology,ontology-tests}.log`。
- 浏览器证据：`/tmp/sinitek-grok-context-usage-{pending,used,background,decreased,ended,zero}-1100/`、`/tmp/sinitek-grok-context-usage-used-430/`、`/tmp/sinitek-codex-context-usage-used-1100/` 的 result.json 和 success.png。
- 临时 CLI 配置 / 工作目录与页面服务、探针和场景脚本已清理；工作区其它任务改动均保留，未提交。
