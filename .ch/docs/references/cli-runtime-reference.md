# CLI 接入参考

本文档替代原 `docs/cli-reference.md` 的详细说明，聚焦**当前仓库已经落地的 CLI 接入行为**。如果 CLI 官方版本发生变化，仍以各自 `--help` 和官方文档为准。

## 1. 当前支持矩阵

| CLI | 当前执行模式 | 会话续接 | 主要实现 |
| --- | --- | --- | --- |
| Codex | 交互式 + 一次性 | 支持 | `src/interactive/codexRunner.ts`、`src/cli/commandRunner.ts` |
| Claude | 交互式 + 一次性 | 支持 | `src/interactive/claudeRunner.ts`、`src/interactive/metaStore.ts` |
| OpenCode | one-shot / 并行 `opencode run --auto [message..]` | 支持统一 UI、配置读取与本地会话存档；当前不走交互 Runner | `src/cli/commandRunner.ts` |
| Gemini | 已移除 | 不再作为当前支持 CLI | 历史实现曾涉及 `src/cli/geminiStreamJson.ts`，仅作迁移参考 |

## 2. 命令来源

当前支持平台命令都从 VS Code 设置读取：

- `sinitek-cli-tools.commands.codex`
- `sinitek-cli-tools.commands.claude`
- `sinitek-cli-tools.commands.opencode`

参数来源：

- `sinitek-cli-tools.args.codex`
- `sinitek-cli-tools.args.claude`
- `sinitek-cli-tools.args.opencode`

命令解析逻辑集中在 `src/cli/commandRunner.ts`：

- 支持绝对路径、PATH 查找
- Unix/macOS 下会优先尝试常见用户级 npm/pnpm bin 目录（如 `~/.npm-global/bin`、`PNPM_HOME`），降低用户级 CLI 命令被系统路径中旧版本抢占的概率
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
- 面板“工具设置”支持项目级“执行后自动压缩上下文”开关（默认开启）；开启后，在已有会话任务成功结束且执行超过 5 分钟后会自动压缩上下文；任务中断、报错或执行不超过 5 分钟不触发。该自动行为当前面向 Codex / Claude / OpenCode；OpenCode 的具体压缩实现以插件当前 runner 能力为准
- 面板“工具设置”的全局页为 Codex / Claude / OpenCode 提供统一最终答复判定策略：`strict_final_answer`（严格 final_answer，默认）和 `successful_reply_fallback`（成功回复兼容）。该值以 `finalAnswerPolicy` 保存在 `~/.sinitek_cli/settings.json`，缺失或非法值按严格策略处理，并在下一次任务回合启动时生效；旧 `codexFinalAnswerPolicy=completed_turn_fallback` 会归一化为兼容策略。
- 回合完成后优先走 graceful shutdown：先结束 stdin，再升级到信号终止，避免长任务在 flush 边界被粗暴打断
- 会把部分设置映射到 thread 选项，例如：
  - model
  - approval policy
  - sandbox mode
  - add-dir
  - web search
  - thinking / reasoning effort
- 面板“工具设置”支持项目级控制 Codex 官方 `multi_agent` 功能，默认关闭；关闭时扩展会显式禁用 Codex 官方 `multi_agent` 功能；开启时 Codex 可按自身运行时行为使用内置子智能体能力。该设置只影响 Codex。

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

### OpenCode

