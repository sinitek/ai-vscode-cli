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
- Trace 统一经由 `traceSegment` 事件进入前端（包含 Gemini one-shot 与 Codex/Claude interactive），避免不同 CLI 走不同渲染分支。
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

### Claude Skills 配置

- 配置面板会读取 `~/.claude/skills` 下包含 `SKILL.md` 的技能目录。
- 在配置页可对单个技能进行启用/禁用，并支持一键启用/禁用。
- 保存时会将禁用状态写入 `~/.claude/settings.json` 的 `permissions.deny`，规则格式为 `Skill(<skill-name>)`。
- Claude Skills 弹窗内置 `anthropics/skills` 官方 GitHub 快照（按官方 marketplace 分组整理为 `document-skills`、`example-skills`、`claude-api`），点击“直接安装”会将对应 ZIP 解压到 `~/.claude/skills/<skill-name>`。
- 通过配置中心安装/更新的官方 Skill 会写入 `.sinitek-official-skill.json` 元数据；弹窗据此展示“最新 / 可更新 / 版本未知”状态，并且在“安装 Skills”与“已安装 Skills”两个标签页中都支持直接更新或卸载。

### Codex Skills 配置

- 配置面板会按优先级读取技能目录（需包含 `SKILL.md`）：工作区及其父目录的 `.codex/skills` / `.agents/skills` → `~/.agents/skills` → `~/.codex/skills`（兼容旧路径）→ `/etc/codex/skills`。
- 在配置页可对单个技能进行启用/禁用，并支持一键启用/禁用。
- Codex Skills 弹窗内置 `openai/skills` 官方 curated GitHub 快照，点击“直接安装”会优先解压到 `$CODEX_HOME/skills/<skill-name>`；若未设置 `CODEX_HOME`，则解压到 `~/.codex/skills/<skill-name>`。
- 通过配置中心安装/更新的官方 Skill 会写入 `.sinitek-official-skill.json` 元数据；弹窗据此展示“最新 / 可更新 / 版本未知”状态，并且在“安装 Skills”与“已安装 Skills”两个标签页中都支持直接更新或卸载。
- 保存时会将技能状态写入 `~/.codex/config.toml` 的受控区块：
  - `# --- sinitek codex skills start ---`
  - `# --- sinitek codex skills end ---`
- 该区块只写入禁用项（`enabled = false`），不影响用户自定义的其它 TOML 配置。

### Gemini Skills 配置

- 配置面板会按优先级读取技能目录（需包含 `SKILL.md`）：工作区及其父目录 `.gemini/skills` → `~/.gemini/skills` → `/etc/gemini/skills`。
- 在配置页可对单个技能进行启用/禁用，并支持一键启用/禁用。
- 保存时会将禁用状态写入 `~/.gemini/settings.json` 的 `skills.disabled`；默认保持 `skills.enabled = true`。
- 仅管理当前面板可见技能名对应的禁用项，不会覆盖用户手动维护的其它 `skills.disabled` 规则。

### Gemini 官方 Extensions

- Gemini 平台的 Skills 弹窗额外提供“安装 Extensions”标签，用于安装官方 `gemini-cli-extensions` 快照资源。
- 插件内置的官方扩展 ZIP 会安装到 `~/.gemini/extensions/<extension-name>`；其中 `<extension-name>` 取自扩展根目录 `gemini-extension.json` 的 `name`。
- 插件会为通过内置资源安装的官方 Extension 写入元数据，用于判断“最新 / 可更新 / 版本未知”状态，并支持后续更新、卸载。
- Gemini 本地 Skills 与官方 Extensions 分开管理：前者控制 `skills.disabled`，后者只负责扩展目录安装、更新与卸载。

### 多 Tab 并发执行

