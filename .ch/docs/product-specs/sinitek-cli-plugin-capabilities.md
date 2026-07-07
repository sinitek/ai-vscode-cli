# Sinitek CLI VS Code 插件能力规格

- 状态：active
- 适用范围：当前仓库已实现能力
- 相关设计：`.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- 历史来源：原 `docs/插件功能清单.md`、`docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md`

## 1. 产品定位

插件的目标是在 VS Code 中提供统一的 AI 对话工作台，让用户在不离开编辑器的前提下，调用本机的 Codex、Claude、Gemini CLI 完成对话、任务执行、配置管理与结果查看。

## 2. 当前能力边界

### 已覆盖

- 内置聊天侧边栏与状态栏入口
- Codex / Claude / Gemini 三个平台统一接入
- Codex / Claude 交互式续接会话
- 多标签会话并行管理
- Prompt 上下文增强、附件上传、任务流观察
- 插件侧长期记忆开关与本地记忆层
- 规则管理、模型管理、思考模式、配置中心
- Skills、MCP、备份、导出、日志和国际化

### 明确未覆盖

- 不提供远程服务端托管
- Gemini 暂未接入交互 Runner
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
- Gemini：支持一次性 headless 执行和流式展示；默认参数推荐 `--approval-mode auto_edit`，并自动补齐 Gemini CLI `-p` 与 `--output-format stream-json` 解析结构化事件；thinking 通过临时 system settings 覆盖层 + `-m/--model` alias 选择注入，不再运行时改写工作区 `.gemini/settings.json`
- AI 对话面板支持 `coding / lobster` 两种顶层交互模式；旧配置中的 `plan` 会按 `coding` 兼容归一化
- 支持停止当前任务、查看运行中 prompt、查看原始流式记录
- 工具设置中的全局项（debug、自动文件标签、Loop 最大轮次、Loop 子任务自动关闭、语言、macOS task shell）保存在 `~/.sinitek_cli/settings.json`；项目级工具设置保存在 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`
- 工具设置提供工作区级“Harness 骨架”开关，控制当前工作区基于 harness scaffold 的插件侧本地记忆层，默认关闭。用户开启时，扩展先弹窗确认；确认后才补齐工作区 `.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 的模板追加、只引用 `AGENTS.md` 的 `CLAUDE.md`，并创建或补充根级 `.gitignore` 以忽略 `.codegraph/`，随后在终端启动 `codegraph install --target codex --location global && codegraph init`。骨架安装成功后会再弹窗询问是否由 AI 初始化 `ARCHITECTURE.md`；用户确认后，扩展把当前 AI 对话切到 coding 模式，并复用当前选择的 CLI 分组、配置和模型发起项目架构分析任务。关闭后不得创建、更新、召回或注入插件侧长期记忆，只允许查看、导出和删除已有记忆；该开关不控制 Codex / Claude / Gemini 外部 CLI 自带记忆、历史、配置、压缩结果或账号侧能力。
- 工具设置提供项目级“执行后自动压缩上下文”开关（默认开启）；开启后，若当前任务目标为已有 Codex/Claude/Gemini 会话，会在任务成功结束且执行超过 5 分钟后自动执行一次上下文压缩；任务中断、报错或执行不超过 5 分钟不触发自动压缩；手动或自动压缩执行期间，聊天面板运行条会显示带动画的“压缩上下文中”状态
- 对非主动中断/异常，或 CLI 成功退出但本轮没有产生普通 assistant 最终结论气泡的情况，会隐式发送“继续/continue”自动重试最多 5 次，间隔依次为 5 秒、15 秒、30 秒、2 分钟、5 分钟；Codex 交互任务必须看到 `phase:"final_answer"`/`codexFinalAnswer=true` 才视为本轮最终结论，`phase:"commentary"` 只作为过程消息；不会展示这条隐式用户消息；每次失败进入下一次自动重试前会追加错误 trace 气泡展示本次失败信息，并追加系统提示说明当前是第几次自动重试；等待结束真正开始执行该次自动重试时，会再追加“第 X/Y 次自动重试已开始”提示并把标签页恢复到运行态；达到上限后会展示最近一次真实错误，避免只剩泛化提示
- Codex 在工具设置中提供项目级“子智能体（multi_agent）”开关，默认关闭；关闭时扩展会显式禁用 Codex 官方 `multi_agent` 功能；开启时 Codex 可按自身运行时行为使用内置子智能体能力。该设置只影响 Codex。
- Codex 交互式运行会优先直接启动已解析的 CLI，可显式固定 `CODEX_HOME` / 工作区 trust，并在回合完成时优先采用渐进式关闭，降低长任务被异常打断的概率
- Loop 模式会沿用当前 tab 的会话上下文，并按会话隔离写入任务记录：`~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json`（首次主任务尚未拿到真实会话 ID 时会暂存到 pending 路径，拿到真实会话 ID 后自动迁移到该会话文件）；主任务、子任务、轮次概要、预计剩余轮次和用户后续补充需求都写入该会话记录文件，同时在 `~/.sinitek_cli/lobster-communications/<taskId>/` 维护主子任务沟通文件；全局工具设置支持配置新建 Loop 任务最大主任务复核轮次（默认 20，范围 1-100，已有任务保持记录值），以及“子任务成功完成后自动关闭 AI 对话标签页”开关（默认开启），历史工作区字段仅作为兼容回退读取；Loop 主任务标签页会显示 `Loop` 前缀，且主任务或任一子任务仍在运行时禁止关闭主任务标签页；若在该主任务标签继续执行普通（非 Loop）任务，前缀会恢复为普通标签；点击不同类型会话标签会自动切换为 Loop/Vibe 模式，新建标签默认 Vibe 模式；主任务返回 JSON 决策并在每次复核中预判 `estimatedRemainingRounds` 剩余轮次，扩展兼容旧 `subtask` 字段，并优先解析 `subtasks` 批次；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，优先把能确认 `writeFiles` / `conflictGroup` 互不重叠的子任务放入同一批次，同一轮最多 6 个；扩展会按声明的写入文件/冲突组自动规划组内并发、组间串行；扩展为批次内每个子任务创建独立新会话，单子任务仍自动切换到子任务标签展示气泡和流式消息，多子任务批次会创建多个子任务标签并并发运行；每次 `status=continue` 的主任务 JSON 协议气泡会原位替换为 Markdown 子任务派发摘要，并同步追加到 `main-task.md`；只有批次内所有子任务都正常完成后才切回主任务并自动唤醒主任务审核验收，不满足则继续启动下一批子任务，验收通过才结束；主任务 AI 调用若连续失败 5 次，会把任务记录更新为 `needs-review`，停止自动派发和自动恢复，避免在失败状态下重复复用旧主任务决策或继续加派子任务；轮次按主任务复核轮计数，同一轮可包含一个或多个并发子任务；第 1 轮先做总体阶段规划，再优先派发首批互不冲突子任务，不再默认只派发 1 个；Codex / Gemini 在 Loop 模式下底部模型选择拆分为“主任务模型 / 子任务模型”，并在“管理模型”中为每个模型提供“主任务 / 子任务”可用角色开关（至少保留一个角色）；Claude 分组不展示插件侧模型选择或模型管理入口，沿用 CLI 默认模型或用户手动配置的命令参数；最终完成时主任务必须返回 `answerConclusion`（直接回答用户原始问题）、整体总结、各轮子任务摘要和用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md` 和任务记录，并移除最终主任务 JSON 协议气泡，在 AI 对话主消息流中先追加 `lobsterAnswerConclusion=true` 的 assistant Markdown 问题回答结论气泡，再追加 `lobsterFinalSummary=true` 的 assistant Markdown 最终总结气泡；最终总结气泡会继续展示问题回答结论、子任务摘要、验收结果、需求覆盖和整体任务总结；只有主任务显式返回 `status=completed` 且主任务对话已同时存在 `lobsterAnswerConclusion=true` 问题回答结论气泡和包含“问题回答结论”“整体任务总结”小节的 `lobsterFinalSummary=true` 最终总结气泡才视为真正结束，如果任务记录已完成但这些气泡缺失或最终总结仍为旧格式，扩展会自动按“继续”恢复同一任务并再次唤醒主任务；主任务中断后可在同一标签输入“继续/continue/resume”等短提示词恢复同一任务并从当前轮次继续，也可在 Loop 群聊面板点击“继续执行”后先确认或编辑默认“继续”消息，再复用同一任务 ID 唤醒主任务/主持人判断下一步；若主任务已经触发上述连续失败上限，则群聊“继续执行”和子任务手动补跑后的自动唤醒都不会再自动恢复主任务，只能保留人工复核信号；若用户在群聊面板点击“补充需求”，扩展会先把补充内容写入任务记录和主任务沟通文件，供下一轮主任务/主持人在恢复时读取并调整安排；子任务结束前必须写清沟通文件，供主任务唤醒后读取；子任务出错会间隔 1 分钟自动重试最多 5 次；子任务中断后在子任务标签手动继续时会强制按内部 coding（即 Vibe）任务执行，不允许再次启动 Loop 任务；消息气泡会标记“Loop / 子任务”
- AI 对话面板中的 Loop 主任务 tab 在主任务或同一 Loop 任务任一子任务仍在运行时强制跟随最新消息；如果用户手动滚离底部，仍会在消息区显示置底按钮，点击后回到最新消息。普通 Vibe 任务和 Loop 子任务 tab 保持原有按用户滚动位置决定是否自动置底的策略。
- Loop 任务启动和恢复气泡会显示“打开 Loop 群聊”入口，命令 `sinitek-cli-tools.openLobsterDebateChat` 保持兼容但打开的是通用 Loop 群聊内容区面板；不同 `taskId` 的 Loop 群聊页面可同时打开并保留，同一 `taskId` 重复打开时复用并刷新该任务已有页面。`main_sub_multi_agent` 会在 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，群成员列表统一显示“成员”，包含“主任务”和动态加入的“子任务 1~N”；主任务决策、子任务加入、子任务完成和批次完成都会追加到 transcript，其中子任务成功完成的发言气泡展示该子任务最终回复，运行状态和验证依据仍写入任务记录与子任务沟通文件。`debate_multi_agent` 使用同一个任务页面把红蓝对抗 `debates/round-*/chat.md` 与共识通过后的根部 `group-chat.md` 合并为单条时间线；主任务轮次、发言批次和执行阶段只作为系统消息显示，不提供轮次切换或按轮次分区。该面板支持当前发言者/执行者“思考中”等待气泡、状态落盘后主动刷新、5 秒兜底自动刷新、50px 距底阈值自动跟随与置底按钮、手动刷新；未完成且未触发主任务 AI 连续失败上限的任务都会显示“补充需求”按钮，把补充内容持久化到当前任务供下一轮读取；当任务当前无运行进程且仍可继续时，面板额外显示“继续执行”按钮，先弹出可编辑确认框并在确认后把消息作为“本次继续指令”传给主任务/裁判主持人；同一 Loop 任务存在运行进程时则显示“中止”按钮，点击后停止该 `lobsterTaskId` 关联的主任务、子任务和辩论/共识相关运行并把任务标记为 stopped；“补充需求”“继续执行”和“中止”按运行态约束显示，不再在面板顶部提供“打开 transcript”或“打开任务记录”按钮。

