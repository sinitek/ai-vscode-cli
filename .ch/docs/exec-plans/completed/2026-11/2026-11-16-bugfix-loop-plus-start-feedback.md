# Loop+ 启动等待反馈

- 日期：2026-11-16
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：无；保留工作区已有 Loop+ 修复与并发设置改动。

## 背景与目标

Loop+ 发送后没有立即反馈；请求处理在预加载用户消息与开始编排前等待完整面板刷新，刷新会读取全部 CLI 配置与模型。移除这次展示等待，并在聊天内立即显示等待气泡。

## 范围与非目标

覆盖 sendPrompt 请求、Webview 临时等待状态、主题动画及回归。保留真实配置校验、执行所有权与调度规则，不改变 CLI 或技术栈，不发布扩展。

## 验收标准

- 验收方案确认并真正发送后立即显示气泡，取消或本地拒绝不显示。
- 完整面板刷新未完成时，Loop+ 仍可开始编排；配置校验继续阻止过期配置执行。
- 开始调用后继续等待模型输出；回复、提前退出、异常及运行终态清除反馈。
- 切换标签不串状态，旧请求回执不能清除新请求；临时状态不写入聊天历史。
- 复用主题和三点动画，支持减少动态效果。

## 影响面、风险与缓解

- 影响：src/sessionMessageActions.ts、src/webview/ 及相关测试；同步功能清单、设计与 ontology。
- 风险：异步旧回执或刷新影响新状态。用请求 ID 匹配，后台刷新单独捕获失败；等待气泡与持久消息分离。
- 原工作区已有大量未提交改动；直接保留并做局部增量修改。

## 验证计划

- npm run build
- Node 最小 session/Webview 回归，并按实际影响补充 Loop+ 集成测试。
- 使用 chromium-playwright-smoke 与真实生成的 Webview HTML 检查即时等待、切换、失败、窄屏、减少动态效果与浏览器错误。
- ontology --validate、必要 ontology 单测和改动范围空白检查。

## 任务列表

- [completed] 查明展示刷新位于启动关键路径且前端没有提交等待状态
- [completed] 修复启动等待与气泡生命周期
- [completed] 完成验证、事实来源同步与归档

## 决策记录

- 2026-11-16：仅 Loop+ 请求启用即时反馈，使用独立临时气泡；不将占位文本写入用户消息历史。
- 2026-11-16：准备状态计入目标 Tab 忙碌保护；首次正文/思考输出、运行终态或匹配的宿主回执结束等待。未开始时忽略旧运行输出和终态，旧回执不能结束新等待。

## 实现与事实来源同步

- `src/sessionMessageActions.ts`：Loop+ 不再等待启动前完整面板刷新，刷新失败独立记日志；带 `requestId` 的发送始终回传对应 Tab 与 ID，覆盖配置拒绝、提前返回和异常。
- Webview：在实际发送处立即建立每个 Tab 的临时提交状态，复用助手气泡和三点动画；运行开始后切换等待文案，输出或结束后清除。支持减少动态效果，不写入历史、导出或模型上下文。
- 回归覆盖展示刷新悬挂时仍启动编排、拒绝/异常回执、状态刷新和切 Tab、旧回执与旧运行终态，以及首次正文/思考输出清理。
- 已同步 `.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `plugin.rule.loop_plus_submission_feedback`。
- 未改变架构边界或部署方式，无需修改 `ARCHITECTURE.md` 或运行手册。稳定结论已进入设计文档和 ontology；不重复写入记忆热区，也不新增自动滚动摘要或事件记录。

## 验证结果

- `npm run build`：通过，最终测试夹具修改后再次构建通过；日志 `.tmp/loop-plus-start-feedback/build-regression.log`。
- 最小 session/Webview 六文件回归：371/371 通过。
- `node --test dist/test/webview/loopPlusModeEntry.test.js dist/test/webview/looppluswebviewintegration.test.js`：13/13 通过；日志 `.tmp/loop-plus-start-feedback/fixture-regression.log`。
- `node --test dist/test/webview/*.test.js dist/test/session/sessionMessageActions*.test.js dist/test/session/conversationTabRunningFlow.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js`：693/693 通过，无失败、取消、跳过或 TODO；日志 `.tmp/loop-plus-start-feedback/webview-regression-fixed.log`。
- `python3 verify_mac.py --report .tmp/loop-plus-start-feedback/native-verified.json`：退出 0，71 文件共 1209/1209 通过，默认三轮 Codex 隔离交接及公共 runner 交接通过。macOS arm64、Node 24.22.2、默认 PATH Codex 0.167.2；报告源码 commit `6df0bfc28da5d35d00ee715745135134f331303e`、dirty=true。验证前后 686 个源码/测试/脚本指纹一致（`source-before.json`、`source-after.json`）；之后仅修改上述两个不在原生验证清单内的 Webview 测试夹具，生产源码和原生验证所执行文件均未变化，故保留原生证据并针对变更重建、重跑 693 项。最终指纹 `.tmp/loop-plus-start-feedback/source-final.json`。
- `node .tmp/loop-plus-start-feedback/browser-check.cjs`：真实生成的 Webview HTML 在 headless Chromium 通过即时气泡、三点动画变化、取消不发送、切 Tab、start 后继续等待、首输出清除、旧回执、拒绝、窄屏、减少动态效果、无历史占位与零浏览器错误。发送到气泡可见约 4.5ms，仅代表本机浏览器反馈，不代表模型启动时间。结果 `.tmp/loop-plus-start-feedback/browser-result.json`；截图 `waiting-desktop.png`、`waiting-narrow.png`。
- `PLAYWRIGHT_MODULE_PATH=/tmp/zq-playwright-smoke/node_modules/playwright node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/loop-plus-start-feedback/scenario-desktop.json`，以及对应窄屏场景：均通过，零浏览器/网络错误；报告在 `.tmp/loop-plus-start-feedback/smoke-desktop/` 和 `smoke-narrow/`。已检查截图，已移除临时场景并关闭本轮 HTTP 服务。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（141 条规则）；ontology 单测 9/9 通过。Impeccable 检查结果 `[]`，记录 `.tmp/loop-plus-start-design.json`。
- `git diff --check` 与改动文件定向空白校验：通过。

## 回归失败分类与处理

- 首次原生回归中 `tabRunStatusHarness` 未加载新增的等待辅助函数，分类为夹具问题；补齐生产辅助函数后完整默认三轮原生验证通过。旧失败报告 `native-final.json` 不作为成功证据。
- 扩大 Webview 回归首次 690/693：两个 `loopPlusModeEntry` 用例缺少新增渲染辅助函数，另一个集成用例未模拟上次发送的宿主回执，导致新的准备忙碌保护阻止后续队列发送。均为新增生命周期所需的夹具更新；补齐界面端口并通过生产 `settlePromptSubmission` 模拟回执，未移除生产忙碌保护。随后最小 13 项与扩大 693 项全部通过。

## 验证边界

原生报告 `fullyVerified=false`。未执行真实付费模型、已安装扩展/图形 Extension Development Host 端到端、Windows/Linux 本机验证或全仓全部单测；本次证据覆盖 macOS 源码、隔离 CLI 运行时及生成 Webview 的浏览器交互。没有发布或安装扩展。

## 当前结论

源码修复、回归、浏览器与本机隔离验证及事实来源同步均已完成，无未决实现事项。
