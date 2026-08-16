# Codex Grok 最终气泡兼容修复

- 日期：2026-08-14
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-14T06:10:00Z
- claim_ttl：PT2H
- handoff_to：

## 背景

近期 Codex 使用 `grok-4.6` 模型时，最终正文已经作为普通 assistant 气泡落盘，但没有 `codexFinalAnswer` 标记，也没有 `[final_answer]` 文本标记，导致交互运行时误判“任务已退出，但没有产生最终结论气泡”并触发隐藏自动继续。

## 目标

让 Codex 交互式任务在成功结束且本回合最后一个有效气泡已经是普通 assistant 正文时，可以兼容识别为最终回复气泡，避免无意义自动重试。

## 范围

- Codex 交互式最终结论判定。
- 最终结论辅助函数的受控 fallback。
- 针对 `phase:null` / 无 `[final_answer]` 的回归测试。

## 非目标

- 不放宽 Claude、OpenCode 或普通并行/one-shot 的严格协议。
- 不修改 Codex CLI 或 app-server。
- 不改变气泡正文展示和 `[final_answer]` 过滤逻辑。

## 验收标准

- [x] `grok-4.6` 这类 Codex 普通 assistant 最终正文不会触发缺失最终结论自动重试。
- [x] 只有最后一个相关消息是普通 assistant 正文时才启用 fallback，避免把早期进度气泡当最终答复。
- [x] 既有结构化 `phase="final_answer"` 和 `[final_answer]` 路径保持不变。

## 影响面

- 代码目录：`src/finalConclusion.ts`、`src/extensionHost/promptInteractiveRuntime.ts`
- 测试目录：`src/test/finalConclusion.test.ts`、`src/test/promptInteractiveRuntime.test.ts`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/runbooks/PITFALLS.md`

## 风险与缓解

- 风险：过度放宽最终判定，把中途进度气泡当成最终答复。
- 缓解：fallback 只在 Codex 交互式成功结束后启用，且要求最后一个当前回合相关消息是非 thinking assistant 正文，并带明确完成/结论语义、没有“接下来/继续/下一步”等继续执行语义。

## 验证计划

- 最小相关验证：新增 final conclusion 和 Codex interactive runtime 回归测试。
- 单元自测命令：`npm run build`；`node --test dist/test/finalConclusion.test.js dist/test/promptInteractiveRuntime.test.js`
- 扩展验证：只读复核 `~/.sinitek_cli` 中目标 session 消息与日志。

## 测试与清单同步

- 单元测试新增/更新：`src/test/finalConclusion.test.ts`、`src/test/promptInteractiveRuntime.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/finalConclusion.test.js dist/test/promptInteractiveRuntime.test.js` 25/25 通过。
- 失败处理记录：无。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/runbooks/PITFALLS.md`。

## 任务列表

- [x] 查明 `grok-4.6` 样本消息和日志形态。
- [x] 实现 Codex 最后普通 assistant 气泡 fallback。
- [x] 补充回归测试并执行构建。
- [x] 同步事实来源文档并归档计划。

## 决策记录

- 2026-08-14：不恢复全局 `successful_reply_fallback`；仅为 Codex 交互式成功结束增加最后 assistant 气泡 fallback。

## 当前结论

已完成：Codex 交互式成功回合新增保守完成语义 fallback；普通进度气泡、最后消息非 assistant、`commentary-only` completed turn 仍不会收口。
