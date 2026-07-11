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

## 不能只依赖 CLI 结构化 `final_answer`，也不能默认猜测普通正文是最终答复

- 状态：已规避，需随 Codex app-server 事件协议复核
- 首次发现：2026-06-14；再次确认：2026-07-10
- 适用范围：Codex / Claude / OpenCode prompt、Codex app-server `agent_message` / `turn.completed`、最终结论气泡与 hidden retry

### 现象
- Codex 已在 AI 对话中输出非空 assistant 答复，并以 `turn.completed status:"completed"` 正常结束，但该回合所有 `agent_message` 都是 `phase:"commentary"`，没有 `phase:"final_answer"`。
- 如果插件只接受显式 `final_answer`，会显示“任务已退出，但没有产生最终结论气泡，自动继续”，对同一已结束回合重复发送“继续”。

### 触发条件与根因
- 真实日志中的会话 `019f4b72-86f8-72b3-80f0-860bf9b467c4` 在收到 `hi` 后输出 commentary assistant 文本，随后成功完成；自动继续后的第二回合再次出现相同事件序列。
- `phase` 描述消息阶段，`turn.completed status:"completed"` 描述结构化回合终态。不同 Codex 模型或版本可能成功结束一个没有显式 final phase 的回合，不能假设两者永远同时出现；Claude / OpenCode 也没有统一等价的 `final_answer` phase 可供插件依赖。
- 直接把“成功退出前最后一段普通正文”默认当最终答复会反向引入过程性 commentary 误判，无法成为所有 CLI 的严格语义。

### 长期规避
- 所有普通任务和 hidden retry 的实际模型 prompt 都追加统一约定：任务完成后的最终回复必须以 `[final_answer]` 开头，过程更新不得使用该标记；不要改写界面里的原始用户消息。
- Loop 主任务/子任务等已有纯 JSON 或专用结构化终态的机器协议必须显式关闭文本标记注入和严格文本判定，否则 `[final_answer]` 前缀会破坏 JSON 解析；这些路径继续按自己的完成气泡验收。
- 结构化 `final_answer` 仍是最高优先级终态信号；没有结构化类型时，只从当前用户消息之后的非 thinking assistant 文本识别 `[final_answer]`。按产品约定使用“包含”语义，不能从 thinking、trace、system 或 user 文本识别。
- `[final_answer]` 只能在 Webview assistant 气泡的展示文本中移除；不能提前改写 `message.content` 或会话存档，否则默认严格策略、历史恢复和 hidden retry 会丢失兜底终态信号。
- 全局默认 `strict_final_answer`，只接受结构化 final 或文本标记。可选 `successful_reply_fallback` 才额外接受成功退出后的普通 assistant 文本；Codex completed-turn 原位提升仅在该兼容策略生效。
- 空回复、failed、interrupted 和主动停止不得提升。禁止扫描当前用户锚点之前的历史消息，也禁止把所有 commentary 无条件当最终答复。

### 验证方式
- 对 Codex / Claude / OpenCode 的首轮和 hidden retry prompt 断言都含最终回复标记约定。
- 对 Loop 机器协议断言首轮和 hidden retry prompt 都不含 `[final_answer]`，且全局严格策略不会覆盖其专用终态规则。
- 严格模式断言结构化 final 和 `[final_answer]` assistant 文本通过；普通正文、thinking 中的标记和当前用户锚点之前的旧标记不通过。
- 兼容模式用 `commentary agent_message -> turn.completed completed` 断言 Codex 只提升一次且不复制正文；显式 final 不重复提升，空文本、failed、interrupted 和缺失状态都不提升。
- 工具设置缺失或非法策略值时应显示并使用“严格 final_answer（默认）”；切换兼容策略后下一次任务立即生效；旧 Codex 设置能迁移为新兼容值。

### 关联资料
- `src/toolSettings.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerRuntime.ts`
- `src/finalConclusion.ts`
- `src/test/finalAnswerPolicy.test.ts`
- `src/test/promptRuntime.test.ts`
- `src/test/codexRunnerRuntime.test.ts`

## Codex reasoning 摘要不能按普通 assistant 正文直接落盘

- 状态：已规避，需随 Codex app-server 事件协议复核
- 首次发现：2026-07-10
- 适用范围：Codex `item.completed` reasoning 事件、thinking 气泡、历史会话存档

### 现象
- 部分 Codex 模型的 reasoning `summary` / `text` 会输出 `**Planning ...**`，并在其后附加独占一行的空 HTML 注释 `<!-- -->`。
- 插件把 reasoning 作为 thinking assistant 消息持久化后，空注释残片会反复出现在对话和历史会话中。

