# DSH 自定义 provider 配置契约

- 核对版本：`@deepseek-ai/dsh@0.2.1-rc.2`
- 核对包：已安装包内 `@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.2`
- 核对日期：2026-10-24
- 状态：原生 ACP 已用纠正后的模型跑通。插件配置服务、隔离启动、`DshInteractiveRunner` 和 Extension Host 运行时边界已用同一模型实跑。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。原生 compaction 不支持。真实 VS Code Extension Development Host 不能无头执行这条路径。权限请求仍未由服务发出，allow/reject 只在协议夹具里验证。
- 发布性质：`0.2.1-rc.2` 仍是发布候选，不是稳定版。

本文是配置模块、ACP runner 和插件实跑已经采用的接线契约。它不把 HTTP 探针、原生 DSH 和插件调用写成同一层验收。

## 1. 三层证据

| 层 | 本次状态 | 不能据此声称 |
| --- | --- | --- |
| HTTP 探针 | 同一用户端点、纠正后的模型，非流式 chat completions 返回非空正文和 `finish_reason=stop` | 不是 DSH 会话，也不是插件验收 |
| 原生 DSH ACP | 隔离 `DSH_HOME` 下真实 `initialize`、`session/new`、两轮 `session/prompt`、`session/resume` 成功 | 不能单独当作插件实跑 |
| 插件调用 | 配置服务激活、隔离 `DSH_HOME`、`prepareDshIsolatedLaunch`、`DshInteractiveRunner` 和 `createPromptInteractiveRuntimeHost` 已对最终模型实跑 | 不是 VS Code Extension Development Host 窗口里的点击验收 |

用户已纠正模型名。最终模型 id 必须是完整字符串 `subcoco/deepseek-v4.1-flash`。后续更正只覆盖模型名，URL 和 key 沿用原先提供的值。旧模型 `glm-5.3-flash_sub-coco` 的 HTTP 或 DSH 成功不能作为本模型的验收证据。不得回退旧模型，不得删除 `subcoco/` 前缀，不得用响应里的 `model` 别名改写配置。

本次响应别名是 `deepseek-v4.1-flash`。请求和会话记录里的模型仍是完整 id。配置继续写完整 id。

## 2. 保密和进程边界

- 密钥可通过外部 `SINITEK_DSH_API_KEY` 提供，也可在插件 DSH profile 根级填写 `apiKey`。直接填写的值只保存于本机配置档案和备份（目录 `0700`、文件 `0600`），启动时只注入自建 `dsh` 子进程的 `SINITEK_DSH_API_KEY`，不进命令参数、报告、日志或 patch 模板；未填写时回退到外部环境变量。
- 不借用 `DEEPSEEK_API_KEY` 或其他平台密钥。不改目标服务，不替换请求模型。
- `baseURL` 属于运行时私有配置。仓库模板只用示例地址 `https://gateway.example/v1`。插件把真实地址写入隔离 profile 的 patch 或设置，不写入仓库。
- 运行时 `baseURL` 允许 https，也允许无用户名、密码、查询参数和片段的本机 loopback http。主机只接受 `localhost`、以 `.localhost` 结尾的名称、`127.0.0.0/8` 和 `::1`。远程明文 http、带凭据的 URL、文件路径和未验证字段仍然拒绝。
- 使用独立临时 `DSH_HOME`、临时 cwd 和 `dsh --profile acp --patch <path>`。不改用户 `~/.dsh`、凭据文件和默认 profile。
- 不新增仓库依赖，不改全局包源码，不自建协议转换服务。

2026-10-24 探针前后，`~/.dsh`、`settings.yaml`、`.credentials.yaml` 的 mtime 仍是 `2026-08-18T09:01:14+0800`、`2026-08-17T12:57:44+0800`、`2026-08-17T12:54:45+0800`。

## 3. 可复用 patch 模板

