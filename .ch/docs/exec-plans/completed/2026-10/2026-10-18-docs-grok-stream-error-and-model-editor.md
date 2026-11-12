# Grok 流式错误与多模型主从编辑器 — 文档

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- 类型：docs

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-grok-stream-error-and-model-editor.md`（历史标识，原文件已替换）
- 关联计划：[已发布行为修复](2026-10-18-bugfix-grok-stream-errors.md); [新功能开发](2026-10-18-feature-grok-model-editor.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

只承担“Grok 流式错误与多模型主从编辑器”原文明确的文档/规格、架构事实、runbook 与 ontology 同步，不补写原文未交付的说明。

## 本子计划实施范围

下列归属条目中的事实来源与文档同步；实现代码由关联存活计划承担；独立测试开发不属本计划，原 test 计划已删除，历史事实见删除审计。

## 本子计划验收

文档描述与关联实现/决策一致；原文声明无需修改、受阻、待审或引用失效的事项仍保持原结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature 编辑器与流协议 bugfix 独立；保存后候选即时同步依赖 bugfix 的保存/应用通知修正。docs 仍依赖两者及后续可选 name 裁定；原测试依赖仅作历史说明。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-bugfix-grok-stream-errors.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-18-bugfix-grok-stream-errors.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 验证计划与影响面

- `npm run build`，相关单元、页面测试、真实 CLI/ACP、headless Chromium，ontology 校验。

## 进展与验证结果

- 已使用 memory-recall（focus 为 Grok ACP 与多模型、anchor 为空）和 ontology 核对当前来源；CodeGraph 未索引新增 Grok 文件，已回退直接读取。

- 已同步功能清单、能力说明、CLI runtime reference、ontology 与 Grok runbook。无新架构边界，无需改 `ARCHITECTURE.md`；稳定经验已进入 runbook，不重复追加事件记忆或滚动摘要。

## 追加验收：模型下拉显示字段（2026-10-18）

- 已同步功能清单、能力说明、runtime reference、runbook 与 ontology；ontology 验证仍为前述 15 处既有失效引用，本次未改变 CLI 调用协议或架构边界。

## 追加验收：移除刷新图标并在保存后同步（2026-10-18）

- 已同步能力清单、runtime reference、runbook 与 ontology，Ontology 仍为 15 处既有失效来源引用、无新架构边界，保存时序经验归入 runbook。

## 追加验收：单名称新增弹窗与列表行内删除（2026-10-18）

- ontology 仍为 15 处既有失效引用。

- 已同步功能清单、能力说明、runtime reference、runbook 与 ontology。

## 追加验收：移除可选 name 字段（2026-10-18）

- ontology 仍为 15 处既有失效引用。

- 已同步功能清单、能力说明、runtime reference、runbook 与 ontology。
