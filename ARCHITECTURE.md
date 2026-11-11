# 项目架构说明

本仓库是一个 **VS Code 插件单仓**，用于在编辑器内统一接入本地 CLI（Codex / Claude / OpenCode），并提供聊天面板、配置中心、会话管理与本地状态持久化能力。

更详细的运行时设计见：

- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/design-docs/config-center-request-commands.md`：配置中心实例级 24 动作命令表、局部 typed router 与领域/宿主边界。
- `.ch/docs/design-docs/skill-archive-installation.md`：技能 ZIP 安装的兼容 Facade、来源发现与共享安全安装模板，用户行为不变。
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
│   ├── shared/               # 跨 CLI/config/Loop 复用的纯工具
│   ├── trace/                # trace/tool 输出格式化
│   ├── loopGroupChat.ts      # Loop 主从群聊路径、成员与 transcript 纯函数
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
- `configPanel.ts` 注册只读自定义编辑器承载配置 UI，优先调用 VS Code 内部模态编辑器；能力不可用或失败时回退独立 VS Code 窗口，窗口命令失败则保留编辑器页。`configView.ts` 按宿主模式隐藏原生浮层内重复标题和关闭按钮；不改变配置协议、档案导航或工作台全局布局。
- 不直接访问文件系统，不直接执行 CLI
- 主对话与 Loop / Loop+ 群聊复用 `chatMarkdown.ts` 的浏览器侧 Markdown、JSON、SVG 和图片交互运行时；`markdownAssets.ts` 统一加载 Marked / JSONFormatter，`viewContentStyles/markdown.ts` 提供可按容器复用的主题样式。
- 主对话实时追加、合并和工具更新使用 `messageRendering.ts` 的增量协调路径，复用原文、元信息及展示上下文未变的消息节点和指令组；`messageId` 索引只保存当前可见 DOM，移除消息、完整重绘和切换 CLI / Tab 时清理。完整重绘入口仍用于历史恢复等既有流程，不减少气泡、不截断历史或回放，也不改变折叠、筛选和导出契约。
- 消息节点复用必须核对 CLI、Tab、消息索引、流式纯文本状态及相邻工具引起的思考展示变化；元信息快照覆盖操作入口等嵌套字段。流式节点显式记录实际的纯文本展示状态，不能只依据 Markdown 定时器是否挂起，否则同步/延迟动画帧与结束收口交错时可能错误复用纯文本，遗漏最终 Markdown。
- `chatImageHost.ts` 在扩展宿主侧统一承接图片解析、预览和下载，由 `viewProvider.ts` 与 `loopGroupChatPanel.ts` 各自绑定当前 Webview，防止异步结果写入已替换或关闭的页面。

#### 扩展编排层

- 以 `src/extension.ts` 为核心
- 负责命令注册、状态管理、消息分发、会话与标签页编排
- 不应承载具体 CLI 协议细节和配置文件读写实现
- 当前 `src/extension.ts` 是组合根，保留 activate/deactivate、命令与视图注册、Loop/session/model/config host 装配和跨运行时生命周期适配；Webview 消息所需的 VS Code 能力在此组装为显式端口
- `src/sessionMessageRouter.ts` 只负责类型安全的消息到处理器分派和领域 Registry 合并，不承载业务分支
- `src/panelMessageHandlers/` 按 diagnostics、session、prompt、workspace 领域拆分消息处理器；每个处理器通过 `Pick<PanelMessageHandlerDeps, ...>` 声明最小依赖，避免接收完整组合根依赖
- `src/sessionMessageHandlers.ts` 保留兼容的统一入口，仅负责初始化会话存储、记录调试日志并调用 Router；新增消息应进入对应领域 Registry，而不是继续堆积条件分支
- `src/panelDiagnostics.ts` 保留模型管理诊断实现（`createPanelDiagnosticsInspector`）及其依赖注入端口，并作为旧入口兼容 Facade，显式命名转导出原有错误/重试、Loop 消息策略与群聊协调 API。转导出与新模块共享同一函数对象，不包装、不复制实现、不通过 `export *` 扩大公开面。
- 内部运行时直接依赖职责模块：`src/promptRetry.ts` 负责错误信息、隐藏重试资格/等待/提示和错误 trace，复用 `src/hiddenRetry.ts` 的延迟、格式化与去重纯辅助；`src/loopTaskMessagePolicy.ts` 负责继续提示词、任务恢复/session 兼容、验证信号和完成消息识别。两者不依赖 Facade、组合根或群聊面板协调器。
- 本次运行时抽取后，`src/extension.ts` 为 5659 行；3000 行以下是期望指标而非硬性边界，后续继续拆分必须按职责内聚推进

#### 扩展运行时 Host 层

- 位于 `src/extensionHost/`
- `modelSettings.ts` 保留模型选择、Loop 角色/推理力度、档案与工作区身份解析、面板构建及状态同步编排；`cliModelSelectionStrategies.ts` 只负责基于模型存储和实时缓存读取端口的选择规则，不负责配置 I/O。
- `src/config/configuredModelRepository.ts` 通过最小读取/错误端口隔离 Codex、Grok、DSH、Kimi Code、ZCode 的配置读取、已有解析器调用、实例级档案缓存与读取失败降级。构造无 I/O，宿主以活 getter 接入已有选择策略，编辑后也写入同一仓储；仓储不依赖 VS Code、配置服务运行时单例或宿主。刷新由宿主先建立全部 CLI 身份再按原顺序并发调用；运行前仍重新读取配置，不以展示缓存替代执行配置。时序和边界见 `.ch/docs/design-docs/vscode-cli-extension-runtime.md`。
- `loopGroupChatPanelCoordinator.ts` 承接群聊面板状态构建及 `createLoopGroupChatPanelCoordinator` 工厂，保留显式依赖回调，协调继续模型来源/原配置恢复、补充需求、独立提问、澄清、验收方案、停止、刷新、文件预览与释放。组合根直接装配该模块；它不反向导入 `panelDiagnostics.ts` 或 `extension.ts`，也不重新定义消息路由、调度或 Webview 展示。
- 通知设置复用 `DesktopNotificationAuthorization` 与既有 Webview 消息：macOS 调用稳定助手申请/查询授权，Windows 读取当前编辑器身份的 `ToastNotifier.Setting` 并用 `ms-settings:notifications` 打开设置。Windows 首次启用通知自动打开一次，成功后以扩展 globalState 记录；同一宿主并发请求共用 Promise，刷新只查询，远程 workspace 宿主不执行本机引导或原生工具。
- `humanInteractionAttentionHost.ts` 绑定窗口焦点、四项应用级提醒设置与本机宿主边界；`humanInteractionAttention.ts` 统一管理普通交互、Loop/Loop+ 澄清和任务完成的去重、并发窗口提醒与清理。系统通知在前台和后台均派发，窗口图标提醒仅在后台触发；先派发通知再清理前台完成窗口状态，通知通道不阻塞串行窗口提醒队列。`taskCompletionAttention.ts` 过滤子任务与中间主模型调用：Vibe 经共享成功运行记录触发，经典 Loop / Loop+ 仅在主任务完成持久化后触发；上下文压缩显式静默。完成提醒聚合为一个待查看状态，回到窗口即清除且不会在再次切后台时重放，最近 512 个完成事件 ID 用于去重。`desktopAttention.ts` 封装有超时的系统工具调用及两类固定中文通知，Windows 用不同 Toast Tag 避免两类通知互相覆盖；`macosDesktopNotifications.ts` 在扩展存储原子生成、签名、注册并复用具备稳定身份的“携宁 CLI 提醒”后台应用，通过 JXA 调用 `UserNotifications`、回报授权/投递状态。两类提醒共享 macOS 应用身份和权限，原生提醒失败不阻塞任务。
- `promptAutoRepair.ts` 在统一 `runPrompt` 分流外管理任务级命令修复与单次新会话重放，按 Tab 处理取消和任务替代；复用 `cliCommandRepair.ts` 的命令发现及组合根持久化，第二次执行关闭各 runtime 的 hidden retry，旧会话历史由生命周期层保留。
- `openCodePromptRunTemplate.ts` 用显式端口 Template Method 固定 OpenCode attempt 顺序。`runOpenCodePromptTemplate` 接收 `OpenCodePromptRunPorts`，由 one-shot 与 parallel 工厂在调用点构造端口；不使用类继承、DI 容器或 `mode` 旗标。当前 705 行
- `promptOneShotRuntime.ts` 承载 OpenCode one-shot 运行、JSONL stream 解析、hidden retry、fresh-session recovery、任务列表、子代理进度消费、长期记忆触发和自动压缩触发。attempt 顺序交给上述模板；工厂签名仍是 `createPromptOneShotRuntimeHost(deps: PromptOneShotRuntimeHostDeps)`。运行身份（`getActiveRunId() === runId`）和启动空闲超时留在本 host。当前 1193 行
- `promptParallelRuntime.ts` 承载 OpenCode parallel tab 运行、tab 定向 JSONL stream 映射、hidden retry、fresh-session recovery、任务列表、子代理进度消费、长期记忆触发和自动压缩触发。attempt 顺序交给上述模板；工厂签名仍是 `createPromptParallelRuntimeHost(deps: PromptParallelRuntimeHostDeps)`。运行身份与 tab 流留在本 host，不补 one-shot 启动超时。parallel 终态 `TaskRunRecord` 通过统一 helper 写入，`end` / `error` / `stopped` 均保留 Loop 追踪字段
- `promptInteractiveRuntime.ts` 承载 interactive attempt 顺序、收口、session adoption、停止、消息持久化、subagent progress、hidden retry 和 final answer 判定。Codex、Claude、Grok 的 runner 生命周期和流事件映射分别在 `interactiveTurnCodex.ts`、`interactiveTurnClaude.ts`、`interactiveTurnGrok.ts`，由 `interactiveTurnStrategy.ts` 的显式注册表提供。工厂签名仍是 `createPromptInteractiveRuntimeHost(deps: PromptInteractiveRuntimeHostDeps)`。没有类继承，也没有 DI 容器。当前 1276 行
- `cliModelSelectionStrategies.ts` 用显式 `Record<CliName, CliModelSelectionStrategy>` 收拢 Codex、Claude、OpenCode、Grok 的普通选择、main/subtask 角色选择、候选、可管理候选、下一份 store、持久化键和展示名。`createCliModelSelectionStrategies` 每次操作接收当前 `CliModelStore`；Grok 配置按原始 config id 现查注入的缓存，缺省存储键也在操作时向注入的 resolver 取值，工厂不捕获 store 或缓存快照。Codex、Claude、OpenCode 委托 `modelSelectionStore` 既有函数。策略不导入 VS Code、配置服务、文件系统、Webview 或日志，也不写盘。`modelSettings.ts` 仍负责活跃配置、读盘缓存、错误日志、`writeModelStore`、deps 同步和 PanelState。用户可见模型选择不变。事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-22-cli-model-selection-strategies.md`
- `src/modelSelectionStore.ts` 是模型存储的兼容 Facade：保留既有公共名称、同步签名和调用方导入路径，负责原有文件读写、错误状态/日志、模型业务操作与 PanelState 组装。`src/modelSelectionStoreTypes.ts` 集中定义18字段持久化结构、角色和存储选项，旧入口以具名 type 导出兼容。`src/modelSelectionStoreNormalization.ts` 负责一次既有 legacy 迁移及纯规范化，复用配置到CLI、前端/全栈独立思考映射；原有公共规范化辅助由 Facade 显式重导出并共享同一实现。依赖方向为 Facade → normalization/types，normalization → types/既有迁移与解析辅助；不反向依赖 Facade、组合根、VS Code 或文件读写，不引入持久化副作用。OpenCode模型的nullish别名回退与variant的首个有效别名优先级、显式空模型及注入思考规则保持不变。事实来源见 `.ch/docs/exec-plans/completed/2026-11/2026-11-06-model-store-normalization.md`，特征测试为 `src/test/core/modelSelectionStoreNormalization.test.ts`。
- `loopOrchestration.ts` 承载 Loop 主从编排 host，依赖注入类型必须显式、可搜索，不使用宽泛 `Record<string, any>` 作为事实边界
- `openCodeSubagentRuntime.ts` 承载 OpenCode 子代理 server attach / managed startup / ready wait / Basic auth env override / unavailable fallback 和 disabled monitor；当前 201 行
- `primaryPromptRunController.ts` 集中维护主 Prompt 的运行身份、进程、停止回调、会话目标、消息目标、trace 和任务状态；`extension.ts` 只负责组合根副作用与显式接线，避免 One-shot、上下文压缩、停止和 deactivate 分散读写同一组模块级状态
- `promptExecutionShared.ts` 只保存提示运行 host 共享的窄类型；当前 59 行
- `loopTaskStateMachine.ts` 只计算 Loop 主决策、停止和运行中断的下一次状态；`promptRunRuntime.ts` 消费该结果并执行原有副作用。它不是 UI，也不是 `loopTaskStore` 持久化层
- 依赖方向固定为 `extension.ts` 导入 host 并注入显式回调，host 可以依赖 `cli/`、`interactive/`、`promptRunState` 等服务与类型，但不能反向依赖 `extension.ts`

