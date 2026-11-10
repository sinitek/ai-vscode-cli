# OpenCode 上下文占用与容量适配

核对日期：2026-11-10。本机 CLI 固定为 `opencode 1.18.35`，未升级依赖或 CLI。

## 已验证的协议与口径

官方 tag `v1.18.35` 对应提交 `53d1eabb61e21162157817bf677da0a4ad3332e3`：

- `packages/opencode/src/cli/cmd/run.ts` 的 `emit` 输出根级 `type`、`timestamp`、`sessionID`；主会话的 `message.part.updated` 按 `part.sessionID` 过滤后，输出 `step_start` / `step_finish`，其中 part 类型分别为 `step-start` / `step-finish`。子会话 part 不进入这个主流。
- `packages/opencode/src/session/processor.ts` 将 `Session.getUsage` 的规范化结果写到 `step-finish.tokens`。
- `packages/opencode/src/session/session.ts#getUsage` 将缓存读取/写入从总输入中减去，生成非缓存 `input`；从输出中减去推理，分别生成 `output` 和 `reasoning`。因此规范化的五项是不同类别，不应再次扣除缓存，也不应遗漏推理。

官方来源：

- [run JSONL 输出](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/run.ts)
- [步骤 token 写入](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/session/processor.ts)
- [getUsage 规范化](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/session/session.ts)

适配器读取的结构如下，示例数值用于说明口径，不是一次真实模型请求的账单：

```json
{"type":"step_finish","timestamp":1794280000000,"sessionID":"ses_main","part":{"id":"prt_finish","messageID":"msg_main","sessionID":"ses_main","type":"step-finish","reason":"stop","cost":0,"tokens":{"input":60,"output":20,"reasoning":10,"cache":{"read":40,"write":5}}}}
```

该例的当前占用为 `60 + 20 + 10 + 40 + 5 = 135`。只取最新主会话步骤的测量，不累计所有步骤。该值是最近已完成步骤的已报告 token，不是每个流式字符的即时 tokenizer 估算；也不宣称预测下一次请求的工具、系统指令或 provider 历史裁剪开销。未知格式的顶层 `usage` 不被猜测解析，`tokens.total` 也不和分项重复相加。

缺项、负数、字符串、非有限值、非整数、不安全整数及加总溢出均忽略，不覆盖上一条有效用量。

## 模型窗口

隔离 HOME/XDG 配置与数据目录、仅启用本机 `probe` provider 后，真实执行 `opencode models probe --verbose` 成功（exit 0）。配置模型 `probe/probe` 的 `limit.context=16384`、`limit.output=512`，输出包含模型标题、`providerID`、`id`、`capabilities`、`variants` 与同样的 `limit` 对象。

容量只来自 OpenCode 解析后的精确 provider/model 元数据 `limit.context`。不按模型名称猜常用容量，不采用 `limit.output`，不回退到未解析的配置或另一模型。缺失、查询失败/超时、非法窗口均为 `null`。

新增 `resolveOpenCodeContextWindow` 复用 `resolveOpenCodeThinkingCapability` 的模型解析和 Promise 缓存。键包含命令、版本、配置身份与内容指纹、cwd、冻结环境指纹、provider/model；版本查询也复用。缓存总条目上限 64，60 秒过期；`clearOpenCodeThinkingCapabilityCache()` 同时清空窗口和版本查询缓存。元数据只在本轮出现合法主会话测量时查询，不为每个 chunk 启动 CLI；同一运行和重试共用一次窗口 Promise。

额外查询通过现有 `captureCliOutput` / 跨平台 spawn 路径执行，参数使用数组，无 shell 拼接；版本和模型查询各有现有默认 5 秒超时。环境使用本次冻结的 `configContent`、`envOverrides` 与 cwd，其中显式传入 `OPENCODE_CONFIG_CONTENT`，异步回调不重新读取活动配置。

## 已接通的宿主链路

`promptOneShotRuntime.ts` 的已有 64 KiB 有界 JSONL 缓冲，在同一次 JSON.parse 后通知 record consumer；可见事件返回类型、finalText/errorText、任务列表、工具和推理流保持原接口。stdout 的合法 `step_finish` 经 tracker、冻结模型元数据，最终调用宿主 `sendPanelMessage`：

```ts
{
  type: "contextTokenUsage",
  tabId,
  tokensInContextWindow: 135,
  modelContextWindow: 16384,
  contextWindowSource: "opencode-model-window"
}
```

