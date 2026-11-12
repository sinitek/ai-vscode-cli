# Loop/Loop+ Tab 悬停复用群聊成员标题 — 文档与事实源交付

- 日期：2026-11-11
- 状态：completed
- 类型：docs
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-tab-member-tooltip.md`

## 目标与范围

功能清单、能力规格、运行时设计及成员标题ontology。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-11-feature-loop-tab-member-tooltip.md](2026-11-11-feature-loop-tab-member-tooltip.md)：承接产品实现及其决策/约束。
- [2026-11-11-refactor-loop-tab-member-tooltip.md](2026-11-11-refactor-loop-tab-member-tooltip.md)：独立承接将群聊共用格式与身份解析原样下沉到src/loopConversationPresentation.ts，并保留panelStateBuilder兼容重导出。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。

## 验收标准

- 完成以下实际文档交付：功能清单、能力规格、运行时设计及成员标题ontology；记录与实现、测试证据一致，不把文档门禁当作功能或真实环境验收。
- 另拆refactor记录共用格式/身份解析原样下沉轻量模块及兼容重导出；原主任务禁用结论已被main-summary修复纠正，不掩盖错误。366通过、4基线失败和payload夹具失败保留。

## 验证与真实状态

验证计划：复用原文档/ontology/引用/空白检查记录；没有原文成功证据的检查不补造。原计划记录的 ontology 校验及范围空白/差异检查通过；独立测试开发已移除，其审计保留的历史测试摘要、结果与边界见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-tab-member-tooltip.md）。功能/页面行为历史验证按关联计划中的存活实现记录追溯；本 docs 计划及删除审计均不构成现行 test 验证入口。本次不重新执行。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 影响面与风险

- 文档：功能清单、运行时设计、能力规格与 ontology。

### 验证计划

- ontology 完整性与 `git diff --check`。

### 测试与清单同步

- 静态验证：ontology 校验通过（2 domains / 17 concepts / 16 relations / 127 rules / 2 workflows）；`git diff --check` 通过；宿主改动的 UI 机械检测结果为空数组。
- 功能清单与设计/ontology：已同步 `FEATURE_INVENTORY.md`、能力分册、运行时设计及 `cli-plugin-runtime.json`；架构和运维边界不变，无需修改总架构或运行手册。
- 未验证：未做真实 CLI/provider 调用或完整 VS Code Extension Development Host 端到端；本次不改变 CLI 协议与执行行为，不运行发布脚本。
- 记忆判断：单次局部行为变更由规格与本计划承接，不新增热区或事件记忆。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。另拆refactor记录共用格式/身份解析原样下沉轻量模块及兼容重导出；原主任务禁用结论已被main-summary修复纠正，不掩盖错误。366通过、4基线失败和payload夹具失败保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