来源是已安装 `@deepseek-ai/dsh-llm-pi-ai` README 和 `lib/types/config.d.ts`，再用 `--dump-config` 核对组合结果。patch 按 id 替换目标行的整个 `config`，不是字段级合并。`acp` 行的 `inject` 不在 `config` 内，本次 dump 仍保留 `inject: [acpAppStartup]`。

`providers` 的键是路由名，不是模型 id。手写路由必须有 `api`、`baseURL` 和非空 `models`。`models` 与 `modelOverrides` 不能同时设置。本次只设置 `models`。

已安装官方类型将 `apiKeyEnv` 声明为可选；省略时 provider 保持无凭据配置。插件为隔离运行时统一凭据注入使用固定变量名 `SINITEK_DSH_API_KEY`：用户 profile 输入可以省略该字段，插件会在规范化时补回，生成的 patch 始终包含它。UI 中该字段只读，实际密钥应填写根级 `apiKey` 或通过系统环境变量提供。

示例地址和示例模型只说明字段形状。当前部署要把模型 id 换成下面的完整字符串，把 `baseURL` 换成运行时端点。

```yaml
- id: llm-pi-ai
  config:
    providers:
      sinitek-custom:
        displayName: Sinitek custom
        apiKeyEnv: SINITEK_DSH_API_KEY
        api: openai-completions
        baseURL: https://gateway.example/v1
        timeoutMs: 45000
        streamIdleTimeoutMs: 60000
        retryPolicy:
          mode: normal
          maxRetries: 1
          backoff:
            initialDelayMs: 200
            maxDelayMs: 1000
        models:
          - id: example-vendor/example-model
            name: example-vendor/example-model
            input:
              - text
            maxTokens: 256
- id: acp
  config:
    provider: sinitek-custom
    model: example-vendor/example-model
```

当前必须采用的值：

| 字段 | 采用值 | 说明 |
| --- | --- | --- |
| provider 路由 | `sinitek-custom` | 小写连字符路由名。不是把模型 id 按 `/` 拆出的 `subcoco` |
| `acp.config.model` 与 `models[].id` | `subcoco/deepseek-v4.1-flash` | 一个完整模型 id。斜杠是 id 的一部分 |
| `api` | `openai-completions` | 已安装 schema 的协议名。不是 DeepSeek 专用接口，也不是 Grok TOML |
| `apiKeyEnv` | `SINITEK_DSH_API_KEY` | patch 中的凭据引用。直接配置 `apiKey` 时由插件在启动子进程前注入同名环境变量；不回落到其他平台密钥 |
| `baseURL` | 用户端点，文档不记录 | 示例只写 `https://gateway.example/v1`。运行时还可接受无凭据的本机 loopback http。远程明文 http 不接受。本次实测路径以 `/v1` 结尾 |
| `models` | 只列上述完整 id | 不同时写 `modelOverrides` |
| `input` | `[text]` | 本次 `promptCapabilities.image` 为 false |
| `maxTokens` | `256` | 这是本次请求输出帽，`adapterDefaults.maxTokens` 为 true。不是服务公布的输出容量 |
| `contextWindow` | 省略 | 省略后走适配器 fallback `262144`。不能称作服务确认的窗口 |
| `reasoningEfforts` | `low: low`、`medium: medium`、`high: high`、`xhigh: xhigh`、`max: max` | DSH ACP 仅公布 profile 中声明且当前适配器支持的标量；插件默认验证模型补齐该档位映射，不生成 `off` |
| `compat` | `thinkingFormat: deepseek`、`supportsReasoningEffort: true` | 告诉 `llm-pi-ai` 按 DeepSeek 思考格式支持 reasoning effort |

未验证因而不要写进第一版 patch 的字段：`headers`、`thinkingBudgets`、`cacheRetention`、`transport`、`defaultContextWindow`、`defaultInput`。`retryPolicy.mode=always` 会无界重试，不要使用。

启动形状：

