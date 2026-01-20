# VS Code 插件开发手册：三方 CLI 调用与切换

本手册用于指导你开发一个 VS Code 插件，统一调用本机的 `codex`、`claude`、`gemini` CLI，并支持快速切换与参数配置。

## 目标与边界

- 目标：在 VS Code 内选择并调用 3 个 CLI；支持自定义命令与参数；支持“思考模式”等开关参数。
- 边界：不替换 CLI，本地执行；不修改 UI/UX 布局；不引入额外技术栈或版本变更。

## 约定与规范

- 所有配置项集中在 `package.json` 的 `contributes.configuration`。
- 所有命令统一前缀 `sinitek-cli-tools.*`，便于检索与复用。
- 所有可变项从设置中读取，避免硬编码。

## 目录结构建议

```
sinitek-cli-tools/
  package.json
  src/
    extension.ts
    cli/
      commandRunner.ts
      config.ts
      types.ts
```

## 初始化工程

推荐使用官方脚手架：

```
npm init @vscode/extension
```

选择 TypeScript 模板，便于类型约束与可维护性。

## package.json 关键配置

**贡献命令与配置项**：

```json
{
  "activationEvents": [
    "onCommand:sinitek-cli-tools.selectCli",
    "onCommand:sinitek-cli-tools.runCli"
  ],
  "contributes": {
    "commands": [
      { "command": "sinitek-cli-tools.selectCli", "title": "CLI Bridge: Select CLI" },
      { "command": "sinitek-cli-tools.runCli", "title": "CLI Bridge: Run Current CLI" }
    ],
    "configuration": {
      "title": "CLI Bridge",
      "properties": {
        "sinitek-cli-tools.defaultCli": {
          "type": "string",
          "enum": ["codex", "claude", "gemini"],
          "default": "codex"
        },
        "sinitek-cli-tools.commands.codex": {
          "type": "string",
          "default": "codex"
        },
        "sinitek-cli-tools.commands.claude": {
          "type": "string",
          "default": "claude"
        },
        "sinitek-cli-tools.commands.gemini": {
          "type": "string",
          "default": "gemini"
        },
        "sinitek-cli-tools.args.codex": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["--dangerously-bypass-approvals-and-sandbox", "--sandbox", "danger-full-access", "--enable", "web_search_request"]
        },
        "sinitek-cli-tools.args.claude": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["--dangerously-skip-permissions"]
        },
        "sinitek-cli-tools.args.gemini": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["-y"]
        }
      }
    }
  }
}
```

## 核心实现

### 配置读取（src/cli/config.ts）

```ts
import * as vscode from "vscode";

export const CONFIG_NAMESPACE = "sinitek-cli-tools";
export const CLI_LIST = ["codex", "claude", "gemini"] as const;
export type CliName = (typeof CLI_LIST)[number];

export function getDefaultCli(): CliName {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<CliName>("defaultCli", "codex");
}

export function getCliCommand(cli: CliName): string {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string>(`commands.${cli}`, cli);
}

export function getCliArgs(cli: CliName): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string[]>(`args.${cli}`, []);
}
```

### CLI 调用（src/cli/commandRunner.ts）

```ts
import * as vscode from "vscode";
import { spawn } from "cross-spawn";
import { CliName } from "./types";
import { getCliArgs, getCliCommand } from "./config";

export async function runCli(cli: CliName): Promise<void> {
  const command = getCliCommand(cli);
  const args = getCliArgs(cli);

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
  });

  const joinedArgs = args.map((arg) => escapeShellArg(arg)).join(" ");
  terminal.sendText(`${command} ${joinedArgs}`.trim());
}

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}
```

说明：
- `runCli` 仅把命令发送到 VS Code 集成终端（不自动弹出终端窗口）。
- Webview 面板内的对话执行使用 `spawn` + stdio 流式读取（见 `runCliStream`），不会打开额外窗口。

### 命令注册（src/extension.ts）

