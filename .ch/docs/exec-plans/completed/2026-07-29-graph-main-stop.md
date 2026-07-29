# Graph 主任务中止状态修复

- 日期：2026-07-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-29
- claim_ttl：same-session
- handoff_to：

## 背景

Graph 进入阻塞/needs-review 后，主 AI 对话右下角仍显示执行中。用户点击主对话的“中止”后，Graph run 仍保持执行中/未终止视觉状态；但在 Graph 运行图面板内点击 Stop 可以正确落盘 stopped。

## 目标

- 主 Graph tab 的“中止”复用 GraphRunPanel 同一 stop 控制链。
- 已落盘为 `stopped` 的 Graph run 不再被异步 tick 的旧状态覆盖回 `running` / `needs-review`。
- 补充回归测试并同步用户可见行为文档。

## 范围

- `src/extension.ts` 主对话 stop 与 Graph run 状态持久化。
- `src/test/graphExtensionRuntime.test.ts` 回归断言。
- Graph 设计文档与功能清单事实来源。

## 非目标

- 不改变 Graph DAG 调度语义。
- 不新增 Graph 图编辑或节点跳转执行能力。
- 不承诺底层 CLI 进程一定同步退出。

## 验收标准

- [x] 主 Graph tab 点击“中止”会调用 Graph run stop 控制链并落盘 `stopped`。
- [x] Graph run 已 stopped 后，异步 tick 不会用旧 run 状态覆盖。
- [x] 相关 build 与 Graph 测试通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`
- 配置与脚本：无

## 风险与缓解

- 风险：误把 Graph 节点 tab 的普通停止扩展成整图停止。
- 缓解：节点 tab 仍优先按已有 active run 停止；Graph fallback 只在没有活动 run 且 tab 能解析到非终态 Graph run 时触发。

## 验证计划

- 最小相关验证：`node --test dist/test/graphExtensionRuntime.test.js dist/test/graphRunControl.test.js dist/test/graphRunPanel.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphExtensionRuntime.test.ts`，覆盖主 Graph tab 中止接线和 stopped 防覆盖保护。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphExtensionRuntime.test.js dist/test/graphRunControl.test.js dist/test/graphRunPanel.test.js` 38/38 通过；`node --test dist/test/graph*.test.js` 101/101 通过；`git diff --check` 通过。
- 失败处理记录：无失败。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/design-docs/graph-orchestration-mode.md` 与 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 修复主 Graph tab 中止链路
- [x] 增加 stopped 防覆盖保护
- [x] 补充测试、文档并验证

## 决策记录

- 2026-07-29：主 AI 对话中止应复用 GraphRunPanel 的 stop 控制链，不另写一套 Graph 终止语义。

## 当前结论

已完成修复。主 Graph tab 的 AI 对话“中止”现在会在没有本 tab 活动 CLI run 时解析当前 tab 关联的 Graph run，并复用 `stopGraphRunFromPanel` 落盘 stopped；`persistGraphRunTickState` 会优先保留已经落盘的 stopped run，避免异步 tick 用旧状态覆盖。
