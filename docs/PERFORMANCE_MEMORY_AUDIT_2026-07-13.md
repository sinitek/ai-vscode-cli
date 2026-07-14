# VS Code 插件性能与内存风险审计报告

- 审计日期：2026-07-13
- 审计方式：静态代码审计
- 审计对象：2026-07-13 当前工作树（包含当时尚未提交的并行开发内容）
- 审计范围：扩展宿主、CLI/交互 Runner、Webview、配置中心、本地存储、日志和 Loop 任务
- 相关设计：`docs/PERFORMANCE_OPTIMIZATION_DESIGN.md`

## 1. 结论摘要

当前系统存在明确的性能问题和内存溢出风险。

本次没有发现崩溃转储、heap snapshot 或运行监控数据，因此不能断言系统已经发生过 OOM；但当前代码存在多条可由源码直接证明的无界增长路径。在长时间运行、大输出、长会话、多标签、多子代理或大附件场景下，这些路径可能导致：

- VS Code Extension Host 内存持续上升，极端情况下被系统或 VS Code 终止。
- Webview 内存持续上升、长任务增多、输入和滚动明显卡顿。
- CLI 或 SDK 任务在用户停止或扩展停用后继续占用进程、网络和文件资源。
- Extension Host 被同步文件 IO、全量 JSON 序列化和递归目录扫描阻塞。
- 调试日志生产速度超过磁盘消费速度时，Promise 队列和待写字符串持续堆积。

最需要优先处理的问题如下：

| 优先级 | 问题 | 主要后果 | 证据等级 |
| --- | --- | --- | --- |
| P0 | Claude 取消控制器未传给 SDK | 停止无效，后台查询、进程和闭包可能长期存活 | 已确认缺陷 |
| P0 | OpenCode 原始输出无界缓存，且每个 chunk 重扫全部历史 | Extension Host 堆增长，CPU 近似二次增长 | 已确认缺陷 |
| P0 | Run Stream 无界保留并在每个 delta 全量重建 DOM | Webview 堆增长，累计渲染 O(n²) | 已确认缺陷 |
| P0 | Assistant delta 重复解析完整 Markdown | 长回答时 Webview CPU 近似二次增长 | 已确认缺陷 |
| P0 | 附件上传无数量和字节限制 | Base64、IPC 和 Buffer 多份复制造成高内存峰值 | 已确认缺陷 |
| P0 | 扩展停用未停止所有运行进程 | OpenCode、并行任务或临时 Runner 可能残留 | 已确认缺陷 |
| P1 | 会话消息缓存无 LRU 和总字节预算 | 同一工作区内历史消息长期驻留 | 已确认风险 |
| P1 | 交互流每 200ms 同步重写完整会话 | Extension Host 卡顿和磁盘写放大 | 已确认性能问题 |
| P1 | Debug 日志逐 chunk 排队且每次扫描日志目录 | 无背压队列、内存和 IO 放大 | 已确认风险 |
| P1 | Loop 群聊每 5 秒重建完整 Webview | 长 transcript 下周期性 IO、解析和 DOM 抖动 | 已确认性能问题 |

## 2. 证据等级说明

本报告使用以下分类：

| 分类 | 含义 |
| --- | --- |
| 已确认缺陷 | 当前代码缺少必要接线或生命周期清理，触发后行为可以直接判定为错误 |
| 已确认风险 | 当前代码存在无界集合、无界缓冲或无总预算路径；是否达到 OOM 取决于负载 |
| 已确认性能问题 | 当前调用链必然重复做全量工作，复杂度或写放大可以由代码直接推导 |
| 待压测量化 | 昂贵机制已确认，但用户可感知阈值和实际峰值需要动态测量 |

行号以审计时工作树为准。仓库有并行开发时行号可能变化，因此每项同时给出符号名。

## 3. 已确认问题

### 3.1 P0：Claude 停止和释放没有真正取消 SDK 查询

证据：

