# 按可见连续顺序折叠指令气泡

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex

## 背景与目标

用户在删除 Graph 模式的任务中发现，面板中连续可见的命令气泡没有折叠。根因是 `appendVisibleMessageEntries` 先识别思考并终止分组，后检查消息是否可见；隐藏的空思考占位因此成为了不可见分隔符。分组应只依赖实际可见消息顺序。

## 范围与非目标

- 只调整普通 AI 对话的连续指令分组顺序，补充历史恢复、实时追加和隐藏转可见回归。
- 不修改 Graph 删除任务的运行时、依赖清理及原有未提交改动；不改变 Loop/Loop+ 调度和协议。
- 不改变可见思考、用户、最终答复、系统通知和操作入口的分隔规则，不丢弃原始消息。

## 验收标准

- 隐藏消息之间的两个及以上可见指令默认合为一个折叠组，数量只包含指令。
- 重绘保留展开状态；思考占位补入正文后重新分隔；可见通知及操作入口不被折叠。
- 构建、相关 Webview/Loop/Loop+ 单测和 Chromium 场景通过；新增 Ontology 规则有效，不增加原 Graph 删除任务已有校验问题。

## 影响面、风险与缓解

- 修改 `src/webview/viewContentScript/messageRendering.ts` 及对应运行时回归测试。
- 同步功能清单、能力规格及可见连续规则的 Ontology 导航。
- 当前工作区包含其他任务的大量未提交变更，所有补丁限制在确切目标段，不重置或覆盖现有内容。
- 复用已有可见性过滤和 `isInstructionBubble`，不复制判断规则、不改渲染样式和持久化。

## 任务列表

- [completed] 确认隐藏思考在可见性判断前中断指令分组
- [completed] 调整判断顺序并补历史恢复、重绘和实时追加测试
- [completed] 验证构建、相关单测和 Chromium 可见折叠行为
- [completed] 同步规格与 Ontology 并完成验证记录

## 验证记录

- `npm run build`：通过。
- 最小回归：运行 `clipagescriptruntimecoverage` 中新旧分组、隐藏占位和任务控制气泡相关六项测试，6/6 通过。
- 扩大回归：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/instructionGroupSummary.test.js dist/test/webview/chatTranscriptSearch.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/traceToolTitleLocalization.test.js dist/test/webview/codexThinkingPlaceholder.test.js dist/test/loop/*.test.js`：421/421 通过，日志 `.tmp/visible-instruction-verified.log`。
- 反向验证：只在 Node 进程内把分组函数恢复为修复前逻辑，不修改磁盘源码；两项新回归均失败，修复后通过，日志 `.tmp/visible-instruction-before-fix.log`。
- Chromium：使用 `.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario <场景文件>`，对构建生成的真实 Webview HTML、模拟 VS Code 消息桥执行 1280px / 420px 两种宽度的折叠与展开检查，4/4 通过，浏览器/请求错误为零；检查宽屏展开和窄屏折叠截图。
- 实时浏览器检查：`node .tmp/visible-instruction-smoke/live-smoke.cjs`：Vibe（coding）、Loop、Loop+ 均通过隐藏占位跨越分组、追加后保留展开、思考正文出现后重新分隔和任务操作入口独立展示。直接调用 Playwright 时最初选中的默认浏览器缓存缺失，改为复用 smoke runner 发现的现有 Chromium；追加夹具需使用真实 `kind: tool-use` / `merge: false`，否则通用 trace 会按既有机制合并，不能以气泡数断言命令数。未因此改动生产逻辑。
- `git diff --check -- <本任务修改的文件>` 通过；Impeccable 对目标渲染文件的机械检查结果为 `[]`。

## 已分类的范围外失败

- 初次扩大回归包含 `dist/test/webview/looppluswebviewintegration.test.js`，共 422 项中 419 通过、3 项失败，均为夹具仍提取已被 Graph 删除任务移除的 `normalizeGraphRunId`。
- 使用修复前分组逻辑在进程内运行该文件，仍得到同样三项失败，确认不是本修复引入；不修改原 Graph 任务的测试迁移范围。日志 `.tmp/visible-instruction-graph-baseline.log`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 报告 10 个原有 Graph 文件删除后的失效引用；Ontology 单测共 9 项，8 项通过，`test_validate_current_ontology` 因同样 10 个引用失败。
- 在内存副本中移除本次新增规则再运行同一验证器，问题列表完全相同；新规则未引入校验问题。Graph Ontology 清理仍由原任务负责。
- 未运行整个 `npm test`；已执行上述定向构建和相关回归，未启动真实 CLI 任务、未更改用户运行数据或原任务状态。Webview 浏览器验证使用模拟宿主消息桥，不等同于 Extension Development Host 的人工重载验证。

## 文档与记忆判断

- 用户可见连续判定变化，需要同步 `FEATURE_INVENTORY.md` 和能力规格。
- 新增可见连续规则的 Ontology 记录，保留原有 Graph 删除任务负责的记录。
- 无新架构、权限或调度变化，不更新架构和热区记忆；本计划保留根因与验证证据。
