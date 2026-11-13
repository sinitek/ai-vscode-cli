# AI 对话 Tab 成功结束后错误状态残留修复

- 日期：2026-11-11
- 状态：completed
- 类型：bugfix
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-chat-tab-completion-status.md`

## 目标与范围

修复成功终态被迟到trace/system/重试消息重新标红，下一轮释放保护。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- 历史文档分工：文档/事实源交付及其历史校验。 原 docs companion `2026-11-11-docs-chat-tab-completion-status.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- 修复成功终态被迟到trace/system/重试消息重新标红，下一轮释放保护；原可观察契约、非目标和限制以以下分配的原文为准。
- 既有用户Tab残留错误背景支持bugfix；3红灯、13范围外气泡失败/并发dist缺失、最终隔离229与54浏览器断言保留。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文；原 docs companion 已退役，其完整记录未恢复；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-chat-tab-completion-status.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 背景与目标

Tab 的 `runStatus:end` 会清除错误，但随后到达的 trace/system 错误以及自动重试排队消息会再次将空闲 Tab 标红。为每个 Tab 保留本轮成功终态，避免消息内容覆盖明确的成功结果。

### 验收标准

- 前台与后台 Tab 成功后，迟到的 appendMessage、replaceMessage、traceSegment 和重试排队消息不再标红。
- 新用户消息、新运行与会话重置释放上一轮成功保护；明确 `runStatus:error` 仍显示失败，未运行过的空闲错误仍可见。
- Tab 状态互不污染；相关单测、构建和真实 Chromium Webview 验证通过。

### 影响面与风险

- `src/webview/viewContentScript/` 与 `src/test/webview/tabRunStatus.test.ts`。
- 风险：成功保护影响下一轮错误展示；以新用户消息、新运行、重置和明确失败用例约束。字段仅在 Webview 内存保存，不迁移会话文件，回滚对应局部改动即可。

### 验证计划

- ontology 校验与相关 Python 测试、`git diff --check`。

### 进度与验证记录

- 已完成 CodeGraph 定位尝试并核对当前源码；图谱未有效返回模板字符串内部函数，按函数行范围直接读取。
- 已核对 ontology 与运行时状态规则；召回焦点为对话标签完成后错误状态，anchor 为空。召回无本次专属 active plan。

### 当前结论

成功终态不再被迟到的非终态错误消息覆盖，真实失败和下一轮任务仍可正常展示错误。无需新增配置、修改 CLI 协议或迁移磁盘数据；Linux/macOS/Windows 共用纯 Webview JavaScript 路径，无平台专有实现。未执行发布脚本、未安装依赖、未改动其他任务的代码。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。既有用户Tab残留错误背景支持bugfix；3红灯、13范围外气泡失败/并发dist缺失、最终隔离229与54浏览器断言保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