#### Loop 生命周期状态转移

- Loop 固定使用主从多智能体；辩论专属运行器、提示词、数据模型和模式选择入口已移除。群聊共用能力由 `src/loopGroupChat.ts`、`src/loopFinalSummary.ts` 和 `src/webview/loopGroupChatPanel*.ts` 承载，旧持久化模式字段读取时忽略。

- Loop/Loop+ 主决策、停止和运行中断由纯状态转移策略计算；主从调度、群聊、澄清和停止行为保持不变。任务持久化不再保留已停用的执行模式和辩论专属字段。
- `loopTaskTransitionStrategies` 按主决策 `completed` / `clarify` / `blocked` / `continue` 注册；停止和运行中断只按 `classic` 与 `event_driven` 注册。未知主决策回落到 `continue`。只有 `schedulingMode === "event_driven"` 走 Loop+ 策略，未设置时仍走 classic。不引入 DI 容器、继承层级或新的 mode 旗标。
- 策略返回下一状态、`LoopTaskRecord` patch、子任务更新，以及 host 可执行标志。模块不导入 VS Code、文件系统、日志或面板 API，也不调用 `buildNextLoopMainAiFailureState`。
- host 边界留在 `promptRunRuntime.ts`：`applyLoopMainDecision` 写任务存储，并仅在 `appendDecisionMessages` 时追加沟通文件和子会话消息；`markLoopTaskInterrupted` 先中止澄清，event_driven 再停止 Loop+ 父任务，classic 主任务 error 才由 host 计算失败次数并合并 `loopInterruptFailureLimitPatch`；`markLoopTaskStopped` 在缺失或已完成时直接返回，否则写 patch，并按标志中止澄清、刷新已打开群聊。`createPromptRunRuntimeHost` 的公开方法名不变。
- 兼容不变量：`completed`、`blocked` 和超限 `clarify` 清空活动子任务；未超限 `clarify` 保持 `running` 并递增 `clarificationCount`；无子任务的 `continue` 进入 `needs-review` 且不追加决策消息；有子任务的 `continue` 保留 `activeSubtaskIds`。classic 停止把活动、running 或 pending 子任务写入 `blocked`，并清空活动子任务；event_driven 停止和中断不把活动子任务写入 patch。已完成任务再次停止幂等。策略不拼接路径，Windows、macOS 和 Linux 的既有副作用顺序不变。
- 回归入口：`src/test/extensionHost/loopTaskStateMachine.test.ts`、`src/test/extensionHost/loopMainDecisionParsing.test.ts`、`src/test/extensionHost/extensionHostExtractionContracts.test.ts`；失败计数算法仍由 `src/test/loop/loopMainFailure.test.ts` 覆盖。先 `npm run build`，再 `node --test dist/test/extensionHost/loopTaskStateMachine.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js`。详细事实来源见 `.ch/docs/design-docs/vscode-cli-extension-runtime.md`。

