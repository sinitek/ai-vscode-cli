# VS Code CLI 插件运行时架构

- 状态：accepted
- 相关目录：`src/`、`media/`、`docs/`
- 相关计划：`.ch/docs/exec-plans/completed/2026-04-02-docs-migration-to-ch.md`（完成后归档）
- 历史来源：原 `docs/支持交互.md`、`docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md`

## 1. 设计目标

当前仓库不是后端服务，也不是多包 monorepo，而是一个单扩展仓库。它的核心职责只有一件事：

> 在 VS Code 内承接用户输入，协调本地 CLI 运行，并把会话、配置和结果稳定展示出来。

这意味着运行时架构必须优先满足：

- 本地执行，不引入远程中间层
- 多 CLI 共存，但对 UI 暴露统一体验
- 交互式会话、一次性执行、配置中心可以并存
- 本地状态可恢复、可排障、可国际化

## 2. 目录分层

```text
src/
├── extension.ts              # 扩展入口、命令注册、状态编排、面板消息总线
├── cli/                      # CLI 设置读取、命令解析、参数构建、进程执行
├── interactive/              # Codex/Claude/OpenCode 交互 Runner 与会话映射
├── webview/                  # 侧边栏聊天面板、配置中心面板、前后端协议
├── config/                   # 本地配置档案、Skills、MCP、官方目录管理
├── trace/                    # trace/tool 事件格式化
├── loopDebate.ts          # Loop 辩论记录、路径、群聊解析和共识校验纯函数
├── loopAutoWake.ts        # Loop 自动睡眠协议校验与可恢复定时唤醒控制器
├── loopSubtaskExecutionRoot.ts # Loop 子任务规则隔离执行根
├── logger.ts                 # 本地日志与脱敏
├── i18n.ts                   # 扩展侧国际化
└── errorDisplay.ts           # 统一错误展示
media/
├── marked.min.js             # 聊天面板 Markdown 运行时依赖
├── config/assets/            # 配置中心前端静态构建产物
├── mcp_marketplace.json      # MCP 市场数据
└── official_skills_catalog.json
```

## 3. 运行主链路

### 3.1 扩展入口层：`src/extension.ts`

`extension.ts` 是总编排器，负责：

- 注册 VS Code 命令与视图
- 初始化状态栏、聊天面板、配置中心
- 维护当前 CLI、当前工作区、当前会话和多 Tab 状态
- 接收 Webview 消息并分发到 CLI、交互 Runner、配置服务
- 将运行结果、trace、任务列表和状态变更回推给 Webview

这里允许持有状态，但不应该把 CLI 协议细节、配置文件读写细节或具体 Webview DOM 逻辑塞进来。

### 3.2 聊天面板层：`src/webview/*`

聊天面板由两部分组成：

- `viewProvider.ts`：负责 WebviewView 注册、HTML 装载和消息转发
- `viewContent.ts`：内联生成聊天面板 HTML、样式、脚本和前端状态机

聊天面板负责：

- 渲染消息、trace、任务列表、队列、历史记录
- 采集用户输入、附件、路径选择、规则编辑动作
- 通过 `postMessage` 向扩展发送结构化消息

它不负责直接访问本地文件系统，也不直接执行 CLI。

### 3.3 配置中心层：`src/webview/configPanel.ts` + `src/webview/configView.ts`

配置中心是独立的 `WebviewPanel`：

- `configPanel.ts` 负责消息协议与请求转发
- `configView.ts` 负责装载 `media/config/assets/*` 构建产物
- 具体数据处理全部委托给 `src/config/configService.ts`

也就是说，配置中心的前端和聊天面板是两套 UI，但共用同一扩展宿主和配置服务。

## 4. CLI 执行分层

### 4.1 `src/cli/*`：一次性执行与命令解析层

- `config.ts`：从 VS Code settings 读取 CLI 命令、参数、思考模式、shell 选项等
- `commandRunner.ts`：负责命令解析、PATH 探测、命令可用性检测、一次性流式执行与输出捕获
- `modelArgs.ts`：统一处理模型参数读写
- `opencodeconfigmodels.ts`：解析 active config 双角色候选、strict exact ref 与 effective overlay 对象
- `opencoderuntimeconfig.ts`：创建 `0700` 临时目录、`0600` JSON overlay 和幂等清理
- `installer.ts`：提供不同 CLI 的安装提示文案
- `types.ts`：定义 CLI 名称、思考模式、交互模式等稳定类型

这一层只关心“如何把命令跑起来”，不负责聊天状态和 Webview 呈现。

### 4.2 `src/interactive/*`：会话型执行层

