# 按可见连续顺序折叠指令气泡 — 已发布行为修复

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-31-visible-instruction-grouping.md`（历史标识，原文件已替换）
- 关联计划：原 docs companion `2026-10-31-docs-visible-instruction-grouping.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 历史归档范围

修复隐藏思考占位错误中断可见连续指令分组。 原始日期、状态和类型见头部；原文中的实现约束、验收、追加决策、历史验证、失败及未覆盖边界保留在下方。测试计划移除审计（如头部所列）仅记录历史测试职责与证据，不表示本类型重新执行。

## 原文归属记录

## 背景与目标

- 用户发现，面板中连续可见的命令气泡没有折叠。根因是 `appendVisibleMessageEntries` 先识别思考并终止分组，后检查消息是否可见；隐藏的空思考占位因此成为了不可见分隔符。分组应只依赖实际可见消息顺序。

## 范围与非目标

- 只调整普通 AI 对话的连续指令分组顺序。

- 不修改原有未提交改动；不改变 Loop/Loop+ 调度和协议。

- 不改变可见思考、用户、最终答复、系统通知和操作入口的分隔规则，不丢弃原始消息。

## 验收标准

- 隐藏消息之间的两个及以上可见指令默认合为一个折叠组，数量只包含指令。

- 重绘保留展开状态；思考占位补入正文后重新分隔；可见通知及操作入口不被折叠。

- 构建、相关 Webview/Loop/Loop+ 单测和 Chromium 场景通过。

## 影响面、风险与缓解

- 修改 `src/webview/viewContentScript/messageRendering.ts` 及对应运行时回归测试。

- 当前工作区包含其他任务的大量未提交变更，所有补丁限制在确切目标段，不重置或覆盖现有内容。

- 复用已有可见性过滤和 `isInstructionBubble`，不复制判断规则、不改渲染样式和持久化。

## 任务列表

- [completed] 确认隐藏思考在可见性判断前中断指令分组

- [completed] 验证构建、相关单测和 Chromium 可见折叠行为

## 验证记录

- `npm run build`：通过。

- 最小回归：运行 `clipagescriptruntimecoverage` 中新旧分组、隐藏占位和任务控制气泡相关六项测试，6/6 通过。

- 扩大回归：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/instructionGroupSummary.test.js dist/test/webview/chatTranscriptSearch.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/traceToolTitleLocalization.test.js dist/test/webview/codexThinkingPlaceholder.test.js dist/test/loop/*.test.js`：421/421 通过，日志 `.tmp/visible-instruction-verified.log`。

- 反向验证：只在 Node 进程内把分组函数恢复为修复前逻辑，不修改磁盘源码；两项新回归均失败，修复后通过，日志 `.tmp/visible-instruction-before-fix.log`。

- Chromium：使用 `.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario <场景文件>`，对构建生成的真实 Webview HTML、模拟 VS Code 消息桥执行 1280px / 420px 两种宽度的折叠与展开检查，4/4 通过，浏览器/请求错误为零；检查宽屏展开和窄屏折叠截图。

- 实时浏览器检查：`node .tmp/visible-instruction-smoke/live-smoke.cjs`：Vibe（coding）、Loop、Loop+ 均通过隐藏占位跨越分组、追加后保留展开、思考正文出现后重新分隔和任务操作入口独立展示。直接调用 Playwright 时最初选中的默认浏览器缓存缺失，改为复用 smoke runner 发现的现有 Chromium；追加夹具需使用真实 `kind: tool-use` / `merge: false`，否则通用 trace 会按既有机制合并，不能以气泡数断言命令数。未因此改动生产逻辑。

- `git diff --check -- <本任务修改的文件>` 通过；Impeccable 对目标渲染文件的机械检查结果为 `[]`。

## 验证边界

- 未运行整个 `npm test`；已执行上述定向构建和相关回归，未启动真实 CLI 任务、未更改用户运行数据或原任务状态。Webview 浏览器验证使用模拟宿主消息桥，不等同于 Extension Development Host 的人工重载验证。

## 文档与记忆判断

- 用户可见连续判定变化。

- 不更新架构和热区记忆；本计划保留根因与验证证据。
