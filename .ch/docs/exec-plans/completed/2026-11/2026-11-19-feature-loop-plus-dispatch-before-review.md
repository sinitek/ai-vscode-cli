# Loop+ 独立任务优先派发

- 日期：2026-11-19
- 类型：feature
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-19-feature-loop-plus-next-step-plan.md`（复用主任务续跑计划）
- 状态：completed
- 负责人：Codex

## 目标与范围

主任务收到新验收批次时，先判断是否有可立即启动且不依赖待验收结论的新交付。可派发时拆成「独立派发、续跑验收」两次返回；无合适任务时直接验收，不增加一次空请求。不改变子任务免验收规则、批次大小、依赖门禁、存储版本或界面。

## 验收标准

- 有空槽和轮次且确有独立任务，先派发并保存 `nextStepPlan`，随后立即重新发起主决策验收同一冻结批次。
- 无可提前派发项时，可在首次请求直接验收；需依据验收结果的修复和后继只在验收阶段或之后安排。
- 新批次仅有一次先派发机会。非法或不能立即启动的提案不改动调度队列，协议重试直接进入既有验收流程。冻结前缀保持，晚到事件留后续批次。

## 影响面与风险

- 宿主决策入口、主模型提示、编排测试、调度设计、功能清单、能力规格和本体。
- 一次性机会不做持久化扩展；宿主重建时把当前冻结批次前缀视为已开放机会，后续未冻结批次仍可开放。独立派发使用既有调度内核预检，计划与派发一同落盘，失败不启动子任务。保持普通 `accept` 同轮派发后续的能力。

## 验证计划

- `npm run build` 后运行编排、提示和决策策略相关单测，再验证调度依赖与本体。
- 覆盖独立派发后续跑、直接验收、依赖/冲突/预算拒绝及晚到事件；检查功能清单与设计文档同步。

## 当前进展

已实现有限派发优先、`nextStepPlan` 同次持久化、依赖/冲突/轮次门禁及同批自动验收；冷恢复时保留已有冻结前缀，不重复打开派发优先机会，后续新批次仍可使用。`npm run build` 通过；`node --test dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/loop/loopPlusSchedulerDependencies.test.js` 通过（246 项）；Ontology 校验与 `git diff --check` 通过。