Codex / Claude 已进入交互 Runner；OpenCode 当前不进入本层，普通 AI 任务走 `src/cli/commandRunner.ts` 的 `opencode run --auto --format json [message..]` one-shot / 并行子进程路径：
- 普通消息、并行请求、全部 Loop 主任务/子任务、续跑和唤醒最终共享 `commandRunner.ts` 的 OpenCode 参数构建器；构建器集中注入并去重官方 `--auto`，所以这些路径不会各自维护权限参数。无 prompt 的终端启动也复用同一构建入口，默认得到 `opencode --auto`。
- 首轮 `opencode run --format json` 流式事件中的 `sessionID` 是 OpenCode 真实续接 ID；`sessionLifecycle.ts` 负责结构化提取并让 tab 接管该 `ses_*`，后续运行才可生成 `--session <ses_*>`。插件生成的 `local_*` 只用于真实 ID 缺失时暂存消息，运行边界会过滤它；旧 tab 捕获新真实 ID 后通过既有本地会话迁移逻辑保留消息和 tab 引用。
- `--auto` 只自动批准未被显式拒绝的请求；runtime overlay 继续保留 active config 的 `permission`，不会为了跨目录访问覆盖用户或 agent 的显式 `deny`。
- primary/small 覆盖按 active config id 保存；PanelState 重解析 active config、清理失效覆盖并序列化双角色候选与 issue code。
- 普通、并行和全部 Loop 对话只使用 effective primary 作为 `--model`；effective small 只进入本次运行 overlay，variant 只绑定 primary。
- overlay 不改写用户配置，并在 exit/error/timeout/cancel 后清理；启动前校验 effective 角色和 overlay 后配置。
- OpenCode 在对话面板提供 coding / Loop 两种模式；Loop 复用现有主任务、子任务、多轮复核、任务群聊、状态落盘和唤醒链路，每次主任务或子任务仍通过非交互式 one-shot `opencode run` 执行。
- `isInteractiveSupported(opencode)` 继续为 `false`，只表示 OpenCode 不提供 Codex/Claude interactive runner 与 common command。该标记不能用于隐藏 Loop 模式入口，也不能为了开放入口改成 `true`，否则普通 coding 请求可能错误进入不存在的交互式链路。
- OpenCode 不读取 Codex 专用的 Loop 主任务/子任务模型分配；对话、并行请求、Loop 主任务、Loop 子任务、续跑和唤醒都使用 active config 解析出的 effective primary，`small_model` 仅供 OpenCode 自身内部轻量请求。
- 由宿主解析 JSON 决策的 Loop 任务协议支持通用 `status=sleep + wakeAfterSeconds + sleepReason`，不是主任务专属；普通自由文本回复不会触发自动睡眠。`extension.ts` 把相对间隔转换为绝对 `autoWakeAt` 并持久化 `status=sleeping`；`loopAutoWake.ts` 只负责协议边界、长延迟分段定时、状态复核、到期重试和取消。扩展激活时从当前工作区任务 Store 恢复睡眠任务，已到期任务直接复用 `runLoopPrompt`、原 CLI/session 和当前 Loop 轮次继续；VS Code 完全退出期间不运行外部守护进程。带合法 `autoWakeAt` 的睡眠任务跳过普通历史保留淘汰，人工继续、完成或中止后清除睡眠字段，避免陈旧定时器再次启动。


- `manager.ts`：按 `cli + sessionId` 复用 Runner，并处理空闲释放
- `codexRunner.ts`：通过 `codex app-server --listen stdio://` 建立 JSON-RPC 会话，维护主 threadId；`item/agentMessage/delta`、`collabAgentToolCall`、`subAgentActivity` 和 `turn/completed` 均按通知 `threadId` 区分父线程与子线程，子线程输出进入独立子代理气泡，不得改写主 threadId、主任务列表、父回复 final 标记或父 turn 完成状态。Runner 优先直接启动已解析的 Codex 可执行路径，显式注入 `CODEX_HOME` / `CODEX_HOME_DIR`，启动前确保工作区 trust，并在回合结束时优先走 graceful shutdown；“常用命令 -> 压缩上下文”对 Codex 直接复用当前 threadId 发送 `thread/compact/start`，且全局工具设置“执行后自动压缩上下文”（默认开启）会在已有会话任务成功结束且执行超过 5 分钟后自动触发同一路径；任务中断、报错或执行不超过 5 分钟不触发
- `claudeRunner.ts`：通过 `@anthropic-ai/claude-agent-sdk` 建立交互会话，维护 Claude session；“常用命令 -> 压缩上下文”优先直接发送官方 `/compact`，并根据 SDK `status=compacting` / `compact_boundary` 信号判定完成；仅在旧环境明确不支持原生 compact 时回退到摘要模拟
- `metaStore.ts`：把扩展 sessionId 与 threadId / Claude sessionId 的映射落盘
- `claudeTranscript.ts`：辅助 Claude 历史恢复