- Interactive 模式下，运行态、停止控制、消息流、任务列表都会按 Tab 隔离。
- 在某个 Tab 中启动新任务时，不会再自动中断其他 Tab 正在运行的任务。
- 切换 Tab 只会切换当前展示的消息、运行状态与任务列表，不会向 CLI 发送停止指令。

### MCP 市场安装/卸载策略

- Codex 平台在配置中心点击 MCP 市场“添加”时，会调用真实命令安装：`codex mcp add ...`。
- Claude 平台在配置中心点击 MCP 市场“添加”时，会调用真实命令安装；其中 stdio MCP 优先通过 `claude mcp add-json --scope user ...` 写入完整配置，避免 `claude mcp add` 在带 `--env` 参数时把环境变量误写进命令参数。HTTP/SSE MCP 仍使用 `claude mcp add --scope user ...`。
- Gemini 平台在配置中心点击 MCP 市场“添加”时，会调用真实命令安装：`gemini mcp add --scope user ...`；当当前 `gemini` 命令受本机 Node 版本影响无法直接执行时，插件会回退到 Node 20 + Gemini CLI 入口执行命令。
- 如果某个 MCP 在市场配置中声明了 `env`，安装前会先弹出环境变量配置窗口，要求用户填写变量值；窗口内会优先使用该 MCP 的 `signupUrl` 作为官网/注册地址点击入口；若未配置则回退到 `homepage`，便于先注册再回填。
- 例如 Context7 条目会要求填写 `CONTEXT7_API_KEY`，并提供 `https://context7.com/dashboard` 作为登录/创建 API Key 的入口。
- Codex 平台在配置中心点击 MCP 市场“卸载”时，会调用真实命令卸载：`codex mcp remove <name>`，并兼容性地同步清理 `~/.codex/config.toml` 中对应的 `[mcp_servers.<name>]` 配置段。
- Claude 平台在配置中心点击 MCP 市场“卸载”时，会调用真实命令卸载：`claude mcp remove --scope user <name>`，并兼容性地同步清理 `~/.claude.json` 中的 `mcpServers.<name>`。
- Gemini 平台在配置中心点击 MCP 市场“卸载”时，会调用真实命令卸载：`gemini mcp remove --scope user <name>`；当当前 `gemini` 命令受本机 Node 版本影响无法直接执行时，插件会回退到 Node 20 + Gemini CLI 入口执行命令；同时兼容性地同步清理 `~/.gemini/settings.json` 中的 `mcpServers.<name>`。
- Codex 安装状态通过 `codex mcp list --json` 回读，而不是仅根据编辑器中的 TOML 文本推断。
- Claude / Gemini 的健康状态分别通过实际 `claude mcp list` / `gemini mcp list` 命令解析。
- Claude 分组界面不再提供 `~/.claude.json` 文本编辑区，避免与当前命令式 MCP 管理方式重复。
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

## 支持“交互模式”（会话续接 + 上下文压缩）

本项目已按 `docs/支持交互.md` 落地 **Codex + Claude** 的交互模式（Gemini 暂不纳入）。

### 行为概述

- 固定开启（Beta）：`codex/claude` 分组保持交互式会话续接。
- Codex 交互路径直接调用用户本机安装的官方 `codex` CLI，通过 `codex app-server --listen stdio://` 建立 JSON-RPC 会话，并用 `initialize` + `initialized` 完成握手；握手中的 `clientInfo` 统一声明为 `codex` 并优先探测本机已安装 Codex 版本，再通过 `thread/start` / `thread/resume` + `turn/start` 延续 threadId；不会使用 `@openai/codex-sdk` 自带 vendored binary。
- Codex 分组会把 prompt 中可解析到的本地图片 `@path` 自动转成 app-server 的 `localImage` 输入；若当前 Codex 版本低于支持基线或帮助输出未暴露 `--image`，切换到 Codex 分组时会弹窗提示升级到最新版本，并继续保留 `@path` 兼容回退。
- Claude 交互路径继续复用 SDK Runner，避免“一问一进程”的冷启动。
- 交互会话模式：支持 `coding / plan`，默认 `coding`（按 CLI 维度记住最后选择）。
- 不自动降级：`codex/claude` 分组在 SDK 初始化/运行失败时不回退到非交互模式，直接返回错误。
- 切换会话释放交互状态：每个 CLI 只维护 1 个当前会话交互状态，切换会话会销毁旧状态。
- 空闲释放：24 小时无交互自动释放 Runner。
- 切换思考模式：下一次交互会重建 Runner，并沿用已有会话/线程 ID 继续对话。
- 抢占式切换：当 `codex/claude` 在任意 Tab 启动新任务时，会先停止其他运行中的任务，再接管当前交互 Runner；不允许回退到非交互子进程。

