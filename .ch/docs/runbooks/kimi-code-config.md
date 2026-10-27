# Kimi Code 配置与排障 Runbook

面向接手的人和代理：从零安装、写出可用配置、验证接入，再按失败现象定位。官方依据见 `.ch/docs/references/kimi-code-official-reference.md`，用户向说明见 `docs/kimi-code-guide.md`。

本文不记录密钥、token、真实网关凭据或运行时私有数据。所有验证都在隔离的临时 `KIMI_CODE_HOME` 下进行，不改用户的 `~/.kimi-code`。

## 1. 五分钟接入

```bash
node --version                 # 需要 >= 22.19.0
kimi --version                 # 期望 2.3.2 或更新
kimi doctor config             # 期望 All checked config files are valid.
```

没有配置时，先在配置中心激活一次 kimi 档案（插件会生成默认 `config.toml`），或手工创建 `~/.kimi-code/config.toml`。kimi 的模型、URL 和 API Key 都在这个文件中，不需要 Codex 风格的第二个 `auth.json`。

配置中心默认打开 TOML 源码。也可用「查看范例」→「一键导入」把范例填入当前草稿；导入不会直接保存，确认网关和凭据后点击「保存」。

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

把 `<your-kimi-api-key>` 替换为真实 API Key，或改成 `api_key_env = "KIMI_CODE_API_KEY"` 并提供同名环境变量。`base_url` 与 `model` 按实际网关填写；默认别名不含 `subcoco/` 前缀，`model` 是真实模型 ID。默认配置与范例包含思考能力声明与五档支持列表，不生成 `[thinking]`、默认思考档或 `loop_control`。

## 2. 隔离验证（不碰用户配置）

```bash
export KIMI_CODE_HOME="/tmp/kimi-check-$$"
mkdir -p "$KIMI_CODE_HOME"
cp ~/.kimi-code/config.toml "$KIMI_CODE_HOME/config.toml"
kimi doctor config            # 校验隔离副本
```

如果只想验证 ACP 是否可达、不想消耗真实额度，可设置一个占位密钥并只做 `initialize` + `session/new`，不发 `session/prompt`：

```bash
KIMI_CODE_API_KEY=placeholder kimi acp
```

正常情况下 `initialize` 返回 `agentInfo.name = "Kimi Code CLI"`，`session/new` 返回 `session_<uuid>` 与 `configOptions[]`（含 `model`、`mode`；思考档取决于 `support_efforts`）。这两个请求不产生模型调用。

## 3. 逐项检查表

| 检查项 | 命令/位置 | 通过标准 |
| --- | --- | --- |
| 可执行文件 | `which kimi`、`kimi --version` | 解析到真实路径，版本可打印 |
| 配置语法 | `kimi doctor config` | `All checked config files are valid.` |
| 默认模型存在 | `kimi provider list` 或读 `config.toml` | `default_model` 指向已定义的 `[models."<别名>"]` |
| 凭据来源 | `config.toml` 的 `[providers.*]` | `api_key` 与 `api_key_env` 至少有一个，且环境变量在当前进程真的非空 |
| ACP 启动 | 插件启动 `kimi acp` | stdout 干净，只有 JSON-RPC；日志在 stderr 与 `~/.kimi-code/logs/` |
| 模型广告 | `session/new` 的 `configOptions` | 含 `model`，值与 `config.toml` 一致 |
| 模型管理 | AI 对话 → kimi → 模型下拉 → 管理模型 | 新增、重命名、删除、排序后，当前档案和真实 `config.toml` 一致；配置保存会淘汰旧 runner，新进程恢复原 ACP 会话并应用所选别名 |
| 工具回放 | 执行含命令及文件工具的任务 | 命令是 `exec <command>`，普通工具只有标题；无参数 JSON 和成功结果重复回放 |
| 流式回放 | 执行需要联网查询并输出多段正文的任务 | 思考、用量与命令目录不生成回放 JSON；正文按消息聚合；工具逐 token 参数及输出快照合并为新增片段，保留完整参数与终态 |
| 权限模式 | `session/new` 的 `modes` | `default` / `plan` / `auto` / `yolo` |
| 思考档位 | `session/new` 的 `configOptions` | 含 `thinking`，值 ⊆ `support_efforts`；不含则见 4.3 |
| 上下文窗口 | 一轮结束后 `usage_update` | `size` 等于配置的 `max_context_size` |
| 压缩 | 对话面板常用指令 | Kimi 不出现「压缩上下文」入口 |

## 4. 失败现象与处置

### 4.0 第二轮起反复提示「没有产生最终结论气泡」

官方 ACP 的流式 `agent_message_chunk` 不保证携带 `messageId`。缺失时必须按当前轮次与正文类型生成去重键，不能跨轮固定使用 `assistant`，否则第二轮起的最终回答会被过滤，并触发宿主自动重试。原始事件流中的多条 JSON 是流式协议记录，不等同于多次模型任务；排障时应同时核对是否出现隐藏重试 prompt。

### 4.1 `session/new` 返回 `-32000 Authentication required`

stderr 通常同时给出真实原因，例如：

```
Provider "subcoco" declares api_key_env = "KIMI_CODE_API_KEY"
... but the environment variable is not set or is empty.
```

处置：把密钥放进 `api_key_env` 指向的环境变量，或改用 `api_key`，或写 `[providers.<名称>.env]` 子表。注意 CLI 不会回退读 shell 里随意的 `KIMI_API_KEY` / `OPENAI_API_KEY`。