OpenCode 运行前只读取当前激活配置并生成本次运行 overlay；但不会请求 `InteractiveRunnerManager` 创建 Runner，避免没有 OpenCode 交互适配时触发 `interactive-runner-unsupported:opencode`。OpenCode 官方 TUI 支持 `/compact`（alias `/summarize`）用于 compact current session，且配置层有 `compaction.auto` 默认自动压缩；因此插件侧可以把 OpenCode 纳入手动压缩与执行后自动压缩的产品范围，但运行时必须清晰区分可附着会话链路与非交互 fallback，不能把 OpenCode 说成已经拥有与 Codex app-server 完全相同的压缩通道。配置中心不再维护 `~/.opencode/.env`，OpenCode 配置页只有一个 `config.json` 保存入口。Codex 配置页不同于 OpenCode / Claude：主配置文件是 `~/.codex/config.toml`，格式为 TOML，并另有 `~/.codex/.env` 环境变量文件；配置中心需要同时支持 Codex 常用字段可视化编辑、TOML 源码编辑和 `.env` 文本管理，不能把 Codex 主配置误建模为 JSON。运行前还会校验 OpenCode 自定义 provider 配置，阻止 `myprovider/my-model-name`、`myAPI` 范例模型或未解析环境变量、示例 baseURL 等未完成配置，并提示 OpenAI-compatible provider 使用实际 `/v1` endpoint；旧裸域名问题仅作为历史踩坑记录，不再作为当前示例名称。

OpenCode 模型选择按 active config 解析为两个角色下拉：主模型对应顶层 `model`，小模型对应顶层 `small_model`，候选均只来自 `provider.<id>.models`，不复用插件模型管理器，也不提供新增、编辑、删除或排序入口。聊天区 DOM 只保留两个紧凑 select 与共享错误区域，不显示可见角色 label、思考力度说明或“跟随配置”option；正常 option 文本只使用模型 `name`，缺失时回退 model id。选择当前配置默认 ref 时，Webview 发送 `null` 清除该角色的临时覆盖；其他选择发送 exact ref。普通对话、并行任务、Loop 主任务与 Loop 子任务继续使用主模型；小模型仅服务 OpenCode 内部轻量请求，不是 Loop 子任务模型。

配置中心的 OpenCode `config.json` 卡片默认使用 Provider/模型可视化编辑器，并保留 JSON 高级模式。可视化层基于原始 JSON 深拷贝维护保留底稿，只重建 Provider/模型索引和编辑器负责的字段；Provider 支持 `id/name/npm/options.baseURL/options.apiKey`，模型支持 `id/name/reasoning`、主/小角色和逗号思考力度。力度输入 trim、去空、稳定去重，首项写 `options.reasoningEffort`，全部值生成简单 variants；清空只删除编辑器管理的简单 reasoning 字段，复杂 variants 和未知顶层/provider/model/options 字段保留。Provider/模型 id 重命名同步顶层 `model` / `small_model`，删除引用项会形成显式校验错误并阻止保存；无效 JSON 不覆盖有效可视化状态，范例导入后立即重建可视化。Claude 配置卡片的视觉样式、背景和表单密度对齐 OpenCode 配置卡片，但仍按 Claude `settings.json` 的字段语义保存。保存仍先更新配置档案，仅当档案为当前激活配置时调用应用链路；API Key 仅以密码输入展示，不写日志。

主模型运行时通过精确 `--model provider/model` 覆盖，并可用 `--variant` 选择该主模型 variants。CLI 不存在 `--small-model`；小模型临时选择必须写入本次 runtime config overlay 的顶层 `small_model`。每个模型的 `options` 定义基础参数，`variants` 定义该模型作为主模型运行时的可选档位；OpenCode 内部小模型请求会跳过 variants，只使用小模型自身 `options`。`@ai-sdk/openai-compatible` 只描述 API 协议适配器，不决定 low/medium/high 等档位。

