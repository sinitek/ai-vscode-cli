# Loop+ 主任务中断子任务 — 新功能开发

- 日期：2026-09-29
- 状态：completed
- 负责人：Codex
- owner：loop-plus-subtask-control
- claimed_at：2026-09-29
- claim_ttl：本计划已完成，不再占用
- 类型：feature
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-29-loop-plus-subtask-control.md`

## 本类型目标

新增steer与controls对running/pending子任务close/reprompt，dry-run无副作用，restart序号不冲突；不新增按钮且不控制已入验收队列attempt。

## 范围与所有权

- 新增steer与controls对running/pending子任务close/reprompt，dry-run无副作用，restart序号不冲突；不新增按钮且不控制已入验收队列attempt。
- 本记录只承担 新功能开发；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 新增steer与controls对running/pending子任务close/reprompt，dry-run无副作用，restart序号不冲突；不新增按钮且不控制已入验收队列attempt。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-09-29-docs-loop-plus-subtask-control.md](2026-09-29-docs-loop-plus-subtask-control.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

Loop+ 主任务需要用和派发子任务相同的 JSON 决策中断子任务：直接关闭，或中止后用新提示词继续。不新增界面按钮。

### 目标

主任务可以通过 `steer`，或在 `dispatch` / `accept` 上附带 `controls`，对 running 或 pending 子任务执行 `close` 或 `reprompt`。

### 范围

- 决策解析、调度内核 `applyControls`、宿主 dry-run 后中止进程并开启新 attempt。
- 重启后 attempt 序号不与已有 `lpN` 冲突。
- 群聊把最新 `closed` attempt 显示为已停止。

### 非目标

- 不新增群聊或主任务按钮。
- 不改变经典 Loop 的批次停止语义。
- 不把已经进入验收队列的 attempt 用 `controls` 关闭。

### 验收标准

- [x] `close` 中止进程，不进入验收队列，不计验收次数。
- [x] `reprompt` 使用新 prompt，并沿用未覆盖的 title、writeFiles、conflictGroup。
- [x] 冲突的 dry-run 和正式应用都不改快照。
- [x] 验收批次开着时单独 `steer` 被拒绝。
- [x] 宿主重启后仍能给后一个子任务分配新 attempt id。

### 影响面

- 代码目录：`src/loopPlusDecision.ts`、`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/panelStateBuilder.ts`

### 风险与缓解

- 风险：中止回调再次 `finish()`，把已关闭子任务送进验收队列。
- 缓解：先标记 settled，再 `abort()`。

## 分类依据与真实状态

feature：新增主任务控制协议和宿主中止/重派能力；test：5aed9b82实际更新decision/scheduler/编排/提示及面板测试；docs：源文范围、影响面与同提交证实设计/产品/PITFALLS/ontology实际更新。只保留源文相关回归通过，不虚构数量或整体上线。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
