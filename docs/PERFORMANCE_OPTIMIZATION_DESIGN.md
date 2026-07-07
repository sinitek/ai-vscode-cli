# VS Code 插件性能优化详细设计

## 1. 背景与目标

本设计面向 `sinitek-cli-tools` VS Code 插件的后续性能优化实施。插件当前在 VS Code 内提供 AI 对话面板，统一接入本地 `codex`、`claude`、`gemini` 等 CLI，并承担配置中心、会话管理、Loop 多智能体任务、本地日志与状态持久化等职责。根据本轮静态调研，当前性能风险主要集中在启动激活、Webview 渲染、CLI 流处理、本地 JSON 存储和 Loop 任务目录扫描等路径。

本文档的目标是：

- 给出可执行的性能优化详细设计，供后续拆分开发任务。
- 汇总已发现的候选性能风险，明确证据路径、触发场景、影响、建议设计、复杂度/风险和验证指标。
- 将静态调研结论与待 Profile 量化项区分开，避免把候选风险误写为已证实线上故障。
- 保持现有技术栈、用户数据目录和 CLI 协议兼容，不做未批准的大规模重构。

非目标：

- 不在本文档阶段直接修改源码或改变默认用户行为。
- 不替换 VS Code Webview、Node 文件存储或现有 CLI runner 技术栈。
- 不承诺具体收益数值；收益需要通过后续基准场景和 Profile 数据确认。

## 2. 现状架构摘要

插件结构与分层以 `ARCHITECTURE.md` 为准：

- 扩展编排层：`src/extension.ts` 负责激活、命令注册、状态管理、会话与标签页编排、Loop 主子任务编排。
- Webview/UI 层：`src/webview/` 负责聊天面板、配置中心、Loop 群聊面板、消息协议和前端渲染。
- CLI/Interactive 层：`src/cli/` 负责一次性命令执行与探测，`src/interactive/` 负责 Codex/Claude 等交互型 runner 与 session 续接。
- Config/State 层：`src/config/`、`src/sessionStore.ts`、`src/lobsterTaskStore.ts`、`src/workspaceSettingsStore.ts`、`src/promptHistoryStore.ts`、`src/modelSelectionStore.ts` 负责本地配置和状态读写。
- 本地资源层：`~/.sinitek_cli/` 存储会话、消息、Loop 任务、沟通文件、日志、配置状态；长期记忆索引位于工作区 `.ch/docs/generated/memory-index/`。

当前设计的优点是面板打开后上下文较完整，配置中心、会话恢复、Loop 群聊和 CLI 可用性提示都能较早就绪。代价是启动期和长任务运行期会集中承担较多 IO、JSON 解析、Webview 重绘和子进程探测工作。以下问题均为静态调研识别出的候选风险，必须通过后续 Profile 和基准数据量化。

## 3. 性能风险总览

| 优先级 | 风险域 | 候选问题 | 主要证据 | 量化状态 |
| --- | --- | --- | --- | --- |
| P0 | 启动/激活 | `onStartupFinished` 与默认自动开面板放大启动期工作量 | `package.json` activationEvents；`src/extension.ts activate`；`src/panelStateBuilder.ts` | 待测 |
| P0 | 启动/激活 | 激活时同步加载多类状态并启动维护任务 | `src/extension.ts activate`；`src/sessionLifecycle.ts`；`src/sessionStore.ts` | 待测 |
| P0 | Webview/UI | 主聊天全量重渲染，流式 delta 未按帧节流 | `src/webview/viewContentScript/messageRendering.ts`；`traceRendering.ts` | 待测 |
| P0 | CLI/日志 | 长输出与 debug 日志造成内存、消息和日志 IO 压力 | `src/extension.ts` 流处理；`src/logger.ts` | 待测 |
| P1 | Webview/UI | Run Stream 每条增量重绘全部记录，缺少背压 | `src/webview/viewContentScript/runStreamAndQueue.ts` | 待测 |
| P1 | Loop | 群聊 5 秒轮询与整页 HTML 替换 | `src/webview/lobsterDebatePanel.ts`；`src/panelStateBuilder.ts` | 待测 |
| P1 | 存储 | 会话、消息、Loop 任务 JSON 全量读写 | `src/sessionStore.ts`；`src/lobsterTaskStore.ts` | 待测 |
| P1 | 配置 | 配置心跳、CLI 探测和配置中心 bundle 冷启动 | `src/webviewCommandCoordinator.ts`；`src/cli/commandRunner.ts`；`src/webview/configView.ts` | 待测 |
| P2 | 本地维护 | 目录扫描、长期记忆索引和进程关闭策略可优化 | `src/lobsterTaskStore.ts`；`src/memory/*`；`src/cli/commandRunner.ts` | 待测 |