OpenCode 输出由 one-shot 适配层解析：成功退出时优先从 JSON 事件提取 assistant 文本生成最终结论气泡；默认格式兼容路径只接受 stdout 正文，不把 stderr 中 `> build · model` 这类状态行当作最终回答。若 CLI 输出 JSON `error` 事件，即使进程 `code!=0` 且 stderr 为空，也会把其中的 `APIError`、HTTP status、provider message、`responseBody.error.code` 和请求 URL 作为错误展示；只有没有可解析 provider/API 错误时才回退通用 `CLI 退出码`。若 `code=0` 但当前尝试没有非 thinking assistant 文本，one-shot 与并行路径都会展示明确的 OpenCode 空响应诊断并进入既有 hidden retry，重试耗尽后才按错误收口。Loop 后续轮次虽然复用初始用户消息锚点，但成功判定只认当前进程尝试的正文，不能用历史轮次 assistant JSON 替当前空响应通过。one-shot 只在启动后 60 秒完全没有 assistant / error / status / progress 活动时转成 OpenCode 启动空输出错误并进入 hidden retry；父 JSONL、子代理会话或子代理气泡出现活动后解除 watchdog。内部子代理增量不会由父 `run --format json` 转发；OpenCode 1.17.18 虽接受 `run --port`，但实测不会可靠监听该端口，因此 one-shot / 并行运行由插件显式启动受管 `opencode serve`、等待 `/global/health` 成功，再让父任务通过 `run --attach` 连接同一服务。捕获父 session 后订阅公开 `/event` SSE；子会话事件只触发读取 `/session/{id}/message` 权威快照，并通过 `/session/{parent}/children` 与 `/session/status` 校验父子关系和状态。无论 SSE 是否遗漏，运行期间都每 60 秒全量补捞一次；每个当前尝试新建的子 session 对应一个独立、不可合并的 assistant 气泡，正文按快照前缀增量追加，完成、失败和中断更新原气泡。服务启动失败时只显示一次监控降级状态并继续原父任务；SSE 重连指数退避到最长 60 秒，避免连接故障刷屏。任务结束、失败或停止统一关闭受管服务、订阅和轮询。该链路不读取 OpenCode 私有 SQLite，子代理消息标记 `subagentId`，不参与父任务最终答复与 hidden retry 成功判定。重试耗尽时必须追加可见 system 错误气泡、写入会话存档并记录日志。

当且仅当 Loop 主任务已有可续接的远端 OpenCode session、当前空成功响应不含 provider JSON error，且同一运行尚未 rollover 时，下一次 hidden retry 以不带 `--session` 的新会话重新发送完整主任务 prompt。捕获新 `sessionID` 后，插件保留旧 session、复制 UI 会话记录到新 session、更新当前 tab 和 `LoopTaskRecord.sessionId/taskStoreFile`，再继续原状态机；不对 Loop 子任务、普通对话、已有 provider error 或第二次空响应重复切换。恢复中的中英文 system 消息只说明会话恢复，不把可恢复的旧会话空响应显示为 provider/model 配置终态。

OpenCode `text` JSONL 允许同一字符串同时包含内部思考 wrapper 与可见正文。解析层必须按顺序拆分 `<thinking>` / `<think>` / `<analysis>` / `<reasoning>` 块与 assistant 文本，最终结论只收集 assistant 段；Codex reasoning 和历史消息复用同一 wrapper 去除逻辑。该能力是定向协议清洗，不是通用 HTML sanitizer，普通尖括号标签必须原样保留。

Gemini 已从当前支持 CLI 中移除；旧 one-shot 路径只作为历史迁移参考。

### 4.3 扩展侧 Loop 编排

Loop 模式仍由 `src/extension.ts` 统一编排，不新增独立后端服务或新的顶层 `InteractiveMode`。当前内部执行方式有两种：

Loop 的主任务、子任务、裁判主持人和参与者是编排角色，不是模型角色。Webview 和运行时按 CLI 能力选择模型：Claude 在 Coding/Loop 均不显示插件侧模型下拉；Codex 在 Coding/Loop 共用一个 `modelSelect`，`sendPrompt` 只传一个 `model`，所有 Loop 角色、续跑和自动唤醒都沿用该值；OpenCode 在两种模式中保留自身 primary/small 双模型和各自思考力度，所有 Loop 对话角色使用 effective primary，small 只供 OpenCode 内部请求。旧主/子模型存储结构可以被归一化读取，但不得再暴露到 PanelState 或参与运行时选择。

Loop 子任务是插件创建的独立 CLI 会话，不属于 OpenCode/Codex 的内部 child session。每个子任务启动时，主任务 tab 立即创建一个按 `taskId + round + subtaskId` 隔离的 Loop 子代理 assistant 气泡；运行中每秒从对应子任务 tab 的消息存储读取非 thinking、非内部子代理的可见 assistant 快照，并将新增正文或修正快照定向更新到原气泡。完成、失败和中断更新同一气泡状态；子任务 tab 自身的 assistant/thinking/trace 事件保持不变。主任务进度气泡带稳定 `subagentId`，不会进入父任务 final-answer 或 successful-reply fallback。

