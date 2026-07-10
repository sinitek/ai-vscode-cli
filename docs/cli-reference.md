# CLI 助手调用手册

本文档是兼容入口。当前 CLI 运行事实来源请阅读：

- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/runbooks/local-development.md`

OpenCode 全局 MCP 的 local/remote 安装参数、XDG 配置位置和“连接失败仍属于已安装”的健康识别规则，以 `.ch/docs/references/cli-runtime-reference.md` 和 `.ch/docs/runbooks/PITFALLS.md` 为准。

工具设置“工作区”页中的 harness 骨架开关默认关闭。用户开启时会先弹窗确认；确认后才会安装当前工作区 `media/workspace-scaffold` 对应的 `.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 创建或追加模板、只引用 `AGENTS.md` 的 `CLAUDE.md`，并创建或补充根级 `.gitignore` 以忽略 `.codegraph/`，随后在终端启动 CodeGraph 设置。初始化收尾阶段会再弹窗询问是否让 AI 初始化 `ARCHITECTURE.md`；用户确认后，插件把当前 AI 对话切到 Vibe 模式，并复用当前选择的 CLI 分组、配置和模型发起项目架构分析任务。该开关同时控制插件侧长期记忆召回/写入：热区写入 `.ch/docs/memory/`，踩坑记录写入 `.ch/docs/runbooks/PITFALLS.md`。不控制 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、压缩或配置。

Claude 配置中心管理 `~/.claude/settings.json`，支持可视化与 JSON 高级模式。可视化覆盖官方常用核心字段，并可分别设置 `ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`；未展示字段、额外 `env`、hooks 和权限扩展会保留，非法 JSON 不覆盖有效可视化状态。完整口径以 `.ch/docs/references/cli-runtime-reference.md` 为准。

OpenCode 当前运行事实补充：配置中心只维护一个 `~/.opencode/config.json` 配置文件，不再要求、生成或保存 `~/.opencode/.env`；示例使用可解析的 `myAPI` 双模型严格 JSON，包含主模型默认 `options` / 可切换 `variants` 和小模型固定 `options` / 可选 `variants`。OpenCode 模式显示主模型与小模型两个下拉，候选只从 active config 的 `provider.<id>.models` 加载且不提供管理入口。one-shot / 并行 / Loop 对话请求仍使用主模型，通过 `--model provider/model` 和可选 `--variant` 运行；CLI 没有 `--small-model`，插件通过 runtime config overlay 覆盖顶层 `small_model`，且 OpenCode 内部小模型请求忽略 variants、实际使用自身 options。所有 OpenCode 任务默认加入官方 `--auto`，自动批准未被显式拒绝的权限请求并支持默认外部目录访问；显式 `deny` 仍优先，插件不会强制覆盖用户权限策略。`@ai-sdk/openai-compatible` 只代表 API 协议适配器，不决定推理档位。one-shot / 并行任务通过 `opencode run --auto --format json [message..]` 启动并解析 assistant 文本事件生成最终结论气泡；错误解析、空输出重试及非交互 Runner 约束以 `.ch/docs/references/cli-runtime-reference.md` 为准。配置中心不再从 Claude / Codex 生成 OpenCode 配置。