- OpenCode 是 Codex、Claude 之外的新支持目标，按插件通用 CLI 配置、统一 UI、统一会话存档和统一配置读取接入
- 命令与参数读取 `sinitek-cli-tools.commands.opencode` / `sinitek-cli-tools.args.opencode`
- OpenCode 1.17.16 的根命令和 `run` 子命令都支持官方 `--auto`：自动批准未被显式拒绝的权限请求。插件在 `src/cli/commandRunner.ts` 的共享 OpenCode 参数构建路径集中注入并去重该参数，因此普通消息、one-shot、并行任务、Loop 主任务/子任务、续跑与唤醒统一获得 `--auto`，无 prompt 的终端启动则为 `opencode --auto`
- one-shot / 并行任务当前通过 `opencode run --auto --format json [message..]` 启动；插件运行时会把 prompt 作为 `run` 子命令消息参数，而不是根命令的 project positional，并从 JSON 事件中提取 assistant 文本生成最终结论气泡。例如：`opencode run --auto --format json --model <provider/model> --variant <variant> --session <sessionId> "<message>"`
- OpenCode 1.17.16 的 JSONL 顶层和 `part` 对象使用 camel-case `sessionID` 返回真实 `ses_*`；插件必须在首轮流式输出中接管该 ID，后续同一 tab 才能通过 `--session <ses_*>` 续接。`local_*` 仅是插件消息落盘占位 ID，禁止传给 OpenCode；历史 `local_*` tab 再次执行时先启动新底层会话，捕获真实 ID 后迁移插件消息和 tab 引用，不使用全局 `--continue` 猜测最近会话。
- `--auto` 在用途上对应插件为 Claude 提供的 `--dangerously-skip-permissions` 和为 Codex 提供的 `--dangerously-bypass-approvals-and-sandbox`，但安全语义并不等价：它只自动批准仍处于 `ask` 的请求。默认 `external_directory: ask` 因而可以自动跨目录读写；用户配置、agent 配置或 OpenCode 默认规则中的显式 `deny` 仍优先，插件不会用运行时 overlay 强制改写为 `allow`
- OpenCode 进程非零退出时也必须解析 stdout JSON `error` 事件；若事件中存在 `APIError` / `UnknownError`、HTTP status、provider message、server `ref`、`responseBody.error.code` 或请求 URL，错误气泡优先展示这些 provider/API 详情，仅在没有可解析错误时才回退 `CLI 退出码`
- OpenCode one-shot 单次尝试启动后若长时间没有 stdout/stderr 输出，会按 OpenCode 空输出超时错误收口并进入 hidden retry；hidden retry 最终耗尽时必须追加可见 system 错误气泡、写入会话存档并记录日志，不允许只留下 trace 或运行态
- OpenCode 当前不进入 `src/interactive/manager.ts` 管理的 Codex / Claude 交互 Runner；普通 AI 任务只读取 active config 内容，并为每次 `opencode run` 生成独立 runtime overlay，不会为对话运行改写用户真实 `~/.opencode/config.json`。
- OpenCode 配置中心只维护 `~/.opencode/config.json`，不再要求或生成 `~/.opencode/.env`；运行时以该单文件配置作为 OpenCode 当前配置来源
- 配置示例使用严格 OpenCode JSON 口径：`$schema=https://opencode.ai/config.json`、`model=provider/model`、`small_model=provider/model`、`provider`、`mcp`。配置页展示 `myAPI` OpenAI-compatible 双模型范例，provider 凭据使用官方 `{env:VARIABLE_NAME}` 语法，不要求或生成 `.env` 文件。
- `provider.<id>.npm` 选择的是 API 协议适配器，不是模型品牌。直接使用 OpenCode 内置 Anthropic / Google / OpenAI provider 时，通常通过 `/connect` 鉴权并使用 `anthropic/...`、`google/...`、`openai/...`，无需自定义 `npm`；需要手写自定义直连 provider 时，对应适配器分别是 `@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai`。只有请求实际 OpenAI-compatible endpoint 的自定义网关使用 `@ai-sdk/openai-compatible`；即使该网关承载 Claude、Gemini、DeepSeek 等模型，也仍按网关协议使用该适配器。
- OpenAI-compatible 自定义 provider 必须配置 `options.baseURL` 并指向实际兼容 API endpoint；缺少 `baseURL` 会在保存/运行前阻断，未以常见 `/v1` 结尾会继续给出校验提示。`model` / `small_model` 仍应使用 `provider/真实模型 id`；`models.<id>.name` 仅作为展示元数据，不能依赖它把占位 alias 改写成真实模型名。
- OpenCode 模式展示“主模型（model）”与“小模型（small_model）”两个下拉；候选只从当前 active config 的 `provider.<id>.models` 固定结构加载，值始终为精确 `provider/model`，不提供新增、编辑、删除、排序等模型管理入口。
- 普通对话、one-shot、并行任务、Loop 主任务和 Loop 子任务的对话请求仍使用主模型。`small_model` 只供 OpenCode 内部标题等轻量请求使用，不等同于 Loop 子任务模型；CLI 没有 `--small-model`，插件若临时切换小模型，只能通过本次运行的 runtime config overlay 覆盖顶层 `small_model`。
- primary/small 覆盖按 active config id 隔离，空值跟随顶层配置，配置切换或候选变化会清理失效覆盖；OpenCode 不读取通用 selected/options 或 Loop main/subtask 选择。
- overlay 同时固定 effective `model` / `small_model`，使用随机临时目录、`0700` 目录权限和 `0600` 文件权限，通过 `OPENCODE_CONFIG` 注入，并在 exit/error/timeout/cancel 后清理。
- OpenCode 角色选择只接受 active config 候选中的精确 `provider/model`；裸模型 id、跨 provider 猜测或不在 `provider.<id>.models` 的引用会在启动前拒绝，不能自动补全。
- OpenCode 运行前会对 effective primary、effective small 和 overlay 后配置做 preflight：缺少有效 primary、角色引用不是当前配置候选、provider/model 已被过滤或配置仍含占位值时阻止启动；OpenAI-compatible provider 缺少 `baseURL` 等未完成配置同样阻断。
- 配置中心不再自动或手动把 Claude / Codex 配置转换为 OpenCode 配置；OpenCode 配置列表只展示原生 OpenCode 档案。历史自动迁移档案不会被删除，但会从新的 OpenCode 配置列表中隐藏，避免继续刷新或复用旧转换项
- Claude 配置中心管理用户级 `~/.claude/settings.json`。卡片默认进入可视化模式，也可切换到 JSON 高级模式；模式切换和保存都会先校验 JSON/可视化状态，无效 JSON 不得清空或覆盖最后一次有效状态。可视化模式定向维护 `model`、`fallbackModel`（最多三个）、`availableModels`、`effortLevel`（`low|medium|high|xhigh`）、常用行为字段、权限规则、API/网关环境变量，以及 `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` 三档模型映射；所有未受管字段基于原始 JSON 保留。

