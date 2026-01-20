# CLI 调用与参数说明

本文件基于本机已安装 CLI 的 `--help` 输出整理（codex / gemini / claude）。如官方版本更新，以各 CLI 的 `--help` 与官方文档为准。

## 插件“交互模式”说明

当启用 `sinitek-cli-tools.interactive.codex/claude`（默认开启）时，插件会优先通过 SDK 以“常驻 Runner”方式与 CLI 交互，避免每次发送都重新启动进程；SDK 会尽量复用 CLI 的会话/线程。

- 仍会读取 `sinitek-cli-tools.commands.<cli>` 作为可执行文件路径（用于 SDK 的 path override）。
- 仍会读取 `sinitek-cli-tools.args.<cli>` 中的部分参数并映射到 SDK（例如 Codex 的 sandbox/approval/model、Claude 的 model 等）。
- SDK 初始化/运行失败会自动降级回“一问一进程”的 CLI 调用方式。
- 交互模式在 Extension Host 内运行，Process Explorer 不会出现独立的 `claude/codex` 进程；插件会设置进程标题/argv0 为 `sinitek-ai-vscode-cli-<cli>/<sessionId>`（可在 Process Explorer 的 Command Line/Process Title 列查看）。

## Windows 注意事项（找不到命令 / ENOENT）

如果在 VS Code 插件内运行时报错 `spawn <cli> ENOENT`，通常表示 Extension Host 找不到可执行文件：

- 先在 PowerShell 里验证：`where codex` / `where claude` / `where gemini`
- Windows 下若通过 npm 全局安装，常见位置为 `%APPDATA%\\npm\\<cli>.cmd`（例如 `%APPDATA%\\npm\\codex.cmd`）
- 可在 VS Code 设置中将命令改为绝对路径：
  - `sinitek-cli-tools.commands.codex`
  - `sinitek-cli-tools.commands.claude`
  - `sinitek-cli-tools.commands.gemini`
- 安装/修改 PATH 后需重启 VS Code

## Codex CLI

用途：OpenAI Codex CLI，用于交互式或非交互式任务、代码审查、MCP 管理等。

调用方式：
- `codex [OPTIONS] [PROMPT]`
- `codex [OPTIONS] <COMMAND> [ARGS]`
- `codex exec resume [SESSION_ID] [PROMPT]`（非交互恢复会话并发送 prompt）

命令：
- `exec`：非交互式运行 Codex（别名 `e`）。
- `review`：非交互式代码评审。
- `login`：登录管理。
- `logout`：移除已存凭据。
- `mcp`：运行 Codex 作为 MCP server / 管理 MCP（实验性）。
- `mcp-server`：运行 MCP server（实验性，stdio）。
- `app-server`：运行 app server 或相关工具（实验性）。
- `completion`：生成 shell 补全脚本。
- `sandbox`：在 Codex 提供的沙箱中执行（别名 `debug`）。
- `apply`：将 Codex agent 产生的最新 diff 以 `git apply` 方式应用（别名 `a`）。
- `resume`：恢复之前的交互会话（可用 `--last` 继续最近会话）。
- `cloud`：浏览 Codex Cloud 任务并在本地应用（实验性）。
- `features`：查看特性开关。
- `help`：显示帮助。

参数（OPTIONS）：
- `-c, --config <key=value>`：覆盖 `~/.codex/config.toml` 中的配置项（支持点路径，value 解析为 TOML）。
- `--enable <FEATURE>`：启用特性（可重复），等价 `-c features.<name>=true`。
- `--disable <FEATURE>`：禁用特性（可重复），等价 `-c features.<name>=false`。
- `-i, --image <FILE>...`：为初始提示附加图片。
- `-m, --model <MODEL>`：指定模型。
- `--oss`：选择本地开源模型提供方（等价 `-c model_provider=oss`，需 LM Studio / Ollama 运行中）。
- `--local-provider <OSS_PROVIDER>`：指定本地提供方（`lmstudio` 或 `ollama`）。
- `-p, --profile <CONFIG_PROFILE>`：从 config.toml 选择配置 Profile。
- `-s, --sandbox <SANDBOX_MODE>`：沙箱策略（`read-only` / `workspace-write` / `danger-full-access`）。
- `-a, --ask-for-approval <APPROVAL_POLICY>`：审批策略（`untrusted` / `on-failure` / `on-request` / `never`）。
- `--full-auto`：低摩擦自动执行（`-a on-request` + `--sandbox workspace-write`）。
- `--dangerously-bypass-approvals-and-sandbox`：跳过确认并禁用沙箱（高风险）。
- `-C, --cd <DIR>`：指定工作目录。
- `--search`：启用 web search 工具（默认关闭）。
- 说明：`codex exec` 不支持 `--search`，需用 `--enable web_search_request` 启用搜索能力。
- `--add-dir <DIR>`：额外可写目录。
- `-h, --help`：帮助。
- `-V, --version`：版本。

思考模式（非交互）：
- 使用 `codex exec` 时，可通过 `-c model_reasoning_effort="<level>"` 调整思考强度（`low` / `medium` / `high`）。
- Codex CLI 没有明确的“关闭”参数，可将 `model_reasoning_effort` 设为 `low` 以尽量降低推理。

## Gemini CLI

用途：Google Gemini CLI，用于交互式对话、MCP 管理、扩展管理等。

调用方式：
- `gemini [options] [command]`
- `gemini [query..]`（默认启动交互 CLI；位置参数可作为 prompt）

命令：
- `gemini [query..]`：启动 Gemini CLI（默认）。
- `gemini mcp`：管理 MCP servers。
- `gemini extensions <command>`：管理扩展（别名 `extension`）。

