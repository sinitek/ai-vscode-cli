# 技能 ZIP 安装行为保持重构

- 日期：2026-11-08
- 状态：completed
- 类型：refactor
- 负责人：Loop+ fullstack coding attempt（不切换主模型，不再委派）
- owner：round-1-refactor-skill-archive-installation
- claimed_at：2026-11-08
- claim_ttl：本次执行
- handoff_to：主任务主审
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-08-skill-archive-installation-refactor.md`

## 目标与范围

行为保持的市场Facade、本地ZIP适配器、共享安全解压与安装模板。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- [2026-11-08-docs-skill-archive-installation-refactor.md](2026-11-08-docs-skill-archive-installation-refactor.md)：独立承接文档/事实源交付及其历史校验。

## 验收标准

- 行为保持的市场Facade、本地ZIP适配器、共享安全解压与安装模板；原可观察契约、非目标和限制以以下分配的原文为准。
- 21函数逐字比对与安全/错误身份不变；104→107阶段结果、CON等名称注入不等同Windows实机保留；外部版本差异不纳入。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文或关联 docs 计划；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-08-skill-archive-installation-refactor.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 背景与目标

`lobehubSkillMarket.ts` 混合 HTTP、本地输入和布局、安全解压、安装结果收集与临时目录生命周期。本次只抽取真实重复流程，保留旧入口作为兼容 Facade，用函数式模板协调来源特定发现。

### 范围与非目标

- 非目标：不改用户行为、HTTP 策略、技能命名、安全限制、CLI 替换/回滚规则、UI、依赖、版本或调度状态；不访问真实市场与用户技能目录；不发布、不提交、不创建分支。
- 预先存在：`package.json` 版本 1.8.7 → 1.8.8 为外部修改，保留且不纳入本次修改。

### 验收标准

- [x] 原公开导出、参数、Promise、结果形状、顺序和错误身份不变。
- [x] 两种本地布局与市场递归发现保持差异；共享层不依赖来源入口、HTTP 或 VS Code。
- [x] ZIP 安全代码及限制原样迁移，finally 覆盖解压/发现/安装且清理错误仍传播。
- [x] 文档与 Ontology 同步且校验通过，计划归档；主审验收留给主任务。

### 影响面与风险

- 代码：`src/config/lobehubSkillMarket.ts`、`src/config/localSkillZip.ts`、`src/config/skillArchiveInstaller.ts`；相关测试开发见已移除 test 类型计划的历史审计摘要[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-08-skill-archive-installation-refactor.md）。
- 风险：输入检查顺序、结果省略字段、名称排序和重复项、错误类身份、清理异常变化。
- 缓解：逐段移动安全代码，不复制底层安装器，不引入模式旗标/继承/注册表；行为型断言及安全函数迁移比对。仅回退本次文件差异，保护并发修改。

### 验证计划

1. `npm run build`，构建结束后再串行测试，不与 dist 读取并行。
5. `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。

### 测试与清单同步

- 功能清单仅同步实现与验证路径，不声称新增功能。
- UI 无改动，以代码范围和配置页离线回归为证，不声称运行浏览器。
  - `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains / 17 concepts / 16 relations / 113 rules / 2 workflows。
  - `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
  - 用 Node + TypeScript AST 将 HEAD 与当前三个模块的函数源码比对：21 个既有函数逐字相同（包含 HTTP、解压、安全、市场发现和规范化）；两个本地公开入口仅返回类型别名名称不同。
- 失败分类：无构建或测试失败。初次从符号链接执行视图运行 git 的删除假象属于执行环境路径问题，改用真实仓库根后确认只有原版本差异；未重置任何文件。
- 未运行：全量单测/严格覆盖率、Windows/Linux 实机、真实 CLI/市场/Extension Host、浏览器与性能基准。此次是局部无 UI 行为保持重构，已运行指定相关回归；不引入真实配置/网络副作用，不声称平台实机或性能提升。

### 任务列表

- [x] 核对项目规则、Ontology 状态与来源、当前源码及预先存在修改。

### 决策记录

- 2026-11-08：按已确定设计实施兼容 Facade + 函数式 Template Method；没有待做的多方案结构化决策，不再选方向。
- 2026-11-08：执行目录是指向真实仓库的符号链接视图；在实际仓库根执行 git/build，避免将视图误判为大量删除。实际仓库起始状态仅 package.json 版本差异。

### 当前结论

实现、自测与文档收口完成，归档到 `.ch/docs/exec-plans/completed/2026-11/2026-11-08-skill-archive-installation-refactor.md`。用户行为不变；本次自测完成不等于主审已经验收，最终验收仍由主任务决定。主任务给出的 263fc08e 基线为 build + 23 项，本次扩展回归独立实测 104 项全部通过。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。21函数逐字比对与安全/错误身份不变；104→107阶段结果、CON等名称注入不等同Windows实机保留；外部版本差异不纳入。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