- `main_sub_multi_agent`：经典主从多智能体，主任务直接返回 `LoopMainDecision`，再复用现有子任务批次、冲突规划、重试、沟通文件和最终总结链路。运行时在 `~/.sinitek_cli/loop-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，任务开始/恢复气泡会显示“打开 Loop 群聊”动作；内容区群聊面板把“主任务”和动态加入的“子任务 1~N”作为成员展示，成员区标题统一使用“成员”，不沿用红蓝文案；子任务成功完成后的发言气泡展示该子任务最终回复，运行状态与验证依据继续写入任务记录和子任务沟通文件，并在主任务或当前子任务运行时显示“思考中”气泡。未完成且未触发主任务 AI 连续失败上限的 Loop 任务都会在群聊面板显示“补充需求”按钮，把新增需求写入任务记录与主任务沟通文件，供下一轮主任务/裁判主持人读取；当同一 Loop 任务当前没有运行进程且仍可继续时，群聊面板额外显示“继续执行”按钮，点击后先弹出可编辑确认框（默认“继续”），确认后复用同一 `resumeTaskId`，把该继续消息作为本次继续指令交给主任务/裁判主持人判断下一步；同一 Loop 任务存在运行进程时，群聊面板显示“中止”按钮并按 `loopTaskId` 停止主任务、子任务和相关运行，把任务记录标记为 stopped。AI 对话面板中的 Loop 主任务 tab 在主任务或同一 Loop 任务任一子任务仍在运行时强制跟随最新消息；用户手动滚离底部时仍显示置底按钮，点击后回到最新消息。普通 Vibe tab 与 Loop 子任务 tab 保持原有按用户滚动位置决定的策略。
- `debate_multi_agent`：只替代主任务规划/复核阶段，并以红蓝对抗作为辩论语义。每个主任务复核轮先通过临时普通对话 tab 启动裁判主持人组队，裁判主持人写入 `moderator-participants.md` 并动态设计 2-6 个红蓝参与者；新清单的 `role` 只能是 `blue_team` 或 `red_team`，且必须至少包含 1 个蓝队和 1 个红队。蓝队负责提出、捍卫和修正方案，红队负责攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性；只有任务涉及代码、文件、权限、部署或流程执行时，红队才额外检查并发冲突、越权修改、回滚/恢复失败等工程风险。扩展校验后把这些成员作为 `## 参与者加入：...` 写入 `chat.md`。每个发言批次内参与者并行运行，各自只写独立的 `participants/<participantId>-turn-<n>.md`，扩展等待本批次全部 artifact 完成后按裁判主持人清单顺序追加到 `chat.md`，再启动裁判主持人写 `participants/moderator-turn-<n>.md` 并输出 `continue / finalize / block`；`continue` 表示红队攻击尚未被蓝队充分回应或蓝队新方案尚未被攻击，`finalize` 并行收集最终 `participants/<participantId>.md` 和 `## 立场` 后交给共识汇总器生成 `decision.json`，`block` 进入人工复核。参与者和裁判主持人的临时 tab 在回答完成后可按“Loop 子任务自动关标签”设置关闭，后续同一角色优先用 `debateRounds` 中记录的 sessionId 新建临时 tab 续接。最大发言批次数只作为防无限循环安全上限，达到上限后运行时强制收束。红蓝辩论任务也复用“打开 Loop 群聊”动作；通用面板把 `debates/round-*/chat.md` 与根部 `group-chat.md` 合并为单条时间线，主任务轮次、发言批次和执行阶段以系统消息呈现，不再提供轮次切换，并根据 `debateRounds.activeSpeaker` 显示当前裁判主持人/参与者/共识汇总器的“思考中”等待气泡。群聊面板的“中止”入口同样按 `loopTaskId` 停止裁判主持人、参与者、共识汇总器以及共识通过后的主从执行子任务，并把运行中的辩论轮和参与者标记为 stopped。共识通过后仍交给现有 `applyLoopMainDecision`，子任务执行链路不分叉，但主任务决策、子任务加入、子任务完成和批次完成会继续写入根部 `group-chat.md`，同一任务页面继续在同一时间线展示后续“任务执行群聊”消息，并根据 activeSubtaskId / activeSubtaskIds 显示当前主任务或子任务“思考中”。两种模式的群聊面板都会在状态落盘后主动刷新，5 秒自动刷新仅作兜底；若刷新前群聊滚动位置距离底部不超过 50px 会自动跟随最新气泡，否则保留阅读位置并显示置底按钮，同时保留手动刷新；当任务尚未完成且未触发主任务 AI 连续失败上限时，面板都提供“补充需求”以把新增要求持久化到任务记录和主沟通文件，供下一轮主持人或主任务读取。不同 `taskId` 的 Loop 群聊页面由扩展侧按任务隔离管理，可同时打开；同一 `taskId` 重复打开时复用该任务已有页面并刷新状态。

