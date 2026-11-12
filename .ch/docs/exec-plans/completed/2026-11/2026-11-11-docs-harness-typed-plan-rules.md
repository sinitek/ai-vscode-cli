# Harness typed plan rules and skills

- 日期：2026-11-11
- 类型：docs
- 状态：completed
- 负责人：协作
- owner：Loop+ round76 finalize-harness-generated-navigation-and-plan-archives
- claimed_at：2026-11-11
- claim_ttl：2026-11-11 本次交付完成后释放；后续变更需重新认领
- handoff_to：主审负责最终集成接受；规则事实源维护者负责后续变更

## 背景与目标

执行计划约定需要按真实工作类型分类，并以精确类型命名。根级规则、计划模板和 execution-plan / ontology 技能需要一致表达此合同。

## 关联计划

- 共同背景：typed-plan 规则与既有计划迁移分别维护，不复制混合正文。
- 迁移依赖本计划的命名与拆分合同：[`2026-11-11-chore-harness-plan-migration.md`](2026-11-11-chore-harness-plan-migration.md)。
- 已移除的独立 harness 合同测试计划见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json) entries[86]：`removed_path=.ch/docs/exec-plans/active/2026-11-11-test-harness-plan-contracts.md`、`source_old_path=null`；不是 Nov.3 来源拆分。其删除时的 `in-progress`、未实现或运行回归结论保留，不以本轮验收改写历史。

## 范围与非目标

- 范围：根级及执行计划规则、模板、相应技能与 media scaffold 的现有交付，明确类型词表、拆分门槛、状态继承和历史证据保真；本轮只核实并收口，不重新实施规则迁移。
- 非目标：不重做历史计划迁移，不更改业务 ontology 内容或运行时，不把文档完成当作真实模型验收或发布通过。

## 验收标准

- [x] 文件名严格为 `YYYY-MM-DD-<type>-<kebab-case-slug>.md`，type 只取 feature / bugfix / refactor / chore / docs / test / perf。
- [x] 多个实质类型拆分为有依赖关系的独立计划；测试执行证据不误拆成测试开发。
- [x] 规则、模板与技能保持一致，并明确不改写历史结果或失败事实。

## 影响面

- 文档目录：根级 `AGENTS.md`、`.ch/docs/exec-plans/README.md`、`.ch/docs/exec-plans/TEMPLATE.md`。
- 技能目录：`.agents/skills/AGENTS.md`、`.agents/skills/execution-plan/SKILL.md`、`.agents/skills/ontology/SKILL.md`。
- 模板目录：`media/workspace-scaffold/AGENTS.md`、其 `.agents/skills/` 约定及 execution-plan / ontology 技能、`.ch/docs/exec-plans/README.md` 与 `TEMPLATE.md`。

## 实际交付

- 根级 `AGENTS.md` 与技能总约定均导航到 `.ch/docs/exec-plans/README.md` 单一事实源；README 规定精确七类、实质类型拆分、具体依赖互链、真实状态和 `completed/YYYY-MM/` 归档，`bugfix` 只修复已发布版本缺陷。
- `.ch/docs/exec-plans/TEMPLATE.md` 已提供类型、关联计划、owner/claim/交接、验收、风险、决策、测试结果、失败处理及功能清单同步字段，不把验证执行证据单独归为测试开发。
- execution-plan 技能承接相同命名、拆分、状态与归档流程；ontology 技能负责核对 `source_refs`、业务状态及迁移后的来源有效性，不复制计划类型规则。对应 media scaffold 保持同一职责合同但不要求逐字复制项目正文。
- `.ch/docs/MEMORY.md` 的有限授权例外保留逐源映射、失败/blocked/未发布语义及 memory/generated 保护；scaffold 仍是业务中性的新工作区模板，不自动覆盖已安装工作区或既有计划。

## 风险与缓解

- 文档归档不解除业务阻塞，也不将删除审计中的历史未执行结果改写为成功；规则持续以 README 为单一来源，避免复制分叉。

## 验证计划

- 最小相关验证：只读核对上述现有规则/模板/技能/scaffold 合同；归档时检查本文件命名、docs 类型、月份、同伴链接及相对审计链接。
- 单元自测命令：无；纯文档收口，无测试源码改动。复用 Round54 34/34 合同回归、Round59 ontology 验证及 Round71 联合结构结果，不重复运行。
- 扩展验证：本轮局部归档/导航/空白与 LF 检查；共享索引仅通过既有 memory-indexer 重建，受保护的 `.local/` 个人历史包保持不动。

## 测试与清单同步

- 不新增测试开发；本轮无业务或用户可见行为变化，功能清单无需更新。
- 无新增稳定记忆事实；不改热区或私有事实。ontology 未引用本文件，规则来源仍为 README/TEMPLATE，归档不需改动本体。

## 当前结论

现有规则、模板、技能及 scaffold 合同已实际交付，三项文档验收已核实。本轮集成所有者完成局部检查、归档及导航同步；主审仍负责最终集成接受。本计划完成不覆盖迁移分区之外的业务验收，不恢复独立 test 计划，不改写任何历史测试结论。
