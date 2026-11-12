# Loop / Loop+ 清理气泡时保留补充需求

- 日期：2026-11-11
- 状态：completed
- 类型：bugfix
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-preserve-requirements.md`

## 目标与范围

修复现有群聊窗口误裁补充需求，保持计数/完整批次及允许超限。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- [2026-11-11-docs-loop-group-chat-preserve-requirements.md](2026-11-11-docs-loop-group-chat-preserve-requirements.md)：独立承接文档/事实源交付及其历史校验。

## 验收标准

- 修复现有群聊窗口误裁补充需求，保持计数/完整批次及允许超限；原可观察契约、非目标和限制以以下分配的原文为准。
- 既有气泡上限误删展示需求的使用背景支持bugfix；69/122、四Chromium组及无失败事实保留。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文或关联 docs 计划；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-preserve-requirements.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 背景与目标

群聊上限当前按连续前缀清理，导致较早提交的补充需求也从页面消失。本次在经典 Loop 与 Loop+ 共用的选择器中保护补充需求，保持原有全局配置、批量比例及非破坏性显示契约。

### 范围与非目标

- 非目标：不改变普通聊天保留规则、群聊文件、模型上下文、任务调度、主题和设置控件。
- 工作区存在其它任务的未提交改动；仅定点修改本任务相关规则，不覆盖或归档其它任务计划。

### 验收标准

- Loop / Loop+ 初始 HTML 与增量 patch 均保留所有 `user-message` 补充需求，并维持原时间顺序。
- 所有可见气泡继续计数，触发清理后跳过补充需求，按原 25% 批次删除最旧可清理气泡。
- 至少保留最新气泡；受保护需求本身达到上限时允许超限，不循环清理或删除需求。
- 同一面板不回填已清理的普通气泡，改变设置仍重算；存档不变。

### 影响面与风险

- 代码：`src/webview/loopGroupChatBubbleRetention.ts`、`src/webview/loopGroupChatPanel.ts`。对应测试开发曾由独立 test 类型计划承接；该计划已移除，历史证据摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-group-chat-preserve-requirements.md）。
- 跨平台：只操作内存数组，不新增路径或平台分支。

### 任务列表

Tasklist:
- [completed] 定位 Loop / Loop+ 气泡清理逻辑

### 决策记录

- 2026-11-11：补充需求按 transcript 的 `user-message` 类型保护；初始任务发起气泡不扩大保护范围。补充需求继续计入阈值，清理跳过它们并删除完整批次的普通气泡；需求本身过多时显式允许超限。

### 当前结论

已完成两种群聊的补充需求保护，构建、122 项相关测试、四组 Chromium 验证与 ontology 校验均通过。无额外热区记忆、EVENT_MEMORY 或 runbook 更新：稳定行为已沉淀到设计、功能清单及 ontology，本轮无新的可复用环境踩坑或跨会话风险。工作区中其它任务的改动保持原样。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。既有气泡上限误删展示需求的使用背景支持bugfix；69/122、四Chromium组及无失败事实保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
