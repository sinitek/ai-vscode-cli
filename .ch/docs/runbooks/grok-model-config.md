# Grok 多模型配置与接口兼容

## 可视化管理

1. 在“携宁 CLI 配置”选择 Grok 档案并打开“可视化”。
2. 左侧展示模型列表，点击任意模型，右侧编辑其参数。点击列表标题旁的“新增”，在弹窗中仅输入一个模型名称并确认（支持回车，中文输入法组词期间回车不提交）；`model` 和 TOML 的 `[model.<名称>]` 表键默认使用该名称；`name` 为可选字段，不提供可视化输入、新增时不生成，其他参数深拷贝当前项。已有模型的 `name` 原值在编辑保存时保留，仍可在 TOML 源码中修改。取消或按 Escape 不新增，重名或无效名称在弹窗内提示。未知字段、嵌套参数、连接、协议与凭据一并保留，不共享可变对象。没有当前项时使用有效默认或首项，无模型则从空模板开始。每行名称右侧的删除 SVG 仅针对该行，确认后删除；删除未选中项不改变当前选择，删除默认项或当前项仍沿用默认引用与选择回退规则。
3. 在右侧填写或修改 API 模型 ID、接口地址、接口协议和该模型自己的 API Key / 环境变量名。环境变量名不是密钥值；不要从 Codex auth.json 复制密钥。
4. 可选设置默认模型后保存。保存当前激活档案时，配置页先保存档案再应用到磁盘；应用成功后立即重新读取并向对话面板推送模型列表和显示名，无需手动刷新，下拉左侧不再提供刷新图标。保存未激活档案仅更新档案，不改当前运行配置；应用失败则不推送伪造的新模型列表。
5. 模型下拉显示每项配置的 `model` 字段，不使用 `name` 或配置表键作为显示名；`model` 缺失、空白或非字符串时回退配置表键。选择值与运行参数仍使用配置表键，因此多个配置可显示相同模型名而保留各自连接与凭据；普通及主从角色均不提供“默认”“管理”项。已失效的选择回退配置默认或首项，没有模型时先添加。

## 保存后的即时同步

- 配置页保存激活档案的顺序是 `save`（档案）→ `apply`（实际配置文件）；模型候选以实际文件为准，不应从未应用的草稿直接拼接。
- 原实现只在 `save` 后触发不等待的回调，`apply` 完成后没有通知，可能先读到旧文件、之后长期保留旧列表。现 `onConfigChanged` 支持 Promise，变更通知等待完成，且在 `applyConfig` 成功写盘后再次通知，重新生成对话面板状态。
- 回归应同时覆盖：保存未激活档案不改变当前模型、应用成功后的新 `model` 显示名、应答等待同步完成，以及非法配置应用失败不发布成功通知。外部手工编辑文件仍沿用已有状态更新入口与运行前校验，不新增轮询或手动刷新按钮。

## 语义回放与工具气泡

