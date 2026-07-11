# Sinitek CLI VS Code 插件能力规格

- 状态：active
- 适用范围：当前仓库已实现能力
- 相关设计：`.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- 历史来源：原 `docs/插件功能清单.md`、`docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md`

## 1. 产品定位

插件的目标是在 VS Code 中提供统一的 AI 对话工作台，让用户在不离开编辑器的前提下，调用本机的 Codex、Claude、OpenCode CLI 完成对话、任务执行、配置管理与结果查看。Gemini 已从当前 AI 对话和配置中心支持范围移除。

## 2. 当前能力边界

### 已覆盖

- 内置聊天侧边栏与状态栏入口
- Codex / Claude / OpenCode 三个平台统一接入
- Codex / Claude 交互式续接会话
- 多标签会话并行管理
- Prompt 上下文增强、附件上传、任务流观察
- 插件侧长期记忆开关与本地记忆层
- 规则管理、模型管理、思考模式、配置中心
- Skills、MCP、备份、导出、日志和国际化

### 明确未覆盖

- 不提供远程服务端托管
- OpenCode 作为新增支持目标接入；官方 TUI commands 文档列出 `/compact`（alias `/summarize`），说明为 compact current session；官方配置文档还提供 `compaction.auto`（默认 `true`）、`compaction.prune` 和 `compaction.reserved`，并有 `OPENCODE_DISABLE_AUTOCOMPACT` 环境变量用于关闭自动上下文压缩。插件侧手动/自动压缩支持应优先复用当前会话运行链路，若 OpenCode 当前模式无法走交互 Runner，则只能通过官方 slash command / 后台 fallback 路径执行，不能宣称完全等同 Codex app-server 压缩语义
- Gemini 已移除，不再作为当前支持 CLI
- 不负责替代官方 CLI 本身的安装、鉴权和全部高级能力

## 3. 用户可见能力

### 3.1 对话入口与基础导航

用户可以通过以下方式进入插件：

- Activity Bar 侧边栏面板
- 状态栏入口
- 命令面板命令

当前命令包括：

- `sinitek-cli-tools.selectCli`
- `sinitek-cli-tools.runCli`
- `sinitek-cli-tools.runCliThinkingOn`
- `sinitek-cli-tools.runCliThinkingOff`
- `sinitek-cli-tools.openPanel`

### 3.2 多 CLI 统一接入

用户可以：

- 在面板内切换当前 CLI
- 为不同 CLI 配置不同命令与参数
- 在同一 UI 下查看统一格式的消息与 trace

### 3.3 执行模式

- Codex / Claude：支持交互式会话续接
- OpenCode：作为 Codex、Claude 之外的新支持目标，按插件通用 CLI 配置、统一 UI、会话存档、配置中心和模型/规则能力接入；当前 one-shot / 并行任务通过 `opencode run --auto [message..]` 启动。OpenCode 明确分成两个配置文件：模型/Provider 配置中心只维护 `~/.opencode/config.json`，全局 MCP 市场维护官方 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`，不再要求或生成 `~/.opencode/.env`；模型区仅显示主模型与小模型两个紧凑 select 和错误区域，候选只来自 active config 的 `provider.<id>.models` 且没有模型管理入口；下拉无可见 label、思考力度说明或“跟随配置”选项，正常 option 仅显示模型 `name`（缺失时回退 model id）；选择配置默认 ref 会清除角色临时覆盖，选择其他项使用 exact `provider/model` ref
- OpenCode 所有任务路径默认注入官方 `--auto`，自动批准仍处于 `ask` 的权限请求；默认 `external_directory: ask` 因而支持跨工作目录读写。插件不把 runtime permission 强制覆盖为 `allow`，用户配置、agent 配置及 OpenCode 默认规则中的显式 `deny` 仍优先，包括 `.env` 等受显式拒绝规则保护的文件。
- AI 对话面板支持 `coding / lobster` 两种顶层交互模式；旧配置中的 `plan` 会按 `coding` 兼容归一化
- OpenCode 对话面板同样提供 coding / Loop 两种模式。Loop 复用既有主任务、子任务、多轮复核、群聊和 active config effective primary 运行链路，每次主任务或子任务请求仍通过非交互式 one-shot `opencode run --auto` 执行。
- OpenCode 支持 Loop 编排不等于支持插件交互式 runner：`isInteractiveSupported(opencode)` 继续为 `false`，只表示不存在 Codex/Claude interactive runner 与 common command，不得再用该标记隐藏 OpenCode 的 Loop 模式入口，也不得为开放入口把它改成 `true`。
- Loop 主任务 Tab 的运行态跟随持久化任务生命周期：任务记录为 `running` 时，即使当前没有主任务、子任务、裁判主持人或参与者 AI/CLI 进程，主 Tab 仍显示运行态并保持不可关闭；任务进入 `completed`、`needs-review`、`error` 或 `stopped` 后解除。普通对话 Tab 与 Loop 子任务 Tab 仍按各自实际执行进程显示运行态。
- 支持停止当前任务、查看运行中 prompt、查看原始流式记录
- 工具设置中的全局项（debug、自动文件标签、所有 CLI 的最终答复判定策略、Loop 最大轮次、Loop 子任务自动关闭、语言、macOS task shell）保存在 `~/.sinitek_cli/settings.json`；最终答复判定使用 `finalAnswerPolicy`，支持 `strict_final_answer`（严格 final_answer，默认）和 `successful_reply_fallback`（成功回复兼容）两种值。读取上一版 `codexFinalAnswerPolicy=completed_turn_fallback` 时会自动迁移到兼容策略；项目级工具设置保存在 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`
- 工具设置提供工作区级“Harness 骨架”开关，控制当前工作区基于 harness scaffold 的插件侧本地记忆层，默认关闭。用户开启时，扩展先弹窗确认；确认后才补齐工作区 `.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 的模板追加、只引用 `AGENTS.md` 的 `CLAUDE.md`，并创建或补充根级 `.gitignore` 以忽略 `.codegraph/`，随后在终端启动 `codegraph install --target codex --location global && codegraph init`。骨架安装成功后会再弹窗询问是否由 AI 初始化 `ARCHITECTURE.md`；用户确认后，扩展把当前 AI 对话切到 coding 模式，并复用当前选择的 CLI 分组、配置和模型发起项目架构分析任务。关闭后不得创建、更新、召回或注入插件侧长期记忆，只允许查看、导出和删除已有记忆；该开关不控制 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、配置、压缩结果或账号侧能力。
- 工具设置提供项目级“执行后自动压缩上下文”开关（默认开启）；开启后，若当前任务目标为已有 Codex/Claude/OpenCode 会话，会在任务成功结束且执行超过 5 分钟后自动执行一次上下文压缩；任务中断、报错或执行不超过 5 分钟不触发自动压缩；自动压缩以静默后台任务执行，不追加普通任务完成耗时气泡、不覆盖刚完成任务的真实执行时间；手动压缩执行期间，聊天面板运行条会显示带动画的“压缩上下文中”状态。OpenCode 支持依据来自官方 TUI slash commands：`/compact` 会 compact current session，alias 为 `/summarize`，默认快捷键 `ctrl+x c`；官方配置还支持 `compaction.auto` 默认自动压缩、`compaction.prune`、`compaction.reserved` 与 `OPENCODE_DISABLE_AUTOCOMPACT`。插件侧 OpenCode 手动压缩应发送官方压缩命令或复用可用会话链路，自动 after-run 压缩沿用成功且超过 5 分钟的触发条件；若当前 OpenCode 非交互运行模式无法可靠附着既有会话，应明确作为 runtime fallback/受限路径处理并由 runtime/UI 子任务验证
- Codex / Claude / OpenCode 的普通任务 prompt 与 hidden retry prompt 都会追加统一最终回复约定：任务真正完成后，最终回复必须以 `[final_answer]` 开头，过程更新和非最终回复不得使用该标记；该内部约定不会改变 AI 对话中展示的原始用户问题。Loop 主任务/子任务等已有独立机器协议与结构化完成气泡的内部运行不会注入或要求该文本标记，避免破坏纯 JSON 决策解析。普通任务最终答复判定先接受 Codex 显式 `phase:"final_answer"` / `codexFinalAnswer=true`，没有结构化 final 类型时，再检查当前用户消息之后的非 thinking assistant 文本是否包含 `[final_answer]`。默认 `strict_final_answer` 只接受这两类显式信号；可选 `successful_reply_fallback` 还接受成功退出后的普通非空 assistant 答复，其中 Codex 在 `turn.completed status:"completed"` 且已有普通 assistant 文本时会把最后一条气泡原位提升为 `codexFinalAnswer=true`。thinking、trace、system、user、空回复、失败和中断不能通过文本标记或成功回复 fallback 收口。对非主动中断/异常，或 CLI 成功退出但本轮仍没有最终结论气泡的情况，会沿既有规则隐式发送“继续/continue”自动重试最多 5 次，间隔依次为 5 秒、15 秒、30 秒、2 分钟、5 分钟；不会展示隐式用户消息；每次失败进入下一次自动重试前会追加错误 trace 气泡和排队提示，真正开始重试时再追加开始提示并恢复标签运行态；达到上限后展示最近一次真实错误
- Codex 在工具设置中提供项目级“子智能体（multi_agent）”开关，默认关闭；关闭时扩展会显式禁用 Codex 官方 `multi_agent` 功能；开启时 Codex 可按自身运行时行为使用内置子智能体能力。该设置只影响 Codex。
- Webview 在渲染 assistant 气泡时会隐藏 `[final_answer]`，但不会改写内存或会话存档中的原始消息，确保严格判定和续接仍能读取协议标记；user、system 和 trace 消息不应用该展示过滤。

