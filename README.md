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

## 用脚本导出插件（VSIX）

1. 安装依赖（首次或依赖变更后执行）：

   ```bash
   npm install
   ```

2. 安装 `vsce`（用于打包 VS Code 插件）：

   ```bash
   npm i -g @vscode/vsce
   ```

3. 在项目根目录执行导出脚本：

   ```bash
   ./export_vscode_extension.sh
   ```

4. 导出成功后会在 `dist/` 目录生成 `.vsix` 文件，命名格式为：

   ```text
   dist/sinitek-cli-tools-<version>.vsix
   ```

## 提醒

- 目前 mac 兼容性比较好，windows 还需要继续加强
