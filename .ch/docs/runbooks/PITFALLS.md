# 避坑指南索引

这个文件用于记录仍有行动价值的真实踩坑。starter 默认不预置条目，也不为空内容预建模块分片。

历史复盘（已修复、已废弃、仅历史版本有效）先放在 [PITFALLS_HISTORY.md](./PITFALLS_HISTORY.md)。

## 记录原则

- 只记录真实发生过、已确认会复发或仍需长期防回归的问题。
- 每个条目必须写清楚“现象 → 触发条件/根因 → 长期规避 → 验证方式”。
- 如果问题已经被彻底修复或方案已废弃，不再留在主文件，迁移到历史归档。
- 条目状态尽量使用可执行语义：`有效`、`需部署时检查`、`已规避`、`需观察`。
- 同一主题超过 5 条仍有效条目，或单文件超过约 300 行时，再拆出专题文件并在本页建立索引。

## 当前有效条目

## OpenCode provider `npm` 不能按模型品牌推断

- 状态：有效
- 首次发现：2026-07-10
- 适用范围：OpenCode 配置中心、自定义 provider、配置校验与文档范例

### 现象
- 配置范例如果使用 Claude、Gemini 或 DeepSeek 型号名，同时写 `npm: "@ai-sdk/openai-compatible"`，用户容易认为适配器包和模型品牌冲突。
- 反过来，如果代码按模型 id 中的 `claude` / `gemini` / `deepseek` 自动替换或拒绝 npm 包，会误伤通过 OpenAI-compatible 网关合法代理这些模型的配置。

### 触发条件
- 把 `provider.<id>.npm` 理解成“模型厂商品牌”，而不是请求所使用的 API 协议适配器。
- 配置页只展示 JSON 范例，但没有说明内置 provider、原生 API 自定义 provider、兼容网关三种场景的差异。

### 根因
- OpenCode 的 `npm` 指定 provider 使用的 AI SDK 包。官方 provider 目录中 Anthropic、Google、OpenAI 分别使用 `@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai`；官方自定义 provider 文档说明 `@ai-sdk/openai-compatible` 用于任何 OpenAI-compatible API。
- 网关可以通过统一 OpenAI-compatible endpoint 承载多个品牌模型，因此模型 id 或展示名称不能可靠推断底层协议。

### 长期规避
- 优先使用 OpenCode 内置 provider 和 `/connect` 鉴权；这种场景通常无需手写 `provider.<id>.npm`。
- 只有手写自定义 provider 时才按真实 API 协议选择 SDK：原生 Anthropic / Google / OpenAI API 使用对应 `@ai-sdk/*` 包，兼容网关使用 `@ai-sdk/openai-compatible`。
- 校验只检查可证实的协议要求，例如 OpenAI-compatible 自定义 provider 必须有 `options.baseURL`；禁止根据模型名称自动换包或报错。
- 配置页范例使用中性网关模型名，并明确标记为 OpenAI-compatible 网关范例；provider 名称继续使用 `myAPI`。范例模型 id 和示例 `baseURL` 作为占位值参与 preflight，用户必须替换为真实值。

### 验证方式
- `validateOpenCodeConfigForRun` 应允许 `@ai-sdk/openai-compatible` 承载包含 Claude、Gemini、DeepSeek 名称的网关模型。
- `@ai-sdk/openai-compatible` 缺少 `options.baseURL` 时应返回明确阻断问题；`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai` 不应被强制要求兼容网关 baseURL。
- 配置页示例 JSON 可解析，标题和说明必须明确“OpenAI-compatible 网关”以及“按 API 协议选择 npm”。

### 关联资料
- OpenCode Providers：`https://opencode.ai/docs/providers/`
- models.dev provider directory：`https://models.dev/api.json`
- `src/config/configService.ts`
- `src/test/openCodeConfigService.test.ts`

## OpenCode `.env` 与 `config.json` 双配置会误导用户

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode 配置中心、配置文档、示例配置

### 现象
- 用户会误以为 OpenCode 需要同时维护 `config.json` 和 `.env` 两个配置文件。
- 配置页如果出现多个 OpenCode 保存按钮，会让用户不清楚哪个文件才是当前运行配置来源。

### 触发条件
- 文档或 UI 把 OpenCode `.env` 描述为当前配置要求。
- OpenCode 示例把 provider 名称写成具体历史供应商名，导致用户把示例名当作固定平台。

### 根因
- OpenCode 当前配置收口为单 `~/.opencode/config.json`，`.env` 不应再作为当前配置中心的保存对象。
- 历史调试中的 provider 示例名混入入口文档，容易被用户理解为推荐默认名称。

