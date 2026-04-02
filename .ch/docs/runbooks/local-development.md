# 本地开发与打包手册

本文档吸收了原 `docs/DEBUG.md`、`docs/DEVELOPMENT.md` 以及旧开发手册中仍有效的运行方式，作为当前仓库的本地开发 runbook。

## 适用范围

- 本地开发 VS Code 插件
- 调试 Webview 与 Extension Host
- 打包导出 VSIX

## 日常开发命令

### 1. 安装依赖

```bash
npm install
```

### 2. 构建插件

```bash
npm run build
```

### 3. 开发期持续编译

```bash
npm run watch
```

### 4. 一键启动开发主机（macOS）

```bash
./run_dev.sh
```

该脚本会：

- 自动执行 `npm install`
- 自动执行 `npm run build`
- 以 `--extensionDevelopmentPath` 方式启动 VS Code

如果脚本找不到 `code` 命令，会提示先在 VS Code 中安装 shell command。

## 推荐调试流程

### Extension Host 调试

1. 在仓库根目录执行 `npm run build`
2. 用 VS Code 打开当前仓库
3. 按 `F5` 启动 Extension Development Host
4. 在新的开发主机窗口中验证侧边栏、命令和 Webview 行为

### Webview 调试

在 VS Code 或开发主机中执行：

```text
Developer: Toggle Developer Tools
```

适用场景：

- 排查聊天面板脚本错误
- 查看 `postMessage` / `onDidReceiveMessage` 行为
- 检查 Webview DOM、样式与运行时异常

## 打包 VSIX

### 1. 安装 vsce

```bash
npm i -g @vscode/vsce
```

### 2. 导出插件

```bash
./export_vscode_extension.sh
```

导出脚本会：

- 读取 `package.json` 中的版本号
- 调用 `vsce package`
- 输出到 `dist/sinitek-cli-tools-<version>.vsix`

## 最小交付前检查

因为本项目是 Node/TypeScript 插件，文档、配置或代码变更收尾前至少要确认：

```bash
npm run build
```

## 关键路径

- 入口：`src/extension.ts`
- 聊天面板 Webview：`src/webview/viewContent.ts`
- 配置中心面板：`src/webview/configPanel.ts`、`src/webview/configView.ts`
- 打包脚本：`export_vscode_extension.sh`
- 本地开发脚本：`run_dev.sh`

## 常见问题

### `code` 命令不存在

在 VS Code 中执行：

```text
Cmd+Shift+P -> Shell Command: Install 'code' command in PATH
```

### 构建后看不到最新效果

优先确认：

- 是否执行了 `npm run build` 或 `npm run watch`
- 是否重开了 Extension Development Host
- 是否需要重新加载 Webview / 打开开发者工具检查前端报错
