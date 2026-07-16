# 携宁 CLI 页面单测覆盖率口径与执行计划

- 日期：2026-07-15
- 状态：completed
- owner：cli-page-coverage-integration
- 目标：为“携宁 CLI 页面也要单测覆盖率 100%”建立可重复口径、命令入口并完成严格覆盖率门禁。

## Tasklist

- [x] 使用 CodeGraph 探索 `src/webview` / 配置页入口与测试覆盖现状。
- [x] 盘点现有 `node:test` 页面相关测试和 `c8` 依赖。
- [x] 新增页面测试入口 `test:page` 与严格覆盖率入口 `test:page-coverage`。
- [x] 定义页面覆盖率白名单、非目标和验收标准。
- [x] 接入页面补测文件并运行严格 100% 覆盖率门禁。
- [x] 归档执行计划到 `completed`。

## 背景

仓库已完成核心后端链路的 `c8` 100% 覆盖率门禁。本计划单独定义 VS Code 插件中携宁 CLI 用户可见 Webview 页面的覆盖率口径，避免把页面覆盖率和核心链路覆盖率混用。

本计划采用合理默认解释：本批“携宁 CLI 页面”指插件用户可见 Webview 页面，包括主 AI 对话面板、配置/模型管理页面入口、Loop 群聊页面、页面脚本拼接、样式拼接和 i18n 生成模块。`marked`、Monaco、zip 包、React/Ant Design 等第三方或静态 vendor bundle 不纳入本批 100% 覆盖率声明。

## 页面覆盖率白名单

`test:page-coverage` 以编译产物 `dist` 为输入，通过 source map 回报 TypeScript 源文件；白名单显式列出，不使用宽泛目录排除制造绿灯。

### 主 AI 对话面板

- `src/webview/viewProvider.ts`：VS Code WebviewView 入口、HTML 刷新与 postMessage。
- `src/webview/viewContent.ts`：主面板 HTML 总装、nonce、marked 脚本加载 fallback。
- `src/webview/viewContentHtml.ts`：主面板静态 HTML。
- `src/webview/viewContentI18n.ts`：主面板中英文文案生成。
- `src/webview/viewContentScript.ts`：运行时脚本聚合与占位符替换。
- `src/webview/viewContentScript/*.ts`：主面板所有运行时脚本片段。
- `src/webview/viewContentStyles.ts` 与 `src/webview/viewContentStyles/*.ts`：主面板样式聚合与样式片段。

### 配置/模型管理入口

- `src/webview/configPanel.ts`：配置管理 WebviewPanel 生命周期、消息分发和请求响应。
- `src/webview/configProtocol.ts`：配置页消息协议运行时边界。
- `src/webview/configView.ts`：配置页 HTML、资源 URI、CSP、locale 注入与静态配置资产加载。

### Loop 群聊页面

- `src/webview/loopDebatePanel.ts`：Loop 群聊 WebviewPanel 生命周期与 HTML 生成。
- `src/webview/loopDebatePanelRenderer.ts`：Loop 群聊标题和 i18n 文案。
- `src/webview/loopDebatePanelStyles.ts`：Loop 群聊样式。

## 非目标

- 不把 `media/config/assets/index-*.js`、`index-*.css` 的第三方/打包 vendor 内容计入 100% 覆盖率门禁；它们通过页面静态契约测试校验关键选择器、按钮、默认命令和编辑器片段。
- 不把 `marked.min.js`、Monaco、zip 包或其他第三方静态文件计入本批 100% 声明。
- 不把 `src/webview/panelFileActions.ts`、`src/sessionMessageHandlers.ts` 等后端桥接/文件动作模块纳入页面渲染覆盖率；这些属于会话消息或核心链路测试口径。
- 不修改媒体资产、package-lock、vendor 静态文件或无关文档。

## 脚本入口

- `npm run test:page`：先构建，再执行页面相关 `node:test` 用例集合。
- `npm run test:page-coverage`：先构建，再用 `c8 --all --check-coverage` 覆盖页面白名单，语句、行、函数、分支均要求 100%。
- 覆盖率缓存目录：`node_modules/.cache/sinitek-cli-page-coverage`，避免在仓库根目录产生覆盖率文件。

页面测试入口已接入：