```sh
DSH_HOME=<隔离目录> SINITEK_DSH_API_KEY=<仅子进程环境> \
  dsh --profile acp --patch <隔离 patch>
```

工作目录用调用方传入的绝对 cwd。不要把仓库或用户家目录当成探针 cwd。

## 4. 模型选择

ACP 模型线值是 `JSON.stringify([provider, model])`，默认没有空格。本次实测：

```text
["sinitek-custom","subcoco/deepseek-v4.1-flash"]
```

`session/new` 和 `session/resume` 的 `configOptions` 当前值、选项值和显示名都指向这个完整 id。provider 组是 `sinitek-custom`，不是 `subcoco`。

拒绝结果：

| 选择 | 结果 |
| --- | --- |
| 再写回上述完整线值 | 成功，当前值不变 |
| `["subcoco","deepseek-v4.1-flash"]` | `-32602`，`unknown model option` |
| `["sinitek-custom","not-configured-model"]` | `-32602`，`unknown model option` |

斜杠拆分不是合法选择。目录接受选择和真实生成是两件事。只有线值出现在 `configOptions` 里，才允许 `session/set_config_option`。

插件 `resolveDshConfigModel` 只在 `selectedModel` 缺失或空白时回退已配置默认模型。显式未知模型、错误 provider/model 线值、响应别名 `deepseek-v4.1-flash` 和斜杠拆分值返回 null，不静默改成默认模型。完整模型 id 与 `JSON.stringify(["sinitek-custom","subcoco/deepseek-v4.1-flash"])` 解析为配置中的完整 id。

### Loop、Loop+ 与 Graph 角色选择

- DSH 复用现有主模型/子模型控件，候选均来自当前活动 profile 的有序 `models`；主角色和子角色可独立选择，不引入 profile 外模型。
- 思考力度按各角色当前模型在 profile 中声明的 `reasoningEfforts` 显示。未声明能力的模型禁用该角色选择器；配置选择按 `configId`、角色和模型隔离保存。
- Loop、Loop+ 和 Graph 都将选中角色模型及力度传给对应 DSH ACP turn。profile 声明只控制可选项；运行前仍须由 DSH runner 检查当前 ACP `configOptions`，并通过 `session/set_config_option` 确认后应用。

## 5. 原生 ACP 实测

时间：`2026-10-24T16:09:56+08:00` 至 `2026-10-24T16:10:08+08:00`。进程退出码 0。隔离 home、patch 和会话日志在证据提取后删除，不进入仓库。

握手 `protocolVersion=1`，`agentInfo.name=deepseek-harness-acp`，`agentInfo.version=0.0.1`。`sessionCapabilities` 有 `close`、`list`、`resume`。没有单独的 initialized 通知。

`session/new` 返回 ACP UUID `9a871318-21c4-4603-8e65-693ba8589abe`。这不是插件本地 `local_` id。runner 必须分开保存这两种 id。恢复只把 ACP UUID 传给 `session/resume`。

| 轮次 | 结果 | `stopReason` | 增量正文 |
| --- | --- | --- | --- |
| 同一会话第一轮 | JSON-RPC result | `end_turn` | `pong` |
| 同一会话第二轮 | JSON-RPC result | `end_turn` | `pong-2` |
| 新进程 `session/resume` 后 | JSON-RPC result | `end_turn` | `resumed` |

会话日志里的请求头配置是 `provider=sinitek-custom`、`model=subcoco/deepseek-v4.1-flash`、`api=openai-completions`。`responseModel` 才是别名 `deepseek-v4.1-flash`。文本回合的 replay `stopReason` 是 `stop`。

`session/resume` 在新进程上使用同一 UUID 和同一绝对 cwd。`session/list` 列出该 UUID。resume 响应带有上述 `configOptions`，没有回放旧正文。`0.2.1-rc.2` 的成功 resume 可以不重复 `sessionId`，只返回 `configOptions`。runner 在结果没有 `sessionId` 时保留请求里的 UUID；结果里如果出现另一个 id，仍然拒绝。本次没有把新建会话冒充恢复。`session/load` 单独返回 `-32601`，`data.method=session/load`。不要发送 `session/load`。

