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

## 当前上下文用量

- Grok 分组与 Codex 共用输入区运行条的已用上下文标签，简写为 `k`，悬停显示精确 token 和可用窗口上限；开跑等待原生读数，结束后保留，其他 Tab 的快照不覆盖当前标签。
- Grok 1.0.62 默认不向普通 ACP 客户端发送 `usage_update`。必须在 initialize 中声明 `clientCapabilities._meta["x.ai/statusLine"] = true`，才能收到原生 `session_status`；读取 `context_window.context_tokens`，不是不断增长的 `session_input_tokens` 或本轮总消耗。标准 ACP `usage_update` 也可作为原生数据源。
- `context_tokens` 缺失代表未知，不能当作 0；合法的 0 表示空上下文。读取精度遵循 CLI 原生快照，不按字符数、百分比或模型名称估算。不支持状态快照的旧 CLI 只显示等待占位。
- 最后一份快照可能在 prompt RPC result 之后抵达。只把回调放在当前 prompt handlers 中会丢掉最终读数；runner 保留轻量订阅，宿主验证 Tab / 会话 / runner 仍然归属原执行，防止切换、停止或新任务后迟到通知污染分组。
- 2026-10-18：本机真实 Grok 1.0.62 + 隔离配置 + 本地模拟 chat_completions API 验证，窗口 128000，当前读数 12652 → 12852 → 2007；会话累计输入继续增长，界面链路消费当前快照而非累计值。未使用真实密钥或付费 API，未修改用户配置。

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
