# 通知设置闪烁开关与文案精简

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：feature

## 背景与目标

已有任务完成、人机交互的系统通知与窗口提醒配置，但工具设置只展示系统通知。补齐既有闪烁开关，精简冗长的说明。

## 范围与非目标

- 复用两类 `WindowAttention` 应用级配置，默认开启，独立于系统通知，保留已有用户设置。
- 打通工具设置的读取、全局保存、回显和失败恢复；精简说明，仅显示当前平台的操作提示。
- 不改变原生通知投递、授权流程、后台提醒触发规则，不新增依赖。

- 本计划仅承担 Webview/面板状态/消息保存协议与设置页提示；产品/ontology 事实文档原由已退役 docs companion 承接（仅历史分工）。已完成测试开发的历史证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-notification-attention-settings.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。

## 验收标准

- 工具设置 → 通知设置可以分别控制任务完成、人机交互的图标闪烁。
- 缺省开启，保存全局配置，立即生效；已有关闭选择不被覆盖。
- 关闭闪烁不影响系统通知；关闭系统通知不影响闪烁；保存失败回显实际配置。
- 通知说明简明，系统授权与刷新入口保留，平台说明不混杂。

## 影响面、风险与缓解

- 生产：Webview、面板状态与消息保存协议，复用现有提醒控制器和两类 WindowAttention 配置。
- 风险：回显不完整或通知/闪烁耦合；历史保存、恢复与控制器断言见上述来源审计。
- 回滚仅撤回设置页/消息新增项，既有配置与原生提醒实现不变。

## 任务列表与当前状态

- [completed] 确认通知链路与设置入口。
- [completed] 添加闪烁开关并精简当前平台文案，保留授权与刷新入口。
- completed 不代表 Windows 原生视觉已验收。

## 验证计划与历史结果

原构建通过、125+226项相关回归及五场景离线 Chromium 通过；命令、Playwright/脚本拼装失败与平台限制按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-notification-attention-settings.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，文档/ontology 校验原指向 docs companion（已退役，完整记录未恢复）。未运行全量单测；当前 macOS 不能实测 Windows 原生任务栏闪烁，仍需 Windows 本机验收。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留通知与闪烁独立设置回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-notification-attention-settings.md`；不再作为现行测试责任。
- 历史文档分工：通知闪烁开关功能规格与本体同步，共享本来源的历史背景与接口。 原 docs companion `2026-11-05-docs-notification-attention-settings.md#背景与目标` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
