# Loop+ 原子任务验收修复

- 日期：2026-11-22
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 目标与范围

验收失败后的修复继续执行原逻辑子任务，成员编号不变；群聊以橙色“修复中”展示当前执行并单独计数。每次执行仍独立验收。保留旧任务和验收消息，不迁移历史记录，不改变经典 Loop。

## 验收标准

- [x] 单一修复沿用原逻辑 ID 和相容会话；重复或冲突的修复提案不提前确认验收。
- [x] 原失败结果可追溯，新的尝试按现有规则排队、执行和验收。
- [x] 修复在运行时显示单一成员和橙色标签，排队及中断不计入修复中。

## 影响面

- 宿主规范化验收修复的逻辑 ID，保留独立 attempt 标识、原成员元数据和会话来源。
- Loop+ 状态投影、成员行与汇总标签；产研部成员状态汇总仅投影逻辑任务最新 attempt。
- 更新 Loop+ 提示、调度设计、功能清单和 Ontology。

## 验证结果

- `npm run build`：通过。
- `node --test dist/test/loop/loopPlusGroupChatPanel.test.js`：23/23 通过。
- `node --test --test-name-pattern='acceptance repair alias|same-ID acceptance repair|records each accept review|accept repairs the original member|independent accept delivery preserves|rejects confirmation beyond four' dist/test/extensionHost/loopPlusOrchestration.test.js`：8/8 通过。
- `node --test dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/loop/departmentGroupChatHost.test.js`：91/91 通过。
- Headless Chromium 在 320px 与 1280px 验证“修复中 1”、橙色主题样式和无横向溢出。
- `git diff --check` 与 Ontology `--validate`：通过。
- `loopPlusOrchestration.test.js` 全文件运行 162/168 通过。6 项失败覆盖运行中容量调整、残留预留续接和超长历史调度，不涉及本次验收修复；本次涉及的宿主修复回归 8/8 通过。
- Impeccable detector 仅报告已有 `loopGroupChatPanelStyles.ts:1026` 的引用块侧边框告警，本次没有新增该样式。

## 结论

完成。验收失败关联的新修复建议会映射回原逻辑 ID 派发为新 attempt；旧失败 attempt 与验收事件仍保留。群聊新增独立的橙色“修复中”状态及计数，并支持从原成员行进入执行会话。