- `src/interactive/claudeRunner.ts:292-329`，`ClaudeInteractiveRunner.abortController`、`dispose()`、`stopAndRebuild()`。
- `src/interactive/claudeRunner.ts:376-445`，`runStreamed()` 创建 `AbortController` 和 `queryOptions`。
- `src/interactive/claudeRunner.ts:587-590`，`executeQuery()` 调用 SDK `queryFn`。
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:403-411`，SDK `Options.abortController` 官方字段。

触发链：

1. `runStreamed()` 创建 `this.abortController = new AbortController()`。
2. 用户停止任务或 Manager 释放 Runner 时，代码调用 `abort()`。
3. 但 `queryOptions` 没有写入 `abortController`。
4. `queryFn({ prompt, options })` 因此无法收到取消信号。
5. 上层可以把运行状态标记为 stopped 并丢弃后续输出，但底层 SDK 查询、Claude 进程、工具调用和闭包仍可能继续运行。

已有保护及不足：

- `maxTurns: 200` 只限制 turn 数，不限制单次网络请求或工具调用的等待时间。
- `finally` 只在 async generator 自然结束后清理字段，不能终止已经挂起的 generator。
- 新运行会覆盖实例字段中的 controller；旧运行结束时还可能把新运行的 controller 清空。

建议：

- 把本次运行的 controller 保存为局部常量并写入 `queryOptions.abortController`。
- `finally` 仅在实例字段仍指向本次 controller 时清空。
- 增加“停止后 generator 在限定时间内结束”的单元/集成测试。
- 动态验证停止前后的 Claude 子进程、网络连接和 heap retained objects。

### 3.2 P0：扩展停用时没有停止所有运行进程

证据：

- `src/extension.ts:520-564`，`activeProcess`、`parallelRunsByTabId`、`interactiveRunsByTabId`。
- `src/extension.ts:922-925`，`deactivate()` 仅执行 `interactiveRunnerManager.disposeAll()`。
- `src/extension.ts:2859-2910`，现有 `stopParallelRunForTab()` 和 `stopRunForTab()`。
- `src/cli/commandRunner.ts` 的 `runCliStream()` 在 POSIX 使用 detached 进程组并通过 `RunProcess.kill()` 终止。

触发链：

1. OpenCode 主任务由 `activeProcess` 持有。
2. 并行任务由 `parallelRunsByTabId` 持有。
3. 尚未取得真实 session/thread ID 的临时 Codex/Claude Runner 可能还未被 Manager 完整接管。
4. VS Code reload、插件更新、禁用或停用扩展。
5. `deactivate()` 不杀 `activeProcess`，不遍历并行运行，也不调用 `interactiveRunsByTabId` 中的 `stop()`。

影响：

- OpenCode 进程树可能在扩展停用后继续执行。
- 临时交互运行和相关闭包可能继续存活。
- 用户看到扩展已停用，但后台仍可能访问文件、网络并占用 CPU。

建议：

- 在 `deactivate()` 中统一执行 idempotent 的 `stopAllRuns()`。
- 先禁止新运行，再停止主进程、并行进程、交互运行和受管 server，最后释放 Manager 与 Webview 资源。
- 为 reload/deactivate 场景增加进程残留测试。

### 3.3 P0：OpenCode stdout/stderr 无界累积，并按 chunk 重复扫描完整历史

证据：

- `src/extension.ts` 中 `runPromptParallel()` 的 `rawStdout`、`rawStderr` 和 `rawStdout += chunk`。
- `src/extension.ts` 中 `runPromptOneShot()` 的 `rawStdout`、`rawStderr`、`detectOpenCodeStreamActivity(rawStdout, rawStderr)`。
- `src/cli/commandRunner.ts:491-669`，`parseOpenCodeJsonOutput()`、`detectOpenCodeStreamActivity()`、`parseOpenCodeRunOutput()`。
- `src/openCodeTabStream.ts:15-20,99-101`，`displayedAssistantText` 保留另一份完整回答。

触发链：

1. 每个 stdout/stderr chunk 追加到完整字符串，运行期间没有字节上限。
2. one-shot 路径在每个 chunk 后把截至当前的完整 stdout/stderr 传给 activity 检测。
3. 检测函数再次按行切分、JSON.parse、清洗和收集完整输出。
4. 最终输出还会再被 `parseOpenCodeRunOutput()` 全量解析。
5. 可见回答、Run Stream、聊天消息和 debug 日志可能同时保存同一内容的多份副本。

复杂度：

- 内存随总输出线性增长，但同一内容存在多份副本。
- 若总输出分为 K 个近似等长 chunk，逐 chunk 重扫的累计 CPU 接近 O(K²)。
- 长 JSONL、工具输出和持续状态日志都可触发。

已有保护及不足：

- `SESSION_BUFFER_LIMIT = 4000` 只限制 session ID 识别缓冲，不限制 `rawStdout/rawStderr`。
- one-shot 60 秒 watchdog 只处理“启动后没有活动”；出现一次活动后没有总时长或总输出限制。
- hidden retry 只限制尝试次数，不限制单次尝试的输出量。

建议：

- 引入有总字节上限的流式 JSONL parser，不再每次重扫历史。
- 错误展示只保留 bounded tail、统计值和 truncated 标记。
- 如需完整 debug 原始流，直接流式写入临时日志文件，不在 heap 中保存第二份完整内容。
- 建议默认单流 tail 1-4 MiB，并对总输出、单行和未完成 frame 分别设上限。

### 3.4 P0：Run Stream 无界增长，并在每个 delta 全量重建 DOM

证据：

- `src/webview/viewContentScript/coreRuntimeState.ts:11-32`，每个 tab 的 `runStreamRecords`。
- `src/webview/viewContentScript/runStreamAndQueue.ts:244-276`，`updateRunStreamContent()`。
- `src/webview/viewContentScript/runStreamAndQueue.ts:297-318`，`appendRunRawStream()`。
- `src/webview/viewContentScript/runStreamAndQueue.ts:340-350`，`syncRunStreamOverlay()`。
- `src/webview/viewContentScript/windowMessageDispatch.ts:94-104`，每个 `rawStreamDelta` 都进入该链路。

触发链：

1. 每个 raw delta 被作为一条完整 record push 到数组。
2. 活动 tab 每次追加后都调用 `updateRunStreamContent()`。
3. 函数清空容器并遍历全部历史，为每条记录重新创建 `details/summary/pre`。
4. 即使 overlay 未打开，完整 DOM 仍会更新。
5. overlay 打开时，后续 `syncRunStreamOverlay()` 还会再次调用全量渲染。
6. 每条折叠记录的完整正文仍放入 `<pre>`，不是按展开懒加载。

影响：

- `runStreamRecords` 没有条数、单条字节或累计字节上限。
- N 条记录的累计 DOM 工作量至少 O(N²)，overlay 打开时同一 delta 可能全量渲染两次。
- 状态数组和 DOM 同时保留完整内容；导出时又构建一份完整 payload。

建议：

- 增加每 tab 最大记录数和最大累计字节数，超限时合并或丢弃最旧记录并显示 truncated 统计。
- raw delta 按 50-100ms 或 animation frame 批量 flush。
- overlay 未显示时不构建记录 DOM。
- 使用 append-only DOM、窗口化列表，详情正文仅在展开时生成。

### 3.5 P0：Assistant 流式回答重复解析完整 Markdown

证据：

- `src/webview/viewContentScript/traceRendering.ts:184-245`，`appendAssistantDelta()`。
- `src/webview/viewContentScript/messageRendering.ts:273-309`，`findRenderedMessageElement()`、`updateRenderedAssistantMessage()`。
- `src/webview/viewContentScript/messageRendering.ts:312-339`，`renderMessages()`。

触发链：

1. 每个 delta 执行 `target.content += content`。
2. `updateRenderedAssistantMessage()` 线性查找消息 DOM。
3. 对完整累计回答重新执行 Markdown/trace 渲染。
4. 使用 `bubble.innerHTML = ...` 替换整个气泡子树。
5. 下一 delta 再对更长的完整内容重复同样工作。

影响：

- 长回答、高频小 delta 下累计解析量接近 O(N²)。
- 折叠展示不会降低成本，因为完整正文在折叠前已经解析并写入 DOM。
- 普通 message/trace append 还会调用 `renderMessages()`，清空并重建整个会话 DOM。

建议：

- 将 delta 按 animation frame 或固定时间窗口合并。
- 流式阶段只追加纯文本或轻量预览，完成后再执行一次完整 Markdown finalize。
- 建立 `messageId -> DOM node` 索引，避免每次线性扫描。
- 历史消息采用分页或虚拟列表，普通 append 不重建整个会话。

### 3.6 P0：附件上传无大小和数量限制，存在明显内存峰值

证据：

- `src/webview/viewContentScript/runStreamAndQueue.ts:893-929`，`readFileAsDataUrl()`、`handleFileSelection()`。
- `src/webview/panelFileActions.ts:142-171`，`decodeDataUrl()`、`saveUploadedFiles()`。

触发链：

1. Webview 使用 `FileReader.readAsDataURL()` 把整个文件读入内存。
2. Base64 通常比原始文件大约增加 33%。
3. 多个文件的全部 Data URL 被保存在 `payloadFiles`，直到全部读取完成。
4. `postMessage` 对完整 payload 做跨进程传输/结构化克隆。
5. Extension Host 再用 `Buffer.from(base64)` 生成二进制副本。
6. 使用 `fs.writeFileSync` 同步写盘。

已有保护及不足：

- 临时文件 1 小时后清理只保护磁盘，不保护上传过程的堆内存。
- 逐个读取避免了多个 FileReader 同时工作，但所有已完成 Data URL 仍累积在数组中。
- 当前没有单文件大小、文件数量或总 payload 上限。

建议：

- Webview 和 Extension Host 两端都校验：单文件、文件数量和总字节。
- 优先通过受控文件路径传递本地文件，不使用 Base64 跨 Webview IPC；无法传路径时分块传输。
- 对拒绝场景增加中英文提示和边界测试。

### 3.7 P1：会话消息缓存无容量上限

证据：

- `src/extension.ts`，`sessionMessageCache` 和 `sessionMessageLoadErrors`。
- `src/sessionLifecycle.ts:329-354`，`loadMessages()` 将完整历史写入缓存。
- `src/sessionLifecycle.ts:391-400`，`saveMessages()` 保留完整数组。
- `src/extension.ts`，`buildSessionState()`、`resolveSessionFirstPrompt()`。

触发链：

1. 用户打开历史会话，完整消息文件被读取、解析并缓存。
2. 构建 session 列表时，旧记录缺少 `firstPrompt` 会触发加载完整历史。
3. local session 修复会遍历候选会话并加载完整消息。
4. 同一工作区内缓存没有 LRU、条目上限或总字节预算。

已有保护及不足：

- 30 天 retention 是时间窗口，不限制 30 天内会话数量和单会话大小。
- 工作区切换只清 `sessionMessageCache`，没有同时清 `sessionMessageLoadErrors`。
- 删除会话会清单项，但正常浏览过的历史会一直驻留到工作区切换或宿主结束。

建议：

- 使用按总估算字节和条目数双限制的 LRU。
- 运行中 tab、当前 tab 和未落盘草稿可 pin，其余历史按需加载和驱逐。
- 构建会话摘要时不要为了 `firstPrompt` 把完整消息永久放入主缓存。

### 3.8 P1：交互输出最多每 200ms 同步重写完整会话

证据：

- `src/extension.ts`，`schedulePersistForInteractiveRun()` 的 200ms timer。
- `src/extension.ts`，`persistMessagesForTab()`。
- `src/sessionLifecycle.ts:391-400`，`saveMessages()`。
- `src/sessionStore.ts:365-378`，`writeMessageFile()` 使用 `JSON.stringify(..., null, 2)` 和 `fs.writeFileSync`。

触发链：

1. assistant delta、trace 或子代理进度触发持久化调度。
2. 每 200ms 最多执行一次，但每次都遍历、清洗并序列化全部消息。
3. 同步覆盖整个 JSON 文件，直接阻塞 Extension Host 事件循环。
4. 多个并行 tab 各自拥有 timer，成本可以叠加。

影响：

- 写入成本为“持续时间 × 每秒最多 5 次 × 完整历史大小”。
- 长会话会明显放大 event-loop lag、磁盘写入和临时序列化内存。

建议：

- 改为异步、串行、可合并的 per-session write queue。
- 流式阶段降低保存频率，只保存增量日志；结束时写 compact snapshot。
- 对未变化内容跳过写入，避免 pretty JSON 用于高频热路径。

### 3.9 P1：Debug 日志队列无背压，每个 chunk 都扫描日志目录

证据：

- `src/logger.ts:9`，`logWriteQueues`。
- `src/logger.ts:138-164,227-242`，每个 stream/interactive chunk 写日志。
- `src/logger.ts:297-343`，`appendToSegmentedLog()`、`resolveSegmentedLogPath()`。

触发链：

1. 调用方使用 `void logCliStream()` 或 `void logCliInteractiveOutput()`，不等待磁盘。
2. 每个 chunk 创建一个 Promise 链节点并捕获待写字符串。
3. 每个节点执行时重新 `readdir` 日志目录、分析全部分片、`stat` 最新分片，再 append。
4. 磁盘消费慢于 CLI 生产时，Promise 和字符串持续排队。
5. 运行结束后 `logCliRaw()` 又序列化完整 stdout/stderr，其中 stdout 可能同时出现在 `stdout` 和 `raw` 字段。

已有保护及不足：

- 10 MiB 只用于选择新分片，不是单条内容、队列或每日总量上限。
- 30 天 retention 不限制 30 天内生成的分片数量。
- debug 开关降低默认暴露面，但打开 debug 的场景恰好通常是长任务和异常大输出。

建议：

- 以时间和字节批量 flush，不按每个 chunk 建 Promise。
- 维护当前分片路径和已知大小，不在每次 append 前扫描目录。
- 增加待写总字节上限和丢弃/降级策略，并记录 dropped bytes。
- 完整 raw 流只写一次，不在结束汇总中重复编码。

### 3.10 P1：OpenCode 子代理快照缺少总并发和总内存预算

证据：

- `src/cli/openCodeSubagentMonitor.ts`，单请求 `OPENCODE_SUBAGENT_MAX_RESPONSE_BYTES = 8 MiB`。
- `src/cli/openCodeSubagentMonitor.ts`，`states`、`refreshGenerations`。
- `src/cli/openCodeSubagentMonitor.ts`，`Promise.all(children.map(refreshChild))`。
- `src/cli/openCodeSubagentMonitor.ts`，SSE `buffer` 和 `consumeOpenCodeSseChunk()`。

触发链：

1. `/children` 返回 N 个子 session。
2. Monitor 对全部 child 同时请求完整 message snapshot。
3. 每个请求允许最多 8 MiB，但没有 child 数量、总响应字节或并发池上限。
4. `states` 保留每个 child 的完整 assistant 文本，完成后不立即移除。
5. SSE 事件还可触发额外 refresh；generation 只忽略旧结果，不取消已发出的 HTTP 请求。
6. SSE 未遇到 `\n\n` 时 framing buffer 没有大小上限。

影响：

- 理论单轮峰值接近 `N × 8 MiB`，还不包含 JSON 对象、解析临时副本、状态文本和聊天消息副本。
- 异常或恶意长 SSE frame 可持续扩大 buffer。

建议：

- 使用有限并发池，限制每轮 child 数和总响应字节。
- 已完成 child 只保留 bounded tail 或摘要。
- 为 SSE frame 和连接空闲时间设置上限。
- dispose 时主动取消在途 snapshot 请求。

### 3.11 P1：Codex 运行缓冲和 POSIX 子进程树清理不完整

证据：

- `src/interactive/codexRunner.ts`，两条运行路径的 `stderrChunks: Buffer[]`。
- `src/interactive/codexRunner.ts`，`assistantBuffers`、`emittedTraceContents`、`rawResponseToolNames`。
- `src/interactive/codexRunner.ts`，app-server 使用 `detached: false`。
- `src/interactive/codexRunnerProcess.ts:82-136`，POSIX 正常分支优先 `child.kill()`。

问题一：运行期缓冲无总上限。

- stderr 的所有 chunk 会一直保留到 run 结束。
- assistant/tool/trace Map 依赖对应 completed/output 事件清理；事件缺失时会保留到整个 run 结束。
- 长运行没有总输出字节预算。

问题二：POSIX 进程树可能清理不完整。

- `requestChildShutdown()` 在 `child.kill()` 成功时不会继续调用 `killProcessTree()`。
- app-server 以 `detached: false` 启动，没有独立进程组可供负 PID 稳定终止。
- app-server 启动的命令或子代理进程可能在父进程被终止后变为孤儿进程。

建议：

- stderr 改为 bounded tail，Map 在 item/turn 完成时显式清理并增加总条目上限。
- 统一 one-shot 和 interactive 的跨平台进程树生命周期 helper。
- POSIX 使用明确的进程组策略，并增加停止后后代进程检查。

### 3.12 P1：Loop 群聊每 5 秒重建整个页面

证据：

- `src/webview/loopDebatePanel.ts:68-76`，`update()` 每次设置 `panel.webview.html`。
- `src/webview/loopDebatePanel.ts:83-90`，每次解析完整 `chatMarkdown`。
- `src/webview/loopDebatePanel.ts:153-155,412-420`，可见时每 5 秒请求刷新。
- `src/panelStateBuilder.ts` 和 `src/extension.ts` 的群聊 state/transcript 读取链路。

触发链：

1. 可见页面每 5 秒发送 refresh。
2. Extension Host 读取并拼接完整 transcript。
3. 完整 Markdown 再次解析为 segments。
4. 构建完整 HTML 字符串。
5. `webview.html = ...` 替换整个文档，DOM、脚本、监听器和定时器全部重建。
6. 没有内容 hash/mtime 的 unchanged fast path。

已有保护及不足：

- hidden 时暂停轮询，但 `retainContextWhenHidden` 仍保留页面内存。
- 轮次上限不限制单条发言或 transcript 字节数。

建议：

- 首次发送 snapshot，后续通过 `postMessage` 发送增量 patch。
- Extension Host 记录 transcript cursor/mtime，未变化时不读、不解析、不发消息。
- 长 transcript 分页或只渲染最近阶段。

### 3.13 P1：配置心跳每 5 秒执行完整读取，即使面板不可见

证据：

- `src/extension.ts`，`CONFIG_HEARTBEAT_INTERVAL_MS = 5000`。
- `src/extension.ts:1451-1503`，`configHeartbeatCoordinator` 和 `readNormalizedModelStoreFromDisk()`。
- `src/webviewCommandCoordinator.ts`，`poll()` 在比较 snapshot 前加载配置和模型状态。

触发链：

1. 扩展在 `onStartupFinished` 激活。
2. 心跳启动后每 5 秒读取当前 CLI 配置列表、active 配置和 `models.json`。
3. 完成读取和规范化后才比较 snapshot。
4. 无变化时只是不 post state，前面的 IO 和解析已经发生。

影响：

- 面板未打开或隐藏时仍有长期后台 IO。
- 配置数量、单文件大小和 `models.json` 大小时，每次成本线性增长。

建议：

- 插件内配置写入后主动 invalidate，外部变化使用 watcher/mtime。
- 心跳只在相关面板可见时启用；隐藏时暂停或降频到 60-120 秒。
- 加入目录/文件版本缓存，未变化时跳过读取和解析。

### 3.14 P1：启动清理和本地 Store 使用大量同步全量 IO

证据：

- `src/extension.ts:814-843`，激活时同步加载多个 store 并立即启动维护任务。
- `src/extension.ts:1742-1770`，启动即执行一次历史清理，之后每 12 小时重复。
- `src/sessionStore.ts`、`src/promptHistoryStore.ts`、`src/workspaceSettingsStore.ts`、`src/modelSelectionStore.ts` 的同步 JSON 读写。
- `src/loopTaskStore.ts:196-253,676-805`，同步递归扫描、JSON 读取、全量写回和 communication tree stat。

问题：

- Promise 包装并不会让内部 `readdirSync/statSync/readFileSync/writeFileSync/rmSync` 变成非阻塞。
- `loadPromptHistoryStore()` 和部分其他 loader 即使规范化结果无变化也立即写回。
- retention 对非空文件可能无变化仍全量重写。
- Loop communication 清理为计算最新 mtime 会递归 stat 整棵目录树。
- Loop task cache miss 会递归找出所有 store，再逐个读取和解析；单次更新还可能重复读取同一个 store 后全量覆盖。

影响：

- 大量历史工作区、任务目录或大 JSON 文件会阻塞 Extension Host。
- 启动时维护任务与面板初始化、CLI 探测竞争 IO。

建议：

- 启动只做最小状态加载，维护任务延迟到 idle 窗口。
- 清理任务分批异步执行，设置单轮文件数和耗时预算并主动让出事件循环。
- 仅在数据实际变化时写回。
- 为 Loop task 建立 `taskId -> storeFile` 持久索引，并在清理时重建/校验。

## 4. 次级问题与待压测风险

以下问题也应记录，但优先级低于前述无界增长路径。

### 4.1 配置中心请求没有超时和取消

- `src/webview/configView.ts:343-359` 的 `pendingRequests` 只在收到 response 时删除。
- Host 请求永久 pending、消息丢失或页面长期隐藏时，Promise 闭包会一直保留。
- `loadScript()` 只有 `onload`，没有 `onerror`，本地资源加载失败时 Promise 永远不结束。
- 建议为 bridge 请求增加 timeout、最大 pending 数和 reload/dispose reject-all。

### 4.2 配置中心 MutationObserver 对任意变化做全页扫描

- `src/webview/configView.ts:478-519` 的两个 Observer 监听整个 `document.body`。
- readonly observer 每次重新 `querySelectorAll` 全部按钮。
- 英文 i18n observer 每次从 `document.body` 递归翻译全部节点。
- 建议只处理 `MutationRecord.addedNodes`，增加 debounce，并避免翻译自身再次触发全页扫描。

### 4.3 配置中心冷启动存在重复完整请求

- `syncActiveConfigIds()` 先为三个平台读取 list/current。
- React 配置应用启动后又执行 list/order/default 初始化和再次 list/order。
- 首次打开可能产生约 18-21 个 bridge 请求，配置文件较多时放大目录扫描和 JSON 解析。
- 建议由 Host 一次返回 bootstrap snapshot，后续按版本增量刷新。

### 4.4 多 Webview 的 `retainContextWhenHidden` 会保留较大内存

- 聊天 Webview、配置中心和每个 Loop 群聊 panel 都启用 retention。
- 配置中心 raw JS 资源约 1.16 MiB，不包含解析后对象、React tree、DOM、配置正文和 Skills 列表。
- 每个 Loop task 可有独立 panel，并同时保留 Extension Host state 和 Webview DOM。
- 这不是 dispose 后泄漏，但属于明确的隐藏上下文驻留策略，需要 heap snapshot 量化。

### 4.5 标签页、提示词队列和 workspace settings 没有数量/字节上限

- Webview 每个 tab 保留 messages、Run Stream、queue 和 task list。
- tab 页大小 5 只是显示分页，不是数据上限。
- `pendingPromptQueue` 没有条数和总字节限制。
- workspace settings 会持久化全部 tab 并同步重写完整文件。
- Prompt history 虽限制为 200 条，但单条 prompt 没有字节上限。

### 4.6 CLI 探测输出捕获没有字节上限

- `src/cli/commandRunner.ts` 的 `captureCliOutput()` 对 stdout/stderr 使用完整字符串累积。
- 主要调用通常有 timeout，但 timeout 只限制时间，不限制单位时间输出量。
- 建议增加 max bytes，超限立即终止并返回 truncated 信息。

## 5. 建议修复顺序

### 阶段一：先阻断 OOM 和资源泄漏路径

1. 修复 Claude `abortController` 接线和并发运行归属。
2. 实现统一 `stopAllRuns()` 并接入 deactivate/reload。
3. 为 OpenCode stdout/stderr、JSONL/SSE frame、Codex stderr、CLI probe 增加硬字节上限。
4. 为 Run Stream 增加记录数、单条字节和总字节预算。
5. 为附件增加 Webview/Extension Host 双端大小和数量限制。
6. 为 OpenCode child snapshot 增加并发池、child 数和总响应预算。

### 阶段二：处理高频热路径

1. OpenCode 使用增量 parser，移除逐 chunk 全历史 activity 检测。
2. Assistant delta 按帧合并，流式阶段不重复完整 Markdown parse。
3. 消息和 Run Stream 改为 keyed incremental DOM，不再全量清空重建。
4. 交互会话持久化改为异步串行队列，降低频率并避免全量同步写。
5. Debug 日志批量 flush，维护分片 cache 和待写字节上限。

### 阶段三：降低常驻和后台成本

1. Session message cache 使用带总字节预算的 LRU。
2. 配置心跳改为 watcher/mtime + 可见性 gating。
3. Loop 群聊改为 snapshot + patch，不再每 5 秒替换完整 HTML。
4. 启动维护任务延迟、分批、异步化，并只写实际变化的文件。
5. Loop task 增加索引、读缓存和 per-store 写队列。
6. 配置中心 bootstrap 合并请求，Observer 改为局部增量处理。

## 6. 动态验证方案

静态审计确认了增长和重复工作机制，但修复前后收益需要统一基准验证。

### 6.1 Extension Host 内存

场景：

- OpenCode 连续输出 10 MiB、50 MiB、100 MiB JSONL。
- Codex app-server 连续输出大量 stderr 和 10,000 个 item/tool 事件。
- Claude 启动长工具调用后反复执行停止、关闭 tab 和 reload extension。
- 当前工作区加载 100、500、2,000 个大历史会话。

指标：

- heap used、RSS、external Buffer、GC 次数和最大 pause。
- 停止后 10 秒/60 秒 retained heap。
- 子进程及其后代进程数量。
- 输出总字节与 heap 峰值的比例。

### 6.2 Webview 内存和 CPU

场景：

- 10,000 条 raw stream delta。
- 单条 assistant 回答 1 MiB，分别使用 100、1,000、10,000 个 delta。
- 5,000 条历史消息，包含 Markdown、diff、trace 和 tool result。
- 同时保留 20 个 tab，每个 tab 有消息和 Run Stream。
- 上传 10 MiB、100 MiB、500 MiB 文件及多文件组合。

指标：

- DOM node count、JS heap、long task 次数、最大帧间隔。
- 每秒 Markdown parse 次数和耗时。
- 输入框延迟、滚动 FPS、首次打开 overlay 耗时。
- Webview 和 Extension Host 双侧上传峰值内存。

### 6.3 本地 IO 和事件循环

场景：

- 会话文件 1 MiB、10 MiB、50 MiB，持续流式输出 10 分钟。
- debug 开启并以不同 chunk 尺寸输出 100 MiB。
- 1,000/10,000 个 Loop task store 和 communication 目录。
- 配置目录包含 100/1,000 个配置，面板隐藏 10 分钟。

指标：

- event-loop delay P50/P95/P99。
- 每秒 `read/write/readdir/stat/append` 次数和字节数。
- 日志待写队列深度、待写字节和排空时间。
- 启动耗时、清理耗时、配置心跳累计 IO。

### 6.4 建议验收门槛

- 所有流式缓冲、队列和 cache 都必须能指出明确的条目/字节上限。
- 停止或 deactivate 后，受管 CLI/SDK 进程及后代进程在限定时间内归零。
- 同一总输出字节下，CPU 不应随 chunk 数量呈近似二次增长。
- Run Stream overlay 关闭时不创建完整记录 DOM。
- 大会话流式保存不使用 Extension Host 同步全文件写。
- 面板不可见时不执行 5 秒配置全量扫描。

## 7. 本次审计边界

- 本次未采集生产遥测、heap snapshot、CPU profile 或崩溃日志。
- 本次没有构造真实 100 MiB 输出、数千任务目录或超大附件进行破坏性压测。
- 因此报告中的“OOM”均表示由无界增长路径导致的风险，不表示已经证实的线上事故。
- 并行开发在审计期间修改了 OpenCode 子代理监控相关代码；本报告已按最终写入报告前的当前工作树重新核对关键符号。
- 旧文档 `docs/PERFORMANCE_OPTIMIZATION_DESIGN.md` 仍可作为总体优化设计参考；本报告优先记录当前代码审计结论，不自动继承旧文档中的“待测”判断。

## 8. 最终判断

系统当前不是“已证明一定发生 OOM”，但也不能视为没有内存问题。至少以下路径缺少任何有效的总量上限：

- OpenCode 原始 stdout/stderr。
- Run Stream records 和完整 DOM。
- Assistant/trace/会话消息正文。
- Session message cache。
- Debug 日志待写队列。
- 附件 Base64 payload。
- OpenCode SSE 未完成 frame 和多 child 总响应。
- Codex stderr 和部分 turn 级 Map。
- Tab、提示词队列和部分本地 Store。

在长时间 AI/Loop 任务、大量工具输出和多并发子任务场景下，这些问题足以造成明显性能下降，并具备把 Extension Host 或 Webview 推向内存耗尽的条件。建议先完成阶段一的硬上限和生命周期修复，再进行渲染与存储结构优化。