### 长期规避
- OpenCode 配置中心和文档只暴露一个 `config.json` 保存入口，不再要求或生成 `~/.opencode/.env`。
- OpenCode 配置范例中的 provider 名称统一使用 `myAPI`，不使用历史供应商名作为当前示例名称。
- 只有历史踩坑、兼容迁移或外部 endpoint 调试说明可以提到旧 `.env` / 具体供应商名，并且必须明确不是当前配置要求。

### 验证方式
- 在入口文档和 `.ch` 事实来源中运行 `rg -n "PackyAPI|OpenCode.*\\.env|\\.opencode/\\.env"`，当前配置口径不得命中；若命中只能是历史踩坑说明。
- 在配置中心验收 OpenCode 页面只有 `config.json` 保存入口，保存后不创建或更新 `~/.opencode/.env`。

### 关联资料
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `docs/cli-reference.md`

## OpenCode OpenAI-compatible 自定义 provider 裸 baseURL 会空响应

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode 1.17.15、`@ai-sdk/openai-compatible` 自定义 provider、PackyAPI/OpenAI-compatible endpoint

### 现象
- VS Code 插件发起 `opencode run --format json <prompt>` 后，OpenCode 进程 `code=0` 成功退出，但 stdout 只有 `step_start` / `step_finish`，tokens input/output/reasoning 全为 0，没有 assistant 文本。
- 用户侧看到 `OpenCode exited successfully, but did not return an assistant answer...`，且可能重复显示同一句空响应错误。

### 触发条件
- `opencode.json` 使用示例占位配置，例如 `model=myprovider/my-model-name`、provider `myprovider`、models alias `my-model-name`。
- PackyAPI 这类 OpenAI-compatible provider 的 `options.baseURL` 配成裸域名 `https://www.packyapi.com`，而不是实际兼容接口 `https://www.packyapi.com/v1`。

### 根因
- OpenCode 官方 schema 中 `model` 是 `provider/model`，`provider.<id>.models.<id>.name` 是展示元数据，不能把 `my-model-name` alias 自动改写成真实供应商模型名。
- `@ai-sdk/openai-compatible` 需要指向实际 OpenAI-compatible endpoint；PackyAPI 裸域名会导致 OpenCode 1.17.15 空事件成功退出，`/v1` endpoint 则返回明确 provider/API 错误或正常 assistant。

### 长期规避
- 产品配置示例保持中性 `myAPI` 网关，不绑定具体供应商；真实排障或 smoke 必须替换为实际 provider/model、兼容 endpoint 和鉴权信息。
- 运行前 preflight 必须阻止 `myprovider`、`my-model-name`、`my-small-model-name`、示例 baseURL、缺失 `{env:NAME}`；JSON error 事件必须展示 provider/API message，不能只显示泛化空响应。
- OpenCode `code!=0` 且 stderr 为空时，仍要解析 stdout JSON `error` 事件；PackyAPI 403 这类错误气泡应包含 `APIError`、`403`、`access_denied` 或 provider message，不能只显示 `CLI 退出码: 1`。
- OpenCode one-shot 启动后若长时间没有 stdout/stderr 输出，必须按空输出超时进入 hidden retry；重试耗尽时要追加可见 system 错误气泡并写入会话存档，不能只停在运行态或只留下 trace。

### 验证方式
- 对占位配置运行 `validateOpenCodeConfigForRun`，应返回 placeholder / missing env 等阻断问题。
- 对修正后的 PackyAPI `/v1` 配置运行 `OPENCODE_CONFIG=... opencode run --format json 'Reply with exactly: OK_OPENCODE_CONFIG_TEST'`，应返回 assistant 文本，或返回明确 provider/API 错误；不得再出现 `code=0` 且 tokens=0 的空 assistant。
- 对 PackyAPI 返回非零退出的场景，stdout JSON `error` 中的 provider/API 详情应进入 AI 对话错误气泡；无 JSON error 时才允许回退通用退出码。
- 对 OpenCode 启动后无 stdout/stderr 的场景，最终错误气泡应包含 OpenCode 空输出/超时诊断；hidden retry 最终失败后仍应有可见 system 错误消息。

