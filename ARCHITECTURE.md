# 项目架构说明

本仓库是一个 **VS Code 插件单仓**，用于在编辑器内统一接入本地 CLI（Codex / Claude / OpenCode），并提供聊天面板、配置中心、会话管理与本地状态持久化能力。

更详细的运行时设计见：

- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## 1.1 Harness 与事实来源边界

- `AGENTS.md` 只承载稳定规则、任务路由和项目入口；详细流程回到 `.ch/docs/`、`.agents/skills/` 或局部 `AGENTS.md`。
- `.ch/docs/` 按主题承载测试、安全、工具、Ontology、产品规格、记忆、执行计划和 runbook；同一事实只保留一个主要来源。
- `media/workspace-scaffold/` 是新工作区的通用模板，不是当前仓库事实的覆盖层。同步时先做差异盘点，再手工合并通用规则；现有项目代码、记忆、生成索引和执行计划优先保留。
- `.ch/docs/memory/` 和 `.ch/docs/exec-plans/` 的现有内容是跨会话上下文与历史记录，模板升级不得清空、替换或重排它们。
- 生成文件只能作为可重建的导航或召回面，不能替代原始 Markdown、JSON、代码、测试和运行时验证。

## 1. 当前实际结构

```text
.
├── AGENTS.md
├── ARCHITECTURE.md
├── README.md
├── package.json
├── src/
│   ├── extension.ts          # 扩展入口、命令注册、状态编排
│   ├── extensionHost/        # 扩展宿主侧运行时 host 与组合根拆分
│   ├── cli/                  # CLI 设置读取、命令解析、进程执行
│   ├── interactive/          # Codex / Claude 交互 Runner 与会话映射
│   ├── webview/              # 聊天面板、配置中心、前后端协议
│   ├── config/               # 本地配置档案；配置中心 Skills 管理 Claude、OpenCode、Grok、Codex、DSH、Kimi Code、ZCode 七个全局目录，不再提供 MCP 管理
│   ├── graph/                # Graph 运行图、调度、边语义与节点控制
│   ├── shared/               # 跨 CLI/config/Graph 复用的纯工具
│   ├── trace/                # trace/tool 输出格式化
│   ├── loopDebate.ts         # Loop 辩论路径、记录与共识校验纯函数
│   ├── loopSubtaskExecutionRoot.ts # Loop 子任务规则隔离执行根
│   ├── loopTaskStore.ts      # Loop 任务记录持久化
│   ├── i18n.ts               # 固定简体中文文案
│   ├── logger.ts             # 日志
│   └── errorDisplay.ts       # 错误展示
├── media/
│   └── config/assets/        # 配置中心静态资源
├── docs/                     # 兼容入口文档，详细内容已迁移到 .ch/docs/
└── .ch/docs/                 # 事实来源文档体系
```

## 2. 分层边界

### 2.1 推荐依赖方向

```text
webview UI
    ↓
extension.ts 组合根 / extensionHost 运行时 host
    ↓
cli / interactive / config 服务层
    ↓
本地文件系统 / 本地 CLI / 外部 SDK
```

### 2.2 各层职责

#### Webview/UI 层

- 位于 `src/webview/`
- 负责渲染聊天面板、配置中心、输入交互和消息协议
- 不直接访问文件系统，不直接执行 CLI
- 主对话与 Loop / Loop+ 群聊复用 `chatMarkdown.ts` 的浏览器侧 Markdown、JSON、SVG 和图片交互运行时；`markdownAssets.ts` 统一加载 Marked / JSONFormatter，`viewContentStyles/markdown.ts` 提供可按容器复用的主题样式。
- `chatImageHost.ts` 在扩展宿主侧统一承接图片解析、预览和下载，由 `viewProvider.ts` 与 `loopDebatePanel.ts` 各自绑定当前 Webview，防止异步结果写入已替换或关闭的页面。

#### 扩展编排层

