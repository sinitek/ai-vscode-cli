# CLI 接入参考

本文档替代原 `docs/cli-reference.md` 的详细说明，聚焦**当前仓库已经落地的 CLI 接入行为**。如果 CLI 官方版本发生变化，仍以各自 `--help` 和官方文档为准。

## 1. 当前支持矩阵

工具设置 UI 保留“常规配置”“AI任务配置”“工作区”三个 Tab；“常规配置”包含全局常规偏好及 `historyRetentionDays`，“AI任务配置”包含 AI 行为与 Loop 参数，“工作区”包含项目级设置。旧“全局”和“自动清理”Tab 已移除，设置字段和持久化位置不变。

| CLI | 当前执行模式 | 会话续接 | 主要实现 |
| --- | --- | --- | --- |
| Codex | 交互式 + 一次性 | 支持 | `src/interactive/codexRunner.ts`、`src/cli/commandRunner.ts` |
| Claude | 交互式 + 一次性 | 支持 | `src/interactive/claudeRunner.ts`、`src/interactive/metaStore.ts` |
| OpenCode | one-shot / 并行 `opencode run --auto [message..]` | 支持统一 UI、配置读取与本地会话存档；当前不走交互 Runner | `src/cli/commandRunner.ts` |
| Grok Build | 长驻 ACP `grok --no-auto-update agent stdio` | `loadSession` 为真时按 `sessionId/cwd/mcpServers` 续接，否则新建 ACP 会话并保留插件本地记录 | `src/interactive/grokRunner.ts`、`src/interactive/manager.ts`、`src/extensionhost/promptInteractiveRuntime.ts`、`src/config/grokConfig.ts` |
| DeepSeek Harness | 长驻 ACP `dsh --profile acp` | ACP UUID 用 `session/resume` 续接。不发送 `session/load`。插件 `local_` id 不是恢复 id | `src/interactive/dshRunner.ts`、`src/interactive/manager.ts`、`src/extensionHost/interactiveTurnDsh.ts`、`src/config/dshConfig.ts` |
| Gemini | 已移除 | 不再作为当前支持 CLI | 历史实现曾涉及 `src/cli/geminiStreamJson.ts`，仅作迁移参考 |

### 分组切换安装检查

- 切换到 Codex、Claude、OpenCode、Grok 或 DSH 分组时检查目标命令；命令不可用时提示安装，确认后在 VS Code 终端运行对应安装命令。
- Codex、Claude、OpenCode 和 DSH 使用各自 npm 包；官方 Grok Build 没有走 npm 安装，Windows 执行 `irm https://x.ai/cli/install.ps1 | iex`，macOS/Linux 执行 `curl -fsSL https://x.ai/cli/install.sh | bash`。
- 安装检查不会阻止切换分组；自定义命令路径仍沿用现有命令解析与设置修复入口。

### 交互 Runner 生命周期

- `InteractiveRunnerManager` 管理 Codex、Claude、Grok、DSH。键是 `${cli}:${sessionId}`。OpenCode 不进入这张表。缺少 sessionId，或 CLI 不是这四项时，查询返回 false 或 null，释放和活动标记无操作。
- 只有 Grok 的 `getOrCreate` 会 trim sessionId。空白 session 在写入缓存前抛出 `empty grok session`，`reason` 为 `empty`。其它方法不 trim，也不规范化 command、cwd 或路径分隔符。
- Codex 复用只比较 command、cwd 和规范化后的 configId。model、thinking、interactive、args、threadId 变化时保留 runner，并调用既有 `updateOptions`。模型与 config 仍走 `codexThreadSelection.ts`。
- Claude 不复用已 dispose 的 runner。thinking、interactive、model，以及只有 true 才算开启的 isolate，必须严格一致。command、cwd、entrypoint 仅在旧值为空时接受新值。复用时优先保留 runner 已有的非空 session id。
- Grok 只有 `isReusable()` 且 command、cwd、thinking、interactive、model 一致时复用。`agentArgs` 和 `localSessionId` 不触发重建。停止时 Grok 调用 `cancelTurn`，Codex 和 Claude 调用 `stopAndRebuild`。
- DSH 复用要求 runner 仍可复用，且 command、cwd、interactiveMode、localSessionId、`DSH_HOME` 和显式 agent 参数一致。启动固定 `dsh --profile acp`。停止先发 `session/cancel`。模型线值必须命中当前公布选项。思考档只接受当前模型公布且属于 DeepSeek 契约的 raw 标量；默认验证模型为 `low`、`high`、`xhigh`、`max`，`off` 和空 value 不进入面板。每次 prompt 前通过 `session/set_config_option` 确认当前值。
- DSH `classifyDshSessionUpdate` 将 ACP `plan.entries` 及 `todo_write` / `update_plan` 的 `rawInput.todos` 分类为计划更新；runner 对相同任务快照去重，宿主通过 `taskListUpdate` 只发送 `{ text, done }` 到当前 tab，不从工具摘要反推任务名称。
- DSH 工具事件用 `rawInput` 生成展示快照：带 `command` / `cmd` / `script` 的调用映射为 `exec <命令>`，其它工具映射为 `tool <名称>` 并保留格式化输入与输出；runner 过滤未变化快照，宿主按 `toolCallId` 复用消息 ID 原位更新同一工具气泡，不展示 `in_progress` / `completed` 等协议状态文本。
- 同一 key 上 `setRunner` 遇到同一对象只刷新元数据；换对象时先释放旧 entry。Codex 缺省 command、cwd、args 会覆盖或清空；Claude 和 Grok 省略这些可选字段时保留旧值。保存的参数数组是副本。`setRunner` 本身不调用 `updateOptions`。
- 空闲 24 小时后释放。回调里的判定阈值是该超时减 2 秒，并且只释放当前 Map 中的同一个 entry。活动运行期间取消空闲计时，结束后重新计时。释放顺序是清 timer、调用 runner.dispose、再删映射。创建失败不留下半成品 entry，构造、`updateOptions` 和 dispose 的错误原样抛出。
- 平台差异在 `src/interactive/runnerLifecycleStrategies.ts`，缓存和计时只在 `src/interactive/manager.ts`。这不改变用户可见的续接、停止或会话存档。

### 会话健康状态与续接前置条件

- `src/sessionHealth.ts` 定义 `normal / abnormal`。任一非空助手回复（含思考、最终结论）或正常操作/思考 trace 即可使会话正常；用户消息、system、错误/警告、重连日志和空占位不算。`SessionRecord.health` 随会话存储持久化，正常状态不降级；旧记录加载消息时回填，local 到远端会话迁移时合并保留任一侧正常状态。
- 所有任务执行在 `runPrompt` 的统一入口、OpenCode 用户消息预加载和 CLI 分流前检查当前目标 Tab 的实际会话。异常会话先保留原存档、仅解除目标 CLI 映射并清空其草稿，再以空会话 ID 启动新底层会话；未被其它 Tab/运行引用的旧交互 runner 同时释放。后台目标不切换活动 Tab，也不清理其它 CLI 的映射或草稿。
- 不新增界面文案或健康状态徽标，现有中英文 i18n 不变；正常会话的后续失败仍可续接，现有 hidden retry 策略不变。

### 任务执行时自动修复与单次重试

- `src/extensionHost/promptAutoRepair.ts` 包装统一 `runPrompt` 的三条执行分支。首次收到启动命令 ENOENT 后重新检查目标 CLI 命令是否仍不可用，复用查找与 `persistCliCommand`；命令已正常解析时不把不存在的 cwd 或普通文件错误误判成可修复项。
- 修复成功通过 `prepareSessionForPromptRun(..., { forceNewSession: true })` 在同一 Tab 清除旧会话绑定和草稿，保留旧消息文件，释放不再引用的旧 runner，再以 `sessionId=null` 重放完整输入。清除旧 `preloadedUserMessageId`，新会话重新追加用户消息；保留显式模型、思考力度、图片、执行目录和 Loop/Graph 追踪字段。
- 重放标记 `cliCommandRepairAttempted=true`，交互及 OpenCode one-shot/parallel 不再进入 hidden retry。OpenCode 的启动 ENOENT 收口后仍抛出原始错误供统一入口识别，不转换丢失错误码。修复或第二次执行失败停止，不递归重试。
- 修复等待期保持 Tab 可停止；停止、插件退出、目标 Tab 丢失、CLI 或工作区变化、同 Tab 新请求替代后均不重放旧请求。不自动安装 CLI，也不改变其它错误的既有策略。

## 2. 命令来源

当前支持平台命令都从 VS Code 设置读取：

- `sinitek-cli-tools.commands.codex`
- `sinitek-cli-tools.commands.claude`
- `sinitek-cli-tools.commands.opencode`
- `sinitek-cli-tools.commands.grok`
- `sinitek-cli-tools.commands.dsh`

参数来源：

- `sinitek-cli-tools.args.codex`
- `sinitek-cli-tools.args.claude`
- `sinitek-cli-tools.args.opencode`
- `sinitek-cli-tools.args.grok`
- `sinitek-cli-tools.args.dsh`

命令拆分与解析边界集中在 `src/cli/commandResolution.ts`，执行路径由 `src/cli/commandRunner.ts` 复用：