Loop 主任务 tab 的视觉运行态、关闭锁和提示词队列门禁由持久化任务状态加当前扩展实例的运行所有权共同决定。当前实例会跟踪从 `runLoopPrompt` 取得任务到编排收尾的主任务所有权，并把它与主/并行/交互 CLI 运行集合合并；因此任务记录为 `running` 且该集合仍包含同一 `taskId` 时，即使正处于主任务与子任务、裁判主持人与参与者之间的编排空档，主 tab 仍保持运行态和不可关闭。编排所有权按任务引用计数，每个运行只释放自身句柄，避免终止后立即恢复时旧运行的 `finally` 误删新所有权。任务仍由当前实例持有运行权时，在主 tab 提交的新提示词直接加入该 tab 队列，不能通过阶段性进程空档启动新任务，手动继续和自动出队也会被阻止。`needs-review`、`error`、`stopped` 是明确中断终态，优先于尚未完成异步释放的旧所有权，立即结束视觉运行态；轮次和子任务重试在派发前再次读取 Store，不能在主动停止后把状态写回 `running`。进入中断终态后，主 tab 的下一条 Loop 输入等价于群聊“继续执行”，复用同一 `taskId` 并把输入作为本次继续说明，不新建 Loop 任务。若任务记录遗留 `running`、但当前实例已不拥有任何对应编排或 CLI 运行时，则将其收敛为 `stopped`，清理活跃子任务/辩论状态并解除关闭与重置锁；编排中未捕获的异常也必须写入 `error` 终态，不能留下永久锁。队列条目保留入队时的 coding / Loop 模式，因此 tab 切到后台后自动出队也不会把 Loop 请求错误降为 coding。任务进入 `completed` 后自动发送队首提示词；进入中断终态后解除 tab 锁定但保留队列，等待用户手动继续。普通 Vibe tab 与 Loop 子任务 tab 继续按实际执行进程显示运行态和使用原有冲突弹窗。会话重置由扩展端先完成新建空白 Tab 和关闭旧 Tab，再回推 PanelState/消息；Webview 不得在该操作确认前清空旧 Tab 的运行时消息。

群聊显式继续和主任务 tab 中断后继续，都以主任务 conversation tab 当前 CLI 为运行权威，而不是 `LoopTaskRecord` 创建时的 `cli` 快照。目标查找会读取该 tab 在任务原 CLI 下保存的消息/session 绑定，因此切换 CLI 后仍能定位同一主任务 tab；恢复前再按目标 CLI 读取当前激活配置和模型，并把同一任务 ID 的 `cli`、`sessionId`、`taskStoreFile` 迁移到目标 CLI/session Store。`executionMode`、根目标、轮次和沟通目录继续来自原任务记录，不被当前 UI 下拉重置。

`src/loopDebate.ts` 只保存辩论路径、主从 `group-chat.md` 路径、记录类型、群聊回合 artifact 路径、裁判主持人决策类型、红蓝角色常量、群聊 transcript 标题解析、主从子任务发言正文格式化和共识校验纯函数，不访问 VS Code API 或文件系统。实际文件读写、`chat.md` / `group-chat.md` 追加、任务记录更新、tab 创建、内容区 WebviewPanel 创建和失败降级都留在 `extension.ts` 编排层。AI 对话历史记录弹窗的“Loop 群聊” tab 只下发任务摘要并按 `taskId` 打开对应任务的内容区群聊面板，不直接加载普通 session 或自动继续任务。`debate_multi_agent` 发生 `chat.md` 缺失或未收束、裁判主持人 artifact 缺失或无法解析、参与者 artifact 缺失、共识后仍有未解决阻塞、非法 `consensus.md` / `decision.json` 或无法派发合法子任务时，会把任务更新为 `needs-review`，不静默回落到经典主任务规划。参与者 artifact 的原始 `block` 如果被裁判主持人追问、蓝队修正或共识汇总器明确转化为前置子任务、验收标准或风险说明，并写入 `resolvedDisagreements`，运行时允许按 consensus 的最终 `participantStances` 继续。

