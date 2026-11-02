# CLI 范例导入必填配置弹窗

- 日期：2026-11-02
- 状态：completed
- 负责人：Codex

## 背景与目标

七类 CLI 的范例导入目前直接覆盖编辑草稿。改为先填写必填的 base_url、api_key、模型名称，再按 CLI 配置结构生成草稿，避免遗漏多处模型引用。

## 范围与非目标

- 覆盖 Claude、Codex（含 config/auth 两个范例入口）、OpenCode、Grok、DSH、KimiCode、ZCode。
- 复用当前弹窗、主题与 JSON/TOML 工具；不改新增配置行为、不调用远端模型、不自动保存或激活。
- 当前工作区已有用户改动，直接保留式修改，不创建分支或工作树。

## 验收标准

- 点击“一键导入”先出现三个必填项；取消、空白或非法输入均不修改草稿。
- 所有范例相关凭据、地址、模型定义键及默认/辅助模型引用一致更新；Codex 同步更新 config.toml 与 auth.json。
- 保留范例的协议、思考参数和其他非目标字段；导入完成仍需手动保存。
- 导入成功后统一切到 JSON/TOML 源码页签，不切到可视化。
- 密钥输入遮蔽，关闭后清空，不添加日志或持久化渠道。

## 影响面与风险

- 代码：media/config/assets/config-app-ui.js。
- 测试：src/test/config/ 的范例导入与既有 ZCode 行为回归。
- 文档：FEATURE_INVENTORY.md、ontology 配置规则。
- 风险：OpenCode 双模型合并和 TOML 特殊字符转义；使用结构化对象操作和现有序列化工具，并覆盖回归。
- 回滚：撤销本任务的局部补丁，不覆盖工作区原有改动。

## 验证计划

