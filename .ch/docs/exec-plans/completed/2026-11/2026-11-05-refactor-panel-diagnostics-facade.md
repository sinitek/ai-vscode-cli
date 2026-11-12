# Panel Diagnostics 职责拆分与兼容 Facade

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex（Loop+ 独立执行尝试）
- owner：round-1-refactor-panel-diagnostics-facade
- claimed_at：2026-11-05
- claim_ttl：本次执行
- handoff_to：主审
- 类型：refactor

## 背景与目标

`panelDiagnostics.ts` 混合错误/重试、Loop 消息策略、模型诊断和群聊协调四类职责，导致运行时辅助调用方依赖宿主面板实现。主审已选择 diagnostics_facade（decision-model confidence=0.95），本次不重新选型。索引有滞后，已先用 CodeGraph 定位，再核对磁盘源码。

逐函数搬迁实现，让内部调用方直达所属模块，同时保持旧入口运行时导出身份、类型签名与全部行为。

## 范围与非目标

- 新建 `promptRetry.ts`、`loopTaskMessagePolicy.ts` 和 `extensionHost/loopGroupChatPanelCoordinator.ts`。
- `panelDiagnostics.ts` 保留模型管理诊断，显式命名转导出旧 API。

- 更新内部依赖；新增边界测试的历史开发记录按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-panel-diagnostics-facade.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。原文的架构导航和 ontology source_refs 仅随实现位置迁移，不改变规则含义，也无产品文档交付依据，不为三件套虚构 docs。

不改重试算法、Loop/Loop+ 恢复规则、模型路由、依赖注入工厂、持久化和消息顺序；不改 Webview、用户文案、CLI/依赖版本；不启动真实 CLI、不发布、不提交、不建分支、不刷新全仓索引、不重建缺失历史设计文档、不修改调度状态。

## 验收标准

- [x] 旧入口与新模块运行时导出同一对象，类型兼容，无 export *、包装或反向依赖。
- [x] 原函数实现保持不变，60声明逐字对照、29导出名称保持。
- [x] 内部调用方直达所属模块，仅诊断仍用旧入口；保持权限、消息、重试与依赖边界。

## 影响面与风险

- 生产代码：`src/` 运行时模块；测试开发的历史证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-panel-diagnostics-facade.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，相关代码位于 `src/test/`；配置与脚本不修改。架构/ontology 仅实现位置导航，其中本体文件为 `.ch/docs/ontology/domains/cli-plugin-runtime.json`，不承担新产品规格编写。

- 模块路径与循环依赖：独立加载测试、构建检查及内部 import 审查。
- 搬迁语义漂移：原始实现分段对比，保留旧入口测试，并补关键边界。
- 隔离工作区顶层是符号链接，当前目录 git 会误报删除：在实际仓库根目录执行 git/编辑/验证，不更改链接或基线文件。
- 测试不得污染用户任务：仅用既有 mock、内存夹具和系统临时目录，无真实长等待。

## 任务列表

- [x] 约束、图定位、磁盘源码和ontology核对。
- [x] 原样搬迁、Facade与内部依赖整理及导航来源迁移。
- [x] AST和业务语义对比、归档与宿主报告；新增测试开发为已完成历史工作，证据见上述来源审计。

## 决策记录

- 2026-11-05：沿用主审已完成的 diagnostics_facade 决策；不新增类、容器或策略层。

## 验证计划与当前结论

改前主审提供 build 成功、panelDiagnostics/hiddenRetry/协调器30项通过，是基线而非本次改后验收。历史新测试87/87与3046项结果按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-panel-diagnostics-facade.md` 见测试计划移除审计。

已完成。原模块 1628 行拆为 Facade/模型诊断 236 行、promptRetry 241 行、消息策略 230 行、群聊协调器 966 行（合计 1673 行；增加部分为显式导入/转导出，不把行数作为架构长期指标）。内部调用方仅诊断继续使用旧入口。

结构核对：使用 TypeScript AST 比较改前快照与四个模块，60 个顶层函数/类型/常量逐字一致，仅协调器的 i18n 类型相对路径变化；29 个运行时导出名称与改前编译产物完全一致，28 个迁移导出由测试逐项 strictEqual。ontology 仅 source_refs 变化，业务语义深比较一致。

## 结构与导航历史验证命令

4. `node /tmp/verify-panel-diagnostics-facade.cjs`：60 个声明原样搬迁、29 导出名称保持、ontology 业务语义保持，全部通过。
5. `git diff --check`：退出 0。
6. `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（2 domains、16 concepts、15 relations、105 rules、2 workflows、3 documents）。
7. `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9，通过。

## 功能清单边界

- 功能清单：`FEATURE_INVENTORY.md` 无需更新；本次仅实现位置与依赖边界变化，无用户可见行为、权限、流程或验收变化。
- 相关文档同步：架构导航和 ontology source_refs 随代码迁移，不改变业务规则含义。

## 审查与未验证事项

维护性：职责内聚，公开兼容面固定，原依赖注入工厂和回调结构保留；未引入继承、容器、新模式、包装或循环依赖。安全：预览允许根目录与路径校验原样保留，无新增运行时网络、进程、敏感日志和用户配置写入。性能：算法、重试序列和最多 500ms 的活动检查不变，无新增阻塞；未做性能基准，不宣称性能提升。UI：未修改 Webview HTML/CSS/DOM、布局、主题、文案或交互，因此未运行浏览器与 Extension Development Host；真实 CLI/实际调度未运行且不得以 mock 测试冒充真实验证。没有提交、建分支、发布或修改调度状态。

归档路径：`.ch/docs/exec-plans/completed/2026-11/2026-11-05-panel-diagnostics-facade.md`。

以上原归档路径仅历史记录，不恢复旧命名；原completed保留。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留 Panel Diagnostics Facade 身份与模块边界回归的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-panel-diagnostics-facade.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
