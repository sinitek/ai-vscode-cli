# 龙虾剩余轮次预判

- 日期：2026-05-05
- 状态：completed
- 负责人：Codex

## 背景

龙虾模式每轮子任务完成后会唤醒主任务复核，但当前主任务只决定 completed / continue / blocked，没有显式预判还需要多少轮，用户难以判断剩余工作量。

## 目标

要求主任务每次复核时在 JSON 决策中输出 `estimatedRemainingRounds`，扩展解析后写入任务记录、沟通文件和对话中的派发摘要；completed 时应为 0，continue 时表示从当前决策之后预计还需要的主任务复核轮数。

## 范围

- 扩展龙虾主任务 JSON 协议与提示词。
- 解析、归一化并保存 `estimatedRemainingRounds`。
- 在子任务派发摘要和主任务沟通文件中展示预估剩余轮次。
- 同步事实来源文档。

## 非目标

- 不自动根据预估轮次改变调度策略。
- 不强制模型缺少该字段时中断任务；以提示词要求和可选解析为主，避免兼容性问题。

## 验收标准

- [x] 主任务提示词明确要求每次复核输出 `estimatedRemainingRounds`。
- [x] completed 决策记录/展示剩余轮次为 0。
- [x] continue 决策如提供该字段，会写入任务记录并展示在派发摘要/沟通文件。
- [x] 旧决策缺少该字段时仍可继续兼容执行。
- [x] 事实来源文档同步。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`
- 配置与脚本：无

## 风险与缓解

- 风险：模型漏填字段。
- 缓解：解析层兼容缺省；提示词和 JSON 示例强制说明，后续可根据实际稳定性再升级为硬校验。

## 验证计划

- 最小相关验证：TypeScript 编译。
- 扩展验证：人工发起龙虾任务，观察主任务 JSON 与 Markdown 摘要是否出现预计剩余轮次。

## 测试与清单同步

- 单元测试：本次主要为协议字段接线，当前龙虾协议解析仍在扩展闭包中，已以编译验证为主。
- 功能清单：已同步龙虾模式说明。
- 相关文档同步：已同步能力规格与 CLI 运行参考。

## 任务列表

- [x] 定位主任务决策协议与展示记录点。
- [x] 实现剩余轮次字段解析/记录/展示。
- [x] 同步提示词和事实来源文档。
- [x] 运行构建验证。
- [x] 完成后归档执行计划。

## 决策记录

- 2026-05-05：采用可选兼容解析，避免旧协议响应直接导致龙虾任务进入人工复核。

## 当前结论

已完成。主任务提示词和 JSON 示例新增 `estimatedRemainingRounds`；扩展兼容解析该字段，并写入任务记录，在 `main-task.md` 和对话中的子任务派发摘要展示“预计剩余轮次”。验证：`npm run build` 通过。
