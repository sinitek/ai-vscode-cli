# CLI 范例导入必填配置弹窗

- 日期：2026-11-02
- 状态：completed
- 类型：feature
- 负责人：Codex

## 关联计划

- 独立测试开发与测试结果见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：新增六项转换/弹窗测试，并更新既有 CLI 契约和后续样式回归；这些不是单纯运行功能计划中的验证命令（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`）。
- 原文记录的历史文档分工：文档和使用说明交付见 `2026-11-02-docs-cli-example-import-guidance.md`：共同背景为范例导入交互，独立承接功能清单、ontology 规则和 PITFALLS 指南，不复制本计划的实现细节。 该 companion 已退役；完整写作及校验记录无法由索引复核。[references 索引](../../../references/index.md)仅作导航。

## 背景与目标

七类 CLI 的范例导入目前直接覆盖编辑草稿。改为先填写必填的 base_url、api_key、模型名称，再按 CLI 配置结构生成草稿，避免遗漏多处模型引用。

## 范围与非目标

- 覆盖 Claude、Codex（含 config/auth 两个范例入口）、OpenCode、Grok、DSH、KimiCode、ZCode 的必填输入、转换与草稿写入功能。
- 本计划保留功能交互验收；六项转换/弹窗及后续样式回归开发的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`），不再指向存活测试计划。规格/清单/ontology 与 PITFALLS 实际维护原归已退役 docs companion（仅历史分工）。
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
- 测试：本计划仅记录功能验收结果；回归用例开发和夹具调整的历史范围见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`）。
- 文档：规格、清单、ontology 与 PITFALLS 的独立更新原由已退役 docs companion 承接（仅历史分工）。
- 风险：OpenCode 双模型合并和 TOML 特殊字符转义；使用结构化对象操作和现有序列化工具，并覆盖回归。
- 回滚：撤销本任务的局部补丁，不覆盖工作区原有改动。

## 验证计划

- 最小相关验证：运行由已删除测试计划开发的范例转换、弹窗交互和ZCode抽屉回归以验证本功能实现；该测试开发的历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`）。
- 单元自测命令：npm run build；node --test dist/test/config/*相关测试*.test.js。
- 扩展验证：配置页相关测试；headless Chromium 实际弹窗、取消、确认与窄屏检查。
- 使用合成配置和占位密钥，不读写用户实际 CLI 配置。

## 任务列表

- [completed] 定位七类范例、共享抽屉和现有序列化工具。
- [completed] 实现弹窗与平台结构化替换。
- [completed] 功能联调；测试开发与文档分别见关联计划。
- [completed] 构建、单测、页面验证及归档。

## 测试和文档交付指针

- 单元测试开发、增量结果及失败处理的历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`）；本计划中的构建、页面和八入口交互验证仍是功能验收证据。
- `FEATURE_INVENTORY.md`、`plugin.rule.cli_example_import_inputs` 与 `runbooks/PITFALLS.md` 的实际同步内容原指向已退役 docs companion（完整记录未恢复）。

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

稳定行为已进入功能清单与 ontology，相关文档实质工作原指向已退役 docs companion（完整记录未恢复）；无架构边界变化，不重复写入长期记忆或 EVENT_MEMORY；保留工作区原有修改。临时浏览器夹具和场景已移除，仅保留本地验证结果与截图。

## 2026-11-02 追加：导入后统一进入源码页签

- 按用户要求，将 Claude、OpenCode 的导入模式改为 JSON，Codex（两个范例入口）与 Grok 改为 TOML；DSH、ZCode 继续使用 JSON，KimiCode 继续使用 TOML。
- 八入口源码页签回归开发的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`）；清单/ontology更新原指向已退役 docs companion（完整记录未恢复）。
- `npm run build` 通过；`node --test dist/test/config/*.test.js` 320 项全部通过；JS 语法、ontology 与空白校验通过。
- Headless Chromium 使用实际生成页面及内存合成宿主，八个入口导入后直接断言源码 tab 的 `aria-selected=true`，不手工切换 tab；同时确认 Monaco 草稿含输入模型，无自动保存/激活或浏览器错误。
- 浏览器证据：`.tmp/playwright-smoke/cli-example-import-source-tabs.json`。无新增样式，无需重复视觉截图；未运行真实 Extension Development Host 或全仓测试。

## 2026-11-02 追加：范例与导入按钮统一保存样式

- 从 CodeGraph 定位共享编辑器后，直接核对当前源码：七类 CLI 共八个“查看范例”按钮与共享“一键导入”均复用“保存”的 `config-standard-action-button`、`type: "primary"` 和 `size: "small"`。查看使用已有眼睛图标，导入使用已有闪电图标，装饰图标设置 `aria-hidden`，保留中文无障碍名称。
- 抽屉使用 Portal，不在 `.config-app-theme` 根节点内；扩展 `src/webview/configView.ts` 的现有主按钮主题规则到标准主按钮，复用同组 VS Code 语义变量及 hover/focus-visible/active 状态，不硬写颜色或引入新依赖。
- 按钮/无障碍与Portal主题回归、图标mock维护和321/145项历史结果保留于[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-cli-example-import-dialog.md`）。
- Chromium runner 在 1280×900、390×844 的实际生成页面验证按钮可见、图标、视口与按钮/源码无重叠；另按八个范例入口×两个视口验证实际尺寸、内边距、主题颜色、圆角均与“保存”一致，确认弹窗仍能导入且直接落在 JSON/TOML 页签。已查看桌面和窄屏截图。
- 失败分流：初版测试误以为所有保存按钮均为简单内联结构，修正测试提取范围；装饰图标影响按钮无障碍名称，已修复；浏览器夹具补齐 VS Code 主题变量，等待加载及颜色过渡完成后再比较。多 CLI 共用页面触发 Monaco `Canceled`，改为每入口独立页面、仅加载目标合成档案并等待编辑器就绪后消失，未修改产品编辑器。严格视口检查曾覆盖抽屉整框，最终聚焦本次按钮的视口与无重叠验收，不改既有抽屉布局。
- 最终 browser/page/network/HTTP 错误均为零；所有 `save`/`apply` 请求均为零。浏览器结果：`.tmp/playwright-smoke/cli-example-buttons-desktop/result.json`、`.tmp/playwright-smoke/cli-example-buttons-mobile/result.json`、`.tmp/playwright-smoke/cli-example-buttons-integration.json`；两设备目录均保留 `editor.png` 与 `success.png`。
- 按钮样式清单同步与Portal主题作用域经验的PITFALLS写作原指向已退役 docs companion（完整记录未恢复）。
- 任务专用浏览器脚本与场景已清理，保留验证结果和截图；工作区原有修改保留。
