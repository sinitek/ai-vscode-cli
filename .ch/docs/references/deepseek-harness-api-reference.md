# DeepSeek Harness API 契约

- 核对版本：`@deepseek-ai/dsh@0.2.1-rc.2`
- 核对日期：2026-10-24
- 状态：上游安装与程序化契约。插件分组、配置页、ACP runner、Skills 根和 `AGENTS.md` 规则链已接入。Skills 目标是五个，顺序保持 Claude、OpenCode、Grok、Codex、DSH。可执行模型 id 必须完整使用 `subcoco/deepseek-v4.1-flash`。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。图形 Extension Host 点击验收和真实权限请求未验证。原生 compaction 明确不支持。凭据默认引用 `SINITEK_DSH_API_KEY`，插件也允许 profile 根级 `apiKey` 并在启动时注入子进程环境。
- 发布性质：官方推荐通道 `latest` 当前指向发布候选 `0.2.1-rc.2`。它不是稳定版。`next` 的 `0.2.1-rc.3` 也不是稳定版。

本文只记录已安装包、官方 README 和隔离进程探针能证明的事实。没有 `DEEPSEEK_API_KEY` 时不借用其他平台密钥，也不把未发生的在线生成写成成功。

2026-10-24 用户把目标模型纠正为 `subcoco/deepseek-v4.1-flash`。该模型的原生 ACP 成功、用量、取消、恢复和压缩边界在 `.ch/docs/references/dsh-custom-provider-contract.md`。旧模型探针和本文的无凭据官方路由探针都不能代替那份契约。本文其余官方路由结论仍然只描述当时的默认 `deepseek-official` 探针。响应短名不能回写成配置 id。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。

## 1. 安装身份

官方仓库是 `git+https://github.com/deepseek-ai/deepseek-harness.git`，npm 包目录为 `apps/cli`，bin 为 `dsh -> lib/bin.js`。根 README 的 npm 入口是 `npx @deepseek-ai/dsh`，解析 npm 默认通道 `latest`，不是 `next`。

2026-10-24 的 `npm view @deepseek-ai/dsh dist-tags version time repository bin --json`：

| 通道 | 版本 | 发布时间 |
| --- | --- | --- |
| `latest` | `0.2.1-rc.2` | `2026-10-17T08:36:31.655Z` |
| `next` | `0.2.1-rc.3` | `2026-10-23T07:54:30.267Z` |
| `alpha` | `0.2.1-alpha.5` | `2026-10-16T12:31:49.659Z` |

没有非预发布 dist-tag。已发布版本名都带 `-rc` 或 `-alpha`。本机按官方推荐通道安装的是 `latest`，实际版本是发布候选 `0.2.1-rc.2`。

安装命令和结果：

```sh
npm install -g @deepseek-ai/dsh@latest
```

- 退出码 0。使用当时 PATH 上的 npm：`/Users/fangjiawei/.nvm/versions/node/v22.23.2/bin/npm`。
- 全局前缀：`/Users/fangjiawei/.nvm/versions/node/v22.23.2`。
- 安装前 `command -v dsh` 退出码 1。`~/.npm-global/bin`、Homebrew、`/usr/local/bin` 都没有 `dsh`。
- 安装后 `command -v dsh` 与 `which -a dsh` 只有 `/Users/fangjiawei/.nvm/versions/node/v22.23.2/bin/dsh`。
- 该路径是符号链接，realpath 为 `.../lib/node_modules/@deepseek-ai/dsh/lib/bin.js`。
- `dsh --version` 退出码 0，输出 `0.2.1-rc.2`。
- `npm ls -g @deepseek-ai/dsh --depth=0` 显示 `@deepseek-ai/dsh@0.2.1-rc.2`。
- 本仓库 `package.json` 未加入该依赖。

PATH 上还有 Homebrew 和 `/usr/local` 的 Node/npm。当前 shell 先命中 nvm v22.23.2，刚安装的 `dsh` 也只在这个前缀里。

用户家目录在安装前已有 `~/.dsh`。全局安装和后续探针都设置独立 `DSH_HOME`，没有读取、覆盖或删除该目录。安装后与探针后，`~/.dsh`、`settings.yaml`、`.credentials.yaml` 的 mtime 仍是安装前的 `2026-08-18T09:01:14+0800`、`2026-08-17T12:57:44+0800`、`2026-08-17T12:54:45+0800`。文档不记录其中的配置或会话内容。

`dsh --help` 退出码 0。启动器只解析自己的标志，其余参数交给 profile：

