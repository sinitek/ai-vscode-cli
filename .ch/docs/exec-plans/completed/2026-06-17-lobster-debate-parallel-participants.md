# Lobster Debate Parallel Participants

- 日期：2026-06-17
- 状态：completed
- 负责人：Codex

## 背景

辩论模式当前在同一发言批次内按参与者串行执行。用户希望在没有直接依赖的情况下尽量并行，提高辩论效率。

## 目标

- 同一发言批次内的动态参与者并行运行，各自只写独立 artifact。
- 最终立场收集也并行运行。
- 主持人仍在本批次所有参与者 artifact 收齐并追加到 `chat.md` 后再控场。
- 提示词明确同批次成员可能并行，参与者只能回应批次开始前已经写入 `chat.md` 的消息。

## 范围

- `src/extension.ts`：调整辩论参与者普通发言和最终立场的调度。
- `.ch/docs/`：同步运行时事实来源和功能说明。
- 测试与验证：现有辩论单测、build、diff 检查。

## 非目标

- 不并行主持人控场、共识汇总或子任务派发决策。
- 不改变 artifact 文件结构。
- 不改变主从子任务并发规划逻辑。

## 验收标准

- [x] 同一发言批次参与者通过 `Promise.all` 并行启动。
- [x] 每个参与者仍只写自己的 artifact，扩展统一追加 `chat.md`，没有并发写 transcript。
- [x] 任一参与者缺 artifact 或追加失败时仍进入 `needs-review`。
- [x] 文档说明并行边界和主持人等待点。
- [x] `npm run build`、辩论单测、`git diff --check` 通过。

## 影响面

- 代码目录：`src/extension.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无

## 风险与缓解

- 风险：同批次参与者无法看到彼此本批次发言。
- 缓解：提示词明确只能回应批次开始前已有消息；主持人在全部发言追加后做交叉汇总和追问。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：`node --test dist/test/lobsterDebate.test.js`、`git diff --check`

## 任务列表

- [x] 复核当前串行调度点
- [x] 实现批次参与者并行运行 helper
- [x] 替换普通发言和最终立场串行循环
- [x] 更新提示词与文档
- [x] 运行验证并归档

## 决策记录

- 2026-06-17：并行边界设为“同一发言批次内参与者”，主持人/共识汇总保持串行依赖。

## 当前结论

已完成。同一发言批次内参与者和最终立场收集改为并行启动，扩展等待全部 artifact 完成后再按清单顺序追加 `chat.md`。验证通过：`npm run build`、`node --test dist/test/lobsterDebate.test.js`、`git diff --check`。
