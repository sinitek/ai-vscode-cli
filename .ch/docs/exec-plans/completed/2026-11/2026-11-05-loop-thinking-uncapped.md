# 移除 Loop/Loop+ 子任务思考力度上限

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex

## 背景与目标

用户要求删除“Loop/Loop+ 子任务最大思考力度”配置，子任务按用户提交的角色思考力度执行，不再将 max/ultra 截断为 xhigh。

## 范围与非目标

- 移除设置 UI、面板协议、持久化字段、宿主读取和执行限幅逻辑。
- 保留原有 CLI 能力校验、角色选择、未选择时的默认行为及跨 CLI/config 隔离。
- 旧 settings.json 中的上限字段读取时忽略；不主动改写用户文件。
- 不修改工作区已有的模型导入、群聊弹窗等未提交改动，不发布扩展。

## 验收标准

- 工具设置不再显示或发送上限配置，旧上限消息不再持久化。
- 经典 Loop 和 Loop+ 子任务的合法显式力度（含 max/ultra）不再被插件限幅，主任务行为不变。
- 旧字段不进入归一化设置或面板状态；相关测试、构建及 ontology 校验通过。

## 影响面与风险

- src/toolSettings.ts、sessionMessageActions.ts、panelStateBuilder.ts、extension.ts、extensionHost 和 Webview 设置链路。
- 相关单测、产品清单、CLI 运行时参考和 ontology 角色启动规则。
- 风险：移除限幅时意外改变默认力度；以显式值、空值、非法值、跨 CLI 及角色路由回归测试保护。
- 回滚：仅回退本计划对应变更，保留原有工作区修改。

## 验证计划

- npm run build，然后运行设置/消息/Webview/角色路由最小相关 node:test。
- 通过本机 Chromium 渲染实际 Webview，检查设置入口已移除、邻近控件保留、无浏览器异常。
- ontology --validate 与其 Python 单测；git diff --check。
- 不调用真实付费模型，不以模拟验证冒充真实 CLI 端到端结果。

## 任务列表

Tasklist:
- [completed] 定位配置入口与力度限制链路
- [completed] 移除配置并保持用户提交力度
- [completed] 执行验证并同步相关文档

## 测试与清单同步

- 已补充七种 CLI 的全部合法显式力度、同/跨 CLI、高档角色存储值、空值与非法值回退测试；Loop+ 生产调度夹具覆盖 fullstack/max 与 split/ultra 派发执行验收。
- 已更新旧设置/消息忽略、面板状态不含旧字段、静态页面移除入口和运行时脚本夹具；删除限幅模块及全部生产引用，并同步真实路由验证脚本的已删除参数（只检查语法，不调用付费模型）。
- 已同步功能清单、详细能力规格、CLI 运行时参考及 ontology 角色启动规则。架构依赖边界不变，不另改 ARCHITECTURE.md；其中原有未提交改动保留。
- 不新增热区记忆或 EVENT_MEMORY：本次是已有规则的范围明确变更，事实源和本计划足以留痕。

## 验证结果

- `npm run build`：通过。首次编译暴露测试使用 ES2022 Object.hasOwn 及缺少 OpenCode 夹具字段，归类为本次测试实现缺陷，已改用现有 ES2020 API 并补齐字段后重跑通过。
- `node --test dist/test/loop/loopSubtaskThinking.test.js dist/test/extensionHost/loopModelRouting.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/cli/grokmodelselection.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/chatCopy.test.js dist/test/webview/finalAnswerPolicy.test.js`：306/306 通过。
- `node --test dist/test/loop/loopOrchestrationOwnership.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopPromptQueue.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`：131/131 通过；合计 437 条相关 Node 单测通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- Chromium smoke 使用当前构建生成的完整 Webview HTML 与模拟 VS Code bridge，本机 HTTP 服务不连接真实用户数据。`run_smoke.mjs --scenario .tmp/loop-thinking-smoke.json --playwright-install-root /tmp/loop-thinking-playwright` 在 1440×1000、620×1000 均通过；上限控件不存在，邻近 Loop 轮次/派发/验收控件可见，浏览器、HTTP 和网络错误均为空。已检查截图；主题未模拟，结果仅证明结构与交互，不代替 VS Code 主题视觉验收。结果位于 `/tmp/loop-thinking-smoke-desktop/result.json` 与 `/tmp/loop-thinking-smoke-narrow/result.json`。
- Impeccable 机械检测：无命中；`node --check scripts/verify_loop_model_routing.js` 与 `git diff --check`：通过。
- 未执行真实付费 CLI 调用或 Extension Development Host 端到端验收，不将调度夹具/浏览器模拟视为真实模型结果。临时 smoke 场景已删除，开发 HTTP 服务已停止；临时 Playwright 依赖不进入项目依赖。

## 当前结论

已移除配置、持久化、面板协议和运行时上限链路。经典 Loop 与 Loop+ 共用角色力度解析器，不再截断用户提交的 max/ultra；原生 CLI 能力校验、角色隔离与默认行为不变。旧字段读取忽略，不主动改写用户配置。已归档，无待办。
