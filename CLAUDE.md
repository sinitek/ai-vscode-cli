# AGENTS

本项目是 VS Code 插件。

作用：在 VS Code 中提供内置 AI 对话面板，调用本地 CLI（如 codex / gemini / claude）执行对话请求并展示结果。

# CLI 助手调用手册
- docs/cli-reference.md
- docs/VSCODE_CLI_PLUGIN_DEV_GUIDE
当你发现这个手册写的不对或者要补充时必须去修改目标文件

# AI CLI 助手调用代码参考
目标系统：/Users/fangjiawei/work/full_stack_black_light_framework/frontend/src/pages/ai-demo/AiAssistantDemoPage.tsx

# 本工具存储数据
~/.sinitek_cli/

# AI 助手气泡显示规则
三个 cli 的回复气泡必须按照流式消息时间顺序展示， 如果下一条消息和上一条消息类型一样，可以 append 在上一条气泡里，如果不一样就要新建气泡， 然后永远不要把内容补充到以前的气泡里。 