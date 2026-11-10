# Claude 当前上下文用量

## 核对范围

2026-11-10 核对固定依赖 `@anthropic-ai/claude-agent-sdk@0.2.12` 的
`sdk.d.ts`、`sdk.mjs`、随包 `cli.js`，以及本机独立 Claude Code `2.1.311`。
未升级 SDK、未修改压缩实现、未查询模型窗口表。

使用固定 SDK 分别驱动本机 2.1.311 和随包 CLI，以隔离的 HOME、
`CLAUDE_CONFIG_DIR`、工作目录、空 settingSources/tools/MCP/hooks、临时假 API key
和本机 HTTP SSE 服务验证事件。服务只返回合成数据，不读用户凭据、不访问收费模型。
本机服务的 token 数值是测试数据；验证的是 CLI/SDK 封装和事件顺序，
不是对真实模型计数准确性、真实压缩效果或所有供应商窗口容量的验证。

## 数据来源与口径

1. 主会话 `stream_event.event.type === 'message_start'` 的
   `event.message.id/model/usage` 标识当前 API 请求及输入计数。
   两个实测 CLI 的 `parent_tool_use_id` 都是 `null`，外层带 `session_id`。
2. 实测 `assistant.message` 在每个内容块结束时发出，`stop_reason` 仍为 `null`，
   输出计数仍是 message_start 的初始值。不能把这些块当最终请求用量，
   也不能按块累计。适配器不发 message_start/内容块初始占位值。
3. `message_delta.usage` 才给出最终输出计数。它与 message_start 的输入字段合并，
   输出字段覆盖而不是相加；输入/缓存字段的正数更新覆盖原值，delta 零值按随包
   原生 `CkA` 合并规则保留 message_start 已确认的输入，而不把其清零。计数为：

   ```text
   input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens
   ```

   缓存读、写与非缓存输入各计一次；可缺省的两个缓存字段缺省为零，
   显式非法值不视为零。`cache_creation` 的时长分项不再加一次。
   本机 2.1.311 的嵌入式类型明确说明 thinkingTokens 已包含在 outputTokens 中，
   输出口径包含该请求的输出/推理，不再叠加 `thinking_tokens`、
   `output_tokens_details`、估算思考 token 或文本字符估算。
   本机 2.1.311 会额外发 `system/thinking_tokens.estimated_tokens`，它不是本链路来源。
4. 合成 SSE 使用输入 11、缓存读 37、缓存写 23、初始输出 1、最终输出 19；
   两个实测封装都先发思考/文本 assistant 块，后发最终 message_delta。
   回放真实日志得到当前请求 90 tokens，而非 72、按块累计或会话累计值。
5. `result.usage` 和 `result.modelUsage` 中的 input/output/cache 统计均不能当当前上下文。
   随包实现累加这些字段（`+=`）。适配器只从 result 中读取当前主请求
   `message.model` **精确同名** `modelUsage[model].contextWindow`。
   `ModelUsage.contextWindow` 已在固定 SDK 类型中声明，两个实测 result 都提供该字段。
   `maxOutputTokens` 不是窗口容量。
6. 每个主请求覆盖前一个请求的占用，不累加工具循环、整个回合或整个会话。
   非流式兼容仅接受带真实 id、最终 stop_reason 和有效 usage 的 assistant。

## 宿主契约

`ClaudeStreamHandlers.onTokenUsageUpdate` 是可选回调。runner 每回合创建一个
有界 tracker，仅保存最新主请求及最近已发快照；不查询模型、不保存无界事件列表。
内部回调还带 `sessionId` 供宿主核对，向 Webview 只发送原有消息：

```ts
{
  type: 'contextTokenUsage',
  tabId,
  tokensInContextWindow,
  modelContextWindow, // number | null
  contextWindowSource: 'claude-model-window' // 仅容量已核对时
}
```

容量通常到该回合 result 才出现，所以先发真实占用和 `null`，再补同一快照的容量。
没有精确模型匹配、缺少模型或缺少/非法容量时保留 `null`，不从 init 模型别名、
前一个请求、前一回合、其它模型或常见窗口表推断；不把容量误当剩余额度。

计数必须是非负安全整数，总和必须安全且大于零；容量必须是正安全整数。
零占位、字符串、负数、小数、NaN/Infinity、非法显式缓存字段均不发伪造统计。

tracker 验证会话、`parent_tool_use_id === null` 和当前请求 id。
2.1.311 额外带 `api_message_id` 时还精确匹配它；固定随包旧 CLI 没有该字段，
仅在本回合收到 message_start 后接受其顺序 message_delta。
子代理事件不会替换主请求，也不允许其 session_id 改写 runner 主会话绑定。
result 后 tracker 关闭；下一回合新建 tracker，不继承旧窗口或旧占用。

宿主回调闭包捕获本次 runner、UI 会话和 Tab 会话绑定，校验当前 run 未停止、
Tab 仍为 Claude、UI/原生会话映射一致；runStreamed 结束即关闭该回调。
会话不存在后的既有重建重试每次使用独立闭包，旧回合回调不能向新回合发消息。

## 限制与跨任务接口

- 这是最近主模型请求输入加输出的真实 token 快照，不是本地全部消息重新分词；
  压缩后尚无新请求时不利用 compact_boundary 的 pre_tokens 伪造压缩后占用。
- 旧 CLI 没有逐请求 `api_message_id`，无法对同一会话、缺少 id 的任意乱序流补造
  关联依据；依赖原生单流请求顺序，并通过回合生命周期和 message_start 门控隔离。
- 自定义网关把请求模型别名与响应 model 改成不同名字时，精确匹配可能没有容量。
  这是有意保守的未知状态，不降级查表。
- CLI 上报的窗口是 CLI 元数据，不保证自定义网关背后的真实服务器限制与之相同。
- Webview 已识别 `claude-model-window`，在中文 title 与 aria 中提供来源说明，缺测量不制造初始化占位；实现见 `src/webview/viewContentScript/taskListAndUi.ts`、`src/webview/viewContentStrings.ts`，回归见 `src/test/webview/clipagescriptruntimecoverage.test.ts`。
- 公共消息契约见 `.ch/docs/references/cli-runtime-reference.md`；功能清单及 ontology 已登记本链路，总体验收状态见 `.ch/docs/exec-plans/completed/2026-11/2026-11-10-cli-compaction-context-adaptation.md`。

## 验证证据边界（2026-11-10）

Claude 专项69项通过，两种已安装 CLI/SDK 的本机模拟协议回放通过；这是原生封装与模拟 SSE 的协议证据，不是真实付费模型计数验收。此前主审 Node24 标准构建及481项相关测试是历史阶段证据；Kimi 修复后主审已通过标准构建（有既有 npm 配置警告）及当前产物509项相关测试，见归档计划。该结果不扩大为付费模型计数、真实宿主点击或全仓测试通过，也不变更宿主父任务状态。

## 自动验证入口

- `src/test/interactive/claudeContextUsage.test.ts`：实测事件顺序、缓存口径、占位、
  非法值、缺容量、多模型、子代理、会话与请求隔离。
- `src/test/interactive/claudeRunner.test.ts`：可选回调接线、回合状态重置、忽略子代理会话。
- `src/test/extensionHost/claudeContextUsage.test.ts`：消息契约、Tab/UI/原生会话绑定、
  结束后回调、同会话新回合与跨 CLI 隔离。
- 标准构建由主任务串行执行；本任务使用独立临时 outDir 编译，避免清理共享 dist。
