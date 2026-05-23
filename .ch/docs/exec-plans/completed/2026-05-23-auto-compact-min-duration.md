# 自动上下文压缩最小时长门槛

- 日期：2026-05-23
- 状态：completed
- 负责人：Codex

## 背景

当前“执行后自动压缩上下文”在已有 Codex / Claude / Gemini 会话任务成功结束后都会触发。用户要求优化为：只有任务执行时间超过 5 分钟，才需要做自动上下文压缩，减少短任务后的无效压缩和额外等待。

## 目标

为执行后自动上下文压缩增加 5 分钟最小时长门槛：任务必须成功结束、目标为已有会话、开关已开启，且原任务耗时超过 5 分钟，才触发自动压缩。

## 范围

- 调整 `src/extension.ts` 的自动压缩触发条件
- 同步聊天面板工具设置中英文提示
- 更新 `.ch/docs/` 中相关事实来源

## 非目标

- 不改变手动“常用命令 -> 压缩上下文”行为
- 不新增用户可配置的分钟数
- 不改变任务中断或报错不触发自动压缩的规则

## 验收标准

- [x] 小于或等于 5 分钟的成功任务不触发执行后自动压缩
- [x] 超过 5 分钟的成功任务在满足已有会话和开关开启条件时触发执行后自动压缩
- [x] 任务中断或报错仍不触发自动压缩
- [x] UI 文案和事实来源文档体现 5 分钟门槛

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/design-docs/`
- 配置与脚本：无

## 风险与缓解

- 风险：不同运行路径计算耗时方式不一致，导致某些 CLI 分支漏触发或误触发
- 缓解：将最小时长判断集中在统一的 `maybeAutoCompactContextAfterPromptSuccess()`，各成功路径只传入原任务 `durationMs`

## 验证计划

- 最小相关验证：执行 `npm run build`
- 扩展验证：静态检查 Gemini one-shot / Gemini parallel / Codex Claude interactive 三条成功路径都传入原任务耗时

## 测试与清单同步

- 单元测试：当前改动为运行编排条件调整，先以构建和静态检查验证
- 功能清单：同步 `FEATURE_INVENTORY.md`
- 相关文档同步：同步 runtime / capability / reference 文档

## 任务列表

- [x] 建立执行计划并确认触发点
- [x] 修改自动压缩最小时长判断
- [x] 同步 UI 文案和事实来源文档
- [x] 完成构建验证并归档计划

## 决策记录

- 2026-05-23：最小时长门槛固定为 5 分钟，按原任务成功完成时记录的 `durationMs` 判断；必须严格大于 5 分钟才触发自动压缩
- 2026-05-23：门槛判断集中在 `maybeAutoCompactContextAfterPromptSuccess()`；Gemini one-shot、Gemini parallel、Codex/Claude interactive 三条成功路径只传入原任务耗时

## 当前结论

已完成实现与同步。当前行为为：执行后自动压缩仍默认关闭；开启后，仅在已有 Codex/Claude/Gemini 会话任务成功结束且原任务耗时严格超过 5 分钟时触发。任务中断、报错、无会话或耗时小于等于 5 分钟都不触发。`npm run build` 通过。
