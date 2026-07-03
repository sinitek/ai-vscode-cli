# CLI 接入参考

本文档替代原 `docs/cli-reference.md` 的详细说明，聚焦**当前仓库已经落地的 CLI 接入行为**。如果 CLI 官方版本发生变化，仍以各自 `--help` 和官方文档为准。

## 1. 当前支持矩阵

| CLI | 当前执行模式 | 会话续接 | 主要实现 |
| --- | --- | --- | --- |
| Codex | 交互式 + 一次性 | 支持 | `src/interactive/codexRunner.ts`、`src/cli/commandRunner.ts` |
| Claude | 交互式 + 一次性 | 支持 | `src/interactive/claudeRunner.ts`、`src/interactive/metaStore.ts` |
| Gemini | 一次性 headless stream-json | 复用 CLI `--resume` 参数，不维护交互 Runner | `src/cli/commandRunner.ts`、`src/cli/geminiStreamJson.ts` |

## 2. 命令来源

三个平台命令都从 VS Code 设置读取：

- `sinitek-cli-tools.commands.codex`
- `sinitek-cli-tools.commands.claude`
- `sinitek-cli-tools.commands.gemini`

参数来源：

- `sinitek-cli-tools.args.codex`
- `sinitek-cli-tools.args.claude`
- `sinitek-cli-tools.args.gemini`

命令解析逻辑集中在 `src/cli/commandRunner.ts`：

- 支持绝对路径、PATH 查找
- Unix/macOS 下会优先尝试常见用户级 npm/pnpm bin 目录（如 `~/.npm-global/bin`、`PNPM_HOME`），降低旧 Homebrew CLI 抢占 `gemini` 命令的概率
- Windows 下额外尝试 npm 全局安装目录
- macOS 下优先直接启动已解析的 CLI；仅在命令仍无法直接解析时，才回退到 `sinitek-cli-tools.macTaskShell` 对应的 `zsh` / `bash`

## 3. 交互模式真实行为

### Codex

- 使用当前用户安装的官方 `codex` CLI
- 通过 `codex app-server --listen stdio://` 建立 JSON-RPC 会话
- 优先直接 `spawn` 已解析的 Codex 可执行路径；macOS 仅在命令无法直接解析时回退到用户配置的 shell 包装
- 会为 Codex 子进程显式注入 `CODEX_HOME` / `CODEX_HOME_DIR`，并移除 `npm_config_prefix` / `NPM_CONFIG_PREFIX`
- 启动前会确保当前工作区在 Codex 配置中被标记为 trusted，并通过 `-c projects.<workspace>.trust_level="trusted"` 追加运行时 override
- 会做 `initialize` / `initialized` 握手
- 使用 `thread/start`、`thread/resume`、`turn/start` 维护 threadId
- 面板“常用命令 -> 压缩上下文”在 Codex 下会直接复用当前 threadId，走 app-server `thread/compact/start` 原生压缩；不会再通过“生成摘要后切到新线程”模拟压缩
- 面板“工具设置”支持项目级“执行后自动压缩上下文”开关（默认开启）；开启后，在已有会话任务成功结束且执行超过 5 分钟后会自动压缩上下文；任务中断、报错或执行不超过 5 分钟不触发。该自动行为当前对 Codex / Claude / Gemini 生效
- 回合完成后优先走 graceful shutdown：先结束 stdin，再升级到信号终止，避免长任务在 flush 边界被粗暴打断
- 会把部分设置映射到 thread 选项，例如：
  - model
  - approval policy
  - sandbox mode
  - add-dir
  - web search
  - thinking / reasoning effort
- 面板“工具设置”支持项目级控制 Codex 官方 `multi_agent` 功能，默认关闭；关闭时扩展会在 app-server 启动参数中附加 `--disable multi_agent`，并在 thread config 中显式写入 `features.multi_agent=false`

### Claude

