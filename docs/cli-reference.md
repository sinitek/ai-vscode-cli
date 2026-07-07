# CLI 助手调用手册

本文档是兼容入口。当前 CLI 运行事实来源请阅读：

- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/runbooks/local-development.md`

工具设置“工作区”页中的 harness 骨架开关默认关闭。用户开启时会先弹窗确认；确认后才会安装当前工作区 `media/workspace-scaffold` 对应的 `.ch/`、`.agents/`、`ARCHITECTURE.md`、根级 `AGENTS.md` 创建或追加模板、只引用 `AGENTS.md` 的 `CLAUDE.md`，并创建或补充根级 `.gitignore` 以忽略 `.codegraph/`，随后在终端启动 CodeGraph 设置。初始化收尾阶段会再弹窗询问是否让 AI 初始化 `ARCHITECTURE.md`；用户确认后，插件把当前 AI 对话切到 Vibe 模式，并复用当前选择的 CLI 分组、配置和模型发起项目架构分析任务。该开关同时控制插件侧长期记忆召回/写入：热区写入 `.ch/docs/memory/`，踩坑记录写入 `.ch/docs/runbooks/PITFALLS.md`。不控制 Codex / Claude / Gemini 外部 CLI 自带记忆、历史、压缩或配置。
