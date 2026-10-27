# Kimi Code CLI 使用指南

本文面向使用「携宁 CLI 助手」插件的终端用户，说明如何安装官方 Kimi Code CLI、如何检查版本、如何在插件里配置 `kimi-k3.1-pro` 和免审批模式，以及哪些能力真实可用、哪些不支持。插件界面统一显示为 **kimi**。

事实来源分两层：

- 官方资料：Kimi Code CLI 官方文档 <https://moonshotai.github.io/kimi-code/zh/>（安装、命令、配置、ACP 参考）。
- 本插件实测：2026-10-26 在本机用官方包 `@moonshot-ai/kimi-code` 2.3.2（Node 22.22.0）与插件运行时代码验证。版本号会变化，以 `kimi --version` 的实际输出为准。

本文不记录任何本机密钥、token 或运行时私有数据。API Key 一律使用显式占位符，示例环境变量只写变量名。

## 1. 安装官方 CLI

官方提供两种安装方式。插件自身的「安装命令」按钮与「自动修复」入口使用 npm 方式，因为插件需要一条可重复、可回滚、不依赖管道下载的命令。

### 方式一：官方安装脚本（官方推荐，无需预装 Node.js）

macOS / Linux：

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
```

Windows（PowerShell）：

```powershell
irm https://code.kimi.com/kimi-code/install.ps1 | iex
```

脚本会下载最新版本、校验 checksum，并把 `kimi` 放到 `PATH`。Windows 首次启动前还需要安装 Git for Windows；如果 Git Bash 装在非标准路径，把 `KIMI_SHELL_PATH` 设成 `bash.exe` 的绝对路径。

### 方式二：npm 全局安装（插件采用的方式）

要求 Node.js **22.19.0 或更高版本**：

```bash
node --version
npm install -g @moonshot-ai/kimi-code
```

也可以用 pnpm：`pnpm add -g @moonshot-ai/kimi-code`。

插件在「配置中心 → Kimi Code」和 CLI 诊断修复里显示的安装命令是：

```bash
npm install -g @moonshot-ai/kimi-code@latest
```

两者是同一个包，区别只是显式带 `@latest` 以强制升级到最新版。

## 2. 版本检查与自检

安装完成后先确认可执行文件就绪：

```bash
kimi --version
```

本机实测输出 `2.3.2`。插件按 `kimi` 这个命令名解析可执行文件；如果不在 `PATH` 里，把设置 `sinitek-cli-tools.commands.kimi-code` 改成绝对路径。

配置写完后可以先让 CLI 自己校验，不必进入交互界面：

```bash
kimi doctor config
```

本机实测：配置合法时输出 `OK config.toml  <路径>` 与 `All checked config files are valid.`；也可以显式传路径 `kimi doctor config /path/to/config.toml`。`kimi doctor tui` 校验终端界面偏好文件 `tui.toml`，与插件无关。

升级与卸载：

```bash
kimi upgrade                                  # 官方升级入口
npm install -g @moonshot-ai/kimi-code@latest  # 包管理器升级（插件安装命令）
npm uninstall -g @moonshot-ai/kimi-code       # 卸载
```

## 3. 在插件里使用

1. 打开「配置中心」，在 DSH 之后找到 **kimi** 卡片。平台顺序固定为 Claude、Codex、OpenCode、Grok、DSH、kimi，前面平台的顺序不会因为新增 kimi 而改变。
2. 首次进入且本机还没有 `~/.kimi-code/config.toml` 时，插件会生成一份默认配置（默认模型 `kimi-k3.1-pro`、`default_permission_mode = "auto"`）。已有配置和模型选择不会被自动改名。
3. 确认 `base_url` 与凭据来源后保存并激活。对话面板的模型下拉只列出当前配置里声明的模型，没有「默认」或「管理」占位项。
4. 切到 kimi，直接对话即可。交互主路径是官方 ACP：插件启动 `kimi acp`，通过 stdio 上的 JSON-RPC 2.0 通信。

`args.kimi-code`（设置 `sinitek-cli-tools.args.kimi-code`）只允许 `--region <mainland-cn|global>`，其它参数会被直接拒绝，插件不会猜测未文档化的开关。

## 4. 配置 `kimi-k3.1-pro`

配置文件固定是 `~/.kimi-code/config.toml`（TOML，所有键名 snake_case）。**kimi 不需要 Codex 那样的第二个 `auth.json`**：模型、URL 和 API Key 都在这一个文件中配置。可用 `KIMI_CODE_HOME` 把整个数据目录搬到别处，此时路径变为 `$KIMI_CODE_HOME/config.toml`。

插件默认生成的最小可用配置：

配置中心打开 kimi 档案时默认显示完整 TOML 源码，需要时再手动切到「可视化」。点击「查看范例」→「一键导入」会把精简范例写入当前 TOML 草稿并关闭范例抽屉；替换 API Key 占位符、检查 `base_url` 后仍需点击「保存」才会写入并应用配置。

```toml
default_model = "kimi-k3.1-pro"
default_permission_mode = "auto"