OpenCode 配置卡片默认进入可视化模式，以 Provider 列表和当前 Provider 的模型列表为核心，并保留 JSON 高级模式。可视化表单支持 Provider `id`、`name`、`npm`、`options.baseURL`、`options.apiKey`，以及模型 `id`、`name`、`reasoning`、主模型/小模型角色和逗号分隔的思考力度；API Key 使用密码输入。思考力度会 trim、过滤空项并稳定去重，首项写入 `options.reasoningEffort`，全部值生成对应简单 `variants`；清空时只移除编辑器管理的简单 reasoning 字段，未知顶层字段、MCP、permission、Provider/模型扩展字段、其他 options 和复杂 variants 原样保留。Provider/模型重命名会同步顶层 `model` / `small_model` exact ref；删除被引用项后会阻止保存；无效 JSON 不覆盖最后一次有效可视化状态；范例一键导入后立即加载到可视化编辑器。保存配置记录后，只有该档案当前处于激活状态时才应用到运行配置。
- Codex 交互式运行会优先直接启动已解析的 CLI，可显式固定 `CODEX_HOME` / 工作区 trust，并在回合完成时优先采用渐进式关闭，降低长任务被异常打断的概率
- Loop 模式会沿用当前 tab 的会话上下文，并按会话隔离写入任务记录：`~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json`（首次主任务尚未拿到真实会话 ID 时会暂存到 pending 路径，拿到真实会话 ID 后自动迁移到该会话文件）；主任务、子任务、轮次概要、预计剩余轮次和用户后续补充需求都写入该会话记录文件，同时在 `~/.sinitek_cli/lobster-communications/<taskId>/` 维护主子任务沟通文件；全局工具设置支持配置新建 Loop 任务最大主任务复核轮次（默认 20，范围 1-100，已有任务保持记录值），以及“子任务成功完成后自动关闭 AI 对话标签页”开关（默认开启），历史工作区字段仅作为兼容回退读取；Loop 主任务标签页会显示 `Loop` 前缀，且主任务或任一子任务仍在运行时禁止关闭主任务标签页；若在该主任务标签继续执行普通（非 Loop）任务，前缀会恢复为普通标签；点击不同类型会话标签会自动切换为 Loop/Vibe 模式，新建标签默认 Vibe 模式；主任务返回 JSON 决策并在每次复核中预判 `estimatedRemainingRounds` 剩余轮次，扩展兼容旧 `subtask` 字段，并优先解析 `subtasks` 批次；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，优先把能确认 `writeFiles` / `conflictGroup` 互不重叠的子任务放入同一批次，同一轮最多 6 个；扩展会按声明的写入文件/冲突组自动规划组内并发、组间串行；扩展为批次内每个子任务创建独立新会话，单子任务仍自动切换到子任务标签展示气泡和流式消息，多子任务批次会创建多个子任务标签并并发运行；每次 `status=continue` 的主任务 JSON 协议气泡会原位替换为 Markdown 子任务派发摘要，并同步追加到 `main-task.md`；只有批次内所有子任务都正常完成后才切回主任务并自动唤醒主任务审核验收，不满足则继续启动下一批子任务，验收通过才结束；主任务 AI 调用若连续失败 5 次，会把任务记录更新为 `needs-review`，停止自动派发和自动恢复，避免在失败状态下重复复用旧主任务决策或继续加派子任务；轮次按主任务复核轮计数，同一轮可包含一个或多个并发子任务；第 1 轮先做总体阶段规划，再优先派发首批互不冲突子任务，不再默认只派发 1 个；Codex / OpenCode 在 Loop 模式下底部模型选择拆分为“主任务模型 / 子任务模型”，并在“管理模型”中为每个模型提供“主任务 / 子任务”可用角色开关（至少保留一个角色）；Claude 分组不展示插件侧模型选择或模型管理入口，沿用 CLI 默认模型或用户手动配置的命令参数；最终完成时主任务必须返回 `answerConclusion`（直接回答用户原始问题）、整体总结、各轮子任务摘要和用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md` 和任务记录，并移除最终主任务 JSON 协议气泡，在 AI 对话主消息流中先追加 `lobsterAnswerConclusion=true` 的 assistant Markdown 问题回答结论气泡，再追加 `lobsterFinalSummary=true` 的 assistant Markdown 最终总结气泡；最终总结气泡会继续展示问题回答结论、子任务摘要、验收结果、需求覆盖和整体任务总结；只有主任务显式返回 `status=completed` 且主任务对话已同时存在 `lobsterAnswerConclusion=true` 问题回答结论气泡和包含“问题回答结论”“整体任务总结”小节的 `lobsterFinalSummary=true` 最终总结气泡才视为真正结束，如果任务记录已完成但这些气泡缺失或最终总结仍为旧格式，扩展会自动按“继续”恢复同一任务并再次唤醒主任务；主任务中断后可在同一标签输入“继续/continue/resume”等短提示词恢复同一任务并从当前轮次继续，也可在 Loop 群聊面板点击“继续执行”后先确认或编辑默认“继续”消息，再复用同一任务 ID 唤醒主任务/主持人判断下一步；若主任务已经触发上述连续失败上限，则群聊“继续执行”和子任务手动补跑后的自动唤醒都不会再自动恢复主任务，只能保留人工复核信号；若用户在群聊面板点击“我要说话”，扩展会先把消息写入任务记录、主任务沟通文件和群聊 transcript，供下一轮主任务/主持人在恢复时读取并调整安排；子任务结束前必须写清沟通文件，供主任务唤醒后读取；子任务出错会间隔 1 分钟自动重试最多 5 次；子任务中断后在子任务标签手动继续时会强制按内部 coding（即 Vibe）任务执行，不允许再次启动 Loop 任务；消息气泡会标记“Loop / 子任务”
- AI 对话面板中的 Loop 主任务 tab 在主任务或同一 Loop 任务任一子任务仍在运行时强制跟随最新消息；如果用户手动滚离底部，仍会在消息区显示置底按钮，点击后回到最新消息。普通 Vibe 任务和 Loop 子任务 tab 保持原有按用户滚动位置决定是否自动置底的策略。
- Loop 任务启动和恢复气泡会显示“打开 Loop 群聊”入口，命令 `sinitek-cli-tools.openLobsterDebateChat` 保持兼容但打开的是通用 Loop 群聊内容区面板；不同 `taskId` 的 Loop 群聊页面可同时打开并保留，同一 `taskId` 重复打开时复用并刷新该任务已有页面。`main_sub_multi_agent` 会在 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，群成员列表统一显示“成员”，包含“主任务”和动态加入的“子任务 1~N”；主任务决策、子任务加入、子任务完成和批次完成都会追加到 transcript，其中子任务成功完成的发言气泡展示该子任务最终回复，运行状态和验证依据仍写入任务记录与子任务沟通文件。`debate_multi_agent` 使用同一个任务页面把红蓝对抗 `debates/round-*/chat.md` 与共识通过后的根部 `group-chat.md` 合并为单条时间线；主任务轮次、发言批次和执行阶段只作为系统消息显示，不提供轮次切换或按轮次分区。该面板支持当前发言者/执行者“思考中”等待气泡、状态落盘后主动刷新、5 秒兜底自动刷新、50px 距底阈值自动跟随与置底按钮、手动刷新；同一 Loop 任务只要仍存在运行进程就始终显示“我要说话”按钮并允许发言，即使持久化状态短暂落成 completed 或已触发主任务 AI 连续失败上限；无运行进程时，未完成且未触发主任务 AI 连续失败上限的任务也会显示“我要说话”按钮，把消息持久化到当前任务供下一轮读取，并在提交刷新后以右侧“我”对话气泡展示；当任务当前无运行进程且仍可继续时，面板额外显示“继续执行”按钮，先弹出可编辑确认框并在确认后把消息作为“本次继续指令”传给主任务/裁判主持人；同一 Loop 任务存在运行进程时则显示“中止”按钮，点击后停止该 `lobsterTaskId` 关联的主任务、子任务和辩论/共识相关运行并把任务标记为 stopped；“我要说话”“继续执行”和“中止”按运行态约束显示，不再在面板顶部提供“打开 transcript”或“打开任务记录”按钮。

- Loop 模式的执行方式属于 `lobster` 内部设置，不新增顶层 `InteractiveMode`。Webview 在 Loop 模式下展示“Loop 执行方式”下拉，包含 `main_sub_multi_agent`（主从多智能体）和 `debate_multi_agent`（红蓝辩论多智能体）；默认值为 `main_sub_multi_agent`，老任务记录缺少 `executionMode` 时也按该值处理。新建任务会把 `executionMode` 固化到 `LobsterTaskRecord`，恢复任务时以记录为准，执行中切换下拉只影响新任务。该下拉独立于插件侧模型选择能力，Claude 下仍可见；主/子任务模型选择仍只在 Codex / OpenCode 等支持插件侧模型选择的 CLI 下显示。
- `debate_multi_agent` 只替代 Loop 主任务初始规划阶段；首轮红蓝规划共识形成后，后续实现、复核和继续派发由裁判主持人作为主智能体走主从多智能体链路，子任务派发、批次并发、冲突分组、子任务重试、子任务沟通文件、最终总结气泡和 30 天保留清理继续复用现有链路。该模式已升级为红蓝对抗：当任务尚无可复用红蓝规划共识时，先由裁判主持人根据任务目标设计 2-6 个红蓝参与者并写入 `moderator-participants.md`，新清单中 `role` 只能使用 `blue_team` 或 `red_team`，且必须至少包含 1 个蓝队和 1 个红队；主持人还要在清单中指定首批 `openingSpeakerIds`，通常由蓝队先开场。蓝队负责提出、捍卫和修正方案，补足约束、验收口径和证据要求；红队负责攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性。只有任务涉及代码、文件、权限、部署或流程执行时，红队才额外检查写入范围、并发冲突、越权修改、回滚/恢复失败和工程验收风险。扩展校验后把这些成员作为 `## 参与者加入：...` 追加到共享 `chat.md`；参与者只读可用上下文、仓库、任务记录和沟通文件，只写本次提示词指定的 artifact。每个发言批次开始时扩展向 `chat.md` 追加系统消息说明主任务轮次、当前发言批次、最大安全发言批次数和本批次被主持人点名的发言者；只有被主持人显式点名的 1-3 位参与者会进入该批次，并可在批次内并行写入各自的 `participants/<participantId>-turn-<n>.md`。扩展等待本批次全部 artifact 完成后再按点名顺序以 `## 发言：...` 追加到 `chat.md`，随后裁判主持人写 `participants/moderator-turn-<n>.md`，以 `continue / finalize / block` 判断红队攻击是否已被蓝队化解、是否追加下一个发言批次、收集最终立场或进入人工复核；当 `action=continue` 时，主持人必须同时给出下一批 `nextSpeakerIds`。参与者和裁判主持人的临时对话 tab 回答完成后可按“Loop 子任务自动关标签”设置关闭，下一批次同一角色通过 `debateRounds` 记录的 sessionId 新建临时 tab 续接。最大发言批次数只是防无限循环的安全上限，达到上限后运行时强制收束。红蓝对抗产物写入 `~/.sinitek_cli/lobster-communications/<taskId>/debates/round-<n>/`，新任务通常只生成 `round-1`，历史任务或恢复补跑按实际 Loop 轮次记录；产物包括 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/*-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/*.md`、`cross-review.md`、`consensus.md` 和 `decision.json`；共识通过后的执行群聊写入 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md`。任务记录中的 `debateRounds` 保存红蓝对抗状态、`chatFile`、`participantRosterFile`、`participantRosterSessionId`、当前 `activeSpeaker`、参与者状态、参与者 sessionId、裁判主持人决策、裁判主持人 sessionId 和共识摘要。辩论任务启动气泡同样显示“打开 Loop 群聊”入口；通用群聊面板把 `chat.md`、`debateRounds` 和 `group-chat.md` 合并为一个按消息追加顺序展示的时间线，按角色气泡展示参与者加入、参与者发言、裁判主持人控场、最终立场、主任务决策、子任务动态加入、子任务完成、批次事件、收束状态与 sessionId；当前裁判主持人/参与者/共识汇总器/主任务/子任务运行时会在时间线末尾显示“思考中”等待气泡；角色发言或状态落盘后会主动刷新已打开页面，5 秒自动刷新仅作为兜底；若刷新前滚动位置距离底部不超过 50px 会自动跟随最新消息，否则保留阅读位置并显示置底按钮；页面继续提供手动刷新；当任务尚未完成且未触发主任务 AI 连续失败上限时，页面都支持“补充需求”把新要求持久化到任务记录和主沟通文件，供后续主持人主智能体读取。
- `debate_multi_agent` 规划共识通过后会解析 `decision.json` 为现有 `LobsterMainDecision`，并复用 `applyLobsterMainDecision` 进入原有 `completed / continue / blocked` 处理。恢复任务或进入后续轮次时，如果任务记录中已存在可继续的红蓝规划共识和合法 `decision.json`，扩展会跳过新的红蓝辩论，改由主持人主智能体读取首轮红蓝规划产物、主从执行群聊和子任务沟通文件后继续复核；只有缺少可复用规划共识、旧产物缺少裁判主持人控场、`chat.md`、参与者加入事件、收束标记、产物缺失或不可解析时，才补跑规划辩论。裁判主持人红蓝参与者清单缺失或非法、群聊发言 artifact 缺失、裁判主持人 artifact 缺失或不可解析、最终参与者 artifact 缺失或立场不可解析、裁判主持人输出 `block`、共识后的最终参与者立场仍为 `block`、存在未解决 `blocking` disagreement、缺少 `cross-review.md`、`consensus.md` 不含合法共识 JSON、`decision.json` 非法、或 `status=continue` 但没有可派发 `subtasks` 时，不派发子任务，任务进入 `needs-review` 并在主任务沟通文件和主 tab 系统消息中记录原因。若红队或蓝队参与者原始 `block` 可通过裁判主持人追问、蓝队修正、前置子任务、验收标准或风险说明解决，共识汇总器应将其写入 `resolvedDisagreements`，并可把最终立场降为 `agree_with_reservations` 后继续。内容区群聊页面只读，不直接写任务记录或追加辩论消息；真实 VS Code 面板端到端手工验收仍应以单独验收记录为准。

