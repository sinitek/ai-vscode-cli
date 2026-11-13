# 向主模型提问弹窗留白与忙碌提示

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：bugfix

## 背景与目标

修复用户 Markdown 气泡尾部的额外留白；主模型执行任务时禁用发送，并在发送按钮左侧显示主题语义红色说明“主模型忙，正在处理任务，请稍后”，不新增聊天气泡。保留输入草稿、历史气泡、回答等待与中止功能，不改变调度和提问持久化格式。

既有提问入口的可见缺陷与忙碌拒绝边界修复，沿用 bugfix 分类；原文未给发布版本，本迁移不补造版本或发布记录。

## 范围与非目标

- 仅 `src/panelDiagnostics.ts`、`src/webview/loopGroupChatPanel*.ts` 的气泡样式、主模型 Tab 忙碌初始状态与局部补丁、前后端发送守卫。
- 本计划仅实现缺陷修复，不承担历史回归开发；其历史证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loop-ask-dialog-busy.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。功能清单与已有 ontology 规则同步原由已退役 docs companion 独立承接（仅历史分工）；不改变持久化或调度。
- 保留工作区已有模型导入改动，不改范围外文件。

## 验收标准

- 单行用户气泡没有额外换行留白，多段及代码内容仍可正常展示。
- 主模型忙碌时按钮禁用，点击和 Ctrl/⌘+Enter 均不能提交，草稿不丢失。
- 忙碌说明位于发送按钮左侧，不写入聊天记录；空闲后自动恢复。
- 宿主再次校验忙碌状态，拒绝过期页面发来的请求，不启动提问或新增气泡。
- 正常提问、回答等待、中止和弹窗重开不回归。

## 风险与缓解

任务整体运行不等于主模型忙碌；以实际主模型 Tab 的运行状态为准。自身回答中仍显示等待动画，不误报为其他任务占用。

## 任务列表与当前结论

用户气泡 `white-space: pre-wrap` 覆盖通用 Markdown 样式，保留了 Markdown 生成 HTML 尾部换行；已改为正常 Markdown 空白处理并收紧首尾块边距。新增主模型 Tab 忙碌状态的初始展示和局部补丁同步，客户端与宿主双重限制发送。按用户修订采用按钮左侧说明，不采用气泡提示；保留草稿、历史、等待和中止行为。

- [x] 正常 Markdown 空白处理与首尾边距修复。
- [x] 按钮左侧说明、草稿保留与客户端/宿主双重限制；不采用新气泡。

## 验证计划与历史结果

历史验证为构建、七文件 79 项单测和真实生成 Webview HTML 的离线 Chromium；命令、0px 实测、截图与夹具/并发失败处理仅作审计记录，按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loop-ask-dialog-busy.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。未调用真实 CLI、未修改用户配置、未启动 Extension Development Host。

## 当前状态

既有弹窗修复完成，原 completed 保留；文档交付不再列为本计划任务。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留主模型提问忙碌与留白回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loop-ask-dialog-busy.md`；不再作为现行测试开发责任。
- 历史文档分工：主模型提问忙碌规则与功能清单同步，共享本来源的历史背景与接口。 原 docs companion `2026-11-05-docs-loop-ask-dialog-busy.md#背景与目标` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
