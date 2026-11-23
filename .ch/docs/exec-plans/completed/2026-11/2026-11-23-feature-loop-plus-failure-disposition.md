# Loop+ 验收失败由主任务明确处置

- 日期：2026-11-23
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 范围与验收

- 主任务确认失败时必须同时派修，或提供明确的无需修复理由；未作选择不消费验收事件。
- 修复沿用原成员 ID，排队即显示修复中，返工回报后仍须复验。
- 无需修复计为已完成，保留验收失败与结案理由，不满足成功依赖，也不改变最终需求覆盖门禁。
- 不修改用户的历史存档，不改变经典 Loop、验收撤销或全局阻塞规则。

## 验证

- `npm run build`：通过。
- `node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js`：164 项通过。
- `node --test dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusAcceptanceCompletionGate.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js`：307 项通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；Ontology 单测 9 项通过。
- `npm run validate:whitespace` 与 `git diff --check`：通过。

## 同步记录

- 已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/design-docs/loop-group-chat-state-boundaries.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 不更新热区记忆：本次稳定状态规则已进入产品规格、设计事实源和 Ontology；没有额外需跨会话追踪的开放项。

## 当前结论

- 验收失败现在必须关联修复或提供 `noRepairReason`，宿主拒绝未处置的失败及失败执行的直接通过/完成。
- 修复沿用原逻辑成员；排队、执行与待复验统一显示“修复中”，通过显示“验收成功”，再次失败回到“验收失败”。无需修复显示“验收成功”，但失败结论仍留在验收历史中，且不满足成功依赖和父任务完成门禁。
- 实现、群聊与部门投影、提示、回归及事实来源已同步；完整相关验证通过。