#### OpenCode 动态 variants 与运行参数

- OpenCode 主模型的基础推理力度来自该模型 `options`，运行时档位来自该模型 `variants`，并由 `opencode run --variant <name>` 选择；`--thinking` 只控制 thinking blocks 是否展示，不能作为推理力度参数。
- 可选档位按以下优先级解析：当前命令/version 下 `opencode models <provider> --verbose` 返回的精确 `provider/model` metadata → 当前激活配置 `provider.<id>.models.<model>.variants` 中未禁用的显式声明 → Default-only。不得按 provider `npm`、provider 名或模型名猜测档位；`@ai-sdk/openai-compatible` 仅代表协议 adapter。
- `small_model` 可以在自身模型定义中同时声明 `options` 与 `variants`，但 OpenCode 内部 `small: true` 请求会跳过 variants，实际只使用小模型自身 `options`；只有该模型被当作普通主模型运行时，其 variants 才可由 `--variant` 选择。
- PanelState 每次携带完整 `openCodeThinking` 快照。配置 ID、配置内容 hash、命令、CLI version、provider 或 model 变化时会形成新的能力身份；解析中、失败或未知模型时立即保守显示 `Default / Follow OpenCode`，旧异步结果不得覆盖新模型状态。
- variant 选择按 active config id + 精确 `provider/model` 隔离持久化。空选择表示 Default 并删除持久值；保存值不再存在于当前 options 时会回退 Default 并清理，切换 CLI、配置或模型不会沿用旧 options。
- 运行时只在持久值仍属于当前精确模型 options 时追加 `--variant <name>`；Default 不传。若 `sinitek-cli-tools.args.opencode` 已显式包含 `--variant value` 或 `--variant=value`，显式参数优先，插件不重复覆盖。
- 固定的 `thinkingModeOpencode` 和 `thinkingArgs.opencode.*` 设置已移除；Codex / Claude 的固定 ThinkingMode 和参数映射保持原行为。

### Gemini

- Gemini 已从当前 AI 对话和配置中心支持范围移除
- 旧版 Gemini headless / stream-json 事实只作为历史迁移参考，不再作为当前支持 CLI 的验收口径

## 3.5 工具设置存储

