# Graph 主任务最终总结回写

- 日期：2026-07-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-29T00:00:00+08:00
- claim_ttl：1d
- handoff_to：

## 背景

Graph run 完成后当前主 Graph tab 只追加系统级完成状态，用户还要求在主任务 tab 对话里出现最终总结，并由主 AI 自己写出任务总结。

## 目标

Graph 任务进入 completed 后，在主 Graph tab 追加可见的最终总结 assistant 气泡；总结内容优先来自 Graph summary 节点产出的 `finalAnswer`，避免宿主硬编码替主 AI 编写结论。

## 范围

- Graph completed 收束路径的主 tab 消息追加。
- Graph 最终总结 Markdown builder 与消息元数据。
- Graph runtime 相关单元测试与用户可见规格文档。

## 非目标

- 不改 Graph DAG 调度、planner、节点执行协议或 GraphRunPanel 布局。
- 不新增新的外部模型调用链路。
- 不改变 Loop 最终总结逻辑。

## 验收标准

- [x] Graph run completed 后，主 Graph tab 会额外追加一个 assistant 最终总结气泡。
- [x] 最终总结优先使用 summary 节点的 `finalAnswer.conclusion/summary/evidence/unresolved`，没有时才使用明确 fallback。
- [x] 完成状态系统消息和普通 `openGraphRun` action 仍保持现有去重语义。
- [x] 相关 Graph 单元测试、构建和 diff 检查通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/graph/graphPlanner.ts`、`src/webview/types.ts`、`src/webview/viewContentScript/coreRuntimeState.ts`、`src/webview/viewContentScript/traceRendering.ts`、`src/test/graphExtensionRuntime.test.ts`、`src/test/graphPlanner.test.ts`
- 文档目录：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`docs/插件功能清单.md`
- 配置与脚本：无

## 风险与缓解

- 风险：completed 路径重复追加 Graph 图 action 或覆盖节点 tab 消息。
- 缓解：最终总结使用独立 assistant 消息并复用 `graphRunId` 元数据，不附加 Graph open action。

## 验证计划

- 最小相关验证：`node --test dist/test/graphExtensionRuntime.test.js`
- 单元自测命令：`npm run build`；`node --test dist/test/graph*.test.js`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphExtensionRuntime.test.ts` 与 `src/test/graphPlanner.test.ts`，覆盖 Graph completed 主 tab 总结气泡、`graphFinalSummary` 元数据、summary 主模型路由和默认 summary ownerRole。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphAutoWake.test.js dist/test/graphEvents.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphKernel.test.js dist/test/graphMainWebview.test.js dist/test/graphNodeArtifact.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphPlanner.test.js dist/test/graphPromptBuilders.test.js dist/test/graphRunControl.test.js dist/test/graphRunPanel.test.js dist/test/graphScheduler.test.js dist/test/graphStore.test.js dist/test/graphWorktree.test.js` 97/97 通过；`node --test dist/test/clipagescriptruntimecoverage.test.js dist/test/finalConclusion.test.js` 22/22 通过；`git diff --check` 通过；`codegraph sync` 通过。
- 失败处理记录：首次运行 `node --test dist/test/graphExtensionRuntime.test.js dist/test/graphPlanner.test.js` 中新增正则断言按错误顺序匹配失败，已改为分项断言并重跑 Graph 全量通过；一次 `node --test dist/test/graph*.test.js` 因 zsh glob 未展开失败，改用显式文件列表重跑通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`。

## 任务列表

- [x] 定位 Graph completed 收束与消息写入点。
- [x] 实现主 Graph tab 最终总结气泡。
- [x] 更新测试和文档。
- [x] 执行构建与相关测试。

## 决策记录

- 2026-07-29：把最终总结作为主 Graph tab 的 assistant 消息追加，内容优先读取 summary 节点产物里的 `finalAnswer`，符合“主 AI 自写任务总结”的要求。
- 2026-07-29：Graph `summary` 节点和 planner 一样使用主模型，其他 Graph 执行节点继续使用子模型；默认自动补齐的 summary 节点 `ownerRole` 调整为 `main`。

## 当前结论

已完成。Graph completed 分支现在先保留原有系统完成消息，再追加 `graphFinalSummary=true` 的主 tab assistant 最终总结气泡；该气泡优先使用主模型 summary 节点产出的 `finalAnswer`，并包含问题结论、任务总结、验证证据和未完成事项。前端会把该气泡视为最终总结卡片且不会与普通 assistant 输出合并。