[providers.subcoco]
type = "openai"
base_url = "http://127.0.0.1:33391/v1"
api_key = "<your-kimi-api-key>"

[models."kimi-k3.1-pro"]
provider = "subcoco"
model = "kimi-k3.1-pro"
max_context_size = 262144
capabilities = ["thinking"]
support_efforts = ["low", "medium", "high", "xhigh", "max"]
```

要点：

- **别名 ≠ 模型 ID**。`[models."kimi-k3.1-pro"]` 的表键是别名，`default_model` 和命令行 `-m/--model` 都传别名；`model` 才是发给供应商的真实模型 ID。插件把两者分成两个输入，不自动增删前缀。
- **`base_url` 是本机转发地址**。`http://127.0.0.1:33391/v1` 是团队网关在本机的转发端口，不是公网地址，也不含凭据；网关地址不同就改成实际的 `base_url`。
- **凭据必须有来源**。把 `<your-kimi-api-key>` 替换为真实 API Key，或将这一行改为 `api_key_env = "KIMI_CODE_API_KEY"` 并在 VS Code 进程环境中提供该变量。两种方式二选一；两者都没有时 CLI 直接报 `provider <名称> has no credential configured`。含明文 API Key 的 `config.toml` 由插件按 `0600` 权限保存。
- **插件不注入密钥**。宿主进程不会把任何密钥写进 Kimi 的命令行或配置，还会在启动子进程前剥离其它 CLI 的 `*_API_KEY`。凭据只来自你自己的 `config.toml`。
- 默认配置与范例只带运行所需的思考能力声明和五档支持列表，不生成 `[thinking]`、显示名、默认思考档或 `loop_control` 等可选字段。
- 未在 `models` 里声明的模型不能被插件执行。

可视化编辑器只覆盖常用字段：全局 `default_model`、`default_permission_mode`，所选模型的 `provider`/`model`/`max_context_size`，以及 provider 的 `type`/`base_url`/`api_key`/`api_key_env`。已有 `display_name` 仍用于模型下拉显示；思考、Loop、能力声明和其它未展示字段只能在 TOML 源码中维护。保存时会自动补齐缺失的 `thinking` 能力和五档 `support_efforts`，已有值不覆盖。空文本或非法 TOML 不会覆盖上一份有效内容。

## 5. 免审批模式

免审批在 Kimi Code 里是真实能力，但入口不是命令行开关，而是配置文件字段。

官方三种权限模式：

| 模式 | `default_permission_mode` | 行为 |
| --- | --- | --- |
| Always Ask（始终询问，官方默认） | `manual` | 只读操作自动放行，改文件/执行命令逐条确认 |
| Ask When Needed（必要时询问，原 YOLO） | `yolo` | 普通工具调用自动批准，敏感文件与危险命令仍询问 |
| Never Ask（完全自动，原 Auto） | `auto` | 全部自动处理，Agent 不再向用户提问 |

插件默认新范例给的是 `default_permission_mode = "auto"`，也就是完全免审批、无人值守。

为什么不用 `--auto` / `--yolo` 启动参数：官方 CLI 明确禁止它们和 `-p/--prompt` 同时使用，本机实测报错为 `Cannot combine --prompt with --auto.` 与 `Cannot combine --prompt with --yolo.`。插件的一次性任务走 `-p`，所以免审批必须写在配置文件里。插件启动命令默认只发 `kimi`（加 `acp`），不拼 `--auto`。

相关边界：

- 交互 Plan 模式映射 ACP 真实的只读 `plan` mode，此时不自动放行权限请求。
- 非 `plan` 模式下，ACP 的 `session/request_permission` 由 runner 从服务端广告的选项里选 `allow_once`。
- 其它反向 RPC（`fs/*`、`terminal/*`）统一回 `-32601`，命令由 Kimi 自己执行，插件不代跑。

### 多模型与动态切换

`kimi acp` 没有 `--model` 启动参数。插件采用「`config.toml` 声明多个模型 + ACP `session/set_config_option` 动态切换」：下拉候选是当前档案的模型别名，不接受未声明的任意模型 ID。每轮开始都会重新应用所选模型，包括复用 ACP 会话时；切换后思考档位按新模型重新确认。保存 `config.toml` 后，插件会淘汰仍缓存旧模型广告列表的 ACP 进程，再按原 ACP ID 执行 `session/resume`，因此新增或重命名模型可在下一轮使用，同时保留当前会话和历史。

