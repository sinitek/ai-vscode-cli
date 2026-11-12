# 模型存储纯规范化边界重构

- 日期：2026-11-06
- 状态：completed
- 类型：refactor
- 负责人：Codex
- owner：Loop+ round-1-refactor-model-store-normalization
- claimed_at：2026-11-06
- claim_ttl：本次独立执行
- handoff_to：主审

## 背景

主审比较配置复制分支、Loop 调度和模型存储后，选择模型存储（decision-model 首选，confidence=0.89）。当前 facade 1618 行，ensureCliModelStore 约314行，18字段的迁移、校验与IO和业务操作混杂；三份配置到CLI映射、两份独立角色思考映射重复。沿用已完成的选题决策，不扩大范围。

## 目标

使用兼容 Facade + 职责内聚的纯规范化模块，分离共享类型，保持所有公共入口、同步返回值与持久化行为。

## 范围

modelSelectionStore.ts、modelSelectionStoreTypes.ts、modelSelectionStoreNormalization.ts。新增特征测试开发是已完成的历史工作，其摘要见来源审计；ARCHITECTURE 与 ontology 来源文档的实际同步由关联 docs 计划承接。

## 非目标

不改Loop调度、UI、IO实现、模型选择/修改业务、PanelState、运行参数、依赖或发布。不提交、不切分支，不写用户运行状态/其它attempt报告，不更新ROLLING_SUMMARY。

## 验收标准

- [x] 一次既有legacy迁移，输出全部18字段；输入不变、无共享可变默认对象，JSON格式不变。
- [x] trim、大小写去重首拼写/顺序、配置隔离、空容器与宽松typeof object语义不变。
- [x] selectedLoop只收main/subtask；OpenCode模型先canonical??alias再规范化，variant首个有效canonical/alias优先级不变。
- [x] 显式角色仅自有字符串，trim后空值保留；seed仅true，角色与fullstack/split槽隔离。
- [x] CLI思考遍历CLI_LIST并注入校验/转换，Loop思考固定codex；独立前端/全栈使用内置档位，保留default key、__default__、Grok off语义。
- [x] 原入口显式导出所有既有类型/辅助，facade→normalization/types，无反向依赖或新增IO。
- [x] read/load/write保持原实现；构建、指定回归、diff与ontology校验有实际结果。

## 影响面

- 代码目录：src模型存储与src/test/core。
- 文档目录：ARCHITECTURE.md、本计划、按需ontology。
- 配置与脚本：无。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留纯规范化边界的13个独立特征用例及其运行结果，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-model-store-normalization.md`；测试依赖被抽离的纯模块和保持兼容的 Facade。
- `.ch/docs/exec-plans/completed/2026-11/2026-11-06-docs-model-store-normalization.md`：ARCHITECTURE职责/依赖方向更新及既有 ontology 规则的 source_refs 更新；文档仅记录重构后的事实边界，不改变用户行为或本体规则。

## 风险与缓解

- 风险：模型与variant别名优先级不同；注入思考转换和独立角色校验不同；显式空模型易被丢弃。
- 缓解：先对原入口执行明确预期的特征测试，再抽离；不以复制旧实现作oracle，不统一异构规则，仅复用同构字段。
- 风险：临时执行入口通过符号链接映射仓库，git status在入口显示虚假删除。
- 缓解：所有修改和验证在真实仓库 /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli 执行；真实仓库起始git status为空。

## 验证计划

- 最小相关验证：npm run build，之后node --test dist/test/core/modelSelectionStoreNormalization.test.js。
- 单元自测命令：node --test dist/test/cli/grokmodelselection.test.js dist/test/extensionHost/cliModelSelectionStrategies.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/loop/loopPlusSubtaskMode.test.js dist/test/loop/subtaskCliRoute.test.js。
- 扩展验证：node scripts/run_unit_tests.js；git diff --check；python3 .agents/skills/ontology/scripts/search_ontology.py --validate。
- 构建和读取dist的测试严格串行。纯内部重构，不启动真实付费CLI、浏览器或扩展宿主。

## 关联交付归属

- 新增13个特征用例、原实现/重构后测试结果、全量测试3项真实DSH跳过与未执行边界均按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-model-store-normalization.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)；本计划范围仅为代码重构。
- ARCHITECTURE职责/依赖说明及三条既有 ontology 规则的 source_refs 实际更新由 `.ch/docs/exec-plans/completed/2026-11/2026-11-06-docs-model-store-normalization.md` 承接；功能清单无需更新。本计划不再把文档写作列为实现收尾。

## 任务列表

- [x] 读取规则、CodeGraph与ontology事实来源。
- [x] 提供可由历史独立特征测试验证的纯模块边界；测试开发与结果仅由来源审计追溯，不作为现行互链。
- [x] 抽离类型/纯规范化，复用三份CLI和两份独立思考映射。
- [x] 完成重构；回归与文档实际交付由关联计划分别记录。

## 决策记录

- 2026-11-06：采用Facade保持旧路径与导出；不增加策略、类继承、DI、动态字段路径或注册框架。沿用主审已完成的结构化选题，不重复决策调用。
- 2026-11-06：共享normalizeConfigCliSelections替代三份CLI映射，共享normalizeIndependentRoleThinking替代两份独立角色思考映射；不与注入式CLI/Loop思考转换合并，避免改变语义。两种OpenCode alias逻辑保持分离。Facade由1618行减至1203行，纯规范化391行、类型50行，ensureCliModelStore从314行减至255行。
- 2026-11-06：用TypeScript AST核对全部59个既有公共导出名称一致；git show HEAD内容对比确认readModelStore直到文件末尾的IO/业务/PanelState代码逐字不变；静态核对纯模块只有一个预规范化legacy调用。无提交、切分支、依赖升级、发布或用户运行数据修改。

## 当前结论

已完成并归档。维护收益是将迁移/规范化和共享类型从大Facade分离，消除同构重复，使纯模块可无VS Code初始化独立测试；用户可见行为不变。未运行真实付费CLI、浏览器、扩展宿主或live DSH门禁：本次不修改路由执行、UI或交互，自动化纯逻辑与现有回归已覆盖相关边界；不声称真实端到端验证通过。未运行严格100%覆盖率入口（本次要求为行为回归，未变更覆盖率门槛）。剩余风险为未进行真实运行环境验证，以及刻意保留历史宽松object判断/空容器规则；不顺手修复这些行为。attempt报告位于分配的用户级沟通文件，不写调度记录、快照或其它报告。
