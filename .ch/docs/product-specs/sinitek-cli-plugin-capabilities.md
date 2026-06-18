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
- 工具设置中的全局项（debug、自动文件标签、语言、macOS task shell）保存在 `~/.sinitek_cli/settings.json`；项目级工具设置保存在 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`
- 工具设置提供项目级“执行后自动压缩上下文”开关（默认开启）；开启后，若当前任务目标为已有 Codex/Claude/Gemini 会话，会在任务成功结束且执行超过 5 分钟后自动执行一次上下文压缩；任务中断、报错或执行不超过 5 分钟不触发自动压缩；手动或自动压缩执行期间，聊天面板运行条会显示带动画的“压缩上下文中”状态
- 对非主动中断/异常，或 CLI 成功退出但本轮没有产生普通 assistant 最终结论气泡的情况，会隐式发送“继续/continue”自动重试最多 5 次，间隔依次为 5 秒、15 秒、30 秒、2 分钟、5 分钟；Codex 交互任务必须看到 `phase:"final_answer"`/`codexFinalAnswer=true` 才视为本轮最终结论，`phase:"commentary"` 只作为过程消息；不会展示这条隐式用户消息；每次失败进入下一次自动重试前会追加错误 trace 气泡展示本次失败信息，并追加系统提示说明当前是第几次自动重试；等待结束真正开始执行该次自动重试时，会再追加“第 X/Y 次自动重试已开始”提示并把标签页恢复到运行态；达到上限后会展示最近一次真实错误，避免只剩泛化提示
- Codex 在工具设置中提供项目级“子智能体（multi_agent）”开关，默认关闭；关闭时继续走 app-server 主链路，但会显式禁用官方多智能体子任务能力
- Codex 交互式运行会优先直接启动已解析的 CLI，可显式固定 `CODEX_HOME` / 工作区 trust，并在回合完成时优先采用渐进式关闭，降低长任务被异常打断的概率
- 龙虾模式会沿用当前 tab 的会话上下文，并按会话隔离写入任务记录：`~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json`（首次主任务尚未拿到真实会话 ID 时会暂存到 pending 路径，拿到真实会话 ID 后自动迁移到该会话文件）；主任务、子任务、轮次概要和预计剩余轮次都写入该会话记录文件，同时在 `~/.sinitek_cli/lobster-communications/<taskId>/` 维护主子任务沟通文件；工具设置支持配置新建龙虾任务最大主任务复核轮次（默认 20，范围 1-100，已有任务保持记录值），以及“子任务成功完成后自动关闭 AI 对话标签页”开关（默认开启）；龙虾主任务标签页会显示 `🦞` 前缀，且主任务或任一子任务仍在运行时禁止关闭主任务标签页；若在该主任务标签继续执行普通（非龙虾）任务，前缀会恢复为普通标签；点击不同类型会话标签会自动切换为龙虾/编码模式，新建标签默认编码模式；主任务返回 JSON 决策并在每次复核中预判 `estimatedRemainingRounds` 剩余轮次，扩展兼容旧 `subtask` 字段，并优先解析 `subtasks` 批次；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，优先把能确认 `writeFiles` / `conflictGroup` 互不重叠的子任务放入同一批次，同一轮最多 6 个；扩展会按声明的写入文件/冲突组自动规划组内并发、组间串行；扩展为批次内每个子任务创建独立新会话，单子任务仍自动切换到子任务标签展示气泡和流式消息，多子任务批次会创建多个子任务标签并并发运行；每次 `status=continue` 的主任务 JSON 协议气泡会原位替换为 Markdown 子任务派发摘要，并同步追加到 `main-task.md`；只有批次内所有子任务都正常完成后才切回主任务并自动唤醒主任务审核验收，不满足则继续启动下一批子任务，验收通过才结束；轮次按主任务复核轮计数，同一轮可包含一个或多个并发子任务；第 1 轮先做总体阶段规划，再优先派发首批互不冲突子任务，不再默认只派发 1 个；Codex / Gemini 在龙虾模式下底部模型选择拆分为“主任务模型 / 子任务模型”，并在“管理模型”中为每个模型提供“主任务 / 子任务”可用角色开关（至少保留一个角色）；Claude 分组不展示插件侧模型选择或模型管理入口，沿用 CLI 默认模型或用户手动配置的命令参数；最终完成时主任务必须返回整体总结、各轮子任务摘要和用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md` 和任务记录，并移除最终主任务 JSON 协议气泡，在对话中追加 assistant Markdown 最终总结气泡；只有主任务显式返回 `status=completed` 且主任务对话已存在 `lobsterFinalSummary=true` 的最终总结气泡才视为真正结束，如果任务记录已完成但该气泡缺失，扩展会自动按“继续”恢复同一任务并再次唤醒主任务；主任务中断后可在同一标签输入“继续/continue/resume”等短提示词恢复同一任务并从当前轮次继续，也可在龙虾群聊面板点击“继续执行”后先确认或编辑默认“继续”消息，再复用同一任务 ID 唤醒主任务/主持人判断下一步，不会默认回到第一轮；子任务结束前必须写清沟通文件，供主任务唤醒后读取；子任务出错会间隔 1 分钟自动重试最多 5 次；子任务中断后在子任务标签手动继续时会强制按 coding 任务执行，不允许再次启动龙虾任务；消息气泡会标记“🦞 / 子任务”
- AI 对话面板中的龙虾主任务 tab 在主任务或同一龙虾任务任一子任务仍在运行时强制跟随最新消息；普通编码任务和龙虾子任务 tab 保持原有按用户滚动位置决定是否自动置底的策略。
- 龙虾任务启动和恢复气泡会显示“打开龙虾群聊”入口，命令 `sinitek-cli-tools.openLobsterDebateChat` 保持兼容但打开的是通用龙虾群聊内容区面板。`main_sub_multi_agent` 会在 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，群成员包含“主任务”和动态加入的“子任务 1~N”；主任务决策、子任务加入、子任务完成和批次完成都会追加到 transcript，其中子任务成功完成的发言气泡展示该子任务最终回复，运行状态和验证依据仍写入任务记录与子任务沟通文件。`debate_multi_agent` 使用同一个面板把辩论 `debates/round-*/chat.md` 与共识通过后的根部 `group-chat.md` 合并为单条时间线；主任务轮次、发言批次和执行阶段只作为系统消息显示，不提供轮次切换或按轮次分区。该面板支持当前发言者/执行者“思考中”等待气泡、状态落盘后主动刷新、5 秒兜底自动刷新、50px 距底阈值自动跟随与置底按钮、手动刷新、打开 transcript、打开任务记录；同一龙虾任务存在运行进程时显示“中止”按钮，点击后停止该 `lobsterTaskId` 关联的主任务、子任务和辩论/共识相关运行并把任务标记为 stopped；任务未完成且当前无运行进程时显示“继续执行”按钮，点击后先弹出可编辑确认框，确认后才把消息作为“本次继续指令”传给主任务/主持人；“中止”和“继续执行”不会同时出现。