```text
dsh [--profile] <name> [options] [app-args...]
dsh plugin --profile <name> <pnpm-args...>
--profile <name>
--from-default-profile <name>
--patch <path>
--dump-config
--dump-config-schema
--dump-default-config
```

随包 profile 的 `--help` 不启动模型。`tui` 不是随包 profile，退出码 1。`desktop` 由 Electron 独占，退出码 1。

## 2. 控制面和模型 HTTP API

已安装版本同时提供多条入口。插件不能把它们混成一个协议，也不能假设它就是 Grok ACP 或 Codex app-server。

| 入口 | 角色 | 适合插件主路径 |
| --- | --- | --- |
| `dsh --profile acp` | 标准 ACP v1，NDJSON JSON-RPC stdio | 是。交互会话、取消、模型与思考档、权限请求都在这条线上 |
| `dsh --profile sdk` | DSH 自己的 SDK JSON-RPC，NDJSON stdio | 否。事件更全，但没有取消方法，模型在进程级 `initialize` 固定 |
| `dsh --profile headless` | 一次任务后退出 | 否。只适合后续一次性脚本，不适合长驻 runner |
| `dsh web` | 本机浏览器 UI | 否。不能靠刮页面冒充程序化支持 |
| DeepSeek Messages HTTP API | `dsh-llm-deepseek` 背后的模型接口 | 否。这是模型调用，不是 harness 会话控制 |

两条 stdio 协议都是一行一个 JSON-RPC 2.0 对象，以 `\n` 分帧。ACP 由 `@agentclientprotocol/sdk` 的 `ndJsonStream` 接线，不是 Content-Length 帧。SDK 由 `@deepseek-ai/dsh-sdk-protocol` 的 `JsonRpcLineTransport` 接线。诊断走 stderr。stdout 只放协议帧。

`@deepseek-ai/dsh-sdk-client@0.0.1-rc.1` 仍在 npm 上，但版本与本次 CLI 不一致。契约以 CLI `0.2.1-rc.2` 内嵌的 `@deepseek-ai/dsh-sdk-protocol@0.2.1-rc.2` 和实测帧为准，不使用旧客户端。

## 3. 插件主路径

交互主路径使用：

```sh
dsh --profile acp
```

环境至少隔离 `DSH_HOME`。不要把 Grok、Codex、Claude 或其他平台密钥传给这个进程。凭据名默认是 `DEEPSEEK_API_KEY`；没有该凭据时，会话可以创建，模型请求会以 `MISSING_CREDENTIAL` 失败。

不要复用 `src/interactive/grokRunner.ts`。DSH ACP 明确不实现 Grok 使用的 `session/load`。实测 `session/load` 返回 `-32601`。也不要发送 Grok 的 `_meta.yoloMode`，不要把 Grok 的 `ultra` 映射成 DSH 档位。

SDK 可以保留为后续非交互自动化的备选。Headless 可以保留为一次性任务备选。两者都不是当前交互主路径。

## 4. ACP 契约

来源：`@deepseek-ai/dsh-acp@0.2.1-rc.2` README 与 `lib/index.js`，以及隔离 `DSH_HOME` 下的真实进程。ACP `agentInfo.version` 是协议身份 `0.0.1`，不是 CLI 版本。

### 4.1 启动、分帧、退出

```sh
DSH_HOME=<临时目录> dsh --profile acp
```

- 传输：客户端写 stdin，服务端写 stdout，一行一个 JSON 对象。
- 请求带 `jsonrpc`、`id`、`method`、`params`。通知没有 `id`。
- 没有单独的 initialized 通知。`initialize` 的响应就是握手完成。
- 关闭 stdin 后进程退出码 0。探针在 `session/close` 后关闭 stdin，退出码 0。
- 随包 ACP 配置把 `provider` 设为 `deepseek-official`，`model` 设为 `deepseek-v4-flash`。这是 profile 当前模型，不是默认目录里的 `deepseek-flash` / `deepseek-v4-pro`。

### 4.2 已接线方法

服务端实际注册的 agent 方法：

| 方法 | 类型 | 作用 |
| --- | --- | --- |
| `initialize` | request | ACP v1 握手 |
| `authenticate` | request | 立即成功。服务端不要求 ACP 认证 |
| `session/new` | request | 创建持久会话并返回配置项 |
| `session/list` | request | 分页列可恢复根会话。本次未对空库做成功样例 |
| `session/resume` | request | 按 id 恢复。缺历史、cwd 或 preset 不匹配时拒绝。成功恢复未测 |
| `session/close` | request | 只关闭该会话，返回 `{}` |
| `session/set_config_option` | request | 只接受已公布的 `model` 或 `reasoning_effort` |
| `session/prompt` | request | 提交一轮，等待本轮和受管子代理结束后返回 |
| `session/cancel` | notification | 取消该会话当前 prompt 或自主工作。未知 id 无操作 |