### 3.4 会话与并发

- 会话列表与当前会话切换
- 历史会话列表会显示该会话是否已在 AI 对话 tabs 中打开，并移除“复制 ID”按钮
- 历史记录弹窗支持查看单个历史会话的已保存消息，并可将该会话消息导出为 TXT；历史记录中的操作按钮允许换行展示，避免挤压列表宽度
- 历史记录弹窗提供“Loop 群聊” tab，按更新时间列出保留期内的 Loop 任务摘要；点击“加载”只按 `taskId` 重新打开 Loop 群聊 UI，不改变普通会话绑定，也不会自动继续任务
- 从历史加载未打开的会话时会新建 tab 承载该会话；若该会话已在 tabs 中打开，则直接切换到已有 tab
- OpenCode 首次执行会从 JSONL `sessionID` 接管真实 `ses_*`，同一 tab 后续执行使用该真实 ID续接；插件内部 `local_*` 占位 ID不会作为 `--session` 传入 CLI。修复前留下的 `local_*` tab 会在下一次执行创建新底层会话，并在捕获真实 ID后迁移已有插件消息历史。
- 多个 conversation tab（超过 5 个时启用左右翻页按钮，每页最多显示 5 个）
- 即使只有 1 个 conversation tab 也展示顶部标签；运行中 tab 使用主题 focus 色蓝色虚线流水边框，异常终止或进入自动重试等待期的 tab 显示错误红框，手动停止不标红，后续恢复输出或成功结束会恢复正常样式
- 单个 tab 切换 CLI 分组或切换历史会话时，不应中断其他 tab 中正在执行的任务
- 历史会话删除、清空、重置当前 Tab；其中“重置当前 Tab”会关闭当前 tab 并新建一个空白 tab，不会复用原 tab 清空后继续写入，因此旧会话历史仍可从会话列表恢复
- 对话运行状态区的“提示词”按钮会展示当前会话内全部用户输入，并按输入时间倒序排列，最新提示词置顶
- Prompt 历史记录
- 历史提示词、历史会话与任务运行痕迹默认仅保留最近 30 天（约 1 个月）
- 长期记忆不套用普通历史 30 天清理；关闭长期记忆也不自动删除已有记忆，用户需要通过查看/导出/删除入口显式处理
- 任务队列与并发标签页状态区分
- 队列中的提示词仅在上一个任务成功结束后才会继续执行；如果任务失败或被停止，剩余提示词继续保留在队列中
- 队列弹窗支持手动“继续执行队列”，用于在失败/停止后恢复后续提示词执行
- Loop 主任务记录仍为 `running` 时，该主任务 tab 中提交的新提示词直接进入当前 tab 队列，不允许绕过生命周期运行态启动新任务；阶段性 AI/CLI 进程结束不会提前出队，只有 Loop 任务变为 `completed` 才自动继续队列，`needs-review`、`error` 或 `stopped` 时继续保留

