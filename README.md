# Sinitek AI VS Code CLI 插件

Sinitek AI VS Code CLI 插件（携宁 CLI 助手）为 VS Code 提供一个统一的 AI 工作台。无需离开编辑器，即可使用本机的 Codex、Claude、OpenCode、Grok、DSH 或 Kimi Code CLI 进行对话、编程和复杂任务协作。


## changelog
### 1.4.0
- 新增 kimi code 支持，适配该 cli 可能存在 bug
- bugfix 以及体验优化

### 1.3.1
- dsh cli bugfix 和体验优化
- 增加人机交互历史记录查看功能

### 1.3.0
- 此插件增加图标
- 新增 dsh 支持
- 优化 Loop+ 模式并行逻辑，提高效率
- 体验优化

### 1.2.2
- 对话气泡支持图片/svg的展示和预览
- 任务总结经常会以 svg 做补充展示

### 1.2.1
- 首次发布 vscode 市场


## 核心特性
### 统一使用多个 AI CLI

- 在 VS Code 内切换 Codex、Claude、OpenCode、Grok、DSH 和 Kimi Code。
- 为不同 CLI 设置独立的命令、参数、配置档案、模型和思考模式。
- 统一展示流式回复、思考状态、工具调用、执行日志和最终结果。
- 支持多标签会话、并行任务、历史会话恢复和会话关键词搜索。

### 丰富的上下文与交互

- 在提示词中添加文件、当前编辑器内容和选中代码等上下文。
- 支持附件、提示词历史、收藏提示词和当前会话搜索。
- AI 需要补充信息时，通过表单向用户提问并继续任务。
- 实时展示任务列表、子任务进度、工具 trace 和上下文使用情况。

### 多种任务模式

- **Vibe（coding）**：适合日常问答、代码编写、修改和调试。
- **Loop**：将复杂目标拆分为多个子任务，支持多轮推进、协作沟通和人工确认。
- **Loop+(推荐)**：在 Loop 基础上提供更完整的子任务派发、验收和协作控制。
- **Graph**：由 AI planner 生成可视化 DAG，查看节点状态、依赖关系和执行进度，并支持继续、重试、停止和失败返工等恢复操作。

### 配置中心

- 可视化管理 Codex、Claude、OpenCode、Grok、DSH 和 Kimi Code 的配置档案。
- 配置模型、Provider、思考强度、规则、工作区设置和任务执行选项。
- 支持执行后自动压缩上下文、历史记录保留和人工交互开关。
- 提供配置备份、导出、日志查看和 CLI 找不到时的诊断与修复入口。

### Skills

- 配置中心只打开、删除和复制 Claude、OpenCode、Grok、Codex、DSH、Kimi Code 六个全局 skills 目录。
- 配置中心不再提供 MCP 市场，也不会改写本机已有的 MCP 配置。

### 本地记忆与可靠运行

- 可选启用插件侧长期记忆，帮助 AI 延续项目上下文和历史经验。
- 会话、任务和配置状态在本地持久化，重新打开 VS Code 后可以继续使用。
- 界面固定使用简体中文，并提供调试日志、历史清理和异常提示。

## 开始使用

1. 先在本机安装并完成鉴权或配置至少一个 CLI：Codex、Claude、OpenCode、Grok、DSH 或 Kimi Code。
2. 首次加载时，**携宁 CLI 助手** 默认在辅助栏打开（通常在右侧），也可通过状态栏或命令面板打开。
3. 选择要使用的 CLI，输入提示词即可开始对话或创建任务。

## Kimi Code 快速上手

1. 安装官方 CLI（需要 Node.js 22.19.0 或更高版本）：
   ```bash
   npm install -g @moonshot-ai/kimi-code@latest
   kimi --version
   ```
   官方另提供免 Node 的安装脚本，见 `docs/kimi-code-guide.md`。
2. 打开配置中心 → kimi，确认默认模型 `kimi-k3.1-pro` 与 `base_url`。API Key 直接写在同一个 `~/.kimi-code/config.toml` 的 `api_key`，或改用 `api_key_env` 引用环境变量；不需要第二个鉴权文件，不要把密钥写进仓库。
3. 免审批写在配置里：`default_permission_mode = "auto"`。官方 `--auto` / `--yolo` 与一次性任务的 `-p` 互斥，插件不会拼这两个参数。
4. 自检：`kimi doctor config`；交互主路径是官方 ACP `kimi acp`。
5. 默认配置与范例只保留常用字段。需要思考力度时，在 TOML 源码中显式声明 `capabilities = ["thinking", "tool_use"]` 和 `support_efforts`，否则 ACP 不广告该选项；面板下拉按 ACP 实际广告值刷新。
6. 上下文压缩：Kimi Code ACP 没有压缩方法，插件明确不支持，不显示「压缩上下文」入口。
7. 主/子模型：候选只取当前配置声明的模型，子任务未单独选择时先回落到普通对话所选模型、再回落到 `default_model`；Kimi 自身 `config.toml` 没有子模型字段。

完整说明见 `docs/kimi-code-guide.md`、`.ch/docs/references/kimi-code-official-reference.md` 和 `.ch/docs/runbooks/kimi-code-config.md`。
