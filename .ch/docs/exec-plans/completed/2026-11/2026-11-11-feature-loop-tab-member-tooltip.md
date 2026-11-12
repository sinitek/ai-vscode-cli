# Loop/Loop+ Tab 悬停复用群聊成员标题 — feature

- 日期：2026-11-11
- 状态：completed
- 类型：feature
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-tab-member-tooltip.md`

## 目标与范围

新增Loop成员标题投影和子任务摘要调用门禁，保留后来主任务恢复的纠正事实。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-11-refactor-loop-tab-member-tooltip.md](2026-11-11-refactor-loop-tab-member-tooltip.md)：独立承接将群聊共用格式与身份解析原样下沉到src/loopConversationPresentation.ts，并保留panelStateBuilder兼容重导出。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- [2026-11-11-docs-loop-tab-member-tooltip.md](2026-11-11-docs-loop-tab-member-tooltip.md)：独立承接文档/事实源交付及其历史校验。

## 验收标准

- 新增Loop成员标题投影和子任务摘要调用门禁，保留后来主任务恢复的纠正事实；原可观察契约、非目标和限制以以下分配的原文为准。
- 另拆refactor记录共用格式/身份解析原样下沉轻量模块及兼容重导出；原主任务禁用结论已被main-summary修复纠正，不掩盖错误。366通过、4基线失败和payload夹具失败保留。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文或关联 docs 计划；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-tab-member-tooltip.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 来源头部说明

> 后续纠正：用户明确只有子任务复用群聊成员标题，主任务仍需 AI 摘要；本计划中的主任务角色名投影和主任务摘要禁用结论已被 [2026-11-11-bugfix-loop-main-tab-summary-fix.md](2026-11-11-bugfix-loop-main-tab-summary-fix.md) 替代。

### 背景与目标

Vibe 继续使用现有异步 AI 摘要；Loop/Loop+ Tab 悬停改为群聊成员标题，子任务例如“子任务 517：恢复SpreadJS本体源码构建与前端接入路线”。

### 范围与非目标

- 仅调整宿主的 Tab 提示投影与 Loop 摘要触发，复用群聊现有标题格式和子任务身份解析。
- 不改变浮层样式、现有停留时长、Tab 布局、任务调度、会话存储；保留工作区已有改动。

### 验收标准

- Vibe 摘要生成、恢复和悬停行为不变。
- Loop/Loop+ 主任务提示为“主任务”，子任务提示的编号和完整标题与群聊一致，不受 AI 摘要 30 码点限制。
- 子任务按当前 Tab 的任务、子任务身份定位；缺少对应记录时不显示错误的旧摘要，不串 Tab。
- Loop 已知任务不再额外调用 AI 生成摘要。

### 影响面与风险

- 功能代码：`src/extensionHost/sessionTabs.ts`和`src/extension.ts`。`src/loopConversationPresentation.ts`与`src/panelStateBuilder.ts`兼容导出的行为保持抽取独立由关联refactor计划承接；会话摘要、宿主投影和浮层测试曾由独立 test 类型计划承接；该计划已移除，历史证据摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-tab-member-tooltip.md）。
- 风险：继续执行、历史会话及缺失元信息导致身份不完整；使用现有消息身份解析并核对任务 ID，必要时用持久化的 CLI/session 绑定定位，不能回退到别的成员。
- 回滚：仅撤销本次局部投影与 Loop 摘要触发门禁，不触及其他未提交改动。

### 当前进展

- 已核对 CodeGraph、现有源码和 ontology；确认群聊共用 `getLoopSubtaskDisplayTitle` 与 `getLoopMainSubChatMainTitle`。
- 已实现投影与触发门禁，新增成功/边界/拒绝/历史恢复/跨 CLI/共用 session 不猜测及宿主集成回归。
- 最终结论：验收标准满足，相关验证完成并归档；保留工作区原有改动，不提交、不发布。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。另拆refactor记录共用格式/身份解析原样下沉轻量模块及兼容重导出；原主任务禁用结论已被main-summary修复纠正，不掩盖错误。366通过、4基线失败和payload夹具失败保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。

## 后续纠正关联

主任务摘要禁用与固定角色名投影不是当前正确行为，已由[2026-11-11-bugfix-loop-main-tab-summary-fix.md](2026-11-11-bugfix-loop-main-tab-summary-fix.md)纠正；保留本计划当时的错误结论及验证范围，不将旧366项通过表述为证明该需求理解正确。