### 3.5 Prompt 输入增强

- `@` 路径插入
- 读取当前文件 / 当前选区作为上下文标签（可在工具设置开启，默认关闭）
- 附件上传
- 工作区路径选择器
- 常用命令，例如压缩上下文
- 长期记忆启用时，插件可在发送 prompt 前按相关性召回当前工作区 `.ch/docs/memory/` 与 `.ch/docs/runbooks/PITFALLS.md` 中的插件侧本地记忆，并作为明确边界的参考块注入；关闭时不召回、不注入，也不更新 generated recall 产物或记忆摘要。

### 3.5.1 插件侧长期记忆

- 记忆数据属于插件本地状态，目标目录为当前工作区 harness scaffold：热区位于 `.ch/docs/memory/`，generated recall 位于 `.ch/docs/generated/memory-index/`，踩坑记录位于 `.ch/docs/runbooks/PITFALLS.md`；与 30 天会话历史、prompt history、Loop 任务记录和外部 CLI 配置解耦。
- 插件侧长期记忆热区文件包括 `ROLLING_SUMMARY.md`、`EVENT_MEMORY.md`、`PROJECT_CONTEXT.md`、`USER_PREFERENCES.md`、`PENDING_ITEMS.md`、`ACTIVE_RISKS.md`、`LESSONS_LEARNED.md`；`PITFALLS.md` 单独归入 runbook 体系，用于记录仍有复发风险或长期规避价值的真实踩坑，条目结构覆盖现象、触发条件、根因、长期规避、验证方式和关联资料。
- 开关默认关闭，只在工具设置的“工作区”页签配置并写入 workspace settings；解析配置时采用“显式 false 防误开优先”，兼容旧 `memoryEnabled`、`globalMemoryEnabled`、`workspaceMemoryEnabled` 字段。只有显式开启并确认初始化后，才会安装 scaffold 与触发 CodeGraph 设置。
- 关闭状态下只允许查看、导出和删除已有记忆；不得新建、编辑、自动提取、召回、注入或更新 memory 目录元数据。
- 自动提取受二级开关控制：`memoryAutoExtractAfterCompact` 仅控制 compact 后提取，`memoryAutoExtractAfterLobsterTask` 仅控制 Loop 任务总结后提取；二者默认关闭，且必须在总开关和对应作用域开启时才允许写入或更新。
- 任务总结或失败回复中出现明确 `pitfall / gotcha / 踩坑 / 报错 / 失败 / 阻塞 / 回滚` 等信号，并伴随根因、规避或验证线索时，插件可自动写入 `.ch/docs/runbooks/PITFALLS.md` 并刷新 generated recall；普通成功总结仍只写入摘要/事件层，避免把所有错误都固化成长期坑点。
- 该能力只控制插件侧长期记忆，不控制 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、配置或压缩能力。