## 4. 详细问题清单

### 4.1 P0：启动自动激活与默认自动打开面板

- 证据文件路径：
  - `package.json`：`activationEvents` 包含 `onStartupFinished`，`sinitek-cli-tools.autoOpenPanel` 默认值为 `true`。
  - `src/extension.ts`：`activate()` 尾部在 `getAutoOpenPanel()` 为真时执行 `sinitek-cli-tools.openPanel`。
  - `src/commandRegistry.ts`：`openPanel` 会 reveal 面板并触发 `postPanelState`。
  - `src/panelStateBuilder.ts`：`buildPanelStateWithDeps()` 会组装配置、会话、prompt history、Loop 群聊、模型与编辑器上下文等完整状态。
- 触发场景：VS Code 启动完成后，即使用户本轮没有打开插件，也会激活扩展；默认配置下还会自动打开面板并构建完整状态。
- 性能影响：可能把 Webview 解析、状态构建、配置读取和历史恢复提前到启动后，与用户打开工作区后的其他插件竞争 Extension Host 时间片。
- 建议设计：
  - 将 `onStartupFinished` 保留为可选轻量入口，默认只做命令注册、必要迁移和最小状态指针加载。
  - 将自动打开策略改为“用户显式开启”或“上次会话已打开面板时恢复”，避免首次安装默认自动开。
  - 面板打开后拆成 `skeleton state` 与 `hydrate state` 两阶段：首屏只渲染当前 CLI、输入框和运行按钮；会话列表、prompt history、Loop 群聊、模型列表异步补齐。
- 实施复杂度/风险：中等。涉及默认行为，需要迁移说明和配置兼容；Webview 需要支持部分状态和 loading UI。
- 验证指标：Extension activation P50/P95、启动后 10 秒 `~/.sinitek_cli` 读写次数、未打开面板时 Webview 创建次数、主动打开面板到首屏可交互耗时。

### 4.2 P0：启动期同步状态加载与即时写回

- 证据文件路径：
  - `src/extension.ts`：`activate()` 中依次执行 `loadSessionStore()`、`loadPromptHistoryStore()`、`loadWorkspaceSettings()`、`loadModelStore()`、`initializeConversationTabsFromWorkspaceSettings()`、`repairSupersededLocalSessions()`。
  - `src/sessionLifecycle.ts`：会话加载包含 normalize、清理 stale artifact，并可能立即持久化。
  - `src/sessionStore.ts`、`src/workspaceSettingsStore.ts`、`src/promptHistoryStore.ts`、`src/modelSelectionStore.ts`：多处使用同步 `existsSync/readFileSync/writeFileSync` 读取或写入 JSON。
- 触发场景：每次扩展激活都会加载多类状态；历史会话、prompt history、模型配置和 workspace settings 越大，启动路径成本越高。
- 性能影响：同步 IO 和 JSON parse/stringify 在 Extension Host 主线程执行，可能造成启动卡顿和磁盘抖动；normalize 后立即写回会放大启动期写入。
- 建议设计：
  - 引入 `ActivationStateLoader`，将状态分为 `critical`、`panelHydration`、`maintenance` 三类。
  - `critical` 只加载当前 CLI、workspaceKey、当前 tab/session 指针和必要运行状态。
  - `panelHydration` 在面板可见后异步加载 prompt history、完整会话列表、模型 store、Loop 群聊历史。
  - `maintenance` 类 normalize/repair 只在检测到脏数据且进入 idle 窗口后写回。
- 实施复杂度/风险：中等偏高。惰性加载会改变部分字段的可见时机，需要前后端协议兼容 partial state。
- 验证指标：激活期间同步 fs 调用次数、状态加载耗时分布、首次面板 hydrate 完成耗时、历史数据 1MB/5MB/20MB 下启动延迟。

### 4.3 P0：启动清理历史、配置心跳、CLI 探测和选区监听

- 证据文件路径：
  - `src/extension.ts`：`startHistoryArtifactRetentionCleanup()` 激活后立即 `scheduleHistoryArtifactRetentionCleanup()`，清理 logs、task store、Loop task store、Loop communication、prompt history 和 session retention。
  - `src/extension.ts`：`startConfigHeartbeat()` 使用 `CONFIG_HEARTBEAT_INTERVAL_MS` 创建 5 秒配置心跳。
  - `src/webviewCommandCoordinator.ts`：心跳 `poll()` 会读取配置状态、模型 store，并在变化时构建 state 后 `postState`。
  - `src/extension.ts`：`refreshCliInstallStatuses()` 对 `CLI_LIST` 并发探测全部 CLI。
  - `src/cli/commandRunner.ts`：macOS 下 `isCliCommandAvailable()` 可能通过 shell `command -v` 派生子进程。
  - `src/extension.ts`：`onDidChangeActiveTextEditor` 与 `onDidChangeTextEditorSelection` 直接调用 `postEditorContextState()`。
