# 向主模型提问弹窗留白与忙碌提示

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex

## 目标与范围

修复用户 Markdown 气泡尾部的额外留白；主模型执行任务时禁用发送，并在发送按钮左侧显示主题语义红色说明“主模型忙，正在处理任务，请稍后”，不新增聊天气泡。保留输入草稿、历史气泡、回答等待与中止功能，不改变调度和提问持久化格式。

## 验收标准

- 单行用户气泡没有额外换行留白，多段及代码内容仍可正常展示。
- 主模型忙碌时按钮禁用，点击和 Ctrl/⌘+Enter 均不能提交，草稿不丢失。
- 忙碌说明位于发送按钮左侧，不写入聊天记录；空闲后自动恢复。
- 宿主再次校验忙碌状态，拒绝过期页面发来的请求，不启动提问或新增气泡。
- 正常提问、回答等待、中止和弹窗重开不回归。

## 影响面与风险

- 代码：`src/panelDiagnostics.ts`、`src/webview/loopGroupChatPanel*.ts`。
- 测试：群聊面板与协调器；文档：功能清单与已有 ontology 规则。
- 风险：任务整体运行不等于主模型忙碌；以实际主模型 Tab 的运行状态为准。自身回答中仍显示等待动画，不误报为其他任务占用。
- 保留工作区已有模型导入改动，只增量修改功能清单相关条目。

## 验证计划

- `npm run build`
- `node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopMainQuestion.test.js dist/test/loop/loopAskThread.test.js dist/test/core/panelDiagnostics.test.js`
- 使用真实生成的 Webview HTML 与 headless Chromium 验证留白、忙碌/空闲切换、发送和草稿；不调用真实 CLI 或修改用户配置。
- ontology 校验、改动范围空白检查。

## 当前结论

用户气泡 `white-space: pre-wrap` 覆盖通用 Markdown 样式，保留了 Markdown 生成 HTML 尾部换行；已改为正常 Markdown 空白处理并收紧首尾块边距。新增主模型 Tab 忙碌状态的初始展示和局部补丁同步，客户端与宿主双重限制发送。按用户修订采用按钮左侧说明，不采用气泡提示；保留草稿、历史、等待和中止行为。

## 验证结果

- 最终 `npm run build` 通过。
- 验证计划中的五个测试文件，加上 `dist/test/loop/loopPlusGroupChatPanel.test.js`、`dist/test/loop/loopmaingroupchatbutton.test.js`，共 79 项相关单测通过。新增初始忙碌提示、首尾块样式、局部补丁恢复与过期补丁保护、草稿保留、自身提问状态、宿主忙碌拒绝及重开弹窗刷新状态的回归断言。
- `node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/loop-ask-dialog-smoke.json` 通过，结果保存在 `/tmp/loop-ask-dialog-smoke/structured/result.json`。
- 生成的真实 Webview HTML 在 headless Chromium 的 1200px、390px 视口验证通过；用户气泡首尾额外空白实测均为 0px，代码换行和缩进保留。提示位于发送按钮左侧且无重叠，忙碌时 Ctrl+Enter 不发送且保留草稿；空闲补丁恢复发送，再次忙碌恢复禁用；正常回答等待、中止与重开均通过。
- 浏览器控制台、页面、请求及 HTTP 错误均为 0。截图：`/tmp/loop-ask-dialog-smoke/busy-1200.png`、`/tmp/loop-ask-dialog-smoke/busy-390.png`；测量结果：`/tmp/loop-ask-dialog-smoke/geometry-result.json`。本机验证使用宿主桥接替身，不调用真实 CLI，不修改用户配置；未启动 Extension Development Host。
- ontology 校验、改动范围空白检查和 `git diff --check` 通过。设计检查仅提示既有引用块 `border-left`，与本次改动无关，保留。

## 失败分类与文档同步

- 中间一次全仓构建受并行修改的其他测试文件影响（`Object.hasOwn` 目标版本及模型夹具字段）；未修改范围外文件，并行修改稳定后最终全仓构建通过。
- 浏览器夹具初次误用普通 Enter（现有提交快捷键为 Ctrl/⌘+Enter），并尝试在 Webview CSP 下直接 fetch 补丁；改为正确快捷键及宿主侧投递补丁后通过，无需修改产品 CSP。截图等待弹窗渐入完成。
- 已同步功能清单与 `plugin.rule.loop_main_model_question` 规则；没有架构、持久化、平台或运维方式变化，无需修改架构文档和 runbook。
- 本轮是局部修复，无新增跨会话热区记忆，不写入 `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`。任务专用浏览器夹具清理，证据保留在系统临时目录。
