# Kimi Code 官方资料与插件接入对照

- 核对对象：`@moonshot-ai/kimi-code` 2.3.2（npm `latest`，bin `kimi`，`engines.node >= 22.19.0`，MIT）
- 核对日期：2026-10-26
- 官方文档：<https://moonshotai.github.io/kimi-code/zh/>
- 本机环境：Node 22.22.0，`kimi` 解析到 `/opt/homebrew/bin/kimi`
- 状态：官方资料已逐页核对；插件侧接线另有实跑证据，见 `.ch/docs/runbooks/kimi-code-config.md`。本文件不记录任何密钥、token 或运行时私有数据。

本文汇总“官方原文怎么写”，以及“插件实际怎么接”。两者不一致时，以官方已安装包的行为和插件实测为准，并在此处标注差异，不用推测补齐。

## 1. 安装与版本

| 项目 | 官方事实 | 来源 |
| --- | --- | --- |
| 脚本安装（官方推荐，无需预装 Node） | `curl -fsSL https://code.kimi.com/kimi-code/install.sh \| bash`；Windows `irm https://code.kimi.com/kimi-code/install.ps1 \| iex` | `guides/getting-started#安装` |
| npm 安装 | `npm install -g @moonshot-ai/kimi-code`（需 Node ≥ 22.19.0）或 `pnpm add -g @moonshot-ai/kimi-code` | 同上 |
| 版本检查 | `kimi --version` | `guides/getting-started#升级与卸载` |
| 升级 | `kimi upgrade`，或 `npm install -g @moonshot-ai/kimi-code@latest` | 同上 |
| 卸载 | `npm uninstall -g @moonshot-ai/kimi-code`；脚本安装的删除可执行文件 | 同上 |
| Windows 依赖 | 需 Git for Windows；非标准路径用 `KIMI_SHELL_PATH` 指向 `bash.exe` | 同上 |
| 配置自检 | `kimi doctor config [path]`、`kimi doctor tui [path]` | 实测 `kimi doctor --help` |

插件侧：`src/cli/installer.ts` 的 `CLI_INSTALL_COMMANDS["kimi-code"]` 是 `npm install -g @moonshot-ai/kimi-code@latest`，诊断修复与配置页「安装命令」都显示这一条；插件不执行官方安装脚本（管道脚本不可回滚、不可审计）。

## 2. 命令与参数

官方 `kimi --help`（2.3.2）关键项：

- `-V/--version`、`-h/--help`
- `-S/--session [id]`、`-c/--continue`
- `-m/--model <alias>`
- `-p/--prompt <prompt>`、`--output-format text|stream-json`
- `-y/--yolo`（Ask When Needed）、`--auto`（Never Ask）、`--plan`
- `--skills-dir`、`--agent`、`--agent-file`、`--add-dir`
- 子命令：`export`、`fork`、`provider`、`session`、`acp`、`web`、`doctor`、`upgrade`

互斥约束（官方 CLI 实测报错原文）：

```
error: Cannot combine --prompt with --auto.
error: Cannot combine --prompt with --yolo.
error: Cannot combine --yolo with --auto.
```

插件侧：一次性任务走 `-p`，因此不能靠启动参数免审批；`args.kimi-code` 白名单只有 `--region <mainland-cn|global>`。启动命令是 `kimi acp`（`src/interactive/kimiAppServerProtocol.ts` 的 `readKimiAcpAgentArgs` / `KIMI_DEFAULT_COMMAND`）。

`kimi acp --help` 实测只有两个选项：

```
--login            Run the device-code login flow then exit
--region <region>  Login region used together with --login: "mainland-cn" or "global"
```

## 3. 配置文件

- 路径：`~/.kimi-code/config.toml`；`KIMI_CODE_HOME` 改变整个数据根目录，配置文件随之变为 `$KIMI_CODE_HOME/config.toml`。
- provider 的 `api_key` / `api_key_env` 也在这一文件中；Kimi 没有 Codex 风格的第二个 `auth.json`。插件以 `0600` 权限保存可能包含明文 API Key 的配置。
- 键名一律 snake_case；键里含 `.` 时用引号，如 `[models."gpt-4.1"]`。
- 项目级本地配置：`<项目根>/.kimi-code/local.toml`（`[workspace] additional_dir`），与插件无关。

官方完整示例中的重要字段（原文照录语义）：

```toml
default_model = "kimi-code/k3"
default_permission_mode = "manual"
default_plan_mode = false
merge_all_available_skills = true
telemetry = true

[providers."managed:kimi-code"]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = ""

[models."kimi-code/k3"]
provider = "managed:kimi-code"
model = "k3"
max_context_size = 1048576
capabilities = [ "thinking", "always_thinking", "image_in", "video_in", "tool_use" ]
display_name = "K3"
support_efforts = [ "low", "high", "max" ]
default_effort = "max"

[thinking]
enabled = true
effort = "high"
keep = "all"

[loop_control]
max_attempts_per_step = 10
reserved_context_size = 50000

[[permission.rules]]
decision = "allow"
pattern = "Read"

[[hooks]]
event = "PreToolUse"
matcher = "Bash"
command = "node ~/.kimi-code/hooks/check-bash.mjs"
timeout = 5
```