- 作用于新的 Grok 执行，不改写已有会话或原生 CLI 日志，也不改变权限、命令和其他 CLI。
- 以当前 prompt、sessionId、toolCallId 为身份聚合工具。回放通常只记开始和终态；运行中快照保留最新一份等待结束，不能把累计输出当作 delta 反复拼接。已知 Bash/GrepSearch 的终态元数据补丁不抹掉之前的输出。相同命令但不同 ID、并行调用和不同会话不合并；缺少可靠 ID 时保守保留。
- 主对话按同 ID 更新一个工具摘要，显示既有工具标题、必要命令/路径/搜索参数、状态与退出码。成功输出详情在回放查看；失败摘要保留约 2000 字符的首尾输出，避免遗漏末尾错误，完整结果仍受既有回放容量限制。取消/中断保持自身状态，不因信号或非零退出误改为失败。grep 工具退出码 1 的无匹配不是执行错误。
- Bash/GrepSearch 的已知字节字段只有在整数范围 0–255 且 UTF-8 可无损往返时才转文本；非法字节和未知工具数组保留。只删除等价别名；ReadFile 带行号文本须先去除已知 `数字→` 包装并与 raw_output 严格相等，才收敛为一份正文。补充信息、差异文本、截断标志和非文本内容不删除，重复的 ACP 纯文本块仅在正文已覆盖时移除。
- 原生 plan 和 todo 派生计划按实际变化去重，复用已有任务列表，不再弹 todo JSON；失败的 todo 工具仍展示错误。命令目录、标题、输入回声、背景列表、用量和逐响应内部通知不新增回放；后台/子代理关键生命周期、压缩、未知事件和 RPC 结果保留。
- 运行活动不等于回放条目。Grok 同会话通知经 runActivity 每秒最多刷新一次目标 Tab 的活动时间，避免过滤空进度后误报“慢/极慢”。异会话不通知，切换 Tab 不污染当前页；清空或开始新回放重置活动时间。
- 停止时先同步排空未完成工具和待合并文本，再脱离运行身份。宿主仅在此排空窗口接受取消摘要与记录；之后迟到输出、旧执行回调及用量仍拒绝。prompt RPC 结果绑定请求创建时的回放实例，旧结果不能写入复用 runner 的下一轮。正文和思考保持实时，回放继续采用 1 秒 / 32 KiB 合并，不删除空白和重复词。
- 工具标题复用现有中英文工具标识与本地化入口，新增状态仍为既有 status/exit_code 协议字段，不引入另一套文案、主题或工具卡片。
- 2026-10-18 验证：隔离 HOME/GROK_HOME/工作目录，真实 Grok 1.0.62 + 本地模拟 API 连续执行成功与非零退出两条命令；原生 11 条工具通知收敛为 4 条回放、2 个工具摘要，错误与最终正文保留。测试不使用真实密钥或付费模型。生产 Webview 的桌面、窄屏、失败、取消、活动及后台 Tab 由 9 个结构化 Chromium 场景验证，详见 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-grok-semantic-replay.md`。

## 任务列表来源与排查

- 实时事实来源是标准 ACP `session/update`：`params.update.sessionUpdate = "plan"`，`entries` 是当前完整列表，包含 `content`、`priority`、`status`。Grok 1.0.62 在普通 ACP 客户端中即可推送；当前没有确认可独立查询当前 todo 的 RPC，也无需新增 plan 能力声明。`x.ai/statusLine` 用于上下文用量，`list_tasks` / `get_task` 用于后台任务，两者都不是此列表。
- 模型需要实际使用 `todo_write` 才会建立任务。普通 Grok 多步任务提示现在要求使用原生工具、保持稳定 ID 并逐步更新，描述默认中文；单步任务可省略，Loop 主任务继续遵守机器协议和已有隐藏规则。提示引导不能保证每个模型每次都会调用工具。
- 工具身份优先读取 `_meta["x.ai/tool"].name`，兼容 `rawInput.variant = "TodoWrite"` 与 `rawOutput.type = "Todo"`；`kind:"think"` / `title:"Updating plan"` 只是通用展示字段。成功输出 `rawOutput.TodosUpdated.todos` 是完整合并快照，即使输入仅含 `{id,status}`，也应保留其余条目和正文。只有确认成功才转换计划；缺少完整成功输出时，按 `merge` 与 ID 合并当前回合内已知数据，无法确定的补丁不猜测。
- `todo_write` 默认 `merge:true`，`merge:false` 替换整个列表，空数组可清空。原生 plan 与工具结果派生计划按列表内容去重；失败、取消和中断不采用输入意图，重复终态不回退已应用列表。缓存按会话和当前 prompt 隔离，完成后释放。
- 展示复用现有 `taskListUpdate` 与任务浮层：运行中全完成仍显示，结束、停止或清空后隐藏，迟到更新拒绝；Tab 独立，Loop/Loop+ 主任务隐藏。没有新增控件或用户文案，沿用现有主题与本地化。
- 排查时先在目标会话 `$GROK_HOME/sessions/<encoded-cwd>/<session-id>/updates.jsonl` 查找上述原生 plan，再按 `toolCallId` 核对 todo 工具的开始、成功/失败和 `TodosUpdated`。同目录 `plan.json` 是 CLI 的持久化任务数据；插件实时展示消费事件，不轮询这些文件。只读历史抽样的 30 次 TodoWrite 均有完整成功输出与 plan，未证实正常 native plan 普遍漏解析；原有缺少 Grok 原生任务引导，以及工具识别、增量和终态处理缺口分别处理。
- 2026-10-18 验证：真实 Grok 1.0.62（1474f9cbdd91）+ 隔离 HOME/GROK_HOME/工作目录 + 本地 Chat Completions mock，在同一回合完成创建两项 → 默认 merge 的 ID-only 补丁 → 全完成 → 非法状态失败 → 清空。四次成功各一份完整 plan、各一次回调，完成序列 `[false,false] → [true,false] → [true,true] → []`；失败零计划更新且错误保留。未使用真实凭据或付费 API。此版本会在回合结束时自动完成 `in_progress` 项，验证阶段需在同一回合中观察中间状态。

## 当前上下文用量

- Grok 分组与 Codex 共用输入区运行条的已用上下文标签，简写为 `k`，悬停显示精确 token 和可用窗口上限；开跑等待原生读数，结束后保留，其他 Tab 的快照不覆盖当前标签。
- Grok 1.0.62 默认不向普通 ACP 客户端发送 `usage_update`。必须在 initialize 中声明 `clientCapabilities._meta["x.ai/statusLine"] = true`，才能收到原生 `session_status`；读取 `context_window.context_tokens`，不是不断增长的 `session_input_tokens` 或本轮总消耗。标准 ACP `usage_update` 也可作为原生数据源。
- Grok 1.0.62 的 ACP 状态快照在多步任务中主要随整轮开始/结束更新；隔离空会话的初始 `1343` 会简写成 `1.3k`，可能一直保留到工具任务结束。运行中的逐次模型调用改为消费同会话 `response_completed.usage`，按 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens` 得到最近一次模型响应后的窗口占用，直接替换旧值；缓存输入是 Grok 归一后的独立分项，推理已包含在输出中，遵循本机最终 `context_tokens` 的口径。整轮 `turn_completed` / `turn_usage` 是累计消耗，继续忽略。
- 原生 `session_status` / `usage_update` 到达时覆盖读数；仅在 prompt 活跃时接收逐响应更新，完成后仍只接收原生快照。相同 token 与窗口上限的重复通知合并；新 prompt 仍回放最新有效值。取消、错误、异会话、非法字段与安全整数溢出保持隔离。
- `context_tokens` 缺失代表未知，不能当作 0；合法的 0 表示空上下文。逐响应输入、输出必须完整，缓存字段缺省为 0，显式非法值会拒绝；无可用原生读数时显示等待占位。刷新粒度是每次模型响应完成和状态快照，长时间单次生成或工具执行期间保留最近读数，不按字符数、百分比或模型名称估算。
- 最后一份快照可能在 prompt RPC result 之后抵达。只把回调放在当前 prompt handlers 中会丢掉最终读数；runner 保留轻量订阅，宿主验证 Tab / 会话 / runner 仍然归属原执行，防止切换、停止或新任务后迟到通知污染分组。
- 2026-10-18：本机真实 Grok 1.0.62 + 隔离配置 + 本地模拟 chat_completions API 验证，窗口 128000，当前读数 12652 → 12852 → 2007；会话累计输入继续增长，界面链路消费当前快照而非累计值。未使用真实密钥或付费 API，未修改用户配置。
- 刷新回归：真实 Grok 1.0.62 + 隔离本地 chat_completions API，单轮两次模型调用和一次 `printf` 工具执行。修复前执行中仅有 `1343`，整轮结束才得 `16020`；修复后执行中为 `1343 → 12050 → 16020`，最终原生快照同为 `16020`。第二次响应含 `3000` 缓存输入与 `10` 推理 token，累计输入为 `28000`，验证未累计或重复计入缓存/推理。未使用真实凭据或付费模型。

