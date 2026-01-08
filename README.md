# Sinitek AI VS Code CLI 插件

在 VS Code 中提供内置 AI 对话面板，调用本地 CLI（如 codex / gemini / claude）执行请求并展示结果。

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