客户端需要处理的服务端请求和通知：

| 方法 | 类型 | 作用 |
| --- | --- | --- |
| `session/update` | notification | 文本、思考、工具、配置和用量 |
| `session/request_permission` | request | 一次允许或拒绝。选项 id 为 `allow-once` / `reject-once` |

明确不支持，不能伪造：

- `session/load`：实测 `-32601`，`data.method` 为 `session/load`。
- `session/delete`、`session/fork`、额外目录、SSE MCP、modes、commands、plans、terminal、客户端文件系统和 elicitation：源码 README 列为未暴露。本次没有逐个伪造调用。

### 4.3 实测帧

握手请求：

```json
{"jsonrpc":"2.0","id":"acp-init","method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"sinitek-dsh-probe","version":"0"}}}
```

握手响应：

```json
{"jsonrpc":"2.0","id":"acp-init","result":{"protocolVersion":1,"agentInfo":{"name":"deepseek-harness-acp","version":"0.0.1"},"agentCapabilities":{"mcpCapabilities":{"http":true},"promptCapabilities":{"image":false,"audio":false,"embeddedContext":false},"sessionCapabilities":{"close":{},"list":{},"resume":{}}},"authMethods":[]}}
```

无凭据时 `promptCapabilities.image` 为 false。源码只有附件存储存在且 `resolveModelInfo(...).inputModalities` 含 `image` 时才广告图片。`deepseek-v4-flash` 不在默认目录中，按纯文本路由通过，因此不能把它写成视觉模型。

`session/new` 请求：

```json
{"jsonrpc":"2.0","id":"acp-new","method":"session/new","params":{"cwd":"/tmp/dsh-probe-work","mcpServers":[]}}
```

响应里的 `sessionId` 是 UUID，不是 `session-` 前缀，也不是插件本地 `local_` id。`configOptions` 在无凭据探针中只有当前模型：

```json
{"id":"model","name":"Model","category":"model","type":"select","currentValue":"[\"deepseek-official\",\"deepseek-v4-flash\"]","options":[{"group":"deepseek-official","name":"DeepSeek","options":[{"value":"[\"deepseek-official\",\"deepseek-v4-flash\"]","name":"deepseek-v4-flash"}]}]}
```

```json
{"id":"reasoning_effort","name":"Reasoning effort","category":"thought_level","type":"select","currentValue":"high","options":[{"value":"off","name":"Off"},{"value":"low","name":"Low"},{"value":"high","name":"High"},{"value":"max","name":"Max"}]}
```

模型选项值是 `JSON.stringify([provider, model])`，没有空格。`["deepseek-official","deepseek-v4-pro"]` 在无凭据时不在公布列表中，`session/set_config_option` 返回：

```json
{"code":-32602,"message":"Invalid params: unknown model option: [\"deepseek-official\",\"deepseek-v4-pro\"]"}
```

任意字符串同样返回 `-32602`。`reasoning_effort` 设为 `low` 成功，响应 `currentValue` 变为 `low`。设为 `ultra` 返回：

```json
{"code":-32602,"message":"Invalid params: unknown reasoning effort for deepseek-official/deepseek-v4-flash: ultra"}
```

插件当前使用的 `sinitek-custom` profile 与官方默认路由分开验证。生成的 patch 为验证模型声明 `low`、`high`、`xhigh`、`max`，并声明 DeepSeek `compat`；真实 `dsh --profile acp --patch <path>` 的 `session/new` 广告包含这四个非空 value（另有一个 provider default 空 value）。发送
`session/set_config_option`，参数为 `configId: "reasoning_effort"`、`value: "xhigh"`，响应 `currentValue` 确认为 `xhigh`。插件面板隐藏 `off`、空 value 和未纳入 DeepSeek 契约的值，标签直接显示原始 value。

无凭据 prompt：

```json
{"jsonrpc":"2.0","id":"prompt","method":"session/prompt","params":{"sessionId":"<uuid>","prompt":[{"type":"text","text":"reply with ok"}]}}
```

响应是错误，不是成功 `stopReason`：

