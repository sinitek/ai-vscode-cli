# CLI 助手调用手册

本文档是兼容入口。当前 CLI 运行事实来源请阅读：

- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/references/authoritative-skills.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/runbooks/local-development.md`

Loop 开发级 Workflow Skills 的字段、门禁、恢复与降级以 CLI 运行时参考为准；内置快照来源、许可和隔离以权威 Skills 文档为准；同步、测试与 VSIX 逐项核验以本地开发 runbook 为准。本文不重复维护这些规则。

Loop / Graph 模型语义：Claude 不接受插件侧模型选择；Codex 普通 Coding 仍使用单模型，切到 Loop 或 Graph 时显示主模型/子模型两个选择器；OpenCode 也统一显示主模型/子模型口径，底层 `model` / `small_model` 仅作为 OpenCode CLI 配置字段适配。Loop 主任务、主持/复核、续跑和唤醒使用主模型，Loop 子任务使用子模型；Graph planner 和最终 `summary` 节点使用主模型，Graph 其他执行节点使用子模型；子模型缺失时按主模型/单模型兼容回退并记录原因。内部 `<thinking>` / `<think>` / `<analysis>` / `<reasoning>` wrapper 会被定向解析或去标签，普通 HTML 标签不受影响。

OpenCode 全局 MCP 通过官方 XDG `opencode.json` 顶层 `mcp` 直接安装/卸载；local/remote 配置结构和“连接失败仍属于已安装”的健康识别规则，以 `.ch/docs/references/cli-runtime-reference.md` 和 `.ch/docs/runbooks/PITFALLS.md` 为准。

P0 性能与内存硬化运行口径：停止、扩展停用或 reload 会统一阻止新任务并尽力停止主进程、并行进程、交互运行和受管 OpenCode server。OpenCode one-shot / parallel / interactive raw stdout/stderr 只保留有界 tail，JSONL 未完成行限制为 64 KiB，activity 检测使用增量状态而不是每个 chunk 重扫完整历史。Run Stream 有记录数、单条字节和总字节预算，overlay 关闭时不构建完整记录 DOM；Assistant delta 流式阶段轻量更新，idle/final 阶段再完整 Markdown 渲染。附件上传在 Webview 与 Extension Host 双端限制为最多 10 个文件、单文件 10 MiB、总计 25 MiB，并按语言展示超限拒绝提示。

内置 MCP 市场目录已刷新为官方/权威候选，并通过 `npm run validate:mcp-marketplace` 校验中文描述、官方来源、安装配置和旧来源黑名单；目录口径以 `.ch/docs/references/cli-runtime-reference.md` 为准。

工具设置“工作区”页中的 harness 骨架开关默认关闭。用户开启时会先弹窗确认；确认后才会安装当前工作区 `media/workspace-scaffold` 对应的 `.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 创建或追加模板、只引用 `AGENTS.md` 的 `CLAUDE.md`，并创建或补充根级 `.gitignore` 以忽略 `.codegraph/`，随后在终端启动最新版 CodeGraph 安装、Codex MCP 注册和当前工作区索引初始化。该页还提供独立“安装 CodeGraph”按钮，可单独执行本机 CodeGraph CLI 安装/升级到最新版本；Windows 使用 `cmd.exe`，macOS 使用默认 shell。初始化收尾阶段会再弹窗询问是否让 AI 初始化 `ARCHITECTURE.md`；用户确认后，插件把当前 AI 对话切到 Vibe 模式，并复用当前选择的 CLI 分组、配置和模型发起项目架构分析任务。该开关同时控制插件侧长期记忆召回/写入：热区写入 `.ch/docs/memory/`，generated recall 写入运行态 `~/.sinitek_cli/memory-generated/<workspace>/memory-index/`，踩坑记录写入 `.ch/docs/runbooks/PITFALLS.md`。不控制 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、压缩或配置。

Claude 配置中心管理 `~/.claude/settings.json`，支持可视化与 JSON 高级模式，点击配置档案默认进入 JSON 源码模式。可视化覆盖官方常用核心字段，并可分别设置 `ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`；未展示字段、额外 `env`、hooks 和权限扩展会保留，非法 JSON 不覆盖有效可视化状态。Claude / OpenCode / Codex 三组可视化参数 label 右侧都有问号 tooltip，枚举参数提示可选值；三组“查看范例”统一放在配置文件名右侧。完整口径以 `.ch/docs/references/cli-runtime-reference.md` 为准。