- 支持绝对路径、PATH 查找
- 配置化 command string 可以包含带引号的可执行文件和固定参数；第一段作为可执行命令解析，其余段在 terminal run、stream run、OpenCode server/capture spawn 和 MCP CLI 调用中统一追加到运行时参数之前
- 配置化 command 若写成 `~/...`、`~\...` 或 Windows `%USERPROFILE%\...`，解析前会先展开为当前平台原生路径，不会把 `~/.codex` 当作字面量文件路径
- Unix/macOS 下会优先尝试常见用户级 npm/pnpm bin 目录（如 `~/.npm-global/bin`、`PNPM_HOME`），降低用户级 CLI 命令被系统路径中旧版本抢占的概率
- Windows 下额外尝试 npm 全局安装目录、官方 Codex 安装目录 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`、`%USERPROFILE%\.local\bin`、scoop shims、Volta bin 和 WinGet Links
- Codex 用户级目录遵循 `CODEX_HOME` / `CODEX_HOME_DIR`，未设置时为当前用户目录下的 `.codex`（Windows 即 `%USERPROFILE%\.codex`）
- Grok Build 用户配置是 `$GROK_HOME/config.toml`；未设置 `GROK_HOME` 时为 `~/.grok/config.toml`，Windows 为 `%USERPROFILE%\.grok\config.toml`。`~/.grok/settings.json` 与 `user-settings.json` 不是该 schema，插件不读取、迁移或删除其中的密钥。
- DeepSeek Harness 默认命令是 `dsh`。`args.dsh` 只保留明确的 `--patch`，不能覆盖 `--profile`。运行时使用隔离 `DSH_HOME`。全局 Skills 根是 `${DSH_HOME:-~/.dsh}/skills`，全局规则是 `${DSH_HOME:-~/.dsh}/AGENTS.md`。凭据只进入子进程环境变量 `SINITEK_DSH_API_KEY`。
- macOS 下优先直接启动已解析的 CLI；仅在命令仍无法直接解析时，才回退到 `sinitek-cli-tools.macTaskShell` 对应的 `zsh` / `bash`

## 3. 交互模式真实行为

### Codex

- reasoning 的空快照（如 `summary: []`）不产生思考正文，`encrypted_content` 不视作可展示摘要。纯空白 reasoning 前缀只缓存在原 item，收到正文后连同换行完整下发；已有正文后的空白增量仍保留。Webview 在实时和历史渲染中隐藏空 assistant 占位、去掉协议标记后无正文的回复及无正文 thinking trace，但保留原消息 ID/增量关联和有效操作按钮，因此不把“暂时没收到正文”当作要删除的消息。
- 使用当前用户安装的官方 `codex` CLI
- 通过 `codex app-server --listen stdio://` 建立 JSON-RPC 会话。消息按 NDJSON 拆帧，只把 LF/CRLF 当边界；提示词里的 U+2028/U+2029 行分隔符留在 JSON 字符串内，写出时转义为 `\u2028` / `\u2029`，避免被 Node readline 截断成 Unterminated string
- 优先直接 `spawn` 已解析的 Codex 可执行路径；macOS 仅在命令无法直接解析时回退到用户配置的 shell 包装
- Codex app-server 在 macOS/Linux 下以独立 process group 运行。同一命令、启动参数、cwd、`CODEX_HOME` 和 `modelProvider` 共用一条连接，只 `initialize` 一次。冷启动阶段停止、扩展停用、连接退出或最后一个 runner `dispose` 时，仍先关 stdin、再升级到 `SIGTERM` / `SIGKILL` 清理进程组，避免 Node wrapper / vendor binary 残留导致后续 `EAGAIN`。已经加载 thread 的回合停止只发 `turn/interrupt`，不杀进程
- 会为 Codex 子进程显式注入 `CODEX_HOME` / `CODEX_HOME_DIR`，并移除 `npm_config_prefix` / `NPM_CONFIG_PREFIX`
- 启动前会确保当前工作区在 Codex 配置中被标记为 trusted，并通过 `-c projects.<workspace>.trust_level="trusted"` 追加运行时 override
- 每条连接只做一次 `initialize` / `initialized` 握手。后续回合复用这条连接
- 当全局 `humanInteractionEnabled=true` 且当前是 Codex Vibe/coding 交互任务时，插件启动 `codex app-server` 会追加 `--enable default_mode_request_user_input`，并在 `initialize.capabilities.experimentalApi=true` 声明 host 支持 experimental request；否则 Codex Default mode 会把模型侧 `request_user_input` 工具调用拒绝为不可用，表现为“当前环境不支持 request_user_input”或 `request_user_input is unavailable in Default mode`。 人工交互弹窗和 Loop/Loop+/Graph 主任务澄清表单共用 `humanInteractionTimeoutMinutes`，默认 10 分钟、范围 1–240；到时未提交不视为拒绝，模型按最佳方案继续。
- Codex 主线程思考气泡消费 app-server `item/reasoning/summaryTextDelta`、`item/reasoning/textDelta` 和 `item/reasoning/summaryPartAdded`，按 `itemId` 拼接后写入 thinking assistant 气泡。同一 reasoning item 的后续 delta 继续写入原气泡，中间插入工具 trace 或普通回复也不会把这段思考拆成半句新气泡。Webview 在思考气泡持续追加期间保持纯文本，连续 3 秒没有新文字后才渲染 Markdown；新文字会重新计时，期间的整页重绘也不提前解析 Markdown。`thread/start` 和 `thread/resume` 的 config 对所有模型设置 `model_reasoning_summary=detailed`，不再按模型名是否包含 `grok` 分支。插件不按 200 字裁切思考正文。代理日志里摘要只有两类：GPT 的 `summary=auto` 是完整短标题，没有 `...` 截断；Grok/kedaya 的散文摘要有时会在上游流里停在约 200 字并带上 `...`，`auto` 和 `detailed` 都会出现。`detailed` 只避免默认走 `auto`，不能把已经没下发的文本补回来。Grok 等模型若把 `[final_answer]` 草稿写进 reasoning summary，插件只保留标记前的思考正文，且 `item.completed` 不得用更短摘要覆盖已流式内容。子线程 reasoning 不进入父回复。
- 运行中订阅 app-server `thread/tokenUsage/updated`，并用 `turn/completed` 的 `last` 快照兜底。当前窗口已用上下文按官方 `TokenUsage.tokens_in_context_window() = last.totalTokens - last.reasoningOutputTokens` 计算，不使用 lifetime `total`。按 conversation tab 推到 Webview，在底部“回放”按钮右侧以与“提示词”同高度的徽章展示“上下文：”前缀和 `k` 单位读数；子线程通知忽略。
- 使用 `thread/start`、`thread/resume`、`turn/start` 维护 threadId。一条连接上的每个 thread 只加载一次：没有 id 时 `thread/start`，已有 id 但当前进程还没加载时 `thread/resume`，之后同一 thread 只发 `turn/start`。模型、effort、cwd、sandbox、approval 走 `turn/start` 覆盖。`modelProvider` 只在 `thread/start` / `thread/resume` 传递，并作为连接键；provider、工作区或启动参数变化会换一条连接再冷恢复，因为已订阅的热 thread 上 `thread/resume` override 会被 app-server 忽略。Codex 交互会话在切换插件侧模型或配置档案后仍优先复用已映射的 `threadId`。app-server 恢复的是服务端 thread，不会重新执行旧工具调用或重发全部历史事件，`persistExtendedHistory` 也不是可用的恢复开关。若跨 provider/account 的历史含目标侧不能解密的 reasoning/compaction 内容，app-server 仍可能返回 `invalid_encrypted_content` 等原始错误；插件不伪造历史重放。并行 Loop / Graph 子任务挂到同一条已握手连接上，各自 `thread/start` 一次；子任务重试复用原 tab 和 thread，不再新建会话。
- Codex app-server 可见错误通过结构化 `error` trace 展示，不能被交互重试状态机当作正常回复或工具进度。共享 hidden retry 对 HTTP 402、`Payment Required`、明确 `insufficient credits/balance/points` 以及 `requires <n> points, remaining 0` 直接判为计费终态错误，保留原始 provider 消息并在首次失败后收口；429、网络中断和其他暂时性错误继续使用既有有界退避。
- 面板“常用命令 -> 压缩上下文”在 Codex 下会直接复用当前 threadId，走 app-server `thread/compact/start` 原生压缩；不会再通过“生成摘要后切到新线程”模拟压缩
- 面板“工具设置”支持全局“执行后自动压缩上下文”开关 `autoCompactContextAfterRun`，保存在 `~/.sinitek_cli/settings.json`，默认开启。旧工作区 `autoCompactContextAfterRun` 和 `autoCompactContextBeforeRun` 仅作为迁移输入，全局字段缺失时按 after-run 优先、before-run 回退迁移当前工作区有效值；全局字段已有值时始终优先。开启后，在已有会话任务成功结束且执行超过 5 分钟后会自动压缩上下文；任务中断、报错或执行不超过 5 分钟不触发。Loop/Loop+ 主任务触发这次自动压缩时，压缩与子任务派发并行，不再等压缩结束后才派发；下一次使用同一主任务会话的运行会先等待该次压缩结束。自动压缩单次最多等待 3 分钟，超时会停止当前压缩并按未压缩处理。该自动行为当前面向 Codex / Claude / OpenCode；OpenCode 的具体压缩实现以插件当前 runner 能力为准
- 面板“工具设置”不提供最终答复判定策略。普通任务 prompt 固定要求 `[final_answer]` 协议文本；旧 `finalAnswerPolicy`、`codexFinalAnswerPolicy` 与历史兼容值会被忽略，不能改变运行时终结判定。Codex 交互式普通任务的最终回复气泡只认显式 `phase:"final_answer"` / `codexFinalAnswer=true`，或非 thinking assistant 文本包含 `[final_answer]`；主 turn 的 `turn.completed status="completed"` 本身不能收口。若主 turn 已 completed，最后一条主线程 `agent_message` 为 `phase:null` / 缺省 phase 且其后没有工具活动，则把该条非 thinking assistant 正文提升为 `codexFinalAnswer=true`。`phase:"commentary"`、thinking-only、子线程 `turn.completed`、`failed`、`interrupted`、主动停止、Claude/OpenCode 普通成功退出都不能借 completed-turn 收口。
- 普通 Codex 人类对话 prompt 会同时注入 TaskList 日志格式要求：只有在进度更新需要携带任务状态时，使用 `Tasklist:` 标题，后续逐行输出 `- [pending] 中文任务描述`、`- [in_progress] 中文任务描述` 或 `- [completed] 中文任务描述`；状态码为解析协议必须保持英文，任务描述默认使用中文，代码符号、命令、路径、包名和用户原文术语可保留原文；不要输出其它标题、checkbox、中文状态词或同行分号列表。Loop 等内部机器协议不注入该人类可见 TaskList 指令。Loop 与 Loop+ 主任务 Tab 不展示任务列表浮层，也不因父任务仍在运行而保留上一轮 external 或历史 Tasklist；主任务提示明确禁止复述旧清单。子任务和普通对话仍只展示当前 run 的任务列表。
- 回合完成后优先走 graceful shutdown：先结束 stdin，再升级到信号终止，避免长任务在 flush 边界被粗暴打断
- 会把部分设置映射到 thread 选项，例如：
  - model
  - approval policy
  - sandbox mode
  - add-dir
  - web search
  - thinking / reasoning effort
- 面板“工具设置”不再提供全局隐式子代理开关；历史 `multiAgentEnabled` / `codexMultiAgentEnabled` 均被忽略，不再迁移。能力是否开启由目标 CLI 分组自身配置决定，插件既不启用也不禁用：Codex app-server 启动参数不注入 `--disable multi_agent`，thread config 不覆盖 `features.multi_agent`；OpenCode overlay 保留已有 task 权限，环境中的 `OPENCODE_CONFIG_CONTENT` 原样传递。Loop 的 `main_sub_multi_agent` / `debate_multi_agent` 编排与子代理进度展示保持不变。Codex App Server 初始化连接会自动收到新建子线程通知，插件按 `threadId` 分流 `item/agentMessage/delta`，并结合 `collabAgentToolCall`、`subAgentActivity` 与子线程 `turn/completed` 更新每个子代理的独立 assistant 气泡。子线程 `thread/started` 不覆盖父 threadId，子线程 `turn/completed` 不结束父 turn，子代理文本也不进入父回复 final-answer 观察器。

### Claude

- 使用 `@anthropic-ai/claude-agent-sdk`
- 优先尝试复用用户设置的 Claude 可执行入口
- 同步传入当前模型、工作目录和 `user/project/local` settings
- Loop 子任务隔离项目指令时仅加载 `user` settings，继续保留用户级 MCP / 搜索工具配置，并继续使用 `bypassPermissions`；普通会话仍加载 `user/project/local`
- 通过 SDK session 做会话续接
- SDK 的 `allowedTools` 用于免审规则以及任务工具 opt-in，不是限制所有可用工具的白名单；不设置 `tools` 以保留 CLI 默认工具。执行模式使用 `bypassPermissions` 与 `allowDangerouslySkipPermissions: true`，plan 仍使用 `plan`；这些配置不能修复外部网络服务或让未暴露工具自动出现。
- `src/cli/claudeToolPolicy.ts` 为 SDK 每轮输入和 CLI 单次调用统一附加兼容提示，保留原始需求；续聊、恢复和隔离子任务同样覆盖，原生 `/compact` 不追加提示。当前接入中 WebSearch 返回空结果，WebFetch 多站点域名检查失败；SDK `disallowedTools` 为 `WebSearch/WebFetch`，补充提示要求用 Bash/curl 查询公开网络，上海天气示例为 `curl -fSL --connect-timeout 10 --max-time 30 "https://wttr.in/Shanghai?format=j1"`，按 `weather[].date` 核对日期。PowerShell 用 `curl.exe`，失败须保留真实原因，不能把空结果或其他日期当成功。
- 当前接入实测 Glob/Grep 未暴露；先用 ToolSearch 确认，再用 Bash 的 `rg --files` / `rg -n`，缺少 rg 时 Linux/macOS 使用 find/grep、PowerShell 使用 Get-ChildItem/Select-String。原生 Read/Write/Edit/Bash、任务跟踪和 Agent 经实际调用可用，继续优先使用；其他工具仅按实际失败做有授权的命令替代，不绕过权限或 plan，也不伪造子代理执行。
- 天气示例在 curl 后接已安装 Node 的 JSON 解析，保留日期、日最低最高温、小时天气及基础现况，剔除有时区歧义的观测时间和冗余字段。原始 wttr.in 响应可能超过工具输出预算，只看到 2KB 预览时不能猜日最低最高温；缺少 Node 时用已安装 Python 或 Read 完整结果，无法核对则明确未验证。PowerShell 内联参数引号不兼容时把同一解析脚本写到授权临时 `.cjs` 再执行；不安装额外依赖。NotebookEdit 的修改读回、TaskStop 停止本次创建的后台任务也已在临时目录实测成功。
- 面板“常用命令 -> 压缩上下文”在 Claude 下优先直接发送官方 `/compact` slash command，并通过 SDK `status=compacting` / `compact_boundary` 事件判定原生压缩完成；若当前 Claude 环境明确不支持原生 compact，则回退到旧的“生成摘要后切新会话”兼容方案
- 面板“工具设置 - AI任务配置”开启“执行后自动压缩上下文”后，Claude 的已有会话任务会在成功结束且执行超过 5 分钟后走一次压缩（含 `/compact` 原生能力与兼容回退路径）；任务中断、报错或执行不超过 5 分钟不触发
- Claude Code 2.1.118 的官方 CLI 帮助已提供 `--effort <level>`，取值为 `low`、`medium`、`high`、`xhigh`、`max`
- 插件交互 Runner 优先通过 SDK `extraArgs.effort` 传递新版思考力度；若旧 Claude Code/SDK 不支持该参数，则回退到 `maxThinkingTokens`
- 插件 one-shot Claude 调用默认通过 `thinkingArgs.claude.*` 拼装 `--effort <level>`；`off` 默认不再追加旧版 `--max-thinking-tokens 0`
- Claude 交互 Runner 的任务列表除了兼容 `TodoWrite` 外，还会从 `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` / `TaskStop` 工具调用及结果中归一化出 `{ text, done }`，供 AI 对话面板实时展示
- OpenCode JSONL `tool_use` 的 `todowrite` 任务列表主格式为 `part.state.input.todos[]`，单项至少读取 `content` 与 `status`，并兼容 `metadata.todos` 和 JSON `output`；`completed/done` 等完成态归一化为 `done=true`，`pending/in_progress` 保持未完成，显式空数组用于清空任务列表。前台与并行 OpenCode 运行都会定向更新对应 conversation tab：专用 `taskListUpdate` 是主通道，同一 `traceSegment` 携带的 `taskListItems` 是原子回退；扩展宿主缓存仍在运行的最新列表并在 panel state 重建后重放，Webview 的 `setMessages` 仅在 tab 空闲时清空 external 列表。调试日志事件 `opencode-task-list-forwarded` 记录来源、tab、任务数和完成数。
- Webview 对 tool-use trace 的已知稳定工具名做展示层本地化，中文界面优先显示“读取文件 / 查找文件 / 搜索文本 / 执行命令 / 应用补丁 / 更新任务列表 / 获取网页”等标题；命令、路径、正则和未知工具名不翻译，存档原文不改写。

