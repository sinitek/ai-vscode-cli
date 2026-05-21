# 功能总表

这个文件是当前仓库功能清单的**单一事实来源**。

当前仓库已经具备真实能力，因此不再保持空表；请在用户可感知能力发生变化时同步更新。

## 更新规则

- 新增能力时新增一行。
- 修改已有能力时更新状态、角色、规格来源、测试状态和备注。
- 下线能力时不要直接删除，改成 `removed` 并保留历史说明。
- 如果一个功能变更无法直接链接到规格，至少要能链接到执行计划或设计文档。

## 状态枚举

- `proposed`
- `in-progress`
- `active`
- `deprecated`
- `removed`

## 当前清单

| 业务域 | 功能名称 | 状态 | 主要角色 | 规格来源 | 实现位置 | 测试状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 插件入口 | Activity Bar 面板与状态栏入口 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewProvider.ts` | manual | 含命令面板入口 |
| CLI 统一接入 | Codex / Claude / Gemini 多 CLI 切换 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/cli/*`, `src/extension.ts` | manual | 命令与参数可分别配置 |
| 执行模式 | Codex / Claude / Gemini 隐式重试与续接 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/interactive/*`, `src/extension.ts` | script+manual | 维护底层 thread/session 映射；Codex / Claude / Gemini 遇到非主动中断/异常时会隐式发送“继续/continue”自动重试，重试 5 次、每次间隔 30 秒，不展示这条隐式用户消息，但会追加系统提示说明当前是第几次自动重试；达到重试上限时会保留最近一次真实错误，避免只看到泛化提示；主动 stop 不会触发重试；Codex 子智能体（官方 `multi_agent`）可在工具设置按项目开启，默认关闭；工具设置支持“执行前自动压缩上下文”（默认开启），开启后会在非新会话的 Codex/Claude/Gemini 任务前先压缩上下文再继续执行；Codex 交互式运行会优先直接启动已解析 CLI，并补齐 `CODEX_HOME` / 工作区 trust / graceful shutdown 以降低长任务异常中断 |
| 执行模式 | 龙虾模式多轮主子任务执行 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | build+manual | 选择龙虾模式后沿用当前会话上下文，扩展按会话隔离写入 `~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json`（首次主任务尚未拿到真实会话 ID 时暂存 pending 路径，拿到会话 ID 后自动迁移），记录主任务、子任务、轮次概要和预计剩余轮次；并在 `~/.sinitek_cli/lobster-communications/<taskId>/` 维护主子任务沟通文件；工具设置支持配置新建龙虾任务最大主任务复核轮次（默认 20，范围 1-100，已有任务保持记录值），以及“子任务成功完成后自动关闭 AI 对话标签页”开关（默认开启）；龙虾主任务标签页会显示 `🦞` 前缀，且主任务或任一子任务仍在运行时禁止关闭主任务标签页；若在该主任务标签继续执行普通（非龙虾）任务，前缀会恢复为普通标签；点击不同类型会话标签会自动切换为龙虾/编码模式，新建标签默认编码模式；底部模型选择支持分别配置主任务模型与子任务模型，模型管理支持按模型设置“主任务/子任务”角色可用性；主任务返回 JSON 决策并在每次复核中预判 `estimatedRemainingRounds` 剩余轮次，扩展兼容旧 `subtask` 字段，并优先解析 `subtasks` 批次；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，能确认 `writeFiles` / `conflictGroup` 互不重叠时同一轮最多可派发 6 个子任务，扩展为批次内每个子任务创建独立新会话，并按声明的写入文件/冲突组自动规划组内并发、组间串行；每次 `status=continue` 的主任务 JSON 协议气泡会原位替换为 Markdown 子任务派发摘要，并同步追加到 `main-task.md`；只有批次内所有子任务都完成后才切回并唤醒主任务审核验收，不满足则继续启动下一批子任务，验收通过才结束；最终完成时主任务会返回整体总结和各轮子任务摘要，扩展写入任务记录与 `main-task.md`，并移除最终主任务 JSON 协议气泡，在对话中展示 assistant Markdown 最终总结气泡；子任务结束前必须写清沟通文件，供主任务唤醒后读取，且扩展会在子任务完成时自动追加“运行状态/单测状态/编译状态及判定依据”结构化记录，主任务可据此优先做逻辑复核而非重复执行验证；子任务出错会间隔 1 分钟自动重试最多 5 次；主任务中断后可在同一标签输入“继续/continue/resume”等短提示词恢复同一任务并从当前轮次继续，不再默认重开第一轮；子任务中断后在子任务标签手动继续时会强制按 coding 任务执行，不允许再次启动龙虾任务；任务记录与沟通目录都纳入 30 天保留清理；气泡标记 🦞/子任务 |
| 执行模式 | Gemini 一次性流式执行 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/cli/commandRunner.ts`, `src/cli/geminiStreamJson.ts`, `src/cli/geminiThinking.ts`, `src/extension.ts` | script+manual | 默认参数推荐 `--approval-mode auto_edit`，并补齐 `-p` 与 `--output-format stream-json`；解析 assistant delta / session_id / result；thinking 通过临时 system settings 覆盖层 + `-m/--model` alias 注入；当前未接入交互 Runner |
| 会话管理 | 多标签并行会话与历史记录 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | script+manual | 含 session、tab、prompt history，默认仅保留最近 30 天，并覆盖旧工作区清理；即使只有 1 个 conversation tab 也展示顶部标签；运行中 tab 使用主题 focus 色蓝色虚线流水边框，异常终止或进入自动重试等待期的 tab 显示错误红框，手动停止不标红，后续恢复输出或成功结束会恢复正常样式；历史会话列表会标记该会话是否已在 AI 对话 tabs 中打开，并移除“复制 ID”操作；从历史加载未打开的会话时会新建 tab 承载该会话，避免覆盖当前 tab；切换单个 tab 的 CLI 分组/历史会话时不应中断其他 tab 的运行中任务；conversation tab 超过 5 个时，顶部标签区启用左右翻页按钮，每页最多显示 5 个 tab；队列仅在上一个任务成功结束后才继续，失败/停止会保留剩余提示词，并可在队列弹窗手动继续 |
| Prompt 增强 | 当前文件/选区上下文注入 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/types.ts` | manual | 由编辑器上下文生成标签，可在工具设置开启，默认关闭 |
| Prompt 增强 | 路径选择器与 `@` 路径插入 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | manual | 依赖工作区文件搜索 |
| 附件能力 | 上传附件与 Codex 图片桥接 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/cli/commandRunner.ts` | manual | 临时文件落盘到 `~/.sinitek_cli/temp/` |
| 输出渲染 | Markdown / trace / task list 展示 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/webview/viewContent.ts`, `src/trace/*` | manual | 区分 thinking、tool-use、普通输出，最终成功回复使用强调样式 |
| 运行观测 | 当前 prompt、原始流消息与导出 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | manual | 支持 TXT 导出 |
| 交互控制 | Thinking mode / interactive mode / 模型管理 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/cli/config.ts`, `src/cli/modelArgs.ts`, `src/webview/viewContent.ts` | manual | 模型数据保存在 `~/.sinitek_cli/models.json` |
| 规则管理 | Global / Project 规则读写 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | manual | 覆盖 Codex / Claude / Gemini |
| 配置中心 | 配置档案、应用、备份、导出 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/webview/configPanel.ts`, `src/config/configService.ts` | manual | 独立 WebviewPanel |
| 平台集成 | Skills 管理（Codex / Claude / Gemini） | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/config/*Skills.ts`, `src/config/configService.ts` | manual | 支持本地扫描、内置官方目录与官方快照同步（含 OpenAI `cli-creator`） |
| 平台集成 | MCP 市场、安装、卸载、健康检查 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/config/configService.ts`, `media/mcp_marketplace.json` | manual | 多平台真实命令安装 |
| 稳定性 | 国际化、日志、错误诊断与清理 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/i18n.ts`, `src/logger.ts`, `src/errorDisplay.ts` | manual | 包含 Webview 回退页与日志保留，插件管理的历史痕迹（含 lobster task records / lobster communications）默认仅保留最近 30 天 |