`session/close` 返回 `{}`。关闭 stdin 后进程退出码 0。

成功判定：`session/prompt` 的 JSON-RPC result、非空 `agent_message_chunk` 正文，以及 `stopReason` 同时存在。只有部分正文、或 result 缺失、或错误码 `-32603` 且 message 含 `turn failed`，都算未跑通。

## 6. HTTP 探针

同一用户端点先做了有超时的探针，用来区分服务问题和 DSH 适配问题。它不是原生 DSH 证据。

- `GET /v1/models`：HTTP 200，约 2 ms。列表中存在精确 id `subcoco/deepseek-v4.1-flash`。该条目键只有 `id`、`object`、`owned_by`、`display_name`、`disabled`、`enabled_instance_count`、`available_instance_count`、`created`。没有思考档、上下文窗口或输出容量字段。
- 非流式 `POST /v1/chat/completions`：HTTP 200，3179 ms。请求模型是完整 id。正文 `pong`，`finish_reason=stop`。响应 `model` 是别名，未用来改配置。
- 该成功响应的 `Content-Type` 是 `text/event-stream`，但正文是一份可解析的 JSON 对象，不是本次按 SSE 帧组装的结果。不要把这次探针写成流式协议验收。
- 服务 usage 存在：`prompt_tokens=10`、`completion_tokens=2`、`total_tokens=12`。这只属于这次 HTTP 请求。
- 未配置字符串 `not-configured-model`：HTTP 404，无生成正文。API 不接受任意模型字符串。

## 7. 用量

ACP 本次发出了 `usage_update`。字段存在，所以不是缺失。数值不能换成 0，也不能换成 HTTP usage。

| 来源 | 数值 | 含义 |
| --- | --- | --- |
| HTTP `usage` | `10 / 2 / 12` | 服务对该次短请求的 token 计数 |
| 会话 `assistant/message.data.usage` | 第一轮 `inputTokens=5872`、`outputTokens=2`、`totalTokens=5874` | DSH 本地计量，含系统提示和工具 |
| ACP `usage_update` | 第一轮 `used=5967`、`size=262144`；第二轮 `used=5992`、`size=262144` | `used` 来自 `tokenMeter.measure(session).totalTokens`；`size` 来自 `requestContext().contextWindow` |

`size=262144` 与 `request/context.contextWindow` 一致，是省略 `contextWindow` 后的适配器默认 `DEFAULT_CONTEXT_WINDOW`。服务模型对象没有公布窗口。插件可以把 `used` 显示为 DSH 计量值，必须把 `size` 标成适配器 fallback，不能标成服务确认容量。没有 `usage_update` 时不显示 0。

## 8. 思考档

插件使用的 DeepSeek 自定义模型将标准档位声明为 `low`、`medium`、`high`、`xhigh`、`max`。`@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.2` 的 ACP `configOptions` 会原样公布模型 profile 的 `reasoningEfforts`；插件面板只显示当前已选模型公布且属于契约的值，并以 `session/set_config_option` 的标量 `value` 写回。

