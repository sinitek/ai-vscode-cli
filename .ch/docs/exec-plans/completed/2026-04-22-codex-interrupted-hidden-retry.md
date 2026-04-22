# Codex interrupted 隐式继续重试

- 日期：2026-04-22
- 状态：completed
- 负责人：Codex

## 背景

用户反馈 Codex 交互式任务在 explorer / subtask 场景下经常出现非主动中断。日志中既有 `turn.completed = interrupted`，也可能直接以异常结束。用户要求插件在这类“非正常中断、非主动 stop”的场景下自动隐式重试：沿用当前任务上下文自动发送“继续”，但不在 AI 对话中展示这条消息；自动重试 5 次，每次间隔 30 秒。

## 目标

1. 在 Codex 交互式任务出现非主动中断时，自动触发隐式“继续”重试。
2. 隐式重试不向对话面板追加新的用户消息。
3. 自动重试 5 次，每次间隔 30 秒。
4. 多次重试后仍 `interrupted` 时，给出明确错误而不是静默结束。

## 范围

- `src/extension.ts` 中 Codex 交互任务编排与结束态处理。
- `src/i18n.ts` 中必要文案。
- `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与执行计划同步。

## 非目标

- 不改动外部 Codex CLI。
- 不为 Claude / Gemini 引入同样机制。
- 不修改用户主动 stop 的行为。

## 验收标准

- [x] Codex 非主动中断时自动隐式继续，不展示用户“继续”消息。
- [x] 自动重试 5 次，每次间隔 30 秒。
- [x] 达到上限后，`interrupted` 场景下 AI 对话里出现明确错误提示。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/i18n.ts`
- 文档目录：`.ch/docs/exec-plans/active/`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 配置与脚本：无

## 风险与缓解

- 风险：把用户主动 stop 误判为异常并自动重试。
- 缓解：仅在当前 run 仍 active 且非 `entry.stopped` 时触发隐式重试，并排除 `AbortError` / `RUNNER_DISPOSED`。
- 风险：重复展示“任务已完成”或重复追加用户消息。
- 缓解：在同一 run 内循环重试，不重新 append 用户消息，只在最终状态统一收尾。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：代码审查 Codex 分支的 interrupted / thrown error → 30 秒等待 → hidden retry → max retry 收口链路

## 测试与清单同步

- 单元测试：仓库暂无现成测试基建，本次以 TypeScript 构建与最小代码路径审查为主。
- 功能清单：需要更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，因为这是用户可见行为变化。
- 相关文档同步：本计划文件。

## 任务列表

- [x] 定位 Codex 非主动中断状态在插件里的结束处理点
- [x] 实现隐式“继续”自动重试、5 次重试上限与 30 秒间隔
- [x] 校正结束态提示，确保失败/中断不误报完成
- [x] 构建验证并同步功能清单/计划

## 决策记录

- 2026-04-22：隐式重试先只覆盖 Codex 交互式任务，不扩展到其它 CLI。

## 当前结论

- 已在 `src/extension.ts` 中为 Codex 交互式任务增加非主动中断自动重试：同一任务内若回合结束状态为 `interrupted`，或运行过程中抛出非用户主动中止的异常，会自动发送本地化的“继续/continue”提示词重试，且不在 AI 对话中追加用户消息。
- 自动重试 5 次，每次间隔 30 秒；`interrupted` 在达到上限后会转成明确错误消息，而其它异常则保留最后一次真实错误。
- 已同步 `src/i18n.ts` 与 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，并执行 `npm run build` 通过。