### OpenCode

- OpenCode 是 Codex、Claude 之外的新支持目标，按插件通用 CLI 配置、统一 UI、统一会话存档和统一配置读取接入
- 命令与参数读取 `sinitek-cli-tools.commands.opencode` / `sinitek-cli-tools.args.opencode`
- OpenCode 1.17.16 的根命令和 `run` 子命令都支持官方 `--auto`：自动批准未被显式拒绝的权限请求。插件在 `src/cli/commandRunner.ts` 的共享 OpenCode 参数构建路径集中注入并去重该参数，因此普通消息、one-shot、并行任务、Loop 主任务/子任务、续跑与唤醒统一获得 `--auto`，无 prompt 的终端启动则为 `opencode --auto`
- one-shot / 并行任务通过 `opencode run --auto --format json --print-logs [message..]` 启动；OpenCode 1.18.32 在 provider 请求结束前不输出 `--format json` 事件，`--print-logs` 的 stderr 日志只用于证明进程已启动，不进入 trace 气泡；插件运行时会把 prompt 作为 `run` 子命令消息参数，而不是根命令的 project positional。启用内部子代理监控时，插件先启动 `opencode serve --hostname 127.0.0.1 --port <localPort>` 并等待 `/global/health`，随后父任务使用 `opencode run --attach http://127.0.0.1:<localPort> --auto --format json --model <provider/model> --variant <variant> --session <sessionId> "<message>"`。OpenCode 1.17.18 的 `run --port` 不作为服务就绪依据。configured attach、managed server 启动、Basic auth env override、ready wait、不可用降级和 disabled monitor 由 `src/extensionHost/openCodeSubagentRuntime.ts` 承载，`src/extension.ts` 只负责组合根依赖注入，并把 preparer 传给 one-shot / parallel host。one-shot 与并行 conversation tab 都消费 stdout JSONL visible events：`text` 实时写入 assistant 气泡，`reasoning` / `step_start` 写入 thinking 气泡，`tool_use` 写入 trace 气泡；并行/Loop 子任务不能只转发 `rawStreamDelta`。进程退出后的完整 assistant 文本只补齐未展示尾部，禁止重复追加整段最终回复。OpenCode 内部子代理的增量事件不会随父 `run --format json` 转发；插件通过受管服务的公开 `/event`、`/session/{parent}/children`、`/session/{child}/message` 与 `/session/status` 获取当前尝试新建的子会话。SSE 事件触发低延迟消息快照刷新，同时每 60 秒全量轮询兜底；每个子 session 固定更新一个独立 assistant 气泡，多个子代理交错时也按 session ID 定向追加，不合并到父回复。服务不可用时显示一次降级状态并继续父任务；SSE 重连指数退避到最长 60 秒。该链路不读取 OpenCode 私有 SQLite，任务结束、报错或停止会清理服务、订阅和轮询。
- CLI child process 的 `cwd` 是当前 VS Code 工作区的权威执行目录，runner 同时把 child env `PWD` 收敛为同一路径。OpenCode 1.17.18 的 `run` 内部请求会读取 `PWD`；如果只设置 spawn cwd、却继承 extension host 的旧 `PWD=/`，OpenCode 会先在正确项目创建实例，随后又在 `/` 创建会话并把 `projectID` 记为 `global`。one-shot、并行/Loop 子任务及复用该 runner 的 OpenCode 后台路径必须保持 cwd/PWD 一致。修复前已经绑定 `/` 的历史 session 会继续遵循其原始目录，升级后应新建一次 OpenCode 对话，不直接改写 OpenCode 数据库。
- OpenCode 1.17.16 的 JSONL 顶层和 `part` 对象使用 camel-case `sessionID` 返回真实 `ses_*`；插件必须在首轮流式输出中接管该 ID，后续同一 tab 才能通过 `--session <ses_*>` 续接。`local_*` 仅是插件消息落盘占位 ID，禁止传给 OpenCode；历史 `local_*` tab 再次执行时先启动新底层会话，捕获真实 ID 后迁移插件消息和 tab 引用，不使用全局 `--continue` 猜测最近会话。
- `--auto` 在用途上对应插件为 Claude 提供的 `--dangerously-skip-permissions` 和为 Codex 提供的 `--dangerously-bypass-approvals-and-sandbox`，但安全语义并不等价：它只自动批准仍处于 `ask` 的请求。默认 `external_directory: ask` 因而可以自动跨目录读写；用户配置、agent 配置或 OpenCode 默认规则中的显式 `deny` 仍优先，插件不会用运行时 overlay 强制改写为 `allow`
- OpenCode 进程非零退出时也必须解析 stdout JSON `error` 事件；若事件中存在 `APIError` / `UnknownError`、HTTP status、provider message、server `ref`、`responseBody.error.code` 或请求 URL，错误气泡优先展示这些 provider/API 详情，仅在没有可解析错误时才回退 `CLI 退出码`
- OpenCode one-shot 单次尝试只在启动阶段保留 60 秒空输出 watchdog：完全没有父 JSONL、`--print-logs` stderr 日志、error/status/progress 或子代理会话活动时才按 OpenCode 启动空输出错误收口并进入 hidden retry；首个有效父事件或子代理更新后立即解除 watchdog。后续不再用父 stdout/stderr 静默判断卡死，而由 SSE 加 60 秒子会话快照轮询持续提供进度。进程 `code=0` 退出但当前尝试没有非 thinking assistant 正文时，先用一次 `opencode export` 恢复；仍没有正文时，one-shot 与并行路径同样进入 hidden retry；Loop 后续轮次只认当前尝试的正文，不能借用初始用户消息之后的历史主任务 JSON 判成功。hidden retry 最终耗尽时必须追加可见 system 错误气泡、写入会话存档并记录日志，不允许只留下 trace 或运行态
- 对 Loop 主任务，如果一个已有远端 session 的 `code=0` 空成功响应不含 OpenCode JSON provider error，插件只允许一次 fresh-session retry：不传旧 `--session`、重发完整主任务 prompt，捕获新 `sessionID` 后保留旧 session、复制 UI 消息记录、改绑 tab 与 `LoopTaskRecord` 的 session store。新 session 再次空响应或任意 provider error 继续走通常 hidden retry/错误语义，不能不断创建 session；`/compact` 不是 `opencode run --command` 的稳定恢复入口。
- OpenCode `text` 事件可能把内部思考 wrapper 与最终正文放在同一个字符串中。运行时只识别 `<thinking>`、`<think>`、`<analysis>`、`<reasoning>` 四类 wrapper，按原顺序拆成 thinking / assistant 事件，并从最终正文中排除思考块；reasoning 与历史消息只去除 wrapper 标签，不能使用通用尖括号或 HTML 清洗破坏普通内容。
- OpenCode 当前不进入 `src/interactive/manager.ts` 管理的 Codex / Claude 交互 Runner；普通 AI 任务只读取 active config 内容，并为每次 `opencode run` 生成独立 runtime overlay，不会为对话运行改写用户真实 `~/.opencode/config.json`。
- OpenCode 配置中心只维护模型/Provider 配置 `~/.opencode/config.json`，不再要求或生成 `~/.opencode/.env`；运行时以该单文件配置作为 OpenCode 当前模型配置来源，不从官方全局 MCP 文件回退读取。
- OpenCode 官方全局配置 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp` 不再由配置中心维护或回写；CodeGraph 只读取用户磁盘上已有配置。
- 配置示例使用严格 OpenCode JSON 口径：`$schema=https://opencode.ai/config.json`、`model=provider/model`、`small_model=provider/model`、`provider`。配置页展示 `myAPI` OpenAI-compatible 主/子模型范例，其中 `model` 对应插件主模型，`small_model` 是 OpenCode CLI 兼容字段并对应插件子模型；provider 凭据使用官方 `{env:VARIABLE_NAME}` 语法，不要求或生成 `.env` 文件，且不再内嵌 MCP 示例以免混淆两个配置文件。
- `provider.<id>.npm` 选择的是 API 协议适配器，不是模型品牌。直接使用 OpenCode 内置 Anthropic / Google / OpenAI provider 时，通常通过 `/connect` 鉴权并使用 `anthropic/...`、`google/...`、`openai/...`，无需自定义 `npm`；需要手写自定义直连 provider 时，对应适配器分别是 `@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai`。只有请求实际 OpenAI-compatible endpoint 的自定义网关使用 `@ai-sdk/openai-compatible`；即使该网关承载 Claude、Gemini、DeepSeek 等模型，也仍按网关协议使用该适配器。
- OpenAI-compatible 自定义 provider 必须配置 `options.baseURL` 并指向实际兼容 API endpoint；缺少 `baseURL` 会在保存/运行前阻断，未以常见 `/v1` 结尾会继续给出校验提示。`model` / `small_model` 仍应使用 `provider/真实模型 id`；`models.<id>.name` 仅作为展示元数据，不能依赖它把占位 alias 改写成真实模型名。
- OpenCode 模式展示“主模型（model）”与“子模型（small_model）”两个下拉；候选只从当前 active config 的 `provider.<id>.models` 固定结构加载，值始终为精确 `provider/model`，不提供新增、编辑、删除、排序等模型管理入口。
- 普通对话、one-shot 和并行任务使用主模型；Loop 主任务、主持/复核、续跑和唤醒使用主模型，Loop 子任务使用子模型；Graph planner 和最终 `summary` 节点使用主模型，Graph 其他执行节点使用子模型。CLI 没有 `--small-model`，插件切换子模型时通过本次运行的 runtime config overlay 覆盖顶层 `small_model` 兼容字段。
- main/subtask 覆盖按 active config id 隔离，空值跟随顶层配置，配置切换或候选变化会清理失效覆盖；旧 `primary` / `small` 字段仅作为兼容别名读取和迁移。
- overlay 同时固定 effective `model` / `small_model`，保留目标配置的权限和未知字段；不添加或覆盖 `permission.task`，也不注入 `OPENCODE_CONFIG_CONTENT`。它使用随机临时目录、`0700` 目录权限和 `0600` 文件权限，通过 `OPENCODE_CONFIG` 注入，并在 exit/error/timeout/cancel 后清理。
- OpenCode 角色选择只接受 active config 候选中的精确 `provider/model`；裸模型 id、跨 provider 猜测或不在 `provider.<id>.models` 的引用会在启动前拒绝，不能自动补全。
- OpenCode 运行前会对 effective main、effective subtask 和 overlay 后配置做 preflight：缺少有效主模型、角色引用不是当前配置候选、provider/model 已被过滤或配置仍含占位值时阻止启动；OpenAI-compatible provider 缺少 `baseURL` 等未完成配置同样阻断。
- 配置中心不再自动或手动把 Claude / Codex 配置转换为 OpenCode 配置；OpenCode 配置列表只展示原生 OpenCode 档案。历史自动迁移档案不会被删除，但会从新的 OpenCode 配置列表中隐藏，避免继续刷新或复用旧转换项
- Claude 配置中心管理用户级 `~/.claude/settings.json`。卡片默认进入可视化模式，也可切换到 JSON 高级模式；模式切换和保存都会先校验 JSON/可视化状态，无效 JSON 不得清空或覆盖最后一次有效状态。可视化模式定向维护 `model`、`fallbackModel`（最多三个）、`availableModels`、`effortLevel`（`low|medium|high|xhigh`）、常用行为字段、权限规则、API/网关环境变量，以及 `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` 三档模型映射；所有未受管字段基于原始 JSON 保留。
- Codex 配置中心管理用户级 `~/.codex/config.toml` 与既有 `~/.codex/auth.json` 入口。`config.toml` 是 Codex 主配置文件，格式为 TOML，支持可视化编辑和 TOML 源码编辑；插件不展示、读取、写入、备份、导入导出 `~/.codex/.env`，也不删除用户已有文件。Claude 配置页仅做视觉风格对齐 OpenCode，不改变 Claude `settings.json` 的运行时语义。
- Claude、OpenCode、Codex 三组配置可视化参数的 label 右侧提供问号 tooltip；tooltip 说明字段含义、写入目标和注意事项，枚举字段同时列出可选值。三组“查看范例”入口统一放在配置文件名右侧，并与 OpenCode 现有交互风格保持一致。
- 用户控制台若出现 `AugmentExtensionSidecar` 访问 `https://d17.api.augmentcode.com/find-missing` 或 `/record-session-events` 返回 403，应按 Augment 扩展侧鉴权/网络问题记录；本插件 Claude 配置页空白仍优先排查 Webview 渲染、配置 JSON/TOML 解析和初始化数据链路，不应仅凭该 403 判定根因。

