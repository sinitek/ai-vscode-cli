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
├── interactive/              # Codex/Claude 交互 Runner 与会话映射
├── webview/                  # 侧边栏聊天面板、配置中心面板、前后端协议
├── config/                   # 本地配置档案、Skills、MCP、官方目录管理
├── trace/                    # trace/tool 事件格式化
├── lobsterDebate.ts          # Loop 辩论记录、路径、群聊解析和共识校验纯函数
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
- `installer.ts`：提供不同 CLI 的安装提示文案
- `types.ts`：定义 CLI 名称、思考模式、交互模式等稳定类型

这一层只关心“如何把命令跑起来”，不负责聊天状态和 Webview 呈现。

### 4.2 `src/interactive/*`：会话型执行层

当前只有 Codex 和 Claude 进入交互 Runner：

- `manager.ts`：按 `cli + sessionId` 复用 Runner，并处理空闲释放
- `codexRunner.ts`：通过 `codex app-server --listen stdio://` 建立 JSON-RPC 会话，维护 threadId；优先直接启动已解析的 Codex 可执行路径，显式注入 `CODEX_HOME` / `CODEX_HOME_DIR`，启动前确保工作区 trust，并在回合结束时优先走 graceful shutdown；“常用命令 -> 压缩上下文”对 Codex 直接复用当前 threadId 发送 `thread/compact/start`，且工具设置可选“执行后自动压缩上下文”（默认开启）会在已有会话任务成功结束且执行超过 5 分钟后自动触发同一路径；任务中断、报错或执行不超过 5 分钟不触发
- `claudeRunner.ts`：通过 `@anthropic-ai/claude-agent-sdk` 建立交互会话，维护 Claude session；“常用命令 -> 压缩上下文”优先直接发送官方 `/compact`，并根据 SDK `status=compacting` / `compact_boundary` 信号判定完成；仅在旧环境明确不支持原生 compact 时回退到摘要模拟
- `metaStore.ts`：把扩展 sessionId 与 threadId / Claude sessionId 的映射落盘
- `claudeTranscript.ts`：辅助 Claude 历史恢复

Gemini 当前仍走 one-shot 路径，不进入 `interactive/`。

### 4.3 扩展侧 Loop 编排

Loop 模式仍由 `src/extension.ts` 统一编排，不新增独立后端服务或新的顶层 `InteractiveMode`。当前内部执行方式有两种：

- `main_sub_multi_agent`：经典主从多智能体，主任务直接返回 `LobsterMainDecision`，再复用现有子任务批次、冲突规划、重试、沟通文件和最终总结链路。运行时在 `~/.sinitek_cli/lobster-communications/<taskId>/group-chat.md` 维护主从群聊 transcript，任务开始/恢复气泡会显示“打开 Loop 群聊”动作；内容区群聊面板把“主任务”和动态加入的“子任务 1~N”作为成员展示，成员区标题统一使用“成员”，不沿用红蓝文案；子任务成功完成后的发言气泡展示该子任务最终回复，运行状态与验证依据继续写入任务记录和子任务沟通文件，并在主任务或当前子任务运行时显示“思考中”气泡。未完成且未触发主任务 AI 连续失败上限的 Loop 任务都会在群聊面板显示“补充需求”按钮，把新增需求写入任务记录与主任务沟通文件，供下一轮主任务/裁判主持人读取；当同一 Loop 任务当前没有运行进程且仍可继续时，群聊面板额外显示“继续执行”按钮，点击后先弹出可编辑确认框（默认“继续”），确认后复用同一 `resumeTaskId`，把该继续消息作为本次继续指令交给主任务/裁判主持人判断下一步；同一 Loop 任务存在运行进程时，群聊面板显示“中止”按钮并按 `lobsterTaskId` 停止主任务、子任务和相关运行，把任务记录标记为 stopped。AI 对话面板中的 Loop 主任务 tab 在主任务或同一 Loop 任务任一子任务仍在运行时强制跟随最新消息；用户手动滚离底部时仍显示置底按钮，点击后回到最新消息。普通 Vibe tab 与 Loop 子任务 tab 保持原有按用户滚动位置决定的策略。
- `debate_multi_agent`：只替代主任务规划/复核阶段，并以红蓝对抗作为辩论语义。每个主任务复核轮先通过临时普通对话 tab 启动裁判主持人组队，裁判主持人写入 `moderator-participants.md` 并动态设计 2-6 个红蓝参与者；新清单的 `role` 只能是 `blue_team` 或 `red_team`，且必须至少包含 1 个蓝队和 1 个红队。蓝队负责提出、捍卫和修正方案，红队负责攻击方案假设、目标覆盖、证据链、边界场景、可行性、成本收益和可验证性；只有任务涉及代码、文件、权限、部署或流程执行时，红队才额外检查并发冲突、越权修改、回滚/恢复失败等工程风险。扩展校验后把这些成员作为 `## 参与者加入：...` 写入 `chat.md`。每个发言批次内参与者并行运行，各自只写独立的 `participants/<participantId>-turn-<n>.md`，扩展等待本批次全部 artifact 完成后按裁判主持人清单顺序追加到 `chat.md`，再启动裁判主持人写 `participants/moderator-turn-<n>.md` 并输出 `continue / finalize / block`；`continue` 表示红队攻击尚未被蓝队充分回应或蓝队新方案尚未被攻击，`finalize` 并行收集最终 `participants/<participantId>.md` 和 `## 立场` 后交给共识汇总器生成 `decision.json`，`block` 进入人工复核。参与者和裁判主持人的临时 tab 在回答完成后可按“Loop 子任务自动关标签”设置关闭，后续同一角色优先用 `debateRounds` 中记录的 sessionId 新建临时 tab 续接。最大发言批次数只作为防无限循环安全上限，达到上限后运行时强制收束。红蓝辩论任务也复用“打开 Loop 群聊”动作；通用面板把 `debates/round-*/chat.md` 与根部 `group-chat.md` 合并为单条时间线，主任务轮次、发言批次和执行阶段以系统消息呈现，不再提供轮次切换，并根据 `debateRounds.activeSpeaker` 显示当前裁判主持人/参与者/共识汇总器的“思考中”等待气泡。群聊面板的“中止”入口同样按 `lobsterTaskId` 停止裁判主持人、参与者、共识汇总器以及共识通过后的主从执行子任务，并把运行中的辩论轮和参与者标记为 stopped。共识通过后仍交给现有 `applyLobsterMainDecision`，子任务执行链路不分叉，但主任务决策、子任务加入、子任务完成和批次完成会继续写入根部 `group-chat.md`，同一任务页面继续在同一时间线展示后续“任务执行群聊”消息，并根据 activeSubtaskId / activeSubtaskIds 显示当前主任务或子任务“思考中”。两种模式的群聊面板都会在状态落盘后主动刷新，5 秒自动刷新仅作兜底；若刷新前群聊滚动位置距离底部不超过 50px 会自动跟随最新气泡，否则保留阅读位置并显示置底按钮，同时保留手动刷新；当任务尚未完成且未触发主任务 AI 连续失败上限时，面板都提供“补充需求”以把新增要求持久化到任务记录和主沟通文件，供下一轮主持人或主任务读取。不同 `taskId` 的 Loop 群聊页面由扩展侧按任务隔离管理，可同时打开；同一 `taskId` 重复打开时复用该任务已有页面并刷新状态。

