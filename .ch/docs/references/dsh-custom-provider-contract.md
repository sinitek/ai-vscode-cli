# DSH 自定义 provider 配置契约

- 核对版本：`@deepseek-ai/dsh@0.2.1-rc.2`
- 核对包：已安装包内 `@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.2`
- 核对日期：2026-10-26
- 状态：此前原生 ACP 与插件隔离实跑使用了 `subcoco/deepseek-v4.1-flash`，证明该服务端点的模型 id 需要与 ACP 广告完全一致；这不构成所有端点必须带 `subcoco/` 的通用规则。2026-10-26 已使用本机 `dsh 0.2.1-rc.2`、隔离 `DSH_HOME` 和 loopback OpenAI-compatible SSE 服务，对无前缀范例完成 ACP 单轮实跑：广告和请求都使用 `deepseek-v4.1-flash`，响应 `pong`、`end_turn`。这验证 DSH 与插件 ACP 接线，不证明任意真实远程端点接受该模型 id。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。原生 compaction 不支持。真实 VS Code Extension Development Host 不能无头执行这条路径。权限请求仍未由服务发出，allow/reject 只在协议夹具里验证。
- 发布性质：`0.2.1-rc.2` 仍是发布候选，不是稳定版。

本文是配置模块、ACP runner 和插件实跑已经采用的接线契约。它不把 HTTP 探针、原生 DSH 和插件调用写成同一层验收。

## 1. 验证边界

| 层 | 本次状态 | 不能据此声称 |
| --- | --- | --- |
| HTTP 探针 | 同一用户端点、纠正后的模型，非流式 chat completions 返回非空正文和 `finish_reason=stop` | 不是 DSH 会话，也不是插件验收 |
| 原生 DSH ACP | 隔离 `DSH_HOME` 下真实 `initialize`、`session/new`、两轮 `session/prompt`、`session/resume` 成功 | 不能单独当作插件实跑 |
| 插件调用 | 配置服务激活、隔离 `DSH_HOME`、`prepareDshIsolatedLaunch`、`DshInteractiveRunner` 和 `createPromptInteractiveRuntimeHost` 已对最终模型实跑 | 不是 VS Code Extension Development Host 窗口里的点击验收 |
| 无前缀范例 loopback ACP smoke | 本机 `dsh 0.2.1-rc.2` 读取生成范例；ACP 广告 wire 为 `["sinitek-custom","deepseek-v4.1-flash"]`，HTTP 请求发往 `/v1/chat/completions` 且 `model` 原样为 `deepseek-v4.1-flash`；loopback 返回 `pong` 并以 `end_turn` 收尾 | 使用临时测试密钥和本机模拟服务，只证明范例、ACP 与请求模型接线正确，不证明真实远程服务可用 |

模型 id 由用户的 OpenAI-compatible 端点决定。当前范例采用 `deepseek-v4.1-flash`，不附加 `subcoco/`；如果某个服务实际要求 `subcoco/deepseek-v4.1-flash`，用户应在 `models[].id` 与 `acpModel` 中原样填写该 id。模型 id 中的 `/`（如有）只是 id 字符，不是 provider 路由。实际端点必须支持所配置的精确模型 id；旧模型 `glm-5.3-flash_sub-coco` 的 HTTP 或 DSH 成功不能作为当前范例端点的验收证据。

此前 ACP 探针的模型 wire 是 `JSON.stringify(["sinitek-custom","subcoco/deepseek-v4.1-flash"])`；这是该次探针端点的精确模型 id。插件不会按模型名称增删前缀或把 `deepseek-v4.1-flash` 自动改写成其它值。任意模型 id（包括无前缀短名）只有同时列在 `models[]` 并被 ACP 广告才可执行。请求和会话记录使用配置中的模型 id。

## 2. 保密和进程边界

- 密钥可通过外部 `SINITEK_DSH_API_KEY` 提供，也可在插件 DSH profile 根级填写 `apiKey`。直接填写的值只保存于本机配置档案和备份（目录 `0700`、文件 `0600`），启动时只注入自建 `dsh` 子进程的 `SINITEK_DSH_API_KEY`，不进命令参数、报告、日志或 patch 模板；未填写时回退到外部环境变量。
- 不借用 `DEEPSEEK_API_KEY` 或其他平台密钥。不改目标服务，不替换请求模型。
- `baseURL` 属于运行时私有配置。仓库模板只用示例地址 `https://gateway.example/v1`。插件把真实地址写入隔离 profile 的 patch 或设置，不写入仓库。
- 运行时 `baseURL` 允许 https，也允许无用户名、密码、查询参数和片段的本机 loopback http。主机只接受 `localhost`、以 `.localhost` 结尾的名称、`127.0.0.0/8` 和 `::1`。远程明文 http、带凭据的 URL、文件路径和未验证字段仍然拒绝。
- 使用独立临时 `DSH_HOME`、临时 cwd 和 `dsh --profile acp --patch <path>`。不改用户 `~/.dsh`、凭据文件和默认 profile。
- 不新增仓库依赖，不改全局包源码，不自建协议转换服务。