顶层字段语义：`default_model` 必须在 `models` 中定义；`default_permission_mode` 默认 `manual`，可选 `yolo` / `auto`；`default_plan_mode` 对 `kimi -p` 不生效。

插件侧：`src/config/kimiCodeConfig.ts` 解析 `default_model`、`default_permission_mode`、`[thinking].effort`、`[loop_control].reserved_context_size`、`[providers.<名称>]` 与 `[models."<别名>"]`。默认生成文本见 `createKimiCodeDefaultConfigText()`，`kimi doctor config` 校验通过。

## 4. Provider 与凭据

官方 provider 类型：`kimi`、`anthropic`、`openai`、`openai_responses`、`google-genai`、`vertexai`。

凭据优先级（官方 `configuration/providers` 与 `configuration/env-vars`）：

1. `api_key` 或 `api_key_env`（二者互斥，`api_key_env` 是环境变量名）
2. `[providers.<名称>.env]` 子表里的惯用键，如 `KIMI_API_KEY` / `OPENAI_API_KEY`
3. 都没有时启动即报错

关键事实：CLI **不会**从 shell 环境自动读取 `KIMI_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`；只有 `api_key_env` 指向的变量和 `KIMI_MODEL_*` 系列是显式通道。`GOOGLE_APPLICATION_CREDENTIALS` 是唯一由 Google SDK 自己读的系统变量例外。

插件侧：不注入任何密钥，启动子进程前剥离其它 CLI 的 `*_API_KEY`；provider 缺凭据时报 `provider <名称> has no credential configured`。官网 `https://api.kimi.com/coding/v1` 走 OAuth 托管供应商；插件默认范例用的是团队本机网关，两者不冲突，但用户在插件里必须保证 `base_url` 指向的端点接受所配模型 ID。

## 5. 权限模式

官方 `guides/interaction#三种权限模式`：

| 官方名称 | 配置值 | 行为 |
| --- | --- | --- |
| Always Ask（原 Manual，默认） | `manual` | 只读自动放行，其余逐条确认 |
| Ask When Needed（原 YOLO，`/yolo`） | `yolo` | 普通工具调用自动批准，敏感文件与危险命令仍询问 |
| Never Ask（原 Auto，`/auto`） | `auto` | 全部自动，Agent 不再提问；Plan 模式仍需人工确认 |

插件侧：`KIMI_CODE_PERMISSION_MODES = ["manual", "yolo", "auto"]`，默认范例给 `auto`。`plan` 交互模式映射 ACP `plan` mode，且不自动放行权限请求；其它模式由 runner 从 `session/request_permission` 广告的选项里自动选 `allow_once`。

## 6. ACP 能力矩阵（官方 `reference/kimi-acp`）

- core 3/3：`initialize`、`authenticate`、`logout`
- session 11/11：`session/new`、`load`、`resume`、`list`、`fork`、`close`、`delete`、`prompt`、`cancel`、`set_mode`、`set_config_option`
- reverse-RPC 10/11：`session/update`、`session/request_permission`、`fs/read_text_file`、`fs/write_text_file`、`terminal/*`、`elicitation/create`；未实现 `elicitation/complete`
- 扩展：`session/set_model`（等价 `configId: "model"`）
- 未列出的方法一律 `methodNotFound`；**没有** `session/compact` 或任何压缩方法
- MCP 转发支持 `http` / `stdio` / `sse`，`acp` 传输丢弃并写 warn

插件侧的实际使用子集：`session/new`、`session/resume`、`session/prompt`、`session/set_config_option`、`session/cancel`、`session/close`。明确不发送 `session/load`、`session/fork`、`session/delete`——续聊走 `session/resume`（只在持有 `session_` 前缀 id 时使用，失败回落 `session/new`）。反向 RPC 除 `session/request_permission` 外统一回 `-32601`，因此 `terminal/*` 与 `fs/*` 不会由插件代跑。

## 7. 思考力度在 ACP 上的真实广告

`session/new` 返回的 `configOptions` 里，`thinking` 的取值由模型能力决定。本机隔离 `KIMI_CODE_HOME` 实测三种配置：

| 配置 | `thinking` 广告值 |
| --- | --- |
| 无 `capabilities` / `capabilities = []` | 无该选项 |
| `capabilities = ["thinking"]`（无 `support_efforts`） | `off`、`on`、`high` |
| `capabilities = ["thinking","always_thinking"]` + `support_efforts = ["low","high","max"]` | `low`、`high`、`max`（无 `off`） |
| `capabilities = ["thinking","tool_use"]` + `support_efforts = ["low","medium","high","xhigh","max"]` | `off`、`low`、`medium`、`high`、`xhigh`、`max` |