- 使用 `@anthropic-ai/claude-agent-sdk`
- 优先尝试复用用户设置的 Claude 可执行入口
- 同步传入当前模型、工作目录和 `user/project/local` settings
- 通过 SDK session 做会话续接
- 面板“常用命令 -> 压缩上下文”在 Claude 下优先直接发送官方 `/compact` slash command，并通过 SDK `status=compacting` / `compact_boundary` 事件判定原生压缩完成；若当前 Claude 环境明确不支持原生 compact，则回退到旧的“生成摘要后切新会话”兼容方案
- 面板“工具设置”开启“执行后自动压缩上下文”后，Claude 的已有会话任务会在成功结束且执行超过 5 分钟后走一次压缩（含 `/compact` 原生能力与兼容回退路径）；任务中断、报错或执行不超过 5 分钟不触发
- Claude Code 2.1.118 的官方 CLI 帮助已提供 `--effort <level>`，取值为 `low`、`medium`、`high`、`xhigh`、`max`
- 插件交互 Runner 优先通过 SDK `extraArgs.effort` 传递新版思考力度；若旧 Claude Code/SDK 不支持该参数，则回退到 `maxThinkingTokens`
- 插件 one-shot Claude 调用默认通过 `thinkingArgs.claude.*` 拼装 `--effort <level>`；`off` 默认不再追加旧版 `--max-thinking-tokens 0`
- Claude 交互 Runner 的任务列表除了兼容 `TodoWrite` 外，还会从 `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` / `TaskStop` 工具调用及结果中归一化出 `{ text, done }`，供 AI 对话面板实时展示

### Gemini

- 当前不维护交互 Runner
- 插件默认参数推荐使用 `--approval-mode auto_edit`；若用户显式改写 `sinitek-cli-tools.args.gemini`，则以用户配置为准
- 插件侧 one-shot / parallel 调用会自动补齐 Gemini headless 参数：`-p <prompt>`
- 若用户未显式配置 `--output-format`，插件会追加 `--output-format stream-json`，并按 JSONL 事件解析 assistant delta、`init.session_id`、`result.status` 与错误事件
- 若用户已在参数中显式配置 `-p` / `--prompt` 或 `--output-format`，插件不会重复插入对应参数，保持用户配置优先
- session 续接仍复用 Gemini CLI 的 `--resume <sessionId>` 参数；扩展侧不维护类似 Codex app-server 的 Gemini 交互 Runner
- 面板“常用命令 -> 压缩上下文”在 Gemini 下会直接复用当前 `sessionId` 调用官方 `/compress` 命令，继续走现有 headless `stream-json` 链路；“执行后自动压缩上下文”开启后，Gemini 也会在已有会话任务成功结束且执行超过 5 分钟后自动执行一次 `/compress`
- 会参与统一 UI、统一会话存档和统一配置读取

## 3.5 工具设置存储

- 工具设置中的全局项（`debug`、`autoAddEditorContextTags`、`locale`、`macTaskShell`）写入 `~/.sinitek_cli/settings.json`
- 工具设置中的项目级项（如 `autoCompactContextAfterRun`、`codexMultiAgentEnabled`、`lobsterExecutionModeByCli`、`lobsterMaxRounds`、`lobsterAutoCloseSubtaskTabs`）写入 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`
- 长期记忆开关控制当前工作区的插件侧 `~/.sinitek_cli/memory/` 记忆层，默认开启；工具设置的“工作区”页签可关闭，并写入 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json` 的 `workspaceMemoryEnabled`。配置解析采用“显式 false 防误开优先”：兼容旧字段 `memoryEnabled=false`、`globalMemoryEnabled=false`、`workspaceMemoryEnabled=false` 命中对应作用域时，运行时必须关闭对应长期记忆行为。
- 长期记忆关闭后，插件只允许查看、导出和删除已有记忆；不得创建、更新、自动提取、召回、注入或更新 memory 目录元数据。关闭插件侧长期记忆不会关闭 Codex / Claude / Gemini 外部 CLI 自带记忆、历史、压缩、配置或账号侧能力。
- 自动提取还有二级条件：`memoryAutoExtractAfterCompact` 只允许 compact 成功后的提取，`memoryAutoExtractAfterLobsterTask` 只允许龙虾任务完成后的提取；二者默认关闭，且必须在总开关和对应作用域开启时才允许新增或更新 `~/.sinitek_cli/memory/`。
- 运行时会兼容读取旧的 VS Code `sinitek-cli-tools.*` 配置值，但工具设置面板本身以 `~/.sinitek_cli/` 下的数据为主

## 4. 模式与参数映射

### thinking mode

插件对外暴露统一的 thinking mode，但实际映射按 CLI 各自处理：

