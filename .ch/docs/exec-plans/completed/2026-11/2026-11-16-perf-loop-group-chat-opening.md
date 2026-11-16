# 主任务群聊打开性能优化

- 日期：2026-11-16
- 类型：perf
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

点击主任务 Tab 后，普通聊天先同步重绘消息；宿主随后等待模型选项、构建群聊状态和完整 HTML，浏览器再同步挂载所有 Markdown。目标是尽早切换群聊并显示加载动画，长内容渲染期间保持响应。

## 范围与非目标

调整主任务入口时序、群聊首次加载、Markdown 分批挂载及单次状态构建的 transcript 读取复用。保持群聊内容限额、补充需求与验收锚点保护、任务调度、模型配置和主题契约。

## 验收标准

- 群聊加载壳在模型选项与 transcript 构建前显示，并在首帧绘制后通知宿主继续。
- 已打开的群聊立即 reveal，保留现有内容；并发打开合并，关闭期间的异步结果不复活页面。
- 大量 Markdown 首次挂载分批让出主线程，加载完成收起提示；失败可重试。
- 相关回归、构建及无头 Chromium 长内容验证通过，记录优化前后测量。

## 影响面与风险

- `src/webview/loopGroupChatPanel.ts`、样式及主任务 Tab 入口；`src/extensionHost/loopGroupChatPanelCoordinator.ts`。
- 异步关闭、并发打开及 ready 握手需回归；通过面板实例身份校验和等待释放防止过期写入。
- 保留现有增量补丁、滚动、问答、澄清及验收逻辑。回滚可恢复原打开时序。

## 验证计划

- `npm run build` 后执行群聊面板、协调器、主任务 Tab 与相关 Markdown/Loop+ 回归。
- 生成脱敏合成长群聊，用 Chromium 测量首屏与 Markdown 挂载耗时、让出主线程情况，并检查宽窄屏及加载失败。
- 更新功能清单与群聊状态边界文档，按 ontology 规则同步输入输出时序说明并校验。

## 当前进展

已使用 memory-recall（focus：Loop 群聊 tab 渲染 性能；无 anchor）、ontology 和 CodeGraph 定位，直接源码确认上述串行阻塞。CodeGraph 存在未解析引用，当前源码与测试作为最终依据。全部验收完成，已同步功能清单、能力规格、群聊状态设计及 ontology。

## 测试与清单同步

- 最终 `npm run build` 通过；下列相关单测 341 项全部通过，无跳过：

  ```sh
  node --test --test-timeout=30000 dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanelState.test.js dist/test/webview/conversationtabsummarytooltip.test.js dist/test/loop/loopmaingroupchatbutton.test.js dist/test/loop/loopGroupChatAcceptance.test.js dist/test/loop/loopGroupChatBubbleRetention.test.js dist/test/webview/chatMarkdown.test.js dist/test/loop/loopCommunicationFilePreview.test.js dist/test/session/conversationTabPagination.test.js dist/test/webview/clipagescriptruntimecoverage.test.js
  ```

- 新回归覆盖首次加载握手、已有页面立即 reveal、关闭释放等待、旧页面消息隔离、并发打开去重、异步阶段关闭、读取失败、最新任务快照、Markdown 分批完成、主任务点击/Enter/Space 的优先打开顺序及 transcript 单次读取/跨刷新更新。
- 失败分流：同步 Markdown 的 VM 夹具未提供 `performance`，将时钟读取限定在异步分批路径后通过；旧测试匹配同步调用和先选标签再开群聊，按新时序更新断言后通过。
- 额外执行 `loopPlusGroupChatPanel.test.js`：14 通过、2 失败，均期待没有运行所有权时出现 `stopTask` 按钮。用 `git show HEAD:src/webview/loopGroupChatPanel.ts` 经 TypeScript `transpileModule` 编译、模块加载拦截替换为修改前实现，再执行同一测试，仍为相同两项失败，归为历史基线而非此次回归。证据：本地 `.tmp/group-chat-opening/tests-baseline.log`。没有扩大修改既有停止权限。
- 真实生成的 Webview HTML + 模拟 VS Code 消息桥在 headless Chromium 验证：首帧先于 loadingReady、加载错误文本安全显示与重试、减少动态效果、181 个气泡和 4320 个 Markdown 小节全部完成、无未挂载源节点、问答 Markdown、窄屏成员抽屉。浏览器页面错误、控制台错误与请求失败均为 0。
- 使用 `chromium-playwright-smoke` 运行结构化场景，1280×800 与 390×844 两组通过；桌面核对头部与内容区无交叠，窄屏核对抽屉及视口边界，已查看截图。测试服务仅返回合成 HTML，不读取用户配置、任务或 CLI 会话。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；ontology 的 9 项 Python 测试通过；`git diff --check` 和改动文件空白校验通过。
- Impeccable 静态检测仅提示既有 blockquote 的 3px 左边框，来自未修改样式；新增加载反馈未引入硬编码颜色。
- 功能清单、能力规格、设计、ontology 已同步。没有依赖版本或平台路径变化。
- 长期记忆：优先在设计文档沉淀加载握手与生命周期约束，无需重复写入热区。

## 性能证据与边界

本机同一合成数据（181 个气泡、4320 个 Markdown 小节）的单次 headless Chromium 对照：修改前完整页面 ready 约 258ms、最长帧间隔 215ms；分批后 ready 约 511ms、最长帧间隔 82ms，内容数量一致且无页面错误。分批主动让出执行机会，总完成时间增加，换取加载反馈与交互响应；这些是单次样本，不作稳定速度提升或实际安装环境的 SLA。

增加 VS Code 主题变量的浏览器验收样本：轻量壳首个 paint 约 60ms、loadingReady 约 79ms、contentful paint 约 84ms；完整内容 ready 约 535ms，最长帧间隔约 98ms。两次导航是分开的，不能把壳与完整页面的时间直接当作真实 VS Code 点击延迟。

状态构建原本对同一 transcript 读取 3 次，现为 1 次，计数回归同时验证后续刷新仍看到新内容。单个超长气泡内的 Markdown 解析仍为同步，未引入工作线程或改变内容。验证平台为 macOS，未在已安装扩展宿主或 Windows 实机执行；变更复用现有 VS Code API、浏览器任务调度及文件读取端口，无新增平台分支。全量单测和真实 CLI 调用不属于本次验证范围。

本地验证产物位于 ignored 的 `.tmp/group-chat-opening/`：`baseline.json`、`optimized.json`、`browser-result.json`、`tests-final.log`、`smoke-desktop/result.json`、`smoke-mobile/result.json` 及截图。任务专用场景完成后删除，测试服务已关闭。

## Git 同步后复验

用户要求提交推送时，本地落后远端 2 个提交；本次优化提交无冲突地 rebase 到 `f1e15cee`（包含 `7302702e` 的 Windows 及历史夹具修正）。同步后重新执行 `npm run build`、ontology 校验及上述相关单测，并增加 `dist/test/loop/loopPlusGroupChatPanel.test.js`，共 358 项全部通过，无失败或跳过。此前两项 Loop+ 历史失败随远端夹具修正一并通过，原始失败记录仅保留为实施时的基线证据。复验日志：本地 `.tmp/group-chat-opening/tests-after-sync.log`。