- 触发场景：扩展激活后，不论面板是否可见，都会启动清理、轮询、CLI 探测和编辑器事件监听。
- 性能影响：清理和探测会与启动状态加载竞争 IO 和子进程资源；5 秒心跳会形成长期后台读盘；快速移动光标或多光标编辑会产生高频 Webview 消息尝试。
- 建议设计：
  - 历史清理延迟到启动后 30-120 秒、VS Code idle 或面板不可见低优先级队列；记录最近清理时间，未超过 24 小时直接跳过。
  - 配置心跳仅在聊天面板或配置中心可见时启用；不可见时暂停或降频到 60-120 秒，并保留低频兜底。
  - CLI 安装状态改为按需探测：当前 CLI、配置中心打开、切换 CLI 或执行前探测；用 `command + PATH + macTaskShell` 做 TTL 缓存，并发限制为 1。
  - 编辑器上下文发送加可见性 gating、100-250ms debounce 和 distinct state 对比；真正执行“添加上下文”时同步读取最新 editor state。
- 实施复杂度/风险：中等。需要维护可见性状态和缓存失效逻辑；FileSystemWatcher 对 home 目录的跨平台可靠性需要兜底轮询。
- 验证指标：启动后 shell 子进程数量、清理任务扫描文件数与耗时、面板不可见时心跳 tick 次数、连续移动光标 5 秒 `editorContext` postMessage 次数。

### 4.4 P0：主聊天全量重渲染与流式 delta 节流不足

- 证据文件路径：
  - `src/webview/viewContentScript/messageRendering.ts`：`renderMessages()` 使用清空消息容器再重建 DOM 的模式，消息 bubble 通过 `safelyRenderMessageContent()` 渲染 Markdown/HTML。
  - `src/webview/viewContentScript/traceRendering.ts`：`appendAssistantDelta()`、trace/tool 折叠状态变更等路径会调用 `renderMessages()`。
  - `src/webview/viewContentScript/windowMessageDispatch.ts`：收到扩展侧 delta 后调用 `appendAssistantDelta()`。
- 触发场景：长对话、模型持续流式输出、trace/tool 输出较多、切换历史会话或恢复大消息列表。
- 性能影响：消息数和 Markdown 内容增长后，全量清空、重建 DOM 和 Markdown 渲染成本随消息规模增长；高频 delta 会把 O(n) 渲染放大为多次重复主线程工作。
- 建议设计：
  - 为消息列表引入 keyed incremental renderer，按 `message.id/runId/traceId` 更新单个 bubble。
  - 流式 assistant delta 在 Webview 侧按 `requestAnimationFrame` 或 50-100ms 合并刷新，最终消息完成时再做一次完整 Markdown finalize。
  - trace/tool 折叠状态从全量 `renderMessages()` 改为局部 class/attribute 更新。
  - 对历史会话和超长对话引入虚拟列表或分页加载，首屏只渲染最近 N 条消息。
- 实施复杂度/风险：高。触及聊天核心渲染，需覆盖 Markdown、trace/tool、Loop 系统消息、会话切换和复制/折叠状态。
- 验证指标：1k/5k 消息渲染耗时、持续 delta 下每秒 DOM 节点创建数、Webview long task 次数、流式输出期间输入框响应延迟。

### 4.5 P1：Run Stream 全量重绘与背压

- 证据文件路径：
  - `src/webview/viewContentScript/runStreamAndQueue.ts`：`renderRunStreamRecord()` 渲染单条记录，`renderRunStream()` 清空 `runStreamContent.innerHTML` 后重新 append 全部记录。
  - 同文件 `formatRunStreamExpandedContent()` 会对 JSON 内容尝试 parse/pretty print。
- 触发场景：CLI stdout/stderr event 流较细，用户打开运行流浮层，Codex/Claude/Gemini 输出大量 trace 或原始 JSON。
- 性能影响：每条新 chunk 触发全量重绘会产生 O(n²) 累积成本；大 JSON 频繁 pretty print 会增加 Webview 主线程 CPU。
- 建议设计：
  - 将 Run Stream 记录改为 append-only DOM 更新，保存 `recordId -> node`。
  - 对高频 chunk 做 bounded queue 和 frame-based flush，超过阈值时合并相邻 stdout/stderr。
  - JSON pretty print 延迟到用户展开记录时执行，并对最大解析字节数设上限。
  - 对历史 Run Stream 只保留最近 N 条实时 DOM，完整内容保留在可导出文本或扩展侧持久化。