- 工具设置中的全局项（`debug`、`autoAddEditorContextTags`、`locale`、`macTaskShell`）写入 `~/.sinitek_cli/settings.json`
- 工具设置中的项目级项（如 `autoCompactContextAfterRun`、`codexMultiAgentEnabled`、`lobsterExecutionModeByCli`）写入 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`；全局项（如 `lobsterMaxRounds`、`lobsterAutoCloseSubtaskTabs`）写入 `~/.sinitek_cli/settings.json`，历史工作区字段仅作为兼容回退读取。
- 工具设置“工作区”页中的 harness 骨架开关控制当前工作区基于 harness scaffold 的插件侧记忆层，默认关闭，并写入 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json` 的 `workspaceMemoryEnabled`。配置解析采用“显式 false 防误开优先”：兼容旧字段 `memoryEnabled=false`、`globalMemoryEnabled=false`、`workspaceMemoryEnabled=false` 命中对应作用域时，运行时必须关闭对应长期记忆行为。
- 用户开启该开关时，扩展先弹窗确认；确认后才补齐当前工作区 harness scaffold：`.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 的幂等追加模板、只引用 `AGENTS.md` 的 `CLAUDE.md`，以及忽略 `.codegraph/` 的根级 `.gitignore`；已有 `CLAUDE.md` 保持原样，已有 `.gitignore` 只补充缺失的 `.codegraph/` 条目。扩展激活、工作区切换和首次 recall / inject / 持久化不再无条件安装 scaffold。
- 确认初始化后，扩展会在当前工作区终端启动 `codegraph install --target codex --location global && codegraph init`，用于自动安装/初始化 CodeGraph；该过程可见且不阻塞工具设置保存。
- 骨架安装成功后，扩展会二次弹窗询问是否初始化 `ARCHITECTURE.md`；用户确认后，扩展侧把当前 AI 对话切到 `coding` 模式，并通过现有 `runPrompt` 链路复用当前 CLI 分组、配置和模型发起架构分析任务。用户取消时不影响 harness 开关保存或 CodeGraph 初始化。
- 长期记忆关闭后，插件只允许查看、导出和删除已有记忆；不得创建、更新、自动提取、召回、注入或更新 memory 目录元数据。关闭插件侧长期记忆不会关闭 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、压缩、配置或账号侧能力。
- 长期记忆热区位于当前工作区 `.ch/docs/memory/`，generated recall 产物位于 `.ch/docs/generated/memory-index/`。插件侧踩坑记录写入 `.ch/docs/runbooks/PITFALLS.md`。运行总结或失败回复中出现明确失败、阻塞、回滚、踩坑等信号，并伴随根因、规避或验证线索时，运行时可写入结构化坑点条目；这些条目会进入 generated recall 和 prompt 注入。该写入同样受长期记忆总开关限制。
- 自动提取还有二级条件：`memoryAutoExtractAfterCompact` 只允许 compact 成功后的提取，`memoryAutoExtractAfterLobsterTask` 只允许 Loop 任务完成后的提取；二者默认关闭，且必须在总开关和对应作用域开启时才允许新增或更新当前工作区 `.ch/docs/memory/` 与相关 generated recall。
- 运行时会兼容读取旧的 VS Code `sinitek-cli-tools.*` 配置值，但工具设置面板本身以 `~/.sinitek_cli/` 下的数据为主

## 4. 模式与参数映射

### thinking mode

插件对外暴露统一的 thinking mode，但实际映射按 CLI 各自处理：

- Codex：映射到 reasoning effort / 相关参数
- Claude：优先映射到 Claude Code `--effort`；旧版本兼容回退到 `maxThinkingTokens` 和 SDK 选项
- OpenCode：按插件通用 CLI 参数拼装接入；当前通过 `opencode run` one-shot / 并行路径执行，不声明交互 Runner 支持

### interactive mode

当前 AI 对话面板只暴露 `coding / lobster` 两种顶层模式；旧 workspace 配置中的 `plan` 会按 `coding` 兼容归一化。底层 runner 仍保留历史 `plan` 分支用于类型和旧数据兼容，但 Webview 不再产生该值：
- `lobster`：扩展侧编排的多轮主子任务模式；底层 CLI 权限按内部 coding（即 Vibe）模式执行，并按会话隔离写入 `~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json` 记录任务概要（首次主任务尚未拿到真实会话 ID 时先写入 pending 路径，拿到会话 ID 后自动迁移），同时通过 `~/.sinitek_cli/lobster-communications/<taskId>/` 组织沟通文件、activeSubtaskId、activeSubtaskIds、主任务 JSON 决策、acceptance 验收结果、预计剩余轮次和轮次状态，供扩展解析并以独立新会话启动子任务；工具设置支持配置新建 Loop 任务最大主任务复核轮次（默认 20，范围 1-100，已有任务保持记录值），以及“子任务成功完成后自动关闭 AI 对话标签页”开关（默认开启）；主任务每次复核应返回 `estimatedRemainingRounds` 预判剩余主任务复核轮次；`status=continue` 可返回旧 `subtask` 或新 `subtasks` 批次，扩展内部统一按批次处理；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，只有能确认 `writeFiles` / `conflictGroup` 互不重叠时才把多个子任务放入同一 `subtasks` 批次，同一批次最多 6 个；扩展会按声明的写入文件/冲突组自动规划组内并发、组间串行；单子任务时 UI 自动切换到子任务标签展示气泡和流式消息，多子任务批次会创建多个子任务标签并并发执行，只有批次内所有子任务都正常完成后才切回并唤醒主任务；参与者和主持人完成后可自动关闭临时 tab，后续复用记录里的 sessionId 续接同一角色会话；每次主任务返回 `status=continue` 时，扩展会把该轮 JSON 协议气泡原位替换成 Markdown 子任务派发摘要，并把摘要追加到 `main-task.md`；轮次按主任务复核轮计数，同一轮可包含一个或多个并发子任务；第 1 轮要求主任务先做总体阶段规划，再优先派发首批互不冲突子任务，不再默认只派发 1 个；Loop 模式下底部模型选择支持分别指定主任务模型与子任务模型，并可在“管理模型”里按模型配置“主任务/子任务”角色开关来限定候选模型；主任务必须读取沟通文件并把 subtasks[*].prompt 写成自包含详细指令，且在完成时返回 `answerConclusion`（直接回答用户原始问题）、整体总结、各轮子任务摘要与用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md` 和任务记录，并移除最终主任务 JSON 协议气泡，在 AI 对话主消息流中先追加 `lobsterAnswerConclusion=true` 的 assistant Markdown 问题回答结论气泡，再追加 `lobsterFinalSummary=true` 的 assistant Markdown 最终总结气泡；最终总结气泡会同时展示问题回答结论和 Loop 任务整体总结；只有主任务显式返回 `status=completed`（且 `acceptance.passed=true`）才结束；主任务中断后支持在同一标签输入“继续/continue/resume”等短提示词恢复同一任务并从当前轮次继续；子任务完成前必须写入自己的沟通文件；子任务执行出错会等待 1 分钟后重试，最多重试 5 次，主动停止不重试；子任务中断后在子任务标签手动继续时会强制按内部 coding（即 Vibe）任务执行，不允许再次启动 Loop 任务；`lobster-tasks` 与 `lobster-communications` 产物同样按 30 天保留策略清理