### 触发条件与根因
- Codex app-server 原始事件为 `item.completed` 且 `item.type=reasoning`，与正常最终回答的 `agent_message` 不是同一事件类型。
- reasoning 提取器此前只做片段扁平化和去重，没有对该模型特有的空分隔标记做边界清洗。

### 长期规避
- 只在 Codex reasoning/thinking 边界清洗独占一行的空 HTML 注释，禁止对全部消息做全局 HTML 注释正则替换。
- 行内 `<!-- -->`、非空 `<!-- explanation -->`、普通 assistant/user 消息必须保持原样。
- 会话加载和保存使用同一清洗函数修复历史 Codex thinking 消息；清洗后为空的 thinking 消息直接移除。

### 验证方式
- 用真实日志形态 `**Planning ...**\n\n<!-- -->` 断言 reasoning trace 只保留标题。
- 断言普通 assistant 消息中的 `<!-- -->`、行内空注释和非空注释不变。
- 断言历史 Codex thinking 消息加载后被清洗，而 Claude thinking 消息不受影响。

### 关联资料
- `src/codexReasoningContent.ts`
- `src/interactive/codexAppServerProtocol.ts`
- `src/sessionStore.ts`
- `src/test/codexReasoningContent.test.ts`

## OpenCode 真实会话字段是 `sessionID`，不能把插件 `local_*` 当作 CLI session

- 状态：已规避，需随 OpenCode JSONL 协议复核
- 首次发现：2026-07-10
- 适用范围：OpenCode 1.17.16、one-shot / 并行执行、会话 tab 二次执行

### 现象
- 同一个 OpenCode 会话 tab 第一次执行成功，第二次稳定报 `Error: Session not found`。
- CLI 启动参数出现 `--session local_<timestamp>_<random>`，而不是 OpenCode 返回的 `ses_*`。

### 触发条件
- 会话提取器只识别 `session_id`，没有识别 OpenCode JSONL 的 `sessionID`。
- 首轮未捕获真实 ID后，插件为消息落盘创建 `local_*` 占位会话，下一轮又没有在 CLI 边界过滤该占位 ID。

### 根因
- OpenCode 1.17.16 的 `step_start`、`text`、`step_finish` 和 `error` JSONL 事件在顶层及 `part` 中使用 `sessionID`。
- `local_*` 是插件内部存储身份，不存在于 OpenCode session store；把它传入 `opencode run --session` 必然找不到会话。

### 长期规避
- OpenCode 输出优先按 JSONL 结构读取 `sessionID`，同时兼容 `sessionId` / `session_id`，不要只依赖单一正则字段名。
- OpenCode 运行边界必须拒绝插件 `local_*`，只把真实外部 ID传给 `--session`。
- 修复前已有 `local_*` tab 不使用 `--continue` 猜测全局最近会话；启动新底层会话并捕获 `ses_*` 后，先迁移本地消息和 tab 引用再接管真实 ID，避免多 tab 或并发串线。

### 验证方式
- 用真实 OpenCode JSONL 样例断言 `sessionID` 可提取为 `ses_*`。
- 断言 `resolveCliSessionIdForResume("opencode", "local_...")` 返回空，最终 argv 不含 `--session local_*`。
- 在同一 tab 连续运行两次，第二次日志应包含 `--session ses_*`，且不再出现 `Session not found`。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/sessionLifecycle.ts`
- `src/extension.ts`
- `src/test/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

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

## OpenCode 推理力度不能按 adapter 或模型名猜测

- 状态：已规避
- 首次发现：2026-07-10
- 适用范围：OpenCode 模型选择、PanelState、`opencode run` 参数、配置切换

### 现象
- 同为 `@ai-sdk/openai-compatible` 的模型可能有不同 variants，也可能完全没有可调档位；把 OpenCode 固定显示为 low/high 会展示无效选项。
- 把 `--thinking` 或 `thinkingArgs.opencode.*` 当成推理力度会与 OpenCode 官方语义不一致；配置/模型切换后复用旧选择还会把无效 `--variant` 传给新模型。

### 触发条件
- 仅根据 provider `npm`、provider 名或模型名推断能力。
- PanelState 只增量更新 options，没有在 CLI、配置或模型变化时发送完整 Default-only 快照。
- 持久化键未包含 active config id 和精确 `provider/model`，或运行时未重新校验选择是否属于当前 options。

### 根因
- OpenCode 的 variant 集合由精确模型 metadata、模型版本和用户显式配置共同决定，adapter 只是协议层输入，不能证明后端接受哪些推理参数。
- `--thinking` 控制 thinking blocks 展示；实际力度参数是 `--variant <name>`，且不传 variant 才表示跟随 OpenCode 默认。