### 3.6 输出渲染与任务观测

- Markdown 消息展示
- 最终成功回复使用强调卡片样式，Markdown 外层带主题强调边框
- trace 分段展示
- thinking 与 tool-use 事件区分渲染
- Codex app-server 的 reasoning/thinking 摘要会精准移除独占一行的空 HTML 注释 `<!-- -->` 及其水平空白变体；不会改写普通 assistant/user 消息、行内空注释或非空 HTML 注释。历史 Codex thinking 消息在加载时使用同一规则清洗并回写会话存档。
- 任务列表提取与展示；Claude 交互式运行除兼容 `TodoWrite` 外，也会根据 `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` / `TaskStop` 工具事件实时刷新任务列表
- 原始流消息导出；历史会话消息可按 TXT 日志导出
- 错误详情查看 / 复制

### 3.7 模型、思考模式与规则

- 模型列表与当前选择按当前配置档案 id 维护，插件侧持久化到 `~/.sinitek_cli/models.json`
- Claude 分组不展示插件侧模型选择或模型管理入口，执行时不会注入 webview 侧选择值；如需固定模型，需由用户自行在 Claude 命令参数中配置
- 打开“管理模型”时，如果前端看到空列表但磁盘或运行态仍有模型数据，扩展会弹出可复制的诊断详情，包含配置 id、存储路径、模型计数和最近读取/配置加载错误
- thinking mode 按 CLI 记忆；Codex 和 Claude 固定选项包含 `low`、`medium`、`high`、`xhigh`、`max`，中文 UI 中 `max` 显示为“最高”
- Global / Project 规则读写
- 规则目标覆盖 Codex / Claude / OpenCode

