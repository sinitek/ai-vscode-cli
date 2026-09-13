# Codex completed turn final fallback

- 日期：2026-09-12
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-12
- claim_ttl：本轮任务

## 背景

真实会话 `01a090d4-f86c-7cc0-b998-3b59913a5b13` 中，`glm-5.3_sub-coco` 已成功输出 assistant 正文并收到主 Codex `turn.completed status="completed"`，但 `agent_message.phase=null` 且正文没有 `[final_answer]`，导致交互运行时按缺少最终结论触发 hidden retry。

用户确认普通 Codex 任务最终结论允许两种判定方式：显式 final answer 协议文本或结构化 final phase；以及主 Codex turn 收到 `turn.completed status="completed"`。

## 目标

让 Codex 交互式普通任务在主 turn 成功完成时可以作为最终结论收口，同时保留显式 final answer、文本标记和现有保守文本 fallback。

## 范围

- `src/interactive/codexRunner.ts`：在确认主 turn 且状态为 `completed` 后发出专用可选回调。
- `src/extensionHost/promptInteractiveRuntime.ts`：消费该回调并纳入最终结论判定。
- `src/finalConclusion.ts`：统一判定入口支持已观测 completed turn。
- 相关单元测试与运行时事实文档同步。

## 非目标

- 不把子代理 turn 作为父任务最终结论。
- 不把 `failed`、`interrupted` 或主动停止作为最终结论。
- 不恢复用户可配置的最终答复策略。
- 不删除现有 Codex 保守文本 fallback。

## 验收标准

- [x] 主 Codex `turn.completed status="completed"` 可让严格最终结论判定通过。
- [x] 子代理 `turn.completed` 不触发父任务完成回调。
- [x] `failed`、`interrupted` 不作为最终结论。
- [x] 现有 final phase、文本标记和保守文本 fallback 仍通过。
- [x] 定向测试与 `npm run build` 通过。

## 影响面

- 代码目录：`src/interactive/`、`src/extensionHost/`、`src/finalConclusion.ts`
- 测试目录：`src/test/interactive/`、`src/test/extensionHost/`、`src/test/core/`
- 文档目录：`.ch/docs/references/`、`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`、`.ch/docs/ontology/`
- 配置与脚本：无

## 风险与缓解

- 风险：raw event 通道早于主/子代理过滤，直接在宿主判断可能误把子代理完成当作父任务完成。
- 缓解：只从 `codexRunner` 的主 turn 分支发出专用回调，宿主不解析通用 raw event。
- 风险：没有 assistant 文本的 completed turn 也会成功收口，界面可能只有 completion system 气泡。
- 缓解：该行为来自用户确认的兼容规则；失败、中断和子代理仍被排除。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：`node --test dist/test/core/finalConclusion.test.js dist/test/interactive/codexRunnerSubagent.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js`
- 扩展验证：按需要补跑 Codex runner lifecycle/runtime 相关测试。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/core/finalConclusion.test.ts`、`src/test/interactive/codexRunnerSubagent.test.ts`、`src/test/interactive/codexRunnerLifecycle.test.ts`、`src/test/extensionHost/promptInteractiveRuntime.test.ts`
- 单元自测结果：`npm run build` 通过；`node --test dist/test/core/finalConclusion.test.js dist/test/interactive/codexRunnerSubagent.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js` 通过，29/29；`node --test dist/test/interactive/codexRunnerLifecycle.test.js dist/test/interactive/codexRunnerRuntime.test.js` 通过，14/14；扩展相关回归 `node --test dist/test/webview/finalAnswerPolicy.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/cli/opencodeCommandRunner.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActions.test.js` 通过，116/116
- 失败处理记录：无失败
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：已同步 CLI runtime reference、设计文档、runbook 和 ontology；`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 ontology 单测通过

## 任务列表

- [x] 失败会话和现有判定链路排查
- [x] 用户确认 completed turn 兼容策略
- [x] 实现主 turn completed 回调和运行时判定
- [x] 补充回归测试
- [x] 同步事实文档
- [x] 执行验证并归档计划

## 决策记录

- 2026-09-12：`turn.completed status="completed"` 只在 `codexRunner` 确认为主 turn 后作为最终结论信号；子代理、失败、中断和主动停止不触发。
- 2026-09-12：保留现有显式 final answer、文本标记和 Codex 保守文本 fallback，不恢复用户可配置策略。

## 当前结论

已完成。`codexRunner` 只在主线程、当前主 turn 且 `status="completed"` 时触发 completed-turn 回调；`promptInteractiveRuntime` 将该信号作为 Codex 最终结论兜底，避免 `glm-5.3_sub-coco` 这类缺少 final phase/文本标记的成功回合进入 hidden retry。子代理 completed、failed、interrupted 和主动停止不触发该兜底；现有显式 final answer、文本标记和保守文本 fallback 保持可用。
