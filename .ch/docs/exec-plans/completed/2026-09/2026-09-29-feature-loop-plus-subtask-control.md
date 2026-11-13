# Loop+ 主任务中断子任务 — 新功能开发

- 日期：2026-09-29
- 状态：completed
- 负责人：Codex
- owner：loop-plus-subtask-control
- claimed_at：2026-09-29
- claim_ttl：本计划已完成，不再占用
- 类型：feature


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