### 关联资料
- `src/config/configService.ts`
- `src/cli/commandRunner.ts`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`

## OpenCode `UnknownError` 要保留 server ref

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode `opencode run --format json`、自定义 OpenAI-compatible provider、hidden retry 错误展示

### 现象
- OpenCode stdout JSON 返回 `{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_xxx"}}}`。
- 用户侧如果只看到通用退出码或只看到 `Unexpected server error`，无法把插件日志、OpenCode server 日志和 provider 侧请求串起来。

### 触发条件
- Provider/server 返回 OpenCode JSON error，但 stderr 为空、退出码为 1。
- hidden retry 已经记录 provider error 后，用户在下一次重试等待期间点击停止。

### 根因
- OpenCode 把部分 provider/server 失败写入 stdout JSON `error.data.ref`，这个 ref 是继续查 server 日志的关键线索。
- 停止动作是本地运行控制事件，不能反向覆盖或伪造成 provider 错误。

### 长期规避
- 非零退出时优先解析 stdout JSON `error`，错误气泡必须保留 `error.name`、`data.message`、`data.ref`，并继续保留可用的 `statusCode`、`metadata.url`、`responseBody`。
- 用户在 hidden retry 等待期间点击停止时，只记录为本地 stopRun，不要把停止动作误判成 provider `UnknownError`；已经落入 stdout 的 provider error 仍留在 OpenCode 日志用于诊断。
- 当前配置排查时只摘要 provider、model、baseURL host，不输出 `apiKey`。

### 验证方式
- `parseOpenCodeRunOutput` 覆盖 `UnknownError` / `Unexpected server error` / `ref`，`buildOpenCodeRunFailureMessage` 不应回退到 `CLI exit code`。
- AI 对话层最终 system message 应包含 `UnknownError`、provider message 和 `err_xxx`；空 stdout/stderr 仍应有可见 fallback 错误；`stopRun` 不应创建 provider 错误。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `src/test/opencodeCommandRunner.test.ts`
- `src/test/sessionMessageActions.test.ts`

## OpenCode 自定义 provider 不能传裸 `--model`

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode `opencode run --format json`、自定义 OpenAI-compatible provider、UI 托管模型选择

### 现象
- `~/.opencode/config.json` 顶层 `model` 为 `myAPI/gpt-5.5` 时，终端直接运行默认 `opencode run --format json` 能成功，显式 `--model myAPI/gpt-5.5` 也能成功。
- 插件如果传 `opencode run --format json --model gpt-5.5 ...`，OpenCode 会绕开 provider-qualified 默认配置，返回 `UnknownError / Unexpected server error / err_xxx`。

### 触发条件
- OpenCode 配置使用自定义 provider，且 provider id 不是官方内置模型前缀。
- UI 或 managed model store 保存的是 provider 内部裸模型 key，例如 `gpt-5.5`。

### 根因
- OpenCode CLI 层使用 `provider/model` 选择 provider；本地 OpenAI-compatible endpoint 自身可能接受裸模型 `gpt-5.5`，但这不等于 OpenCode CLI 的 `--model gpt-5.5` 可定位到自定义 provider。
- Codex 能跑通是因为 Codex 走自己的 CLI/配置和模型选择逻辑，不复用 OpenCode 的 provider-qualified model 规则。

### 长期规避
- OpenCode 运行前应基于已生效 `config.json` 顶层 `model=provider/model` 和 `provider.<id>.models` 规范化 UI 选择：裸模型存在于 active provider 时传 `provider/model`。
- 裸模型不在 active provider 的 `models` 中时，应显示配置/模型不匹配诊断，不能把裸模型继续传给 `opencode run --model`。
- 不要把 `provider/model` 直接拿去调用底层 OpenAI-compatible endpoint；该写法只属于 OpenCode CLI provider 选择层。

### 验证方式
- `buildCliArgs("opencode", { model: "gpt-5.5", openCodeConfigContent }, "hello")` 应生成 `--model myAPI/gpt-5.5`。
- provider-qualified `myAPI/gpt-5.5` 应保持不变。
- 不在 active provider models 中的裸 `glm-5.2` 应产生可诊断错误，不应被错误映射或传入 OpenCode。

### 关联资料
- `src/cli/modelArgs.ts`
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## 建议模板

```md
## <坑点标题>

- 状态：有效 / 需部署时检查 / 已规避 / 需观察
- 首次发现：YYYY-MM-DD
- 适用范围：模块 / 环境 / 脚本 / 版本

### 现象
- 看到什么报错、错误行为或异常结果？

### 触发条件
- 在什么前提下会出现？

### 根因
- 已确认的根因是什么？如果只是推断，要明确写“推断”。

### 长期规避
- 以后应该怎么做，才能避免再次踩坑？

### 验证方式
- 修改后如何确认这个坑已被规避？

### 关联资料
- 相关代码路径、runbook、issue、设计文档、外部链接
```

## 历史归档入口

- [PITFALLS_HISTORY.md](./PITFALLS_HISTORY.md)：已修复、已废弃、仅历史版本有效条目，保留完整追溯信息。
