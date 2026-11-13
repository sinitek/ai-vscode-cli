# 经典 Loop 复用子任务验证结果

- 日期：2026-11-11
- 状态：completed
- 类型：feature
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-11
- claim_ttl：当前任务
- handoff_to：无

## 背景与目标

普通 Loop 提示词将用户或项目要求的验证一律解释为独立验证子任务，导致实现子任务已完成验证后仍重复派发。本次区分“要求验证”和“要求独立验证”，优先信任并复用当前有效的子任务汇报。

## 范围与非目标

- 修改经典 Loop 主任务和子任务提示词，交付“复用当前有效验证报告、只补缺口”的行为规则。
- 已删除测试计划的开发范围与回归证据摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（removed_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-test-classic-loop-verification-reuse.md; reference_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-feature-classic-loop-verification-reuse.md）；该审计仅供历史追溯，不是存活计划或当前执行负责人，本 feature 不承接测试开发。历史文档范围：文档/事实源维护。原 docs companion `2026-11-11-docs-classic-loop-verification-reuse.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 不改变 Loop+、完成协议、状态机、会话复用或子任务隔离；不新增验证门禁或自动判断测试结果的规则引擎。
- 工作区已存在相关未提交修改，采用保留式增量编辑；不创建分支或工作树，以免丢失当前未提交的行为基线。

## 验收标准

- 经典 Loop 的主/子任务提示明确区分普通验证要求与独立验收要求，并复用有效报告。
- 经典行为交付与 Loop+ 边界保持如本文历史记录所述；已删除测试计划的历史结果摘要见删除审计，文档事实源维护原由已退役 docs companion 承接（仅历史分工）。删除审计不是存活计划或当前执行负责人。
- 子任务明确汇报已通过且覆盖当前改动的验证时，主任务采信结果，不因要求验证而另派重复任务。
- 子任务可在实现过程中按用户或项目规则完成必要验证，汇报范围、命令或操作、结果及未完成项。
- 部分覆盖时只补缺失或失败项；后续改动导致失效时只补受影响项。不得无理由整套重跑。
- 汇报不清时优先续接来源子任务补充说明，不把缺少报告细节直接解释为必须重测。
- 用户或项目明确要求独立验收、交叉复核时，仍另派相应任务；未覆盖的实现后集成验证只补相应缺口，普通验证要求不等于独立验证要求。
- 已有满足独立要求且仍有效的验收汇报也直接复用，不在每次主任务唤醒后重新派发独立验收。
- 无验证要求时不增加验证；主任务仍不亲自测试或检查实现；Loop+ 不受影响。

## 影响面与风险

- 代码：`src/extensionHost/loopOrchestration.ts`、`src/loopTaskStore.ts` 的经典提示与沟通模板分支。
- 原测试计划独立开发的测试路径与覆盖范围历史摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-classic-loop-verification-reuse.md）；具体测试路径仍列于下方原验证命令，当前没有存活的独立 test 计划，本 feature 不承接测试开发。
- 架构、功能清单、能力分册及ontology规则交付原由已退役 docs companion 承接（仅历史分工）。
- 风险：仅通过提示词约束模型，不对自然语言报告做机械真伪判断；保留独立验收要求与过期结果补测边界。

## 验证计划

- 确认提示词行为符合本计划的范围；历史回归结果摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（removed_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-test-classic-loop-verification-reuse.md; reference_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-feature-classic-loop-verification-reuse.md）；完整验证命令保留于本节下方，本轮未重跑。
- `npm run build`。
- `node --test dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/promptExecutionShared.test.js dist/test/extensionHost/loopTaskStateMachine.test.js dist/test/loop/loopFinalSummary.test.js dist/test/loop/loopTaskStore.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js`。
- 扩大到 Loop+ 提示与协议相关回归，确认未改变其要求。
- ontology 结构校验、skill 单测、定向空白检查与 `git diff --check`。
- 无 UI、路径、CLI 参数或用户配置变更，不运行浏览器、不调用真实付费模型；模型实际决策是否遵守提示词不由单元测试保证。

## 任务列表

Tasklist:
- [completed] 调整经典 Loop 验证复用规则
- [completed] 明确独立验收与 Loop+ 边界

## 决策与文档同步

- 规则置于现有经典提示词，不复制到 Loop+ 或新增配置开关；沟通模板行为保持既有交付结论。
- 文档事实源和 ontology 的更新原为独立 docs 分工；原 companion 已退役，完整写作与校验记录未恢复；这里的验证列表不代表文档维护范围由 feature 承接。

## 验证结果

历史构建通过，179 项相关回归及其保留摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-classic-loop-verification-reuse.md）；完整命令仍列于本计划验证计划；ontology、空白及文档来源维护证据原记于 docs companion（已退役，完整记录未恢复）。本轮没有重跑。

- 没有修改 Loop+ 生产逻辑、用户配置、持久化历史报告，也未运行发布脚本。本次未启动浏览器、完整 Extension Development Host 或真实模型，模型实际派发效果仍需加载更新插件后的任务验证；自动化验证不宣称自然语言汇报的真实性或模型每次遵从性。

## 当前结论

经典 Loop 提示规则已交付，原状态为 completed。构建与 179 项回归的历史摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)中 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-classic-loop-verification-reuse.md`；完整历史测试命令仍在本文。ontology 校验及事实源同步原归 `2026-11-11-docs-classic-loop-verification-reuse.md`，该页已退役，不能将索引当作其执行证据。现存规则见[架构中的经典 Loop 约束](../../../../../ARCHITECTURE.md#1-当前实际结构)，只说明当前规则，不恢复历史校验日志；不扩大本文的实现与真实模型验收结论。

## 原始模板行为细节（历史来源补全）

扩大检查发现沟通文件模板也有强制独立派发提示，已同步修正经典与默认旧记录分支；Loop+模板原样保留。历史沟通文件不改写，主任务明确不将历史模板的默认要求视为用户或项目的独立验收要求。加载更新插件后的新一轮主任务判断使用新规则，不自动取消已派发任务。
