# Loop / Loop+ 子任务完成标签清理

- 日期：2026-11-11
- 状态：completed
- 类型：bugfix
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-subtask-tab-cleanup.md`

## 目标与范围

修复停止后重派旧Tab残留、closeTab升级和恢复后无句柄清理。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- 历史文档分工：文档/事实源交付及其历史校验。 原 docs companion `2026-11-11-docs-loop-subtask-tab-cleanup.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- 修复停止后重派旧Tab残留、closeTab升级和恢复后无句柄清理；原可观察契约、非目标和限制以以下分配的原文为准。
- 用户现场反馈支持bugfix；287相关、3753中7失败3跳过、HEAD同名7失败及TMPDIR=/tmp消除Unix socket EINVAL保留。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文；原 docs companion 已退役，其完整记录未恢复；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-subtask-tab-cleanup.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 背景与目标

用户反馈 Loop / Loop+ 子任务完成后经常残留标签，并提示可能与停止后重新启动有关。追踪自动完成、手动继续、父任务恢复和关闭锁，修复同一子任务重新派发后旧标签残留的问题。

### 范围与非目标

- 范围：子任务标签创建、重新派发与完成清理；相关回归测试开发见已移除 test 类型计划的历史审计摘要[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-subtask-tab-cleanup.md）。
- 非目标：修改调度策略、验收门槛、CLI 协议或用户会话保留策略；不发布扩展。

### 验收标准

- 普通完成和停止后继续完成均自动清理对应子任务标签。
- 停止或失败时保留可继续的标签；不关闭主任务、普通对话或仍在执行的标签。
- 清理标签不删除真实 CLI 会话或聊天记录，跨 CLI 行为一致。

### 影响面与风险

- 代码：`src/extension.ts`、`src/extensionHost/loopSubtaskTabs.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extensionHost/loopPlusOrchestration.ts`；既有生命周期模块不变，标签测试开发见已移除 test 类型计划的历史审计摘要[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-subtask-tab-cleanup.md）。
- 回滚：撤回本次聚焦改动，不改变持久化结构。

### 验证计划

- 扩展验证：检查本机日志中是否有可用生命周期事件；不向仓库写入私有日志或任务内容。
- 本机日志未提供自动关页或手动继续事件，不能仅靠日志确认具体用户任务。

### 任务列表

Tasklist:
- [completed] 复现停止后重新派发的标签残留
- [completed] 修复并验证完成清理与隔离边界

### 测试与清单同步

- 本机验证边界：检查本机最近日志，没有足以还原用户任务的自动关页或手动继续事件；未修改本机运行数据，未发起收费 CLI 任务，未启动图形 Extension Development Host 做点击验收。实际 VS Code 重载后的页面交互仍需人工确认。
- 并行工作边界：收尾时工作区另外出现群聊气泡保留逻辑、群聊页面及其测试的并行修改和对应 active plan，均未由本次任务修改、覆盖或回退；上述验证结果对应本次修复验证时的代码快照，不将其它会话后续改动纳入本次交付声明。

### 修复结论

- adapter 将关页要求与进程中止状态分离，允许停止后升级为 `closeTab: true`，并以缓存 Promise 保证关页幂等；停止结果结算前后都生效。
- 主模型控制恢复后的旧 attempt 时，即使没有运行句柄，仍通过宿主按父任务和子任务身份清理旧闲置 Tab。
- 经典 Loop、Loop+ 自动完成及手动继续完成共用清理入口，处理同一子任务当前及更早的闲置标签；运行中标签、更新的替代 attempt、其它任务和普通对话不受影响。
- 不修改调度、验收、持久化结构或 CLI 会话保留策略；未发布扩展。

### 当前结论

已完成修复、回归、基线对照与文档同步。不存在本次范围内未解决的自动化回归；未完成真实 VS Code 图形点击验收，不将测试夹具验证当作真实 GUI 验收。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。用户现场反馈支持bugfix；287相关、3753中7失败3跳过、HEAD同名7失败及TMPDIR=/tmp消除Unix socket EINVAL保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