### 3.8 配置中心

配置中心支持：

- 配置档案列表、排序、激活、删除、初始化
- 从对话面板的配置按钮打开配置中心时，若当前视口处于小于等于 `920px` 的窄宽度模式，左侧配置目录首次默认展开；展开后仍可通过关闭按钮、遮罩或 `Esc` 收起
- 当前配置查看与应用
- 配置内容按卡片独立保存，不提供顶部统一保存；Claude 的 `settings.json`、OpenCode 的 `config.json`、Codex 的 `config.toml` / `.env` / `auth.json` 都在对应卡片右上角保存，只更新该卡片对应字段；若保存的是当前激活配置，会同步把必要的完整 payload 应用到外部 CLI 配置文件。Gemini 配置卡片已移出当前支持范围。
- Codex 配置卡片管理用户级 `~/.codex/config.toml` 与 `~/.codex/.env`。`config.toml` 是 Codex 主配置文件，必须按 TOML 解析与保存，不得按 JSON 处理；卡片支持常用字段可视化编辑，也支持 TOML 源码编辑。`.env` 作为独立环境变量文件展示和保存，用于 Codex 相关密钥或环境覆盖，不与主 TOML 合并成同一个 JSON 文档。
- Claude 配置卡片默认提供可视化编辑器，并可切换高级 JSON 模式；页面视觉样式、卡片背景和表单密度与 OpenCode 配置卡片对齐。可视化模式覆盖 Claude Code 官方 `~/.claude/settings.json` 的常用核心字段：`model`、`fallbackModel`、`availableModels`、`effortLevel`、`language`、`outputStyle`、`autoUpdatesChannel`、`cleanupPeriodDays`、`alwaysThinkingEnabled`、`includeCoAuthoredBy`、`permissions.defaultMode/allow/ask/deny`，以及 `env` 中的 `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`。第三方网关或云平台可独立配置 `ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL` 三档默认模型名称。可视化序列化基于原始 JSON 定向合并，保留未展示字段、额外环境变量、hooks、权限扩展和企业策略；无效 JSON 不覆盖最后一次有效可视化状态。
- Claude、OpenCode、Codex 三组配置卡片的可视化参数 label 右侧都应提供问号提示；鼠标 hover 展示该参数用途、写入位置和注意事项，枚举型参数必须在提示中列出可选值。三组“查看范例”入口统一放在配置文件名右侧，视觉位置和交互风格对齐 OpenCode，避免 Claude / Codex 与 OpenCode 出现不同布局。
- OpenCode 配置页为模型/Provider 单文件保存，只维护 `~/.opencode/config.json`；OpenCode 全局 MCP 另由 MCP 市场维护官方 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`。配置中心不展示或生成 `~/.opencode/.env`，避免把环境变量档案误解为 OpenCode 第二配置文件。配置卡片示例是可解析的 `myAPI` 双模型严格 JSON，包含 `$schema`、顶层 `model` / `small_model`、两个 `provider.myAPI.models` 定义、主模型 `options+variants`、小模型固定 `options` 与可选 `variants`，不再内嵌 MCP 示例；`baseURL` 与 `apiKey` 使用官方 `{env:VARIABLE_NAME}` 语法。页面同时说明 `npm` 按 API 协议选择：直连内置 Anthropic / Google / OpenAI provider 通常无需自定义 `npm`；手写自定义直连 provider 时分别使用 `@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai`；实际 OpenAI-compatible 网关才使用 `@ai-sdk/openai-compatible`，不能根据 Claude、Gemini、DeepSeek 等模型名称或推理档位自动换包。兼容网关缺少 `options.baseURL` 会在保存/运行前阻断
- 配置中心不再自动或手动把 Claude / Codex 配置转换为 OpenCode 配置；OpenCode 配置列表只展示原生 OpenCode 档案。历史自动迁移档案不会被删除，但会从新的 OpenCode 配置列表中隐藏，避免继续刷新或复用旧转换项
- 备份与导出
- 技能管理
  - 官方 Claude / Codex / OpenCode skills 列表内置仓库快照；具体条目数量以当前 catalog 为准
  - 官方 catalog 为每个条目记录 `version`、`versionSource`、`contentHash`、`sourceCommit`
  - 配置页官方条目会显示“当前版本 / 最新版本”；未安装时显示最新版本，已安装时同时显示当前版本和最新版本
  - 官方最新判断优先基于每个条目的 `contentHash`，缺失时才回退到 `sourceRef`
  - OpenCode 条目的版本展示以当前官方 catalog 元数据为准；Claude / Codex / OpenCode 在上游缺少显式版本号时显示稳定短 `contentHash`
  - 历史 Gemini catalog 条目仅作迁移参考，不再作为当前配置页官方 Skills 支持口径
- MCP 市场、安装、卸载、健康检查

### 3.9 稳定性与可运维性

- 中英文国际化
- debug 日志开关
- 会话与模型等本地状态持久化
- 模型状态读取失败时保留当前内存状态，避免一次临时读失败把面板模型列表刷新为空
- 日志保留与临时文件清理
- 插件管理的历史痕迹（logs / prompt history / session history / task runs / lobster task records / lobster communications）默认仅保留最近 30 天（约 1 个月）
- Webview 渲染失败时的回退页
- 配置中心空白页排查优先看本插件 Webview 前端渲染异常、配置 JSON/TOML 解析异常和配置卡片初始化数据；用户控制台中的 `AugmentExtensionSidecar` 对 `https://d17.api.augmentcode.com/*` 返回 403 是 Augment 扩展侧请求失败，通常不应直接归因于本插件配置页空白，除非同时发现本插件自身日志或 Webview 错误链路指向它。

