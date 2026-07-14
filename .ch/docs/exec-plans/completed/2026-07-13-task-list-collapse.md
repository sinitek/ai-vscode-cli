# AI 对话任务列表收起与进度计数

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：/root
- claimed_at：2026-07-13
- claim_ttl：当前会话
- handoff_to：无

## 背景

AI 对话中的任务列表已有任务项渲染与原生 `details` 状态，但没有明显的收起图标，且标题只显示总任务数，无法快速判断已完成进度。

## 目标

让任务列表标题提供清晰的收起/展开箭头；收起时隐藏任务项，仅保留标题、进度数量和折叠控件；数量显示为已完成/总数，例如 `2/4`。

## 范围

- 调整聊天 Webview 任务列表摘要 DOM 与主题变量样式。
- 在任务列表渲染时计算完成数量并显示 `completed/total`。
- 覆盖外部 OpenCode 任务更新、折叠后更新和静态图标结构的回归测试。
- 同步功能清单与能力规格。

## 非目标

- 不改变 Claude/OpenCode 任务提取、消息协议或任务完成判定。
- 不将折叠状态持久化到扩展重启后的本地存储；继续沿用每个会话 tab 的运行时状态。
- 不改变任务列表在无任务时隐藏的现有行为。

## 验收标准

- [x] 任务列表标题可通过明显箭头图标收起和展开，原生键盘操作保持可用。
- [x] 收起后不展示任务项，只保留标题、进度数量和折叠图标。
- [x] 有 4 个任务、其中 2 个已完成时，标题显示 `2/4`。
- [x] 已收起的列表收到后续任务更新时不会被重新展开。
- [x] 相关任务列表单元测试通过。
- [ ] 全量 TypeScript 构建通过；被范围外的 multi-agent 重命名测试基线阻断，详见测试记录。

## 影响面

- 代码目录：`src/webview/`、`src/test/openCodeTaskListOverlay.test.ts`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/exec-plans/`
- 配置与脚本：无

## 风险与缓解

- 风险：后续流式任务更新可能覆盖用户选择的收起状态。
- 缓解：复用每个 conversation tab 现有的 `taskList.open`，在回归测试中验证更新后仍保持收起。

## 验证计划

- 最小相关验证：检查任务列表渲染函数、静态 HTML 和主题样式断言。
- 单元自测命令：`npm run build`；`node --test dist/test/openCodeTaskListOverlay.test.js`
- 扩展验证：构建后检查 Webview 生成结构与任务进度断言。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/openCodeTaskListOverlay.test.ts`，覆盖 `2/4` 进度、收起后流式更新保持收起和静态箭头结构。
- 单元自测结果：`node --test dist/test/openCodeTaskListOverlay.test.js` 通过，4 个子测试全部通过。
- 失败处理记录：`npm run build` 执行到 `tsc` 后因范围外的 multi-agent API 重命名失败：`src/test/contextCompactionRunner.test.ts` 与 `src/test/opencodethinkingintegration.test.ts` 仍使用已被工作区改名的 `getWorkspaceCodexMultiAgentEnabled`，而依赖接口已改为 `getWorkspaceMultiAgentEnabled`。未修改该并行工作，避免覆盖用户未完成改动。
- 功能清单：已同步 `FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 定位任务列表渲染、状态和既有测试。
- [x] 确定折叠图标、`completed/total` 计数和状态保持方案。
- [x] 实现 Webview、测试与文档变更。
- [x] 执行构建和最小回归测试并归档计划。

## 决策记录

- 2026-07-13：沿用原生 `details` 作为折叠控件，避免新增按钮状态、重复键盘逻辑或额外 i18n；补充装饰性箭头图标以明确可收起状态。
- 2026-07-13：计数格式固定为 `completed/total`，不使用本地化文案，满足跨语言界面的紧凑展示要求。

## 当前结论

任务列表现在在标题前显示旋转箭头，使用 `completed/total` 进度值；原生 `details` 在收起时只展示摘要，已有 tab 级 `taskList.open` 保持用户的收起选择。定向回归测试通过，且 `git diff --check` 无格式问题。全量构建已执行，但当前工作区的范围外 multi-agent 重命名测试问题需由对应改动的负责人收口。