## 上下文压缩与指令入口

- Grok 与 Codex 共用输入区“常用指令 → 压缩上下文”，点击后立即关闭弹窗、显示“压缩中”，禁止重复触发，允许中止；结束、失败或停止后恢复入口。菜单在 Grok 交互支持可用时展示，不提供另一个 `/compact` 专用界面。
- 工具设置“AI任务配置 → 执行后自动压缩上下文”默认开启；Grok 与 Codex 使用同一规则：已有会话、任务成功且执行超过 5 分钟才触发，最多 3 分钟。短任务、失败或中断不触发；Loop 主任务压缩可与独立子会话派发并行。
- 底层发送 ACP `session/prompt` 文本 `/compact`。必须收到当前会话原生 `auto_compact_completed` 并且 prompt 正常结束；普通模型文本、取消、失败和其他会话事件不能冒充成功。恢复失败不新建空会话、不改原映射；自动压缩不产生 assistant 回复或普通完成耗时气泡。
- 排查日志：`context-compact-grok-complete` 记录原会话与压缩前后 token；`context-compact-command-failed`、`context-compact-timeout-stop-requested` 和 `auto-context-compact-after-run-finished` 区分原生异常、超时与自动触发结果，不记录摘要正文。
- 指令入口是带 `role=button` 的 SVG，不保证具备 HTMLElement 的 `.click()`；直接调用会导致 Enter/空格报错而鼠标可用。共享键盘绑定在缺少 `.click()` 时派发鼠标事件，仍先检查 `aria-disabled`。浏览器验收必须覆盖键盘打开、运行时禁用与停止后恢复，DOM 夹具的 `.click()` 不能代替真实 SVG 验证。
- 2026-10-18：Grok 1.0.62 + `gpt-6.1-sol` 隔离验证五轮对话后冷恢复、压缩与续聊，31432 → 10825 token，原验证口令保留。短会话的原生完成事件可能 token 不变，这是 CLI 的压缩策略，不应强行删除历史或切换会话。

