# 系统通知显示项目名称 — 文档与事实源交付

- 日期：2026-11-08
- 状态：completed
- 类型：docs
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-08-notification-project-prefix.md`

## 目标与范围

功能清单、能力规格及两条通知ontology。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-08-feature-notification-project-prefix.md](2026-11-08-feature-notification-project-prefix.md)：承接产品实现及其决策/约束。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。

## 验收标准

- 完成以下实际文档交付：功能清单、能力规格及两条通知ontology；记录与实现、测试证据一致，不把文档门禁当作功能或真实环境验收。
- 新增可见通知信息，不改权限/触发；74+15历史回归与macOS两次submitted保留，横幅可见性及Windows/Linux实机未验证。

## 验证与真实状态

验证计划：复用原文档/ontology/引用/空白检查记录；没有原文成功证据的检查不补造。原计划记录的 ontology 校验及范围空白/差异检查通过；独立测试开发已移除，其审计保留的历史测试摘要、结果与边界见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-08-notification-project-prefix.md）。功能/页面行为历史验证按关联计划中的存活实现记录追溯；本 docs 计划及删除审计均不构成现行 test 验证入口。本次不重新执行。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 影响面与风险

- 文档：功能清单、能力规格、通知 ontology 规则。

### 验证计划

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`

### 测试与清单同步

- 结构验证：ontology 校验通过（2 domains / 17 concepts / 16 relations / 113 rules / 2 workflows）；`git diff --check` 和 `node scripts/check_trailing_whitespace.js <本次文件>` 通过。
- 失败处理记录：无构建、测试或结构校验失败。
- 功能清单：已同步人工交互与完成通知正文、项目名来源及回退。
- 相关文档同步：能力规格与两条 ontology 规则已同步；本次不产生需要写入热区的长期经验，不更新 ROLLING_SUMMARY 或 EVENT_MEMORY。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。新增可见通知信息，不改权限/触发；74+15历史回归与macOS两次submitted保留，横幅可见性及Windows/Linux实机未验证。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