## 4. 本地数据与配置范围

### 插件自身数据

保存在：

```text
~/.sinitek_cli/
```

### 外部 CLI 配置

配置中心会读写：

- `~/.claude/*`
- `~/.codex/config.toml`：Codex 主配置，格式为 TOML，支持可视化编辑与 TOML 源码编辑
- `~/.codex/.env`：Codex 环境变量文件，按 `.env` 文本独立管理
- `~/.codex/auth.json`：Codex 鉴权文件，仅按既有受控入口处理，不作为主配置格式
- `~/.opencode/config.json`：OpenCode 模型/Provider 配置中心
- `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json`：OpenCode 官方全局 MCP 配置，插件只维护顶层 `mcp`
- OpenCode 配置中心不再读写 `~/.opencode/.env`；历史多文件配置只作为迁移参考
- 旧 `~/.gemini/*` 仅作历史迁移参考；当前配置中心不再作为 Gemini 配置管理入口

这些内容属于本机 CLI 生态的一部分，不属于仓库内代码产物。

## 4.6 OpenCode 动态 variant 能力

- OpenCode 主模型未选档位时使用自身 `options`，可切换思考力度由该精确主模型的 variants 决定，面板通过可序列化 `openCodeThinking` 状态动态渲染任意 variant 名称，并始终提供 Default / Follow OpenCode。
- 能力解析以 `opencode models <provider> --verbose` 的精确模型 metadata 为首选，当前激活配置的显式 `provider.<id>.models.<model>.variants` 为回退；两者都没有时为 Default-only。禁止使用 provider `npm`、provider 名或模型名推断档位。
- 主模型由 `--model provider/model` 选择，variant 由 `--variant` 选择；CLI 没有 `--small-model`，小模型临时选择通过 runtime config overlay 覆盖顶层 `small_model`。小模型内部请求会跳过 variants，实际只使用其自身 `options`；只有该模型被当作主模型运行时，其 variants 才生效。
- 普通对话、并行任务、Loop 主任务、Loop 子任务、续跑和唤醒统一使用下拉选择的 effective primary；OpenCode 不使用 Codex 专用的 Loop 主/子任务模型分配，`small_model` 仅供 OpenCode 内部轻量请求，不等同于 Loop 子任务模型。
- primary/small 覆盖按 active config id 隔离，空值跟随顶层配置；配置切换或候选变化会清理失效覆盖，OpenCode 不读取通用 selected/options 或 Loop main/subtask 选择。
- runtime overlay 同时固定 effective `model` / `small_model`，通过随机 `OPENCODE_CONFIG` 文件注入，目录/文件权限为 `0700`/`0600`，exit/error/timeout/cancel 后清理且不改写用户配置。
- 运行前校验 effective primary、effective small 和 overlay 后配置；角色不在 active config 候选、provider/model 被过滤或 primary 缺失时阻止启动。
- active config id、配置内容 hash、OpenCode 命令/version、provider/model 共同隔离能力缓存和选择状态；解析失败保守回退，旧请求不会覆盖后续配置或模型。
- variant 选择按 active config id + 精确 `provider/model` 保存；空值删除选择，失效值自动清理。运行时仅传递当前 options 内的非空值，并尊重用户显式 `--variant` 参数。
- `--variant` 负责推理力度，`--thinking` 只负责 thinking blocks 展示。固定 OpenCode ThinkingMode 和 `thinkingArgs.opencode.*` 已退出运行链路，Codex / Claude 行为不变。

