# 龙虾辩论阻塞共识解析修复

- 日期：2026-06-16
- 状态：completed
- 负责人：Codex / 协作

## 背景

真实 `debate_multi_agent` 任务在第一轮观点收集后进入 `needs-review`：

- 风险审查参与者给出 `block`，原因是实时体育概率分析缺少概率口径、数据时间点和来源约束。
- 共识汇总把“任一默认参与者 artifact 立场为 block”解释为必须 `blocked`。
- 运行时读取共识后又用原始 participant artifact stance 覆盖 consensus 里的 `participantStances`，导致可由子任务解决的风险也无法被共识转为继续执行。

这使辩论模式容易在风险审查者提出可解决前置条件时停住，不能派发“先定义口径/来源，再采集证据”的合理子任务。

## 目标

修复共识汇总和校验语义：

- 未解决的 blocking disagreement 仍然必须阻塞。
- 参与者原始 `block` 如果可以被明确转成前置子任务、验收标准或风险说明，应允许共识把最终 stance 改为 `agree_with_reservations` 并继续。
- 共识读取时保留 consensus 里的最终 stance，只在缺失参与者 stance 时用 artifact stance 补齐。

## 范围

- `src/extension.ts`：调整共识汇总提示词和 stance 合并逻辑。
- `src/test/lobsterDebate.test.ts`：补充已解决风险阻塞可继续的回归测试。
- `.ch/docs/` 事实来源：同步“未解决 block 才阻塞”的规则。

## 非目标

- 不放开真正未解决的阻塞异议。
- 不修改子任务执行器、并发规划器或 Webview UI。
- 不为历史已卡住的任务自动改写产物。

## 验收标准

- [x] 共识汇总提示词不再要求“任一 participant artifact block 必须 blocked”，而是要求区分可解决/未解决阻塞。
- [x] consensus 中明确给出的最终 participant stance 不会被原始 artifact stance 覆盖。
- [x] `validateLobsterDebateConsensus` 仍会阻止最终 stance=block 或 open blocking disagreement。
- [x] `npm run build` 通过。
- [x] `node --test dist/test/lobsterDebate.test.js` 通过。
- [x] 指定 `git diff --check` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/test/lobsterDebate.test.ts`。
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/references/`、`.ch/docs/product-specs/`。
- 配置与脚本：不新增依赖或脚本。

## 风险与缓解

- 风险：共识器可能绕过真正的风险审查。
- 缓解：校验仍要求 final stance 不含 `block`，且 `openDisagreements` 不含 `severity=blocking`；缺失参与者 stance 时仍用 artifact stance 补齐。

- 风险：模型随意把 `block` 改成 `agree_with_reservations`。
- 缓解：提示词要求必须把原始阻塞项写入 `resolvedDisagreements` 并转化为自包含子任务/验收标准/风险说明，否则保持 open blocking。

## 验证计划

- 最小相关验证：`npm run build`、`node --test dist/test/lobsterDebate.test.js`、指定 `git diff --check`。
- 扩展验证：用用户提供的真实产物核对本次根因，确认修复后同类阻塞可由共识器派发口径定义/证据收集类子任务。

## 测试与清单同步

- 单元测试：新增 consensus final stance 已解决后可继续的用例。
- 功能清单：更新阻塞规则描述。
- 相关文档同步：更新设计文档、运行时参考、插件能力规格和运行时设计事实来源。

## 任务列表

- [x] 修复提示词和 stance 合并逻辑。
- [x] 补充回归测试。
- [x] 同步事实来源文档。
- [x] 运行验证并归档计划。

## 决策记录

- 2026-06-16：`participantStances` 在 consensus 中表示共识后的最终立场；participant artifact 的原始 stance 用于补齐缺失项和审计，不应覆盖共识器显式解决后的立场。
- 2026-06-16：真实任务 `msg_1781585957490_ba1d0ff96857b` 的产物显示风险审查原始 `block` 可通过“先定义概率口径/数据时间/来源约束”类前置任务解决；因此不应由提示词强制 blocked。

## 当前结论

修复完成。`npm run build`、`node --test dist/test/lobsterDebate.test.js`（7/7 pass）和指定 `git diff --check` 均通过。
