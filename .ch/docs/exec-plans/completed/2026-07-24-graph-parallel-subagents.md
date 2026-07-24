# Graph 并行子智能体执行与补充入口

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-24T00:00:00+08:00
- claim_ttl：1d
- handoff_to：

## 背景

用户指出 Graph 模式既然是 DAG，运行时不应把节点串行执行成线形流程；并行节点应像 Loop 主从模式一样由主调度方按图调配多个子智能体。用户还要求 Graph 模式同样支持“我要说话”来补充需求。

当前事实：`graphKernel.tickGraphRun` 已能按 scheduler 选择一批节点并 `Promise.all` 执行，但扩展层把 `GRAPH_EXTENSION_EXECUTOR_MAX_CONCURRENT_NODES` 固定为 1，并且节点 executor 复用同一个对话 tab，若放开并发会互相 stop。Loop 模式已有“创建子任务 tab + 并行派发 + 主 tab 进度消息 + 补充需求记录”的成熟路径。

## 目标

让 Graph 模式运行时按 planned DAG 的可并发节点批次真正派发多个子任务，并让 GraphRunPanel 提供“我要说话”补充入口，补充内容进入 Graph run 记录并注入后续节点 prompt。

## 范围

- Graph 执行层：把可并行 DAG 节点派发到独立 Graph 子任务 tab，避免同一 tab 互相停止。
- Graph 并发上限：扩展层尊重 run.maxConcurrent 与全局安全上限，不再固定为 1。
- Graph UI：GraphRunPanel 增加“我要说话”按钮与补充消息弹窗。
- Graph prompt：节点执行 prompt 能读取 Graph run 的补充需求。
- 文档与测试：补充最小回归与产品事实说明。

## 非目标

- 不实现拖拽式图编辑器、人工重排 DAG 或完整 Graph 群聊面板。
- 不改变 Graph kernel 的 DAG 依赖/冲突判定核心算法。
- 不实现复杂的运行中打断/重规划；补充消息先作为后续节点必须读取的需求增量。

## 验收标准

- [x] 当 Graph scheduler 选中多个互不冲突节点时，扩展层允许同批并行执行，不再被固定并发 1 限制。
- [x] 每个 Graph 执行节点使用独立子任务 tab/run target，并保留 graphRunId / graphNodeId 映射。
- [x] GraphRunPanel 对未完成 run 显示“我要说话”，提交后持久化补充消息并刷新面板。
- [x] 后续 Graph 节点 prompt 包含补充需求区块。
- [x] 构建、Graph 相关测试和完整 node 测试通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/graph/`、`src/panelDiagnostics.ts`、`src/panelStateBuilder.ts`、`src/webview/graphRunPanel*.ts`、`src/test/graph*.test.ts`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/graph-orchestration-mode.md`（如行为说明需要）
- 配置与脚本：无计划变更

## 风险与缓解

- 风险：并行 Graph 节点共享同一个 git worktree，真实文件写入仍可能冲突。
- 缓解：继续依赖 existing scheduler 的 `writeFiles` / `conflictGroup` 冲突判定；无法证明范围的写类节点仍串行。
- 风险：Codex/Claude interactive runner 对多 tab 并行能力与 OpenCode one-shot 不完全一致。
- 缓解：先复用 `runPrompt` 的 existing parallel/interactive tab isolation；不新增 CLI 协议。
- 风险：运行中补充被误解为立即打断当前节点。
- 缓解：文案和 prompt 约束为“写入补充需求，后续节点必须读取”，不承诺即时中断。

## 验证计划

- 最小相关验证：Graph panel、Graph extension runtime、Graph prompt builders。
- 单元自测命令：`npm run build`；`node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`；`node --test`。
- 扩展验证：静态检查 Graph executor 不再复用主 tab 且 maxConcurrent 不再固定为 1。

## 测试与清单同步

- 单元测试新增/更新：已更新 `graphStore`、`graphPromptBuilders`、`graphRunPanel`、`graphRunControl`、`graphExtensionRuntime` 覆盖补充消息、中文入口、控制状态和独立 Graph 子任务 tab executor。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphStore.test.js dist/test/graphPromptBuilders.test.js dist/test/graphRunPanel.test.js dist/test/graphExtensionRuntime.test.js` 21/21 通过；`node --test dist/test/graph*.test.js` 65/65 通过；`node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js` 95/95 通过；`node --test` 726/726 通过。
- 失败处理记录：首次 Graph 全量测试中 `graphRunControl.test.ts` 旧断言缺少新增 `canSupplement` 字段，已更新断言并重跑通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md` 与 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 定位 Graph 串行限制与 Loop 并发/补充机制。
- [x] 实现 Graph 并行子任务 tab 执行与补充数据模型。
- [x] 更新 GraphRunPanel “我要说话”交互和 prompt 注入。
- [x] 补测试、构建验证并同步事实文档。

## 决策记录

- 2026-07-24：本轮不新增单独 Graph 群聊系统，先让 GraphRunPanel 提供补充入口，补充内容写入 Graph run 并注入后续节点 prompt。
- 2026-07-24：Graph 并行执行复用 Loop 子任务 tab 思路，不让多个节点共享同一个目标 tab。

## 当前结论

已完成：Graph kernel 继续负责 planned DAG 批次调度，扩展层按 `min(run.maxConcurrent, 6)` 执行同批可运行节点，并为每个 Graph 节点创建独立子任务 tab，避免同 tab runPrompt 互相 stop。GraphRunPanel 已新增“我要说话”，补充消息写入 run store、主沟通文件和 events，并注入后续节点 prompt。
