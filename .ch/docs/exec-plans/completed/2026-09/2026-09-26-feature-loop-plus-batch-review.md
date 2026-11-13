# Loop+ 同轮验收队列和用户消息 — 新功能开发

- 日期：2026-09-26
- 状态：completed
- 负责人：Codex
- owner：loop-plus-batch-review
- claimed_at：2026-09-26
- claim_ttl：本轮实现和相关单测结束
- 类型：feature


### 背景

Loop+ 原来每次只确认一个 `currentReview`。验收队列里其余完成要等下一轮，用户消息也不进入正在进行的验收。

### 目标

- 开始验收时，把当前项和当时已经在 `reviewQueue` 里的完成事件放进同一次主任务决策。
- 当时已经到达的用户消息也进入这一轮。
- 决策必须显式列出全部事件；只确认其中一条会被拒绝。
- 本轮开始后新到的完成和用户消息留到下一轮。

### 范围

- `src/loopPlusDecision.ts`
- `src/loopPlusScheduler.ts`
- `src/extensionHost/loopPlusOrchestration.ts`
- `src/extensionHost/loopPlusPromptBuilders.ts`

### 非目标

- 不改变经典 Loop、Vibe。
- 不把执行中才到达的事项塞进已经发给模型的那一轮。
- 不把 Loop+ 写成已经整体上线，因此不改 `FEATURE_INVENTORY.md`。

### 验收标准

- [x] 队列里已有多项时，下一次验收用 `reviewEventIds` 一次确认，缺项会重试。
- [x] 同一轮带上当时已到达的用户消息，成功后才确认前缀。
- [x] 单项验收仍使用 `reviewEventId`。
- [x] `confirmedEventIds` 与 `acceptedEventIds` 仍拒绝整份决策。

### 影响面

- 代码目录：`src/loopPlusDecision.ts`、`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/webview/viewContentI18n.ts`
- 配置与脚本：无

### 风险与缓解

- 风险：模型只回第一个事件，宿主误确认整队。缓解：决策 id 必须与冻结批次完全一致，否则不调用 `submitReviewBatch`。
- 风险：执行中新到的消息被提前确认。缓解：只确认本轮开始时的用户消息前缀和当时的验收批次。

### 任务列表

- [x] 决策协议接受显式 `reviewEventIds`
- [x] 宿主同轮冻结验收批次和用户消息

### 当前结论

已实现。Loop+ 开始验收时，会把当前项和当时已在队列中的完成事件一起交给主任务，并带上当时已经到达的用户消息。模型必须按顺序显式确认全部事件；只确认一部分不会改状态。本轮开始后新到的完成和消息留到下一轮。

## 分类依据与真实状态

feature：未上线Loop+新增同批次完整确认行为；test：原文明确开发批量覆盖且修正两处旧断言；docs：范围和任务列表明确设计/ontology同步。原108/9项通过及整体未上线保持。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
