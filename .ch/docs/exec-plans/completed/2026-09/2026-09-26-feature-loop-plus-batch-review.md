# Loop+ 同轮验收队列和用户消息 — 新功能开发

- 日期：2026-09-26
- 状态：completed
- 负责人：Codex
- owner：loop-plus-batch-review
- claimed_at：2026-09-26
- claim_ttl：本轮实现和相关单测结束
- 类型：feature
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-26-loop-plus-batch-review.md`

## 本类型目标

新增同轮冻结验收队列和已到用户消息，reviewEventIds完整顺序确认；新到事项留下一轮，未整体上线Loop+。

## 范围与所有权

- 新增同轮冻结验收队列和已到用户消息，reviewEventIds完整顺序确认；新到事项留下一轮，未整体上线Loop+。
- 本记录只承担 新功能开发；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 新增同轮冻结验收队列和已到用户消息，reviewEventIds完整顺序确认；新到事项留下一轮，未整体上线Loop+。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-09-26-docs-loop-plus-batch-review.md](2026-09-26-docs-loop-plus-batch-review.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

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