### 配置页字段分区

- DSH 配置页默认以 JSON 模式打开；可视化模式编辑同一份 profile JSON。
- 配置范例使用安全的示例地址并显式包含空 `apiKey` 字段，不生成任何密钥。一键导入会先验证范例，验证成功后覆盖当前编辑草稿；验证失败时保留抽屉并显示具体错误。当前 profile 为空时，切换到可视化会创建可编辑的本地草稿，保存时仍执行完整 JSON 校验。
- 模型工作区上方集中编辑 profile 公共参数：`provider`（只读）、`baseURL`、可选根级 `apiKey` 和默认模型 `acpModel`。这些字段不属于 `models[]`。
- 模型列表右侧详情只编辑当前 `models[]` 项：必填 `id`、可选显示名 `name` 和可选正整数 `contextWindow`。模型名称为空时规范化为 `id`；`input` 目前固定为 `[text]`，不在可视化中编辑。可选的 `maxTokens` 仍可在 JSON 中保留，但不在可视化中展示或生成，新的参考范例也不包含它。公共可选字段 `displayName`、`timeoutMs`、`streamIdleTimeoutMs`、`retryPolicy` 同样不在可视化中配置或新范例中生成；用户已有 JSON 字段会保留并用于 patch。新增模型以空白草稿加入列表，必须在右侧填写 `id` 才能保存。
- `contextWindow` 只能出现在单个模型对象中，不能写成 profile 顶层公共字段。省略时使用 DSH 适配器 fallback `262144`；这是适配器值，不代表服务公布的模型上下文容量。`maxTokens` 是可选的模型请求默认输出上限，数值按单个 token 计数，不是 `k` 单位。
- `apiKeyEnv` 不显示为表单字段；profile 缺失时保存规范化会自动补齐 `SINITEK_DSH_API_KEY`。可视化里的说明只解释其固定用途和环境变量配置方式。

2026-10-24 探针前后，`~/.dsh`、`settings.yaml`、`.credentials.yaml` 的 mtime 仍是 `2026-08-18T09:01:14+0800`、`2026-08-17T12:57:44+0800`、`2026-08-17T12:54:45+0800`。

## 3. 可复用 patch 模板

来源是已安装 `@deepseek-ai/dsh-llm-pi-ai` README 和 `lib/types/config.d.ts`，再用 `--dump-config` 核对组合结果。patch 按 id 替换目标行的整个 `config`，不是字段级合并。`acp` 行的 `inject` 不在 `config` 内，本次 dump 仍保留 `inject: [acpAppStartup]`。

`providers` 的键是路由名，不是模型 id。手写路由必须有 `api`、`baseURL` 和非空 `models`。`models` 与 `modelOverrides` 不能同时设置。本次只设置 `models`。

已安装官方类型将 `apiKeyEnv` 声明为可选；省略时 provider 保持无凭据配置。插件为隔离运行时统一凭据注入使用固定变量名 `SINITEK_DSH_API_KEY`：用户 profile 输入可以省略该字段，插件会在规范化时补回，生成的 patch 始终包含它。可视化模式不展示该字段；实际密钥应填写根级 `apiKey` 或通过系统环境变量提供。

配置页生成的 DSH 范例已包含可运行所需的 provider、协议、无前缀模型 id 和 API key 环境变量引用。复制后填写根级 `apiKey` 与 `baseURL` 即可；前提是该地址提供 OpenAI Chat Completions 兼容接口，并且服务支持范例中的精确模型 id `deepseek-v4.1-flash`。`baseURL` 填 API 根地址（通常以 `/v1` 结尾），不要填 `/chat/completions` 子路径。若服务公告的模型 id 不同，则将 `models[].id` 与 `acpModel` 一并改成服务要求的精确 id；仅改密钥和地址不会让服务自动提供该模型。

```yaml
- id: llm-pi-ai
  config:
    providers:
      sinitek-custom:
        apiKeyEnv: SINITEK_DSH_API_KEY
        api: openai-completions
        baseURL: https://gateway.example/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
            input:
              - text
- id: acp
  config:
    provider: sinitek-custom
    model: deepseek-v4.1-flash
```

当前必须采用的值：

