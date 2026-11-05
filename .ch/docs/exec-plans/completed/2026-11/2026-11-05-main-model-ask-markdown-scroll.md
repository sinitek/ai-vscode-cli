# 主模型提问弹窗 Markdown 与自动滚动

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex

## 背景与目标

“向主模型提问”已有共享 Markdown 函数，但弹窗单独拼接渲染结果，且离开底部后新问题或回答不会自动滚到底部。统一使用群聊的 Markdown 挂载入口，并在新内容出现或重新打开弹窗时定位到最新消息。

## 范围与非目标

- 范围：提问气泡挂载、滚动、回归测试、功能清单与本体同步。
- 非目标：不改变主模型调用、忙碌锁、历史持久化、群聊主时间线滚动策略或技术栈；保留当前工作区其他修改。

## 验收标准

- 用户、回复气泡使用群聊同一 Markdown 挂载链路，支持标题、列表、表格、代码和 JSON 等现有能力。
- 用户问题、等待气泡、回复更新后，即使此前滚离底部，也自动显示最新内容；重新打开亦滚到底部，异步图片加载后继续校正。
- 无变化的周期更新不打断用户阅读，隐藏弹窗不主动滚动。
- 相关单测、`npm run build` 和本机 Chromium 页面验证通过。

## 影响面与风险

- 代码：`src/webview/loopGroupChatPanel.ts`、相关回归测试。
- 文档：功能清单、ontology；架构边界不变，无需更新 `ARCHITECTURE.md`。
- 风险与缓解：利用现有 HTML 缓存判断内容变化，避免每次刷新都拉到底部；布局完成后再次校正滚动；Markdown 继续使用既有转义与安全边界。
- 回滚：仅撤回本任务涉及的气泡/滚动及对应测试与文档修改。

## 验证计划

- `npm run build`
- `node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/webview/chatMarkdown.test.js`
- 本机 headless Chromium 加载生成的 Webview HTML，检查 Markdown、消息更新、打开/隐藏和滚动；不调用真实主模型或修改用户数据。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 及范围内空白检查。

## 测试与清单同步

- 新增弹窗真实共享 Markdown 挂载及滚动回归测试：用户/回复/系统气泡、等待态、正文增长、无变化刷新、隐藏、重开、下一帧及图片高度变化。
- `npm run build` 通过；最小两组回归 42/42 通过；扩大到群聊、线程、协调器、Markdown 与图片相关测试 89/89 通过。
- 扩大验证命令：`node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopAskThread.test.js dist/test/loop/loopGroupChat.test.js dist/test/webview/chatMarkdown.test.js dist/test/webview/chatImagePreview.test.js dist/test/webview/chatImageResource.test.js`。
- 本机 headless Chromium 在 1280×900 与 420×900 均通过：真实生成 HTML、模拟 VS Code 消息桥，验证 Markdown、用户/回复/等待、JSON 树、SVG、无变化更新及重开置底，最终底部距离均为 0；标准 skill runner 额外验证布局无重叠、弹窗在视口内，无浏览器或网络错误。截图已人工检查。
- 浏览器命令：`node .tmp/main-model-ask-smoke/browser.cjs`；结果：`.tmp/main-model-ask-smoke/dynamic-result.json` 与 `standard-1280/result.json`、`standard-420/result.json`；证据为本机临时产物，不入库。
- 失败分流：原先依赖 `renderMarkdown(message.content` 字符串的旧断言因挂载链路调整过期，已更新并重跑；Chromium 发现 SVG 解码晚于下一帧的实现缺陷，已补捕获 `load` 校正并复测。原有临时 Playwright 目录残缺属于环境问题，改在 `/tmp/sinitek-ask-playwright` 隔离安装，不改仓库依赖。
- ontology 校验、范围内空白检查通过；Impeccable 检测未报告问题。
- 更新功能清单、共享 Markdown 本体规则与图片延迟加载 runbook。
- 记忆判定：稳定行为写入清单/本体，不额外写入记忆热区或事件记忆。

## 当前结论

实现及验证完成；未调用真实主模型、未启动真实 Extension Development Host，也未进行 Windows 原生实机验证；改动不新增平台相关路径或 API。保留工作区其他任务修改。架构与 CLI 调用不变，不额外更新架构或事件记忆。
