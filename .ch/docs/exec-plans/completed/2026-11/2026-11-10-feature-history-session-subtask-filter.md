# 历史会话子任务过滤

- 日期：2026-11-10
- 状态：completed
- 类型：feature
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-10-history-session-subtask-filter.md`

## 目标与范围

新增默认开启且当前Webview内保存的历史会话子任务过滤。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- [2026-11-10-docs-history-session-subtask-filter.md](2026-11-10-docs-history-session-subtask-filter.md)：独立承接文档/事实源交付及其历史校验。

## 验收标准

- 新增默认开启且当前Webview内保存的历史会话子任务过滤；原可观察契约、非目标和限制以以下分配的原文为准。
- 复用既有taskRole而非新增存储身份；186测试与960/390浏览器、非持久化选择和旧会话边界保留。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文或关联 docs 计划；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-10-history-session-subtask-filter.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 目标与范围

在“历史记录 → 历史会话”增加默认勾选的“过滤子任务”，勾选隐藏 `taskRole=subtask` 的会话，取消勾选恢复展示；复用现有主题与复选框样式，兼容搜索与旧会话。

非目标：不改变任务识别、历史存储、历史提示词、加载、导出或删除行为；不新增全局设置。

### 验收标准

- 首次初始化默认勾选；仅隐藏子任务，保留主任务、普通会话和未标记的旧会话。
- 切换立即刷新，与关键词搜索叠加；过滤后为空时展示无匹配提示。
- 开关只在历史会话页展示，切换历史页签或重新打开弹窗保持当前 Webview 内的选择。
- 完成构建、相关回归、浏览器验证及功能清单与 ontology 同步。

### 影响面与风险

- 代码：`src/webview/viewContentHtml.ts`、`src/webview/viewContentStrings.ts`、`src/webview/viewContentScript/`；`src/test/webview/`的测试开发曾分配至独立 test 类型计划；该计划已移除，历史证据摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-10-history-session-subtask-filter.md）。
- 风险：默认过滤可能被误认为数据丢失；提供可撤销开关与准确空态，不修改原始列表。
- 回滚：撤回新增复选框与前端过滤，无数据迁移。

### 验证计划

- `npm run build`
- Headless Chromium 使用合成会话验证默认值、切换、搜索、页签隔离、空态与窄屏布局。
- 浏览器工具仅在 `/tmp/zq-playwright-smoke` 安装 skill 固定的 `playwright@1.61.1`，复用本机 Chromium，不更改项目依赖。

### 实施结论

已确认 `SessionSummary.taskRole` 是现有历史会话子任务标识，前端复用该字段，不重复推断任务身份。开关仅保持在当前 Webview 内，重新初始化默认勾选，不新增持久化偏好。

已完成默认过滤、即时切换、搜索叠加与准确空态；复用现有主题和工具栏样式，未引入新依赖或平台相关路径。

### 验证结果

- `npm run build`：通过。
- 未运行完整单测、真实 CLI 或 Extension Development Host：此次仅本地列表展示过滤，已用实际编译 Webview 和合成宿主消息做 Chromium 验证；真实 CLI 及存储路径未改动。未在 Windows/Linux 实机验证，新增逻辑无平台相关 API。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。复用既有taskRole而非新增存储身份；186测试与960/390浏览器、非持久化选择和旧会话边界保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