Loop 内部执行方式事实：

- `lobsterExecutionModeByCli` 按 CLI 记忆 Webview 下拉；`sendPrompt.lobsterExecutionMode` 只在顶层 `interactiveMode=lobster` 时使用。合法值为 `main_sub_multi_agent` 和 `debate_multi_agent`；缺失或非法值回落到 `main_sub_multi_agent`。新建 `LobsterTaskRecord` 会写入 `executionMode`，老任务缺字段时按 `main_sub_multi_agent` 归一化，恢复任务时不使用当前 UI 下拉覆盖记录值。
- `main_sub_multi_agent` 会在 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，任务开始或恢复气泡会带“打开 Loop 群聊”动作；通用群聊面板把主任务和动态加入的子任务 1~N 作为成员展示，主任务决策、子任务加入、子任务完成和批次完成会追加为时间线气泡；子任务成功完成的气泡正文是该子任务最终回复，运行状态、单测/编译状态和判定依据继续落在任务记录与子任务沟通文件中，并根据 activeSubtaskId / activeSubtaskIds 显示当前主任务或子任务“思考中”。`debate_multi_agent` 也复用同一个面板：面板把红蓝对抗 `debates/round-*/chat.md` 和共识通过后的根部 `group-chat.md` 合并为单条时间线，主任务轮次、发言批次和执行阶段只作为系统消息显示，不再提供轮次切换；同一 `lobsterTaskId` 存在运行进程时面板显示“中止”按钮，点击后停止主任务、子任务、裁判主持人、参与者和共识汇总器等相关运行并把任务标记为 stopped；未完成且无运行进程时才显示“继续执行”按钮，两者互斥。任务进入 `needs-review` / `error` / `stopped` 时，面板末尾追加虚拟的 `主持人停止说明` error 样式气泡，用任务 `finalSummary`、共识摘要和决策状态说明停止原因，不写回原始 transcript。命令 `sinitek-cli-tools.openLobsterDebateChat` 保持兼容命名，但可打开任意 Loop 任务的群聊面板；找不到当前任务时会列出最近的 Loop 任务。
- `LobsterTaskRecord.debateRounds` 记录红蓝对抗轮状态、`chat.md` 路径、`moderator-participants.md` 路径、动态参与者 artifact、参与者 sessionId、裁判主持人控场记录、裁判主持人 sessionId、共识和决策摘要。`debate_multi_agent` 每个主任务复核轮在 `~/.sinitek_cli/lobster-communications/<taskId>/debates/round-<lobsterRound>/` 下生成 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/<participantId>-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/<participantId>.md`、`cross-review.md`、`consensus.md`、`decision.json`。参与者和裁判主持人的临时 tab 回答完成后可按自动关闭设置关闭，下一批次同一角色通过记录的 sessionId 新建临时 tab 续接。
- `debate_multi_agent` 先启动裁判主持人红蓝组队阶段。裁判主持人读取 brief、任务记录和沟通文件后写入 `moderator-participants.md`，动态设计 2-6 个参与者；新清单的 `role` 只能是 `blue_team` 或 `red_team`，且必须至少包含 1 个蓝队和 1 个红队。蓝队负责提出、捍卫和修正方案，并补足约束、验收口径和证据要求；红队负责攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性。只有任务涉及代码、文件、权限、部署或流程执行时，红队才额外检查写入范围、并发冲突、越权修改、回滚/恢复失败和工程验收风险。扩展校验唯一 id、合法 role、title/focus 非空后，把 `## 参与者加入：<title>（<id>）` 追加到 `chat.md`。参与者和裁判主持人都以临时普通对话 tab 运行，不写 `taskRole=main/subtask`，只能写本次提示词指定的 artifact；每个发言批次开始时扩展先追加 `## 任务事件` 系统消息说明主任务轮次、当前发言批次和最大安全发言批次数；同一发言批次内参与者并行运行，各自写独立 artifact，扩展等待全部完成后再按动态清单顺序把发言追加到 `chat.md`，随后启动裁判主持人控场。裁判主持人每批次输出 `continue / finalize / block`：`continue` 表示红队攻击尚未被蓝队回应或蓝队新方案尚未被红队攻击，`finalize` 会并行进入最终立场收集，`block` 会在写入最终立场和收束标记后进入人工复核。运行时保留最大安全发言批次数作为防无限循环兜底，达到上限后强制收束，不再继续追加讨论。
- 共识汇总器读取 `brief.md`、完整 `chat.md` 与所有动态参与者最终 artifact，生成 `cross-review.md`、`consensus.md` 和纯 JSON `decision.json`。恢复 `debate_multi_agent` 任务时，若当前轮已有完整有效的 `chat.md`（含参与者加入、裁判主持人控场与 `## 群聊收束` 标记）、`decision.json`、`consensus.md` 和动态参与者最终 artifact，且共识校验允许继续，运行时优先复用 `decision.json`，再交给现有 `applyLobsterMainDecision`。如果旧产物缺少裁判主持人控场、`chat.md` 或收束标记、产物缺失或不可解析，会重跑当前辩论轮；如果已有共识显示未解决阻塞，则进入 `needs-review`。
- 缺少或无法写入 `brief.md` / `chat.md`、裁判主持人红蓝参与者清单缺失或非法、任一群聊发言 artifact 缺失、裁判主持人 artifact 缺失或无法解析、最终参与者 artifact 缺失或立场不可解析、裁判主持人输出 `block`、共识后的最终参与者立场仍为 `block`、未解决 `blocking` disagreement、缺少 `cross-review.md`、`consensus.md` 不含合法共识 JSON、`decision.json` 非法、或 `status=continue` 但无合法 `subtasks` 时，运行时不派发子任务，清空 activeSubtask 字段，把任务更新为 `needs-review`，并向主 tab 系统消息和 `main-task.md` 记录原因。若 `consensus.md` 已达成但仍包含未解决阻塞，主 tab 和 `main-task.md` 应按“红蓝对抗达成阻塞共识”记录，并同步共识摘要、`decision.finalSummary` 和 `decision.estimatedRemainingRounds`，避免沿用上一轮剩余轮次造成误判。参与者 artifact 的原始 `block` 可由下一轮裁判主持人追问、蓝队修正或共识汇总器通过 `resolvedDisagreements`、前置子任务、验收标准或风险说明解决；运行时以 `consensus.md` 中的最终 `participantStances` 和 `openDisagreements` 做派发判定，缺失的 participant stance 才用 artifact stance 补齐。