- Codex：映射到 reasoning effort / 相关参数
- Claude：优先映射到 Claude Code `--effort`；旧版本兼容回退到 `maxThinkingTokens` 和 SDK 选项
- Gemini：继续走 CLI 参数拼装；one-shot 场景默认使用 `-p` 与 `--output-format stream-json`

### interactive mode

当前 AI 对话面板只暴露 `coding / lobster` 两种顶层模式；旧 workspace 配置中的 `plan` 会按 `coding` 兼容归一化。底层 runner 仍保留历史 `plan` 分支用于类型和旧数据兼容，但 Webview 不再产生该值：
- `lobster`：扩展侧编排的多轮主子任务模式；底层 CLI 权限按 coding 模式执行，并按会话隔离写入 `~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json` 记录任务概要（首次主任务尚未拿到真实会话 ID 时先写入 pending 路径，拿到会话 ID 后自动迁移），同时通过 `~/.sinitek_cli/lobster-communications/<taskId>/` 组织沟通文件、activeSubtaskId、activeSubtaskIds、主任务 JSON 决策、acceptance 验收结果、预计剩余轮次和轮次状态，供扩展解析并以独立新会话启动子任务；工具设置支持配置新建龙虾任务最大主任务复核轮次（默认 20，范围 1-100，已有任务保持记录值），以及“子任务成功完成后自动关闭 AI 对话标签页”开关（默认开启）；主任务每次复核应返回 `estimatedRemainingRounds` 预判剩余主任务复核轮次；`status=continue` 可返回旧 `subtask` 或新 `subtasks` 批次，扩展内部统一按批次处理；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，只有能确认 `writeFiles` / `conflictGroup` 互不重叠时才把多个子任务放入同一 `subtasks` 批次，同一批次最多 6 个；扩展会按声明的写入文件/冲突组自动规划组内并发、组间串行；单子任务时 UI 自动切换到子任务标签展示气泡和流式消息，多子任务批次会创建多个子任务标签并并发执行，只有批次内所有子任务都正常完成后才切回并唤醒主任务；参与者和主持人完成后可自动关闭临时 tab，后续复用记录里的 sessionId 续接同一角色会话；每次主任务返回 `status=continue` 时，扩展会把该轮 JSON 协议气泡原位替换成 Markdown 子任务派发摘要，并把摘要追加到 `main-task.md`；轮次按主任务复核轮计数，同一轮可包含一个或多个并发子任务；第 1 轮要求主任务先做总体阶段规划，再优先派发首批互不冲突子任务，不再默认只派发 1 个；龙虾模式下底部模型选择支持分别指定主任务模型与子任务模型，并可在“管理模型”里按模型配置“主任务/子任务”角色开关来限定候选模型；主任务必须读取沟通文件并把 subtasks[*].prompt 写成自包含详细指令，且在完成时返回 `answerConclusion`（直接回答用户原始问题）、整体总结、各轮子任务摘要与用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md` 和任务记录，并移除最终主任务 JSON 协议气泡，在 AI 对话主消息流中先追加 `lobsterAnswerConclusion=true` 的 assistant Markdown 问题回答结论气泡，再追加 `lobsterFinalSummary=true` 的 assistant Markdown 最终总结气泡；最终总结气泡会同时展示问题回答结论和龙虾任务整体总结；只有主任务显式返回 `status=completed`（且 `acceptance.passed=true`）才结束；主任务中断后支持在同一标签输入“继续/continue/resume”等短提示词恢复同一任务并从当前轮次继续；子任务完成前必须写入自己的沟通文件；子任务执行出错会等待 1 分钟后重试，最多重试 5 次，主动停止不重试；子任务中断后在子任务标签手动继续时会强制按 coding 任务执行，不允许再次启动龙虾任务；`lobster-tasks` 与 `lobster-communications` 产物同样按 30 天保留策略清理

龙虾内部执行方式事实：

- `lobsterExecutionModeByCli` 按 CLI 记忆 Webview 下拉；`sendPrompt.lobsterExecutionMode` 只在顶层 `interactiveMode=lobster` 时使用。合法值为 `main_sub_multi_agent` 和 `debate_multi_agent`；缺失或非法值回落到 `main_sub_multi_agent`。新建 `LobsterTaskRecord` 会写入 `executionMode`，老任务缺字段时按 `main_sub_multi_agent` 归一化，恢复任务时不使用当前 UI 下拉覆盖记录值。
- `main_sub_multi_agent` 会在 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，任务开始或恢复气泡会带“打开龙虾群聊”动作；通用群聊面板把主任务和动态加入的子任务 1~N 作为成员展示，主任务决策、子任务加入、子任务完成和批次完成会追加为时间线气泡；子任务成功完成的气泡正文是该子任务最终回复，运行状态、单测/编译状态和判定依据继续落在任务记录与子任务沟通文件中，并根据 activeSubtaskId / activeSubtaskIds 显示当前主任务或子任务“思考中”。`debate_multi_agent` 也复用同一个面板：面板把红蓝对抗 `debates/round-*/chat.md` 和共识通过后的根部 `group-chat.md` 合并为单条时间线，主任务轮次、发言批次和执行阶段只作为系统消息显示，不再提供轮次切换；同一 `lobsterTaskId` 存在运行进程时面板显示“中止”按钮，点击后停止主任务、子任务、裁判主持人、参与者和共识汇总器等相关运行并把任务标记为 stopped；未完成且无运行进程时才显示“继续执行”按钮，两者互斥。任务进入 `needs-review` / `error` / `stopped` 时，面板末尾追加虚拟的 `主持人停止说明` error 样式气泡，用任务 `finalSummary`、共识摘要和决策状态说明停止原因，不写回原始 transcript。命令 `sinitek-cli-tools.openLobsterDebateChat` 保持兼容命名，但可打开任意龙虾任务的群聊面板；找不到当前任务时会列出最近的龙虾任务。
- `LobsterTaskRecord.debateRounds` 记录红蓝对抗轮状态、`chat.md` 路径、`moderator-participants.md` 路径、动态参与者 artifact、参与者 sessionId、裁判主持人控场记录、裁判主持人 sessionId、共识和决策摘要。`debate_multi_agent` 每个主任务复核轮在 `~/.sinitek_cli/lobster-communications/<taskId>/debates/round-<lobsterRound>/` 下生成 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/<participantId>-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/<participantId>.md`、`cross-review.md`、`consensus.md`、`decision.json`。参与者和裁判主持人的临时 tab 回答完成后可按自动关闭设置释放，下一批次同一角色通过记录的 sessionId 新建临时 tab 续接。
- `debate_multi_agent` 先启动裁判主持人红蓝组队阶段。裁判主持人读取 brief、任务记录和沟通文件后写入 `moderator-participants.md`，动态设计 2-6 个参与者；新清单的 `role` 只能是 `blue_team` 或 `red_team`，且必须至少包含 1 个蓝队和 1 个红队。蓝队负责提出、捍卫和修正方案，并补足约束、验收口径和证据要求；红队负责攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性。只有任务涉及代码、文件、权限、部署或流程执行时，红队才额外检查写入范围、并发冲突、越权修改、回滚/恢复失败和工程验收风险。扩展校验唯一 id、合法 role、title/focus 非空后，把 `## 参与者加入：<title>（<id>）` 追加到 `chat.md`。参与者和裁判主持人都以临时普通对话 tab 运行，不写 `taskRole=main/subtask`，只能写本次提示词指定的 artifact；每个发言批次开始时扩展先追加 `## 任务事件` 系统消息说明主任务轮次、当前发言批次和最大安全发言批次数；同一发言批次内参与者并行运行，各自写独立 artifact，扩展等待全部完成后再按动态清单顺序把发言追加到 `chat.md`，随后启动裁判主持人控场。裁判主持人每批次输出 `continue / finalize / block`：`continue` 表示红队攻击尚未被蓝队回应或蓝队新方案尚未被红队攻击，`finalize` 会并行进入最终立场收集，`block` 会在写入最终立场和收束标记后进入人工复核。运行时保留最大安全发言批次数作为防无限循环兜底，达到上限后强制收束，不再继续追加讨论。
- 共识汇总器读取 `brief.md`、完整 `chat.md` 与所有动态参与者最终 artifact，生成 `cross-review.md`、`consensus.md` 和纯 JSON `decision.json`。恢复 `debate_multi_agent` 任务时，若当前轮已有完整有效的 `chat.md`（含参与者加入、裁判主持人控场与 `## 群聊收束` 标记）、`decision.json`、`consensus.md` 和动态参与者最终 artifact，且共识校验允许继续，运行时优先复用 `decision.json`，再交给现有 `applyLobsterMainDecision`。如果旧产物缺少裁判主持人控场、`chat.md` 或收束标记、产物缺失或不可解析，会重跑当前辩论轮；如果已有共识显示未解决阻塞，则进入 `needs-review`。
- 缺少或无法写入 `brief.md` / `chat.md`、裁判主持人红蓝参与者清单缺失或非法、任一群聊发言 artifact 缺失、裁判主持人 artifact 缺失或无法解析、最终参与者 artifact 缺失或立场不可解析、裁判主持人输出 `block`、共识后的最终参与者立场仍为 `block`、未解决 `blocking` disagreement、缺少 `cross-review.md`、`consensus.md` 不含合法共识 JSON、`decision.json` 非法、或 `status=continue` 但无合法 `subtasks` 时，运行时不派发子任务，清空 activeSubtask 字段，把任务更新为 `needs-review`，并向主 tab 系统消息和 `main-task.md` 记录原因。若 `consensus.md` 已达成但仍包含未解决阻塞，主 tab 和 `main-task.md` 应按“红蓝对抗达成阻塞共识”记录，并同步共识摘要、`decision.finalSummary` 和 `decision.estimatedRemainingRounds`，避免沿用上一轮剩余轮次造成误判。参与者 artifact 的原始 `block` 可由下一轮裁判主持人追问、蓝队修正或共识汇总器通过 `resolvedDisagreements`、前置子任务、验收标准或风险说明解决；运行时以 `consensus.md` 中的最终 `participantStances` 和 `openDisagreements` 做派发判定，缺失的 participant stance 才用 artifact stance 补齐。

