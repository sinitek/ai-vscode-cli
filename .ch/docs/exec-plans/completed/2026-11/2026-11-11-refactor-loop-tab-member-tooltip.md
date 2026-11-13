# Loop/Loop+ Tab 悬停复用群聊成员标题 — refactor

- 日期：2026-11-11
- 状态：completed
- 类型：refactor
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-tab-member-tooltip.md`

## 目标与范围

将群聊共用格式与身份解析原样下沉到src/loopConversationPresentation.ts，并保留panelStateBuilder兼容重导出。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-11-feature-loop-tab-member-tooltip.md](2026-11-11-feature-loop-tab-member-tooltip.md)：承接产品实现及其决策/约束。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- 历史文档分工：文档/事实源交付及其历史校验。 原 docs companion `2026-11-11-docs-loop-tab-member-tooltip.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- 既有调用行为不变，Tab宿主可独立加载而不引入vscode；不是新功能或性能承诺。
- 另拆refactor记录共用格式/身份解析原样下沉轻量模块及兼容重导出；原主任务禁用结论已被main-summary修复纠正，不掩盖错误。366通过、4基线失败和payload夹具失败保留。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文；原 docs companion 已退役，其完整记录未恢复；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-tab-member-tooltip.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 当前进展

- 扩大验证时发现直接依赖 `panelStateBuilder` 会将 `vscode` 带入原本可独立加载的 Tab 宿主；已将共用格式与身份解析原样下沉到轻量模块，旧导出兼容保留。属于本次实现缺陷，修复后相关会话测试恢复通过。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。另拆refactor记录共用格式/身份解析原样下沉轻量模块及兼容重导出；原主任务禁用结论已被main-summary修复纠正，不掩盖错误。366通过、4基线失败和payload夹具失败保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