```json
{"code":-32603,"message":"Internal error: turn failed: llm-deepseek: no API key for provider route \"deepseek-official\"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment"}
```

完成判定：`session/prompt` 的响应到达才算这一轮结束。`stopReason` 只在成功响应里。错误码 `-32603` 且 message 含 `turn failed` 是失败。不要把没有正文当成成功。

`session/update` 的源码形状：

| `sessionUpdate` | 字段 |
| --- | --- |
| `agent_thought_chunk` | `messageId`，`content.type=text`，`content.text` |
| `agent_message_chunk` | `messageId`，`content` |
| `tool_call` | `toolCallId`，`title`，`kind=other`，`status=in_progress`，`rawInput` |
| `tool_call_update` | `toolCallId`，`status=completed|failed`，`content` |
| `usage_update` | `used`，`size` |
| `config_option_update` | 配置变化后的完整选项状态 |

`usage_update` 只在助手消息带 `usage`、会话有 `requestContext().contextWindow`、并且 `tokenMeter` 存在时发出。`used` 来自 `tokenMeter.measure(session).totalTokens`，`size` 来自上下文窗口。缺用量时不发这条更新。缺用量不是 0。

无凭据探针没有产生 `usage_update`。有凭据时的用量数值未测。

取消：`session/cancel` 是通知。

```json
{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"<uuid>"}}
```

没有进行中的 prompt 时，源码把它当成无操作。进行中的取消往返未测。停止仍应先发这个通知，进程退出时再关闭 stdin，必要时再结束进程组。

`session/close` 返回 `{}`。关闭后该 id 不能再 prompt。持久日志仍可被以后的 `session/resume` 使用；成功 resume 未测。

权限请求源码形状：

```json
{"sessionId":"<uuid>","toolCall":{"toolCallId":"<id>"},"options":[{"optionId":"allow-once","name":"Allow once","kind":"allow_once"},{"optionId":"reject-once","name":"Reject","kind":"reject_once"}]}
```

客户端回答 `{ "outcome": { "outcome": "selected", "optionId": "allow-once" } }`，或取消。真实工具调用触发的往返未测，因为模型请求在凭据处失败。

## 5. SDK JSON-RPC 契约

来源：`@deepseek-ai/dsh-sdk-protocol@0.2.1-rc.2` 与 `@deepseek-ai/dsh-sdk-jsonrpc-server@0.2.1-rc.2`，以及 `dsh --profile sdk` 探针。`serverInfo.version` 同样是 `0.0.1`，不是 CLI 版本。协议 README 写明没有版本协商。

### 5.1 方法

| 方向 | 方法 | 参数 | 结果 |
| --- | --- | --- | --- |
| client→server | `initialize` | `cwd`，`provider`，`model`，可选 `reasoningEffort`，可选 `maxTokens` | `{serverInfo:{name,version}}` |
| client→server | `session/prompt` | `sessionId`，`contentBlocks` | `{messageId}`，只表示入队 |
| client→server | `session/resume` | `sessionId` | `{}` |
| client→server | `session/wait` | `sessionId` | `{}` |
| client→server | `session/working-directory/get` | `sessionId` | `{cwd}` |
| client→server | `session/working-directory/set` | `sessionId`，`path` | `{cwd}` |
| client→server | `shutdown` | 无 params | `{}`，随后进程退出 0 |
| server→client | `session.event` | `sessionId`，`event` | 通知 |
| server→client | `session.status` | `sessionId`，`status=idle|running` | 通知 |
| server→client | `subagent.started` | `parentSessionId`，`childSessionId` | 通知 |
| server→client | `subagent.finished` | `provider`，`agentId`，`parentSessionId`，`childSessionId`，`status`，`stopReason`，可选 `lastAssistantMessage` | 通知 |

没有 `session/cancel`、`session/close`、`session/set_config_option`。实测 `session/cancel` 返回：

```json
{"code":-32603,"message":"unknown DeepSeek Harness SDK runtime method: session/cancel"}
```

这是服务端自己返回的 `-32603`，不是传输层的 `-32601`。不要补一个不存在的取消方法。放弃进行中的 SDK 回合只能结束进程。

`initialize` 前调用 `session/prompt`：

```json
{"code":-32603,"message":"SDK server is not initialized"}
```

未知 provider：

```json
{"code":-32603,"message":"no adapter registered for provider \"not-a-provider\""}
```

`deepseek-official` 加目录内模型 `deepseek-v4-pro` 和 `reasoningEffort=high`，无凭据也能握手成功：