运行结束判定补充：普通任务只有在本轮用户消息之后产生非 thinking 的 assistant 最终结论气泡，才会按成功完成收口；Codex 交互任务必须看到 app-server `phase:"final_answer"` 并在消息上标记 `codexFinalAnswer=true`，`phase:"commentary"` 只作为过程消息，不算最终结论。如果 CLI 已成功退出但没有该气泡，扩展会隐式发送“继续”重试，重试上限沿用统一 hidden retry 配置。每次失败进入下一轮前会先展示错误 trace 和“第 X/Y 次自动重试将在 N 秒/分钟后开始”的系统提示；等待结束真正开始该次重试时，还会再展示“第 X/Y 次自动重试已开始”，并把对应标签从等待重试错误态恢复为运行态。龙虾任务还要求主任务对话中同时存在 `lobsterAnswerConclusion=true` 的问题回答结论气泡和 `lobsterFinalSummary=true` 的最终总结气泡；最终总结气泡内容会同时包含直接回答用户问题的 `answerConclusion` 和整体任务总结；若任务记录已是 `completed` 但任一完成气泡缺失，扩展会自动恢复同一任务并以“继续”重新唤醒主任务。

## 5. 图片与附件

当前聊天面板支持上传附件，Codex 额外支持图片输入桥接：