- 以 `src/extension.ts` 为核心
- 负责命令注册、状态管理、消息分发、会话与标签页编排
- 不应承载具体 CLI 协议细节和配置文件读写实现
- 当前 `src/extension.ts` 是组合根，保留 activate/deactivate、命令与视图注册、Graph/Loop/session/model/config host 装配和跨运行时生命周期适配；Webview 消息所需的 VS Code 能力在此组装为显式端口
- `src/sessionMessageRouter.ts` 只负责类型安全的消息到处理器分派和领域 Registry 合并，不承载业务分支
- `src/panelMessageHandlers/` 按 diagnostics、session、prompt、workspace 领域拆分消息处理器；每个处理器通过 `Pick<PanelMessageHandlerDeps, ...>` 声明最小依赖，避免接收完整组合根依赖
- `src/sessionMessageHandlers.ts` 保留兼容的统一入口，仅负责初始化会话存储、记录调试日志并调用 Router；新增消息应进入对应领域 Registry，而不是继续堆积条件分支
- 本次运行时抽取后，`src/extension.ts` 为 5659 行；3000 行以下是期望指标而非硬性边界，后续继续拆分必须按职责内聚推进

#### 扩展运行时 Host 层

- 位于 `src/extensionHost/`
- `promptAutoRepair.ts` 在统一 `runPrompt` 分流外管理任务级命令修复与单次新会话重放，按 Tab 处理取消和任务替代；复用 `cliCommandRepair.ts` 的命令发现及组合根持久化，第二次执行关闭各 runtime 的 hidden retry，旧会话历史由生命周期层保留。
- `openCodePromptRunTemplate.ts` 用显式端口 Template Method 固定 OpenCode attempt 顺序。`runOpenCodePromptTemplate` 接收 `OpenCodePromptRunPorts`，由 one-shot 与 parallel 工厂在调用点构造端口；不使用类继承、DI 容器或 `mode` 旗标。当前 705 行
- `promptOneShotRuntime.ts` 承载 OpenCode one-shot 运行、JSONL stream 解析、hidden retry、fresh-session recovery、任务列表、子代理进度消费、长期记忆触发和自动压缩触发。attempt 顺序交给上述模板；工厂签名仍是 `createPromptOneShotRuntimeHost(deps: PromptOneShotRuntimeHostDeps)`。运行身份（`getActiveRunId() === runId`）和启动空闲超时留在本 host。当前 1193 行
- `promptParallelRuntime.ts` 承载 OpenCode parallel tab 运行、tab 定向 JSONL stream 映射、hidden retry、fresh-session recovery、任务列表、子代理进度消费、长期记忆触发和自动压缩触发。attempt 顺序交给上述模板；工厂签名仍是 `createPromptParallelRuntimeHost(deps: PromptParallelRuntimeHostDeps)`。运行身份与 tab 流留在本 host，不补 one-shot 启动超时。当前 1078 行。parallel 终态 `TaskRunRecord` 通过统一 helper 写入，`end` / `error` / `stopped` 均保留 Loop 与 Graph 追踪字段
- `promptInteractiveRuntime.ts` 承载 interactive attempt 顺序、收口、session adoption、停止、消息持久化、subagent progress、hidden retry 和 final answer 判定。Codex、Claude、Grok 的 runner 生命周期和流事件映射分别在 `interactiveTurnCodex.ts`、`interactiveTurnClaude.ts`、`interactiveTurnGrok.ts`，由 `interactiveTurnStrategy.ts` 的显式注册表提供。工厂签名仍是 `createPromptInteractiveRuntimeHost(deps: PromptInteractiveRuntimeHostDeps)`。没有类继承，也没有 DI 容器。当前 1276 行
- `cliModelSelectionStrategies.ts` 用显式 `Record<CliName, CliModelSelectionStrategy>` 收拢 Codex、Claude、OpenCode、Grok 的普通选择、main/subtask 角色选择、候选、可管理候选、下一份 store、持久化键和展示名。`createCliModelSelectionStrategies` 每次操作接收当前 `CliModelStore`；Grok 配置按原始 config id 现查注入的缓存，缺省存储键也在操作时向注入的 resolver 取值，工厂不捕获 store 或缓存快照。Codex、Claude、OpenCode 委托 `modelSelectionStore` 既有函数。策略不导入 VS Code、配置服务、文件系统、Webview 或日志，也不写盘。`modelSettings.ts` 仍负责活跃配置、读盘缓存、错误日志、`writeModelStore`、deps 同步和 PanelState。用户可见模型选择不变。事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-22-cli-model-selection-strategies.md`
- `loopOrchestration.ts` 承载 Loop 主从与红蓝辩论编排 host，依赖注入类型必须显式、可搜索，不使用宽泛 `Record<string, any>` 作为事实边界；当前 3092 行
- `openCodeSubagentRuntime.ts` 承载 OpenCode 子代理 server attach / managed startup / ready wait / Basic auth env override / unavailable fallback 和 disabled monitor；当前 201 行
- `primaryPromptRunController.ts` 集中维护主 Prompt 的运行身份、进程、停止回调、会话目标、消息目标、trace 和任务状态；`extension.ts` 只负责组合根副作用与显式接线，避免 One-shot、上下文压缩、停止和 deactivate 分散读写同一组模块级状态
- `promptExecutionShared.ts` 只保存提示运行 host 共享的窄类型；当前 59 行
- `loopTaskStateMachine.ts` 只计算 Loop 主决策、停止和运行中断的下一次状态；`promptRunRuntime.ts` 消费该结果并执行原有副作用。它不是 UI，也不是 `loopTaskStore` 持久化层
- 依赖方向固定为 `extension.ts` 导入 host 并注入显式回调，host 可以依赖 `cli/`、`interactive/`、`promptRunState` 等服务与类型，但不能反向依赖 `extension.ts`

#### Loop 生命周期状态转移

- 这是维护性重构：不新增用户可见能力，不改变 Loop/Loop+ 决策协议，也不改变 `LoopTaskRecord` 持久化 schema。已核对 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，终端可见的任务、群聊、澄清和停止行为没有变化，因此不更新功能清单。
- `loopTaskTransitionStrategies` 按主决策 `completed` / `clarify` / `blocked` / `continue` 注册；停止和运行中断只按 `classic` 与 `event_driven` 注册。未知主决策回落到 `continue`。只有 `schedulingMode === "event_driven"` 走 Loop+ 策略，未设置时仍走 classic。不引入 DI 容器、继承层级或新的 mode 旗标。
- 策略返回下一状态、`LoopTaskRecord` patch、子任务或辩论成员更新，以及 host 可执行标志。模块不导入 VS Code、文件系统、日志或面板 API，也不调用 `buildNextLoopMainAiFailureState`。
- host 边界留在 `promptRunRuntime.ts`：`applyLoopMainDecision` 写任务存储，并仅在 `appendDecisionMessages` 时追加沟通文件和子会话消息；`markLoopTaskInterrupted` 先中止澄清，event_driven 再停止 Loop+ 父任务，classic 主任务 error 才由 host 计算失败次数并合并 `loopInterruptFailureLimitPatch`；`markLoopTaskStopped` 在缺失或已完成时直接返回，否则写 patch，并按标志中止澄清、刷新已打开群聊。`createPromptRunRuntimeHost` 的公开方法名不变。
- 兼容不变量：`completed`、`blocked` 和超限 `clarify` 清空活动子任务；未超限 `clarify` 保持 `running` 并递增 `clarificationCount`；无子任务的 `continue` 进入 `needs-review` 且不追加决策消息；有子任务的 `continue` 保留 `activeSubtaskIds`。classic 停止把活动、running 或 pending 子任务写入 `blocked`，把仍活跃的辩论轮次和参与者写入 `stopped`，并清空活动子任务；event_driven 停止和中断不把活动子任务或辩论快照写入 patch。已完成任务再次停止幂等。策略不拼接路径，Windows、macOS 和 Linux 的既有副作用顺序不变。
- 回归入口：`src/test/extensionHost/loopTaskStateMachine.test.ts`、`src/test/extensionHost/loopMainDecisionParsing.test.ts`、`src/test/extensionHost/extensionHostExtractionContracts.test.ts`；失败计数算法仍由 `src/test/loop/loopMainFailure.test.ts` 覆盖。先 `npm run build`，再 `node --test dist/test/extensionHost/loopTaskStateMachine.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js`。详细事实来源见 `.ch/docs/design-docs/vscode-cli-extension-runtime.md`。

#### CLI / Interactive / Config 服务层

- `src/cli/`：一次性执行与命令解析；配置化 CLI command string 的拆分边界在 `src/cli/commandResolution.ts`，`commandRunner.ts`、MCP 命令调用等路径只复用该结果
- `src/cli/cliRunArgStrategies.ts` 用显式 `Record<CliName, CliRunArgStrategy>` 注册 Codex、Claude、OpenCode、Grok、DSH 的启动参数差异。`buildCliArgs` 仍从 `commandRunner.ts` 导出。参数顺序留在外观函数：基础参数、按 `includeThinkingArgs` 拼接 thinking、模型、隔离、`applyBeforePrompt`，空 prompt 立即返回，否则 `appendPrompt`。各平台各自实现差异，没有类继承，也没有 DI 容器。DSH 策略只保留明确 `--patch`，不把 one-shot prompt 写成已验证启动参数。`wc -l` 当前 `cliRunArgStrategies.ts` 为 219 行，`commandRunner.ts` 为 528 行。事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-cli-run-arg-strategies.md`
- `src/cli/openCodeRunOutput.ts` 承载 OpenCode 输出解释。该纯解析模块集中 JSONL、可见事件、活动跟踪、session/message id、export 文档选择、最终正文和失败文案，只依赖 `thinkingMarkup`、`boundedText`、`openCodeTaskList` 和 `opencodewatchdog`。`commandRunner.ts` 作为 Facade 保留进程、终端、runtime overlay、停止和 `recoverOpenCodeMissingAssistantOutput`；`opencode export` 的 `captureCliOutput` 副作用与 `OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS` 留在该外观。公开解析符号仍从 `commandRunner.ts` 再导出。`wc -l` 当前 `openCodeRunOutput.ts` 为 1033 行，`commandRunner.ts` 为 528 行。测试入口是 `src/test/cli/openCodeRunOutput.test.ts`。事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-opencode-output-parser-facade.md`
- `src/interactive/`：会话型运行与底层续接 ID 映射
- ZCode 0.17.0 使用独立 ZCode Protocol（`zcode app-server --stdio`），不是 ACP。实现在 `src/interactive/zcodeAppServerProtocol.ts` 与 `src/interactive/zcodeRunner.ts`。用户供应商配置是 `~/.zcode/v2/provider_config.json`。
- `src/interactive/manager.ts` 仍是交互 Runner 的公开 Facade。`InteractiveRunnerManager` 保持无参构造，公开方法名、参数含义和同步返回类型不变。原先 562 行的类把 Codex、Claude、Grok 的构造、复用、`setRunner` 元数据和共享 Map / idle timer 写在一起；现在平台差异在 `src/interactive/runnerLifecycleStrategies.ts`，类型在 `src/interactive/runnerLifecycleTypes.ts`。四个 `getOrCreate*` 只把策略交给同一个查找、判断复用、更新或先释放再创建、注册、touch 流程。DSH 使用独立策略，启动固定 `dsh --profile acp`，恢复走 `session/resume`，不复用 Grok 的 `session/load`。Manager 独占 entries Map、`${cli}:${sessionId}` 键、注册替换删除、dispose、touch、活动状态和 24 小时 idle timer。策略不建缓存或定时器，也不导入 manager。用显式策略而不是继承，是因为缓存和释放顺序必须只有一份；子类各自持有生命周期会把同一条流程拆开。新增平台时增加一份策略、对应创建参数和一个薄入口，不要复制 Map 或 timer。OpenCode 仍不进入该缓存。当前 `manager.ts` 344 行，`runnerLifecycleStrategies.ts` 338 行，`runnerLifecycleTypes.ts` 164 行。`RunnerRegistration` 对联合按平台成员分布：`cli: "codex"` 绑定 Codex runner 和 `configId`，`cli: "claude"` 绑定 Claude runner 和 `isolateProjectInstructions`。同一套查找、复用或先释放再创建、注册、touch 流程用同一个 CLI 类型参数绑定 entry、runner、工厂和注册结果。公开 `setRunner` 仍接受不关联的 CLI 与 runner 联合，只在 Facade 内按 `cli` 分派。编译期负例由 `manager.test.ts` 用 TypeScript 虚拟文件诊断覆盖。测试入口仍是 `src/test/interactive/manager.test.ts` 与 `src/test/interactive/runnerLifecycleStrategies.test.ts`。用户可见会话行为不变。事实来源见 `.ch/docs/references/cli-runtime-reference.md` 与 `.ch/docs/exec-plans/completed/2026-10/2026-10-22-interactive-runner-lifecycle.md`
- Grok 的 `grokToolCallStream.ts` 在当前 prompt 内按会话与调用 ID 聚合工具，规范化已知输出后分别生成回放终态和聊天摘要；`grokReplayStream.ts` 管文本合并与通知降噪，宿主复用 traceSegment 同 ID 更新和任务列表。Webview 活动时间独立于回放条目，不将高频协议通知持久化为聊天消息。
- `src/config/`：外部 CLI 配置、全局 Skills 目录和本地配置档案管理；配置中心不再把 MCP 市场作为用户功能。用户级配置路径由 `src/config/configPaths.ts` 集中维护，legacy `gemini` 配置平台仅兼容归一到 `opencode`
- `src/config/cliRuntimeConfigStrategies.ts` 用显式 `Record<CurrentConfigPlatform, CliRuntimeConfigStrategy>` 注册 Claude、Codex、OpenCode、Grok、DSH。策略集中运行配置的 `readCurrent`、`apply`、`backup`，以及默认档案初始字段和读取失败回退字段。`createCliRuntimeConfigStrategies` 接收五个平台各自的窄 IO 端口，在操作时调用 `configService` 注入的原有读取、写入和备份函数。DSH 激活写入隔离 profile，不改 `~/.dsh` 的 `settings.yaml`、`.credentials.yaml` 或 `config.toml`。策略模块不导入 `configService` 或 VS Code，不在 import 时捕获 `HOME`、`CONFIG_PATHS` 或 `GROK_HOME`，也不引入继承层级、DI 容器或另一套配置模型
- `configService` 保留兼容外观：既有导出名称、参数、返回形状和异常传播不变，档案 CRUD、复制、顺序、OpenCode 校验工具和 Skills 外观仍留在原模块。`getCurrentConfig`、`applyConfig`、`backupConfig` 只按 `normalizeConfigPlatform` 的结果委托策略；未知平台仍由归一化函数拒绝。`initDefaultConfig` 保留档案存在性判断、ID、名称、时间和 `saveConfig`，只把平台字段构造交给策略，并且只捕获读取或初始字段构造失败。Grok 路径仍在操作时解析 `GROK_HOME`。本次不改变用户可见配置行为，事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-cli-runtime-config-strategies.md`
- `src/shared/`：跨服务层复用、无 VS Code 依赖的纯工具；当前包含 strict/jsonc JSON object 解析等后端共用逻辑
- 这一层负责和本地 CLI、SDK、home 目录配置打交道，但不负责 UI 渲染

