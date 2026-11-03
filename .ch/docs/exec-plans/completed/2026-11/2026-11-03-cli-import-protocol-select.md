# CLI 一键导入协议选择

- 日期：2026-11-03
- 状态：completed
- 负责人：Codex

## 背景与目标

在新增配置和范例一键导入的共享弹窗中提前选择 API 协议类型，避免导入后再返回可视化编辑器修改。候选与现有可视化编辑器一致，默认值来自当前 CLI 范例。

## 范围与非目标

- 覆盖 Codex `wire_api`、OpenCode `npm`、Grok `api_backend`、DSH `api`、Kimi Code `type`、ZCode `api.type`；Claude 不展示、不生成协议字段。
- 保留 OpenCode 自定义 npm 包输入能力，复用现有主题与下拉组件。
- 不增加 CLI 支持的协议、不修改激活语义、不迁移已有档案，不改动无关工作区内容。

## 验收标准

- 新增与范例抽屉入口均按 CLI 展示协议选择，默认选中范例中的实际值。
- 协议候选与可视化一致，所选值写入正确的 JSON/TOML 层级；Codex 两个入口均同步 config/auth。
- 无效选择阻止提交；取消不修改配置；保存中不可修改协议，失败保留选择供重试。
- 单测覆盖所有默认值、各协议选项、自定义包、非法输入、弹窗交互和新增保存流程。
- 构建、相关配置测试、桌面与窄屏浏览器验证、ontology 结构检查通过。

## 影响面与风险

- 实现：`media/config/assets/config-app-ui.js`。
- 测试：`src/test/config/cliExampleImport.test.ts`、`src/test/config/newConfigFromExample.test.ts`、`src/test/config/codexConfigVisualEditor.test.ts`。
- 文档：功能清单、能力规格、`cli-plugin-runtime` ontology。
- 风险：协议枚举或默认值漂移、字段写入层级错误、窄屏下拉遮挡。通过复用选项、结构化解析范例与生成结果、真实 Chromium 交互缓解。

## 验证计划

- `npm run build`
- `node --test dist/test/config/cliExampleImport.test.js dist/test/config/newConfigFromExample.test.js`
- `node --test dist/test/config/*.test.js`
- headless Chromium：实际配置页与内存宿主桥，桌面/窄屏验证，不修改真实用户配置。
- ontology `--validate`、ontology 单测、界面机械检测、`git diff --check`。

## 测试与文档同步

- 单元测试新增/更新：新增六条回归，覆盖七类 CLI 的默认值、各协议写入与可视化重载、自定义 npm、空值/非法协议、两个弹窗入口、异步失败与重试、新增保存。Codex 可视化测试夹具补充抽取后的共享枚举。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/config/*.test.js` 共 363 项通过、0 失败。
- 浏览器验证：实际 `getConfigViewHtml` 页面与内存宿主桥，1440×1000 桌面完成七类 CLI 新增并核对协议写入、不自动激活；Grok 范例导入验证只更新草稿和重开恢复默认值；390×844 窄屏成功保存 OpenCode 自定义 npm。结构化 smoke runner 两种视口验证 DSH 默认值、三项候选、密钥遮蔽、弹窗/下拉视口约束、输入无重叠和真实指针交互，均无浏览器、网络或 HTTP 错误。
- 浏览器边界：没有修改真实用户配置；未运行真实 Extension Development Host 或 Windows。HTTP 夹具显式提供 VS Code 主题变量、实际配置页路由及仅本地 Monaco worker 来源，未修改产品 CSP。
- 浏览器证据：`.tmp/playwright-smoke/cli-import-protocol/result.json`、`desktop.png`、`mobile.png`，以及 `.tmp/playwright-smoke/cli-import-protocol-desktop/result.json`、`.tmp/playwright-smoke/cli-import-protocol-mobile/result.json` 与对应截图（均为忽略目录）。
- 失败分流：首次构建发现新增测试回调返回类型推断过窄，已修正；ZCode 默认值断言按实际范例修正为 `openai-responses`；三项旧 Codex 测试因夹具未注入抽取后的共享枚举失败，补齐夹具后全通过。浏览器早期失败来自 HTTP 夹具缺主题/worker 来源/实际路由，以及开场自动聚焦与测试点击竞争，补齐夹具并等待真实聚焦后通过，无范围外产品改动。
- 结构检查：ontology `--validate`、9 项 ontology 单测、界面机械检测（空结果）、`git diff --check` 均通过。
- 功能清单及 ontology：已同步 `FEATURE_INVENTORY.md`、`sinitek-cli-plugin-capabilities.md` 和 `plugin.rule.cli_example_import_inputs`。
- 记忆维护：该局部交互事实保留在功能规格与本计划，不重复写入热区或自动事件记录。

## 任务列表

Tasklist:
- [completed] 核对各 CLI 协议字段、可视化候选和范例默认值
- [completed] 实现共享导入弹窗协议选择并补充回归测试
- [completed] 完成验证、文档同步和计划归档

## 当前结论

共享弹窗已复用各 CLI 现有协议候选与 Ant Design 下拉，结构化读取范例默认值并写入所选协议；Claude 无协议字段。导入草稿与新增保存的原有边界保持不变，构建、363 项配置测试、ontology 校验与桌面/窄屏浏览器验证全部通过。