- 先把附件写入 `~/.sinitek_cli/temp/`
- 若是图片且 Codex CLI 版本满足要求，会转成官方图片输入路径
- 若版本不满足，则保留向后兼容行为并提示升级

## 6. 会话与本地映射

扩展侧会话 ID 与底层真实续接 ID 不同：

- Codex：扩展 sessionId ↔ threadId
- Claude：扩展 sessionId ↔ Claude sessionId

映射数据通过 `src/interactive/metaStore.ts` 落盘，避免切换会话或重启 VS Code 后丢失续接能力。

## 7. 当前平台注意事项

### Windows

如果出现 `spawn <cli> ENOENT`：

1. 先用 `where codex` / `where claude` / `where gemini` 验证命令
2. 必要时把命令配置成绝对路径
3. 修改 PATH 后重启 VS Code

### macOS

如果默认 shell 环境与 VS Code 环境不一致，可切换：

- `sinitek-cli-tools.macTaskShell = zsh`
- `sinitek-cli-tools.macTaskShell = bash`

## 8. 更新本文档时的原则

只有下面两类内容应进入这里：

- 当前仓库已经落地、可被代码验证的行为
- 对使用者排障有高价值的运行事实

不要把未来方案、未实现提案或纯猜测放进来；那类内容应进入设计文档或技术债跟踪。
