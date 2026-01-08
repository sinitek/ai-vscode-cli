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
import { spawn } from "child_process";
import * as vscode from "vscode";
import { CliName, getCliArgs, getCliCommand } from "./config";

export async function runCli(cli: CliName): Promise<void> {
  const command = getCliCommand(cli);
  const args = getCliArgs(cli);

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
  });
  terminal.show(true);

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

## 调试与运行

```
F5
```

在新窗口中打开命令面板，执行：
- `CLI Bridge: Select CLI`
- `CLI Bridge: Run Current CLI`

## 打包发布（可选）

```
npm i -g @vscode/vsce
vsce package
```

已封装快捷脚本：`./export_vscode_extension.sh`，会自动输出到 `dist/<name>-<version>.vsix`。

## 常见问题

1) CLI 找不到：确认 PATH，或在配置中写绝对路径。
2) 参数包含空格：使用数组配置，插件会自动处理转义。
3) 想用别名：建议配置为完整命令，避免依赖 shell alias。