| 字段 | 采用值 | 说明 |
| --- | --- | --- |
| provider 路由 | `sinitek-custom` | 小写连字符路由名，与模型 id 独立 |
| `acp.config.model` 与 `models[].id` | `deepseek-v4.1-flash` | 配置范例使用的精确模型 id；按目标服务的实际模型 id 调整两个字段 |
| `api` | `openai-completions` | 已安装 schema 的协议名。不是 DeepSeek 专用接口，也不是 Grok TOML |
| `apiKeyEnv` | `SINITEK_DSH_API_KEY` | patch 中的凭据引用。直接配置 `apiKey` 时由插件在启动子进程前注入同名环境变量；不回落到其他平台密钥 |
| `baseURL` | 用户端点，文档不记录 | 示例只写 `https://gateway.example/v1`。运行时还可接受无凭据的本机 loopback http。远程明文 http 不接受。本次实测路径以 `/v1` 结尾 |
| `displayName` | 可选 | 仅用于 provider 展示名称；可视化和参考范例不生成。已有 JSON 配置时保留 |
| `timeoutMs` | 可选 | provider 请求超时；可视化和参考范例不生成。已有 JSON 配置时保留 |
| `streamIdleTimeoutMs` | 可选 | 流式空闲超时；可视化和参考范例不生成。已有 JSON 配置时保留 |
| `retryPolicy` | 可选 | 重试策略；可视化和参考范例不生成。已有 JSON 配置时保留，插件仍校验为已验证的 `normal` 配置 |
| `models` | 按顺序列出完整模型对象；`id` 必填，`name`、`contextWindow`、`maxTokens` 为模型级字段 | 不同时写 `modelOverrides`；上下文窗口不能放在 profile 根级 |
| `input` | `[text]` | 本次 `promptCapabilities.image` 为 false |
| `maxTokens` | 可选 | 配置中存在时作为本次请求输出帽；数值按单个 token 计数，不是 `k`，也不是服务公布的输出容量。可视化和参考范例不生成该字段 |
| `contextWindow` | 本次部署未设置；可按模型需要配置正整数 | 省略后走适配器 fallback `262144`。不能称作服务确认的窗口 |
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

ACP 模型线值是 `JSON.stringify([provider, model])`，默认没有空格。此前针对旧探针模型 id 的实测：

```text
["sinitek-custom","subcoco/deepseek-v4.1-flash"]
```

`session/new` 和 `session/resume` 的 `configOptions` 当前值、选项值和显示名都指向该端点实际广告的 id。provider 组是 `sinitek-custom`；模型 id 不会被插件拆分或重写。此处旧探针结果不替代新范例 id 的实跑。

拒绝结果：

| 选择 | 结果 |
| --- | --- |
| 再写回上述完整线值 | 成功，当前值不变 |
| `["sinitek-custom","deepseek-v4.1-flash"]` | 在此前只广告带前缀 id 的端点上返回 `-32602`，`unknown model option`；其它端点可能公告并接受此 id |
| `["sinitek-custom","not-configured-model"]` | `-32602`，`unknown model option` |

`["subcoco","deepseek-v4.1-flash"]` 也不是合法选择。目录接受选择和真实生成是两件事。只有线值出现在 `configOptions` 里，才允许 `session/set_config_option`。

插件 `resolveDshConfigModel` 只在 `selectedModel` 缺失或空白时回退已配置默认模型。显式未知模型和错误 provider/model 线值返回 null，不静默改成默认模型。配置 id `deepseek-v4.1-flash` 可被原样映射为 `JSON.stringify(["sinitek-custom","deepseek-v4.1-flash"])`；`subcoco/deepseek-v4.1-flash` 等自定义 id 也按配置原样映射。只有 ACP 当前广告的值才会下发。

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

会话日志里的请求头配置是 `provider=sinitek-custom`、`model=deepseek-v4.1-flash`、`api=openai-completions`。`responseModel` 才是别名 `deepseek-v4.1-flash`。文本回合的 replay `stopReason` 是 `stop`。

`session/resume` 在新进程上使用同一 UUID 和同一绝对 cwd。`session/list` 列出该 UUID。resume 响应带有上述 `configOptions`，没有回放旧正文。`0.2.1-rc.2` 的成功 resume 可以不重复 `sessionId`，只返回 `configOptions`。runner 在结果没有 `sessionId` 时保留请求里的 UUID；结果里如果出现另一个 id，仍然拒绝。本次没有把新建会话冒充恢复。`session/load` 单独返回 `-32601`，`data.method=session/load`。不要发送 `session/load`。

`session/close` 返回 `{}`。关闭 stdin 后进程退出码 0。