### 长期规避
- 优先读取 `opencode models <provider> --verbose` 的精确模型 metadata；失败时仅回退当前激活配置显式 variants，再失败则 Default-only。
- 能力身份至少包含命令/version、active config id、配置内容 hash、provider 和 model；异步结果应用前校验请求序号和完整身份。
- 选择按配置和精确模型隔离；null 删除持久值，失效选择自动清理。运行时只传当前有效非空值，且用户显式 `--variant` 优先。
- 不恢复固定 `thinkingModeOpencode` 或 `thinkingArgs.opencode.*`；不得从 legacy ThinkingMode 迁移或映射成 variant。

### 验证方式
- 覆盖 CLI metadata 优先、配置 variants 回退、未知模型 Default-only、配置/模型隔离、失效清理和异步竞态。
- 覆盖 Default 不传 `--variant`、有效值追加、`--variant value` / `--variant=value` 显式参数优先，以及 Codex / Claude 原行为。
- 脱敏 smoke 只使用 `opencode models <provider> --verbose` 实际返回的 variant；返回空 variants 时验证命令不带 `--variant`，不得臆造档位。

### 关联资料
- `src/cli/openCodeModelCapabilities.ts`
- `src/modelSelectionStore.ts`
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode `--auto` 不能写成“禁用权限系统”

- 状态：有效
- 首次发现：2026-07-10
- 适用范围：OpenCode 1.17.16、`src/cli/commandRunner.ts`、普通消息与 Loop 任务执行

### 现象
- 加入 `opencode --auto` 或 `opencode run --auto` 后，默认 `external_directory: ask` 的跨目录读写可以自动执行，容易被误写成“完全跳过权限”或“禁用权限系统”。
- 当用户配置、agent 配置或 OpenCode 默认规则显式拒绝某项权限时，请求仍会被阻止；例如 `.env` 等文件的显式 `read: deny` 保护不会被 `--auto` 绕过。

### 触发条件
- 把 OpenCode `--auto` 直接类比为 Claude `--dangerously-skip-permissions` 或 Codex `--dangerously-bypass-approvals-and-sandbox`，但没有核对 OpenCode 的 `ask` / `allow` / `deny` 语义。
- 为了“全部目录可读写”而在 runtime overlay 中无条件写入全局 `permission: "allow"`，覆盖用户已有的显式拒绝规则。

### 根因
- OpenCode `--auto` 的官方语义是自动批准**未被显式拒绝**的权限请求；它处理的是 `ask`，不是把 `deny` 改成 `allow`。
- `external_directory` 默认通常为 `ask`，所以 `--auto` 足以覆盖默认跨目录请求；但用户级、agent 级和内置显式拒绝仍属于独立安全边界。

### 长期规避
- 文档、UI 和代码注释统一使用“自动批准未被显式拒绝的请求”，不得写成“关闭权限”“绕过所有权限”或“所有文件无条件可读写”。
- 插件只在共享参数构建器集中注入并去重 `--auto`；runtime overlay 保留用户 `permission`，不得静默覆盖显式 `deny`。
- 若未来产品确需覆盖某一权限，只允许基于明确需求做最小范围规则（例如单独处理 `external_directory`），并单独评审安全影响；禁止顺带移除 `.env` 等保护。

### 验证方式
- 默认配置下，以工作目录 A 运行 `opencode run --auto`，验证可以读取并写入外部目录 B。
- 显式设置 `external_directory: deny` 后重复测试，确认请求被阻止；对 `.env` 等显式拒绝文件确认仍不可读取。
- 回归检查普通消息、并行任务、Loop 主任务/子任务与无 prompt 终端启动都只包含一次 `--auto`。

