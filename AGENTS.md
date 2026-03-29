# AGENTS

本项目是 VS Code 插件。

作用：在 VS Code 中提供内置 AI 对话面板，调用本地 CLI（如 codex / gemini / claude）执行对话请求并展示结果。

# CLI 助手调用手册
- docs/cli-reference.md
- docs/VSCODE_CLI_PLUGIN_DEV_GUIDE
当你发现这个手册写的不对或者要补充时必须去修改目标文件

# 开发注意事项
- 本插件有国际化功能，支持中英文，新增修改功能时务必支持国际化。

# 本工具存储数据
~/.sinitek_cli/

# 本工具功能清单
- docs/插件功能清单.md 你在新增修改功能后要同步修改这个文件

# 其它
如果有改动，确保 media/official_skills_catalog.json 文件里的 description 翻译成中文