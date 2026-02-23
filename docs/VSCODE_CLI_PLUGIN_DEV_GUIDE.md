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

说明：
- Webview 依赖 `media/marked.min.js`（内嵌到 HTML）；升级 `marked` 版本后需同步更新该文件。
- `.vscodeignore` 会排除 `node_modules`，避免运行时从 `node_modules` 读取前端资源。

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
        },
        "sinitek-cli-tools.macTaskShell": {
          "type": "string",
          "enum": ["zsh", "bash"],
          "default": "zsh",
          "description": "macOS 下对话任务执行使用的 shell。"
        },
        "sinitek-cli-tools.debug": {
          "type": "boolean",
          "default": false,
          "description": "开启调试日志，记录 CLI stdin/stdout/stderr。"
        }
      }
    }
  }
}
```

## 核心实现

## 聊天面板消息渲染规则

- 同角色连续消息可合并为同一气泡，便于减少碎片。
- Trace 统一经由 `traceSegment` 事件进入前端（包含 Claude one-shot 与 interactive），避免不同 CLI 走不同渲染分支。
- `file update`、`exec`、`tool/调用工具` 类型 trace 必须保持独立气泡（`merge=false`），不允许与前后消息合并。
- `kind=thinking` 的事件统一走助手增量输出（`appendAssistantChunk`），不单独渲染 trace 气泡。
- 有新气泡时，仅当聊天已在底部才自动滚动（贴底判定阈值 20px）；若用户正在查看历史位置，保持当前位置与已展开/收起状态不变。
- 当聊天未贴底时，右下角显示蓝色“跳转到最新消息”浮动图标；点击后平滑滚动到最底部。

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

### Codex Skills 配置

- 配置面板会读取 `~/.codex/skills` 下的技能目录（需包含 `SKILL.md`）。
- 在配置页可对单个技能进行启用/禁用，并支持一键启用/禁用。
- 保存时会将技能状态写入 `~/.codex/config.toml` 的受控区块：
  - `# --- sinitek codex skills start ---`
  - `# --- sinitek codex skills end ---`
- 该区块只写入禁用项（`enabled = false`），不影响用户自定义的其它 TOML 配置。

### Codex MCP 市场安装策略

- Codex 平台在配置中心点击 MCP 市场“添加”时，会调用真实命令安装：`codex mcp add ...`。
- 安装状态通过 `codex mcp list --json` 回读，而不是仅根据编辑器中的 TOML 文本推断。
- stdio MCP 会按可用 `env` 值追加 `--env KEY=VALUE`；占位值（如 `<YOUR_API_KEY>`）会跳过并给出警告。
- HTTP MCP 会优先写入 `--url`；当 `Authorization` 头是 `Bearer $TOKEN` / `Bearer ${TOKEN}` 时，自动映射为 `--bearer-token-env-var TOKEN`。

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

补充说明：
- 思考模式的面板选择会按工作区分别保存，数据位于 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`。

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
- 交互会话模式：支持 `coding / plan`，默认 `coding`（按 CLI 维度记住最后选择）。
- 自动降级：SDK 初始化/运行失败时自动降级回现有“一问一进程”模式。
- 切换会话释放 Runner：每个 CLI 只维护 1 个当前会话 Runner，切换会话会销毁旧 Runner。
- 空闲释放：24 小时无交互自动释放 Runner。
- 切换思考模式：下一次交互会重建 Runner，并沿用已有会话/线程 ID 继续对话。

### 设置项（工作区级）

- `sinitek-cli-tools.interactive.codex`：是否开启 Codex 交互模式（默认 true）
- `sinitek-cli-tools.interactive.claude`：是否开启 Claude 交互模式（默认 true）

面板内会显示“交互：开启/关闭(Beta)”下拉，修改后会写入当前工作区设置（scope=resource）。

输入区“配置”按钮左侧还提供 `coding / plan` 模式切换：
- `coding`：保持当前可执行编辑/工具调用策略。
- `plan`：
  - Codex 交互 Runner 强制 `sandbox=read-only` + `approval=untrusted`。
  - Claude 交互 Runner 使用 `permissionMode=plan`。

### 上下文压缩（手动触发）

- 入口：交互模式开启时，输入区 `@` 左侧新增“常用指令”按钮。
- 指令：当前仅提供“压缩上下文”，点击后仅执行压缩命令，不再弹出发送前提示。
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

默认仅记录必要启动信息（工作目录、启动参数、启动环境变量，敏感字段会脱敏）到 `~/.sinitek_cli/logs`，异常也会记录。
如需查看底层 CLI 的标准输入/输出/错误，可在设置中勾选 `sinitek-cli-tools.debug`。调试开启后，除了必要日志外，还会在 `sinitek-cli.<cli>.<date>.log` 中记录流式输出，并额外追加 Claude/Codex 的模型 JSON 事件与格式化文本输出。单个日志文件最大 10MB，超过后自动分段到 `sinitek-cli.<cli>.<date>.<n>.log`（`n` 从 1 开始）。

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

如需一键构建 + 打包 + 发布到 Marketplace：

```
./publish_vscode_extension.sh
```

说明：
- 首次发布请先完成 `vsce login <PublisherID>`，或设置环境变量 `VSCE_PAT` / `VSCODE_MARKETPLACE_PAT`（脚本会自动读取）。
- 脚本会执行：`npm run build` → `vsce package` → `vsce publish --packagePath <vsix>`。

Windows 下可使用：

```
py -3.12 vscode_extension_win.py package
```

注意：
- 本项目未使用打包器（webpack/esbuild），运行时依赖需随 VSIX 一起打包。
- `.vscodeignore` 需要排除 `node_modules`，但必须放行运行时依赖（当前白名单：`@anthropic-ai/claude-agent-sdk` / `@openai/codex-sdk` / `zod`），否则动态导入会在运行时找不到模块。

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
4) 交互模式 Claude 提示 `Invalid API key · Please run /login`：
   - 交互模式在 Extension Host 内运行，使用 VS Code 启动时的环境变量与工作区 cwd。
   - Claude 交互模式会尝试解析 PATH 中的 `claude` 可执行文件（Windows `.cmd/.bat` 通过 `cmd.exe` 启动），请确保 CLI 已安装且 PATH 可见。
   - 如果 API key 仅在 shell profile 中设置，请确保 VS Code 启动环境可读取；或把 key 写入系统环境变量 / 项目内 `.claude/settings.json`。
   - 可临时关闭 `sinitek-cli-tools.interactive.claude` 验证是否为交互模式差异导致。


## Auto Context Tag (Current File / Selection)
- Two removable default tags are shown above the input: `Current File` and `Selection`.
- Tags are auto-included once, then cleared after a successful send; changing active file/selection auto-arms for next send. If a tag is manually removed, it only re-arms after its corresponding context actually changes.
- Webview adds `contextOptions` to `sendPrompt`:
  - `includeCurrentFile: boolean`
  - `includeSelection: boolean`
- Extension injects references before sending to CLI (uses `@<relative-path>` instead of raw file content).
  - current file -> `@<relative-path>`
  - selection -> range hint like `Selected range in @<relative-path>: Lx:Cx-Ly:Cy`
- User bubble only shows compact context tags (similar to input tags), avoiding long context text in chat history.
- Extension syncs editor state through `state.editorContext` and incremental `editorContext` messages.