### 关联资料
- `src/cli/commandRunner.ts`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`

## OpenCode MCP 卸载不能依赖 CLI，且全局配置不能写错路径

- 状态：已规避，需随 OpenCode 版本复核
- 首次发现：2026-07-10
- 适用范围：OpenCode 1.17.16 / 1.17.18、全局 MCP 安装卸载、MCP 健康检测

### 现象
- `opencode mcp add` 可以写入配置，但当前 CLI 没有 `mcp remove` 子命令；调用 `opencode mcp remove --scope user <id>` 必然失败。
- 旧回退逻辑误写 `~/.opencode/config.json`，且只删除 `mcpServers` / `mcp_servers`，无法删除官方全局配置中的顶层 `mcp[id]`。
- 插件模型档案 `~/.opencode/config.json` 与官方全局 MCP 文件 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 不是同一个配置来源。
- `opencode mcp list --pure` 即使列出的服务全部连接失败，也可能退出 `0`；只看退出码会把“不健康”误判成“健康”，只保留健康 id 又会把已安装条目误判成未安装。

### 触发条件
- 把 Claude/Codex 的 add/remove CLI 工作流直接套到 OpenCode。
- 把配置中心维护的 OpenCode 模型档案路径误当成官方 XDG 全局配置路径。
- 删除逻辑只兼容 Claude 的 `mcpServers` 命名。
- 健康检测把列表命令退出码、连接成功状态和安装状态合并成一个布尔值。

### 根因
- OpenCode 当前只提供 `mcp add/list/auth/logout/debug`，没有对称的 `mcp remove`。
- OpenCode 官方全局 MCP 使用 XDG 配置路径和顶层 `mcp`；插件自己的模型档案为了配置中心隔离保存在 `~/.opencode/config.json`。
- `mcp list` 同时承载“已配置条目清单”和“当前连接状态”；单个条目 `failed` 不会让列表命令整体失败。

### 长期规避
- OpenCode MCP 安装和卸载直接管理 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`，不执行 add/remove CLI。
- local MCP 固定写入 `type=local`、`command` 数组、`environment` 和 `enabled`；remote 固定写入 `type=remote`、`url`、`headers` 和 `enabled`。
- 安装只合并 `mcp[id]`；卸载只删除 `mcp[id]` 且目标不存在时幂等成功。其他顶层字段和已有 MCP 必须保留。
- JSON/JSONC 必须先完整解析；无效配置或非对象 `mcp` 不得覆盖。成功修改使用同目录临时文件原子替换。
- 安装状态按目标 id 是否出现在解析后的列表中判断；连接失败映射为 `installed: true`、`status: unhealthy`，未列出才映射为未安装。

### 验证方式
- 对默认路径、`XDG_CONFIG_HOME` 和 `~` 展开做路径单测。
- 在临时 XDG 配置中预置 JSONC、其他顶层字段和已有 MCP，分别安装 local/remote、覆盖同 id、卸载目标 id，确认结构与字段保留。
- 对无效 JSON 和非对象 `mcp` 断言操作失败且原文件内容不变。
- 对不可连接的 local/remote 服务运行真实 `opencode mcp list --pure`，确认条目显示 `failed` 时 parser 仍将其映射为已安装且不健康，并将未列出条目映射为未安装。

### 关联资料
- `src/config/mcpInstallArgs.ts`
- `src/config/openCodeMcpConfig.ts`
- `src/config/mcpHealth.ts`
- `src/config/mcpService.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## TypeScript 构建不会自动删除已移除源码对应的 dist 产物

- 状态：已规避
- 首次发现：2026-07-11
- 适用范围：`npm run build`、`node --test dist/test/*.test.js`、已删除或重命名的 `src/test/*.ts`

### 现象
- 仓库根目录出现多个未跟踪的 `.tmp-lobster-launch-*` 空目录。
- 当前源码已没有 `lobsterBoundaryRecord.test.ts`，但 `dist/test/lobsterBoundaryRecord.test.js` 仍存在并可被全量 `node --test dist/test/*.test.js` 执行。
- 旧测试使用 `fs.mkdtempSync(path.join(process.cwd(), ".tmp-lobster-launch-"))`，测试进程异常退出或被中止时会把空目录留在仓库根目录。

### 触发条件
- 测试源码被删除或重命名后，只运行 `tsc -p ./` 增量覆盖输出，不先清理 `dist`。
- 后续直接按 `dist/test/*.test.js` 跑全量测试，导致陈旧 JS 测试产物继续参与执行。
- 测试 helper 把临时目录建在 `process.cwd()` 下，而不是系统临时目录；进程未进入 `finally` 清理路径时就会污染仓库根目录。

### 根因
- `tsc` 不负责删除 `outDir` 里已经没有源文件对应的旧输出。
- 旧 `dist/test/lobsterBoundaryRecord.test.js` 保留了仓库根目录临时目录创建逻辑。

### 长期规避
- `npm run build` 必须先清理 `dist`，再执行 `tsc -p ./`。
- 新增测试临时目录默认使用 `os.tmpdir()`；如确需建在仓库内，目录前缀必须加入 `.gitignore`，并确保异常路径可清理。
- 发现无对应 `src/test` 的 `dist/test/*.test.js` 时，优先清理 `dist` 后重建，不要按旧产物继续解释失败。

### 验证方式
- 运行 `npm run build` 后确认 `dist/test/lobsterBoundaryRecord.test.js` 不再存在。
- 运行 `find . -maxdepth 1 -type d -name '.tmp-lobster-launch-*'`，确认仓库根目录没有残留临时目录。

### 关联资料
- `package.json`
- `.gitignore`
- `dist/test/lobsterBoundaryRecord.test.js`（已清理的历史生成物）

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