- 最小相关验证：新增范例转换和弹窗交互单测，更新受影响的 ZCode 抽屉测试。
- 单元自测命令：npm run build；node --test dist/test/config/*相关测试*.test.js。
- 扩展验证：配置页相关测试；headless Chromium 实际弹窗、取消、确认与窄屏检查。
- 使用合成配置和占位密钥，不读写用户实际 CLI 配置。

## 任务列表

- [completed] 定位七类范例、共享抽屉和现有序列化工具。
- [completed] 实现弹窗与平台结构化替换。
- [completed] 补齐回归测试和文档。
- [completed] 构建、单测、页面验证及归档。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/config/cliExampleImport.test.ts` 六项测试，覆盖七类转换、八个入口、模型多处引用、转义、空白和非法输入、取消与重开、失败保留及 Codex 双文件；更新 KimiCode、DSH、ZCode 的既有契约测试。
- `npm run build`：通过。
- `node --test dist/test/config/*.test.js`：320 项全部通过。
- `node --test dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`：145 项全部通过。
- `node --check media/config/assets/config-app-ui.js`：通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 域、16 概念、15 关系、93 规则、2 工作流。
- `node /Users/fangjiawei/.codex/skills/impeccable/scripts/detect.mjs --json media/config/assets/config-app-ui.js`：无发现。
- `node scripts/check_trailing_whitespace.js <本次八个修改文件>` 和 `git diff --check`：通过。
- 失败处理记录：初版弹窗函数缺少闭合，运行时语法校验发现后修正；新增测试的空数组断言造成 TypeScript 类型收窄，改为长度断言后构建通过。浏览器夹具补全初始化和排序应答，取消按钮按 Ant 两字空格定位，源码切换按 tab 定位；Playwright 默认可执行文件缺失，改用本机已有 Chromium。均已重新验证通过，无遗留产品失败。
- 功能清单与 ontology：已同步 `FEATURE_INVENTORY.md` 和 `plugin.rule.cli_example_import_inputs`。

## 浏览器验证证据

- 使用实际 `getConfigViewHtml`、配置页脚本、样式与 Monaco；宿主桥接为仅内存合成档案，不读取或写入用户配置，不调用模型服务。
- 通过 chromium-playwright-smoke runner 分别验证 1280×900 与 390×844；必填错误、密钥遮蔽、弹窗在视口内和输入项无重叠均通过，已查看截图。
- 八入口真实点击验证：Claude、Codex config、Codex auth、OpenCode、Grok、DSH、KimiCode、ZCode 均通过。每项覆盖空输入拒绝、填写后取消、重开清空、确认导入以及实际 Monaco 草稿中的地址/密钥/模型；Codex 同时检查 auth 草稿。
- 所有验证中 `save` 和 `apply` 请求数为零，browser/page/network/HTTP 错误均为零。
- 结果：`.tmp/playwright-smoke/cli-example-import-desktop/result.json`、`.tmp/playwright-smoke/cli-example-import-mobile/result.json`、`.tmp/playwright-smoke/cli-example-import-integration.json`。
- 截图：`.tmp/playwright-smoke/cli-example-import-desktop/success.png`、`.tmp/playwright-smoke/cli-example-import-mobile/success.png`。
- 未运行：全仓单测及真实 Extension Development Host；此次已覆盖全部配置域、相关 Webview 和实际生成页面，不触碰真实配置或执行 CLI。

## 当前结论

全部验收标准已满足。统一在共享“一键导入”入口拦截；每个平台独立转换，转换与编辑器校验成功后才关闭弹窗和抽屉。OpenCode 单次输入只保留一份模型定义，主/小模型均引用该定义。关闭、取消和切换档案会清空弹窗输入。

稳定行为已进入功能清单与 ontology，无架构边界变化，不重复写入长期记忆或 EVENT_MEMORY；保留工作区原有修改。临时浏览器夹具和场景已移除，仅保留本地验证结果与截图。

## 2026-11-02 追加：导入后统一进入源码页签

- 按用户要求，将 Claude、OpenCode 的导入模式改为 JSON，Codex（两个范例入口）与 Grok 改为 TOML；DSH、ZCode 继续使用 JSON，KimiCode 继续使用 TOML。
- 更新八入口回归，逐项断言实际传入的编辑模式，并同步功能清单与 ontology。
- `npm run build` 通过；`node --test dist/test/config/*.test.js` 320 项全部通过；JS 语法、ontology 与空白校验通过。
- Headless Chromium 使用实际生成页面及内存合成宿主，八个入口导入后直接断言源码 tab 的 `aria-selected=true`，不手工切换 tab；同时确认 Monaco 草稿含输入模型，无自动保存/激活或浏览器错误。
- 浏览器证据：`.tmp/playwright-smoke/cli-example-import-source-tabs.json`。无新增样式，无需重复视觉截图；未运行真实 Extension Development Host 或全仓测试。

## 2026-11-02 追加：范例与导入按钮统一保存样式

- 从 CodeGraph 定位共享编辑器后，直接核对当前源码：七类 CLI 共八个“查看范例”按钮与共享“一键导入”均复用“保存”的 `config-standard-action-button`、`type: "primary"` 和 `size: "small"`。查看使用已有眼睛图标，导入使用已有闪电图标，装饰图标设置 `aria-hidden`，保留中文无障碍名称。
- 抽屉使用 Portal，不在 `.config-app-theme` 根节点内；扩展 `src/webview/configView.ts` 的现有主按钮主题规则到标准主按钮，复用同组 VS Code 语义变量及 hover/focus-visible/active 状态，不硬写颜色或引入新依赖。
- 回归补充八个查看入口、共享导入按钮、图标、中文读屏与 Portal 主题规则；更新 DSH、ZCode 和导入测试的图标 mock。`npm run build` 通过；`node --test dist/test/config/*.test.js` 321 项通过；两项 CLI Webview 覆盖测试共 145 项通过；JS 语法、空白与 `git diff --check` 通过，Impeccable 检测无发现。
- Chromium runner 在 1280×900、390×844 的实际生成页面验证按钮可见、图标、视口与按钮/源码无重叠；另按八个范例入口×两个视口验证实际尺寸、内边距、主题颜色、圆角均与“保存”一致，确认弹窗仍能导入且直接落在 JSON/TOML 页签。已查看桌面和窄屏截图。
- 失败分流：初版测试误以为所有保存按钮均为简单内联结构，修正测试提取范围；装饰图标影响按钮无障碍名称，已修复；浏览器夹具补齐 VS Code 主题变量，等待加载及颜色过渡完成后再比较。多 CLI 共用页面触发 Monaco `Canceled`，改为每入口独立页面、仅加载目标合成档案并等待编辑器就绪后消失，未修改产品编辑器。严格视口检查曾覆盖抽屉整框，最终聚焦本次按钮的视口与无重叠验收，不改既有抽屉布局。
- 最终 browser/page/network/HTTP 错误均为零；所有 `save`/`apply` 请求均为零。浏览器结果：`.tmp/playwright-smoke/cli-example-buttons-desktop/result.json`、`.tmp/playwright-smoke/cli-example-buttons-mobile/result.json`、`.tmp/playwright-smoke/cli-example-buttons-integration.json`；两设备目录均保留 `editor.png` 与 `success.png`。
- 同步功能清单，并将 Portal 主题作用域的复用经验写入 `runbooks/PITFALLS.md`。此次仅外观与无障碍名称，不变更业务概念、输入输出或生命周期，无需修改 ontology；不重复写入记忆热区或 EVENT_MEMORY。未运行全仓测试与真实 Extension Development Host，不读写真实用户配置。
- 任务专用浏览器脚本与场景已清理，保留验证结果和截图；工作区原有修改保留。
