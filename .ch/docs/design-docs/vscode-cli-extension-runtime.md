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
- `codexRunner.ts`：通过 `codex app-server --listen stdio://` 建立 JSON-RPC 会话，维护 threadId
- `claudeRunner.ts`：通过 `@anthropic-ai/claude-agent-sdk` 建立交互会话，维护 Claude session
- `metaStore.ts`：把扩展 sessionId 与 threadId / Claude sessionId 的映射落盘
- `claudeTranscript.ts`：辅助 Claude 历史恢复

Gemini 当前仍走 one-shot 路径，不进入 `interactive/`。

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

- `sessions/`：按工作区维护会话元信息
- `messages/`：会话消息内容
- `prompt-history/`：历史提示词
- `workspace-settings/`：工作区级 UI/CLI 偏好
- `models.json`：各 CLI 的模型列表与选择
- `tasks.json`：任务相关状态
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
- 7 天日志保留
- 10MB 分段切割

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