- DSH 选择器不复用 Grok 的扩展档位，只展示适配器实际广告的规范值；当前验证模型的广告值是 `low`、`high`、`xhigh`、`max`，ACP 额外返回的 provider default 空 value 不进入面板。
- DSH 配置使用 `low: low`、`medium: medium`、`high: high`、`xhigh: xhigh`、`max: max`，配合 `compat.thinkingFormat=deepseek` 与 `supportsReasoningEffort=true`；默认验证模型在旧 profile 缺字段、旧四档结构或使用旧 `off` 结构时归一为此能力。配置 patch 生成后，ACP 只会公布当前适配器实际接受的档位。
- 其它自定义模型不会根据模型名称猜测能力：只有 profile 显式声明完整 `reasoningEfforts` 与 `compat` 才显示声明且被 ACP 公告的档位；`reasoningEfforts: false` 或 `off` 只会让选择器没有可用档位；两者均省略则不显示可选档。选项标签直接显示 ACP 原始 value，不翻译成中文。
- `/v1/models` 不公布 reasoning 字段，不代表 DSH provider 不能按已验证的 DeepSeek 格式声明该能力；usage 中的 `reasoning_tokens` 也不是档位证据。
- 面板只展示 ACP 当前公布且属于契约的规范档位 `low`、`medium`、`high`、`xhigh`、`max`，不展示 `off`、空 value 或其它别名。旧 DSH 思考值 `off` 或缺少 `medium` 的旧结构会归一到新档位；runner 仍以 ACP 当前公布值为最终依据，未公布档位不会发送。

2026-10-25 用当前插件生成的五档 profile patch 在隔离 `DSH_HOME` 下启动 `dsh 0.2.1-rc.2`，`session/new` 的 `reasoning_effort` 公告为 `""`、`low`、`medium`、`high`、`xhigh`、`max`；其中空 value 仍被面板过滤，`medium` 可通过 ACP 确认。

来源： [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)；当前仓库记录的本机 DSH/`llm-pi-ai` 版本与 ACP 实测契约见本文件第 1 节和 `.ch/docs/references/deepseek-harness-api-reference.md`。

## 9. 未配置模型

三层都不接受未配置 id `not-configured-model`：

- HTTP 404，没有生成。
- ACP 目录拒绝选择，`-32602`。没有进入生成。
- SDK `initialize` 拒绝：`-32603`，`pi-ai provider "sinitek-custom" has no configured model "not-configured-model"`。这次没有发出可执行的 `session/prompt`。

因此不能根据“initialize 接受字符串”宣称该模型可执行。旧文档里 `deepseek-official` 握手接受任意字符串的结果，只属于那条官方路由，不能搬到 `sinitek-custom`。

## 10. 取消、权限、压缩

取消已实测。`session/cancel` 是无 id 通知。发出进行中的 prompt 后约 1.5 秒发送该通知，prompt result 的 `stopReason` 为 `cancelled`，没有增量正文。会话 `turn/end` 为 `kind=aborted`、`reason.kind=user`。这不是成功生成。

权限往返未跑通。客户端没有全局自动批准。工作区 read 和 `/etc/hosts` read 都完成了工具调用，但两条都没有发出 `session/request_permission`。会话预设仍是 `permission/preset=workspace-write`、`sandbox/mode=workspace-write`、`approval/policy=ask`。源码里的允许选项仍是 `allow-once` / `reject-once`。本次没有观察到可选中的请求，所以不能写成服务侧权限协商已验证。插件实跑同样没有出现 `session/request_permission`。allow-once 与 reject-once 的往返只在 runner 的协议夹具里验证：宿主返回选中的 optionId 时，runner 原样回写；没有选择时回写 cancelled。Extension Host 回合策略当前对真实请求返回空处理，runner 因此回答 cancelled，不自动批准。没有请求到达时，不要假装已经批准或拒绝。

压缩在当前 ACP 上不支持。

- `session/compact` 返回 `-32601`，`data.method=session/compact`。
- 组合里挂着 `compaction-basic` 和 `command-compact`，但 ACP 没有命令面。挂载不等于 ACP 可调用。
- 没有把文本 `/compact` 当作 prompt 发送。那样只是把文本交给模型，不是原生压缩。
- 会话日志没有 `compaction/` 事件。短会话没有触及默认 `thresholdRatio=0.8` 的自动压缩。没有伪造 `compacted` 或成功结果。
- 自动压缩的源码行为仍然有效：压力或上下文溢出后由 `dsh-compaction-basic` 执行。本次没有观察到它运行。