#### OpenCode 思考力度与运行参数

- OpenCode 聊天区思考力度与 Codex 使用同一组下拉值：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`。不需要在模型配置里声明 variants，也不读取 `opencode models --verbose` 来决定可选项。未保存选择时下拉和运行参数都回退到 `medium`。
- 官方 Models 文档中的自定义 `variants` 是在内置档位上覆盖或追加，`disabled: true` 才会移除某一个内置档位；配置过的档位不是白名单。因此插件不把已有 `variants` 或 `options.reasoningEffort` 当作下拉限制。
- 选中的思考力度通过 `opencode run --variant <effort>` 传递。`--thinking` 只控制 thinking blocks 是否展示，不能作为推理力度参数。若 `sinitek-cli-tools.args.opencode` 已显式包含 `--variant value` 或 `--variant=value`，显式参数优先，插件不重复覆盖。
- `small_model` 仍是 OpenCode CLI 兼容字段。OpenCode 内部 `small: true` 请求会跳过 variants，实际使用该模型 `options`。Loop/Graph 子模型除了记录自己的 `--variant` 外，还会在本次 runtime config overlay 中把所选力度写入对应模型的 `options.reasoningEffort`，不改用户原始配置。Vibe 只使用主模型力度。
- 思考力度按 active config id + 精确 `provider/model` + role 保存。非上述六档的旧值会在刷新时清除。切换 CLI、配置或模型不会沿用另一模型的选择。
- 固定的 `thinkingModeOpencode` 和 `thinkingArgs.opencode.*` 设置已移除；Codex / Claude 的固定 ThinkingMode 和参数映射保持原行为。

### Grok Build

- 原生 `ask_user_question` 使用 ACP 扩展请求 `_x.ai/ask_user_question`（同时兼容 `x.ai/ask_user_question`），不是权限审批。客户端验证 `sessionId` 和问题结构后，仅在开启人工交互的 Vibe/coding 普通任务中复用现有表单；Loop/Graph、关闭交互或没有回合处理器时返回 `{ outcome: "cancelled" }`，不弹窗。问题支持 `multiSelect` / `multi_select`，选项保留描述与预览，单选/多选均提供独立的可选其他回答。提交按问题原文返回 `{ outcome: "accepted", answers: { [question]: string[] } }`，不是 Codex 的 questionId 协议。人工交互超时将“自行选择最佳方案继续”作为各问题回答；用户拒绝返回原生取消并停止宿主任务，不触发 hidden retry；迟到回答不能进入下一回合。工具错误摘要同时保留 `rawOutput.error` 与 `rawOutput.message`，不能只显示 `tool_execution_failed`。
- 当前上下文用量：`initialize.clientCapabilities._meta["x.ai/statusLine"] = true` 开启原生状态订阅。本机 Grok 1.0.62 验证会发送 `_x.ai/session_notification`，其中 `update.sessionUpdate = "session_status"`、`schema_version = 1`，`context_window.context_tokens` 是当前窗口读数，`context_window_size` 是上限；不能使用其中累计的 `session_input_tokens` / `session_output_tokens`。协议适配同时兼容 ACP `usage_update.used/size`，只接受相同会话的非负安全整数，缺失读数不估算。
- 运行中每次同会话 `response_completed` 使用最近一次响应的 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens` 提前刷新；Grok 缓存输入独立计数、推理包含在输出内，已与 1.0.62 最终原生 `context_tokens` 对照。逐响应值直接替换，不累计 `turn_completed` / `turn_usage`，结束后仍由原生状态快照校准。相同 token 与窗口上限的通知合并，不增加轮询；单次模型响应/工具尚未结束期间保留最近读数。
- 状态快照可能晚于 `session/prompt` 的 RPC result。runner 缓存当前会话的最新用量，保留轻量用量回调至下次 prompt、取消或销毁，冷恢复后的首个 prompt 可回放最新快照。宿主在执行中校验 runId，结束后仅允许仍绑定原 Tab / Grok 会话 / runner 且没有新执行的末尾更新；不把完整状态中的路径等元数据额外加入回放。Webview 共用 `contextTokenUsage` 事件、Codex 标签、占位和悬停详情，合法零值与压缩后的下降均直接显示。

- Grok 手动压缩复用 Codex 的“常用指令 → 压缩上下文”弹窗和消息通道 `runCommonCommand/compactContext`；压缩时显示“压缩中”、禁用再次触发并保留“中止”，结束/失败/停止恢复入口。Grok 同时加入全局 `autoCompactContextAfterRun`，仅成功且超过 5 分钟的已有会话触发，3 分钟超时停止，沿用 Loop 主任务并行规则。
- 原生压缩由当前 ACP 会话的 `session/prompt` 发送 `/compact`，不生成插件摘要或切换新会话；冷启动必须成功 `session/load` 原 ID，失败不得回退新建。严格等待当前会话 `_x.ai/session_notification` 中的 `auto_compact_completed` 与 prompt 成功结果，失败、取消、异会话通知或只有普通回复均不算完成。保留原映射，停止/超时释放当前 runner，下一轮可恢复原会话。
- 2026-10-18 在隔离 `GROK_HOME`、Grok 1.0.62、`gpt-6.1-sol`（`chat_completions`、`low`）完成五轮对话 → 释放进程 → 恢复原会话 → 原生压缩 → 续聊验证：上下文由 31432 降至 10825 token，验证口令仍可正确回忆。短会话也可能原生完成但 token 不下降，是否缩减由 CLI 决定；不据此伪造失败或删除会话历史。

- Grok 1.0.62 对部分接口的 Responses SSE `response.metadata` 事件不兼容，可能在正确选择模型后仍返回 `Internal error`。已用同一连接的 `chat_completions` 为 `gpt-6.1-sol` 完成真实 ACP 回答验证；配置与诊断步骤见 `.ch/docs/runbooks/grok-model-config.md`，不要把协议兼容失败误判为模型下拉无效。

- 对话模型候选以当前 `$GROK_HOME/config.toml`（默认 `~/.grok/config.toml`）的 `[model.<配置名>]` 为唯一来源；下拉显示该表的 API `model` 字段，不使用 `name`，缺失、空白或非字符串时回退配置表键。下拉值与 `--model` 参数仍是配置表键，相同 API 模型名的不同配置不合并，刷新同步显示名。普通和 Loop / Loop+ / Graph 主从模型下拉均不提供“默认”“管理”项。保留按配置档案保存的有效选择，否则使用 `[models].default` 指向的有效模型，再回退首个配置模型；失效的手工列表不参与候选。
- Grok 模型下拉不再提供刷新图标。配置页保存激活档案后沿用现有自动应用流程；宿主在 `applyConfig` 写入磁盘成功后等待 `onConfigChanged`，由 `postPanelState` 重新读取文件并推送模型与显示名，再返回成功应答。保存档案等变更通知也等待完成，避免保存时旧配置的异步快照覆盖应用后的新快照；保存未激活档案不改变运行配置，应用失败不通知成功。每次真实对话启动前再读文件校验模型，配置非法或没有模型时停止启动并提示；模型选择继续通过 `--model <配置名>` 交给现有 ACP runner，切换模型复用已有 runner 身份校验。
- 配置中心可视化提供模型新增、切换、编辑、删除和默认模型选择；新增配置名称唯一，模型 API 名与连接参数分别编辑，删除默认模型后改指向剩余首项，删除最后一个后清除默认引用。空配置可显式创建模型配置；非法 TOML 不覆盖有效内容。切换模型只读取，不重写空表、密钥或隐藏字段。

