# Loop / Loop+ 清理气泡时保留补充需求 — 文档与事实源交付

- 日期：2026-11-11
- 状态：completed
- 类型：docs
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-preserve-requirements.md`

## 目标与范围

群聊设计、功能清单及保护需求ontology。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-11-bugfix-loop-group-chat-preserve-requirements.md](2026-11-11-bugfix-loop-group-chat-preserve-requirements.md)：承接产品实现及其决策/约束。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。

## 验收标准

- 完成以下实际文档交付：群聊设计、功能清单及保护需求ontology；记录与实现、测试证据一致，不把文档门禁当作功能或真实环境验收。
- 既有气泡上限误删展示需求的使用背景支持bugfix；69/122、四Chromium组及无失败事实保留。

## 验证与真实状态

验证计划：复用原文档/ontology/引用/空白检查记录；没有原文成功证据的检查不补造。原计划记录的 ontology 校验及范围空白/差异检查通过；独立测试开发已移除，其审计保留的历史测试摘要、结果与边界见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-preserve-requirements.md）。功能/页面行为历史验证按关联计划中的存活实现记录追溯；本 docs 计划及删除审计均不构成现行 test 验证入口。本次不重新执行。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 范围与非目标

- 范围：群聊选择器、时间线投影、回归测试、功能清单、设计及 ontology。

### 影响面与风险

- 文档：群聊限额设计、功能清单、`plugin.rule.loop_group_chat_message_limit`。
- 风险：保护消息多于上限、最新消息受保护、思考结束和重复刷新；由纯函数和双模式渲染回归覆盖。

### 验证计划

- ontology `--validate`、相关 Python 单测及 `git diff --check`。

### 测试与清单同步

- 功能清单、设计与 ontology：已同步补充需求保护、完整批次清理、计数与允许超限的契约。

### 结构与事实来源

- ontology `--validate` 通过，ontology Python 单测 9/9 通过，`git diff --check` 通过。
- 功能清单、设计及 `plugin.rule.loop_group_chat_message_limit` 已同步。
- 未运行全仓测试、全仓严格覆盖率、真实 Extension Development Host / CLI / 模型，以及 Windows/Linux 本机验证；本次仅改内存筛选与 HTML 投影，不涉及平台路径或 CLI。

### 任务列表

- [completed] 完成验证并同步相关文档

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。既有气泡上限误删展示需求的使用背景支持bugfix；69/122、四Chromium组及无失败事实保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