```json
{"serverInfo":{"name":"deepseek-harness-sdk-runtime","version":"0.0.1"}}
```

`model` 可以是任意非空字符串。`not-in-catalog-model` 加 `high` 或省略 effort 都握手成功。这只证明初始化接收字符串。它不证明该模型能执行。`reasoningEffort=ultra` 即使模型名不在目录中也会失败：

```json
{"code":-32603,"message":"provider \"deepseek-official\" model \"not-in-catalog-model\" does not support reasoning effort \"ultra\""}
```

`session/resume` 对不存在的 id：

```json
{"code":-32603,"message":"session \"session-missing\" not found"}
```

成功恢复未测。

### 5.2 prompt、事件、完成和错误

`session/prompt` 立即返回 `{messageId}`。完成要看后续通知，不是看这个响应。

无凭据探针的事件顺序：

1. `session.event` `permission/preset`，`data.preset=workspace-write`
2. `session.event` `sandbox/mode`，`data.mode=workspace-write`
3. `session.event` `approval/policy`，`data.policy=ask`
4. `session.event` `agent/inbox/spliced`
5. `session.status` `running`
6. `session.event` `turn/start`
7. `session/prompt` 响应 `{messageId}`
8. `step/start`
9. `system/message`
10. `user/message`
11. `request/header`
12. `request/context`
13. `assistant/attempt`
14. `step/end`
15. `turn/end`
16. `session.status` `idle`

`request/header.data.header.config` 实测为：

```json
{"provider":"deepseek-official","model":"deepseek-v4-pro","maxTokens":256000,"reasoningEffort":"high"}
```

省略 `reasoningEffort` 时，适配器仍把默认 `high` 写入请求。`adapterDefaults.reasoningEffort` 和 `adapterDefaults.maxTokens` 都是 true。

`request/context` 实测：

```json
{"provider":"deepseek-official","model":"deepseek-v4-pro","contextWindow":1000000}
```

这是窗口上限的真实来源之一。它出现在失败回合里，不代表已用 token。失败回合没有 `usage` 字段，不能记成 0。

失败事件：

```json
{"type":"assistant/attempt","data":{"turn":1,"step":1,"stream":[{"type":"chunk","chunk":{"type":"finish","reason":{"kind":"error","failure":{"code":"MISSING_CREDENTIAL","message":"llm-deepseek: no API key for provider route \"deepseek-official\"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment"}}}}]}}
```

```json
{"type":"turn/end","data":{"turn":1,"reason":{"kind":"error","error":{"code":"MISSING_CREDENTIAL","message":"llm-deepseek: no API key for provider route \"deepseek-official\"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment"}}}}
```

SDK 完成判定：

- `session.status=idle` 且最后一个相关 `turn/end.reason.kind=completed`：成功。
- `turn/end.reason.kind=error`：失败。读取 `reason.error.code` 和 `reason.error.message`。
- `aborted`、`blocked`、`max-tokens`、`interrupted` 都不是普通成功。
- `session/prompt` 的 `messageId` 不是助手消息 id，也不能单独当作成功。
- `session/wait` 源码会等根会话空闲。失败回合上的 wait 行为未测。

文本、思考和工具在 `session.event` 里：

| 事件 | 内容位置 |
| --- | --- |
| `assistant/message` | `data.message.content[]`，`type=text` 或 `type=reasoning`。有适配器用量时带 `data.usage` |
| `tool/call` | `data.callId`，`data.name`，`data.arguments` |
| `tool/result` | `data.message.toolCallId`，`data.message.isError`，`data.message.content` |

无凭据探针没有到达成功的 `assistant/message` 或工具调用。这些字段来自 `dsh-session` 类型和 headless 投影源码，SDK 成功路径未测。

`shutdown` 返回 `{}` 后进程退出码 0。

## 6. Headless 边界

```sh
dsh --profile headless --json "task"
dsh --profile headless --session-id <id> "task"
```

- 位置参数是任务。空白任务在 `--json` 下写一条 `{"type":"error","message":"a task is required..."}` 并退出码 1。
- 未知 `--session-id` 在任务前失败，stderr 为 `dsh: session "<id>" does not exist...`，退出码 1。
- 无凭据的真实任务仍会创建 `session-<uuid>`，写出 `session`、`status`，然后 `turn_end.reason.kind=error`、`code=MISSING_CREDENTIAL`，再写 `{"type":"final","text":""}`。stderr 以 `dsh: MISSING_CREDENTIAL:` 开头。退出码 1。
- 回合内失败仍有 `final`，没有单独的流末 `error` 事件。判定失败要同时看退出码和 `turn_end`。
- `--json` 事件类型：`session`、`status`、`text`、`thinking`、`tool_call`、`tool_result`、`final`、`error`。除 `final` 外字符串有 8 KiB 上限。成功生成的 `text` / `thinking` 样例未测。

