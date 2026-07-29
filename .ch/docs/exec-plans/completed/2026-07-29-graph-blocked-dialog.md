# Graph 阻塞弹窗与节点选择修复

- 日期：2026-07-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-29
- claim_ttl：same-session
- handoff_to：

## 背景

最近 Codex + Graph 运行在节点进入 blocked 后只把 run 写成 `needs-review` 并追加系统消息/刷新面板。用户期望阻塞时弹窗展示原因，并在存在多个下游节点时选择进入哪个下游节点；补充要求也要支持重跑当前阻塞节点。

## 目标

- Graph 节点 blocked 后弹出用户可见提示，显示阻塞原因。
- 弹窗提供重跑当前阻塞节点入口。
- 当当前阻塞节点存在多个可进入的下游节点时，弹窗允许用户选择目标下游节点并打开对应节点详情。
- 继续保留现有 GraphRunPanel 的 Retry、Continue、Approve、Stop 控制能力。

## 范围

- `src/extension.ts` Graph runtime 中断处理与 panel 打开/选择节点接线。
- `src/graph/graphRunControl.ts` 如需补充 blocked 节点状态推导。
- `src/webview/graphRunPanel*` 如需补齐动作/文案。
- 相关测试和 Graph 产品/设计文档。

## 非目标

- 不实现图结构编辑器或修改 DAG 拓扑。
- 不实现 direct 模式自动回滚已写文件。
- 不引入新 UI 框架或替换现有 GraphRunPanel。

## 验收标准

- [x] blocked run 会触发 modal/popup，内容包含阻塞节点和原因。
- [x] 弹窗可选择重跑当前阻塞节点，并调用现有 retry 控制链继续 tick。
- [x] 存在多个下游节点时，弹窗可选择进入具体下游节点并打开 GraphRunPanel 选中该节点。
- [x] 没有可重跑或下游目标时仍可打开 GraphRunPanel 查看阻塞详情。
- [x] 相关 TypeScript 构建和定向测试通过，文档事实同步。

## 影响面

- 代码目录：`src/extension.ts`、`src/graph/`、`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 配置与脚本：无预期变更

## 风险与缓解

- 风险：弹窗重复弹出干扰用户。
- 缓解：按 run/node/status/attempt 记忆已提示 key，仅在新的 blocked 状态或用户控制后再提示。
- 风险：下游节点还未 ready，用户误以为会执行。
- 缓解：文案用“进入节点详情”而非“执行下游节点”，只打开面板选中节点。

## 验证计划

- 最小相关验证：`node --test dist/test/graphRunControl.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphRunPanel.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：更新 `src/test/graphExtensionRuntime.test.ts`，覆盖 blocked modal、重跑当前节点和下游选择接线。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graph*.test.js` 100/100 通过；`git diff --check` 通过。
- 失败处理记录：无失败。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/design-docs/graph-orchestration-mode.md` 与 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 定位 blocked run 中断路径和用户选择入口
- [x] 实现阻塞弹窗、下游选择和重跑当前节点
- [x] 补充测试与文档
- [x] 执行构建、定向测试和 diff 检查

## 决策记录

- 2026-07-29：复用现有 GraphRunPanel 控制链；下游选择先打开详情，不修改 DAG 或强行跳过依赖。

## 当前结论

已完成修复。最近日志显示 blocked 节点会进入 `needs-review`，但宿主此前只追加系统消息和刷新面板，没有 modal/popup 选择分支；现在 `tickGraphRunToPause` 在 `needs-review` / idle 需要关注路径上会调用 blocked prompt，展示阻塞原因，并允许用户重跑当前阻塞节点或进入/选择下游节点。
