# 修复后台 Loop 主任务标签运行状态

- 日期：2026-11-25
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

后台运行校准只恢复有本 Tab CLI 执行的标签，漏掉仍由宿主编排、正等待子任务或下一轮的主任务；点击 Tab 刷新完整状态后才恢复。运行中的主任务应在后台保持运行态，结束后正确清除。

## 范围与验收

- 复用宿主 Loop 活动任务集合和已有运行校准，不更改调度、会话持久化或轮询周期。
- 主任务仍被宿主持有且任务状态为 `running` 时，无需选中 Tab 或持有本 Tab 的 CLI 运行也能恢复运行态。
- 同一父任务下的空闲子任务不因此显示运行；完成、停止和失败仍清除旧运行态。
- 旧轮询响应不清除后来启动的运行，宿主主动校准不被旧轮询时间戳阻挡。

## 验证计划

- `npm run build`，运行 `conversationTabRunningFlow`、`tabRunStatus` 和相邻 Tab/Webview 单测。
- 用 headless Chromium 验证后台标签在校准后恢复、终态清理且不抢焦点；使用隔离状态，不调用真实模型。
- 同步功能清单、运行时设计和 ontology，执行 `search_ontology.py --validate`。

## 验证结果

- 用修复前的干净工作树复现：仍有运行归属但没有直接 CLI 进程的后台主任务，恢复列表误返回空。
- `npm run build` 通过。`node --test` 对 `dist/test/` 下的 `session/{conversationTabRunningFlow,conversationTabLock,sessionTabCliSwitch,sessionMessageRouter,sessionMessageHandlersCoreCoverage,departmentConversationTabs}.test.js`、`webview/{tabRunStatus,looppluswebviewintegration,clipagescriptruntimecoverage,departmentConversationTabsWebview}.test.js`、`loop/loopGroupChat.test.js`、`extensionHost/loopPlusRuntimeIntegration.test.js` 分两组执行，合计 429 项全部通过。
- 用 `PLAYWRIGHT_MODULE=<本地 Playwright 路径> CHROMIUM_PATH=<缓存 Chromium 路径> node .tmp/loop-main-tab-status-smoke.cjs` 验证生成的实际 Webview。最初默认 Chromium 版本缺失，改用已有浏览器后发现旧时间戳阻挡真实终态；修复后确认前台选择不变、后台主任务自动恢复、空闲子任务不误亮、终态清除并停止复核，无浏览器错误。
- 功能清单、运行时设计、排障手册和 ontology 已同步。`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。未调用真实模型、未运行 VS Code Extension Development Host、未发布。