因此“插件支持五档”成立的前提是配置文件显式声明 `support_efforts`。`ultra` 不在任何广告集合里，插件不改写。

插件已按这条事实落地：只下发真实广告值。`src/config/kimiCodeConfig.ts` 的默认配置文本与 `media/config/assets/config-app-ui.js` 的配置页范例生成 `capabilities = ["thinking"]` 和完整五档 `support_efforts`。所有保存统一经过 `commitKimiCodeText()`，自动补缺失的能力与档位声明，不覆盖已有能力或显式档位限制。此前使用显式声明配置的隔离 `KIMI_CODE_HOME` 实测广告 `off`、`low`、`medium`、`high`、`xhigh`、`max`，且一轮 `session/prompt` 正常返回 `stopReason: "end_turn"`。

## 8. 上下文用量

官方未把 `usage_update` 写进 ACP 能力矩阵，但已安装包 2.3.2 的行为是：每轮结束后（`onTurnEnded`）发一次 `usage_update`，`used` 为 agent 上下文 token 数，`size` 取模型目录中该模型的 `max_context_size`；没有匹配模型时跳过。

插件侧结论：Kimi 的窗口上限是配置里声明的真实容量，不是估算值。`src/extensionHost/interactiveTurnKimi.ts` 现在把 `contextWindowSource` 标为独立枚举值 `kimi-config-window`，Webview 悬停文案为「当前上下文已用 {used} / {window} tokens；窗口取自 Kimi Code 配置的 max_context_size」，切换标签页时按标签页各自的来源重算。DSH 的 `adapter-fallback` 语义保持不变。

## 9. Skills 与规则

- 全局 Skills：`$KIMI_CODE_HOME/skills/<name>/SKILL.md`，也支持扁平 `.md`
- 项目级 Skills：`.kimi-code/skills`
- 全局规则：`~/.kimi-code/AGENTS.md`；工作区 `.kimi-code/AGENTS.md` / `AGENTS.md` / `agents.md`
- 斜杠命令 `/skill:<name>` 激活

插件侧：Skills 目标从五个扩为六个，追加 Kimi Code；`src/config/cliGlobalSkills.ts` 与 `src/shared/userHomePaths.ts` 提供根路径解析。

## 10. 多模型与回放接线

官方 `kimi acp` 没有 `--model`；模型切换走 ACP `session/set_config_option`，值是当前 `config.toml` 声明的别名。插件模型管理弹窗对当前档案新增、重命名、删除、排序，保存档案并应用真实配置；每轮复用 runner 后仍重新应用模型和思考档位。新增模型复制默认条目的 provider、凭据引用和高级字段，真实 `model` ID 取输入别名，需要不同 ID 时在文本配置修改。工具投影命令使用 `exec <command>`，普通工具只显示标题，不回放参数 JSON 或成功结果，失败最多保留两行、600 字符。

## 11. 与插件文档的差异清单

| 项 | 官方 | 插件当前 | 处理 |
| --- | --- | --- | --- |
| 安装入口 | 脚本（推荐）+ npm | 只用 npm，文案已说明脚本存在但不使用 | 已对齐，文档写明两者 |
| 免审批 | `--auto` / `--yolo` 或配置字段 | 只能配置字段（`-p` 互斥） | 已对齐并写入文档 |
| 压缩 | `/compact` 斜杠命令存在，经 `session/prompt` 也能触发，但后台异步且只有纯文本完成提示；无 `session/compact` 方法 | `compactSession()` 抛 `compaction-unsupported`，不显示入口，不把斜杠命令包装成可确认的按钮 | 已对齐：能力边界与本轮产品选择都写明 |
| 思考档位 | 由 `capabilities` / `support_efforts` 决定 | 默认配置与范例生成五档声明；保存自动补缺失字段并保留已有值，可视化不展示高级字段 | 已对齐：`src/config/kimiCodeConfig.ts`、`media/config/assets/config-app-ui.js` |
| 上下文窗口来源 | 模型目录 `max_context_size` | `contextWindowSource = "kimi-config-window"`，悬停文案说明取自配置 | 已对齐：`src/extensionHost/interactiveTurnKimi.ts`、`src/webview/viewContentScript/taskListAndUi.ts` |
| 思考档下拉的数据源 | ACP `config_option_update` / `configOptions` | Webview 消费 `kimiThinkingOptions` 与 `kimiModeUpdate`，按 tabId 隔离 | 已对齐：`src/webview/viewContentScript/windowMessageDispatch.ts` |
| 配置页默认模式与范例导入 | TOML 是完整配置事实来源 | 打开档案默认进入 TOML 源码；`kimi-code-config` 一键导入调用 `syncKimiCodeVisualContent(..., "toml")` 更新当前草稿，保存后才应用 | 已对齐：`media/config/assets/config-app-ui.js`、`src/test/config/kimiCodeConfigPage.test.ts` |
