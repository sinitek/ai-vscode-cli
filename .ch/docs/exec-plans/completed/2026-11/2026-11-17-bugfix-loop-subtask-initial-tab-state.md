# Loop / Loop+ 子任务标签初始状态修复

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop / Loop+ 派发子任务后，新标签最初缺少子任务图标，运行状态也会延迟。目标是在首次标签状态投影中就提供当前派发身份和运行反馈，覆盖新会话、续接和跨 CLI。

## 范围与非目标

核对子任务创建、宿主标签投影及 Webview 状态同步，并增加首态回归。保留工作区已有依赖调度改动，不修改调度语义、模型或技术栈，不发布扩展。

## 验收标准

- 首次标签刷新已显示当前子任务身份及运行状态，不依赖首条模型输出或定时巡检。
- 续接会话不使用旧子任务身份；普通标签、主任务及完成/错误/停止状态保持正确。
- 相关回归和构建通过；同步功能清单及必要事实来源。
- 对真实 Webview 的宿主内视觉验证记录明确边界，不以独立 Web 应用冒充 Extension Development Host。

## 影响面与风险

- 涉及 src/extensionHost/sessionTabs.ts、Loop / Loop+ 派发端、标签投影与 Webview 回归。
- 风险：提前运行事件可能在新标签列表到达前被清理；需验证实际消息顺序和首次投影。
- 工作区已存在未提交改动，只增量修复，不回退或覆盖已有工作。

## 实现与验证

- `src/sessionTabs.ts` 在运行时 tab 投影中携带本次 `loopTaskId` / `loopSubtaskId`，不写入持久化 tab 数据；经典 Loop 与 Loop+ 派发均传入当前子任务身份。
- `src/extensionHost/sessionTabs.ts` 首次投影按子任务身份匹配标题，并从宿主活动执行状态投影运行中；创建 tab 后先发布 panel state，再发送 start 事件。
- Webview 将子任务宿主运行态纳入 tab 运行状态计算，完成、错误和停止仍由原终态事件收口。
- `npm run build`：通过。
- `node --test dist/test/session/loopTabMemberTooltip.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/webview/tabRunStatus.test.js`：通过，41 项。
- `node --test dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/subtaskCliExecution.test.js`：通过，93 项。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：仅含本次提交的临时副本校验通过，domains=2、concepts=17、relations=16、rules=147、workflows=2、documents=3。
- 提交隔离验证：从 HEAD 与本次暂存内容生成独立临时副本，复用已安装的 node_modules、使用独立 dist；`npm run build`、上述五个测试文件共 134 项以及 18 个相关文件的空白检查全部通过，不依赖工作区其它任务的未提交改动。
- `git diff --check`：通过。`npm run validate:whitespace` 报告未修改的根目录 `AGENTS.md:8` 存在尾随空格；本次执行计划和代码改动不涉及该文件。
- 未运行 Chromium 或 Extension Development Host：仓库中的 `chromium-playwright-smoke` runner 要求独立 Web 前后端、登录 API 和页面路由，本扩展 Webview 没有该入口；当前环境也未发现 `code` 或 Chromium 可执行文件。定向 Webview harness 覆盖首态运行标记和终态清理，但不能替代宿主内视觉验证。
- 功能清单、能力规格、运行时设计和 Ontology 已随行为变化同步。

## 任务列表

Tasklist:
- [completed] 修复首次标签身份和运行状态投影
- [completed] 补充定向回归并完成构建及 ontology 校验
- [completed] 记录浏览器验证边界并归档执行结论

## 当前结论

首次标签投影已带当前子任务身份并显示宿主活动运行态，不依赖首条模型输出、会话历史读取或定时巡检；启动事件顺序也保证新 tab 已发布后才开始。定向回归、构建及 ontology 校验通过。真实 Extension Development Host 视觉验证未执行，原因与可替代证据见“实现与验证”。工作区仍有 Loop+ 显式依赖调度等未提交改动，本计划归档不包含其状态调整。
