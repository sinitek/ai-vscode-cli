# Loop最大轮次工具设置

- 日期：2026-05-05
- 状态：completed
- 负责人：Codex
- 类型：feature
- 迁移来源：`.ch/docs/exec-plans/completed/2026-05/2026-05-05-loop-max-rounds-setting.md`

## 关联计划

- [docs：Loop最大轮次工具设置——文档同步](2026-05-05-docs-loop-max-rounds-setting-documentation.md)

## 迁移说明

2026-11-11 按实际工作类型拆分。日期、负责人及状态沿用原文；下列命令和结果均为历史记录，本次迁移不执行历史命令，也不新增验收结论。

## 背景

Loop模式当前最大主任务复核轮次固定为 20。用户希望在“工具设置”中允许配置该上限，以便不同任务按复杂度调整自动推进轮次。

## 目标

在聊天面板工具设置中新增“Loop最大轮次”数字设置，默认 20；新建Loop任务时读取该配置写入任务记录 `maxRounds`，现有任务记录继续沿用已有 `maxRounds`。

## 范围

- 新增项目级 workspace settings 字段。
- 新增 webview 工具设置控件、状态同步与中英文文案。
- 新建Loop任务时使用配置值。

## 非目标

- 不修改已存在Loop任务的 `maxRounds`。
- 不新增 VS Code package configuration 项。
- 不改变Loop轮次语义，仍按主任务复核轮计数。

## 验收标准

- [x] 工具设置显示“Loop最大轮次 / Loop Max Rounds”数字输入。
- [x] 默认值为 20，非法值自动回落到安全范围。
- [x] 新建Loop任务记录中的 `maxRounds` 使用工具设置值。
- [x] 面板状态刷新后控件保持保存值。
- [x] 中英文文案
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/types.ts`、`src/webview/viewContent.ts`
- 配置与脚本：无新增依赖

## 风险与缓解

- 风险：设置过小导致任务过早进入人工复核。
- 缓解：限制最小值为 1，并在控件中显示默认/范围语义。

## 验证计划

- 最小相关验证：TypeScript 编译。
- 扩展验证：人工打开工具设置修改轮次，发起新Loop任务后检查 `loop-tasks.json` 中 `maxRounds`。

## 测试与清单同步

- 单元测试：本次为 UI 状态与配置接线，当前未抽出独立纯函数测试入口；已完成编译验证

## 任务列表

- [x] 定位固定轮次常量与工具设置链路。
- [x] 实现设置字段、UI 控件与状态同步。
- [x] 同步文案
- [x] 运行构建验证。
- [x] 完成后归档执行计划。

## 决策记录

- 2026-05-05：采用项目级 workspace settings，避免新增全局 VS Code 配置；默认值保持 20。

## 当前结论

已完成。工具设置新增“Loop最大轮次”数字输入，项目级保存到 workspace settings；新建Loop任务会把保存值写入任务记录 `maxRounds`，现有任务继续沿用记录值。验证：`npm run build` 通过。
