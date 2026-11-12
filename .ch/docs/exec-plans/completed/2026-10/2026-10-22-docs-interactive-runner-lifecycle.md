# 交互 Runner 生命周期策略化 — 文档

- 日期：2026-10-22
- 状态：completed
- 负责人：协作
- owner：Loop attempt round-1-refactor-interactive-runner-lifecycle
- claimed_at：2026-10-22
- claim_ttl：本次尝试
- handoff_to：无
- 类型：docs

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-22-interactive-runner-lifecycle.md`（历史标识，原文件已替换）
- 关联计划：[行为保持重构](2026-10-22-refactor-interactive-runner-lifecycle.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

只承担“交互 Runner 生命周期策略化”原文明确的文档/规格、架构事实、runbook 与 ontology 同步，不补写原文未交付的说明。

## 本子计划实施范围

下列归属条目中的事实来源与文档同步；实现代码由关联存活计划承担；独立测试开发不属本计划，原 test 计划已删除，历史事实见删除审计。

## 本子计划验收

文档描述与关联实现/决策一致；原文声明无需修改、受阻、待审或引用失效的事项仍保持原结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-22-refactor-interactive-runner-lifecycle.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-22-refactor-interactive-runner-lifecycle.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 背景

- `ARCHITECTURE.md` 引用的 `.ch/docs/design-docs/vscode-cli-extension-runtime.md` 在磁盘上不存在。运行事实以 `.ch/docs/references/cli-runtime-reference.md` 为准，不重建缺失设计文档。

## 范围

- `ARCHITECTURE.md`

- `.ch/docs/references/cli-runtime-reference.md`

## 影响面

- 文档目录：`ARCHITECTURE.md`、`.ch/docs/references/cli-runtime-reference.md`、本计划。

## 测试与清单同步

- 功能清单：用户可见对话、续接、停止和配置行为不变。

- ontology：概念、关系、状态机和 `source_refs` 不因内部策略拆分而变化。

- 相关文档同步：架构说明职责边界、为何用策略而不是继承、新增平台时的修改点。

## 任务列表

- 同步文档

## 复核修复（2026-10-22）

- 没有为此运行 ontology validate。