- 思考力度的 ACP 参数使用标量：`session/set_config_option` 的 params 为 `{ "sessionId": "…", "configId": "reasoning_effort", "value": "high" }`，不是 `value: { value: "high" }`。2026-10-17 核对 [ACP Session Config Options](https://agentclientprotocol.com/protocol/session-config-options) 并用真实 Grok 1.0.62 验证：嵌套写法返回 `-32602 Invalid params` / `SessionConfigOptionValue`，字符串写法成功，返回列表中的 `currentValue` 为 `high`。Grok 自带 `15-agent-mode.md` 的嵌套示例与该版本实现不一致，不能只照示例改测试夹具。
- 自定义模型没有 `reasoning_effort` 能力选项时，仅设置 `[models].default_reasoning_effort` 不会启用此能力。按 [Grok 配置参考](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/26-config-reference.md) 在 `[model.<id>]` 中声明 `reasoning_efforts`，或由接口 `/v1/models` 提供支持档位。用户选择有效思考档后，插件在启动 Grok 进程前自动检查 `$GROK_HOME/config.toml`，无需手工补字段：显式所选模型优先于默认模型，先按配置键匹配，再按 `model` 字段匹配；只为缺少 `reasoning_efforts` 的当前自定义模型补齐 `GROK_REASONING_EFFORTS`（none、minimal、low、medium、high、xhigh、max）的 `{ value, label }` 列表。已有列表（含空列表）和 `supports_reasoning_effort=false` 保持不变。文本配置示例：

  ```toml
  [model."your-model-id"]
  reasoning_efforts = [{ value = "low", label = "Low" }, { value = "medium", label = "Medium" }, { value = "high", label = "High" }]
  ```

- 预检使用 `src/config/grokReasoningConfig.ts`：同一扩展进程内串行读改写，原子落盘并保留权限和符号链接目标；常规 TOML 表只在文件末尾追加缺失的数组表，保留原文、注释和换行；模型以 inline table 定义时复用现有序列化器规范化写回，保留字段但不保留注释。无有效思考档、无配置文件或没有对应自定义模型时不创建/改写配置。非法配置或文件读写失败时停止启动，显示配置预检错误，不再静默忽略所选档位。
- 自动补齐后仍以 ACP 广告列表为准。能力未广告或所选档位不在已有允许列表时，仍不发送设置、不自动降级，但在首次有 trace 回调的 prompt 显示一次原因；不阻断正常聊天。未配置或不可识别的 thinkingMode 不显示提示。配置预检不更改默认模型、默认思考档、密钥、接口或其它模型。
- 命令名是 `grok`。聊天区下拉和 `CLI_LIST` 都把 `grok` 追加在 Codex、Claude、OpenCode 之后，顺序固定为 `codex`、`claude`、`opencode`、`grok`。OpenCode 内部 id 仍是 `opencode`，可见名称保持不变，Gemini 仍保持移除。会话、模型存储、命令修复、面板状态、工作区设置、graph 和命令面板沿用这一份 `CLI_LIST`，不再维护排除 grok 的平行名单。宿主在 cli 为 grok 时启动已有 `GrokInteractiveRunner`。
- 面板主路径对齐 Codex app-server：长驻进程，stdin/stdout 一行一条 JSON-RPC 2.0。复用 NDJSON 拆帧，保留字符串内的 U+2028/U+2029。不刮 TUI，也不把 `grok -p` 当聊天主路径。
- Grok 回放与聊天使用不同投影：`GrokToolCallStream` 按当前回合、sessionId 和 toolCallId 聚合，回放通常仅记录工具开始及规范化终态，完整快照覆盖而非拼接；缺少调用 ID 时保守保留，不按命令文本全局去重。聊天复用同 ID 的 traceSegment 替换，显示工具、必要参数和状态，成功结果不另弹原始 JSON，失败保留简短错误输出。已知 Bash/GrepSearch 字节字段只在 UTF-8 可无损往返时解码；等价输出别名、可还原行号的 ReadFile 文本及重复 ACP 纯文本内容去重，差异、截断与多模态内容仍保留。实现入口为 `src/interactive/grokToolCallStream.ts`，细则见 Grok runbook 的“语义回放与工具气泡”。
- Grok 任务列表以标准 `session/update` 的 `sessionUpdate:"plan"` / `entries` 完整快照为实时来源，无需额外 plan 能力声明；当前未确认独立查询 todo 的 RPC。成功 `todo_write` 的 `rawOutput.TodosUpdated.todos` 同样是完整结果，工具名优先读取 `_meta["x.ai/tool"].name`，兼容 TodoWrite variant；缺少完整输出时才按 ID 与默认 `merge:true` 合并当前回合内已知数据，`merge:false` 替换或清空。只转换成功结果，失败/取消不套用输入，原生与工具派生列表去重。普通多步 Grok prompt 引导原生 todo，Loop 主任务沿用机器协议和隐藏规则。真实 1.0.62 + 隔离本地 API 已验证创建、ID-only 更新、全完成、失败与清空，详见 Grok runbook“任务列表来源与排查”。
- 正文/思考仍实时展示；回放同源分片按固定 1 秒或 32 KiB 合并，保留空白、重复词和顺序。命令目录、标题、用户输入回声、后台任务列表、用量及逐响应内部通知不新增回放条目；有意义的后台/子代理生命周期、压缩、未知事件与 RPC 成功/错误结果保留。计划按实际变化去重并更新现有任务列表，todo 工具不重复展示 JSON。回放与 JSONL 导出消费相同语义记录，历史存档不改写。
- 活动时间独立于回放数量，Grok 同会话通知以最多每秒一次的 runActivity 刷新目标 Tab；不改动其他 CLI 的空闲计算。取消/异常/回合结束排空未完成调用；宿主仅在当前停止调用的同步排空窗口允许写入取消摘要与回放，脱离执行身份后的迟到回调拒绝，复用 runner 时不跨回合聚合。工具标题沿用既有本地化，status/exit_code 等继续使用现有协议字段，无新增自然语言文案。
- 启动参数固定为 `grok --no-auto-update --permission-mode bypassPermissions agent <剩余净化参数> stdio`。`--no-auto-update` 在最前。`--permission-mode bypassPermissions` 是根命令标志，与 `--always-approve` / `--yolo` 同义，只保留一次，并且位于 `agent` 之前。`sinitek-cli-tools.args.grok` 里如果仍有 `--always-approve`、`--yolo` 或 `--permission-mode`，从 agent 参数剥离，不叠两个审批开关。其它用户 agent 参数仍放在 `agent` 与 `stdio` 之间。禁止把 `--dangerously-bypass-approvals-and-sandbox` 或 `--dangerously-skip-permissions` 传给 grok。`stdio` 是最后一个 positional。选中模型时在 `agent` 之后、`stdio` 之前追加 `--model <id>`；空模型省略 `--model`。模型不写入 `args.grok` 或 `~/.grok/config.toml`。
- `initialize` 使用 `protocolVersion: 1`，并且 `clientInfo` 必须同时带 `name` 和 `version`；缺 `version` 时 grok 1.0.60 返回 `Invalid params` / `missing field version`。若 `$GROK_HOME/config.toml`（默认 `~/.grok/config.toml`）里当前所选模型（未显式选择时为默认模型）的 `api_key` 非空，或 `env_key` 指向的环境变量非空，则不调用 `authenticate`，直接 `session/new`。官方自定义模型用这份密钥访问 `base_url`，不走 `grok.com`。否则只从当次 `authMethods` 里选择：存在非空 `XAI_API_KEY` 且提供 `xai.api_key` 时用它，否则用 `cached_token`，再否则用 `grok.com`；都没有则失败并提示 `grok login` 或设置 `XAI_API_KEY`。`authenticate` 只传 `methodId` 和 `_meta.headless`，密钥不进入 RPC，也不从 Codex `auth.json` 复制。
- 随后 `session/new` 传 `cwd` 与空 `mcpServers`。只有 `agentCapabilities.loadSession` 为真，且已有会话 id 不是 `local_` 前缀时，才用映射到的 ACP session id 调用 `session/load`，参数仅 `sessionId`、`cwd`、`mcpServers`。`session/new` 或 `session/load` 返回的 ACP session id 会接管原来的 `local_` 会话，下一轮继续这个 id。`session/load` 的 id 可能只在 `_meta.sessionId`，不能只看顶层 `sessionId`。同一进程里的后续 prompt 复用已有 runner，不再重新 `initialize`。用户正文走 `session/prompt`，`prompt` 为 `[{type:text,text}]`。有正文且 `session/prompt` 的 `stopReason` 为 `end_turn`、`end`、`stop` 或空时，按正常完成结束，不要求正文里再写 `[final_answer]`。`cancelled` 和 `refusal` 不当成完成。这些 `session/update` 进入现有 Codex 气泡通道，不新增气泡组件。`agent_message_chunk` 的 `content.text` 走 assistant 正文气泡，同一条回复的连续 chunk 合并到同一个气泡。`agent_thought_chunk` 走 `onTrace` kind `thinking`，由 `message.kind==="thinking"` 的现有思考气泡渲染。`tool_call` 与 `tool_call_update` 写成以 `tool` 开头且包含 `status` 的既有 tool trace，供现有工具气泡识别。思考和工具不混入正文气泡。空 chunk 不产生空气泡。经过上述聚合、规范化与过滤的 `session/update` 和 `session/prompt` 结果通过与 Codex 相同的 `rawStreamDelta` 回放：`stream` 为 `event`，带当前 `tabId`，正文做 `normalizeRawStreamContent`，末尾没有换行则补一个。解析失败、其它请求配对和客户端应答不回放。`session/prompt` 的 result 仍只是完成元数据，绑定原请求的回放实例，不能变成正文或流入下一轮。
- Grok 的 yolo 模式对应 OpenCode 的 `--auto`。命令行使用根标志 `--permission-mode bypassPermissions`（与 `--always-approve` / `--yolo` 同义），并且 `session/new` 与 `session/load` 都带 `_meta.yoloMode: true`。`initialize.clientCapabilities.terminal` 和 `fs.readTextFile/writeTextFile` 必须为 false。声明 `terminal: true` 时，grok 1.0.60 不在本机执行命令，而是向客户端发 `terminal/create`；宿主答不了或应答形状不对时，curl 这类工具失败。关掉这两项能力后，yolo 会话由 grok 自己执行终端和文件工具。
- Grok 恢复已有会话时，`session/load` 成功后、发送下一条 `session/prompt` 前，使用 `session/set_model` 将本轮所选模型应用到同一个 ACP session；模型切换 RPC 失败时停止本轮，不静默沿用旧模型。新建会话仍通过进程级 `--model` 选择模型。
- 回合停止发送文档中的 `session/cancel`。进程停止、spawn 失败和释放仍先关 stdin，再 `SIGTERM`，最后 `SIGKILL`，并清理进程组；Windows 走现有等价清理。命令解析、`~` / `%USERPROFILE%` 展开和用户级 bin 目录复用 `commandResolution`。
- 聊天区 `#thinkingMode` 在 grok 下的选项顺序是 `off`、`low`、`medium`、`high`、`xhigh`、`max`、`ultra`。已保存的 `max` 或 `ultra` 保持原值，不改写成 `high`。下发值只使用 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。插件的 `off` 映射为 `none`，`on` 映射为 `medium`，`ultra` 映射为 `max`，`xhigh` 仍是 `xhigh`，`max` 仍是 `max`，不把 `on` / `off` / `ultra` 原样传给 grok。只有广告了 `reasoning_effort` 且映射后的值在允许列表中时才调用 `session/set_config_option`；不在允许列表或未广告时不发送、不自动降级、不加 `--reasoning-effort`。`initialize` 上的同名字段只作为旧响应的兼容回退。
- 配置页在 Claude、Codex、OpenCode 之后追加 Grok 卡片，DSH 再追加在 Grok 之后，不调整前面平台的顺序，也不恢复 Gemini。空配置顺序是 `[]`，空 active id 是 `null`；读取缺少 `grok` 或 `dsh` 键的旧存档时只补空数组，并保留已有平台 id。文本模式编辑完整 `config.toml`，非法 TOML 或空文本不覆盖上一份有效内容。可视化复用 Codex 配置页的行、label、问号 tooltip、对齐和主题语义色，只映射 `models.default`、`models.default_reasoning_effort` 和 `model.<id>` 的 `model`、`base_url`、`api_backend`（仅 `chat_completions`、`responses`、`messages`）、`api_key`、`env_key`、`context_window`、`reasoning_summary`（仅 `none`、`auto`、`concise`、`detailed`）、`compaction_at_tokens`。未展示字段保留。不写 `service_tier`、`disable_response_storage`、`wire_api` 或 `requires_openai_auth`。`api_key` 是 `[model.<id>]` 的密钥本身，不知道时写空字符串，不从 Codex `auth.json` 复制；`env_key` 只表示环境变量名。内容为空、加载中、解析错误或字段无效时保存按钮禁用。

- Grok 可视化采用左侧模型列表、右侧参数编辑，不再用“当前模型”下拉切换。“新增”打开单名称输入弹窗，`model` 和表键默认使用该输入，非必需的 `name` 不提供可视化输入或范例、新增时不生成，已有模型中的值原样保留；支持取消、重名校验与回车确认（组词时不提交）。新增模型深拷贝当前项全部参数（含凭据、协议与未知嵌套字段），仅替换 `model` 并省略新项可选的 `name`；每行名称右侧的删除 SVG 确认后只删除该项，删除未选中项保留当前选择；当前项不存在时回退默认/首项，再回退空模板。模型之间不共享嵌套对象，其他 TOML 字段与全局默认语义保持不变。
- 真实 Responses 流可能在正文之后发送当前 Grok 不支持的 `response.metadata` 等事件；这时 ACP 返回错误而非成功。运行器从 RPC `error.data` 和失败 `retry_state` 识别此类错误，返回 `GROK_RESPONSES_STREAM_INCOMPATIBLE`，提示按服务能力改为 `chat_completions`，停止无效重试并销毁故障 runner。不根据模型名称全局改协议，也不将部分正文作为成功结束。修改本机协议时需同步对应配置档案，详情见 `.ch/docs/runbooks/grok-model-config.md`。
- 合并与快照比较只忽略本机真实 Grok 流中逐事件变化的 `params._meta.eventId`、`chunkId`、`agentTimestampMs`；合并记录保留最后一片的 `_meta`。`promptId`、流/回合起点、token 用量、内容注解和未知元数据变化仍构成边界，不按文本相同来删除重复词。

### DeepSeek Harness

- 命令顺序是 `codex`、`claude`、`opencode`、`grok`、`dsh`。交互主路径固定为 `dsh --profile acp`。`args.dsh` 只接受明确的 `--patch`。
- 默认范例模型 id 是无前缀的 `deepseek-v4.1-flash`，ACP 线值为 `JSON.stringify(["sinitek-custom","deepseek-v4.1-flash"])`。模型 id 按 endpoint 原样配置，`models[].id` 与 `acpModel` 必须一致，并且对应 wire 必须出现在当前 `configOptions` 中；插件不会自动增删 `subcoco/` 等前缀。其它自定义 id（包括带命名空间的 id）同样可用，前提是 endpoint 支持且 ACP 广告。
- 未配置模型不能执行。未出现在已配置模型和当前 `configOptions` 中的 id 不得当成可执行模型。官方路由握手接受任意字符串的结果不能搬到 `sinitek-custom`。
- 凭据默认引用 `SINITEK_DSH_API_KEY`；配置档案也可直接保存 `apiKey`。直接配置的密钥只在本机配置目录和备份中以用户可读权限保存，运行时只进入 DSH 子进程环境，不进 patch、参数、仓库或诊断输出；未填写 `apiKey` 时回退到外部 `SINITEK_DSH_API_KEY`。
- 配置页分组在 Grok 之后。旧顺序缺少 `dsh` 时只补空数组。配置页首次打开及切换档案默认进入 JSON 模式；JSON 与可视化编辑同一份完整配置，无效 JSON 不覆盖上一份有效可视化状态。可视化模型编辑沿用 Grok 双栏布局，左侧按顺序列出模型，右侧编辑当前模型与 profile 信息，`acpModel` 下拉选择默认模型。已接受的额外顶层字段和模型对象字段会保留；未验证字段、非 `apiKey` 密钥字段和 `retryPolicy` 未建模键在验证阶段拒绝。运行 patch 只写已验证字段；可选 `apiKey` 不进入 patch。provider 只读。`baseURL`、模型 id 和 `apiKey` 可编辑；可视化模式不展示 `apiKeyEnv`。DSH 官方 provider schema 将 `apiKeyEnv` 定义为可选；profile 可省略，插件在保存 profile 和运行 patch 时自动补齐固定值 `SINITEK_DSH_API_KEY`。直接配置的 `apiKey` 只在本机配置目录和备份中保存，运行时注入子进程环境，未填写时使用外部环境变量；保存校验只对 profile 根级 `apiKey` 排除密钥扫描，嵌套或其它位置的密钥仍拒绝。范例复制后，设置正确的 `baseURL` 和 `apiKey` 即可使用，前提是 endpoint 兼容 OpenAI Chat Completions 并接受范例模型 id；有序 `models` 数组允许多个完整 id，模型 id 必须由 ACP 广告。聊天模型选择器按序列出 profile 模型，不提供通用管理入口；切换持久化，并在每轮执行时解析为配置内 wire，由 ACP 确认后才执行。未列入该数组或未被 ACP 广告的 id 不能执行。DSH 详情区不显示激活状态；保存已激活档案和列表激活动作仍走 `activateDshProfile`。图形 Extension Host 点击验收未做。Skills 目标是五个，顺序保持 Claude、OpenCode、Grok、Codex、DSH。Skills 根是 `<DSH_HOME>/skills`。全局规则是 `<DSH_HOME>/AGENTS.md`，工作区规则是共享的 `AGENTS.md`。
- `usage_update` 缺失时不显示 0。窗口若来自 adapter-fallback，界面标题标明它不是服务确认容量。
- 思考档只使用当前模型公布且属于 DeepSeek 契约的 raw 标量。默认验证模型 profile 声明 `low`、`high`、`xhigh`、`max`，面板直接显示这些 value，不显示 `off` 或空 value；其它自定义模型仅在显式声明能力时显示。ACP 广告仍是最终依据；旧 `off` / `medium` 归一为可用档位，不显示 Grok 的扩展档位，也不绕过 ACP options 校验。
- 原生 compaction 明确不支持。真实 `session/request_permission` 和图形 Extension Host 点击验收未验证。
- 插件启动的 DSH ACP 子进程显式覆盖 `DSH_PERMISSION_MODE=danger-full-access`，让 DSH 官方配置同时使用 `danger-full-access` 沙箱与 `never` 审批；父进程环境不会被修改。该模式授予 DSH 子进程完整文件访问且不弹审批，只作用于插件启动的 DSH 执行。

### Gemini

- Gemini 已从当前 AI 对话和配置中心支持范围移除
- 旧版 Gemini headless / stream-json 事实只作为历史迁移参考，不再作为当前支持 CLI 的验收口径

## 3.5 工具设置存储

- 工具设置中的全局项（`debug`、`autoAddEditorContextTags`、`autoCompactContextAfterRun`、`locale`、`macTaskShell`、`loopMaxRounds`、`loopPlusDecisionSubtaskMax`、`loopPlusMaxAcceptances`、`loopSubtaskMaxThinkingMode`、`historyRetentionDays`）写入 `~/.sinitek_cli/settings.json`。其中 `debug`、`autoAddEditorContextTags`、`locale`、`macTaskShell`、`historyRetentionDays` 位于“常规配置”Tab，`autoCompactContextAfterRun`、`loopMaxRounds`、`loopPlusDecisionSubtaskMax`、`loopPlusMaxAcceptances`、`loopSubtaskMaxThinkingMode` 位于“AI任务配置”Tab；`loopPlusDecisionSubtaskMax` 默认 6，范围 1–20，只限制 Loop+ 一次 `dispatch` 或 `accept` 的子任务数，不改变同时运行上限；`loopPlusMaxAcceptances` 默认 100，范围 1–999，只限制 Loop+ 一个任务最多确认的子任务验收次数，不约束经典 Loop 轮次；`historyRetentionDays` 默认 30 天，范围 1–3650 天，并统一约束日志、会话、提示词历史、任务记录和 Loop 记录的保留期限；临时目录仍使用独立的 1 小时清理策略
- 工具设置中的项目级项（如 `loopExecutionModeByCli`）写入 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`。旧工作区 `autoCompactContextAfterRun` / `autoCompactContextBeforeRun` 只作为全局自动压缩设置的迁移输入；全局字段缺失时迁移当前工作区值，成功迁移或用户更新全局设置后移除对应旧字段。旧 `multiAgentEnabled` / `codexMultiAgentEnabled` 已停用，读取时忽略且不迁移。
- 工具设置“工作区”页中的 harness 骨架开关控制当前工作区基于 harness scaffold 的插件侧记忆层，默认关闭，并写入 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json` 的 `workspaceMemoryEnabled`。配置解析采用“显式 false 防误开优先”：兼容旧字段 `memoryEnabled=false`、`globalMemoryEnabled=false`、`workspaceMemoryEnabled=false` 命中对应作用域时，运行时必须关闭对应长期记忆行为。
- 用户开启该开关时，扩展先弹窗确认；确认后才补齐当前工作区 harness scaffold：`.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 的幂等追加模板、只引用 `AGENTS.md` 的 `CLAUDE.md`，以及忽略 `.codegraph/` 的根级 `.gitignore`；已有 `CLAUDE.md` 保持原样，已有 `.gitignore` 只补充缺失的 `.codegraph/` 条目。扩展激活、工作区切换和首次 recall / inject / 持久化不再无条件安装 scaffold。
- 确认初始化后，扩展会在当前工作区终端启动 `codegraph install --target codex --location global && codegraph init`，用于自动安装/初始化 CodeGraph；该过程可见且不阻塞工具设置保存。
- 骨架安装成功后，扩展会二次弹窗询问是否初始化 `ARCHITECTURE.md`；用户确认后，扩展侧把当前 AI 对话切到 `coding` 模式，并通过现有 `runPrompt` 链路复用当前 CLI 分组、配置和模型发起架构分析任务。用户取消时不影响 harness 开关保存或 CodeGraph 初始化。
- 长期记忆关闭后，插件只允许查看、导出和删除已有记忆；不得创建、更新、自动提取、召回、注入或更新 memory 目录元数据。关闭插件侧长期记忆不会关闭 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、压缩、配置或账号侧能力。OpenCode 官方另有上下文压缩能力：TUI slash commands 文档列出 `/compact`，alias `/summarize`，用于 compact current session；配置文档提供 `compaction.auto`（默认 `true`）、`compaction.prune`、`compaction.reserved`，CLI 环境变量列表包含 `OPENCODE_DISABLE_AUTOCOMPACT` 用于关闭自动压缩。插件的“执行后自动压缩上下文”和手动压缩按钮可把 OpenCode 纳入支持范围，但实现口径必须区分 Codex app-server/Claude 交互 Runner 与 OpenCode 非交互 fallback：无法附着既有 OpenCode 会话时，只能发送官方 slash command 或等待 runtime 子任务提供可靠路径。
- 长期记忆热区位于当前工作区 `.ch/docs/memory/`，generated recall 产物位于运行态目录 `~/.sinitek_cli/memory-generated/<workspace>/memory-index/`。插件侧踩坑记录写入 `.ch/docs/runbooks/PITFALLS.md`。运行总结或失败回复中出现明确失败、阻塞、回滚、踩坑等信号，并伴随根因、规避或验证线索时，运行时可写入结构化坑点条目；这些条目会进入 generated recall 和 prompt 注入。该写入同样受长期记忆总开关限制。
- 自动提取还有二级条件：`memoryAutoExtractAfterCompact` 只允许 compact 成功后的提取，`memoryAutoExtractAfterLoopTask` 只允许 Loop 任务完成后的提取；二者默认关闭，且必须在总开关和对应作用域开启时才允许新增或更新当前工作区 `.ch/docs/memory/` 与相关 generated recall。
- 运行时会兼容读取旧的 VS Code `sinitek-cli-tools.*` 配置值，但工具设置面板本身以 `~/.sinitek_cli/` 下的数据为主

## 4. 模式与参数映射

### thinking mode

插件对外暴露统一的 thinking mode，但实际映射按 CLI 各自处理：

- Codex：映射到 reasoning effort / 相关参数，支持 `low`、`medium`、`high`、`xhigh`、`max`
- Claude：优先映射到 Claude Code `--effort`；旧版本兼容回退到 `maxThinkingTokens` 和 SDK 选项
- OpenCode：按插件通用 CLI 参数拼装接入；当前通过 `opencode run` one-shot / 并行路径执行，不声明交互 Runner 支持
- Grok Build：只发送官方档位 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`；`off -> none`、`on -> medium`、`ultra -> max`

### interactive mode

Loop 独立子任务由扩展创建独立 CLI 会话，不等同于 provider 内部 child session。子任务启动后，主任务 tab 立即创建以 `taskId + round + subtaskId` 为稳定身份的 Loop 子代理 assistant 气泡；运行时每秒从子任务 tab 消息存储同步非 thinking、非内部子代理的可见 assistant 快照，完成、失败或中断时更新原气泡状态。子任务 tab 自身仍显示完整 assistant/thinking/trace 流，主任务进度气泡带 `subagentId` 并从父任务最终答复判定排除。

当前 AI 对话面板暴露 `coding / loop / graph` 三种顶层模式；旧 workspace 配置中的 `plan` 会按 `coding` 兼容归一化。底层 runner 仍保留历史 `plan` 分支用于类型和旧数据兼容，但 Webview 不再产生该值。前台发送新提示且没有显式 `interactiveMode` 时，当前 UI 模式优先于 tab 元数据；Graph tab 的 `graphRunId` / `openGraphRun` 只保留图入口、状态展示和恢复线索，不会把用户切换后的 Vibe/coding 或 Loop 前台发送重新路由成 Graph。后台派发和 Graph 续跑仍可按 Graph tab 元数据自动使用 `graph`：
- `loop`：扩展侧编排的多轮主子任务模式；底层 CLI 权限按内部 coding（即 Vibe）模式执行，并按会话隔离写入 `~/.sinitek_cli/loop-tasks/<workspaceKey>/<cli>/<sessionId>/loop-tasks.json` 记录任务概要（首次主任务尚未拿到真实会话 ID 时先写入 pending 路径，拿到会话 ID 后自动迁移），同时通过 `~/.sinitek_cli/loop-communications/<taskId>/` 组织沟通文件、activeSubtaskId、activeSubtaskIds、主任务 JSON 决策、acceptance 验收结果、预计剩余轮次和轮次状态，供扩展解析并以独立新会话启动子任务；工具设置支持配置 Loop 任务最大主任务复核轮次（默认 20，范围 1-100，新建任务写入当前值；已有任务在恢复、继续或下一轮运行前会随全局设置上调而提升记录上限，但不会因全局设置降低而下调）；子任务成功完成后固定自动关闭对应 AI 对话标签页；主任务每次复核应返回 `estimatedRemainingRounds` 预判剩余主任务复核轮次；`status=continue` 可返回旧 `subtask` 或新 `subtasks` 批次，扩展内部统一按批次处理；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，只有能确认 `writeFiles` / `conflictGroup` 互不重叠时才把多个子任务放入同一 `subtasks` 批次，同一批次最多 6 个；扩展会按声明的写入文件/冲突组自动规划组内并发、组间串行；单子任务时 UI 自动切换到子任务标签展示气泡和流式消息，多子任务批次会创建多个子任务标签并并发执行，只有批次内所有子任务都正常完成后才切回并唤醒主任务；参与者和主持人完成后固定自动关闭临时 tab，后续复用记录里的 sessionId 续接同一角色会话；每次主任务返回 `status=continue` 时，扩展会把该轮 JSON 协议气泡原位替换成 Markdown 子任务派发摘要，并把摘要追加到 `main-task.md`；轮次按主任务复核轮计数，同一轮可包含一个或多个并发子任务；第 1 轮要求主任务先做总体阶段规划，再优先派发首批互不冲突子任务，不再默认只派发 1 个；Loop 模型选择按 CLI 能力处理：Claude 无插件侧模型选择；Codex 普通 Coding 使用单模型，切到 Loop 时使用主模型/子模型；OpenCode 同样使用主模型/子模型口径，底层 `model` / `small_model` 仅作为 OpenCode CLI 配置字段适配；Loop 主任务、主持/复核、续跑和唤醒使用主模型，Loop 子任务使用子模型；主任务必须读取沟通文件并把 subtasks[*].prompt 写成自包含详细指令，且在完成时返回 `answerConclusion`（直接回答用户原始问题）、整体总结、各轮子任务摘要与用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md` 和任务记录，并移除最终主任务 JSON 协议气泡，在 AI 对话主消息流中先追加 `loopAnswerConclusion=true` 的 assistant Markdown 问题回答结论气泡，再追加 `loopFinalSummary=true` 的 assistant Markdown 最终总结气泡；最终总结气泡会同时展示问题回答结论和 Loop 任务整体总结；只有主任务显式返回 `status=completed`（且 `acceptance.passed=true`）才结束；主任务中断后支持在同一标签输入“继续/continue/resume”等短提示词，或直接输入任意补充说明，恢复同一任务并从当前轮次继续；子任务完成前必须写入自己的沟通文件；子任务执行出错会等待 1 分钟后重试，最多重试 5 次，主动停止不重试；子任务中断后在子任务标签手动继续时会强制按内部 coding（即 Vibe）任务执行，不允许再次启动 Loop 任务；`loop-tasks` 与 `loop-communications` 产物同样按全局 `historyRetentionDays` 保留策略清理
- Loop 子任务的停止和失败是局部生命周期事件：停止或重试耗尽时，父任务保持 `running`，并继续在 `activeSubtaskIds` 中持有尚未完成的子任务，直到该子任务在自身 Tab 手动续跑成功。只有所有活动子任务均完成，且父任务未因自身 AI 连续失败达到上限，才会恢复主任务下一轮复核。串行批次的未派发后续子任务会写为 `skipped`、从活动集合移除，并由主任务下一轮重新决定是否派发；Loop 群聊的全任务“中止”仍统一把父任务和活动子任务标记为 `stopped`
- Loop 可解析任务决策的自动睡眠与定时唤醒已下线：主任务/主持人不得返回 `status=sleep`、`wakeAfterSeconds` 或 `sleepReason`。需要等待外部结果、授权或人工判断且当前没有可执行子任务时，必须返回 `status=blocked` 并在 `finalSummary` 说明等待对象或人工判断点。旧任务 Store 中的 `sleeping` 状态在读取时降级为 `needs-review`，并丢弃 `autoSleepStartedAt`、`autoWakeAt`、`autoSleepReason`；扩展不再创建 Loop 自动唤醒定时器，也不再在 AI 对话或 Loop 群聊展示自动睡眠气泡、倒计时或计划唤醒时间。
- Codex 普通 Coding 统一读取 `PromptRunInput.model`；Loop / Graph 会同时传递 `loopMainModel` / `loopSubtaskModel` 与 `loopMainThinkingMode` / `loopSubtaskThinkingMode`。Loop 主任务、主持/复核、续跑和唤醒使用 main 角色模型与思考力度，Loop 与 Loop+ 子任务使用 subtask 角色模型与思考力度并继续受全局子任务思考力度上限约束；Graph planner 和最终 `summary` 节点使用 main 角色，其他执行节点使用 subtask 角色。子路由还可选携带 `cli` / `configId` 与请求字段 `loopSubtaskCli` / `loopSubtaskConfigId`：缺省表示同一 CLI；显式跨 CLI 时子执行使用目标 CLI 当前配置，不继承主 CLI 的模型、configId、sessionId、思考档或 OpenCode variant。Claude 没有模型字符串时仍是有效子路由。旧主/子模型持久化字段仅兼容读取和迁移。
- `loopSubtaskMaxThinkingMode` 是“工具设置 - AI任务配置”中的 Loop/Loop+ 子任务思考力度上限，默认 `xhigh`，可降低到 `low`、`medium` 或 `high`。每次 Loop/Loop+ 子任务派发时，运行时取该上限与当前所选模型力度中的较低值；因此用户选择 `max` 或 `ultra` 时子任务最多以 `xhigh` 运行，较低的用户选择不会被抬高。该覆写不影响 Loop/Loop+ 主任务、Graph 节点、普通任务或模型级持久化选择。
- Loop 群聊显式继续以主任务 Tab 当前 CLI 分组为权威：即使 Tab 已切换分组，也通过任务原 CLI 的消息/session 绑定定位同一 Tab，再按群聊继续框中的选择，保持任务已记录的主/子模型，或读取目标 CLI 当前 Loop 主/子模型配置。主任务 Tab 直接输入继续仍使用当前配置和模型。跨 CLI 恢复保留同一 `taskId`，并在运行前把任务的 CLI/session Store 归属迁移到目标分组；主任务 Tab 在同一 Loop 任务处于 `needs-review`、`error`、`stopped` 或无本实例所有权的 `running` 可恢复状态时，提交任意新 Loop 输入都等价于群聊“继续执行”，必须复用同一 `taskId` 而不是新建任务；这些中断终态优先结束主 Tab 运行态，旧编排轮次和重试在派发前必须检查终态，不能在主动停止后重新写成 `running`；缺失或未知的持久化 `status` 不具备运行所有权，读盘时按 `stopped` 收敛。

Loop 命名迁移边界：新任务只写 `~/.sinitek_cli/loop-tasks/.../loop-tasks.json` 和 `~/.sinitek_cli/loop-communications/<taskId>/`。首次枚举任务时会迁移旧 `lobster-tasks` / `lobster-tasks.json` 与 `lobster-communications`；旧设置键、工作区 `interactiveMode`、模型选择键、任务运行字段和会话消息字段在读取时归一化为 `loop*` 并随既有保存链路重写。公开命令为 `sinitek-cli-tools.openLoopGroupChat`，旧 `sinitek-cli-tools.openLobsterDebateChat` 仅注册为不再贡献到命令面板的隐藏兼容别名。

Loop 内部执行方式事实：

- `loopExecutionModeByCli` 按 CLI 记忆 Webview 下拉；`sendPrompt.loopExecutionMode` 只在顶层 `interactiveMode=loop` 时使用。合法值为 `main_sub_multi_agent` 和 `debate_multi_agent`；缺失或非法值回落到 `main_sub_multi_agent`。新建 `LoopTaskRecord` 会写入 `executionMode`，老任务缺字段时按 `main_sub_multi_agent` 归一化，恢复任务时不使用当前 UI 下拉覆盖记录值。
- `main_sub_multi_agent` 会在 `~/.sinitek_cli/loop-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，任务开始或恢复气泡会带“打开 Loop 群聊”动作；通用群聊面板把主任务和动态加入的子任务 1~N 作为成员展示，主任务决策、子任务加入、子任务完成和批次完成会追加为时间线气泡；子任务成功完成的气泡正文是该子任务最终回复，运行状态、单测/编译状态和判定依据继续落在任务记录与子任务沟通文件中，并根据 activeSubtaskId / activeSubtaskIds 显示当前主任务或子任务“思考中”。`debate_multi_agent` 也复用同一个面板：面板把红蓝对抗 `debates/round-*/chat.md` 和共识通过后的根部 `group-chat.md` 合并为单条时间线，主任务轮次、发言批次和执行阶段只作为系统消息显示，不再提供轮次切换；同一 `loopTaskId` 存在运行进程时面板显示“中止”按钮，点击后停止主任务、子任务、裁判主持人、参与者和共识汇总器等相关运行并把任务标记为 stopped；未完成且无运行进程时才显示“继续执行”按钮，两者互斥。任务进入 `needs-review` / `error` / `stopped` 时，面板末尾追加虚拟的 `主持人停止说明` error 样式气泡，用任务 `finalSummary`、共识摘要和决策状态说明停止原因，不写回原始 transcript。命令 `sinitek-cli-tools.openLoopGroupChat` 可打开任意 Loop 任务的群聊面板；找不到当前任务时会列出最近的 Loop 任务。
- `LoopTaskRecord.debateRounds` 记录红蓝对抗轮状态、`chat.md` 路径、`moderator-participants.md` 路径、动态参与者 artifact、参与者 sessionId、裁判主持人控场记录、裁判主持人 sessionId、共识和决策摘要。`debate_multi_agent` 每个主任务复核轮在 `~/.sinitek_cli/loop-communications/<taskId>/debates/round-<loopRound>/` 下生成 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/<participantId>-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/<participantId>.md`、`cross-review.md`、`consensus.md`、`decision.json`。参与者和裁判主持人的临时 tab 回答完成后固定自动关闭，下一批次同一角色通过记录的 sessionId 新建临时 tab 续接。
- `debate_multi_agent` 先启动裁判主持人红蓝组队阶段。裁判主持人读取 brief、任务记录和沟通文件后写入 `moderator-participants.md`，动态设计 2-6 个参与者；新清单的 `role` 只能是 `blue_team` 或 `red_team`，且必须至少包含 1 个蓝队和 1 个红队。蓝队负责提出、捍卫和修正方案，并补足约束、验收口径和证据要求；红队负责攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性。只有任务涉及代码、文件、权限、部署或流程执行时，红队才额外检查写入范围、并发冲突、越权修改、回滚/恢复失败和工程验收风险。扩展校验唯一 id、合法 role、title/focus 非空后，把 `## 参与者加入：<title>（<id>）` 追加到 `chat.md`。参与者和裁判主持人都以临时普通对话 tab 运行，不写 `taskRole=main/subtask`，只能写本次提示词指定的 artifact；每个发言批次开始时扩展先追加 `## 任务事件` 系统消息说明主任务轮次、当前发言批次和最大安全发言批次数；同一发言批次内参与者并行运行，各自写独立 artifact，扩展等待全部完成后再按动态清单顺序把发言追加到 `chat.md`，随后启动裁判主持人控场。裁判主持人每批次输出 `continue / finalize / block`：`continue` 表示红队攻击尚未被蓝队回应或蓝队新方案尚未被红队攻击，`finalize` 会并行进入最终立场收集，`block` 会在写入最终立场和收束标记后进入人工复核。运行时保留最大安全发言批次数作为防无限循环兜底，达到上限后强制收束，不再继续追加讨论。
- 共识汇总器读取 `brief.md`、完整 `chat.md` 与所有动态参与者最终 artifact，生成 `cross-review.md`、`consensus.md` 和纯 JSON `decision.json`。恢复 `debate_multi_agent` 任务时，若当前轮已有完整有效的 `chat.md`（含参与者加入、裁判主持人控场与 `## 群聊收束` 标记）、`decision.json`、`consensus.md` 和动态参与者最终 artifact，且共识校验允许继续，运行时优先复用 `decision.json`，再交给现有 `applyLoopMainDecision`。如果旧产物缺少裁判主持人控场、`chat.md` 或收束标记、产物缺失或不可解析，会重跑当前辩论轮；如果已有共识显示未解决阻塞，则进入 `needs-review`。
- 缺少或无法写入 `brief.md` / `chat.md`、裁判主持人红蓝参与者清单缺失或非法、任一群聊发言 artifact 缺失、裁判主持人 artifact 缺失或无法解析、最终参与者 artifact 缺失或立场不可解析、裁判主持人输出 `block`、共识后的最终参与者立场仍为 `block`、未解决 `blocking` disagreement、缺少 `cross-review.md`、`consensus.md` 不含合法共识 JSON、`decision.json` 非法、或 `status=continue` 但无合法 `subtasks` 时，运行时不派发子任务，清空 activeSubtask 字段，把任务更新为 `needs-review`，并向主 tab 系统消息和 `main-task.md` 记录原因。若 `consensus.md` 已达成但仍包含未解决阻塞，主 tab 和 `main-task.md` 应按“红蓝对抗达成阻塞共识”记录，并同步共识摘要、`decision.finalSummary` 和 `decision.estimatedRemainingRounds`，避免沿用上一轮剩余轮次造成误判。参与者 artifact 的原始 `block` 可由下一轮裁判主持人追问、蓝队修正或共识汇总器通过 `resolvedDisagreements`、前置子任务、验收标准或风险说明解决；运行时以 `consensus.md` 中的最终 `participantStances` 和 `openDisagreements` 做派发判定，缺失的 participant stance 才用 artifact stance 补齐。

### 已移除：Loop 开发级 Workflow Skills（历史记录）

已移除 `media/loop-workflow-skills/`、其加载器和同步/校验脚本；不再向主任务或子任务注入任何内置 Workflow Skill，也没有对应 UI、i18n 或用户配置开关。旧任务记录中的兼容字段不触发加载。现行行为见“Loop 子任务项目规则隔离”与 `src/loopSubtaskExecutionRoot.ts`：主任务使用真实工作区规则，子任务在隐藏根规则和项目 Skills 目录的临时根中执行，并使用 Codex `--ignore-rules`、Claude SDK `settingSources: []`、OpenCode `--pure`。

运行结束判定补充：普通 Codex / Claude / OpenCode 任务发给模型的首轮 prompt 和 hidden retry prompt 都会追加统一约定，要求任务完成后的最终回复以 `[final_answer]` 开头，过程更新不得使用该标记；界面和会话存档中的用户消息仍保留原始输入。Loop 主任务/子任务等内部机器协议显式关闭该注入和严格文本标记要求，继续依赖自身纯 JSON 决策、`status=completed` 与专用结论气泡，避免协议前缀破坏解析。普通任务的终结判定固定为协议/结构化终态：本轮用户消息之后的非 thinking assistant 显式终态（`codexFinalAnswer=true` / `phase:"final_answer"`）、包含 `[final_answer]` 的文本、OpenCode 同一 `messageID` 的非 thinking assistant `text` 与 `step_finish.reason="stop"`。Codex 显式 app-server `phase:"final_answer"` 会立即在消息上标记 `codexFinalAnswer=true`。主 turn 的 `turn.completed status:"completed"` 只表示 Codex 回合结束，不能单独当作最终回复气泡；若最后一条主线程 `agent_message` 是 `phase:null` / 缺省 phase 且其后没有工具活动，则把该条非 thinking assistant 正文提升为 `codexFinalAnswer=true`。reasoning/thinking-only 或 `phase:"commentary"` 后的 completed turn 必须进入 hidden retry。 Claude Code 2.1.283 的短回合可能不再输出 `result`，而是 assistant `stop_reason=end_turn` 后跟 `system subtype=turn_duration`。Claude 普通任务只在成功 `result`（`subtype` 为空或 `success`，且 `is_error` 不为真）或 assistant `stop_reason=end_turn` 时收口，并且本轮已有非 thinking assistant 正文、其后没有工具活动。查询正常返回本身不算收口。错误 result、只停在 tool 上的结果、thinking-only 和用户 prompt 里的 `[final_answer]` 不能收口。普通非空 assistant 文本、一般进程成功退出、thinking、trace、system、user、旧回合消息、子代理消息、`failed`、`interrupted` 和主动停止不能收口。OpenCode one-shot / 并行任务优先解析 `--format json` 文本事件，只把 stdout assistant 正文纳入判定，不把 `> build · model` 等 stderr 状态行当作结论；`step_start`、`tool_use`、reasoning 和 `step_finish.reason="tool-calls"` 等 JSONL 事件只算运行活动，不算最终答复；其中 `text`、`reasoning`、`step_start` 和 `tool_use` 会实时转成 assistant / thinking / tool-use 气泡，避免只在结束时显示最终答复。OpenCode 的正文与 `stop` 必须属于同一 `messageID`；没有后续 tool / `tool-calls`、也没有落到其他 message 的 `stop` 时，带 `time.end` 的非 thinking 完成正文同样是结构化终态。跨消息终态、无正文 `stop`、`tool-calls` 和纯 thinking 文本不得通过结构化判定。`--print-logs` 的 `timestamp=... level=` stderr 只解除启动 watchdog；INFO/WARN/DEBUG 不得进入 provider error。没有助手正文时，`level=ERROR` 的 `error.error` 进入错误气泡。进程 `code=0` 但 stdout 没有 OpenCode 原生终态时，即使已有 `tool-calls` 过程正文，也只调用一次官方 `opencode export <sessionID>`，用已知 message 本身或其后的 `finish=stop` 助手正文收口；没有 messageID 且有多条 assistant 时不猜测历史回复。`[final_answer]` 只在 Codex / Claude / OpenCode 都没有原生终态时作为替补。不读私有数据库。启动后 60 秒内若没有 assistant / error / status / progress / `--print-logs` stderr 日志任一活动才按启动空输出失败处理；一旦已观察到运行活动就立即解除外层 watchdog，不再以父 stdout/stderr 静默时长判断卡死，因为 OpenCode 分组/子代理可能在内部持续读文件、调用模型和执行工具而父 JSONL 长时间没有新事件。对于 `code=0` 的结束，Loop 只使用当前进程尝试内的非 thinking assistant 正文判断本轮是否可进入 JSON 决策解析，历史轮次正文不参与；当前尝试为空时与普通缺少最终气泡一样进入 hidden retry。OpenCode 非零退出、JSON error、空 assistant、启动空输出超时和重试耗尽最终都追加可见 system 错误气泡并落盘，provider/API 详情优先于通用退出码。其它缺少最终气泡的可续接 CLI 回合沿统一 hidden retry 配置隐式发送“继续”，每次重试前展示错误 trace 和排队提示，真正开始时再追加开始提示并恢复标签运行态。Loop 任务仍额外要求主任务对话同时存在 `loopAnswerConclusion=true` 的问题回答结论气泡和 `loopFinalSummary=true` 的最终总结气泡；记录已完成但任一气泡缺失时会恢复同一任务并再次唤醒主任务。

OpenCode Loop 会话恢复补充：上段“当前尝试为空时进入 hidden retry”对主任务有一个受限增强。只有已有远端 session、无 provider JSON error 且本次运行尚未 rollover 时，下一次重试才创建 fresh session 并发送完整主任务 prompt；新 `sessionID` 立即绑定到 tab 和 Loop task store，旧会话和其 UI 历史保留。恢复尝试不显示 provider/model 配置终态；若新会话仍为空，则恢复通常 trace 与有界重试语义。

展示层补充：Webview 仅在 assistant 气泡渲染时移除开头的 `[final_answer]` 协议前缀，行内标记保持可见；不改写用于严格判定、会话续接和存档的原始 assistant 内容；user、system 和 trace 消息保持原样。

## 5. 图片与附件

当前聊天面板支持上传附件，Codex 额外支持图片输入桥接：

- 先把附件写入 `~/.sinitek_cli/temp/`
- 若是图片且 Codex CLI 版本满足要求，会转成官方图片输入路径
- 若版本不满足，则保留向后兼容行为并提示升级

## 6. 会话与本地映射

对话 Tab 切换与历史会话打开会先恢复目标执行配置，再刷新面板和会话消息。Loop / Loop+ 主 Tab 保持任务对应模式，模型取当前 `modelRouting`，主配置优先取路由中的配置 ID，否则取 `originProfile.configId`；思考力度取任务已记录的档位。跨 CLI 子模型只使用明确绑定的目标配置，不回退主配置。子 Tab 映射为 Vibe，优先取该子会话实际执行的快照，避免任务后续改模型时覆盖原子任务模型。

新用户消息通过 `ChatMessage.executionProfile` 持久化 `{ configId, model, thinkingMode?, openCodeVariant? }`；`model` 是原始模型 ID，区别于展示用 `executionModel`。交互运行时和 OpenCode 共享运行模板在解析实际模型后补齐快照，预载消息原位更新。普通会话仅在有可靠快照时恢复；缺失配置不应用，缺失模型不重新添加、也不改对应思考力度；不支持的思考档位保持当前值。恢复复用配置应用队列和现有模型存储，过期 Tab / 工作区请求不再写模型或发布旧会话消息。

扩展侧会话 ID 与底层真实续接 ID 不同：

- Codex：扩展 sessionId ↔ threadId
- Claude：扩展 sessionId ↔ Claude sessionId

映射数据通过 `src/interactive/metaStore.ts` 落盘，避免切换会话或重启 VS Code 后丢失续接能力。

OpenCode 1.17.18 的 `run` 命令只提供 `--model` 与主模型 `--variant`，没有 `--small-model` / `--small-variant`。插件因此把 effective subtask 对应的 `small_model` 和子模型 reasoning effort 写入随机 `OPENCODE_CONFIG` overlay；overlay 保留目标配置的 task 权限，不增加允许或拒绝，也不覆盖环境中的 `OPENCODE_CONFIG_CONTENT`。OpenCode 内部 `small: true` 请求仍由底层 CLI 决定并读取 `small_model`；普通对话、并行任务、Loop 主任务、Graph planner 和 summary 使用主模型，Loop 子任务和 Graph 其他执行节点使用子模型。插件日志事件 `opencode-runtime-profile`、`runPrompt-start` 和 `runPrompt-parallel-start` 会记录 main/subtask model、各自 variant，作为运行时诊断依据。

## 7. 当前平台注意事项

### Windows

如果出现 `spawn <cli> ENOENT`：

1. 先用 `where codex` / `where claude` / `where opencode` 验证命令
2. 官方 Codex 安装器默认把可执行文件放到 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`；插件会搜索该目录，必要时仍可把 `sinitek-cli-tools.commands.codex` 配成 `.cmd` / `.exe` 绝对路径
3. 也会搜索 `%USERPROFILE%\.local\bin`、`%USERPROFILE%\scoop\shims`、Volta 和 WinGet Links；从开始菜单启动的 VS Code 仍可能看不到用户 PATH
4. 用户级配置在 `%USERPROFILE%\.codex`，不要把 `~/.codex` 写进 Windows 环境变量后指望系统展开
5. 插件初始化会自动修复一次仍是裸命令且扩展宿主找不到的 Codex/Claude/OpenCode，并把绝对路径写入 `sinitek-cli-tools.commands.<cli>`；修改 PATH 后重启 VS Code 会再试一次。没修好的项仍在工具设置“自动修复”里，左侧是 `spawn <cli> ENOENT`，右侧“一键修复”会重新读取当前用户/系统 PATH
6. Loop 子任务临时根在 Windows 上对目录使用 junction、对顶层文件优先 hardlink；跨盘时写到工作区 `.sinitek-loop-tmp`
7. Loop 临时执行根不得递归删除。宿主记录根和每个链接的设备号、inode、创建时间，清理前用 `lstatSync` 校验身份；junction 仅非递归 `rmdirSync`，其他符号链接和仍对应源文件的 hardlink 仅 `unlinkSync`，最后只删除空根。未知内容、身份变化或占用均保留并记录 `loop-subtask-execution-root-cleanup-skipped`（临时根、目标路径、错误码和错误摘要）；成功清理以调试日志 `loop-subtask-execution-root-cleaned` 记录。不自动递归清扫旧版残留 `.sinitek-loop-tmp`，不要在未拆除链接前手动强删该目录。

### macOS

如果默认 shell 环境与 VS Code 环境不一致，可切换：

- `sinitek-cli-tools.macTaskShell = zsh`
- `sinitek-cli-tools.macTaskShell = bash`

如果日志显示 `spawn <absolute-cli-path> ENOENT`，但该 CLI 文件和 symlink 都存在，还要检查同一日志行的 `cwd` 是否存在；Node 在 `cwd` 已被清理或不可达时也会抛出同形态 ENOENT。

### 已移除：OpenCode 全局 MCP 与 MCP 市场

- 配置中心不再提供 MCP 市场、安装、卸载或健康检测，也不会改写用户磁盘上已有的 MCP 配置。
- 内置 `media/mcp_marketplace.json` 和 `npm run validate:mcp-marketplace` 已删除。
- 插件不再安装或卸载 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`。CodeGraph 状态检测仍只读取该文件以及 Claude / Codex 已有 MCP 配置，判断 `codegraph` 是否已注册。

## 8. 更新本文档时的原则

只有下面两类内容应进入这里：

- 当前仓库已经落地、可被代码验证的行为
- 对使用者排障有高价值的运行事实

不要把未来方案、未实现提案或纯猜测放进来；那类内容应进入设计文档或技术债跟踪。