#### CLI / Interactive / Config 服务层

- AI 面板首次构建和配置保存后的刷新统一通过 `loadConfigStateByCli` 并行读取七个 CLI 的档案列表与激活身份；心跳传入的当前 CLI 快照复用为种子。`PanelState.configState` 保留当前分组兼容字段，`configStateByCli` 只携带各分组的档案摘要和身份，不下发原始配置或凭据。单个分组读取失败不阻断其他分组。
- `modelSettings.refreshConfigModels` 刷新 Grok、DSH、KimiCode、ZCode 的配置派生模型；缺少保存档案时仍读取本机原生配置。跨 CLI 的 OpenCode 子模型从本机配置元数据解析，不为其他 CLI 启动进程或能力探测。明确的空身份不能回退到旧心跳身份；新应用的工作区配置优先于旧快照。
- Loop、Loop+ 共用 `modelState` 的分组身份、角色模型和子模型路由，不要求先访问目标 CLI。配置页各分组统一采用宿主确认的激活身份；激活档案保存后应用并等待面板刷新，未激活档案保存只刷新、不切换配置或主 CLI。跨 CLI 派发仍要求有效档案绑定，真实缺失或无效配置不伪装成可用。
- Webview 根据 `configStateByCli` 区分尚未加载与已加载但缺少档案；后一种状态显示缺少可用配置，读取错误显示失败原因，不再无限显示“正在同步”。
- `src/cli/`：一次性执行与命令解析；配置化 CLI command string 的拆分边界在 `src/cli/commandResolution.ts`，`commandRunner.ts`、MCP 命令调用等路径只复用该结果
- `src/cli/cliRunArgStrategies.ts` 用显式 `Record<CliName, CliRunArgStrategy>` 注册 Codex、Claude、OpenCode、Grok、DSH 的启动参数差异。`buildCliArgs` 仍从 `commandRunner.ts` 导出。参数顺序留在外观函数：基础参数、按 `includeThinkingArgs` 拼接 thinking、模型、隔离、`applyBeforePrompt`，空 prompt 立即返回，否则 `appendPrompt`。各平台各自实现差异，没有类继承，也没有 DI 容器。DSH 策略只保留明确 `--patch`，不把 one-shot prompt 写成已验证启动参数。`wc -l` 当前 `cliRunArgStrategies.ts` 为 219 行，`commandRunner.ts` 为 528 行。事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-cli-run-arg-strategies.md`
- `src/cli/openCodeRunOutput.ts` 承载 OpenCode 输出解释。该纯解析模块集中 JSONL、可见事件、活动跟踪、session/message id、export 文档选择、最终正文和失败文案，只依赖 `thinkingMarkup`、`boundedText`、`openCodeTaskList` 和 `opencodewatchdog`。`commandRunner.ts` 作为 Facade 保留进程、终端、runtime overlay、停止和 `recoverOpenCodeMissingAssistantOutput`；`opencode export` 的 `captureCliOutput` 副作用与 `OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS` 留在该外观。公开解析符号仍从 `commandRunner.ts` 再导出。`wc -l` 当前 `openCodeRunOutput.ts` 为 1033 行，`commandRunner.ts` 为 528 行。测试入口是 `src/test/cli/openCodeRunOutput.test.ts`。事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-opencode-output-parser-facade.md`
- `src/interactive/`：会话型运行与底层续接 ID 映射
- `src/interactive/codexRunner.ts` 的通知入口统一负责活动操作检查、过期回合过滤、最终答复边界、事件转发、压缩完成和主回合观测；随后通过实例内只读 `Map` 按协议 `method` 委派到私有事件处理器。推理别名共享处理器，条目开始/完成共享处理器，未知方法默认忽略；各处理器复用 `codexRunnerRuntime.ts` 等既有解析工具，不另持运行状态或引入继承/容器。新增通知时只扩展注册表和对应处理器，前置顺序、主子线程隔离及完成语义由 `src/test/interactive/codexRunnerLifecycle.test.ts` 等回归约束。
- ZCode 0.17.0 使用独立 ZCode Protocol（`zcode app-server --stdio`），不是 ACP。实现在 `src/interactive/zcodeAppServerProtocol.ts` 与 `src/interactive/zcodeRunner.ts`。用户供应商配置是 `~/.zcode/v2/provider_config.json`。
- `src/interactive/manager.ts` 仍是交互 Runner 的公开 Facade。`InteractiveRunnerManager` 保持无参构造，公开方法名、参数含义和同步返回类型不变。原先 562 行的类把 Codex、Claude、Grok 的构造、复用、`setRunner` 元数据和共享 Map / idle timer 写在一起；现在平台差异在 `src/interactive/runnerLifecycleStrategies.ts`，类型在 `src/interactive/runnerLifecycleTypes.ts`。四个 `getOrCreate*` 只把策略交给同一个查找、判断复用、更新或先释放再创建、注册、touch 流程。DSH 使用独立策略，启动固定 `dsh --profile acp`，恢复走 `session/resume`，不复用 Grok 的 `session/load`。Manager 独占 entries Map、`${cli}:${sessionId}` 键、注册替换删除、dispose、touch、活动状态和 24 小时 idle timer。策略不建缓存或定时器，也不导入 manager。用显式策略而不是继承，是因为缓存和释放顺序必须只有一份；子类各自持有生命周期会把同一条流程拆开。新增平台时增加一份策略、对应创建参数和一个薄入口，不要复制 Map 或 timer。OpenCode 仍不进入该缓存。当前 `manager.ts` 344 行，`runnerLifecycleStrategies.ts` 338 行，`runnerLifecycleTypes.ts` 164 行。`RunnerRegistration` 对联合按平台成员分布：`cli: "codex"` 绑定 Codex runner 和 `configId`，`cli: "claude"` 绑定 Claude runner 和 `isolateProjectInstructions`。同一套查找、复用或先释放再创建、注册、touch 流程用同一个 CLI 类型参数绑定 entry、runner、工厂和注册结果。公开 `setRunner` 仍接受不关联的 CLI 与 runner 联合，只在 Facade 内按 `cli` 分派。编译期负例由 `manager.test.ts` 用 TypeScript 虚拟文件诊断覆盖。测试入口仍是 `src/test/interactive/manager.test.ts` 与 `src/test/interactive/runnerLifecycleStrategies.test.ts`。用户可见会话行为不变。事实来源见 `.ch/docs/references/cli-runtime-reference.md` 与 `.ch/docs/exec-plans/completed/2026-10/2026-10-22-interactive-runner-lifecycle.md`
- Grok 的 `grokToolCallStream.ts` 在当前 prompt 内按会话与调用 ID 聚合工具，规范化已知输出后分别生成回放终态和聊天摘要；`grokReplayStream.ts` 管文本合并与通知降噪，宿主复用 traceSegment 同 ID 更新和任务列表。Webview 活动时间独立于回放条目，不将高频协议通知持久化为聊天消息。
- `src/config/`：外部 CLI 配置、全局 Skills 目录和本地配置档案管理；配置中心不再把 MCP 市场作为用户功能。用户级配置路径由 `src/config/configPaths.ts` 集中维护，legacy `gemini` 配置平台仅兼容归一到 `opencode`
- `configService.ts` 保持配置档案公开 Facade，负责平台归一化、列表合法性/时间/排序/迁移过滤、源校验、提交/美化与全部 IO。`configprofilenormalization.ts` 以模块级 `Record<CurrentConfigPlatform, Strategy>` 注册七个平台，仅原地规范化服务已创建的对象，共享 canonical content 与 DSH/Kimi Code/ZCode 清理原语，无 IO、运行时依赖或深拷贝。`list/read/save` 显式保留历史差异：Grok 单项读取不规范化，Claude 保存不加读取默认，OpenCode 列表不迁移/删除 legacy skills，而单项读取和保存才迁移并对所有平台删除 `geminiSkills`。保存先浅拷贝并校验，再规范化；后续提交、OpenCode 阻断校验和写盘边界仍在 Facade。新增平台时扩展平台类型、此注册表及三阶段表驱动/服务测试，勿把运行配置策略或 UI 逻辑放入字段策略。
- `src/config/cliRuntimeConfigStrategies.ts` 用显式 `Record<CurrentConfigPlatform, CliRuntimeConfigStrategy>` 注册 Claude、Codex、OpenCode、Grok、DSH。策略集中运行配置的 `readCurrent`、`apply`、`backup`，以及默认档案初始字段和读取失败回退字段。`createCliRuntimeConfigStrategies` 接收五个平台各自的窄 IO 端口，在操作时调用 `configService` 注入的原有读取、写入和备份函数。DSH 激活写入隔离 profile，不改 `~/.dsh` 的 `settings.yaml`、`.credentials.yaml` 或 `config.toml`。策略模块不导入 `configService` 或 VS Code，不在 import 时捕获 `HOME`、`CONFIG_PATHS` 或 `GROK_HOME`，也不引入继承层级、DI 容器或另一套配置模型
- `configService` 保留兼容外观：既有导出名称、参数、返回形状和异常传播不变，档案 CRUD、复制、顺序、OpenCode 校验工具和 Skills 外观仍留在原模块。`getCurrentConfig`、`applyConfig`、`backupConfig` 只按 `normalizeConfigPlatform` 的结果委托策略；未知平台仍由归一化函数拒绝。`initDefaultConfig` 保留档案存在性判断、ID、名称、时间和 `saveConfig`，只把平台字段构造交给策略，并且只捕获读取或初始字段构造失败。Grok 路径仍在操作时解析 `GROK_HOME`。本次不改变用户可见配置行为，事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-cli-runtime-config-strategies.md`
- `configService` 内部的运行配置备份是表驱动的：私有 `BACKUP_PLATFORMS` 描述表按 `Exclude<CurrentConfigPlatform, "zcode">` 注册 claude、codex、opencode、grok、dsh、kimi-code 各自唯一一份平台前缀、读取回调和平台无关文件名片段/扩展名/权限，`runBackup` 执行器固定为 ensureDir 备份目录 → 读取 → 只生成一次时间戳 → 用同一表项前缀按 `${prefix}${baseName}_${timestamp}${suffix}` 构造路径 → 并行写入，备份文件名前缀与列表过滤共用同一事实来源，DSH 项通过文件级 mode 0o600 加写后 chmod。六个导出 `backup*Config` 函数保留名称与签名，薄包装调用共同执行器；`getBackupList` 复用同一张表的前缀（zcode 保留 `zcode_` 兼容分支）。ZCode 备份不经该表，仍走 `zcodeConfig.ts` 的 `backupZcodeProviderConfig`（原文件旁 `.bak-Date.now()` 命名、缺失返回 null）。同一调用内多文件共享时间戳，实现不保证跨调用时间戳唯一。事实来源见 `.ch/docs/exec-plans/completed/2026-10/2026-10-29-config-backup-registry.md`
- 模型导入采用「静态策略表 + 兼容 Facade」。`src/config/modelimport.ts` 仍是唯一公开入口，保留 `getModelImportProviders`、`discoverImportModels`、`applyModelImport` 的签名、异步性质、结果结构和既有类型导出；Facade 只做 payload 白名单/大小/平台校验、当前草稿供应商存在性检查、安全模型 ID 检查与固定操作顺序，再按 `payload.platform` 取策略。`src/config/modelimportplatformstrategies.ts` 用 `as const satisfies Record<ModelImportPlatform, ModelImportPlatformStrategy>` 注册 Claude、Codex、OpenCode、Grok、DSH、Kimi Code、ZCode 七项，每项配对当前草稿的供应商解析与导入写回，Claude 额外提供发现字段构建器；没有类继承、DI 容器、动态插件加载或运行时注册。`src/config/modelimportdiscovery.ts` 只负责有界 HTTP 发现（地址构造、同源重定向/分页、响应与结果上限、`Promise.race` 超时），协议认证/分页 switch 属于网络协议差异，不强行策略化。`src/config/modelimportshared.ts` 承载被多层复用的校验、凭据、脱敏、草稿克隆与供应商构造；`src/config/modelimportedits.ts` 承载 JSONC/TOML 定向编辑助手；`src/config/modelimporttypes.ts` 承载公共与内部契约。依赖单向为 Facade → discovery/strategies → shared/types，底层不得反向导入 Facade。新增平台时在策略表补一项、在 `ModelImportPlatform` 增加成员，并补该平台的供应商解析、写回、发现字段（如需要）与回归用例，不要在 Facade 增加平台条件分支。Facade 的平台白名单与 Claude 五字段白名单不单独维护：前者由 `MODEL_IMPORT_PLATFORM_STRATEGIES` 的键推导，后者与策略共用 `modelimportshared.ts` 的 `CLAUDE_FIELD_KEYS`，因此安全/业务规则只有一份定义；改字段白名单或平台集合时只改这两处事实来源，并用 `src/test/config/modelimportplatformstrategies.test.ts` 的单一来源断言防止 Facade 再次复制规则。事实来源见 `.ch/docs/exec-plans/completed/2026-11/2026-11-05-model-import-platform-strategies.md`
- `src/shared/`：跨服务层复用、无 VS Code 依赖的纯工具；当前包含 strict/jsonc JSON object 解析等后端共用逻辑
- 这一层负责和本地 CLI、SDK、home 目录配置打交道，但不负责 UI 渲染

#### 基础本地资源层

- 包括 `~/.sinitek_cli/`、`~/.codex/`、`~/.claude/`、`~/.opencode/` 和 OpenCode 官方全局 MCP 配置 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json`；`~/.gemini/` 仅作历史迁移参考
- Loop 模式的任务记录位于 `~/.sinitek_cli/loop-tasks/`；主子任务沟通与群聊 transcript 位于 `~/.sinitek_cli/loop-communications/`
- 首次枚举 Loop 任务时，`src/loopLegacyMigration.ts` 与 `src/loopTaskStore.ts` 会把旧 Lobster 任务存储和通信目录迁入上述 Loop 路径；新写入不再使用旧命名，冲突 artifact 以 `.pre-loop-migration` 后缀保留
- 属于运行时依赖或本地状态，不属于 UI 和业务编排层

