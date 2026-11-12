# Harness execution-plan migration

- 日期：2026-11-11
- 类型：chore
- 状态：completed
- 负责人：协作
- owner：Loop+ round76 finalize-harness-generated-navigation-and-plan-archives
- claimed_at：2026-11-11
- claim_ttl：2026-11-11 本次交付完成后释放；后续变更需重新认领
- handoff_to：主审负责最终集成接受；Nov.3 blocked 业务门禁仍由其存活计划跟进

## 背景与目标

按 typed-plan 合同迁移既有计划并更新仓库内路径引用，保留原始日期、负责人、状态语义、证据、决策、失败与风险。

## 关联计划

- 共同背景：本轮规则、迁移和回归是三个独立范围；本计划只覆盖十一月这88份源计划，不代表全仓246份迁移已完成或失败。
- 遵循规则合同：[`2026-11-11-docs-harness-typed-plan-rules.md`](2026-11-11-docs-harness-typed-plan-rules.md)。
- 历史测试证据保留在[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)；迁移结构复用 Round71 已接受结果，最终集成接受仍由主审负责。

## 范围与非目标

- 范围：本分区为87份 `completed/2026-11/` 历史计划及1份 blocked active 源计划，共88份；逐源分类，按类型重命名，必要时拆分并关联，维护来源哈希映射。该分区不涵盖全仓其余计划；246份为更大迁移工作的总目标。
- 非目标：本计划不承担其它月份来源的迁移，不执行历史业务、收费 CLI 或发布恢复指令。归档联动仅更新本计划相关现行引用与共享 generated 导航，不扩大为全仓246源迁移计划。

## 验收标准

- [x] 所有源计划逐一映射到存在的新路径，映射哈希为源字节哈希。
- [x] 混合工作拆分有范围与验收，原始状态和证据被忠实继承。
- [x] 仓内引用更新，旧路径无残留壳或隐藏备份；审计来源键和保留证据中的历史路径不是现行导航，不删除。
- [x] 原 blocked Loop+ 计划仍 blocked，真实 429 与发布门禁保持原意。

## 影响面

- 文档目录：`.ch/docs/exec-plans/` 与迁移记录。
- 配置与脚本：无。

## 验证计划

- 最小相关验证：复用 Round71 四映射结构、246来源原始哈希、504唯一目标、216删除审计存活引用、test计划清零及304个 src/test 文件存续；本轮仅从十一月现有分片和删除审计读取当前计数，检查本次两份归档及受影响导航，不重扫全仓映射。
- 单元自测命令：无；文档收口不修改测试源码。复用 Round54 34/34 回归与 Round59 ontology 验证；不重跑历史业务单测、build、浏览器、真实 CLI、收费调用或发布。
- 扩展验证：本轮局部命名/type/月目录、同伴/相对审计链接、唯一受影响的审计 reference_path 与身份保留、manifest 快照语义、共享索引来源/锚点/freshness、实际修改文件空白与 LF。

## 历史迁移阶段

87份 completed 源及1份 blocked active 源曾形成100个目标（97 completed、3 blocked active）；当时类型计数为 feature 43、bugfix 28、refactor 9、chore 6、test 7、docs 5、perf 2。这是清理与后续补拆前的阶段性记录，不是当前计数。多类型拆分包括 Git 同步、Loop 路由/发布、Loop+ 验收结果复用、多标签聊天渲染性能及 Markdown 链接；后续补拆与 test 清理以现有分片/审计为准。

## 当前分片与来源身份

- 2026-11-11读取[十一月映射](../../migrations/2026-11-11-nov-active.json)：88源，177个存活目标，其中175个 completed、2个 blocked active；类型计数为 feature 45、bugfix 28、refactor 11、chore 7、docs 84、perf 2，无 test 目标。这里只统计分片 `new_paths`，不含本轮两份独立 harness 收口计划。
- 同日删除审计共87条，其中84条有 `source_old_path`、3条为独立新增测试计划（`source_old_path=null`）；这些删除记录与88源不是一一对应，也不把全仓246源/504目标当作本分区计数。
- Nov.3 blocked 源 `.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md` 曾拆为 bugfix/test/chore；删除 test 后存活的是[路由修复](../../active/2026-11-03-bugfix-loop-cli-model-routing.md)与[真实验收/发布门禁](../../active/2026-11-03-chore-loop-routing-live-acceptance-release.md)，两份继续 blocked。其删除项是 entries[85]：`removed_path=.ch/docs/exec-plans/active/2026-11-03-test-loop-cli-model-routing.md`，`source_old_path=.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`；历史回归证据只从该项追溯。
- entries[86] 是另一项独立 harness 合同测试计划：`removed_path=.ch/docs/exec-plans/active/2026-11-11-test-harness-plan-contracts.md`、`source_old_path=null`、删除时状态 `in-progress`，不能混同 Nov.3 来源。原“未实现或运行回归”结论仍是历史事实；本轮只将其 `reference_path` 随本存活计划归档更新，不更改删除身份、哈希、状态或 retained_evidence。

## 风险与缓解

- Nov.3 三次真实调用没有有效结果，后两次 HTTP 429；没有有效 `result.txt`，完整真实模型验收未通过，1.7.6 未发布。迁移文档完成不解除业务 blocked，不重跑真实模型，不执行发布脚本。
- 归档时只改现行引用；历史 `source_old_path`、`removed_path` 及 `retained_evidence` 保留原身份，不视为断链。共享索引通过脚本更新，不覆盖 `.local/` 个人历史召回包。

## 测试与清单同步

- 无测试源码、运行时或用户可见行为变更；不新增 test 计划，功能清单无需更新。
- 无新增热区事实；ontology 不引用这两份 harness 计划，规则事实源未移动，不重跑已有有效本体验证。

## 当前结论

十一月88源分区的迁移、后续补拆、test计划清理与引用修复已有接受证据；本轮据此核实四项验收，修正 Nov.3 与独立 harness 审计身份、回填真实计数并完成局部归档交付。两份 Nov.3 业务计划继续 blocked，主审保留最终集成接受权；其它月份由各自分区及总集成证据负责，本计划不扩为全仓迁移。
