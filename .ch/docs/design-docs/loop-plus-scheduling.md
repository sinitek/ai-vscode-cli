# Loop+ 子任务调度

## 调度边界

Loop+ scheduler 为纯状态内核，维护 `running`、`pending`、验收队列和可恢复快照；extension host 只启动 scheduler 返回的 `started` 项。生产并发上限为 6，单次决定的派发上限由独立设置约束。扩展宿主按每次实际启动间隔约 3 秒错峰，错峰队列不改变 scheduler 的准入状态。

## 准入与并行回填

- `running` 项（包括人工中断后等待续跑结果的开放 attempt）占并发槽，并通过 `writeFiles` 路径重叠与相同 `conflictGroup` 对新任务形成冲突约束。
- scheduler 依 pending FIFO 顺序检查候选项；同一次准入中已成功提升为 running 的项立即参加后续冲突检查。
- 由于冲突或并发上限仍未启动的 pending 项只保留队列顺序，不占并发槽，也不为后续候选预留写入范围。因此后续任务可越过被当前运行任务阻塞的 pending 项，填补可用并发槽。
- 后续候选仍必须与当前 running 及本次已提升的任务互不冲突。活动冲突释放后，再按 FIFO 选择最早的可运行项；更早 pending 项仍冲突时可以继续回填其它安全任务。
- 达到 `maxConcurrency` 时，仍未启动的任务留在 pending；结束任务会在同一 scheduler 转换中释放槽位并提升可运行项。

示例：A 写入 `x.ts` 正在运行，B 写入 `x.ts` 和 `y.ts` 因与 A 冲突而等待，C 仅写 `y.ts`。C 与 A 不冲突，应立即运行；B 在 A、C 中任一仍占用冲突范围时继续等待。

## 阻塞观测

`dispatch` 决策把 pending 原因归为运行中 `writeFiles` / `conflictGroup` 冲突或 `max_concurrency`。宿主 `loop-plus-dispatched` 日志为每个 pending attempt 记录 `subtaskId`、`attemptId` 和 `blockedBy`，冲突项附带冲突值及对应活动 attempt；异常未分类项使用 `scheduler`。pending 项之间不再报告互相阻塞。

## 事实来源与验证

- 实现：`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`
- 回归：`src/test/loop/loopPlusScheduler.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`
- 验证：`npm run build`；`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`
