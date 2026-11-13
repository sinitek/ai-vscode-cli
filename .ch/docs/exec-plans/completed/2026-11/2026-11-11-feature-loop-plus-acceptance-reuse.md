# Loop+ 复用验证结果并保留验收审查

- 日期：2026-11-11
- 状态：completed
- 类型：feature
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-11
- claim_ttl：当前任务
- handoff_to：无

## 关联计划

- 本计划只记录 Loop+ 验收行为变更；新增回归断言的历史摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。设计/规格/ontology 同步原归 `2026-11-11-docs-loop-plus-acceptance-reuse.md`。该页已退役，保留原完成背景与分工，不据索引认领同步证据或新增通过结论。[references 索引](../../../references/index.md)仅作导航。

## 背景与目标

Loop+ 当前主提示要求不把子任务声明当作证据，同时无条件允许主模型测试或启动产物，容易重复已完成的验证。改为信任子任务具体执行结果，主模型继续独立判断实现、契约、改动合理性、遗漏/边界和用户选择的附加审查；测试通过不等于全部验收通过。

## 范围与非目标

- 只修改Loop+主子任务提示与Loop+沟通模板；对应回归断言开发曾由独立 test 类型计划承接，该计划已移除；历史结果与限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-plus-acceptance-reuse.md），调度设计、清单、能力分册与ontology同步原由已退役 docs companion 承接（仅历史分工）。
- 不修改经典 Loop、验收 JSON 字段、六项固定清单、附加审查配置、调度器、完成门禁、失败修复和会话恢复逻辑。
- 工作区含已有未提交修改，保留式增量编辑，不创建分支或工作树，不覆盖已有行为基线。

## 验收标准

- 信任子任务明确汇报的测试、构建和启动结果，覆盖当前改动且仍有效时直接复用，不自行重跑也不另派复现任务。
- 主模型仍审查当前待验收事件的相关代码、差异或交付物，逐事件判断六项固定验收与已选附加项；自测成功或“全部完成”不替代审查结论。
- 补充检查仅针对未覆盖、失败、后续修改失效的部分或明确独立验证要求；先说明已有结果、具体缺口和最小范围。已有效完成的独立检查也复用。
- 汇报不清先补说明，不机械索要原始日志或因缺少细节直接重跑。收尾/续跑复用已验收且未变化的结果，保留最终需求覆盖及开放事件门禁。
- 子任务汇报范围、命令或操作、结果、未执行或未覆盖项及相关后续改动，区分自测结果与需主模型审查的事项。
- 两种子任务模式和五类主模型提示均适用；经典 Loop 不变，Loop+ 失败事件不得被报告采信规则改判通过。

## 影响面与风险

- 代码：`src/extensionHost/loopPlusPromptBuilders.ts`、`src/loopTaskStore.ts` 的 Loop+ 沟通模板分支。
- 测试：主子任务提示和跨模式沟通模板；扩大到验收方案、协议、调度与编排回归。
- 风险：信任执行事实不等于结果覆盖完整，也不等于实现正确。通过明确范围、后续改动失效及持续代码审查限制复用，不新增机械报告门禁。
- 自动化只验证提示、模板与既有协议不变；不保证模型每次决策都遵守新提示。

## 验证计划

- 本计划核对提示与模板的复用/审查行为；红灯断言开发和历史验证结果摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-plus-acceptance-reuse.md）。
- `npm run build`，随后定向运行 `dist/test/extensionHost/loopPlusPromptBuilders.test.js`、`dist/test/loop/loopTaskStore.test.js`。
- 扩大到 Loop+ 编排/运行时集成/调度/协议/验收方案及经典 Loop 提示相关回归。
- ontology `--validate`、ontology skill 单测、定向空白校验和 `git diff --check`。
- 不变更 UI、CLI 接口或用户配置，不跑浏览器，不调用真实付费模型，不执行发布脚本。

## 任务列表

Tasklist:
- [completed] 核对验收流程与重复验证来源
- [completed] 调整结果复用和审查边界
- [completed] 实现验收行为与结果复用

## 决策与文档同步

- 复用执行事实，保留主模型验收判断，不照搬经典 Loop 的不检查实现策略。
- 维持默认及附加验收字段、事件批次、失败修复和最终完成门禁，避免用可信报告直接自动通过。
- 稳定规则沉淀到既有设计、规格与 ontology，不重复扩写热区或事件记忆。

## 验证结果

- 实现完成后 `npm run build` 通过；相关回归历史摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-plus-acceptance-reuse.md），文档结果原指向已退役 docs companion（完整记录未恢复）。这里保留原始完成结论，不把独立类型交付合并为 feature 工作。
- 未运行发布脚本、真实付费模型、浏览器或完整 Extension Development Host，未修改用户配置或既有报告。回归验证提示与协议边界，不宣称真实模型必然遵从或执行报告天然覆盖全部需求；加载更新插件后的实际派发效果仍需观察。

## 当前结论

优化已完成：Loop+ 采信并复用有效执行结果，主模型保留逐事件交付物审查和已选附加验收；仅针对明确缺口、失败、结果失效或独立要求追加最小检查。收尾与续跑只审新增或受影响内容，固定清单、最终需求覆盖和事件完成门禁不变。构建、370 项相关回归、ontology 校验及其 9 项单测通过；真实模型效果未实测。
