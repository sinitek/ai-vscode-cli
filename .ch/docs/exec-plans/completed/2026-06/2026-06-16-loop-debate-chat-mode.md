# Loop辩论群聊式编排优化

- 日期：2026-06-16
- 状态：completed
- 负责人：Codex

## 背景

现有 `debate_multi_agent` 已经能启动多个参与者并做共识汇总，但参与者主要是并发独立写观点，运行形态更接近“多份评审报告 + 汇总器”，不像用户预期的多个角色在同一个模拟群聊里互相沟通。真实测试中也暴露出风险角色阻塞后体验不佳，需要让角色能看到彼此观点、回应分歧，并用明确边界防止无限循环。

## 目标

把辩论模式改成受控群聊式编排：每个Loop主任务复核轮生成共享 `chat.md` transcript，4 个默认角色按固定顺序进行有限轮发言，后续角色可以读取和回应前文，最后由共识汇总器基于完整群聊记录生成现有 `LoopMainDecision`。

## 范围

- `src/loopDebate.ts`：新增群聊 transcript 路径和参与者回合 artifact 路径纯函数。
- `src/extension.ts`：重构 `runLoopDebateRound` 的参与者阶段，生成共享 `chat.md`，固定两轮轮流发言，第二轮输出最终立场。
- `src/test/loopDebate.test.ts`：补充路径和防循环边界相关纯函数验证。
- `.ch/docs/design-docs/`、`.ch/docs/references/`、`.ch/docs/product-specs/`：同步真实行为。

## 非目标

- 不改顶层 `interactiveMode` 和 UI 下拉枚举。
- 不重写子任务执行、批次并发、重试、最终总结链路。
- 不让辩论参与者修改仓库业务文件。
- 不引入可配置的任意辩论轮数，先固定硬边界，避免无限循环。

## 验收标准

- [x] `debate_multi_agent` 每轮生成 `chat.md`，并把每个角色发言按顺序追加到 transcript。
- [x] 参与者第二轮必须读取 transcript、回应前文并写最终 `## 立场`，共识汇总读取 `chat.md`、最终 participant artifacts 和 brief。
- [x] 运行时最多执行固定两轮角色发言，不根据模型输出继续追加回合。
- [x] 恢复任务时只有完整 `chat.md`、最终 participant artifacts、`cross-review.md`、`consensus.md`、`decision.json` 均有效才复用旧决策，否则重跑当前辩论轮。
- [x] `npm run build` 和相关 Node 单测通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/loopDebate.ts`、`src/test/loopDebate.test.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/references/`、`.ch/docs/product-specs/`
- 配置与脚本：无新增配置

## 风险与缓解

- 风险：轮流发言比并发观点更慢。
- 缓解：固定 4 个默认角色、固定 2 轮，不开放无限循环。
- 风险：旧辩论产物缺少 `chat.md` 被误复用。
- 缓解：恢复复用校验新增 transcript 完整性要求。
- 风险：角色最终立场缺失导致共识不可靠。
- 缓解：只校验第二轮最终 artifacts，缺失或不可解析时进入 `needs-review`。

## 验证计划

- 最小相关验证：`node --test dist/test/loopDebate.test.js`，8/8 通过。
- 扩展验证：`npm run build` 通过；`git diff --check` 通过。

## 测试与清单同步

- 单元测试：补充 chat transcript 路径、参与者 turn artifact 路径、最大发言轮数常量验证。
- 功能清单：更新 `FEATURE_INVENTORY.md`。
- 相关文档同步：更新设计文档、运行时 reference、能力规格。

## 任务列表

- [x] 复核现有辩论实现与文档状态。
- [x] 新增群聊 transcript 纯函数与测试。
- [x] 重构运行时为固定两轮轮流发言。
- [x] 更新提示词、恢复复用校验和状态消息。
- [x] 同步事实来源文档。
- [x] 构建和单测验证。
- [x] 归档执行计划。

## 决策记录

- 2026-06-16：采用共享 `chat.md` + 4 角色固定顺序 + 固定 2 轮发言。第二轮产物作为最终 participant artifact，保留现有共识校验和 `decision.json` 接入链路。

## 当前结论

已完成：辩论模式改为共享 `chat.md` 的固定两轮群聊式编排，恢复校验会拒绝缺少完整 transcript 的旧产物。构建、相关单测和空白检查均通过。
