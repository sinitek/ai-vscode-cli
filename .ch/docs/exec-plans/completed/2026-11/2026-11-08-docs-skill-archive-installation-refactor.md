# 技能 ZIP 安装行为保持重构 — 文档与事实源交付

- 日期：2026-11-08
- 状态：completed
- 类型：docs
- 负责人：Loop+ fullstack coding attempt（不切换主模型，不再委派）
- owner：round-1-refactor-skill-archive-installation
- claimed_at：2026-11-08
- claim_ttl：本次执行
- handoff_to：主任务主审
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-08-skill-archive-installation-refactor.md`

## 目标与范围

ZIP安装设计、ARCHITECTURE导航、清单路径及ontology来源。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-08-refactor-skill-archive-installation-refactor.md](2026-11-08-refactor-skill-archive-installation-refactor.md)：承接产品实现及其决策/约束。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。

## 验收标准

- 完成以下实际文档交付：ZIP安装设计、ARCHITECTURE导航、清单路径及ontology来源；记录与实现、测试证据一致，不把文档门禁当作功能或真实环境验收。
- 21函数逐字比对与安全/错误身份不变；104→107阶段结果、CON等名称注入不等同Windows实机保留；外部版本差异不纳入。

## 验证与真实状态

验证计划：复用原文档/ontology/引用/空白检查记录；没有原文成功证据的检查不补造。原计划记录的 ontology 校验及范围空白/差异检查通过；独立测试开发已移除，其审计保留的历史测试摘要、结果与边界见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-08-skill-archive-installation-refactor.md）。功能/页面行为历史验证按关联计划中的存活实现记录追溯；本 docs 计划及删除审计均不构成现行 test 验证入口。本次不重新执行。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 范围与非目标

- 范围：市场 Facade、本地 ZIP 适配器、共享安全解压与安装模板、离线回归、设计/架构导航/功能清单/Ontology 来源同步。

### 验收标准

- [x] 离线安装、失败继续、清理、导出兼容回归和指定配置页测试通过。

### 影响面与风险

- 文档：`ARCHITECTURE.md`、设计文档、功能清单、Ontology 和本计划。

### 验证计划

3. `git diff --check`。
4. `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。

### 测试与清单同步

- 文档同步：设计说明、ARCHITECTURE 单条导航、功能清单两项实现/验证路径、Ontology 实现路径与来源锚点（校正“Skills 本地 ZIP 导入”）。
- 记忆判断：可复用责任边界已上提设计文档，无新的事故/偏好/复发问题；不更新 EVENT_MEMORY 或 ROLLING_SUMMARY，不写自动流水账。

### 任务列表

- [x] 补齐并执行离线行为回归。
- [x] 同步事实来源、完成验证、归档；attempt report 作为本次执行交接件。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。21函数逐字比对与安全/错误身份不变；104→107阶段结果、CON等名称注入不等同Windows实机保留；外部版本差异不纳入。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