#### Loop 子任务执行隔离

- Loop / Loop+ 每轮主决策（包括补充需求、继续、验收及收尾）共享 `src/loopDirectExecutionPolicy.ts` 的简单事项直办规则，按复杂度、风险和验证需求判断，而非操作种类或修改行数。独立、明确、低风险且无需独立验证的事项由主任务直接处理，复杂或已委派工作保留原流程。Loop+ 仅无开放工作、待验收事件及附加审查时，由宿主显式放行 `directCompletion=true` 的精简完成协议；用户消息和 scheduler 门禁不变。具体边界见 `.ch/docs/design-docs/loop-plus-scheduling.md`。

经典 Loop 与 Loop+ 支持连续子任务会话复用：主模型通过 `continueFromSubtaskId` 声明来源；Loop+ 验收失败的修补项按 review 关联自动继承原子任务会话，控制重派续接原子任务。真实 CLI/config/session 绑定保存在子任务记录，关闭 Tab 不清除绑定；仅同一父任务且 CLI、配置兼容时恢复。共享来源与会话串行执行，独立任务仍新建会话。隔离工作目录与 CLI 会话身份是不同边界，细节见 `.ch/docs/design-docs/loop-subtask-session-reuse.md`。

- 经典 Loop 主任务和子任务均以真实工作区作为 cwd，按各 CLI 的默认机制读取项目规则；子任务首次运行与手动续跑使用同一策略。主任务只拆分、派发、协调并信任子任务汇报判断完成，不检查实现细节、不亲自验收或测试。用户或项目规则要求的验证可由实现子任务一并完成；已通过且仍覆盖当前改动的结果直接复用，仅补缺失、失败或因后续改动失效的部分。明确要求独立验收或交叉复核时仍另派任务，均无验证要求时默认不做。Loop+ 保持既有事件驱动验收。
- `src/loopSubtaskExecutionRoot.ts` 为 Loop+ 子任务创建临时根目录，只链接可工作内容，隐藏根 `AGENTS.md`、`CLAUDE.md`、`.agents`、`.claude`、`.codex`；写入仍通过链接回到真实工作区。Windows 使用目录 junction 与文件 hardlink，跨盘时把临时根放到工作区 `.sinitek-loop-tmp`。结束或创建失败时，只非递归移除本次登记且身份匹配的链接，再移除空临时根；根目录或链接被替换、存在未知内容或清理失败时保留现场并记录日志，不递归删除执行根，也不把成功任务改判失败。
- 隔离子任务调用还叠加 CLI 级隔离：Codex 使用 `--ignore-rules`，Claude SDK 仅加载 `user` settings（保留用户级 MCP / 搜索工具），OpenCode 使用 `--pure`。该隔离策略不再用于经典 Loop；Loop+ 的自包含派发及验证规则保持不变。
- 不再分发、加载或注入 Loop Workflow Skill 快照，也没有对应的工具设置开关。