成功判定：`session/prompt` 的 JSON-RPC result、非空 `agent_message_chunk` 正文，以及 `stopReason` 同时存在。只有部分正文、或 result 缺失、或错误码 `-32603` 且 message 含 `turn failed`，都算未跑通。

## 6. HTTP 探针

同一用户端点先做了有超时的探针，用来区分服务问题和 DSH 适配问题。它不是原生 DSH 证据。

- `GET /v1/models`：HTTP 200，约 2 ms。列表中存在精确 id `deepseek-v4.1-flash`。该条目键只有 `id`、`object`、`owned_by`、`display_name`、`disabled`、`enabled_instance_count`、`available_instance_count`、`created`。没有思考档、上下文窗口或输出容量字段。
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

此前实跑覆盖 `initialize`、`session/new`、同一进程两轮 prompt、`session/cancel`、新进程 `session/resume`，以及宿主上的新建、同标签续聊和 resume，使用的模型线值为 `["sinitek-custom","subcoco/deepseek-v4.1-flash"]`。这仅记录当时端点的广告值，不规定新范例或其它端点必须使用该前缀。未知线值和错误拆分在发到 runner 之前失败，不改当前模型。若激活 marker 指向的 `config_<id>.json` 与 `active-profile.json` 或 `active-patch.yaml` 漂移，启动前以当前激活档案为权威来源重建两份快照；显式外部 `patchSourcePath` 不受影响。`usage_update.size` 仍是 `262144`，宿主消息的 `contextWindowSource` 是 `adapter-fallback`。缺失 usage 不补 0。`compactSession` 抛出 `compaction-unsupported`，隔离 home 里没有 `session/compact`，也没有把 `/compact` 当 prompt。思考档在默认范例模型上为 `low|high|xhigh|max`，并由 ACP 确认后下发。

隔离 home 按标签页 id 固定。UI 会话 id 从 `local_` 变成 ACP UUID 后仍使用原来的 home。runner 注册表记下 ACP id，同一进程的下一轮才能复用。`session/resume` 成功时可以不重复 `sessionId`。

配置页已把 DSH 接在 Grok 之后。JSON 文本和可视化编辑同一份完整 JSON；无效 JSON 不覆盖上一份有效可视化状态。已接受的额外顶层字段和模型对象字段在文本、可视化和保存回读中保留。未验证字段、非根级 `apiKey` 密钥字段，以及 `retryPolicy` 上未建模的键，在验证阶段拒绝，不先接受再丢弃。根级 `apiKey` 可直接保存，配置页以密码输入显示，但 JSON 模式仍可见；配置文件和备份仅用户可读，运行 patch 不写入该字段。provider 只读。`baseURL`、模型 id、固定的 `apiKeyEnv` 和可选 `apiKey` 可编辑；未填写 `apiKey` 时使用外部 `SINITEK_DSH_API_KEY`。可选公共字段 `displayName`、`timeoutMs`、`streamIdleTimeoutMs`、`retryPolicy` 不在可视化中展示或新范例中生成，已有 JSON 配置会保留且只有显式存在时才写入 patch。默认范例模型 id 为 `deepseek-v4.1-flash`；模型 id 按端点要求原样配置，不作前缀迁移。已安装 `@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.2` 的 `PiAiProviderProfile.models` 是有序数组，页面按该顺序新增、编辑、删除并选择当前 `acpModel`。只有配置在 `models[]` 且被 ACP 广告的 id 才能执行。DSH 详情区不显示激活状态；保存已激活档案和列表激活动作仍走 `activateDshProfile`。保存、激活和删除走原有路径。Skills 目标是五个，顺序保持 Claude、OpenCode、Grok、Codex、DSH。复制和市场安装可以选择 DSH，安装根是 `<DSH_HOME>/skills`。全局规则是 `<DSH_HOME>/AGENTS.md`，工作区规则是共享的 `AGENTS.md`。DSH ACP 没有显式 skills 方法。这些页面接线有节点渲染和保存路径测试，没有在 VS Code 窗口里点击验收。

VS Code Extension Development Host 没有无头跑起来。`Code --help` 没有 `--headless` 或 `--extensionDevelopmentPath`。带 `--extensionDevelopmentPath`、`--disable-extensions`、`--disable-gpu` 和独立 `--user-data-dir` 的调用立刻返回 0，实际拉起的是图形界面 Electron，没有执行 DSH 回合。替代证据是宿主集成测试：它调用真实的 `createPromptInteractiveRuntimeHost`、`prepareDshIsolatedLaunch`、`InteractiveRunnerManager` 和 `DshInteractiveRunner`。这不是原生 ACP 探针，也不是图形 Extension Host 点击验收。

权限请求在这次插件实跑里没有出现。allow/reject 只由协议夹具覆盖。