在 AI 对话面板打开 kimi 的模型下拉，选择「管理模型」即可新增、重命名、删除或上下移动模型，弹窗与 Codex 一致。操作会同时保存当前配置档案与真实 `~/.kimi-code/config.toml`，不是只改界面列表。新增模型复制默认模型条目的 provider、凭据引用和高级字段，并将输入的别名作为真实 `model` ID；如真实 ID 不同，请在文本配置里修改。重命名默认模型会同步 `default_model`，删除默认模型会回落到剩余首项。

工具回放保持精简：命令以 Codex 同款 `exec <command>` 标题显示，普通工具只显示标题，不重复展开参数 JSON 或成功结果；失败结果最多保留两行、600 字符。

## 6. 思考力度（真实能力与前置条件）

思考力度是官方原生能力，字段是 `[thinking].effort` 与模型的 `default_effort` / `support_efforts`。

ACP 会话只广告当前模型允许的值。以下是本机隔离 `KIMI_CODE_HOME` 下用 `kimi acp` 实测的广告集合（配置里 `default_effort = "high"`）：

| 模型表的声明 | ACP 广告的 `thinking` 值 |
| --- | --- |
| 没有 `capabilities`（或 `capabilities = []`） | 完全没有 `thinking` 选项 |
| `capabilities = ["thinking"]`，且没写 `support_efforts` | `off` / `on` / `high` |
| `capabilities = ["thinking", "tool_use"]` + `support_efforts = ["low", "medium", "high", "xhigh", "max"]` | `off` / `low` / `medium` / `high` / `xhigh` / `max` |
| `capabilities = ["thinking", "always_thinking"]` | `low` / `medium` / `high` / `xhigh` / `max`（无 `off`） |

结论：**只有模型表声明 `capabilities` 且包含 `thinking` 时，ACP 才会公布思考选项**；要拿到完整五档，还要显式写 `support_efforts`。

插件保存配置时会自动补齐思考声明；需要限制模型可用档位或声明其它能力时，可在 TOML 源码中显式维护：

```toml
[models."kimi-k3.1-pro"]
provider = "subcoco"
model = "kimi-k3.1-pro"
max_context_size = 262144
display_name = "Kimi K3.1 Pro"
default_effort = "high"
capabilities = ["thinking", "tool_use"]
support_efforts = ["low", "medium", "high", "xhigh", "max"]
```

默认配置与范例已包含 `capabilities = ["thinking"]` 和完整五档 `support_efforts`。从旧配置保存时，缺少 `thinking` 的模型会自动补上该能力，缺少 `support_efforts` 时自动补五档；已有能力顺序、显式档位列表（包括显式空数组）保持不变。可视化编辑器不展示这些高级字段，写入未知能力会直接报 `capabilities 含未知能力`。

插件只下发 ACP 当真广告过的值：`ultra` 不会被改写为 `max`，`off` 也不会被改成 `medium`；广告里没有的值直接报错并保留服务端确认值，不伪造档位。

界面侧的联动（本轮已接）：宿主在每轮开始前把 ACP 实际广告的档位用 `kimiThinkingOptions` 消息（带 `tabId`）发给 Webview，思考力度下拉框只列出这些值；服务端上报 `off` 时按「交给配置的 `default_effort`」处理，不下发 `off`。收到广告之前下拉框显示官方五档作为占位；如果广告里只有 `off` / `on`（env-only 通道，没有真实努力档），下拉框会被禁用而不是下发改写值。切换会话标签页或切到别的 CLI 都会清掉上一个 Kimi 会话的广告集合，不会串档。

## 7. 上下文大小显示与自动压缩

上下文大小显示是真实读数：Kimi 在每轮结束后发送一次 `usage_update`，`used` 是当前上下文 token 数，`size` 取自模型目录里该模型的 `max_context_size`（也就是你 `config.toml` 里写的值），没有匹配到模型时不下发。所以面板里的窗口上限是配置声明的容量，不是估算值。

插件把它标成独立的来源 `kimi-config-window`（不是 DSH 的 `adapter-fallback`）：悬停文案为「当前上下文已用 {used} / {window} tokens；窗口取自 Kimi Code 配置的 max_context_size」。切换会话标签页时会按该标签页自己的来源重算悬停文案，不会沿用上一个标签页的。DSH 的 `adapter-fallback` 语义保持不变。

自动压缩分两层，必须分清：

- **CLI 自己的循环**：`[loop_control].reserved_context_size` 控制 Kimi 内部会话循环预留的上下文空间，属于 CLI 行为，插件不参与。
- **插件侧「压缩上下文」按钮**：Kimi Code ACP 没有压缩方法（`initialize` 未公布，也没有 `session/compact` 这类独立方法），插件 `compactSession()` 明确抛 `compaction-unsupported`，不伪造本地压缩、也不假装下发成功。因此对话面板对 Kimi 不显示该入口，工具设置里的「执行后自动压缩上下文」也不会对 Kimi 生效。

