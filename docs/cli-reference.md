# CLI 助手调用手册

本文档是兼容入口。当前 CLI 运行事实来源请阅读：

- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/runbooks/local-development.md`

长期记忆开关属于插件侧工具设置：默认开启，可关闭，显式 `false` 防误开优先。它只控制插件侧 `~/.sinitek_cli/memory/` 记忆层，不控制 Codex / Claude / Gemini 外部 CLI 自带记忆、历史、压缩或配置。