参数（OPTIONS）：
- `-d, --debug`：调试模式。
- `-m, --model`：指定模型。
- `-p, --prompt`：prompt（已弃用，建议使用位置参数）。
- `-i, --prompt-interactive`：执行 prompt 后继续交互模式。
- `-s, --sandbox`：沙箱模式。
- `-y, --yolo`：自动接受所有操作（YOLO）。
- `--approval-mode`：审批模式（`default` / `auto_edit` / `yolo`）。
- `--experimental-acp`：ACP 模式（实验）。
- `--allowed-mcp-server-names`：允许的 MCP server 名称列表。
- `--allowed-tools`：无需确认的工具列表。
- `-e, --extensions`：使用的扩展列表（不传则全部）。
- `-l, --list-extensions`：列出扩展并退出。
- `-r, --resume`：恢复会话（`latest` 或索引）。
- `--list-sessions`：列出会话并退出。
- `--delete-session`：删除会话（通过索引）。
- `--include-directories`：包含的额外目录（可多次或逗号分隔）。
- `--screen-reader`：屏幕阅读器模式。
- `-o, --output-format`：输出格式（`text` / `json` / `stream-json`）。
- `-v, --version`：版本。
- `-h, --help`：帮助。

思考模式（非交互）：
- Gemini CLI 不提供直接的思考开关参数，需通过配置文件调整模型的 `thinkingConfig`。
- 工作区配置文件路径为 `./.gemini/settings.json`（优先级高于 `~/.gemini/settings.json`）。
- `thinkingConfig` 支持 `thinkingBudget`（Gemini 2.5 系列）或 `thinkingLevel`（Gemini 3 系列）。
- Gemini 3 Pro 仅支持 `low` / `high`，Gemini 3 Flash 支持 `minimal` / `low` / `medium` / `high`。

## Claude CLI

用途：Anthropic Claude Code CLI，默认交互，支持 `--print` 非交互输出。

调用方式：
- `claude [options] [command] [prompt]`

参数（OPTIONS）：
- `-d, --debug [filter]`：调试模式（可过滤类别）。
- `--verbose`：覆盖配置中的 verbose 设置。
- `-p, --print`：打印输出后退出（适合管道；跳过工作区信任对话）。
- `--output-format <format>`：输出格式（仅 `--print`，`text` / `json` / `stream-json`）。
- `--json-schema <schema>`：结构化输出的 JSON Schema 校验。
- `--include-partial-messages`：包含流式分片（仅 `--print` + `stream-json`）。
- `--input-format <format>`：输入格式（仅 `--print`，`text` / `stream-json`）。
- `--mcp-debug`：MCP 调试（已弃用）。
- `--dangerously-skip-permissions`：跳过权限检查（高风险）。
- `--allow-dangerously-skip-permissions`：允许使用跳过权限选项（默认不启用）。
- `--max-budget-usd <amount>`：API 预算上限（仅 `--print`）。
- `--replay-user-messages`：回放用户消息到 stdout（仅 `stream-json` 输入输出）。
- `--allowedTools, --allowed-tools <tools...>`：允许的工具列表。
- `--tools <tools...>`：指定可用工具集合（仅 `--print`）。
- `--disallowedTools, --disallowed-tools <tools...>`：禁用的工具列表。
- `--mcp-config <configs...>`：从 JSON 文件或字符串加载 MCP 配置。
- `--system-prompt <prompt>`：指定 system prompt。
- `--append-system-prompt <prompt>`：追加 system prompt。
- `--permission-mode <mode>`：权限模式（`acceptEdits` / `bypassPermissions` / `default` / `delegate` / `dontAsk` / `plan`）。
- `-c, --continue`：继续最近会话。
- `-r, --resume [value]`：按 session ID 恢复或打开选择器。
- `--fork-session`：恢复时创建新 session。
- `--no-session-persistence`：禁用会话持久化（仅 `--print`）。
- `--model <model>`：指定模型（如 `sonnet` 或完整模型名）。
- `--agent <agent>`：指定 agent。
- `--betas <betas...>`：beta headers（API key 用户）。
- `--fallback-model <model>`：默认模型过载时的降级模型（仅 `--print`）。
- `--settings <file-or-json>`：加载设置文件或 JSON。
- `--add-dir <directories...>`：额外允许的目录。
- `--ide`：自动连接 IDE（若只有一个可用）。
- `--strict-mcp-config`：仅使用 `--mcp-config` 的 MCP 配置。
- `--session-id <uuid>`：指定 session ID。
- `--agents <json>`：定义自定义 agents。
- `--setting-sources <sources>`：设置来源（`user` / `project` / `local`）。
- `--plugin-dir <paths...>`：加载插件目录（可重复）。
- `--disable-slash-commands`：禁用 slash 命令。
- `--chrome`：启用 Claude in Chrome。
- `--no-chrome`：禁用 Claude in Chrome。
- `-v, --version`：版本。
- `-h, --help`：帮助。
- `--max-thinking-tokens <tokens>`：最大思考 token 数（仅 `--print` 生效）。

命令（Commands）：
- `mcp`：配置和管理 MCP servers。
- `plugin`：管理 Claude Code 插件。
- `setup-token`：设置长期 token（需要订阅）。
- `doctor`：检查自动更新健康状态。
- `update`：检查并安装更新。
- `install [options] [target]`：安装 Claude Code 原生构建。

思考模式（非交互）：
- 使用 `--print` 非交互时，可用 `--max-thinking-tokens` 控制思考 token 数；设为 `0` 可视为关闭。
