# Sinitek AI VS Code CLI 插件

该插件在 VS Code 中提供内置 AI 对话面板，统一接入本地 CLI（如 codex / gemini / claude），让用户在编辑器内完成对话、指令执行与结果展示。

## 适用场景

- 在 VS Code 内直接调用本地 AI CLI，无需切换终端
- 统一不同 CLI 的使用体验与展示效果
- 结合项目代码与对话上下文，提升开发效率

## 功能概览

- 内置 AI 对话面板
- 调用本地 CLI 执行请求并流式展示结果
- 多 CLI 消息按时间顺序展示

## 快速运行

```bash
./dev_run_mac.sh
```

## 调试

- 启动插件：在 VS Code 中按 `F5` 进入扩展开发主机。
- Webview 调试：`Ctrl+Shift+P` → 运行命令 `Developer: Toggle Developer Tools`。

## 导出可安装插件

```bash
./export_vscode_extension.sh
```

产物输出到 `dist/<name>-<version>.vsix`。
