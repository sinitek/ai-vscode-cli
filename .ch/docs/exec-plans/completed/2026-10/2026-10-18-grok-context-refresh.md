# Grok 分组上下文刷新排查与优化

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-18
- claim_ttl：本次任务已结束
- handoff_to：无

## 背景与目标

用户反馈 Grok 分组执行期间当前上下文长期保持 1.3k。已有原生 session_status 统计接入，本次核查真实通知频率、统计来源及宿主到 Webview 的刷新链路，修复可复现根因。

## 范围与边界

- 修改 Grok 协议适配、runner，以及对应回归测试。
- 同步 Grok runbook、CLI 运行时参考、能力规格、FEATURE_INVENTORY 和 ontology。
- 保留工作区其它配置和界面未提交改动；用户配置、凭据、依赖版本及上下文压缩策略均未修改。
- 当前上下文直接使用 CLI 原生统计，不引入字符估算、轮询或累计会话消耗。

## 验收标准

- [x] 隔离 Grok + 本地 API 复现并解释 1.3k 停留的原因。
- [x] 当前读数随每次模型响应完成更新，保持零值、下降、异会话与取消防护。
- [x] 构建、Grok 定向回归、本机 CLI 和 Chromium 面板交互验证通过；扩大回归的范围外失败单独记录。
- [x] 记录刷新精度和原生数据限制，同步文档。

## 任务列表

Tasklist:
- [completed] 排查原生通知与展示链路
- [completed] 修复根因并补回归与文档
- [completed] 完成构建、单测、本机 CLI 和浏览器验证

## 调查与决策

- CodeGraph 索引缺少当前 Grok 代码且有未同步文件，已尝试结构查询，后续直接读取当前源码；未重建用户索引。
- memory-recall focus 为 Grok 上下文 usage 分组 trace context token，anchor 为空，无专项记忆命中；已核对前次用量接入计划与当前事实来源。
- 本机 Grok 1.0.62 已声明 `clientCapabilities._meta["x.ai/statusLine"] = true`。隔离多步任务中的 `session_status` 主要在整轮开始、结束发送；执行期间原实现仅收到初始 1343，显示为 1.3k。Webview 已即时处理已有事件，瓶颈在 runner 缺少逐响应统计入口。
- `response_completed.usage` 在每次模型响应完成、工具执行之前抵达。实测与最终原生 `context_tokens` 一致的口径是 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens`；缓存输入独立计数，输出已包含推理，不另行加减推理 token。
- 新解析器严格校验同会话、事件类型、非负安全整数、必要输入/输出以及求和溢出。缓存字段缺省为 0，显式非法字段拒绝。整轮累计 `turn_completed` / `turn_usage` 继续忽略。
- runner 仅在 prompt 活跃时消费逐响应值，直接替换最近用量并沿用已知窗口上限；原生快照随时校准。相同 token 和窗口上限的通知去重，上限单独变化仍通知；新 prompt 继续回放最近有效值。原有完成后末尾快照、取消、错误与宿主归属隔离继续生效。
- 刷新粒度为模型响应完成或原生状态快照。长时间单次生成、工具执行期间没有新的原生计数时保留最近读数。简写有舍入，悬停可看精确整数。
- Context7 查询被取消，未取得正文且未重试；协议依据来自本机官方 CLI 文档与隔离真实 CLI 验证。

## 实现与回归

- `src/interactive/grokAppServerProtocol.ts`：新增 `readGrokResponseContextTokens`。
- `src/interactive/grokRunner.ts`：接入活跃响应读数、快照校准与相同用量去重。
- 两个相邻测试文件新增协议口径、缓存/推理、多步执行中刷新、异会话、非法数据、零值、下降、窗口变更、结束和取消保护回归。
- 未增加用户可见文案，复用既有中英文标签与精确用量 title，无新增 i18n 项。

## 最终验证

- `npm run build`：通过。
- `node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js`：52/52 通过。
- 扩大回归：`node --test dist/test/interactive/grokReplayStream.test.js dist/test/interactive/codexTokenUsage.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/core/contextCompactionRunner.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js`：164 项，163 通过，1 失败。
- 范围外失败：`collapses three or more consecutive instruction bubbles until toggled`，期望“已折叠(3 个)”，实际“已折叠(4 个)”。测试及对应气泡折叠实现均属于工作区内其他正在进行的修改，与本轮协议和 runner 用量修改无关；保留并记录，未扩大修复。
- 真实 Grok 1.0.62：隔离 HOME / GROK_HOME / 工作目录 + 本地 chat_completions API，无真实密钥或付费模型调用。单轮两次模型响应与一次 `printf` 工具执行，修复前仅 `1343 → 16020`；修复后执行中约 574ms / 640ms / 3160ms 收到 `1343 → 12050 → 16020`，约 3235ms 最终原生快照同为 16020 且被去重。
- 第二次模型响应原生输入 13000、缓存读取 3000、输出 20、推理 10，当前窗口 16020；整轮累计输入 28000，证实缓存、推理及累计消耗均按原生口径处理。
- Chromium：生产 Webview HTML / JS / CSS + 隔离宿主消息桥，重放真实 runner 用量；8 个结构化交互场景全部通过：提交并观察 1.3k → 12k → 16k 与精确 title、430px 窄屏、运行时切换 Grok Tab 并后台更新后切回、合法零值、用量下降、停止保留、无读数报错占位、Codex 对照。无 browser / HTTP / request 错误，窄屏标签可见且不与按钮重叠。
- `git diff --check`：通过。
- ontology：JSON 有效，Grok 规则 7 个 source refs 及所用 anchors 均有效。全量 `--validate` 的 15 处失效引用与 HEAD 基线逐项一致，涉及既有缺失设计文档；本轮未增加失效引用。

## 风险、回滚与验证范围

- 逐响应口径已在 Grok 1.0.62 本机验证；若 CLI 未提供有效原生统计，继续保留最近读数或等待占位。
- 回滚可只撤回本轮协议、runner、相邻测试及同步文档的对应变更；保留工作区其它改动。
- 未运行完整单测套件、付费模型或 VS Code Extension Development Host 的整插件端到端验证；浏览器验证范围为生产 Webview 与隔离消息桥，真实 CLI 验证独立覆盖 runner 链路。
- 本轮已构建，未安装、发布或提交插件。用户使用新的扩展构建并重载后开始新任务可观察刷新。

## 文档与记忆

- 已同步 `.ch/docs/runbooks/grok-model-config.md`、`.ch/docs/references/cli-runtime-reference.md`、能力规格、FEATURE_INVENTORY 和 ontology。
- 分层边界保持现状，ARCHITECTURE.md 无本轮修改；可复用根因、计数口径和验证方法已直接沉淀 Grok runbook，无需重复写入热区、ROLLING_SUMMARY 或 EVENT_MEMORY。
- 本轮探针、场景、日志和截图仅用于本机验证，收尾清理；关键输入、输出和结论保留在本计划及 runbook。
