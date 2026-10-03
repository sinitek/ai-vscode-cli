# AI 气泡流式追加渲染稳定性修复

- 日期：2026-10-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-03
- claim_ttl：本次会话
- handoff_to：

## 背景与目标

用户反馈 AI 气泡 append 内容时临时文字反复出现、消失，页面上下跳动。当前普通助手气泡在追加时用整段纯文本替换 Markdown，180ms 空闲后再切回 Markdown；最终回复和思考气泡也会在运行中暂停输出 3 秒时切换格式，后续追加又切回纯文本。

目标是去掉普通气泡的临时纯文本替换，保留原有流式响应速度、最终回复和思考文字，并减少运行中反复切换格式引发的高度变化。

## 范围与非目标

- 范围：Webview 助手追加渲染调度、对应回归测试、输出渲染规格与功能清单。
- 非目标：不修改 CLI 协议、会话路由重构、依赖版本、主题颜色和自动滚动策略。
- 当前已有路由重构与架构文档改动保持原样。

## 验收标准

- 普通助手气泡追加内容时不创建临时纯文本节点，Markdown 在既有 180ms 窗口内节流更新，连续追加不会无限推迟可见更新。
- 运行中的最终回复和思考气泡保持单一流式节点，空闲计时器不会反复切换为 Markdown；运行结束按现有流程完成格式化。
- 保留非运行态的 3 秒稳定后格式化、最终回复标识、任务列表过滤与 JSON 树渲染。
- 相关单测、`npm run build` 和最小 Chromium 页面验证通过。

## 影响面与风险

- 代码：`src/webview/viewContentScript/traceRendering.ts`、`src/webview/viewContentScript/windowMessageDispatch.ts`。
- 测试：`src/test/webview/clipagescriptruntimecoverage.test.ts`。
- 文档：功能清单、插件能力规格和本执行计划。
- 风险：节流不能变为无限延后的防抖；通过连续追加的计时器回归测试约束。
- 风险：运行结束遗漏格式化；通过 runStatus 结束事件回归约束。
- 回滚：仅回退本次渲染调度与测试改动，不涉及数据迁移。

## 验证计划

- 先新增回归测试，执行构建并确认旧实现失败。
- 最小单测：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/finalAnswerPolicy.test.js`。
- 扩展验证：`npm run test:page`；用本地 Webview HTML 与实际脚本执行 Chromium 追加内容场景，记录可见节点与布局。
- 本机验证不调用真实 CLI，不读取用户会话或私有日志。

## 测试与清单同步

- 单元测试：新增普通气泡连续追加、最终回复与思考气泡运行中停顿以及 end/error/stopped 收尾共 7 条回归；同步既有批处理断言，测试夹具显式注入 `setInterval`，防止真实 watchdog 计时器泄漏导致测试进程不退出。
- 构建：`npm run build` 多次通过；最终 `npm run test:page` 自带构建通过。
- 专项单测：`node --test --test-name-pattern='keeps ordinary assistant|keeps running .* bubbles stable|batches assistant delta|hides empty assistant|hides historical empty|hides whitespace-only|keeps thinking bubbles|thinking deltas continue|final-answer|renders a complete JSON' dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/jsonTreeMessageRender.test.js`，18/18 通过。
- 页面组：`npm run test:page`，231 项中 226 通过、5 失败。旧版英文 HTML 文案断言 2 项、旧静态 subagent 代码断言 1 项、旧静态页面文案 1 项、任务列表显示断言 1 项；用 `git show HEAD:<path>` 的两个未修改渲染模块经 TypeScript 转译注入 require cache 后，原样重跑这 5 项全部复现相同失败，确认是基线失败，未扩大修复范围。
- JSON 单测限制：完整 `jsonTreeMessageRender` 中 2 项因本机缺少已声明的 `json-formatter-js` 包而失败；JSON 容器判断专项通过。未安装或升级依赖，未更改 pnpm 布局、包清单或锁文件。
- Chromium：用现有 Playwright 缓存包与本机 Google Chrome，生成实际 Webview HTML、仅替换 VS Code bridge；宽 460px 高 850px 页面连续 17 次追加采集 7 次 DOM 更新，临时纯文本节点始终为 0，正文高度没有向下缩回。思考与最终回复分别暂停 3300ms 后仍复用原节点与高度；收尾转换为 Markdown；同一事件循环内追加后 stopped，未执行流式帧被取消。浏览器错误为 0，已查看截图。
- 浏览器复现命令：`node /tmp/sinitek-chat-stream-smoke.cjs`；机器本地产物：`/tmp/sinitek-chat-stream-artifacts-20261003/result.json` 与三张 PNG，不提交仓库。未用 Extension Development Host 调真实 CLI；真实编辑器环境仍需重新加载插件后体验确认。
- 功能清单与规格：同步 `FEATURE_INVENTORY.md`、能力规格与运行时设计，明确普通 180ms 节流和实际运行态的格式稳定边界。
- Ontology：同步 JSON 气泡规则里的增量格式化时机，`search_ontology.py --validate` 通过。
- 长期记忆：可复发根因和防回归方式已上提到 `PITFALLS.md` 与运行时设计，不重复写热区或事件记忆；不更新 `ROLLING_SUMMARY.md`。
- 国际化：无新增文案或按钮，无需修改中英文资源。

## 当前阶段

修复和专项验收完成；未改依赖版本、主题、CLI 协议、会话持久化或现有路由重构。页面组 5 条基线失败与缺失 JSON formatter 的环境限制已记录；本任务无剩余实现事项。
