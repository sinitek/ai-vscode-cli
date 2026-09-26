# Loop+ 同轮验收队列和用户消息

- 日期：2026-09-26
- 状态：completed
- 负责人：Codex
- owner：loop-plus-batch-review
- claimed_at：2026-09-26
- claim_ttl：本轮实现和相关单测结束

## 背景

Loop+ 原来每次只确认一个 `currentReview`。验收队列里其余完成要等下一轮，用户消息也不进入正在进行的验收。

## 目标

- 开始验收时，把当前项和当时已经在 `reviewQueue` 里的完成事件放进同一次主任务决策。
- 当时已经到达的用户消息也进入这一轮。
- 决策必须显式列出全部事件；只确认其中一条会被拒绝。
- 本轮开始后新到的完成和用户消息留到下一轮。

## 范围

- `src/loopPlusDecision.ts`
- `src/loopPlusScheduler.ts`
- `src/extensionHost/loopPlusOrchestration.ts`
- `src/extensionHost/loopPlusPromptBuilders.ts`
- 中英文帮助、设计文档和 ontology 规则

## 非目标

- 不改变经典 Loop、Graph、Vibe。
- 不把执行中才到达的事项塞进已经发给模型的那一轮。
- 不把 Loop+ 写成已经整体上线，因此不改 `FEATURE_INVENTORY.md`。

## 验收标准

- [x] 队列里已有多项时，下一次验收用 `reviewEventIds` 一次确认，缺项会重试。
- [x] 同一轮带上当时已到达的用户消息，成功后才确认前缀。
- [x] 单项验收仍使用 `reviewEventId`。
- [x] `confirmedEventIds` 与 `acceptedEventIds` 仍拒绝整份决策。

## 影响面

- 代码目录：`src/loopPlusDecision.ts`、`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/webview/viewContentI18n.ts`
- 文档目录：本计划、`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`
- 配置与脚本：无

## 风险与缓解

- 风险：模型只回第一个事件，宿主误确认整队。缓解：决策 id 必须与冻结批次完全一致，否则不调用 `submitReviewBatch`。
- 风险：执行中新到的消息被提前确认。缓解：只确认本轮开始时的用户消息前缀和当时的验收批次。

## 验证计划

- 先 `npm run build`，再 `node --test` 跑决策、调度器、编排、提示词和帮助测试。
- ontology 校验与本体单测。

## 测试与清单同步

- 单元测试：批量确认、宿主同轮验收、提示词和帮助文案。
- 单元自测结果：`npm run build` 退出码 0。`node --test` 覆盖决策、调度器、编排、提示词、帮助、运行时集成和面板投影，108 项通过、0 失败。ontology 校验通过，本体单测 9 项通过。
- 失败处理记录：两处编排测试仍按逐条验收断言，已改为同轮 `reviewEventIds` 后通过。
- 功能清单：不更新。Loop+ 整体仍由 `.ch/docs/exec-plans/active/2026-09-24-loop-plus-mode.md` 保持未上线。

## 任务列表

- [x] 决策协议接受显式 `reviewEventIds`
- [x] 宿主同轮冻结验收批次和用户消息
- [x] 帮助与设计同步

## 当前结论

已实现。Loop+ 开始验收时，会把当前项和当时已在队列中的完成事件一起交给主任务，并带上当时已经到达的用户消息。模型必须按顺序显式确认全部事件；只确认一部分不会改状态。本轮开始后新到的完成和消息留到下一轮。
