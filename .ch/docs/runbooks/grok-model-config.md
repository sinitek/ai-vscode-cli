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