## 4.7 OpenCode 全局 MCP 管理

- MCP 市场可为 OpenCode 安装、覆盖和卸载 local 与 remote 全局 MCP。
- 插件直接管理 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`：local 写入 `type=local`、命令数组、`environment` 和 `enabled`；remote 写入 `type=remote`、URL、`headers` 和 `enabled`。
- 安装只合并目标 `mcp[id]`，保留其他顶层配置和已有 MCP；卸载只删除目标键且支持幂等调用，不执行 OpenCode 不支持的 `mcp remove`。
- 配置读取支持 JSON/JSONC；无效配置不会被覆盖，成功修改后通过同目录临时文件原子替换。
- MCP 市场打开时只做快速安装状态判断，不做健康探测：Claude 读取 `~/.claude.json` 的 `mcp` / `mcpServers` / `mcp_servers`，Codex 读取 `~/.codex/config.toml` 的 `[mcp_servers.<id>]`，OpenCode 读取 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`。健康状态只由“一键检测健康”按钮触发；OpenCode 健康检测仍可用 `opencode mcp list --pure` 映射连接状态，已列出但连接失败的条目显示为已安装且 `unhealthy`，未配置的市场条目显示未安装。
- 内置 `media/mcp_marketplace.json` 已刷新为 16 个官方或权威 MCP 候选：GitHub、Microsoft Learn、Playwright、Docker MCP Gateway、Cloudflare Docs/Browser、Stripe、Sentry、MongoDB、Grafana、Elasticsearch、Slack、Notion、Linear、Brave Search、Atlassian。所有 description 保持中文，凭据只使用环境变量占位；涉及支付、生产错误、数据库、协作写入或浏览器自动化的条目在描述中提示 OAuth、只读、最小权限或人工确认。
- `npm run validate:mcp-marketplace` 读取真实市场 JSON 并校验顶层数组、唯一 id、必填字段、中文 description、官方/权威 homepage、local/remote config、env/headers 类型、占位密钥，以及禁止旧 `github.com/modelcontextprotocol/servers/tree/main/src/` 和旧 `@modelcontextprotocol/server-*` 来源回流。

## 5. 验收视角

当前版本至少应满足：

- 用户能在 VS Code 内完成多 CLI 切换与对话
- 会话、历史、模型和规则在重开面板后仍可恢复
- 配置中心能对本地配置、Skills、MCP 做最小可用管理
- 出现异常时，用户可以看到足够的错误提示和排障入口

## 6. 后续维护规则

只要用户可感知能力发生变化，就应同时更新：

- 本文档
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 必要的运行手册或设计文档