- 实施复杂度/风险：中等。需要保证过滤、展开、复制和滚动到底行为不回退。
- 验证指标：10k Run Stream 记录追加耗时、打开浮层耗时、JSON 展开耗时、丢帧或 long task 次数。

### 4.6 P1：Loop 群聊 5 秒轮询与整页 HTML 替换

- 证据文件路径：
  - `src/webview/lobsterDebatePanel.ts`：`WebviewPanel` 使用 `retainContextWhenHidden`；`update()` 每次设置 `panel.webview.html = buildLobsterDebateChatPanelHtml(...)`。
  - 同文件前端脚本 `startAutoRefresh()` 每 5 秒在可见且对话框未打开时 `requestRefresh()`。
  - `src/panelStateBuilder.ts`：`buildLobsterGroupChatHistoryState()`、Loop 群聊状态构建会读取和解析群聊 transcript。
  - `src/lobsterTaskStore.ts`：Loop 任务记录和沟通目录均落在本地 JSON/Markdown 文件。
- 触发场景：Loop 模式运行中打开群聊面板，主任务和多个子任务持续追加沟通文件，群聊 transcript 增长。
- 性能影响：每 5 秒扩展侧读取/解析状态并重建完整 HTML；Webview 端整页替换导致脚本和事件监听重建。长 transcript 下容易同时放大 Extension Host IO 和 Webview parse/DOM 成本。
- 建议设计：
  - 群聊面板首次加载完整 snapshot，后续通过 `postMessage` 发送增量事件或状态 patch。
  - 扩展侧维护 `taskId -> transcriptCursor`，只读取新增内容；必要时用文件 size/mtime 判断是否变化。
  - 可见时短轮询，不可见时暂停；运行中可由任务写入路径主动触发 refresh，低频轮询只作为兜底。
  - 超长群聊按 round/batch 分段渲染，默认只展开最近阶段。
- 实施复杂度/风险：中等偏高。需要维护旧 transcript 兼容和“继续执行/中止/补充需求”等动作状态一致性。
- 验证指标：群聊 1k/10k 条消息下刷新耗时、5 分钟运行期间整页 HTML 写入次数、扩展侧 transcript read bytes、Webview long task 次数。

### 4.7 P1：配置中心 Monaco、大 bundle 懒加载与 DOM i18n 扫描

- 证据文件路径：
  - `src/webview/configPanel.ts`：配置中心 `WebviewPanel` 使用 `retainContextWhenHidden`。
  - `src/webview/configView.ts`：配置中心 HTML 加载 `media/config/assets/index-*.js`、CSS、`config-app-api/store/ui.js` 等资源。
  - `media/config/monaco-editor/`：存在 Monaco 静态资源目录。
  - `media/config/config-app-api/i18n/en.js`：英文界面通过运行时翻译函数处理 DOM 文本。
- 触发场景：首次打开配置中心、切换语言后 reload、远程环境或低性能机器打开配置页、动态 DOM 增长后重新翻译。
- 性能影响：配置中心首屏 JS parse/compile 可能成为冷启动热点；Monaco 如果进入首屏 bundle 或过早初始化，会拖慢配置页打开；DOM 递归翻译会随节点数增长。
- 建议设计：
  - 配置中心拆分首屏基础 bundle 与编辑器/Monaco bundle，只有进入规则编辑、JSON 编辑或高级配置时加载 Monaco。
  - 构建资源 manifest，避免运行时扫描 assets 文件名；配置面板打开时直接按 manifest 引入。
  - i18n 从运行时 DOM 文本替换迁移为数据驱动渲染；动态节点由组件渲染时写入已翻译字符串。
  - 对配置中心保留 `retainContextWhenHidden`，但增加“配置变化时局部刷新”而不是 reload 整页。
- 实施复杂度/风险：中等。涉及前端构建产物和配置中心初始化路径，需要确认现有构建脚本和静态资源发布流程。
- 验证指标：配置中心首次打开到可交互耗时、JS bundle 体积和 parse/compile 时间、Monaco chunk 加载次数、英文界面初始化 DOM 遍历耗时。

### 4.8 P0：debug 日志、消息压力与 CLI 子进程流缓冲