Headless 每次进程只跑一个任务。它不是交互 runner。

## 7. 能力矩阵

证据等级：已实测、仅源码确认、不支持、待验证。

| 能力 | 结论 | 证据 | 来源 |
| --- | --- | --- | --- |
| 上下文窗口上限 | 目录模型在请求准备后写入 `request/context.contextWindow`。`deepseek-v4-pro` 实测 `1000000`。默认目录常量也是 `1000000` | 已实测该模型；其他模型待验证 | SDK `request/context`；`dsh-llm-deepseek` `DEFAULT_CONTEXT_WINDOW` |
| 上下文已用量 | ACP 只有同时具备助手 `usage`、窗口和 token meter 才发 `usage_update.used/size`。失败回合没有 usage，不能当 0。Headless `step_end.usage` 同样只在用量完整时出现 | 已实测缺失；有凭据数值待验证 | `dsh-acp` `usageUpdate`；`dsh-token-meter` |
| 手动压缩 | 会话内 `/compact` 调用 `dsh-command-compact`。它不是 JSON-RPC 方法。ACP/SDK 发送 `/compact` 文本是否触发，未测 | 仅源码确认 | `dsh-compaction`，`dsh-command-compact` |
| 自动压缩 | `dsh-compaction-basic` 默认 `auto=true`，`thresholdRatio=0.8`，`headroomTokens=65536`。压力来自 token meter，不是提示词。溢出后可再压缩并重试。摘要替换旧 surface，原日志保留 | 仅源码确认。无长上下文和凭据，未跑通 | `dsh-compaction-basic` README |
| 当前模型 | ACP profile 当前值是 `deepseek-official` / `deepseek-v4-flash`。SDK `agent-default-model` 默认是 `deepseek-official` / `deepseek-flash`。两条入口默认值不同 | 已实测 ACP 选项；SDK 默认来自 `--dump-default-config` | `dsh-acp-app/cordis.patch.yml`；`dsh-base` patch |
| 可选模型枚举 | 无凭据时 ACP 只公布当前模型，不公布默认目录里的 `deepseek-flash` 和 `deepseek-v4-pro`。源码写明缺凭据时 model discovery 返回空目录 | 已实测空凭据列表；有凭据枚举待验证 | `dsh-llm-deepseek-api-key` README；ACP `session/new` |
| 任意模型字符串 | SDK `initialize` 接受任意 `deepseek-official` 模型字符串。ACP `set_config_option` 拒绝未公布值。字符串被接受不等于模型可执行。该结论只属于当时的官方路由。自定义 provider 的未配置 id 不能执行 | 官方路由已实测握手和拒绝；自定义 provider 见契约第 9 节 | SDK/ACP 探针；`.ch/docs/references/dsh-custom-provider-contract.md` |
| 无配置模型的运行条件 | 没有 `DEEPSEEK_API_KEY` 时，SDK、ACP、headless 都在模型请求前失败，code 为 `MISSING_CREDENTIAL`。会话创建和 ACP 思考档切换不需要密钥 | 已实测 | 三条入口探针 |
| 同会话模型切换 | ACP 只能切到当前 `configOptions` 里的值，下一轮生效。无凭据时不能切到 `deepseek-v4-pro`。SDK 没有会话级切换方法 | ACP 拒绝已实测；SDK 切换不支持；ACP 下一轮生效仅源码确认 | `AcpModelControl.set` |
| 思考档 | `off`、`low`、`high`、`max`。默认 `high`。`off` 关闭 thinking。`ultra` 无效。ACP 用字符串 `reasoning_effort`。不要复制 Grok 的 `reasoning_efforts` 自动补齐或 `ultra -> max` | 档位和拒绝已实测；`off` 的 HTTP 序列化仅源码确认 | `dsh-llm-deepseek`；ACP 探针 |
| 工具和权限 | 默认 `DSH_PERMISSION_MODE=workspace-write`，approval `ask`。ACP 有 `session/request_permission`。SDK 没有对应请求，源码写明 server→client request 当前不发送，无应答者时失败关闭 | 预设事件已实测；真实审批往返待验证 | `dsh-base/cordis.patch.yml`；SDK 事件 |
| 附件和图片 | SDK 接受 `image/png`、`image/jpeg`、`image/webp`、`image/gif` 的 base64。ACP 本次广告 `image:false`。默认目录里只有 `deepseek-flash` 声明 image。成功上传未测 | 能力位已实测；上传待验证 | `dsh-sdk-protocol` `SdkEncodedImageBlock`；ACP initialize |
| 会话恢复 | ACP 用 `session/resume`，不用 `session/load`。SDK `session/resume` 缺会话即失败。Headless 未知 id 在任务前失败。成功恢复要同一 cwd、非 subagent、preset 兼容 | 缺失路径已实测；成功恢复待验证 | ACP/SDK/headless 探针；headless README |
| Skills 发现 | 文件系统提供者按 rank 扫描 `<project>/.dsh/skills`、`<project>/.agents/skills`、自定义目录、`$DSH_HOME/skills`、`$DSH_AGENTS_HOME/skills`。形式是 `<name>/SKILL.md` 或顶层 `<name>.md`。无凭据探针看到了默认 agents home 的目录项，未读取正文，未修改 | 发现已实测；安装命令未执行 | `dsh-skill-filesystem` README |
| Skills 市场 | DSH 没有 LobeHub skills 市场命令。插件市场是另一套索引，随包 profile 默认不挂载，安装走 `pluginManager`，不是 skill 目录复制 | 不支持把插件市场当成 skills 市场 | `dsh-plugin-market` README |
| 规则文件 | `$DSH_HOME/AGENTS.md`，然后 `$DSH_AGENTS_HOME/AGENTS.md`，再从项目根到 cwd 的 `AGENTS.md` / `CLAUDE.md`，同目录可加 `.local`。同组内容 trim 后相同则去重。不解释 `.claude/rules/` | 仅源码确认。探针没有投放规则文件 | `dsh-agent-instructions` README |
| 配置定位 | `$DSH_HOME` 或 `~/.dsh`。profile 用户层是 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，其上还有 `$DSH_HOME/cordis.patch.yml` 和 `--patch`。`settings.yaml` 只是旧版一次性导入 | 默认树已用 `--dump-default-config` 查看；未改用户文件 | `dsh-home-paths`；`dsh-settings` |
| 环境变量覆盖 | `DSH_HOME`、`DSH_AGENTS_HOME`、`DEEPSEEK_API_KEY`、`DSH_PERMISSION_MODE`、`DSH_MAX_TOKENS_AS_SUCCESS`、`DSH_TELEMETRY_MODE` 有源码或默认树依据。空的导出变量会挡住 `.env` 回退 | 缺密钥路径已实测；其余覆盖组合待验证 | headless README；base patch |

