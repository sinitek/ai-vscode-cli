# 历史会话子任务过滤

- 日期：2026-11-10
- 状态：completed
- 负责人：Codex

## 目标与范围

在“历史记录 → 历史会话”增加默认勾选的“过滤子任务”，勾选隐藏 `taskRole=subtask` 的会话，取消勾选恢复展示；复用现有主题与复选框样式，兼容搜索与旧会话。

非目标：不改变任务识别、历史存储、历史提示词、加载、导出或删除行为；不新增全局设置。

## 验收标准

- 首次初始化默认勾选；仅隐藏子任务，保留主任务、普通会话和未标记的旧会话。
- 切换立即刷新，与关键词搜索叠加；过滤后为空时展示无匹配提示。
- 开关只在历史会话页展示，切换历史页签或重新打开弹窗保持当前 Webview 内的选择。
- 完成构建、相关回归、浏览器验证及功能清单与 ontology 同步。

## 影响面与风险

- 代码：`src/webview/viewContentHtml.ts`、`src/webview/viewContentStrings.ts`、`src/webview/viewContentScript/`；测试：`src/test/webview/`。
- 文档：功能清单、会话能力规格、运行时 ontology。
- 风险：默认过滤可能被误认为数据丢失；提供可撤销开关与准确空态，不修改原始列表。
- 回滚：撤回新增复选框与前端过滤，无数据迁移。

## 验证计划

- `npm run build`
- `node --test dist/test/session/historySessionLoop.test.js dist/test/session/historySessionTaskRole.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js`
- Headless Chromium 使用合成会话验证默认值、切换、搜索、页签隔离、空态与窄屏布局。
- 浏览器工具仅在 `/tmp/zq-playwright-smoke` 安装 skill 固定的 `playwright@1.61.1`，复用本机 Chromium，不更改项目依赖。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`

## 实施结论

已确认 `SessionSummary.taskRole` 是现有历史会话子任务标识，前端复用该字段，不重复推断任务身份。开关仅保持在当前 Webview 内，重新初始化默认勾选，不新增持久化偏好。

已完成默认过滤、即时切换、搜索叠加与准确空态；复用现有主题和工具栏样式，未引入新依赖或平台相关路径。

## 验证结果

- `npm run build`：通过。
- 计划中的四个测试文件：186 项全部通过；新增 3 项运行时回归与默认勾选静态断言。
- 首轮 1 项失败分类为测试夹具断言错误：历史列表沿用 `OpenCode` 显示名称，测试误写为任务 Tab 的 `opcode`；修正期望，不改变现有 CLI 标签行为，重跑全部通过。
- `node .tmp/history-session-filter-smoke.cjs`：960px、390px Chromium 功能交互与 skill runner 均通过；验证默认勾选、取消恢复、搜索叠加、页签隔离、弹窗重开、纯子任务及空列表、视口和重叠检查。无浏览器异常、HTTP 错误或请求失败，已目视检查两张截图。
- 浏览器证据：`.tmp/history-session-filter-smoke/integration-result.json`、`.tmp/history-session-filter-smoke/960/result.json`、`.tmp/history-session-filter-smoke/390/result.json` 及相邻 `success.png`；任务场景 JSON 已移除。
- UI 机械检查 `detect.mjs`：无发现；`git diff --check`：通过；ontology `--validate`：通过。
- 未运行完整单测、真实 CLI 或 Extension Development Host：此次仅本地列表展示过滤，已用实际编译 Webview 和合成宿主消息做 Chromium 验证；真实 CLI 及存储路径未改动。未在 Windows/Linux 实机验证，新增逻辑无平台相关 API。

## 文档与记忆维护

已同步 `FEATURE_INVENTORY.md`、会话能力规格与 ontology 新规则。无架构边界或运行方式变化，无需改架构与 runbook；未产生可复用事故或迁移知识，不写入热区记忆、`ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`。