自动重试成功和用户在子任务 Tab 中手动恢复后成功结束，均必须先完成同一子任务状态/沟通记录收尾；若全局“Loop 子任务自动关标签”设置开启，再关闭该子任务 Tab。手动恢复再次错误或停止，以及关闭该设置时不自动关闭 Tab；主任务继续唤醒仍受任务可恢复状态和主任务连续 AI 失败上限约束。

#### 4.3.1 子任务项目规则隔离与少轮次执行

Loop 主任务继续以真实工作区作为 cwd，使用项目规则完成规划、派发和复核。`runPrompt` 仅在 `taskRole="subtask"` 时创建 `LoopSubtaskExecutionRoot`：它在系统临时目录建立根目录，只链接工作区可工作条目，跳过根 `AGENTS.md`、`CLAUDE.md`、`.agents`、`.claude`、`.codex`，因而写操作仍落在真实工作区而 CLI 不会从临时根发现项目规则或项目 Skills。

临时根在 one-shot、parallel 与交互运行路径间统一传递，并在 `finally` 中删除。Codex 子任务调用会添加 `--ignore-rules`，Claude SDK 以 `settingSources: []` 运行，OpenCode 子任务调用会添加 `--pure`。主任务将任务目标、授权、沟通文件和验收明确传给子任务；子任务必须在一个连续执行回合中完成当前授权范围，只运行最小必要验证，不自行重新拆分主任务或增加可选轮次。

此前的内置 Workflow Skill 快照、loader、model-prompt 注入和同步/校验脚本已删除。旧记录字段仅用于兼容读取，不会触发任何 Skills 加载或注入。

## 5. 配置与本地集成层

`src/config/configService.ts` 是本地配置集成的唯一核心入口，负责：

- 读取和写入 `~/.claude`、`~/.codex`、OpenCode 相关配置；Codex 配置中心维护 `~/.codex/config.toml` 主配置（TOML）、`~/.codex/.env` 环境变量文件和既有受控鉴权入口；OpenCode 配置中心只维护模型/Provider 配置 `~/.opencode/config.json`，全局 MCP 管理另维护官方 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`；不再维护 `~/.opencode/.env`，旧 `~/.gemini` 配置仅作历史迁移参考，不再作为当前配置中心支持口径
- 配置中心 UI 的 Claude、OpenCode、Codex 三组可视化参数采用同一交互约定：参数 label 右侧展示问号 tooltip，枚举参数在 tooltip 中列出允许值；“查看范例”入口固定在配置文件名右侧，三组保持 OpenCode 风格的相同位置和密度
- 管理配置档案（config profiles）
- 管理备份、导出
- 扫描和安装 Skills
- 扫描、安装、卸载、检测 MCP
- 读取内置官方 Skills / MCP 市场目录

与之配套的 `src/config/codexSkills.ts`、`claudeSkills.ts`、OpenCode 相关 Skills 模块负责各平台 Skills 的列表与受控配置片段合并；`geminiSkills.ts` 仅作旧实现迁移参考。

## 6. 状态落盘与本地数据

插件自身状态统一保存在：

```text
~/.sinitek_cli/
```

当前主要包括：

- `settings.json`：工具设置中的全局项（如 debug、自动文件标签、执行后自动压缩上下文、隐式子代理、语言、macOS task shell）；自动压缩使用 `autoCompactContextAfterRun`，默认开启；隐式子代理使用 `multiAgentEnabled`，默认关闭
- `sessions/`：按工作区维护会话元信息
- `messages/`：会话消息内容
- `prompt-history/`：历史提示词
- `workspace-settings/`：工作区级 UI/CLI 偏好与项目级工具设置；旧 `autoCompactContextAfterRun` / `autoCompactContextBeforeRun` 和 `multiAgentEnabled` / `codexMultiAgentEnabled` 分别只作为全局自动压缩、全局隐式子代理开关的迁移输入，成功迁移或用户更新后移除
- `models.json`：各 CLI 的模型列表与选择
- `tasks.json`：任务相关状态
- `loop-tasks/`：按工作区、CLI 和会话隔离的 Loop 任务记录；新任务写入 `executionMode`，老任务缺字段时按 `main_sub_multi_agent` 兼容，辩论模式额外保留 `debateRounds`；开发级新任务可保存宿主 `taskKind`，子任务可保存宿主确认的 `skillIds/skillGuidance` 快照，旧记录缺少这些可选字段时继续按原 Loop 读取和运行
- `loop-communications/`：Loop 主任务、子任务和辩论沟通文件；`debate_multi_agent` 在 `<taskId>/debates/round-<n>/` 下生成 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/*-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/*.md`、`cross-review.md`、`consensus.md`、`decision.json`
- 旧 Lobster 版本的 `lobster-tasks`、`lobster-tasks.json` 与 `lobster-communications` 仅作为迁移输入。任务枚举会先将通信树移动/合并到 Loop 目录，再按任务的 workspace、CLI 与 session 写入规范化的 `loop-tasks.json`；相同目标文件内容冲突时保留 `.pre-loop-migration` 副本。设置、工作区、模型、任务运行记录和会话消息中的旧前缀键也由 `src/loopLegacyMigration.ts` 统一迁移，新键优先
- `temp/`：临时附件文件
- `logs/`：运行日志

