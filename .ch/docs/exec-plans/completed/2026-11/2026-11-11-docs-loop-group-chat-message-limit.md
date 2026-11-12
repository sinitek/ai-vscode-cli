# Loop / Loop+ 群聊气泡显示上限 — 文档与事实源交付

- 日期：2026-11-11
- 状态：completed
- 类型：docs
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-message-limit.md`

## 目标与范围

功能清单、新群聊显示窗口设计及ontology。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-11-feature-loop-group-chat-message-limit.md](2026-11-11-feature-loop-group-chat-message-limit.md)：承接产品实现及其决策/约束。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。

## 验收标准

- 完成以下实际文档交付：功能清单、新群聊显示窗口设计及ontology；记录与实现、测试证据一致，不把文档门禁当作功能或真实环境验收。
- 新增非破坏性窗口；338通过、4侧栏+5parseCompleteJsonContainer既有失败、四页面组合和设置证据保留。

## 验证与真实状态

验证计划：复用原文档/ontology/引用/空白检查记录；没有原文成功证据的检查不补造。原计划记录的 ontology 校验及范围空白/差异检查通过；独立测试开发已移除，其审计保留的历史测试摘要、结果与边界见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-message-limit.md）。功能/页面行为历史验证按关联计划中的存活实现记录追溯；本 docs 计划及删除审计均不构成现行 test 验证入口。本次不重新执行。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 范围与非目标

- 范围：全局设置持久化、面板状态、首次及增量渲染、边界测试、功能清单与 ontology。

### 影响面

- `.ch/docs/product-specs/FEATURE_INVENTORY.md`、群聊显示设计与 ontology。

### 验证计划

- 结构：ontology validate、对应 Python 单测、空白检查。

### 测试与清单同步

- 功能清单：已新增独立“Loop / Loop+ 群聊气泡显示限额”条目。
- 设计及 ontology：新增群聊显示窗口设计与 `plugin.rule.loop_group_chat_message_limit`；ontology validate 与 9 项 Python 测试通过。

### 真实 Chromium 页面验证

- `git diff --check` 通过；ontology validate 通过，ontology Python 单测 9/9 通过。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。新增非破坏性窗口；338通过、4侧栏+5parseCompleteJsonContainer既有失败、四页面组合和设置证据保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
