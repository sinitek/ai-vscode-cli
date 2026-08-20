# Loop 子任务中断续跑状态隔离

- 日期：2026-08-20
- 状态：completed
- 负责人：Codex
- owner：/root
- claimed_at：2026-08-20
- claim_ttl：本次会话
- handoff_to：

## 背景

Loop 主任务在其子任务被用户中断、随后继续时，可能被同一中断信号错误标记为中断。预期是子任务的中断只影响该子任务；主任务保持 `running`，并仅在所有已派发子任务完成后继续下一轮主任务决策。

## 目标

修复主从任务运行状态的隔离与续跑收敛逻辑，并以回归测试锁定“中断子任务不终止主任务”和“全部子任务完成后才唤醒主任务”的行为。

## 范围

- 追踪 Loop 子任务中断、继续、完成事件到主任务编排器的状态传播。
- 调整最小必要的状态判断和恢复流程。
- 补充或更新对应 TypeScript 单元测试。
- 同步用户可见的 Loop 行为功能清单与执行计划。

## 非目标

- 不变更 Loop 的任务存储格式、CLI 协议或任务调度并发策略。
- 不改变用户主动停止整个 Loop 主任务的语义。

## 验收标准

- [x] 中断单个运行中的子任务时，父 Loop 任务不会被标为 `stopped`、`error` 或 `needs-review`。
- [x] 继续该子任务后，父任务仍保持运行且不提前发起主任务下一轮。
- [x] 只有没有活动或未完成子任务时，主任务才可以被唤醒继续决策。
- [x] 最小相关单元测试和 `npm run build` 通过。

## 影响面

- 代码目录：`src/extensionHost/`、`src/loop*.ts`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/exec-plans/`
- 配置与脚本：无

## 风险与缓解

- 风险：把用户停止整个 Loop 的控制信号误当作子任务局部中断，导致主任务无法停止。
- 缓解：保留以任务 ID 为边界的停止路径，并为子任务中断与主任务停止分别断言。

## 验证计划

- 最小相关验证：Loop 子任务生命周期和运行编排的定向单测。
- 单元自测命令：`node --test dist/test/loopSubtaskLifecycle.test.js`、相关 Loop 编排测试、`npm run build`。
- 扩展验证：构建后检查恢复和主任务唤醒路径的测试覆盖。

## 测试与清单同步

- 单元测试新增/更新：`src/test/loopSubtaskLifecycle.test.ts` 增加父任务唤醒条件与自动/手动收尾契约；`src/test/loopDebate.test.ts` 增加活动子任务父任务不判 orphaned 回归。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/loopSubtaskLifecycle.test.js dist/test/loopDebate.test.js dist/test/extensionHostExtractionContracts.test.js dist/test/sessionMessageActionsCoreCoverage.test.js` 通过，68 个测试；ontology validate 通过，ontology unittest 9 个通过；`git diff --check` 通过。
- 失败处理记录：隔离 worktree 初次构建因未安装依赖而失败；执行 `npm install --no-package-lock` 后重新构建通过，属于环境问题而非代码失败。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，新增“子任务中断不终止主任务”。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

- [x] 建立状态传播排查范围和执行计划。
- [x] 找到并验证根因。
- [x] 实现状态隔离与续跑收敛修复。
- [x] 补充回归测试并完成构建验证。

## 决策记录

- 2026-08-20：将子任务中断视为子任务局部生命周期事件；父任务是否继续由剩余活动/未完成子任务集合决定。

## 当前结论

已确认根因是子任务批次返回 `error` / `stopped` 后，父编排错误调用任务级中断函数，清空父任务的 `activeSubtaskIds` 并将父状态写为终态。修复后子任务局部中断只保留对应 active ID，父任务保持 `running`；手动续跑成功仅在活动集合清空后唤醒主任务，串行批次未派发任务标为 `skipped` 并留待下一轮重评估。用户级 Loop 群聊停止仍走任务级统一停止路径。代码、单测、事实文档和 ontology 已在隔离 worktree 验证完成，待同步回主工作区并归档计划。