运行结束判定补充：普通 Codex / Claude / OpenCode 任务发给模型的首轮 prompt 和 hidden retry prompt 都会追加统一约定，要求任务完成后的最终回复以 `[final_answer]` 开头，过程更新不得使用该标记；界面和会话存档中的用户消息仍保留原始输入。Loop 主任务/子任务等内部机器协议显式关闭该注入和严格文本标记要求，继续依赖自身纯 JSON 决策、`status=completed` 与专用结论气泡，避免协议前缀破坏解析。普通任务只有在本轮用户消息之后产生符合当前策略的非 thinking assistant 最终结论气泡，才会按成功完成收口。Codex 显式 app-server `phase:"final_answer"` 会立即在消息上标记 `codexFinalAnswer=true`，优先级最高；缺少结构化 final 类型时，共享判定会把内容包含 `[final_answer]` 的非 thinking assistant 消息视为显式最终答复。默认 `strict_final_answer` 只接受结构化 final 或文本标记；`successful_reply_fallback` 额外接受成功退出后的普通非空 assistant 文本，其中 Codex 收到 `turn.completed status:"completed"` 时会发送空内容终态标记，把最后一条 assistant 气泡原位提升为最终结论，不复制正文或新增气泡。thinking、trace、system、user、旧回合消息、空回复、`failed`、`interrupted` 和主动停止都不得通过该 fallback 收口。OpenCode one-shot / 并行任务优先解析 `--format json` 文本事件，只把 stdout assistant 正文纳入判定，不把 `> build · model` 等 stderr 状态行当作结论；OpenCode 非零退出、JSON error、空 assistant、长时间无输出超时和重试耗尽最终都追加可见 system 错误气泡并落盘，provider/API 详情优先于通用退出码。其它缺少最终气泡的可续接 CLI 回合沿统一 hidden retry 配置隐式发送“继续”，每次重试前展示错误 trace 和排队提示，真正开始时再追加开始提示并恢复标签运行态。Loop 任务仍额外要求主任务对话同时存在 `lobsterAnswerConclusion=true` 的问题回答结论气泡和 `lobsterFinalSummary=true` 的最终总结气泡；记录已完成但任一气泡缺失时会恢复同一任务并再次唤醒主任务。

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