验证时不要用真实密钥：临时设 `KIMI_CODE_API_KEY=placeholder` 只做 `initialize` / `session/new` 即可。

### 4.2 `provider <名称> has no credential configured`

`api_key` 和 `api_key_env` 都没写。补一个，再 `kimi doctor config`。

### 4.3 启动报 `thinking "medium" is not advertised; available: (none)`

原因：模型表缺 `capabilities` / `support_efforts`，ACP 不广告 `thinking`，插件又只下发广告值。

处置：在配置中心重新保存一次，统一提交链路会给每个模型补缺失的 `thinking` 能力和五档 `support_efforts`；已有能力及显式档位限制不会被覆盖。

当前 `src/config/kimiCodeConfig.ts` 的默认配置和 `media/config/assets/config-app-ui.js` 的范例都带这些声明；`commitKimiCodeText()` 同时负责旧配置保存时的缺失字段补齐。可视化编辑器不展示高级字段，已有 `capabilities` / `support_efforts` 不会被覆盖。

### 4.4 思考下拉没有档位 / 显示了但选不动

数据链是 ACP `config_option_update` → `src/extensionHost/interactiveTurnKimi.ts` 的 `kimiThinkingOptions` / `kimiModeUpdate` → `src/webview/viewContentScript/windowMessageDispatch.ts`（按 `tabId` 隔离）→ `syncThinkingOptions()`。排查顺序：

1. `kimi doctor config` 确认配置合法。
2. 用第 3 节的隔离探针确认 `session/new` 的 `configOptions` 里真的有 `thinking`。
3. 若广告里只有 `off` / `on`（env-only 通道，没有真实努力档），面板会禁用下拉框而不是下发改写值——这是预期行为，需要按第 1 节补 `capabilities` / `support_efforts`。
4. 收到广告前面板显示官方五档占位；切换标签页或切到别的 CLI 会清空广告集合，属正常隔离。

### 4.5 `-p` 任务没有被免审批

`--auto` / `--yolo` 与 `-p/--prompt` 互斥，官方直接报 `Cannot combine --prompt with --auto.`。免审批只能写 `default_permission_mode = "auto"`。插件启动命令只发 `kimi acp`，不会拼 `--auto`。

### 4.6 点「压缩上下文」报不支持

预期行为。Kimi Code ACP 没有独立压缩方法，`compactSession()` 抛 `compaction-unsupported`，面板不显示入口。Kimi CLI 本身支持自动压缩；需要手动压缩时可在输入框直接发 `/compact`，会返回「Context compaction started（后台异步）」。ACP 把自动压缩和 `/compact` 的开始确认、完成、取消、阻塞作为普通助手文本发送，插件据此显示「压缩中」，不作为最终答复或机器可读压缩方法；因此不把它包成可确认的按钮。上下文控制仍可用 `[loop_control].reserved_context_size` 交给 CLI 自己的循环。

### 4.7 上下文窗口显示不准 / 文案说适配器兜底

`usage_update.size` 来自模型目录的 `max_context_size`，是配置声明的真值。该事件可能在 `session/prompt` 返回 `stopReason` 之后才到达，runner 与 host 必须保留同会话收尾通知。`src/extensionHost/interactiveTurnKimi.ts` 把 `contextWindowSource` 标为 `"kimi-config-window"`，悬停文案是「当前上下文已用 {used} / {window} tokens；窗口取自 Kimi Code 配置的 max_context_size」。未收到有效用量时整颗标签隐藏，不显示「—」。若看到「适配器 fallback」字样，说明当前不是 Kimi 会话（那是 DSH 的来源枚举）。切换标签页会按各标签页自己的来源重算文案。

### 4.8 模型下拉为空

当前激活档案的 `config.toml` 没有可解析的 `[models."<别名>"]`，或不是合法 TOML。先 `kimi doctor config`，再在配置中心保存。插件不会回落到别的 CLI 的模型。

### 4.9 找不到 `kimi` 命令

装 CLI，或把 `sinitek-cli-tools.commands.kimi-code` 设为绝对路径。插件提示文案给的安装命令是 `npm install -g @moonshot-ai/kimi-code`。

## 5. 不能做的事

- 不要用 `--auto` / `--yolo` 搭配 `-p`，官方禁止。
- 不要期待 `session/compact`、`session/load`、`session/fork`、`session/delete` 被插件调用。
- 不要把 `ultra` 当成 Kimi 的档位，插件不改写。
- 不要在仓库、报告或日志里写真实密钥；验证一律用占位值 + 隔离 `KIMI_CODE_HOME`。
- 不要用文档任务去改运行时代码；发现缺口按第 4 节记录文件与现象，交给对应任务。

## 6. 复现本轮结论的最小命令集

```bash
kimi --version
kimi acp --help
kimi doctor config
KIMI_CODE_HOME=/tmp/kimi-check kimi doctor config
node --test dist/test/config/kimiCodeConfig.test.js \
           dist/test/config/kimiCodeConfigPage.test.js \
           dist/test/interactive/kimiAppServerProtocol.test.js \
           dist/test/interactive/kimiRunner.test.js \
           dist/test/extensionHost/kimiInteractiveLaunch.test.js \
           dist/test/extensionHost/kimiCodeModelSelection.test.js
```