压缩提示词不是原生压缩。原生压缩是 `compaction/start`、摘要、surface replace、`compaction/end`。插件以后不能只在 prompt 前加一段“请压缩上下文”就声称支持压缩。

## 8. 配置模型列表契约

ACP 不能把用户输入的任意模型字符串设为当前模型。无凭据时连默认目录模型也不会出现在选项里。SDK 能接收任意字符串，但本次不能证明该字符串可执行。

自定义 provider 的执行只接受已配置、且出现在当前 `configOptions` 中的模型。未配置 id 不能执行。官方路由上 initialize 接受任意字符串的结果不能搬到 `sinitek-custom`。数据格式不要复制 Grok。当前页面没有 Grok 式多模型编辑证据，不得把该编辑器写成已交付能力。可见模型 id 必须完整使用 `subcoco/deepseek-v4.1-flash`。

建议的插件侧记录：

```ts
type DshConfiguredModel = {
  id: string;
  provider: "deepseek-official" | string;
  model: string;
  label?: string;
  apiKeyEnv?: string;
};
```

约束：

- `id` 是插件配置表键。执行和 ACP 选项匹配使用 `provider` 与 `model`。
- ACP 线值必须等于 `JSON.stringify([provider, model])`，并且出现在本轮 `configOptions` 的 `value` 中，才能调用 `session/set_config_option`。
- 目标不在公布列表时，不能报告切换成功。可选的未验证路径是把 ACP profile 的 `provider` / `model` 写入 `cordis.patch.yml` 后重启进程。本次没有写用户 profile，也没有验证重启切换。
- `apiKeyEnv` 只保存环境变量名。官方无凭据探针的默认名是 `DEEPSEEK_API_KEY`。当前自定义 provider 固定使用 `SINITEK_DSH_API_KEY`；插件也允许 profile 根级 `apiKey`，启动前将其注入同名子进程环境变量。未配置两者时失败，不回落到 `DEEPSEEK_API_KEY` 或其他平台密钥。直接配置的值只留在本机配置档案和备份，不进入 patch、参数或日志。
- 思考档只使用当前 ACP 公布的 `reasoning_effort` 标量。官方默认路由的历史探针公布过 `off|low|high|max`；插件当前自定义 provider profile 声明 `low|high|xhigh|max` 与 DeepSeek `compat`，因此默认验证模型的 ACP patch 会公布这四个非空档位。其他自定义模型未显式声明能力时不显示选项，`reasoningEfforts: false` 也不会在面板生成 `off`。`/v1/models` 本身不提供思考档证据；面板只显示 ACP 实际公布且属于契约的原始 value，不自动补 Grok 的 `reasoning_efforts`。
- 没有可用凭据时，列表可以显示，但不能把初始化成功或会话创建成功写成模型可执行。

