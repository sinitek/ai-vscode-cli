# Codex 最终答复判定修复

- 日期：2026-06-14
- 状态：completed
- 负责人：Codex

## 背景

用户提供的两份 Codex run stream 日志都显示：本轮只有 `phase:"commentary"` 的 `agent_message`，最后收到 `turn.completed status=completed`，没有 `phase:"final_answer"`。插件却把任务按成功结束，并在前端显示最终回复样式。

## 目标

修复 Codex 交互任务的成功收口判定：Codex 普通任务必须看到结构化 `final_answer` 标记，不能把 commentary 进度消息当作最终结论。

## 范围

- `src/finalConclusion.ts` 的最终结论判定选项。
- `src/extension.ts` Codex 交互运行后的缺失最终结论检查。
- `src/test/finalConclusion.test.ts` 回归测试。
- 运行时事实来源和功能清单文档。

## 非目标

- 不调整 Codex CLI/app-server 协议。
- 不改变 Claude/Gemini 的普通最终文本判定。
- 不改动 UI 样式体系，只通过正确的运行状态避免错误最终样式。

## 验收标准

- [x] Codex 只有 commentary 消息且没有 `final_answer` 时触发缺失最终结论重试，不成功收口。
- [x] Codex 有 `codexFinalAnswer=true` 标记或已观察到 `final_answer` 时可成功收口。
- [x] Claude/Gemini 原有普通 assistant 最终文本判定不回退。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/finalConclusion.ts`、`src/extension.ts`、`src/test/`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`
- 配置与脚本：无

## 风险与缓解

- 风险：旧 Codex CLI 如果不发送 `phase:"final_answer"`，会触发自动继续。
- 缓解：当前 Codex app-server 事件已经区分 `commentary` 与 `final_answer`；缺失最终结论本来就是需要恢复的异常，且有隐藏重试上限。

## 验证计划

- 最小相关验证：运行 `src/test/finalConclusion.test.ts`。
- 扩展验证：运行 `npm run build`。

## 测试与清单同步

- 单元测试：补充 Codex commentary 不算最终结论、Codex final marker 算最终结论。
- 功能清单：更新 Codex 隐式重试描述，明确 commentary 不算最终结论。
- 相关文档同步：更新 CLI runtime reference。

## 任务列表

- [x] 分析两份 run stream 日志
- [x] 修复 Codex 最终结论判定
- [x] 增加回归测试
- [x] 同步事实来源文档
- [x] 运行验证

## 决策记录

- 2026-06-14：Codex 交互模式下以 app-server 的 `phase:"final_answer"`/`codexFinalAnswer` 作为成功收口信号；`phase:"commentary"` 只作为过程输出。

## 当前结论

已完成修复与验证。问题是插件代码判定过宽叠加 Codex 未返回 final_answer：CLI 流没有最终答复，插件却把普通 commentary assistant 消息当作最终结论。现在 Codex 交互任务必须看到 `phase:"final_answer"`/`codexFinalAnswer=true` 才能按最终结论收口；只有 commentary + `turn.completed` 会进入隐藏继续重试。验证：`npm run build` 通过；`node --test dist/test/*.test.js` 通过，55 个测试全部通过。