`/compact` 本身在 Kimi 里是真实存在的斜杠命令。本机隔离实测（`session/prompt` 里发文本 `/compact`）它能跑起来，返回先是一句「Context compaction started — it runs in the background…」，随后再推一条 `Compaction completed.` 加消息数与前后 token 数的纯文本；没有机器可读的完成事件，压缩在后台异步生效。所以：

- 它不是 TUI 专属命令，经 ACP 的 prompt 通道也能触发；
- 但它没有可确认的完成协议，本轮按范围**不接线**、不显示入口，避免出现「点了按钮但无法判断是否成功」的假成功；
- 需要压缩时，可以自己在输入框里发 `/compact`，或依赖 `[loop_control].reserved_context_size` 交给 CLI 自己控制。

## 8. 主模型与子模型

- Kimi Code 支持插件侧模型选择，候选唯一来自当前激活的 `config.toml`。
- 选择按配置档案和角色（main / subtask）分别持久化。子任务没有单独选择时，先回落到「普通对话里选中的模型」，普通对话也没选过才回落到配置的 `default_model`；这与 Grok 的回落顺序一致，不会凭空继承别的 CLI 的模型。
- Loop 主任务、主持/复核与续跑使用主模型和主任务思考力度；Loop 子任务使用子模型和子任务思考力度；Graph planner 与最终 `summary` 节点用主模型，其它执行节点用子模型。
- 跨 CLI 子路由使用目标 CLI 自己的配置与模型，不继承主 CLI 的模型。
- 这份主从分工由插件调度实现，不是 Kimi Code 自身的字段；Kimi 的 `config.toml` 里只有 `default_model`，没有「子模型」字段。

## 9. Skills 与规则

- 全局 Skills 目录：`<KIMI_CODE_HOME>/skills`（默认 `~/.kimi-code/skills`），项目级是 `.kimi-code/skills`。
- 全局规则：`~/.kimi-code/AGENTS.md`；工作区规则读 `.kimi-code/AGENTS.md` / `AGENTS.md` / `agents.md`。
- 配置中心现在管理六个全局 Skills 目录，顺序是 Claude、OpenCode、Grok、Codex、DSH、Kimi Code。

## 10. 常见问题

**`Authentication required`（`session/new` 返回 -32000）**
provider 声明的凭据不可用。检查 `api_key` 是否为空、`api_key_env` 指向的环境变量在当前进程里是否真的有值。插件不会回退读取 shell 里随意的密钥变量，只有 `api_key_env` 与 `[providers.<名称>.env]` 是显式通道。

**`provider <名称> has no credential configured`**
`api_key` 与 `api_key_env` 都没写。补一个即可。

**`thinking "medium" is not advertised; available: (none)`**
旧配置的模型表缺少 `capabilities` / `support_efforts`。在配置中心重新保存一次即可自动补齐；字段规则见第 6 节。

**模型下拉为空 / `请先在 Kimi Code 配置文件...中添加模型`**
当前激活的 `config.toml` 没有可解析的 `[models."<别名>"]` 表，或者文件不是合法 TOML。先用 `kimi doctor config` 确认，再回到配置中心保存。

**面板没有「压缩上下文」**
预期行为，Kimi Code ACP 不支持压缩，见第 7 节。

**提示找不到命令**
`kimi` 不在 `PATH`。安装 CLI，或把 `sinitek-cli-tools.commands.kimi-code` 设成绝对路径（插件提示文案里也给了 `npm install -g @moonshot-ai/kimi-code`）。

## 11. 未支持 / 未验收清单

- ACP 侧独立压缩方法：不存在（无 `session/compact`），也就是压缩这件事在 ACP 上没有方法级接口；插件 `compactSession()` 明确报 `compaction-unsupported`。
- `/compact` 斜杠命令：可用，但只能作为普通 prompt 文本发送，结果为后台异步执行 + 纯文本完成提示，没有机器可读完成事件。本轮不接线、不显示入口，属能力边界与产品选择，不是待修缺口。
- `session/load`、`session/fork`、`session/delete`：插件不发送。只使用 `session/new`、`session/resume`、`session/prompt`、`session/set_config_option`、`session/cancel`、`session/close`。
- `ultra` 档位：Kimi 没有该档，插件不改写、不伪装。
- 真实 VS Code 图形界面的点击级验收：未做。本轮只做了配置、CLI、协议、Webview 脚本与文档层面的验证。

### 已知缺口

- 真实 VS Code 窗口里的点击级验收仍未做（见上一条）。Webview 侧只有脚本级回归测试，没有在真实编辑器里点过。
- 自动压缩仍是官方不支持的能力，插件不会为 Kimi 显示「压缩上下文」入口，也不伪造本地压缩。