## Responses 流中的未知事件

- 状态：已规避，仍取决于当前 Grok CLI 和接口实现。
- 首次验证：2026-10-17，Grok Build 1.0.62，`gpt-6.1-sol`。
- 现象：模型已被 ACP `session/new` 正确选中，但 `session/prompt` 返回 `-32603 Internal error`。
- 根因：此版本 Grok 的 Responses SSE 解析器拒绝 `response.metadata`，错误数据包含 `serialization error: unknown variant response.metadata`。同一接口的非流式 Responses 请求可以成功，不代表 Grok 流式链路兼容。
- 正文后报错：2026-10-18 再次从真实会话 `updates.jsonl` 与 `events.jsonl` 确认，正文分片之后收到上述序列化错误、`turn_ended/outcome=error`，不是插件误判成功。旧 runner 丢弃 RPC `error.data`，导致只显示 `Internal error` 并反复重试。现从错误数据或 `_x.ai/session/update` 的失败 `retry_state` 识别不支持的 Responses 事件，显示协议修复指引、停止自动重试并淘汰故障 runner；其他错误沿用既有策略。
- 规避：当服务同时支持 Chat Completions 时，仅将受影响模型的 `api_backend` 设为 `chat_completions`；其他模型可继续使用原协议。不要全局切换、改密钥或在插件内代理改写服务流。
- 验证：在仓库外创建临时 `GROK_HOME`，复用用户已有连接但不输出凭据，保留另一个默认模型；用真实 `GrokInteractiveRunner` 显式选择 `gpt-6.1-sol`。ACP 返回 `currentModelId=gpt-6.1-sol`，短提示回复 `GROK_SOL_MODEL_OK`。测试结束先等待 CLI 退出再重试清理目录，避免会话落盘与删除竞争。
- 修正正式配置时同时检查配置中心档案的 `configContent` 与 `content`，只修改受影响模型的 `api_backend`，否则后续应用旧档案会恢复错误协议。先保存仓库外受限权限备份；不修改其他模型、连接或密钥。2026-10-18 修正后，以实际配置的隔离副本连续两轮短提示均取得 `end_turn`。插件不自动按 GPT 等名称推断协议；新增复制也按原样继承，请按实际服务兼容性检查。

配置片段仅用于展示结构，连接和凭据按本机真实配置填写，并保留文件中其他模型：

```toml
[model."gpt-6.1-sol"]
model = "gpt-6.1-sol"
base_url = "https://api.example.com/v1"
api_backend = "chat_completions"
env_key = "MY_MODEL_API_KEY"
```

事实来源：`src/cli/grokConfigModels.ts`、`src/extensionHost/modelSettings.ts`、`src/config/grokConfig.ts`、`.ch/docs/references/cli-runtime-reference.md` 的 Grok Build 节。
