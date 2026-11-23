# Loop+ 主模型 JSON 格式失败自动续跑

- 日期：2026-11-22
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：无

## 背景与目标

真实任务在主模型没有返回决策 JSON 时耗尽两次纠错，留下冻结验收和在途工作，需用户显式继续。最后一次 Codex 会话记录是上下文摘要而非调度决策，且终态没有最终答复。让宿主在格式错误后继续自动重试，不把格式错误当业务失败。

## 范围与验收

- [x] 空白、普通文本或损坏、不完整的 JSON 继续退避重试，复用当前验收批次，不重复派发或确认。
- [x] 结构化决策不满足协议仍有独立的纠错上限；全局决策安全上限、显式停止、业务阻塞及完成门禁保持有效。
- [x] 同步功能清单、调度设计、停机诊断和 Ontology；不改写真实任务存档、不发布扩展。

## 影响与验证

影响 `src/loopPlusDecision.ts`、`src/loopPlusProtocolRepair.ts`、Loop+ 宿主编排和回归。风险是持续空答产生高频请求或重试等待期间误发旧工作，由封顶退避、全局安全上限和生命周期检查防护。先验证判型、真实场景回归和停止保护，再运行相关 Loop+ 单测、`npm run build` 及 Ontology 校验。

## 当前进展

本机任务快照在暂停时有 1 个当前验收事件、10 个排队验收事件、0 个在途任务。对应 Codex 会话结束内容为普通 Markdown `**Goal**` 总结，不是 Loop+ 决策 JSON；因此属于响应格式失败，不是验收或业务阻塞。未修改该用户运行时任务记录。

实现将无 JSON、普通文本和损坏/不完整 JSON 与可解析但校验失败的决策分开。前者在同一 consumer 中持续纠正，连续失败超过 2 次后按 1s 起步、30s 封顶退避；纠正提示不再复述非 JSON 摘要。循环仍受全局决策安全上限约束，显式停止可中断等待。结构化协议失败仍保持原先 2 次纠错上限。

验证：`npm run build` 通过；`node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusProtocolRepair.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusHandoffContracts.test.js dist/test/extensionHost/loopPlusAcceptanceCompletionGate.test.js` 通过，262 项；`npm run validate:whitespace` 通过；Ontology `--validate` 通过；`git diff --check` 通过。未运行整仓单测、真实模型任务或发布。
