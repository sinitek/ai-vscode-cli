# 子任务派发携带设计关键点

- 日期：2026-09-28
- 状态：completed
- 负责人：Codex
- owner：codex
- claimed_at：2026-09-28
- claim_ttl：已完成

## 背景

Loop、Loop+ 和 Graph 派发子任务时往往只给粗粒度目标。子会话是新会话，看不到父规划推理，高难度设计关键点因此丢失。

## 目标

派发编码或其他执行任务时，把已确定的高难度设计关键点写进子任务能看到的说明。

## 范围

- 经典 Loop 主任务、红蓝共识汇总和主持人派发提示。
- Loop+ 主任务决策提示和示例。
- Graph planner 规则、节点 `instructions` 持久化、节点提示和运行图详情。

## 非目标

- 不新增用户必填表单，也不在缺少关键点时拒绝整份计划。
- 不改变子任务并发、冲突组和验收状态机。

## 验收标准

- [x] Loop / Loop+ 提示明确要求把设计关键点写进子任务 prompt，并给出示例。
- [x] Graph `instructions` 可从 plannedGraph 进入节点记录、节点提示和详情。
- [x] 空白说明被丢弃，超长说明被截断，旧记录仍可读取。
- [x] 相关单测和 `npm run build` 通过。

## 影响面

- 代码目录：`src/extensionHost/`、`src/graph/`、`src/loopPromptBuilders.ts`、`src/webview/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/ontology/`

## 风险与缓解

- 风险：模型仍可能漏写关键点。
- 缓解：规则写进主提示和协议示例；Graph 用独立字段承接，而不是只靠标题。缺省时不把旧图判失败。

## 验证计划

- `npm run build`：通过。
- `node --test dist/test/loop/subtaskDesignBriefPolicy.test.js dist/test/loop/loopPromptBuilders.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/graph/graphPromptBuilders.test.js dist/test/graph/graphPlanner.test.js dist/test/graph/graphStore.test.js dist/test/graph/graphRunPanel.test.js dist/test/graph/graphFailureClassification.test.js`：67/67 通过。

## 未决问题

- 无。
