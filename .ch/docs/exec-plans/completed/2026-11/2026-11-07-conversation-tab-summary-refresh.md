# 对话 Tab 摘要随新任务刷新

- 日期：2026-11-07
- 状态：completed
- 负责人：Codex

## 背景与目标

现有摘要按 Tab 首次提交生成一次，后续新任务仍显示旧摘要。改为每次新的用户可见任务执行时异步更新，保留原浮层和非阻塞执行方式。

## 范围与非目标

- 范围：提交快照、任务级去重、过期请求隔离、回归测试及规格/设计/ontology 同步。
- 非目标：浮层样式、Tab 标题、摘要协议、CLI 适配器、用户配置；不触碰工作区已有的 Loop+ 修改，不执行发布脚本。

## 验收标准

- 同一 Tab 已有摘要或绑定历史 session 后，新任务仍能生成并持久化新摘要。
- 同一任务重试及 Loop 内部调度复用提交快照，只尝试一次。
- 新任务替换旧在途请求，旧结果不得覆盖新摘要；不同 Tab 相互隔离。
- 新摘要失败、超时或容量溢出时保留上次有效摘要；hover/刷新不发起生成。
- 构建、相关单测与 ontology 校验通过，补充真实 Chromium 浮层刷新验证。

## 影响面与风险

- 代码：`src/conversationTaskSummary.ts`、`src/extension.ts`、`src/test/session/conversationTaskSummary.test.ts`。
- 文档：功能清单、运行时设计、详细规格及 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 风险：Loop 内部预加载被误判成新提交、旧请求迟到覆盖；通过显式可见提交边界、提交对象去重、请求代际和取消处理缓解。
- 回滚：仅撤销本计划范围内的增量，不覆盖已有工作区修改。

## 验证计划

- `npm run build`
- `node --test dist/test/session/conversationTaskSummary.test.js dist/test/webview/conversationtabsummarytooltip.test.js`，再扩大到会话相关回归。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- 使用当前构建完整 Webview + mock VS Code bridge，在真实 headless Chromium 验证宿主摘要更新后的浮层文本与 hover 无额外请求；不冒称完整扩展宿主或真实 provider 端到端。

## 测试与文档同步

- 单元测试：新增 5 项测试，覆盖扩展真实预加载/快照函数（历史会话、相同文字重提、Loop 内部预加载）、连续任务存档同步、旧请求取消、失败后新任务、容量溢出；同步原一次性用例为同提交去重。
- 构建：`npm run build` 通过。
- 最终相关回归：`node --test dist/test/session/*.test.js dist/test/extensionHost/scheduledTaskConfigOwnership.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/webview/conversationtabsummarytooltip.test.js`，280/280 通过；日志 `/tmp/conversation-summary-refresh-related.log`。
- 扩展回归失败分类：首次扩大到 `dist/test/extensionHost/promptSessionHealth.test.js`，338 项中 281 通过、57 失败，均为其 VM 夹具缺少既有 `rememberConversationTaskSummarySubmission` mock。用 `git show HEAD:src/extension.ts` 替换该测试读取的源文本（内存拦截，不改工作区）独跑该文件，59 项中同样 2 通过、57 失败，确认历史夹具问题；日志 `/tmp/conversation-summary-refresh-unit.log`、`/tmp/conversation-summary-refresh-baseline.log`。未为绿灯修改无关夹具。
- Chromium：`node /tmp/conversation-summary-refresh.4NTfej/browser-check.cjs` 使用当前构建的完整 Webview 与实际摘要协调器、mock VS Code bridge/AI 返回值，在 960×720 / 280×640 × 深/浅主题四组合通过；验证 999/1000ms、生成中保留旧摘要、已显示浮层连续更新、同提交去重、存档同步、Tab 布局不变、边界、Escape、hover 无摘要请求，浏览器/网络错误均为空。结果与截图 `/tmp/conversation-summary-refresh.4NTfej/result.json` 及同目录 PNG；已目视检查窄屏深色与宽屏浅色截图。初次启动因 Playwright 默认 headless-shell 缓存缺失失败，改用现有 Chromium 可执行文件后通过，未安装依赖或修改项目版本。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；范围内空白与 diff 检查通过。
- 功能清单、设计、规格与 ontology 已同步；不新增配置、样式或消息协议。
- 验证边界：CLI 适配器未改动，本轮未调用真实 provider 或完整 VS Code 扩展宿主，不把受控浏览器测试声称为完整端到端；未跑无关全量测试。
- 记忆判断：本轮变更回到规格/设计和本计划，不另写热区记忆或事件记忆。

## 当前进展

已完成任务级刷新，移除首次会话/摘要门禁，按新提交快照去重并取消同 Tab 旧请求，生成失败保留原摘要。Node/TypeScript 构建、相关 280 项回归、ontology 和 Chromium 四组合通过；历史 VM 夹具失败已复现分类。既有工作区 Loop+ 变更保留，无额外热区记忆更新。
