# Final Conclusion Bubble Continue Guard

- 日期：2026-06-04
- 状态：completed
- 负责人：Codex

## 背景

AI 对话任务结束时应产生最终结论气泡。用户反馈：如果任务进程已经结束但最终结论气泡没有产生，需要识别为未真正结束，并自动输入“继续”让任务继续执行。

龙虾主任务还存在专门的最终总结气泡：主任务完成时扩展会移除最终 JSON 协议气泡，并追加 `lobsterFinalSummary=true` 的 assistant Markdown 最终总结气泡。该气泡缺失时，同样不能把任务视为真正完成。

## 目标

- 普通 Codex / Claude / Gemini 任务只有在本轮用户消息之后出现非 thinking assistant 最终结论气泡，才按成功结束收口。
- 如果 CLI 成功退出但没有最终结论气泡，扩展使用现有 hidden retry 机制自动隐式发送“继续/continue”。
- 手动点击停止/中断属于用户主动终止，不触发缺少最终结论气泡的自动继续。
- 龙虾任务只有在最终总结气泡已经写入并展示后才被视为完成；若任务记录显示完成但主任务对话缺少最终总结气泡，扩展自动续跑“继续”。

## 范围

- 普通任务成功退出后的最终结论气泡判定。
- hidden retry 继续提示的复用。
- 龙虾主任务完成判定。
- 最终总结气泡存在性检测。
- 自动续跑“继续”的兜底编排。
- 功能规格文档同步。

## 非目标

- 不改变子任务执行、重试次数和并发规划规则。
- 不改 Webview 样式。
- 不新增 hidden retry 次数或延迟配置。

## 验收标准

- [x] 普通任务成功退出但缺少非 thinking assistant 最终结论气泡时，不按成功完成收口，而是自动隐式“继续”。
- [x] 用户手动点击停止/中断后，不会因为缺少最终结论气泡而自动隐式“继续”。
- [x] 普通任务已有最终结论气泡时，仍按原成功路径结束。
- [x] 已完成龙虾任务若主任务消息中已有 `lobsterFinalSummary=true`，不会重复追加或重复续跑。
- [x] 已完成龙虾任务若缺少最终总结气泡，扩展不会直接结束，会自动以“继续”恢复同一任务。
- [x] 正常 `status=completed` 决策仍会移除最终 JSON 协议气泡并追加最终总结气泡。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/i18n.ts`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无

## 风险与缓解

- 风险：缺少气泡时无限续跑。
- 缓解：普通任务复用统一 hidden retry 上限；龙虾任务在成功写入 `lobsterFinalSummary=true` 后立即结束，异常则回到 needs-review/error 路径。
- 风险：Gemini 新 session 识别后继续检查旧 draft 消息数组。
- 缓解：并行 Gemini 路径在 session adoption 后刷新并使用当前 run 的实际 messageTarget。

## 验证计划

- 最小相关验证：`npm run build`。
- 扩展验证：静态检查 `runLobsterPrompt` 完成态、恢复态和最终总结消息写入链路。
- 回归验证：`node --test dist/test/hiddenRetry.test.js`。

## 测试与清单同步

- 单元测试：当前龙虾编排大量依赖 VS Code 扩展运行态和本地任务存储，先做构建与 hidden retry 纯函数回归验证；若后续抽出纯函数再补龙虾编排单测。
- 功能清单：已同步普通 hidden retry 与龙虾模式能力规格。
- 相关文档同步：已同步 CLI runtime reference。

## 任务列表

- [x] 定位最终总结气泡字段与完成分支。
- [x] 实现缺少最终结论/最终总结气泡时自动续跑“继续”。
- [x] 同步功能规格文档。
- [x] 运行构建验证并归档计划。

## 决策记录

- 2026-06-04：最终结论气泡以 `ChatMessage.lobsterFinalSummary=true` 作为权威判断，避免依赖文案或 UI class。
- 2026-06-04：普通任务最终结论气泡以“本轮用户消息之后存在非 thinking、非空 assistant 消息”作为判断；trace、system、thinking 气泡不算最终结论。
- 2026-06-04：Gemini 并行成功路径只把解析出的 assistant/plain text 内容当作最终 assistant 气泡，不再把原始 stream-json stdout 当作结论兜底。
- 2026-06-04：自动续跑复用现有 hidden retry 次数和延迟，不新增单独配置。
- 2026-06-04：手动停止会让运行态失效；Codex / Claude 交互式最终结论检查在 run inactive 时直接跳过，避免主动停止后自动继续。

## 验证结果

- 2026-06-04：`npm run build` 通过。
- 2026-06-04：`node --test dist/test/hiddenRetry.test.js` 通过，11/11。
- 2026-06-04：补充手动停止保护后，`npm run build` 再次通过；`node --test dist/test/hiddenRetry.test.js` 再次通过，11/11。

## 当前结论

已完成普通任务最终结论气泡兜底和龙虾 `lobsterFinalSummary=true` 最终总结兜底。非主动结束且缺少气泡时会继续运行；手动停止不会自动继续；存在气泡时不会重复续跑。