- Loop 模式的执行方式属于 `lobster` 内部设置，不新增顶层 `InteractiveMode`。Webview 在 Loop 模式下展示“Loop 执行方式”下拉，包含 `main_sub_multi_agent`（主从多智能体）和 `debate_multi_agent`（红蓝辩论多智能体）；默认值为 `main_sub_multi_agent`，老任务记录缺少 `executionMode` 时也按该值处理。新建任务会把 `executionMode` 固化到 `LobsterTaskRecord`，恢复任务时以记录为准，执行中切换下拉只影响新任务。该下拉独立于插件侧模型选择能力，Claude 下仍可见；主/子任务模型选择仍只在 Codex / Gemini 等支持插件侧模型选择的 CLI 下显示。
- `debate_multi_agent` 只替代 Loop 主任务初始规划阶段；首轮红蓝规划共识形成后，后续实现、复核和继续派发由裁判主持人作为主智能体走主从多智能体链路，子任务派发、批次并发、冲突分组、子任务重试、子任务沟通文件、最终总结气泡和 30 天保留清理继续复用现有链路。该模式已升级为红蓝对抗：当任务尚无可复用红蓝规划共识时，先由裁判主持人根据任务目标设计 2-6 个红蓝参与者并写入 `moderator-participants.md`，新清单中 `role` 只能使用 `blue_team` 或 `red_team`，且必须至少包含 1 个蓝队和 1 个红队；主持人还要在清单中指定首批 `openingSpeakerIds`，通常由蓝队先开场。蓝队负责提出、捍卫和修正方案，补足约束、验收口径和证据要求；红队负责攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性。只有任务涉及代码、文件、权限、部署或流程执行时，红队才额外检查写入范围、并发冲突、越权修改、回滚/恢复失败和工程验收风险。扩展校验后把这些成员作为 `## 参与者加入：...` 追加到共享 `chat.md`；参与者只读可用上下文、仓库、任务记录和沟通文件，只写本次提示词指定的 artifact。每个发言批次开始时扩展向 `chat.md` 追加系统消息说明主任务轮次、当前发言批次、最大安全发言批次数和本批次被主持人点名的发言者；只有被主持人显式点名的 1-3 位参与者会进入该批次，并可在批次内并行写入各自的 `participants/<participantId>-turn-<n>.md`。扩展等待本批次全部 artifact 完成后再按点名顺序以 `## 发言：...` 追加到 `chat.md`，随后裁判主持人写 `participants/moderator-turn-<n>.md`，以 `continue / finalize / block` 判断红队攻击是否已被蓝队化解、是否追加下一个发言批次、收集最终立场或进入人工复核；当 `action=continue` 时，主持人必须同时给出下一批 `nextSpeakerIds`。参与者和裁判主持人的临时对话 tab 回答完成后可按“Loop 子任务自动关标签”设置关闭，下一批次同一角色通过 `debateRounds` 记录的 sessionId 新建临时 tab 续接。最大发言批次数只是防无限循环的安全上限，达到上限后运行时强制收束。红蓝对抗产物写入 `~/.sinitek_cli/lobster-communications/<taskId>/debates/round-<n>/`，新任务通常只生成 `round-1`，历史任务或恢复补跑按实际 Loop 轮次记录；产物包括 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/*-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/*.md`、`cross-review.md`、`consensus.md` 和 `decision.json`；共识通过后的执行群聊写入 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md`。任务记录中的 `debateRounds` 保存红蓝对抗状态、`chatFile`、`participantRosterFile`、`participantRosterSessionId`、当前 `activeSpeaker`、参与者状态、参与者 sessionId、裁判主持人决策、裁判主持人 sessionId 和共识摘要。辩论任务启动气泡同样显示“打开 Loop 群聊”入口；通用群聊面板把 `chat.md`、`debateRounds` 和 `group-chat.md` 合并为一个按消息追加顺序展示的时间线，按角色气泡展示参与者加入、参与者发言、裁判主持人控场、最终立场、主任务决策、子任务动态加入、子任务完成、批次事件、收束状态与 sessionId；当前裁判主持人/参与者/共识汇总器/主任务/子任务运行时会在时间线末尾显示“思考中”等待气泡；角色发言或状态落盘后会主动刷新已打开页面，5 秒自动刷新仅作为兜底；若刷新前滚动位置距离底部不超过 50px 会自动跟随最新消息，否则保留阅读位置并显示置底按钮；页面继续提供手动刷新；当任务尚未完成且未触发主任务 AI 连续失败上限时，页面都支持“补充需求”把新要求持久化到任务记录和主沟通文件，供后续主持人主智能体读取。
- `debate_multi_agent` 规划共识通过后会解析 `decision.json` 为现有 `LobsterMainDecision`，并复用 `applyLobsterMainDecision` 进入原有 `completed / continue / blocked` 处理。恢复任务或进入后续轮次时，如果任务记录中已存在可继续的红蓝规划共识和合法 `decision.json`，扩展会跳过新的红蓝辩论，改由主持人主智能体读取首轮红蓝规划产物、主从执行群聊和子任务沟通文件后继续复核；只有缺少可复用规划共识、旧产物缺少裁判主持人控场、`chat.md`、参与者加入事件、收束标记、产物缺失或不可解析时，才补跑规划辩论。裁判主持人红蓝参与者清单缺失或非法、群聊发言 artifact 缺失、裁判主持人 artifact 缺失或不可解析、最终参与者 artifact 缺失或立场不可解析、裁判主持人输出 `block`、共识后的最终参与者立场仍为 `block`、存在未解决 `blocking` disagreement、缺少 `cross-review.md`、`consensus.md` 不含合法共识 JSON、`decision.json` 非法、或 `status=continue` 但没有可派发 `subtasks` 时，不派发子任务，任务进入 `needs-review` 并在主任务沟通文件和主 tab 系统消息中记录原因。若红队或蓝队参与者原始 `block` 可通过裁判主持人追问、蓝队修正、前置子任务、验收标准或风险说明解决，共识汇总器应将其写入 `resolvedDisagreements`，并可把最终立场降为 `agree_with_reservations` 后继续。内容区群聊页面只读，不直接写任务记录或追加辩论消息；真实 VS Code 面板端到端手工验收仍应以单独验收记录为准。

### 3.4 会话与并发

- 会话列表与当前会话切换
- 历史会话列表会显示该会话是否已在 AI 对话 tabs 中打开，并移除“复制 ID”按钮
- 历史记录弹窗支持查看单个历史会话的已保存消息，并可将该会话消息导出为 TXT；历史记录中的操作按钮允许换行展示，避免挤压列表宽度
- 历史记录弹窗提供“Loop 群聊” tab，按更新时间列出保留期内的 Loop 任务摘要；点击“加载”只按 `taskId` 重新打开 Loop 群聊 UI，不改变普通会话绑定，也不会自动继续任务
- 从历史加载未打开的会话时会新建 tab 承载该会话；若该会话已在 tabs 中打开，则直接切换到已有 tab
- 多个 conversation tab（超过 5 个时启用左右翻页按钮，每页最多显示 5 个）
- 即使只有 1 个 conversation tab 也展示顶部标签；运行中 tab 使用主题 focus 色蓝色虚线流水边框，异常终止或进入自动重试等待期的 tab 显示错误红框，手动停止不标红，后续恢复输出或成功结束会恢复正常样式
- 单个 tab 切换 CLI 分组或切换历史会话时，不应中断其他 tab 中正在执行的任务
- 历史会话删除、清空、重置当前 Tab；其中“重置当前 Tab”会关闭当前 tab 并新建一个空白 tab，不会复用原 tab 清空后继续写入，因此旧会话历史仍可从会话列表恢复
- Prompt 历史记录
- 历史提示词、历史会话与任务运行痕迹默认仅保留最近 30 天（约 1 个月）
- 长期记忆不套用普通历史 30 天清理；关闭长期记忆也不自动删除已有记忆，用户需要通过查看/导出/删除入口显式处理
- 任务队列与并发标签页状态区分
- 队列中的提示词仅在上一个任务成功结束后才会继续执行；如果任务失败或被停止，剩余提示词继续保留在队列中
- 队列弹窗支持手动“继续执行队列”，用于在失败/停止后恢复后续提示词执行

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
- 该能力只控制插件侧长期记忆，不控制 Codex / Claude / Gemini 外部 CLI 自带记忆、历史、配置或压缩能力。

### 3.6 输出渲染与任务观测

- Markdown 消息展示
- 最终成功回复使用强调卡片样式，Markdown 外层带主题强调边框
- trace 分段展示
- thinking 与 tool-use 事件区分渲染
- 任务列表提取与展示；Claude 交互式运行除兼容 `TodoWrite` 外，也会根据 `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` / `TaskStop` 工具事件实时刷新任务列表
- 原始流消息导出；历史会话消息可按 TXT 日志导出
- 错误详情查看 / 复制

### 3.7 模型、思考模式与规则

- 模型列表与当前选择按当前配置档案 id 维护，插件侧持久化到 `~/.sinitek_cli/models.json`
- Claude 分组不展示插件侧模型选择或模型管理入口，执行时不会注入 webview 侧选择值；如需固定模型，需由用户自行在 Claude 命令参数中配置
- 打开“管理模型”时，如果前端看到空列表但磁盘或运行态仍有模型数据，扩展会弹出可复制的诊断详情，包含配置 id、存储路径、模型计数和最近读取/配置加载错误
- thinking mode 按 CLI 记忆
- Global / Project 规则读写
- 规则目标覆盖 Codex / Claude / Gemini

### 3.8 配置中心

配置中心支持：

- 配置档案列表、排序、激活、删除、初始化
- 当前配置查看与应用
- 备份与导出
- 技能管理
  - 官方 Claude / Codex / Gemini skills 列表内置仓库快照，当前固定为 Claude 17 项、Codex 39 项、Gemini 40 项
  - 官方 catalog 为每个条目记录 `version`、`versionSource`、`contentHash`、`sourceCommit`
  - 配置页官方条目会显示“当前版本 / 最新版本”；未安装时显示最新版本，已安装时同时显示当前版本和最新版本
  - 官方最新判断优先基于每个条目的 `contentHash`，缺失时才回退到 `sourceRef`
  - Gemini 条目优先显示 `gemini-extension.json.version`；Claude / Codex 在上游缺少显式版本号时显示稳定短 `contentHash`
  - `gemini:firebase` 官方来源使用 `firebase/agent-skills`，不再沿用废弃的 `gemini-cli-extensions/firebase`
- MCP 市场、安装、卸载、健康检查

### 3.9 稳定性与可运维性

- 中英文国际化
- debug 日志开关
- 会话与模型等本地状态持久化
- 模型状态读取失败时保留当前内存状态，避免一次临时读失败把面板模型列表刷新为空
- 日志保留与临时文件清理
- 插件管理的历史痕迹（logs / prompt history / session history / task runs / lobster task records / lobster communications）默认仅保留最近 30 天（约 1 个月）
- Webview 渲染失败时的回退页

## 4. 本地数据与配置范围

### 插件自身数据

保存在：

```text
~/.sinitek_cli/
```

### 外部 CLI 配置

配置中心会读写：

- `~/.claude/*`
- `~/.codex/*`
- `~/.gemini/*`

这些内容属于本机 CLI 生态的一部分，不属于仓库内代码产物。

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
