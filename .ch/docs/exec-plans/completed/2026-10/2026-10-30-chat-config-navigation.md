# 对话面板配置入口自动定位档案

- 日期：2026-10-30
- 状态：completed
- 负责人：Codex

## 背景与目标

对话面板已经选择 CLI 和配置档案时，点击“配置”应直接打开对应档案的编辑器，等同于点击配置目录条目。

## 范围与非目标

- 覆盖对话入口消息、宿主转发、配置页面初始化与复用、窄屏目录收起。
- 不激活配置、不切换当前 CLI、不修改配置内容，不调整现有布局。

## 验收标准

- 首次进入和复用页面均按 CLI 与档案 ID 精确定位。
- 页面初始化完成前保留最新导航请求；无选择、失效档案或禁用 CLI 不误选其他档案。
- 导航只消费一次，后续手动选择不被刷新覆盖；窄屏直接显示编辑器。
- 相关回归测试、构建、脚本检查通过，功能清单及 ontology 同步。

## 影响面

- 代码：`src/webview/`、`src/panelMessageHandlers/session.ts`、`media/config/assets/config-app-ui.js`。
- 测试：配置页面、对话 Webview、消息处理器现有测试。
- 文档：功能清单、配置能力说明、CLI 运行时 ontology。

## 风险与缓解

- 首次加载消息丢失：UI 完成初始化后握手，宿主缓存最新待打开档案。
- 同名 ID 跨 CLI 冲突：同时匹配平台和 ID，复用 `setSelectedConfig`，不调用 apply。
- 保留用户已有 `src/interactive/` 及其测试中的未提交修改。

## 验证计划与结果

- `npm run build`：通过。
- `node --check media/config/assets/config-app-ui.js`：通过。
- `node --test dist/test/config/cliPageConfigCoverage.test.js dist/test/config/configappcompactcontrols.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js`：60/60 通过。
- `node --test --test-name-pattern='configuration button forwards' dist/test/webview/clipagescriptruntimecoverage.test.js`：1/1 通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；随后 ontology unittest 9/9 通过。
- `git diff --check`：通过。
- headless Chromium 使用真实配置页 HTML 与页面 assets、合成 VS Code bridge，在 `1440x1000` 和 `760x1000` 下均通过首次定位、复用定位、跨 CLI 同 ID 精确匹配、窄屏目录收起、失效/禁用目标不误选和无 apply/save/delete 请求检查；无 page error、console error、请求失败或 HTTP `>=400`。

## 失败处理

`clipagescriptruntimecoverage.test.js` 中以下 3 项历史失败在替换回改动前源码和测试后仍以相同错误复现，确认与本次改动无关，未修复：

1. `keeps the owning conversation tab errored for error bubbles through append, update, collapse, and recovery`：`undefined != true`。
2. `handles run stream, queue, attachments, history, and settings function branches in isolation`：`sharedProjectRuleCliNames is not defined`。
3. `routes window message handler branches without a real webview`：`calls.includes("rulesHint")` 不成立。

## 文档同步

- 已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 已更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。
- 已更新 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 未覆盖范围

未启动图形化 VS Code Extension Development Host 做真实鼠标点击验收；浏览器验证使用真实配置页资源和合成宿主 bridge，覆盖页面运行时与布局行为。

## 当前结论

使用 UI 就绪握手，首次与复用共享同一导航消息；复用现有选中档案行为。导航只打开编辑，不应用配置或切换 CLI。