```ts
import * as vscode from "vscode";
import { CLI_LIST, CliName, getDefaultCli } from "./cli/config";
import { runCli } from "./cli/commandRunner";

let currentCli: CliName;

export function activate(context: vscode.ExtensionContext) {
  currentCli = getDefaultCli();

  context.subscriptions.push(
    vscode.commands.registerCommand("sinitek-cli-tools.selectCli", async () => {
      const selection = await vscode.window.showQuickPick(CLI_LIST, {
        placeHolder: "选择要使用的 CLI",
      });
      if (!selection) {
        return;
      }
      currentCli = selection;
      vscode.window.showInformationMessage(`当前 CLI：${currentCli}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sinitek-cli-tools.runCli", async () => {
      await runCli(currentCli);
    })
  );
}
```

## 支持“思考模式”切换

通过配置参数实现，避免在代码里写死。例如：

```json
{
  "sinitek-cli-tools.args.claude": ["--thinking", "on"],
  "sinitek-cli-tools.args.codex": ["--reasoning", "high"],
  "sinitek-cli-tools.args.gemini": ["--mode", "pro"]
}
```

可在面板内切换思考模式（全局：`off` / `low` / `medium` / `high`；Codex 额外支持 `xhigh`），并可针对不同档位配置：

```json
{
  "sinitek-cli-tools.thinkingModeCodex": "xhigh",
  "sinitek-cli-tools.thinkingArgs.codex.xhigh": ["-c", "model_reasoning_effort=high"],
  "sinitek-cli-tools.thinkingPromptPrefix.claude.on": "请仔细推理后回答：",
  "sinitek-cli-tools.thinkingWorkspaceFiles.gemini.on": [
    {
      "path": ".gemini/settings.json",
      "content": "{\n  \"modelConfigs\": {\n    \"overrides\": [\n      {\n        \"match\": { \"model\": \"gemini-2.5-pro\" },\n        \"config\": {\n          \"generateContentConfig\": {\n            \"thinkingConfig\": { \"thinkingBudget\": 8192 }\n          }\n        }\n      }\n    ]\n  }\n}"
    }
  ]
}
```

如果需要开关，可扩展命令：
- `sinitek-cli-tools.runCliThinkingOn`
- `sinitek-cli-tools.runCliThinkingOff`

逻辑复用同一个 `runCli`，仅在运行前注入参数。

## 支持“交互模式”（常驻 Runner + 上下文压缩）

本项目已按 `docs/支持交互.md` 落地 **Codex + Claude** 的交互模式（Gemini 暂不纳入）。

### 行为概述

- 默认开启（Beta）：同一会话内多轮对话复用 SDK Runner（避免“一问一进程”的冷启动）。
- 自动降级：SDK 初始化/运行失败时自动降级回现有“一问一进程”模式。
- 切换会话释放 Runner：每个 CLI 只维护 1 个当前会话 Runner，切换会话会销毁旧 Runner。
- 空闲释放：10 分钟无交互自动释放 Runner。

### 设置项（工作区级）

- `sinitek-cli-tools.interactive.codex`：是否开启 Codex 交互模式（默认 true）
- `sinitek-cli-tools.interactive.claude`：是否开启 Claude 交互模式（默认 true）

面板内会显示“交互：开启/关闭(Beta)”下拉，修改后会写入当前工作区设置（scope=resource）。

### 上下文压缩（混合模式）

- 触发阈值（满足任一即提示）：
  - 轮数阈值：30（按 user 消息条数估算）
  - 字符阈值：24000（按消息 content 总长度估算）
- 提示时机：点击发送后、真正发给模型前弹窗确认。
- 按钮：`现在压缩 / 这次跳过 / 本会话不再提示`（“本会话不再提示”仅内存生效，不落盘）。
- 策略：压缩后新开 thread/session 继续、旧 thread/session 冻结；新上下文包含“摘要 + 最近 3 轮原文”。

### 会话映射落盘

压缩会导致底层 thread/session 发生变化，但扩展侧会话 ID 保持不变，因此需要映射落盘：

- `~/.sinitek_cli/sessions/<workspaceKey>.meta.json`
- 结构示例：
  - `byCli.codex[sessionId] -> { threadId, frozenThreadIds, updatedAt }`
  - `byCli.claude[sessionId] -> { sessionId, frozenSessionIds, updatedAt }`


## 调试与运行

```
F5
```

在新窗口中打开命令面板，执行：
- `CLI Bridge: Select CLI`
- `CLI Bridge: Run Current CLI`

Windows 下也可使用 Python 脚本一键启动（会 `npm install` + `npm run build`，然后以扩展开发模式打开 VS Code）：

```
py -3.12 vscode_extension_win.py dev
```

## 打包发布（可选）

```
npm i -g @vscode/vsce
vsce package
```

已封装快捷脚本：`./export_vscode_extension.sh`，会自动输出到 `dist/<name>-<version>.vsix`。

Windows 下可使用：

```
py -3.12 vscode_extension_win.py package
```

## 常见问题

1) CLI 找不到（常见报错：`spawn <cli> ENOENT`）：
   - 先在系统终端确认 CLI 是否可用：
     - Windows（PowerShell）：`where codex` / `where claude` / `where gemini`
     - macOS/Linux：`which codex` / `which claude` / `which gemini`
   - 如果系统终端能找到，但 VS Code 里找不到：安装/修改 PATH 后重启 VS Code（Extension Host 不会自动刷新 PATH）。
   - Windows 下若使用 npm 全局安装，常见可执行文件在 `%APPDATA%\\npm\\`（例如 `%APPDATA%\\npm\\codex.cmd` / `claude.cmd` / `gemini.cmd`），可直接将其配置为绝对路径：
     - `sinitek-cli-tools.commands.codex`
     - `sinitek-cli-tools.commands.claude`
     - `sinitek-cli-tools.commands.gemini`
2) 参数包含空格：使用数组配置，插件会自动处理转义。
3) 想用别名：建议配置为完整命令，避免依赖 shell alias。