#### Graph 编排层

- 位于 `src/graph/`
- 负责 Graph run 类型、store、communications、events、scheduler、edge semantics、prompt builders、node lifecycle 和 run control
- `src/graph/graphEdgeSemantics.ts` 是 active structural/blocking edge 与 rework trigger edge 的共享语义边界，scheduler 和 prompt topology 必须复用它，避免节点上下游、review scope 与调度 gate 口径漂移

#### 基础本地资源层

- 包括 `~/.sinitek_cli/`、`~/.codex/`、`~/.claude/`、`~/.opencode/` 和 OpenCode 官方全局 MCP 配置 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json`；`~/.gemini/` 仅作历史迁移参考
- Loop 模式的任务记录位于 `~/.sinitek_cli/loop-tasks/`；主子任务沟通和辩论 artifact 位于 `~/.sinitek_cli/loop-communications/`
- Graph 模式的 run store、`graph.json`、`events.jsonl` 和节点 communication artifact 位于 `~/.sinitek_cli/graph-*` 相关目录；新 Graph run 默认 direct 执行，不创建 worktree/checkpoint
- 首次枚举 Loop 任务时，`src/loopLegacyMigration.ts` 与 `src/loopTaskStore.ts` 会把旧 Lobster 任务存储和通信目录迁入上述 Loop 路径；新写入不再使用旧命名，冲突 artifact 以 `.pre-loop-migration` 后缀保留
- 属于运行时依赖或本地状态，不属于 UI 和业务编排层

#### Loop 子任务执行隔离

- Loop 主任务保持真实工作区作为 cwd，按各 CLI 的默认机制读取项目规则。
- `src/loopSubtaskExecutionRoot.ts` 为每个 Loop 子任务创建临时根目录，只链接可工作内容，隐藏根 `AGENTS.md`、`CLAUDE.md`、`.agents`、`.claude`、`.codex`；写入仍通过链接回到真实工作区。Windows 使用目录 junction 与文件 hardlink，跨盘时把临时根放到工作区 `.sinitek-loop-tmp`。结束或创建失败时，只非递归移除本次登记且身份匹配的链接，再移除空临时根；根目录或链接被替换、存在未知内容或清理失败时保留现场并记录日志，不递归删除执行根，也不把成功任务改判失败。
- 子任务调用还叠加 CLI 级隔离：Codex 使用 `--ignore-rules`，Claude SDK 使用空 `settingSources`，OpenCode 使用 `--pure`。子任务只遵循主任务传入的自包含授权、沟通文件与最小必要验证要求。
- 不再分发、加载或注入 Loop Workflow Skill 快照，也没有对应的工具设置开关。

- 子任务可以绑定另一个 CLI 分组当前选中配置。路由身份在 `src/subtaskCliRoute.ts`，可选 `cli` / `configId` 扩展现有 Loop `modelRouting.subtask` 与 Graph `modelRouting.executor`。经典 Loop 用该 CLI 创建独立子 Tab；Loop+ attempt 的 `targetCli` 使用同一绑定；Graph 只让 executor 节点切换执行 CLI，plan / summary 仍走 planner。主任务 target、会话和存储归属不变。跨 CLI 不回退主模型、主配置、主会话、主思考档或 OpenCode variant。

## 3. 扩展规则

### 新增一个能力时怎么放

1. 只是设置读取、命令拼装、执行捕获：放 `src/cli/`
2. 需要会话复用、thread/session 恢复：放 `src/interactive/`
3. 需要管理外部 CLI 配置或全局 Skills：放 `src/config/`
4. 只是面板交互、展示或协议字段：放 `src/webview/`
5. 需要打通整条链路时，在 `src/extension.ts` 接线；若是提示运行的连续状态机，优先放到 `src/extensionHost/*Runtime.ts` 并由 `extension.ts` 注入依赖
6. 只是 Loop 辩论记录、路径或共识校验纯函数：放 `src/loopDebate.ts`，不要反向依赖 VS Code API 或 Webview
7. 只是 Graph 边/调度/节点控制语义：放 `src/graph/` 内的专门模块；跨 scheduler 和 prompt builder 的边语义优先集中到 `graphEdgeSemantics.ts`
8. Loop 主决策、停止和运行中断的状态计算放 `src/extensionHost/loopTaskStateMachine.ts`；任务存储、沟通文件、聊天消息、clarification abort、群聊刷新、日志和主任务失败计数留在 `src/extensionHost/promptRunRuntime.ts`。不要把状态转移模块写成 UI 或数据库层

### 新增文档时怎么放

- 运行事实、手册：放 `.ch/docs/runbooks/` 或 `.ch/docs/references/`
- 设计和模块边界：放 `.ch/docs/design-docs/`
- 用户可见能力与范围：放 `.ch/docs/product-specs/`
- 多阶段任务：放 `.ch/docs/exec-plans/`

## 4. 明确禁止

- 在 Webview 中直接拼接文件系统或 CLI 调用逻辑
- 把 Codex / Claude / OpenCode 的协议分支散落在多个 UI 文件中
- 在多个模块重复维护同一份本地状态格式
- 将配置中心实现和聊天面板 DOM 逻辑直接耦合
- 在未批准时改动技术栈或替换核心依赖
- 把 `loopTaskStateMachine.ts` 写成 Webview/UI 或 `loopTaskStore` 持久化层，或在策略模块里直接写存储、消息、面板和日志

## 5. 维护要求

出现下面情况时，必须同步更新本文件或对应 `.ch/docs/` 文档：

- 目录分层发生变化
- 新增独立运行面板或新的执行链路
- CLI 接入方式发生变化
- 本地状态目录、配置管理方式、文档事实来源发生变化

保持这份文档短、准、可导航；详细知识沉淀到 `.ch/docs/` 对应主题文档。