- 证据文件路径：
  - `src/extension.ts`：CLI 运行路径在 stdout/stderr chunk 到达时累积 `rawStdout/rawStderr`，并向 Webview 发送 delta/run stream。
  - `src/logger.ts`：`logCliInteractiveOutput()` 每段流内容都会写日志；`appendToSegmentedLog()` 每次写入前通过 `resolveSegmentedLogPath()` 读取日志目录并 stat 最新 segment。
  - `src/interactive/codexRunner.ts`：Codex app-server runner 使用 `stderrChunks: Buffer[]` 累积 stderr；`assistantBuffers` 与 `emittedTraceContents` 按 item 缓冲内容。
  - `src/cli/commandRunner.ts`：一次性 `runCliStream()` 将 stdout/stderr data 直接传给 handler，进程关闭策略与 interactive runner 分叉。
- 触发场景：debug logging 开启、长 Codex/Claude/Gemini 任务、trace/tool/event 大量输出、多个 Loop 子任务并发运行。
- 性能影响：Extension Host heap 随长 stdout/stderr 和 stderrChunks 线性增长；每 chunk 写 debug 日志可能造成目录扫描和 append 队列积压；Webview 消息量高时增加前端渲染压力。
- 建议设计：
  - 引入 `BoundedTextBuffer` / `BoundedBufferCollector`，默认保留 tail 和总字节数，不在内存中无上限保留完整 raw stdout/stderr。
  - debug 完整原始流改为可选“完整流文件”，默认记录摘要、tail 和事件计数。
  - logger 为 `baseFilename` 维护 segment cache，避免每次 append 都 `readdir`；对流日志做 100-250ms batch flush。
  - Codex runner 在 item completed 后释放 `assistantBuffers` / `emittedTraceContents`；stderr 错误展示 tail，并提示 debug 日志位置。
  - 扩展侧到 Webview 的 delta/run stream 增加队列上限、合并策略和 flush 节流。
- 实施复杂度/风险：中等偏高。需要确保 debug 诊断可追溯性和错误信息完整性；默认截断策略必须用户可理解。
- 验证指标：30 分钟 debug 长任务 heap 峰值、每秒 `fs.readdir/stat/appendFile` 次数、Webview postMessage 数量、stderr 10MB 错误路径内存峰值。

### 4.9 P1：任务、会话和 Loop JSON 全量读写

- 证据文件路径：
  - `src/sessionStore.ts`：会话 store 使用同步 `readFileSync/writeFileSync(JSON.stringify(..., null, 2))`；消息保存写入完整 `{ messages }`。
  - `src/sessionLifecycle.ts`：加载历史会话时读取并 parse 完整消息文件，再发送给 Webview。
  - `src/extension.ts`：交互运行追加消息后通过 debounce 持久化，但持久化仍写当前 tab 完整消息数组。
  - `src/lobsterTaskStore.ts`：Loop 任务记录更新和追加 round 时读完整 store、修改数组、写完整 store。
- 触发场景：长会话消息数多、单条消息大、Loop rounds/subTasks/debateRounds 增长；并发子任务同时更新同一个 task store。
- 性能影响：同步 JSON parse/stringify 在 Extension Host 主线程执行；漂亮格式 JSON 增加写入字节；并发更新同一 JSON store 存在最后写入覆盖其他字段的风险。
- 建议设计：
  - 会话消息迁移为 append-only JSONL 或分段消息日志，保留 compact snapshot 用于快速加载最近状态。
  - Loop 任务记录拆成 task meta、rounds/subtasks patch log，或至少引入 per-task async write queue 与 compare-and-merge。
  - 热路径改为 `fs.promises`，并按字节数/时间窗口合并保存，不按固定 200ms 写完整大对象。
  - 保留旧 JSON 格式读取兼容，首次写入新格式时生成 manifest/version。
- 实施复杂度/风险：高。涉及持久化格式迁移、并发一致性、恢复旧任务、测试 fixture 和回滚路径。
- 验证指标：1MB/5MB/20MB 消息文件加载/保存耗时、Loop 并发 6 子任务 store 冲突率、旧格式迁移测试、event-loop delay。

### 4.10 P2：目录扫描、长期记忆索引和进程关闭策略

- 证据文件路径：
  - `src/lobsterTaskStore.ts`：`listLobsterTaskStoreFiles()` 递归查找所有 `lobster-tasks.json`；cache miss 按 taskId 查找时遍历候选文件；沟通目录清理通过递归 stat/readdir 计算最新 mtime。
  - `src/memory/memoryFiles.ts`：读取长期记忆 hot files 和 PITFALLS。
  - `src/memory/memoryRecall.ts`：`buildWorkspaceMemoryRecallPack()` 每次先 `buildWorkspaceMemoryIndex()`，再写 recall pack。
  - `src/memory/memoryIndexer.ts`：`writeWorkspaceMemoryIndex()` 写 `index.md`、`recall-index.md`、`observations.jsonl`、`manifest.json`。
  - `src/cli/commandRunner.ts` 与 `src/interactive/codexRunnerProcess.ts`：one-shot runner 与 app-server runner 的 graceful shutdown 策略不同。