1. 先用 `where codex` / `where claude` / `where opencode` 验证命令
2. 必要时把命令配置成绝对路径
3. 修改 PATH 后重启 VS Code

### macOS

如果默认 shell 环境与 VS Code 环境不一致，可切换：

- `sinitek-cli-tools.macTaskShell = zsh`
- `sinitek-cli-tools.macTaskShell = bash`

### OpenCode 1.17.16 全局 MCP

- OpenCode local MCP 的非交互安装参数为 `opencode mcp add <id> [--env KEY=VALUE ...] -- <command> [args...]`；`--` 是 CLI 参数与 MCP 命令的分隔符。
- OpenCode remote MCP 的非交互安装参数为 `opencode mcp add <id> --url <url> [--header KEY=VALUE ...]`；header 使用 `KEY=VALUE`，不能复用 Claude 的 `Header: value` 形式。
- OpenCode 不接受 Claude 风格的 `--scope user`、`--transport stdio|http|sse`。在 1.17.16 中传入这些参数会退出失败，且不会完成 MCP 安装。
- 全局 MCP 写入 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 的顶层 `mcp`；CLI 更新目标条目时会保留其他顶层字段和已有 MCP。
- `opencode mcp list --pure` 的退出码只表示列表命令执行完成，不表示每个服务连接健康。服务显示 `failed` 时命令仍可能退出 `0`；只要目标 id 出现在列表中，插件应保持 `installed: true`，并把失败状态映射为 `unhealthy`。未出现在列表中的市场条目才是未安装。
- 2026-07-10 的隔离组合 smoke 使用 OpenCode 1.17.16，在同一临时 `HOME` / `XDG_CONFIG_HOME` 中分别安装 local 与 remote MCP，两次安装均退出 `0`，配置保留断言通过；随后真实列表输出中的两个失败条目均被解析为“已安装但不健康”。

## 8. 更新本文档时的原则

只有下面两类内容应进入这里：

- 当前仓库已经落地、可被代码验证的行为
- 对使用者排障有高价值的运行事实

不要把未来方案、未实现提案或纯猜测放进来；那类内容应进入设计文档或技术债跟踪。