- 子任务可以绑定另一个 CLI 分组当前选中配置。路由身份在 `src/subtaskCliRoute.ts`，扩展现有 Loop `modelRouting.subtask`。经典 Loop 用该 CLI 创建独立子 Tab；Loop+ attempt 的 `targetCli` 使用同一绑定。主任务 target、会话和存储归属不变。跨 CLI 不回退主模型、主配置、主会话、主思考档或 OpenCode variant。

共享提示运行类型集中在 `src/promptRunTypes.ts`；主/子模型及思考力度解析由 `src/extensionHost/promptRunModels.ts` 提供，Vibe、Loop 和 Loop+ 复用，避免依赖某个编排模式的实现。

## 3. 扩展规则

### 新增一个能力时怎么放

1. 只是设置读取、命令拼装、执行捕获：放 `src/cli/`
2. 需要会话复用、thread/session 恢复：放 `src/interactive/`
3. 需要管理外部 CLI 配置或全局 Skills：放 `src/config/`
4. 只是面板交互、展示或协议字段：放 `src/webview/`
5. 需要打通整条链路时，在 `src/extension.ts` 接线；若是提示运行的连续状态机，优先放到 `src/extensionHost/*Runtime.ts` 并由 `extension.ts` 注入依赖
6. 只是 Loop 群聊 transcript、成员或路径纯函数：放 `src/loopGroupChat.ts`，不要反向依赖 VS Code API 或 Webview
7. Loop 主决策、停止和运行中断的状态计算放 `src/extensionHost/loopTaskStateMachine.ts`；任务存储、沟通文件、聊天消息、clarification abort、群聊刷新、日志和主任务失败计数留在 `src/extensionHost/promptRunRuntime.ts`。不要把状态转移模块写成 UI 或数据库层

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
