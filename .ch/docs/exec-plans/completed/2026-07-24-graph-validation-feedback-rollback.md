# Graph 验证失败回退与节点瘦身

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex / 协作
- owner：Codex
- claimed_at：2026-07-24
- claim_ttl：1d
- handoff_to：

## 背景

用户指出 Graph 不是线性流程：测试/评审/验证失败时，应能回退到前置实现节点继续修复，而不是只能重跑当前验证节点。同时当前可视 DAG 节点过大，节点本体只应显示标题，详细内容放在下方节点详情。

## 目标

- 给 Graph 增加从失败验证节点回退/返工到上游节点的基础能力。
- 缩小 GraphRunPanel DAG 节点矩形，只展示标题和轻量状态标记。
- 补充测试并同步 Graph 设计/规格文档。

## 范围

- Graph run control / panel state / panel controls / runtime 文案。
- GraphRunPanel 渲染与样式。
- Graph 相关单元测试和文档事实来源。

## 非目标

- 不实现完整图编辑器、复杂条件表达式编辑或自动多层级重规划。
- 不自动猜测并修改用户代码；只提供明确的图级返工控制并重置相关节点状态。

## 验收标准

- [x] failed/blocked 的 test/review/merge/human_gate/summary 等验证类节点可暴露“回退上游/返工”操作。
- [x] 操作会选择可回退的上游工作节点，回滚 worktree 到该节点 baseCommit，并把该上游节点及其下游已完成/失败节点重置为 pending，保留事件证据。
- [x] DAG 节点矩形更小，节点本体只展示标题和紧凑状态/类型信息，正文细节仍在节点详情区。
- [x] build、Graph 相关测试、diff check 通过。

## 影响面

- 代码目录：`src/graph/`、`src/panelStateBuilder.ts`、`src/webview/graphRunPanel*.ts`、`src/extension.ts`、`src/test/graph*.test.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`
- 配置与脚本：无预期变化。

## 风险与缓解

- 风险：回退误删无关 worktree 改动。
- 缓解：仅在节点有 `baseCommit` 且 run 有 worktree 时执行 reset；操作通过面板显式触发，并记录 event。

## 验证计划

- 最小相关验证：Graph control / panel renderer / extension source coverage。
- 单元自测命令：`npm run build`；`node --test dist/test/graph*.test.js`。
- 扩展验证：`git diff --check`；`codegraph sync`。

## 测试与清单同步

- 单元测试新增/更新：`src/test/graphRunControl.test.ts`、`src/test/graphRunPanel.test.ts`、`src/test/graphExtensionRuntime.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphRunControl.test.js dist/test/graphRunPanel.test.js dist/test/graphExtensionRuntime.test.js` 20/20 通过；`node --test dist/test/graph*.test.js` 71/71 通过；`git diff --check` 通过；`codegraph sync` 通过。
- 失败处理记录：无。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`。
- 相关文档同步：已更新 `.ch/docs/design-docs/graph-orchestration-mode.md`。

## 任务列表

- [x] 定位当前 retry/rollback 与 Graph panel control 渲染链路。
- [x] 实现验证失败回退上游节点能力。
- [x] 缩小 DAG 节点渲染与样式。
- [x] 补充测试、同步文档并验证。

## 决策记录

- 2026-07-24：Graph 验证失败回退不是“主智能体重新规划”，而是宿主根据 durable DAG 选择失败验证节点的上游工作节点，执行局部 reset / descendant reset 后让 scheduler 继续按图推进。

## 当前结论

已完成：Graph 控制层新增 Feedback rollback；面板详情区新增“回退上游返工”操作；可视 DAG 节点缩小为标题 + 状态；相关测试和文档已同步。