- 触发场景：长期使用 Loop 后任务目录数量大；长期记忆文件增长；用户频繁停止任务或 Loop 子任务并发结束。
- 性能影响：递归目录扫描、全量索引和 generated 文件重复写会造成后台 IO；进程关闭策略分叉增加维护成本，过短 grace period 可能诱发 SIGKILL 和重试。
- 建议设计：
  - 维护轻量 `task-index.json` 或 JSONL，记录 `taskId -> storeFile, updatedAt, communicationDir`，写任务时增量更新，清理时按索引候选处理。
  - 沟通目录写 task-level `updatedAt` marker，避免清理时递归计算整棵树 mtime。
  - 长期记忆索引基于 source file mtime/size/hash 增量构建；manifest 未变时跳过 generated 写入。
  - 统一进程生命周期 helper，close 后清理 kill timer；grace period 可配置或按 stdout/stderr 活动自适应。
- 实施复杂度/风险：中等。索引文件需要修复路径和一致性校验；进程关闭策略需要跨平台测试。
- 验证指标：1k/10k task dirs 下 taskId resolve 耗时、清理 event-loop delay、memory 100KB/1MB/5MB recall 构建耗时、stop-to-close P95、SIGKILL 比例。

## 5. 优化总体方案

总体方案按“先可观测、再降启动面、再增量化热路径、最后调整存储结构”推进。

### 5.1 可观测优先

在任何行为变更前，先为以下路径增加轻量性能事件：

- `activate` 总耗时和阶段耗时：配置迁移、state load、runner manager、panel provider 注册、清理启动、CLI probe。
- Webview 首屏和 hydrate：HTML 创建、state size、postMessage size、Webview ready。
- 流式输出：delta chunk 数量、合并前后消息数、Run Stream 记录数、Webview flush 耗时。
- 本地 IO：session/task/log/memory 的 read/write 次数、字节数、JSON parse/stringify 耗时。
- Loop：task store resolve 耗时、群聊 transcript read bytes、面板 refresh 耗时。

日志默认只输出摘要；debug 模式输出详细指标。指标名应可检索，例如 `perf.activate.phase`, `perf.webview.hydrate`, `perf.stream.flush`, `perf.store.write`, `perf.lobster.refresh`。

### 5.2 启动面收缩

- 保持扩展命令和 view provider 注册快速完成。
- 默认不把维护型任务和完整面板状态构建放在 `activate()` 热路径。
- 对自动打开面板、CLI 探测、配置心跳和历史清理增加用户动作或可见性 gating。

### 5.3 UI 增量化与背压

- 主聊天消息和 Run Stream 从全量重绘改成 keyed incremental update。
- 对流式 delta、trace、run stream 和 debug UI 消息统一使用 bounded queue。
- 长列表使用分页、虚拟化或最近 N 条首屏策略。

### 5.4 存储增量化

- 短期先做写入队列、节流、缓存和 dirty check。
- 中期迁移会话消息和 Loop 任务为 append-only / patch log + compact snapshot。
- 保留旧 JSON 读路径和迁移 fixture，避免破坏历史任务。

### 5.5 后台维护分批异步化

- 清理任务、索引修复、日志 prune、Loop communication retention 都应分批执行并让出 event loop。
- 使用最近执行时间、目录大小阈值和用户可见性综合决定是否启动维护任务。

## 6. 分阶段实施计划

### P0：基线与低风险止血

可拆分任务：

1. 增加性能埋点和开发态诊断面板/日志摘要。
2. 将历史清理延迟到 idle/定时窗口，并加入最近清理时间戳。
3. CLI 安装状态探测改为当前 CLI 按需探测，并增加 TTL 缓存。
4. 配置心跳按面板/配置中心可见性启停，不可见时暂停或降频。
5. 编辑器选区事件增加 debounce 和 distinct state。
6. 主聊天 assistant delta 做 `requestAnimationFrame` 合并，降低流式期间全量 render 频率。
7. debug raw stdout/stderr 改为 bounded buffer，日志 append 加批量 flush。

验收标准：

- 不改变用户数据格式。
- 默认启动后非使用场景 shell probe 数量为 0 或最多当前 CLI 1 次。
- 面板不可见时配置心跳不再 5 秒读盘。
- 长输出任务 Webview 消息量和日志 IO 明显可观测下降。

