# 交互模式剩余上下文百分比显示设计（Draft）

## 背景
- 已落地 Codex + Claude 的交互模式（常驻 Runner + 上下文压缩）。
- 需求：在“常用指令”入口图标左侧显示“剩余上下文百分比”。

## 目标
- 在交互模式开启时，展示当前会话的“剩余上下文百分比”。
- 支持 Codex / Claude；当数据不可得时提供降级表现。
- 不引入新的技术栈、不破坏现有 UI 结构。

## 非目标
- 不做精确到 token 的实时动态曲线。
- 不改变现有会话/Runner 结构或压缩策略。

## UI / 交互
- 位置：输入区 footer 中 `常用指令` 图标左侧（与按钮同行）。
- 形态：小文本或 badge，例如 `CTX 68%` 或 `上下文 68%`。
- Tooltip：悬浮显示详细信息（已用/总量/数据来源）。
- 可见性：仅交互模式开启时显示；关闭时隐藏。
- 不可用：显示 `CTX --`，tooltip 提示“当前 CLI 暂不提供上下文余量”。
- 颜色：使用主题语义变量（如 `var(--vscode-descriptionForeground)` / `var(--vscode-inputValidation-warningForeground)`），不写硬编码颜色。
- 低余量提示：可选，在 <10% 时使用“warning”语义样式（不改变布局）。

## 数据源与可行性评估

### Codex（codex-sdk）
- SDK 的 `run_streamed` 会在回合完成时给出 `turn.completed` 事件与 `usage` 信息（输入/输出/总计）。
- 目前 SDK 文档未明确提供“模型上下文窗口大小”，需要通过以下方式确认：
  - 方案 A（优先）：从 SDK 事件或模型元数据中读取 `contextWindow`（需验证字段是否存在）。
  - 方案 B（兜底）：维护“模型 → 上下文窗口”的静态映射表（需确认 Codex 实际模型名）。
- 若无法得到 `contextWindow`，则显示 `CTX --` 并保留 tooltip 说明。

### Claude（claude-agent-sdk）
- 若使用支持 Context Awareness 的 Claude 4.5 系列模型，API 会在工具调用后返回 `<system_warning>`，包含剩余上下文提示（需确认 SDK 是否透传）。
- 若无 Context Awareness，可基于响应的 `usage` 与已知模型上下文窗口大小估算：
  - `usedTokens = input_tokens + output_tokens`。
  - `contextWindow = model 上下文窗口（文档表）`。
- 注意：Anthropic 文档提示 `cache_read_input_tokens` 不是实际上下文大小，避免计入 `usedTokens`。

## 计算规则
- `usedTokens`：优先使用 SDK 事件中的 `total_tokens`，否则 `input_tokens + output_tokens`。
- `remainingPercent = max(0, 1 - usedTokens / contextWindow) * 100`。
- 显示取整或保留 1 位小数（保持与 UI 简洁一致）。

## 更新时机
- 每轮对话完成后更新（基于 `turn.completed` / `message.completed`）。
- 会话切换或新建会话时重置或拉取最新值。
- 触发“压缩上下文”后，新 thread/session 重置百分比。

## Webview 通信（建议）
- 新增消息：`updateContextBudget`
  - `cli` / `sessionId`
  - `usedTokens`
  - `contextWindow`
  - `remainingPercent`
  - `source`（codex / claude / estimate）
- Webview 内按 `cli + sessionId` 存储，切换会话/CLI 时同步刷新。

## 验收标准
- 交互模式开启时显示百分比；关闭时隐藏。
- Codex/Claude 至少一个能成功展示有效百分比。
- 无上下文窗口时显示 `CTX --` 且不影响输入与发送。
- 会话切换/压缩后显示能正确刷新。