## 11. 插件运行时边界

配置服务激活、隔离 `DSH_HOME`、`prepareDshIsolatedLaunch`、`DshInteractiveRunner` 和 `createPromptInteractiveRuntimeHost` 已用最终模型实跑。密钥从外部环境或 profile 根级 `apiKey` 进入子进程环境 `SINITEK_DSH_API_KEY`，不进入 patch。真实端点不写入仓库。

实跑覆盖 `initialize`、`session/new`、同一进程两轮 prompt、`session/cancel`、新进程 `session/resume`，以及宿主上的新建、同标签续聊和 resume。模型线值保持 `["sinitek-custom","subcoco/deepseek-v4.1-flash"]`。别名和斜杠拆分在发到 runner 之前失败，不改当前模型。`usage_update.size` 仍是 `262144`，宿主消息的 `contextWindowSource` 是 `adapter-fallback`。缺失 usage 不补 0。`compactSession` 抛出 `compaction-unsupported`，隔离 home 里没有 `session/compact`，也没有把 `/compact` 当 prompt。思考档在默认验证模型上为 `low|high|xhigh|max`，并由 ACP 确认后下发。

隔离 home 按标签页 id 固定。UI 会话 id 从 `local_` 变成 ACP UUID 后仍使用原来的 home。runner 注册表记下 ACP id，同一进程的下一轮才能复用。`session/resume` 成功时可以不重复 `sessionId`。

配置页已把 DSH 接在 Grok 之后。JSON 文本和可视化编辑同一份完整 JSON；无效 JSON 不覆盖上一份有效可视化状态。已接受的额外顶层字段和模型对象字段在文本、可视化和保存回读中保留。未验证字段、非根级 `apiKey` 密钥字段，以及 `retryPolicy` 上未建模的键，在验证阶段拒绝，不先接受再丢弃。根级 `apiKey` 可直接保存，配置页以密码输入显示，但 JSON 模式仍可见；配置文件和备份仅用户可读，运行 patch 不写入该字段。provider 只读。`baseURL`、模型 id、固定的 `apiKeyEnv` 和可选 `apiKey` 可编辑；未填写 `apiKey` 时使用外部 `SINITEK_DSH_API_KEY`。默认模型 id 保持完整 `subcoco/deepseek-v4.1-flash`。已安装 `@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.2` 的 `PiAiProviderProfile.models` 是有序数组，页面按该顺序新增、编辑、删除并选择当前 `acpModel`。别名和未列入该数组的 id 不能执行。DSH 详情区不显示激活状态；保存已激活档案和列表激活动作仍走 `activateDshProfile`。保存、激活和删除走原有路径。Skills 目标是五个，顺序保持 Claude、OpenCode、Grok、Codex、DSH。复制和市场安装可以选择 DSH，安装根是 `<DSH_HOME>/skills`。全局规则是 `<DSH_HOME>/AGENTS.md`，工作区规则是共享的 `AGENTS.md`。DSH ACP 没有显式 skills 方法。这些页面接线有节点渲染和保存路径测试，没有在 VS Code 窗口里点击验收。

VS Code Extension Development Host 没有无头跑起来。`Code --help` 没有 `--headless` 或 `--extensionDevelopmentPath`。带 `--extensionDevelopmentPath`、`--disable-extensions`、`--disable-gpu` 和独立 `--user-data-dir` 的调用立刻返回 0，实际拉起的是图形界面 Electron，没有执行 DSH 回合。替代证据是宿主集成测试：它调用真实的 `createPromptInteractiveRuntimeHost`、`prepareDshIsolatedLaunch`、`InteractiveRunnerManager` 和 `DshInteractiveRunner`。这不是原生 ACP 探针，也不是图形 Extension Host 点击验收。

权限请求在这次插件实跑里没有出现。allow/reject 只由协议夹具覆盖。