- 龙虾模式的执行方式属于 `lobster` 内部设置，不新增顶层 `InteractiveMode`。Webview 在龙虾模式下展示“龙虾执行方式”下拉，包含 `main_sub_multi_agent`（主从多智能体）和 `debate_multi_agent`（辩论多智能体）；默认值为 `main_sub_multi_agent`，老任务记录缺少 `executionMode` 时也按该值处理。新建任务会把 `executionMode` 固化到 `LobsterTaskRecord`，恢复任务时以记录为准，执行中切换下拉只影响新任务。该下拉独立于插件侧模型选择能力，Claude 下仍可见；主/子任务模型选择仍只在 Codex / Gemini 等支持插件侧模型选择的 CLI 下显示。
- `debate_multi_agent` 只替代龙虾主任务规划/复核阶段，后续子任务派发、批次并发、冲突分组、子任务重试、子任务沟通文件、最终总结气泡和 30 天保留清理继续复用现有链路。每个主任务复核轮先由主持人根据任务目标设计 2-6 个动态参与者并写入 `moderator-participants.md`，扩展校验后把这些成员作为 `## 参与者加入：...` 追加到共享 `chat.md`；参与者只读仓库、任务记录和沟通文件，只写本次提示词指定的 artifact。每个发言批次开始时扩展向 `chat.md` 追加系统消息说明主任务轮次、当前发言批次和最大安全发言批次数；同一发言批次内动态参与者并行写入各自的 `participants/<participantId>-turn-<n>.md`，扩展等待本批次全部 artifact 完成后再按清单顺序以 `## 发言：...` 追加到 `chat.md`，随后主持人写 `participants/moderator-turn-<n>.md`，以 `continue / finalize / block` 判断是否追加下一个发言批次、收集最终立场或进入人工复核。参与者和主持人的临时对话 tab 回答完成后可按“龙虾子任务自动关标签”设置关闭，下一批次同一角色通过 `debateRounds` 记录的 sessionId 新建临时 tab 续接。最大发言批次数只是防无限循环的安全上限，达到上限后运行时强制收束。辩论产物写入 `~/.sinitek_cli/lobster-communications/<taskId>/debates/round-<n>/`，包括 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/*-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/*.md`、`cross-review.md`、`consensus.md` 和 `decision.json`；共识通过后的执行群聊写入 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md`。任务记录中的 `debateRounds` 保存辩论状态、`chatFile`、`participantRosterFile`、`participantRosterSessionId`、当前 `activeSpeaker`、参与者状态、参与者 sessionId、主持人决策、主持人 sessionId 和共识摘要。辩论任务启动气泡同样显示“打开龙虾群聊”入口；通用群聊面板把 `chat.md`、`debateRounds` 和 `group-chat.md` 合并为一个按消息追加顺序展示的时间线，按角色气泡展示参与者加入、参与者发言、主持人控场、最终立场、主任务决策、子任务动态加入、子任务完成、批次事件、收束状态与 sessionId；当前主持人/参与者/共识汇总器/主任务/子任务运行时会在时间线末尾显示“思考中”等待气泡；角色发言或状态落盘后会主动刷新已打开页面，5 秒自动刷新仅作为兜底；若刷新前滚动位置距离底部不超过 50px 会自动跟随最新消息，否则保留阅读位置并显示置底按钮；页面继续提供手动刷新、打开 transcript、打开任务记录操作。
- `debate_multi_agent` 共识通过后会解析 `decision.json` 为现有 `LobsterMainDecision`，并复用 `applyLobsterMainDecision` 进入原有 `completed / continue / blocked` 处理。恢复任务时，如果当前轮已经存在完整有效的 `chat.md`（含参与者加入、主持人控场与收束标记）、`decision.json`、`consensus.md` 和所有动态参与者最终 artifact，会优先复用该决策，避免重复辩论；如果旧产物缺少主持人控场、`chat.md`、产物缺失或不可解析，则重跑当前辩论轮。主持人动态参与者清单缺失或非法、群聊发言 artifact 缺失、主持人 artifact 缺失或不可解析、最终参与者 artifact 缺失或立场不可解析、主持人输出 `block`、共识后的最终参与者立场仍为 `block`、存在未解决 `blocking` disagreement、缺少 `cross-review.md`、`consensus.md` 不含合法共识 JSON、`decision.json` 非法、或 `status=continue` 但没有可派发 `subtasks` 时，不派发子任务，任务进入 `needs-review` 并在主任务沟通文件和主 tab 系统消息中记录原因。若参与者原始 `block` 可通过主持人追问、前置子任务、验收标准或风险说明解决，共识汇总器应将其写入 `resolvedDisagreements`，并可把最终立场降为 `agree_with_reservations` 后继续。内容区群聊页面只读，不直接写任务记录或追加辩论消息；真实 VS Code 面板端到端手工验收仍应以单独验收记录为准。

### 3.4 会话与并发

- 会话列表与当前会话切换
- 历史会话列表会显示该会话是否已在 AI 对话 tabs 中打开，并移除“复制 ID”按钮
- 历史记录弹窗支持查看单个历史会话的已保存消息，并可将该会话消息导出为 TXT；历史记录中的操作按钮允许换行展示，避免挤压列表宽度
- 历史记录弹窗提供“龙虾群聊” tab，按更新时间列出保留期内的龙虾任务摘要；点击“加载”只按 `taskId` 重新打开龙虾群聊 UI，不改变普通会话绑定，也不会自动继续任务
- 从历史加载未打开的会话时会新建 tab 承载该会话；若该会话已在 tabs 中打开，则直接切换到已有 tab
- 多个 conversation tab（超过 5 个时启用左右翻页按钮，每页最多显示 5 个）
- 即使只有 1 个 conversation tab 也展示顶部标签；运行中 tab 使用主题 focus 色蓝色虚线流水边框，异常终止或进入自动重试等待期的 tab 显示错误红框，手动停止不标红，后续恢复输出或成功结束会恢复正常样式
- 单个 tab 切换 CLI 分组或切换历史会话时，不应中断其他 tab 中正在执行的任务
- 历史会话删除、清空、重置当前 Tab；其中“重置当前 Tab”会关闭当前 tab 并新建一个空白 tab，不会复用原 tab 清空后继续写入，因此旧会话历史仍可从会话列表恢复
- Prompt 历史记录
- 历史提示词、历史会话与任务运行痕迹默认仅保留最近 30 天（约 1 个月）
- 任务队列与并发标签页状态区分
- 队列中的提示词仅在上一个任务成功结束后才会继续执行；如果任务失败或被停止，剩余提示词继续保留在队列中
- 队列弹窗支持手动“继续执行队列”，用于在失败/停止后恢复后续提示词执行

### 3.5 Prompt 输入增强

- `@` 路径插入
- 读取当前文件 / 当前选区作为上下文标签（可在工具设置开启，默认关闭）
- 附件上传
- 工作区路径选择器
- 常用命令，例如压缩上下文

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
