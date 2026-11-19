# Loop+ 主任务按需续跑计划

- 日期：2026-11-19
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-19
- claim_ttl：本次会话
- handoff_to：无

## 背景

Loop+ 主任务每次返回完整调度决策。较复杂的验收和后续工作可以让主任务先给出紧凑的下一步计划，宿主在既有事件驱动循环中保存该计划，并在下一次有效主任务决策中提供；无需把所有后续安排塞进同一份 JSON。

## 目标

支持可选、简短且结构化的 `nextStepPlan`，跨等待、协议重试、澄清和宿主重建保留；下一份有效的非澄清决策应用后消费或替换，并继续遵守现有验收、队列、停止和完成门禁。

## 范围

- 扩展 Loop+ 决策解析、主提示词、任务记录持久化和 orchestration。
- 通过现有事件驱动主循环续跑，不新增队列、调度状态机或 UI。
- 覆盖暂停/恢复、停止、宿主重建、无效决策、澄清、连续计划替换及完成清理。
- 同步 Loop+ 调度设计、能力清单、功能总表和相关 ontology 规则。

## 非目标

- 不改变验收顺序、验收批次、子任务并发、轮次预算、重试次数或任何现有完成门禁。
- 不要求主任务必须拆分，也不限制主任务一次决策中安排合理的多个子任务。
- 不新增 UI、设置、用户确认流程或模型自动生成的验收证据。

## 验收标准

- [x] 决策可返回短目标及可选验收标准；非法结构和与 `clarify`、`blocked`、`completed` 的冲突被拒绝。
- [x] 有效后续决策携带计划提示；失败、协议重试、澄清、暂停和宿主重建不会丢失待执行计划。
- [x] 有效继续决策消费旧计划，或在同一持久化更新中以新计划替换；有效终态和用户停止清除计划。
- [x] 计划不会绕过冻结验收、报告/消息确认、子任务调度、停止或完成门禁。
- [x] 补齐解析器、提示词、存储及 orchestration 回归测试，并通过 build 和 Loop+ 相关测试。
- [x] 更新设计文档、产品能力清单、功能总表和 Loop+ ontology 规则。

## 影响面

- 代码目录：`src/loopPlusDecision.ts`、`src/loopTaskStore.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusDecisionStrategies.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`。
- 测试目录：`src/test/loop/`、`src/test/extensionHost/`。
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/domains/`。
- 配置与脚本：无。

## 风险与缓解

- 风险：在无效响应或提示刷新时误消费计划。缓解：只在既有策略确认应用决策后更新持久化字段，澄清保留，停止显式清除。
- 风险：续跑计划被误解成对验收或完成规则的覆盖。缓解：提示将冻结验收及报告/消息前缀置于计划之前，明确现有门禁不可改变；状态机与 scheduler 不读取计划。
- 风险：模型返回复杂计划再次膨胀 JSON。缓解：将计划限制为短目标与少量短验收标准，不复制当前决策或调度快照。

## 验证计划

- 最小相关验证：Loop+ decision、prompt builder、task store 和 orchestration 测试。
- 单元自测命令：`npm run build` 后运行对应 `dist/test/` Node 测试。
- 扩展验证：`npm run build`、ontology validate 与 ontology 单测；检查 diff 和未覆盖边界。

## 测试与清单同步

- 单元测试新增/更新：`src/test/loop/loopPlusDecision.test.ts`、`src/test/loop/loopTaskStore.test.ts`、`src/test/extensionHost/loopPlusDecisionStrategies.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/test/extensionHost/loopPlusPromptBuilders.test.ts`。
- 单元自测结果：`npm run build` 通过；五个 Loop+ 测试文件共 284/284 通过；ontology validate 通过（2 domains、17 concepts、16 relations、157 rules、2 workflows、3 documents）；ontology unittest 9/9 通过；`git diff --check` 通过。
- 失败处理记录：无失败。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

- [x] 确认协议、主循环、持久化及业务语义边界。
- [x] 增加计划结构校验、提示注入和任务记录持久化。
- [x] 接入有效决策消费、暂停恢复、停止取消及完成清理。
- [x] 补回归测试并同步产品、设计及 ontology 文档。
- [x] 执行构建和相关验证并记录结果。

## 决策记录

- 2026-11-19：主任务可选择是否提供短 `nextStepPlan`；续跑复用现有主循环，每个计划只影响下一份有效的非澄清决策。`clarify` 不消费已有计划；`blocked` / `completed` 不能声明新计划。用户停止和成功完成清除旧计划。
- 2026-11-19：验收优先级和冻结前缀由现有宿主控制，计划只进入主模型上下文，不产生新调度状态或门禁。

## 当前结论

核心实现、生命周期回归测试及设计/产品/ontology 文档已完成。计划只在有效继续型决策应用后持久化或替换，并通过既有事件驱动主循环发起后续决策；无效协议、澄清、暂停和宿主重建保留计划，blocked、成功完成及用户停止清除计划。`npm run build`、五个相关 Loop+ 测试文件（284/284）、ontology validate、ontology 单测（9/9）及 `git diff --check` 均通过。执行计划已归档至 `.ch/docs/exec-plans/completed/2026-11/2026-11-19-feature-loop-plus-next-step-plan.md`。