设计原则：

- 会话正文与会话元数据分离
- UI 偏好按工作区存储
- 日志与临时文件都要有清理策略

## 7. 横切能力

### 7.1 国际化

- 扩展侧使用 `src/i18n.ts`
- VS Code contribution 文案走 `package.nls.json` / `package.nls.zh-cn.json`
- Webview 内部文案由 `src/webview/viewContent.ts` 内置中英文词典提供

新增功能如果只改了扩展侧字符串、没补 Webview 文案，仍然算未完成。

### 7.2 日志与诊断

`src/logger.ts` 负责：

- debug 日志开关
- CLI stdin/stdout/stderr / trace 记录
- 环境变量脱敏
- 最近 30 天（约 1 个月）日志保留
- 10MB 分段切割

`src/extension.ts` 同时负责对工作区级历史数据执行保留策略：

- 历史提示词仅保留最近 30 天（约 1 个月）
- 历史会话仅保留最近 30 天内使用过的记录，并清理对应消息文件与交互映射
- `tasks.json` 中的任务运行记录仅保留最近 30 天（约 1 个月）
- 会在插件启动后的后台清理中覆盖当前工作区与其他旧工作区，不依赖用户重新打开旧工作区

配置中心空白页排查优先落在本插件可控链路：Webview 渲染、配置解析、初始化数据和本插件日志。`AugmentExtensionSidecar` 对 Augment 服务返回 403 属于外部扩展请求失败，通常不能作为本插件 Claude 配置页空白的直接根因证据；只有同时有本插件错误链路指向相关交互时才继续关联排查。

`src/errorDisplay.ts` 负责把异常统一转换为：

- 弹窗摘要
- 可复制详情
- 可打开文本详情页

## 8. 关键边界

### 允许的依赖方向

```text
webview UI
    ↓
extension.ts 编排层
    ↓
cli / interactive / config 服务层
    ↓
本地文件系统 / 本地 CLI / 外部 SDK
```

### 明确不要做的事情

- 不要让 Webview 直接感知 `fs`、CLI 或 home 目录结构
- 不要让 `configService` 反向依赖 Webview DOM 或消息渲染
- 不要把 Codex / Claude / OpenCode 的协议分支散落到多个 UI 文件
- 不要在多个模块重复维护同一份本地状态格式

## 9. 扩展规则

### 新增一个 CLI 能力时

先判断落点：

1. 如果只是新增设置读取或命令构建，放到 `src/cli/`
2. 如果是会话型协议复用，放到 `src/interactive/`
3. 如果涉及本地配置、Skills、MCP 或外部目录管理，放到 `src/config/`
4. 如果只是展示或交互优化，放到 `src/webview/`
5. 如果需要全链路编排，再回到 `src/extension.ts` 做总线接入

### 新增 UI 时

- 聊天侧边栏：优先复用 `viewContent.ts` 的状态模型和协议
- 独立复杂面板：优先参考配置中心，拆成 `Panel + View + Protocol`

### 新增本地状态时

- 先判断是否已有 `~/.sinitek_cli/` 下可复用的数据域
- 命名要体现作用域：全局、工作区、会话、临时
- 需要说明清理策略与兼容策略

## 10. 当前已知限制

- `extension.ts` 仍然偏大，属于中心编排文件，后续若继续扩展应逐步下沉非核心细节
- OpenCode 的专属参数、会话续接和上下文压缩能力仍以当前实现为准；文档不得预设未验证的 CLI 行为
- 聊天面板 HTML 和脚本仍以单文件生成方式维护，适合当前体量，但未来若继续增长应考虑进一步模块化
- Loop 自动唤醒依赖 Extension Host 运行；VS Code 退出期间不会按墙钟时间启动 CLI，只会在下一次扩展激活时补唤醒。
