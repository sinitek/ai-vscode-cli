# 任务停止与对话标签响应延迟

- 日期：2026-11-15
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-15-bugfix-subtask-completion-tab-cleanup.md`；共享工作区，成功收尾与关页由该计划独立处理，本计划保留其修改及已有 Loop+ 显式恢复修改。

## 背景与目标

用户反馈主任务中止连带子任务停止、关闭子任务标签、切换标签均有明显延迟，内容尚未出现时缺乏加载反馈。修复造成等待的同步工作和刷新顺序，不截断消息或回放。

## 范围与验收

- 停止请求绑定点击时的标签，主任务停止覆盖所属子任务，取消先于昂贵的持久化及刷新。
- 标签关闭及时确认；聊天内容不等待全 CLI 配置刷新。
- 长对话渲染让出浏览器执行权，切换及未加载对话有主题化中文加载动画；快速切换不能串台。
- 保留现有 CLI 配置恢复、运行中关闭保护、完整消息、工具折叠和滚动语义。

## 影响面、风险与缓解

宿主会话消息处理、交互运行停止、Webview 渲染及测试。配置恢复与消息展示分离必须保持标签身份校验；分批渲染需要代际取消和失效检查。保留已有未提交修改，在当前工作区做局部修改以包含这些运行时前置修复，不另建缺少这些变更的 worktree。不更换框架、不发布扩展、不修改用户运行记录。

## 实现与关键决策

- 用户中止消息携带点击时的 `tabId`。经典 Loop 主标签先停止同一父任务的全部活动运行；内部 `preemptActivePromptRun` 优先局部取消当前调用，防止误停整个父任务。Loop+ 先关闭内存调度门并取消主、子调用，再持久化停止状态。
- 切换标签及关闭活动标签后的回退先发送目标标签消息，再恢复配置及刷新全量状态；后台关闭继续使用现有轻量确认路径。未改变运行中关闭保护和配置恢复规则。
- Webview 区分尚未加载和已加载空会话；等待首个消息快照或长历史渲染时显示主题化的「正在加载对话」及旋转动画，提供状态语义和 `aria-busy`，减少动态效果时保留静态提示。
- 长历史每批最多创建 48 条消息并让出浏览器执行权。连续指令跨批保持同一折叠组，单条指令保持独立；代际检查取消过期批次，未完成视图不缓存。没有添加人为等待时长。

## 任务列表

- [completed] 定位停止与标签响应阻塞
- [completed] 修复刷新顺序、取消路径与加载反馈
- [completed] 回归验证并同步功能清单、设计与本体

## 验证与验收结论

构建及下列 11 文件共 533 项回归全部通过。新增或更新覆盖中止目标、停止顺序、切换及关闭时消息发送顺序、未加载状态、长历史分批、快速切换取消和连续指令组。

```bash
npm run build
node --test dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js
node --test dist/test/webview/conversationTabClose.test.js dist/test/webview/tabRunStatus.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/session/conversationTabConfiguration.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
node /Users/fangjiawei/.codex/skills/impeccable/scripts/detect.mjs --json src/webview/viewContentScript/messageRendering.ts src/webview/viewContentScript/coreRuntimeState.ts src/webview/viewContentStyles/chatArea.ts
git diff --check
```

- 第一组 463/463，第二组 70/70；日志为 `.tmp/conversation-response-final-tests.log`、`.tmp/conversation-response-additional-tests.log`。
- ontology 校验通过（140 条规则），ontology Python 单测 9/9；界面机械检测无发现，差异空白检查通过。
- 早期内部抢占回归归类为实现缺陷：改为优先局部取消后通过。新增浏览器/单测夹具中标签身份与计时器选择问题归类为夹具问题，校正后通过；最终没有未解决的定向测试失败。

### Chromium 页面验收

通过 `getWebviewHtml` 生成完整 Webview，在 headless Chromium 中以隔离的内存宿主桥执行断言，并使用 `chromium-playwright-smoke` runner 检查加载状态。临时执行命令为 `node .tmp/conversation-webview-smoke.cjs`，内部调用 `node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/conversation-browser-smoke-scenario.json`；执行器与场景在收尾时移除，保留结果和截图。

- 首个快照到达前加载提示可见，动画运行；减少动态效果时停止旋转。
- 120 条历史完整渲染，本次夹具约 31ms；600 条连续指令跨批保留同一折叠组，快照事件同步处理约 3.2ms。数字仅代表本机夹具，不能推算真实 CLI 或所有消息复杂度的耗时。
- 分批期间快速切换不串内容，后台关闭确认正常；420px 窄窗口加载提示不越界。
- 浏览器、HTTP 请求和 Webview bridge 无错误；截图已目视检查。
- 结果：`.tmp/conversation-browser-smoke/browser-result.json`、`.tmp/conversation-browser-smoke/runner/result.json`。
- 截图：`.tmp/conversation-browser-smoke/loading.png`、`loading-narrow.png`、`history-rendered.png`、`commands-rendered.png`（均位于同一证据目录）。
- 600 条指令夹具显式设置 `chatMessageLimit: 1000`，避免原有历史清理策略影响分批完整性断言；产品默认清理规则未改。

### 验收边界

宿主取消顺序和标签消息顺序由定向回归验证，完整 Webview 在真实 Chromium 验证。未验证已安装 VS Code 扩展中的真实 CLI 中止耗时，也未在 Windows/Linux 实机运行。没有安装、发布扩展或修改用户运行数据。

## 文档与记忆收尾

- 已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 的标签切换、关闭和主任务停止行为。
- 已同步 `vscode-cli-extension-runtime.md`、`loop-plus-scheduling.md` 及 `cli-plugin-runtime.json` 中的对应事实来源和规则。
- 用户停止与内部抢占不能共用父任务停止语义的经验已进入 `.ch/docs/runbooks/PITFALLS.md`。本次不再重复写入热区或 `EVENT_MEMORY.md`。
- 架构边界与技术栈未变，无需更新 `ARCHITECTURE.md`。回滚时按上述停止、标签消息及 Webview 改动边界分别恢复，避免回退关联计划或工作区其它任务修改。
