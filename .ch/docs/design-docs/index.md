# 设计文档导航

本目录保留实际实现的职责边界与关键取舍；系统架构入口为 `ARCHITECTURE.md`，验证入口为 `.ch/docs/TESTING.md`。

- `settings-message-commands.md`：设置消息 Command + Facade、领域依赖、匹配/刷新/异常契约及新增命令方式。
- `config-center-request-commands.md`：配置中心请求命令和服务/宿主边界。
- `vscode-cli-extension-runtime.md`：VS Code CLI 扩展运行时。
- `loop-plus-scheduling.md`、`loop-subtask-session-reuse.md`：Loop+ 调度及子任务会话复用。
- `loop-crash-recovery.md`：宿主崩溃后的子任务状态、完成回报与主任务恢复。
- `chat-bubble-retention.md`、`loop-group-chat-bubble-limit.md`：主对话及群聊消息保留。
- `skill-archive-installation.md`：Skills 归档安装边界。