## 9. 与现有插件的对接位置

这些位置已经落地。命令顺序是 `codex`、`claude`、`opencode`、`grok`、`dsh`。Gemini 保持已移除。上文无凭据官方路由探针仍然只描述当时的 `deepseek-official` 结果，不能覆盖自定义 provider。落地边界以 `.ch/docs/references/dsh-custom-provider-contract.md` 为准。

| 位置 | 当前落地 |
| --- | --- |
| `src/cli/types.ts` `CLI_LIST` | `dsh` 追加在 `grok` 之后，没有插入前四项之间 |
| `src/interactive/dshRunner.ts` | 独立 ACP runner。不复用 `session/load` 或 Grok `_meta.yoloMode` |
| `src/interactive/manager.ts` | 单独登记 DSH，沿用进程组清理。恢复用 `session/resume` |
| `src/extensionHost/interactiveTurnDsh.ts` | 宿主回合已接线。缺失 usage 不补 0。窗口标记为 `adapter-fallback` |
| `src/extensionHost/modelSettings.ts` | 读取 DSH 配置模型。不把 Grok 推理档写入 DSH |
| `src/config/dshConfig.ts` 与配置页 | 分组在 Grok 之后。凭据字段只显示 `SINITEK_DSH_API_KEY` |
| `src/config/cliGlobalSkills.ts` | 平台列表包含 `dsh`。Skills 目标是五个，可见顺序保持 Claude、OpenCode、Grok、Codex、DSH。全局 Skills 根是 `$DSH_HOME/skills` |
| `src/config/lobehubSkillMarket.ts` | 市场安装目标包含 `dsh`，写入 DSH skill 根。不要把 `dsh plugin` 当成 skills 市场 |
| 规则链 | 全局读取 `$DSH_HOME/AGENTS.md`。工作区与 Codex、OpenCode、Grok 共享一份 `AGENTS.md`。不把其他 CLI 规则复制进 DSH home |
| `.ch/docs/references/cli-runtime-reference.md` | 已记录落地行为。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。图形点击验收和真实权限请求仍未验证 |

规则读取 DSH 自己的 `AGENTS.md` / `CLAUDE.md` 链。不要把 Grok 或 Codex 规则复制进 DSH home。

## 10. 未覆盖项

下列条目属于 2026-10-24 官方无凭据路由探针的未覆盖项。自定义 provider `subcoco/deepseek-v4.1-flash` 的生成、取消、恢复和插件实跑已记在 `.ch/docs/references/dsh-custom-provider-contract.md`。那份契约不能回填成官方 `DEEPSEEK_API_KEY` 路由已验收，也不能把图形 Extension Host 点击验收写成已完成。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。原生 compaction 不支持。真实权限请求仍未验证。

- 有 `DEEPSEEK_API_KEY` 的成功生成、真实用量数字、真实工具审批和图片上传。
- ACP `session/resume` / `session/list` 的成功样本。
- 进行中的 `session/cancel` 是否在时限内停止模型请求。
- `/compact` 经 ACP 或 SDK 文本触发，以及自动压缩的真实 token 下降。
- 把模型写入 profile 后重启，ACP 是否改公布当前模型。
- `dsh plugin` 的 pnpm 安装。npm 包 README 写明 desktop profile 的插件管理会被拒绝；其他 profile 未执行，避免改用户 profile。
- `next` `0.2.1-rc.3` 与本次安装版本的协议差异。后续升级必须重新探针，不能把本文直接套到 next。