配置入口：从 AI 对话面板点击“配置”会立即打开并前台聚焦 VS Code 编辑器主区域内的 `WebviewPanel`，随后尝试进入 VS Code Zen Mode，隐藏工作台外围以接近全屏弹窗；重复点击复用同一面板，关闭后恢复由本插件进入的 Zen Mode。VS Code 扩展公开 API 不支持任意 Webview 的原生模态弹窗，Zen Mode 不可用时回退为普通编辑器面板；配置中心自身会铺满 WebviewPanel 剩余视口，大型配置浮层使用近满屏宽高以减少左右和底部空白；不启动独立浏览器或本地 HTTP 页面，视觉颜色和字体使用 VS Code 主题语义变量。完整产品口径以 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 为准。

Codex 配置中心管理 `~/.codex/config.toml` 与 `~/.codex/.env`。`config.toml` 是 Codex 主配置文件，格式为 TOML，不是 JSON；配置卡片支持可视化编辑和 TOML 源码编辑，点击配置档案默认进入 TOML 源码模式；Provider 可视化不再提供 `env_key` 输入，常用密钥固定由 `.env` 的 `OPENAI_API_KEY` 管理，`.env` 作为独立环境变量文件保存。配置页空白优先排查本插件 Webview 渲染和配置解析；`AugmentExtensionSidecar` 403 通常属于 Augment 扩展侧请求失败，不直接说明本插件配置页故障。完整口径以 `.ch/docs/references/cli-runtime-reference.md` 为准。

OpenCode 当前运行事实补充：OpenCode 官方 TUI commands 文档支持 `/compact`（alias `/summarize`）来 compact current session，配置文档支持 `compaction.auto` 默认自动压缩，并提供 `OPENCODE_DISABLE_AUTOCOMPACT` 环境变量关闭自动压缩；插件侧可纳入手动压缩按钮和执行后自动压缩，但非交互模式是否能可靠附着既有会话以 runtime/UI 子任务验证为准。OpenCode 在插件里明确分成两个配置文件：模型/Provider 配置中心维护 `~/.opencode/config.json`，全局 MCP 安装/卸载维护官方 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`；模型配置卡片点击配置档案默认进入 JSON 源码模式，且不再要求、生成或保存 `~/.opencode/.env`。模型配置示例使用可解析的 `myAPI` 双模型严格 JSON，包含主模型默认 `options` / 可切换 `variants` 和子模型固定 `options` / 可选 `variants`，不再内嵌 MCP 示例以免混淆。OpenCode 模式显示主模型与子模型两个下拉，候选只从 active config 的 `provider.<id>.models` 加载且不提供管理入口；底层顶层 `model` 对应主模型，`small_model` 作为 OpenCode CLI 兼容字段对应子模型。普通 one-shot / 并行对话使用主模型；Loop 主任务、主持/复核、续跑和唤醒使用主模型，Loop 子任务使用子模型；Graph planner 与最终 `summary` 节点使用主模型，Graph 其他执行节点使用子模型。主模型通过 `--model provider/model` 和可选 `--variant` 运行；CLI 没有 `--small-model`，插件通过 runtime config overlay 覆盖顶层 `small_model`，且 OpenCode 内部 `small: true` 请求忽略 variants、实际使用该角色模型自身 options。所有 OpenCode 任务默认加入官方 `--auto`，自动批准未被显式拒绝的权限请求并支持默认外部目录访问；显式 `deny` 仍优先，插件不会强制覆盖用户权限策略。`@ai-sdk/openai-compatible` 只代表 API 协议适配器，不决定推理档位。one-shot / 并行任务通过 `opencode run --auto --format json [message..]` 启动并解析 assistant 文本事件生成最终结论气泡；JSONL 进度/工具事件只算运行活动不算结论，但 `text`、`reasoning`、`step_start` 和 `tool_use` 会实时转成 assistant / thinking / tool-use 气泡；只在启动后 60 秒完全无 activity 时触发空输出重试，首个有效事件后不再按父 JSONL 静默超时；错误解析、空输出重试及非交互 Runner 约束以 `.ch/docs/references/cli-runtime-reference.md` 为准。配置中心不再从 Claude / Codex 生成 OpenCode 配置。
