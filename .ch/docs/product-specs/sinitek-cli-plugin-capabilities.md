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
- Gemini：支持一次性 headless 执行和流式展示；默认使用 Gemini CLI `-p` 与 `--output-format stream-json` 并解析结构化事件；thinking 通过临时 system settings 覆盖层 + `-m/--model` alias 选择注入，不再运行时改写工作区 `.gemini/settings.json`
- 支持 `coding / plan / lobster` 三种交互模式
- 支持停止当前任务、查看运行中 prompt、查看原始流式记录
- 对非主动中断/异常会隐式发送“继续/continue”自动重试 5 次，每次间隔 30 秒；不会展示这条隐式用户消息，但会追加系统提示说明当前是第几次自动重试；达到上限后会展示最近一次真实错误，避免只剩泛化提示
- Codex 在工具设置中提供项目级“子智能体（multi_agent）”开关，默认关闭；关闭时继续走 app-server 主链路，但会显式禁用官方多智能体子任务能力
- Codex 交互式运行会优先直接启动已解析的 CLI，可显式固定 `CODEX_HOME` / 工作区 trust，并在回合完成时优先采用渐进式关闭，降低长任务被异常打断的概率
- 龙虾模式会沿用当前 tab 的会话上下文，并按会话隔离写入任务记录：`~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json`（首次主任务尚未拿到真实会话 ID 时会暂存到 pending 路径，拿到真实会话 ID 后自动迁移到该会话文件）；主任务、子任务和轮次概要都写入该会话记录文件，同时在 `~/.sinitek_cli/lobster-communications/<taskId>/` 维护主子任务沟通文件；主任务返回 JSON 决策，扩展解析自包含的 subtask.prompt 后以独立新会话启动子任务，并自动切换到子任务标签展示气泡和流式消息；子任务完成后切回主任务并自动唤醒主任务审核验收，不满足则继续启动子任务，验收通过才结束；轮次按主任务复核轮计数，同一轮可包含一个对应子任务；第 1 轮先做总体阶段规划再派发首个子任务；龙虾模式下底部模型选择拆分为“主任务模型 / 子任务模型”，并在“管理模型”中为每个模型提供“主任务 / 子任务”可用角色开关（至少保留一个角色）；最终完成时主任务必须返回整体总结、各轮子任务摘要和用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md`、`final-summary.md` 和任务记录；只有主任务显式返回 `status=completed` 才结束；子任务结束前必须写清沟通文件，供主任务唤醒后读取；子任务出错会间隔 1 分钟自动重试最多 5 次；消息气泡会标记“🦞 / 子任务”

### 3.4 会话与并发

- 会话列表与当前会话切换
- 多个 conversation tab
- 单个 tab 切换 CLI 分组或切换历史会话时，不应中断其他 tab 中正在执行的任务
- 历史会话删除、清空、重置当前 Tab
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
- 任务列表提取与展示
- 原始流消息导出
- 错误详情查看 / 复制

### 3.7 模型、思考模式与规则

- 按 CLI 维护模型列表与当前选择
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
- 日志保留与临时文件清理
- 插件管理的历史痕迹（logs / prompt history / session history / task runs / lobster task records）默认仅保留最近 30 天（约 1 个月）
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
