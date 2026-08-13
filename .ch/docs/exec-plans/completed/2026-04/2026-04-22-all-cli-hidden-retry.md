# 全 CLI 非主动中断隐式重试

- 日期：2026-04-22
- 状态：validated
- 负责人：Codex

## 背景

上一轮已为 Codex 交互式任务增加“非主动中断时隐式发送继续”的自动重试。用户进一步要求该行为扩展到所有 CLI，而不仅仅是 Codex。

当前仓库实际运行模式包括：
- Codex / Claude：交互式 runner
- Gemini：一次性/并行流式执行

因此需要把“非主动中断自动隐式重试 5 次、每次间隔 30 秒、不展示重试消息”的行为扩展到全部 CLI 与对应执行模式。

## 目标

1. Codex / Claude / Gemini 都支持非主动中断自动隐式重试。
2. 自动重试 5 次，每次间隔 30 秒。
3. 重试使用隐式“继续/continue”提示词，但不在对话中展示用户消息。
4. 用户主动 stop 不触发自动重试。

## 范围

- `src/extension.ts` 的交互式、并行、一次性执行编排。
- `src/i18n.ts` 文案。
- `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与执行计划同步。

## 非目标

- 不改外部 CLI。
- 不增加设置项。

## 验收标准

- [x] Codex / Claude / Gemini 均具备非主动中断自动隐式重试。
- [x] 自动重试 5 次，每次间隔 30 秒。
- [x] 重试消息不追加到对话气泡。
- [x] `npm run build` 通过。

## 风险与缓解

- 风险：Gemini 一次性执行没有明确 interrupted 事件，只能依据退出码/异常判断。
- 缓解：对 Gemini 采用“非 0 exit / onError 且非主动 stop”触发重试。
- 风险：Claude 的会话失效重连逻辑与隐式重试叠加。
- 缓解：保留既有 session reset retry，再在其外层补统一隐式重试。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：代码审查三条链路的 stop / retry / final error 收口

## 任务列表

- [x] 梳理 Codex / Claude / Gemini 失败收口点
- [x] 扩展全 CLI 隐式重试
- [x] 构建验证并同步文档

## 当前结论

- 已恢复 `src/extension.ts` 中缺失的 trace / compaction / interactive helper，重新建立可编译结构。
- Gemini 一次性/并行执行继续沿用统一隐式重试辅助函数。
- Codex / Claude 交互式执行已补齐统一隐式重试：仅在非主动中断且已有可续接会话时触发，最多 5 次、每次等待 30 秒，隐式发送“继续/continue”且不写入对话。
- Claude 既有 `sessionResetRetry` 会话失效重建逻辑保留，并放在统一隐式重试循环内。
- 为避免把“命令不存在”误判为任务中断，统一隐式重试资格已排除 `ENOENT`。
- 已完成最小验证：`npm run build` 通过。