### Codex 非交互模式（官方补充，按当前实现对比后保留的增量建议）

注意：当前插件里的 Codex 默认走交互路径，并且已经通过 `codex app-server --listen stdio://` 的 JSON-RPC 协议实现了 thread 续接与结构化事件解析，因此这两项**不再算新增建议**。

结合 OpenAI 官方文档、`codex-cli 0.110.0 --help` 与当前仓库实现，后续真正还值得补的主要是：

- `--output-schema <FILE>`：要求最终返回严格 JSON，适合“结构化产物面板 / 自动表单回填 / 批处理结果”。
- `-o, --output-last-message <FILE>`：把最终文本直接写文件，适合“生成 README / SQL / 提交说明 / 发布说明”。
- `--ephemeral`：无落盘临时会话，适合敏感任务或一次性问答。
- `codex review`：把“代码评审”从普通 prompt 独立成专用动作，支持 `--uncommitted` / `--base` / `--commit`。
- `--profile` / `-c key=value`：当前仅有部分参数映射，可继续做“运行预设 / 档位模板”。
- `codex cloud exec/status/apply`：适合“后台长任务 / 云端异步执行 / 回来再应用 diff”。
- `codex app-server`：插件当前已用于 Codex 交互模式，可继续补充更细的协议能力（如更完整的审批/工具状态映射）。
- `codex mcp-server`：适合把本插件或其它代理系统作为 Codex 的上游/下游工具编排节点。

更完整的对比说明见：`docs/codex-非交互模式能力建议.md`

### 设置项说明

- 已移除 `sinitek-cli-tools.interactive.codex` / `sinitek-cli-tools.interactive.claude` 开关配置。
- 面板内不再提供“交互开/关”切换。
- `codex/claude` 固定交互，`gemini` 保持非交互。

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
- `.vscodeignore` 需要排除 `node_modules`，但必须放行运行时依赖（当前至少包括 `@anthropic-ai/claude-agent-sdk` / `zod`；若后续恢复 Codex SDK 路径，再额外放行 `@openai/codex-sdk`），否则动态导入会在运行时找不到模块。

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
   - 当前分组固定使用交互模式，如需规避问题请先排查 CLI 登录态、PATH、环境变量与工作区目录。


## Auto Context Tag (Current File / Selection)
- A single removable default tag is shown above the input. It displays as `Current File: <path>` or `Current File: <path> [Lx:Cx-Ly:Cy]` when there is a selection.
- The tag is auto-included once, then cleared after a successful send; changing the active file or selection auto-arms it for the next send. If the tag is manually removed, it only re-arms after the corresponding context actually changes.
- Webview adds `contextOptions` to `sendPrompt`:
  - `includeCurrentFile: boolean`
  - `includeSelection: boolean`
- Extension injects references before sending to CLI (uses `@<relative-path>` instead of raw file content).
  - current file -> `@<relative-path>`
  - selection -> range hint like `Selected range in @<relative-path>: Lx:Cx-Ly:Cy`
- User bubble only shows the same compact single context tag, avoiding long context text in chat history.
- Extension syncs editor state through `state.editorContext` and incremental `editorContext` messages.