窗口未知时发送 `modelContextWindow: null`，不附来源字段。Webview 已在中文 title 与 aria 中识别 `opencode-model-window`，缺测量不制造初始化占位；来源实现见 `src/webview/viewContentScript/taskListAndUi.ts`、`src/webview/viewContentStrings.ts`，回归见 `src/test/webview/clipagescriptruntimecoverage.test.ts`。

- 已续接会话绑定请求的 runtime session；新会话只由主 JSONL 的合法 `step_start` 绑定，根级和 part 的 session 必须一致。
- hidden retry 清空未完成 JSONL 与当前测量；fresh-session retry 不接受已退休的旧会话；每个尝试独立 tracker。
- 已 settle 尝试的 stdout/stderr 回调被拒绝；异会话、嵌套 session 不一致、显式模型身份不一致、stderr 中的伪用量均不发布。
- Loop 后台子任务不查询窗口、不更新主面板；取消/换 run 后的迟到查询不能发布。正常完成等待本轮已发起的窗口查询再收口，避免最后一个无换行步骤丢失。

官方 JSONL 没有在 `step_finish` 携带 provider/model；窗口绑定的是本次执行准备阶段确认的 effective model，而非从事件猜测模型。主会话/后台隔离也依赖已核对的 CLI 主流过滤契约，不扫描后台 monitor 的输出。

## 验证与边界

定向测试包括规范化缓存/推理分项、无窗口、非法数值、异会话、fresh-session 换绑、13 字符拆包和末行无换行、最新测量替换而非累加、元数据查询复用/失效/有界缓存、宿主真实 `contextTokenUsage` 发送、stderr 和迟到回调隔离、取消、跨 run 迟到元数据以及 hidden/fresh retry。

隔离模拟服务探针未使用用户配置、凭据或收费模型。`models --verbose` 已实测成功；两次 `run --pure --format json` 在 bootstrap `init` 后停顿，45 秒后被探针终止，没有收到模型 HTTP 请求，也没有真实 step JSONL。因此普通步骤格式与 token 口径的依据是上述固定 tag 官方实现及宿主回归测试，不声称完成真实本机模型回合端到端验证。

OpenCode 专项59项通过，真实 `models --verbose` 探针成功；上述两次真实 run 停顿仍是验证限制，不能包装为端到端成功。公共契约见 `.ch/docs/references/cli-runtime-reference.md`，功能清单与 ontology 已登记普通提示链路，前轮481项及修复后 Node24 标准构建、当前产物509项相关测试的分阶段记录见 `.ch/docs/exec-plans/completed/2026-11/2026-11-10-cli-compaction-context-adaptation.md`。

普通提示运行已接线。当前能力边界是：手动/自动压缩没有可信的新测量时等待下一主回合；摘要生成步骤账单不等于压缩后占用。即时刷新未实现，不能伪造0或把旧历史步骤作为压缩后的新测量。现有验证未取得可归属压缩后主会话的可靠测量，因此本次仓库计划收尾不宣称该刷新已实现，也不为收尾新增猜测接线。

后续增强条件：先取得可信的压缩后新测量并验证会话、步骤和运行归属，再由 central runner 负责人评估接线；以下是可复用接口，不代表目前已有可靠事件：

- `parseOpenCodeContextUsage(record)`：解析单条已规范化主步骤。
- `createOpenCodeContextUsageTracker({ sessionId, previousSessionId?, model }).accept(record)`：绑定与过滤一轮主会话事件。
- `resolveOpenCodeContextWindow({ command, configIdentity, configContent, model, cwd, envOverrides })`：返回 `Promise<number | null>`；应传入压缩开始时冻结的模型配置和环境。

仅在上述增强条件满足后，才考虑在 `runOpenCodeNativeContextCompactionWithDeps` 的现有 stdout 消费路径复用有界逐行解析；在 `executeOpenCodeContextCompaction` 成功且 session 归属确认后，只发布经验证属于压缩后主步骤的新测量。需要由 central runner 负责人扩展结果携带测量，并将 `ContextCompactionRunDeps.sendPanelMessage` 的窗口类型扩为 `number | null`、来源允许 `opencode-model-window`。摘要生成步骤使用的可能仍是压缩前完整请求，不能将其 token 账单当成压缩后的精确占用。若原生压缩没有压缩后新测量，等待下一次主回合，不发送假定为 0 的占用。
