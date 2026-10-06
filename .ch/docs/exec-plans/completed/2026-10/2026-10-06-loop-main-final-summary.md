# Loop 系列主任务最终总结气泡

- 日期：2026-10-06
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-06
- claim_ttl：本轮任务完成前
- handoff_to：

## 背景

经典 Loop 已在主任务对话追加问题结论和最终总结，Graph 已在主 Graph tab 追加最终总结；Loop+ 完成路径目前只追加带群聊入口的系统消息，最终总结只在群聊投影中可见。

## 目标

Loop、Loop+、Graph 任务完成后，主任务 AI 对话最后追加独立的 assistant 最终完成气泡，并展示主任务生成的任务总结；消息可持久化、可恢复且不能与普通 assistant 流合并。

## 范围

- 补齐 Loop+ 完成路径的主任务 assistant 完成消息。
- 保持经典 Loop 与 Graph 现有最终总结消息契约，并补充跨模式回归覆盖。
- 同步用户可见功能清单、运行时设计和 Ontology 事实。

## 非目标

- 不改变 Loop/Loop+/Graph 调度、验收、子任务执行或群聊布局。
- 不新增模型调用；总结继续使用主任务/summary 节点已有产物。
- 不改变普通 Vibe 对话的最终回答渲染。

## 验收标准

- [x] 经典 Loop 完成后主任务对话保留独立最终完成总结气泡。
- [x] Loop+ 完成后主任务对话追加问题结论和最终任务总结气泡，刷新/恢复后仍存在。
- [x] Graph 完成后主任务对话追加 Graph 最终总结气泡，群聊/运行图现有展示不重复或回归。
- [x] 最终总结消息带专用元数据，不被普通 assistant 消息合并，并使用现有最终气泡样式。
- [x] 相关单测、`npm run build`、Ontology 校验和差异检查完成；完整套件保留既有基线失败记录。

## 影响面

- 代码目录：`src/extension.ts`、`src/extensionHost/promptRunRuntime.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extensionHost/graphRuntime.ts`、`src/extensionHost/graphMessages.ts`。
- 测试目录：`src/test/extensionHost/`、`src/test/graph/`、`src/test/loop/`、`src/test/webview/`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`.ch/docs/ontology/`、`docs/插件功能清单.md`。
- 配置与脚本：无。

## 风险与缓解

- 风险：Loop+ 完成时任务记录尚未刷新，生成的总结缺少本轮 `finalSummary`。
- 缓解：在完成状态持久化成功后重新读取任务，再追加主任务消息；追加失败不改变已完成状态。
- 风险：历史恢复重复追加完成气泡。
- 缓解：复用现有 `loopTaskId`/`loopFinalSummary` 幂等检查和完成消息诊断。
- 风险：修改群聊完成消息顺序导致已有投影重复。
- 缓解：保留原系统完成消息和群聊 transcript，只在主任务 target 追加 assistant 消息。

## 验证计划

- 最小相关验证：Loop+ orchestration/runtime integration、Loop final summary、Graph runtime、Webview final summary contract。
- 单元自测命令：`npm run build`；相关 `dist/test/...` 定向测试；`git diff --check`。
- 扩展验证：检查主任务消息持久化与恢复契约；真实 VS Code/CLI 场景若不可运行则记录限制。

## 测试与清单同步

- 单元测试新增/更新：`loopPlusEntryRouting.test.ts` 增加完成回调 wiring 契约；`loopPlusRuntimeIntegration.test.ts` 增加主任务完成消息持久化回归。
- 单元自测结果：Loop+ 定向测试 `18/18` 通过；`npm run build` 通过；Ontology 校验通过；`git diff --check` 通过。
- 失败处理记录：完整 `npm test` 为 `1428` 通过、`23` 失败；失败集中在本次未修改的 CLI、Webview 和 Loop+ 群聊覆盖测试，未命中新增主任务完成消息测试，保留为既有基线问题。
- 功能清单：需同步 Loop+ 主任务完成气泡与三种模式统一口径。
- 相关文档同步：需同步 Loop+ 设计、运行时能力和 Ontology；不更新长期记忆热区。

## 任务列表

Tasklist:
- [completed] 确认三种模式的完成事件与消息渲染链路
- [completed] 补齐 Loop+ 主任务最终总结气泡
- [completed] 更新测试、文档与业务本体
- [completed] 执行构建、定向测试与差异校验

## 决策记录

- 2026-10-06：复用现有 `appendLoopAnswerConclusionMessage` 与 `appendLoopFinalSummaryMessage`，不新增模型调用或新的消息类型；Loop+ 完成后在主任务 target 追加与经典 Loop 相同的两条最终 assistant 消息。

## 当前结论

已完成 Loop+ 主任务完成消息适配：完成状态持久化成功后，复用现有 `appendLoopAnswerConclusionMessage` 与 `appendLoopFinalSummaryMessage` 向主任务对话追加独立 assistant 完成气泡，同时保留群聊完成消息和现有幂等元数据。相关测试、设计文档、能力规格、功能清单与 Ontology 已同步；CodeGraph 已同步 `33` 个变更文件。