### P1：核心热路径增量化

可拆分任务：

1. 主聊天消息 keyed renderer，trace/tool 折叠局部更新。
2. Run Stream append-only DOM 与背压队列。
3. Loop 群聊 snapshot + incremental patch，停止整页 HTML 替换。
4. 配置中心资源 manifest、Monaco 懒加载、DOM i18n 数据化。
5. 日志 segment cache，避免每次 append 扫描日志目录。
6. Codex app-server `stderrChunks`、`assistantBuffers`、`emittedTraceContents` 生命周期释放。

验收标准：

- 长会话切换、持续 delta、Run Stream 大量记录下 Webview long task 减少。
- Loop 群聊运行时刷新不再每 5 秒重建整页 HTML。
- 配置中心首屏可交互时间下降，Monaco 只在需要时加载。

### P2：存储结构与目录索引

可拆分任务：

1. 会话消息 JSONL/分段日志 + compact snapshot 设计与迁移。
2. Loop task store patch log 或 per-task write queue + compare-and-merge。
3. `task-index.json` / JSONL 索引与后台修复流程。
4. 长期记忆增量索引与 generated 写入跳过机制。
5. 统一进程生命周期 helper 和可配置 graceful shutdown。

验收标准：

- 旧 JSON 格式可读，迁移可回滚。
- 并发子任务更新不会覆盖其他字段。
- 大任务目录和大 memory 文件下清理、召回和恢复耗时可控。

## 7. 验证指标与基准场景

### 7.1 基础指标

- Extension activation：总耗时、阶段耗时、主线程同步 IO 次数。
- Webview 首屏：打开面板到 skeleton 可交互、完整 hydrate 完成、state payload 字节数。
- Webview 渲染：DOM 节点创建数、long task 次数、最大帧间隔、滚动和输入延迟。
- 流式链路：prompt 到首条 delta、delta 合并比例、postMessage 次数、Run Stream flush 延迟。
- 本地 IO：read/write/append/readdir/stat 次数、字节数、JSON parse/stringify 耗时。
- 子进程：启动后 shell probe 数量、stop-to-close P95、SIGKILL 次数。
- Loop：task store resolve 耗时、群聊 refresh 耗时、并发写冲突率。

### 7.2 基准场景

1. 冷启动不使用插件：打开普通工作区，10 秒内不点击插件面板，记录 activation、IO、shell probe、heartbeat。
2. 主动打开聊天面板：测 skeleton 可交互和 hydrate 完成耗时，历史数据分别为小/中/大三档。
3. 长对话恢复：加载 1k/5k 条消息，包含 Markdown、trace/tool、Loop 系统消息。
4. 流式长输出：模拟 10MB assistant delta 和 10k Run Stream 记录，比较节流前后 UI long task。
5. Debug 长任务：开启 debug logging 运行 30 分钟流式任务，记录 heap、日志 append 延迟和目录扫描次数。
6. Loop 并发任务：6 个子任务并发更新同一 task store，记录冲突、覆盖、写入耗时和群聊刷新耗时。
7. 配置中心冷启动：首次打开配置中心，测 JS 资源加载、parse/compile、Monaco 加载和 i18n 初始化耗时。
8. 大目录维护：构造 1k/10k Loop task dirs 和 communication dirs，测清理、索引、taskId resolve。
9. 长期记忆召回：memory 文件 100KB/1MB/5MB，测 recall index 构建和 generated 写入次数。
10. 停止/重试：频繁 stop、hidden retry、Loop 中止，测进程残留和 stop-to-close。

### 7.3 最小验证命令

后续代码实现阶段至少执行：

- `npm run build` 或项目现有 TypeScript 编译命令。
- 与修改模块就近的单元测试或新增 fixture 测试。
- 手工 Extension Host 验证：启动、打开聊天面板、打开配置中心、运行一次 Codex/Claude/Gemini、运行 Loop 群聊面板。

本文档阶段未修改源码，因此不要求运行 build。

## 8. 风险与回滚

