# Loop+ 主任务中断子任务

- 日期：2026-09-29
- 状态：completed
- 负责人：Codex
- owner：loop-plus-subtask-control
- claimed_at：2026-09-29
- claim_ttl：本计划已完成，不再占用

## 背景

Loop+ 主任务需要用和派发子任务相同的 JSON 决策中断子任务：直接关闭，或中止后用新提示词继续。不新增界面按钮。

## 目标

主任务可以通过 `steer`，或在 `dispatch` / `accept` 上附带 `controls`，对 running 或 pending 子任务执行 `close` 或 `reprompt`。

## 范围

- 决策解析、调度内核 `applyControls`、宿主 dry-run 后中止进程并开启新 attempt。
- 重启后 attempt 序号不与已有 `lpN` 冲突。
- 群聊把最新 `closed` attempt 显示为已停止。
- 设计文档、功能清单、能力和 ontology。

## 非目标

- 不新增群聊或主任务按钮。
- 不改变经典 Loop 的批次停止语义。
- 不把已经进入验收队列的 attempt 用 `controls` 关闭。

## 验收标准

- [x] `close` 中止进程，不进入验收队列，不计验收次数。
- [x] `reprompt` 使用新 prompt，并沿用未覆盖的 title、writeFiles、conflictGroup。
- [x] 冲突的 dry-run 和正式应用都不改快照。
- [x] 验收批次开着时单独 `steer` 被拒绝。
- [x] 宿主重启后仍能给后一个子任务分配新 attempt id。

## 影响面

- 代码目录：`src/loopPlusDecision.ts`、`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/panelStateBuilder.ts`
- 文档目录：`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`、`.ch/docs/runbooks/PITFALLS.md`

## 风险与缓解

- 风险：中止回调再次 `finish()`，把已关闭子任务送进验收队列。
- 缓解：先标记 settled，再 `abort()`。

## 验证

- `npm run build` 通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9 通过。
- `node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopPlusGroupChatPanel.test.js` 通过。
