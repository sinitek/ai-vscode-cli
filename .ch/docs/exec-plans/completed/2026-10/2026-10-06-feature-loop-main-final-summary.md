# Loop 系列主任务最终总结气泡 — 新功能开发

- 日期：2026-10-06
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-06
- claim_ttl：本轮任务完成前
- handoff_to：
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-06-loop-main-final-summary.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-06-docs-loop-main-final-summary.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

为 Loop+ 主任务新增独立、可持久化的最终总结气泡。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-06-feature-loop-main-final-summary.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- 经典 Loop 已在主任务对话追加问题结论和最终总结；Loop+ 完成路径目前只追加带群聊入口的系统消息，最终总结只在群聊投影中可见。

## 目标

- Loop、Loop+ 任务完成后，主任务 AI 对话最后追加独立的 assistant 最终完成气泡，并展示主任务生成的任务总结；消息可持久化、可恢复且不能与普通 assistant 流合并。

## 范围

- 补齐 Loop+ 完成路径的主任务 assistant 完成消息。

- 保持经典 Loop 现有最终总结消息契约。

## 非目标

- 不改变 Loop/Loop+ 调度、验收、子任务执行或群聊布局。

- 不新增模型调用；总结继续使用主任务/summary 节点已有产物。

- 不改变普通 Vibe 对话的最终回答渲染。

## 验收标准

- [x] 经典 Loop 完成后主任务对话保留独立最终完成总结气泡。

- [x] Loop+ 完成后主任务对话追加问题结论和最终任务总结气泡，刷新/恢复后仍存在。

- [x] 最终总结消息带专用元数据，不被普通 assistant 消息合并，并使用现有最终气泡样式。

- [x] 相关单测、`npm run build`、完整套件保留既有基线失败记录。

## 影响面

- 代码目录：`src/extension.ts`、`src/extensionHost/promptRunRuntime.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`。

- 配置与脚本：无。

## 风险与缓解

- 风险：Loop+ 完成时任务记录尚未刷新，生成的总结缺少本轮 `finalSummary`。

- 缓解：在完成状态持久化成功后重新读取任务，再追加主任务消息；追加失败不改变已完成状态。

- 风险：历史恢复重复追加完成气泡。

- 缓解：复用现有 `loopTaskId`/`loopFinalSummary` 幂等检查和完成消息诊断。

- 风险：修改群聊完成消息顺序导致已有投影重复。

- 缓解：保留原系统完成消息和群聊 transcript，只在主任务 target 追加 assistant 消息。

## 验证计划

- 最小相关验证：Loop+ orchestration/runtime integration、Loop final summary、Webview final summary contract。

- 单元自测命令：`npm run build`；相关 `dist/test/...` 定向测试；`git diff --check`。

- 扩展验证：检查主任务消息持久化与恢复契约；真实 VS Code/CLI 场景若不可运行则记录限制。

## 测试与清单同步

- 单元自测结果：Loop+ 定向测试 `18/18` 通过；`npm run build` 通过；Ontology 校验通过；`git diff --check` 通过。

- 失败处理记录：完整 `npm test` 为 `1428` 通过、`23` 失败；失败集中在本次未修改的 CLI、Webview 和 Loop+ 群聊覆盖测试，未命中新增主任务完成消息测试，保留为既有基线问题。

- 不更新长期记忆热区。

## 任务列表

- Tasklist:

- [completed] 确认三种模式的完成事件与消息渲染链路

- [completed] 补齐 Loop+ 主任务最终总结气泡

- [completed] 执行构建、定向测试与差异校验

## 决策记录

- 2026-10-06：复用现有 `appendLoopAnswerConclusionMessage` 与 `appendLoopFinalSummaryMessage`，不新增模型调用或新的消息类型；Loop+ 完成后在主任务 target 追加与经典 Loop 相同的两条最终 assistant 消息。