`src/lobsterDebate.ts` 只保存辩论路径、主从 `group-chat.md` 路径、记录类型、群聊回合 artifact 路径、裁判主持人决策类型、红蓝角色常量、群聊 transcript 标题解析、主从子任务发言正文格式化和共识校验纯函数，不访问 VS Code API 或文件系统。实际文件读写、`chat.md` / `group-chat.md` 追加、任务记录更新、tab 创建、内容区 WebviewPanel 创建和失败降级都留在 `extension.ts` 编排层。AI 对话历史记录弹窗的“Loop 群聊” tab 只下发任务摘要并按 `taskId` 打开对应任务的内容区群聊面板，不直接加载普通 session 或自动继续任务。`debate_multi_agent` 发生 `chat.md` 缺失或未收束、裁判主持人 artifact 缺失或无法解析、参与者 artifact 缺失、共识后仍有未解决阻塞、非法 `consensus.md` / `decision.json` 或无法派发合法子任务时，会把任务更新为 `needs-review`，不静默回落到经典主任务规划。参与者 artifact 的原始 `block` 如果被裁判主持人追问、蓝队修正或共识汇总器明确转化为前置子任务、验收标准或风险说明，并写入 `resolvedDisagreements`，运行时允许按 consensus 的最终 `participantStances` 继续。

## 5. 配置与本地集成层

`src/config/configService.ts` 是本地配置集成的唯一核心入口，负责：

- 读取和写入 `~/.claude`、`~/.codex`、`~/.gemini` 相关配置
- 管理配置档案（config profiles）
- 管理备份、导出
- 扫描和安装 Skills
- 扫描、安装、卸载、检测 MCP
- 读取内置官方 Skills / MCP 市场目录

与之配套的 `src/config/codexSkills.ts`、`claudeSkills.ts`、`geminiSkills.ts` 负责各平台 Skills 的列表与受控配置片段合并。

## 6. 状态落盘与本地数据

插件自身状态统一保存在：

```text
~/.sinitek_cli/
```

当前主要包括：

- `settings.json`：工具设置中的全局项（如 debug、自动文件标签、语言、macOS task shell）
- `sessions/`：按工作区维护会话元信息
- `messages/`：会话消息内容
- `prompt-history/`：历史提示词
- `workspace-settings/`：工作区级 UI/CLI 偏好与项目级工具设置
- `models.json`：各 CLI 的模型列表与选择
- `tasks.json`：任务相关状态
- `lobster-tasks/`：按工作区、CLI 和会话隔离的 Loop 任务记录；新任务写入 `executionMode`，老任务缺字段时按 `main_sub_multi_agent` 兼容，辩论模式额外保留 `debateRounds`
- `lobster-communications/`：Loop 主任务、子任务和辩论沟通文件；`debate_multi_agent` 在 `<taskId>/debates/round-<n>/` 下生成 `brief.md`、`chat.md`、`moderator-participants.md`、`participants/*-turn-<n>.md`、`participants/moderator-turn-<n>.md`、最终 `participants/*.md`、`cross-review.md`、`consensus.md`、`decision.json`
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
- 不要把 Codex / Claude / Gemini 的协议分支散落到多个 UI 文件
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
- Gemini 目前没有接入交互 Runner
- 聊天面板 HTML 和脚本仍以单文件生成方式维护，适合当前体量，但未来若继续增长应考虑进一步模块化
