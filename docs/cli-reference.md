# CLI 助手调用手册

本文档是兼容入口。当前 CLI 运行事实来源请阅读：

- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/runbooks/local-development.md`

工具设置“工作区”页中的 harness 骨架开关默认关闭。用户开启时会先弹窗确认；确认后才会安装当前工作区 `media/workspace-scaffold` 对应的 `.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 创建或追加模板、只引用 `AGENTS.md` 的 `CLAUDE.md`，并创建或补充根级 `.gitignore` 以忽略 `.codegraph/`，随后在终端启动 CodeGraph 设置。初始化收尾阶段会再弹窗询问是否让 AI 初始化 `ARCHITECTURE.md`；用户确认后，插件把当前 AI 对话切到 Vibe 模式，并复用当前选择的 CLI 分组、配置和模型发起项目架构分析任务。该开关同时控制插件侧长期记忆召回/写入：热区写入 `.ch/docs/memory/`，踩坑记录写入 `.ch/docs/runbooks/PITFALLS.md`。不控制 Codex / Claude / OpenCode 外部 CLI 自带记忆、历史、压缩或配置。

OpenCode 当前运行事实补充：配置中心只维护一个 `~/.opencode/config.json` 配置文件，不再要求、生成或保存 `~/.opencode/.env`；示例遵循 OpenCode `config.json` 口径，当前激活配置会在运行前应用到 OpenCode 子进程。one-shot / 并行任务通过 `opencode run --format json [message..]` 启动并解析 assistant 文本事件生成最终结论气泡。OpenCode 非零退出时也会解析 stdout JSON `error` 事件，并优先把 `APIError`、HTTP status、provider message、`responseBody.error.code` 和请求 URL 展示到错误气泡；没有可解析 JSON error 时才回退通用退出码。OpenCode 启动后长时间没有 stdout/stderr 输出会转成空输出超时错误并进入 hidden retry；重试耗尽后必须追加可见 system 错误气泡并写入会话存档。OpenCode 当前不走 Codex / Claude 交互 Runner，避免误触发 `interactive-runner-unsupported:opencode`。OpenAI-compatible 自定义 provider 需使用实际 API endpoint；范例 provider 名称统一使用 `myAPI`，`models.<id>.name` 是展示名，`model=provider/<真实模型 id>` 才是实际调用目标。配置中心不再从 Claude / Codex 生成 OpenCode 配置。