| 风险 | 影响 | 缓解与回滚 |
| --- | --- | --- |
| 自动打开面板策略变化影响用户习惯 | 用户启动后不再自动看到面板 | 保留配置项；对已有 `autoOpenPanel=true` 用户做兼容迁移或提示；可一键恢复旧行为 |
| 惰性加载导致 UI 字段短暂缺失 | 面板初始状态显示 loading | Webview 协议支持 partial state；关键按钮不依赖完整历史 |
| 配置缓存失效不及时 | 切换配置后状态延迟更新 | 插件内写入后主动 invalidate；保留低频兜底轮询和手动刷新 |
| 流式节流降低实时感 | 用户感知输出不够即时 | 使用 50-100ms 或按帧 flush；最终消息不截断；提供 debug 开关对比 |
| 日志/缓冲截断影响排障 | 错误上下文不足 | 默认保留 tail、字节数、truncated 标记；debug 模式可启用完整流文件 |
| 存储格式迁移破坏历史数据 | 会话或 Loop 任务恢复失败 | 旧格式只读兼容、迁移前备份、fixture 覆盖大文件和旧版本 |
| Loop 增量群聊状态不一致 | 中止/继续按钮状态错误 | snapshot 定期校准；patch 带版本号或 cursor；异常时回退 full refresh |
| 进程关闭策略调整跨平台差异 | 残留进程或过早 kill | 抽象 helper 后按平台测试；保留原策略开关或降级路径 |

## 9. 附录证据索引

### 9.1 调研报告

- `/Users/fangjiawei/.sinitek_cli/lobster-communications/msg_1783395395900_f5bd6341bc9c38/subtasks/round-1-perf-architecture-activation-scan.md`
- `/Users/fangjiawei/.sinitek_cli/lobster-communications/msg_1783395395900_f5bd6341bc9c38/subtasks/round-1-perf-webview-ui-scan.md`
- `/Users/fangjiawei/.sinitek_cli/lobster-communications/msg_1783395395900_f5bd6341bc9c38/subtasks/round-1-perf-cli-process-storage-scan.md`
- `/Users/fangjiawei/.sinitek_cli/lobster-communications/msg_1783395395900_f5bd6341bc9c38/subtasks/round-1-perf-doc-baseline-map.md`

### 9.2 项目与事实来源

- `README.md`：插件定位、使用场景、流式展示概览。
- `ARCHITECTURE.md`：当前目录结构、分层边界、本地资源层。
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`：运行时架构、Webview、CLI、Loop、状态落盘和日志诊断事实来源。
- `.ch/docs/references/cli-runtime-reference.md`：CLI 支持矩阵、Loop 任务记录、配置和本地数据路径。
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`：用户可见能力与性能体验边界。
- `.ch/docs/runbooks/local-development.md`、`.ch/docs/TESTING.md`：后续实现阶段的构建和测试基线。

### 9.3 关键源码路径

- 启动/激活：`package.json`、`src/extension.ts`、`src/commandRegistry.ts`、`src/panelStateBuilder.ts`。
- 状态加载：`src/sessionLifecycle.ts`、`src/sessionStore.ts`、`src/workspaceSettingsStore.ts`、`src/promptHistoryStore.ts`、`src/modelSelectionStore.ts`。
- 配置心跳：`src/webviewCommandCoordinator.ts`、`src/extension.ts`。
- CLI 探测与进程：`src/cli/commandRunner.ts`、`src/interactive/codexRunner.ts`、`src/interactive/codexRunnerProcess.ts`。
- 主聊天 Webview：`src/webview/viewProvider.ts`、`src/webview/viewContent.ts`、`src/webview/viewContentScript/messageRendering.ts`、`src/webview/viewContentScript/traceRendering.ts`、`src/webview/viewContentScript/windowMessageDispatch.ts`。
- Run Stream：`src/webview/viewContentScript/runStreamAndQueue.ts`。
- Loop 群聊：`src/webview/lobsterDebatePanel.ts`、`src/panelStateBuilder.ts`、`src/lobsterTaskStore.ts`。
- 配置中心：`src/webview/configPanel.ts`、`src/webview/configView.ts`、`media/config/assets/`、`media/config/monaco-editor/`、`media/config/config-app-api/i18n/en.js`。
- 日志与存储：`src/logger.ts`、`src/sessionStore.ts`、`src/lobsterTaskStore.ts`。
- 长期记忆：`src/memory/memoryFiles.ts`、`src/memory/memoryRecall.ts`、`src/memory/memoryIndexer.ts`。

## 10. 后续文档同步建议

本次用户明确要求在 `/docs` 产出详细设计，因此本文档作为当前交付入口。若后续正式进入实施，建议同步：

- 新增或镜像 `.ch/docs/design-docs/vscode-cli-extension-performance.md`，作为长期设计事实来源。
- 更新 `.ch/docs/design-docs/index.md`，登记本文档状态、相关目录和实施计划。
- 若引入用户可见配置、缓存刷新入口、日志策略或自动打开行为变化，更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。
- 若实现过程中确认可复发踩坑，补充 `.ch/docs/runbooks/PITFALLS.md`。