- 主面板静态/运行时脚本契约：`loopmaingroupchatbutton`、`opencodedualmodelwebview`、`multiAgentSettingWebview`、`conversationTabPagination`、`subagentProgress`、`historySessionLoop`、`conversationTabLock`、`openCodeThinkingWebview`、`openCodeTaskListOverlay`、`runPromptHistoryWebview`、`opencodeloopmodewebview`、`loopPromptQueue`、`finalAnswerPolicy`、`traceToolTitleLocalization`、`cliPageStaticRenderCoverage`、`clipagescriptruntimecoverage`。
- Loop 群聊页面：`loopDebatePanel`。
- 配置页面静态资产与协议契约：`configappcompactcontrols`、`configappcompactlayoutstyles`、`claudeConfigVisualEditor`、`codexConfigVisualEditor`、`opencodeconfigvisualeditor`、`opencodeconfigexample`、`opencodeAutoCommandUi`、`cliPageConfigCoverage`。

## 实施结果

- `package.json` 的 `test:page` 与 `test:page-coverage` 已接入新增页面测试文件：
  - `dist/test/cliPageStaticRenderCoverage.test.js`
  - `dist/test/clipagescriptruntimecoverage.test.js`
  - `dist/test/cliPageConfigCoverage.test.js`
- `test:core` 与 `test:core-coverage` 保持既有核心门禁脚本，不在本任务中修改核心口径。
- `src/webview/configProtocol.ts` 将协议 action 列表改为运行时 `CONFIG_ACTIONS` 常量，便于页面协议测试和 c8 统计运行时边界。
- `src/webview/loopDebatePanel.ts` 对 c8 暴露的不可达/冗余防御分支做最小等价清理，不改变用户可见行为：
  - `getSegmentSpeaker` 收敛最终 fallback。
  - `getActiveSpeakerFromRound` 移除由调用约束保证不可达的 undefined 分支。
  - `getAvatarLabel` 移除非空归一化之后不可达的兜底。
- 页面补测覆盖主页面静态 HTML/CSP/i18n/CSS、主页面运行时 fake DOM 行为、配置页 Webview/协议/资产契约和 Loop 群聊页面渲染/生命周期分支。

## 最终验证命令

```bash
./node_modules/.bin/tsc --noEmit -p ./
npm run build
npm run test:page
npm run test:page-coverage
```

验证结果：

- `./node_modules/.bin/tsc --noEmit -p ./`：退出码 0。
- `npm run build`：退出码 0。
- `npm run test:page`：退出码 0，`151` tests / `151` pass。
- `npm run test:page-coverage`：退出码 0，`151` tests / `151` pass。

## c8 最终指标

`npm run test:page-coverage` 的页面白名单指标：

- Statements：100%
- Branches：100%
- Functions：100%
- Lines：100%

覆盖率表中 `All files`、`webview`、`webview/viewContentScript`、`webview/viewContentStyles` 以及所有白名单源文件均为 statements / branches / functions / lines 100%，无 uncovered line。

## 验收标准

- [x] `package.json` 保留既有 `test`、`test:unit`、`test:core`、`test:core-coverage` 行为，并新增页面专用入口。
- [x] `npm run test:page` 可以作为页面单测集合入口，退出码 0。
- [x] `npm run test:page-coverage` 使用 `c8 --all --check-coverage` 和页面白名单。
- [x] `test:page-coverage` 的 statements / lines / functions / branches 四项阈值均为 100%。
- [x] 未修改 package-lock、媒体资产、vendor 静态文件或无关源码。
- [x] 页面 100% 覆盖率已有严格门禁通过证据。

## 风险与缓解

- 风险：配置页静态 bundle 混入 React/Ant Design vendor，直接计入 c8 会把第三方代码纳入 100% 目标。缓解：本批只把 `src/webview/config*.ts` 作为覆盖率白名单，把 `media/config/assets/*` 作为静态契约测试对象。
- 风险：页面运行时脚本为字符串拼接，普通 import 无法直接执行浏览器环境逻辑。缓解：沿用现有测试的函数体提取/fake DOM 执行方式，不启动真实 VS Code Webview、浏览器、CLI 或网络。
- 风险：为覆盖率清理生产页面源码可能改变行为。缓解：仅清理 c8 暴露且由公开入口不可触达的冗余防御分支，并通过页面测试与覆盖率门禁复核。
