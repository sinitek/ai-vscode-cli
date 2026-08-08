# 工具设置人工交互配置与 Vibe 询问弹窗

- 日期：2026-08-08
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-08
- claim_ttl：本轮任务
- handoff_to：无

## 背景

用户希望在工具设置全局项中增加“人工交互”配置，默认开启。开启后，Vibe 模式任务执行过程中如果 AI 对用户需求有疑问，应弹出类似工具设置的表单弹窗让用户填写并提交；如果用户拒绝，则终止当前任务。目标系统 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace/apps` 的默认助手已有类似能力，本次只参考功能与表单交互设计，仍使用当前系统主题和组件。

## 目标

实现当前插件内 Vibe 模式的人工澄清能力：配置可开关、运行时能识别 AI 的提问请求、Webview 弹窗收集用户输入、提交后继续任务、拒绝后终止当前任务。

## 范围

- 全局工具设置新增人工交互开关，默认开启，并补充中英文文案。
- Vibe 模式运行链路支持 AI 发起结构化人工澄清请求。
- Chat Webview 复用当前主题样式展示人工交互表单。
- 拒绝人工交互时停止当前任务并给出明确状态。
- 补充相关测试、功能清单和运行时文档。

## 非目标

- 不复刻目标系统技术栈或样式实现。
- 不改变 Loop / Graph 模式既有人工节点语义。
- 不引入新的外部服务或数据库。

## 验收标准

- [x] 工具设置全局页有“人工交互”开关且默认开启。
- [x] Vibe 模式 AI 可通过约定协议触发表单弹窗。
- [x] 用户提交表单后，原 Vibe 任务收到补充信息并继续。
- [x] 用户拒绝表单后，当前任务被停止，UI 不遗留运行态。
- [x] 相关文案支持中英文。
- [x] 执行最小相关构建与测试。

## 影响面

- 代码目录：`src/webview/`、`src/extensionHost/`、`src/interactive/`、`src/extension.ts`、`src/config.ts`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`docs/`。
- 配置与脚本：`package.json`、`package.nls.json`、`package.nls.zh-cn.json`。

## 风险与缓解

- 风险：AI 输出自然语言问题时误触发。缓解：优先采用明确结构化协议，不对普通问号文本做猜测。
- 风险：交互等待期间运行态与停止逻辑不一致。缓解：复用现有运行队列和停止入口，并补拒绝路径测试。
- 风险：Webview 表单与当前主题不一致。缓解：复用现有 overlay/modal 样式变量和按钮体系。

## 验证计划

- 最小相关验证：新增或更新 Webview 协议/运行时单元测试。
- 单元自测命令：`npm run build`，必要时运行相关 `node --test dist/test/*.test.js`。
- 扩展验证：检查配置 schema、nls、文档和功能清单同步。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/humanInteraction.test.ts`，更新 `src/test/promptInteractiveRuntime.test.ts`、`src/test/toolSettings.test.ts`、`src/test/sessionMessageActions.test.ts`、`src/test/multiAgentSettingWebview.test.ts`、`src/test/opencodethinkingintegration.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/humanInteraction.test.js dist/test/toolSettings.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageActionsCoreCoverage.test.js dist/test/multiAgentSettingWebview.test.js dist/test/opencodethinkingintegration.test.js dist/test/promptInteractiveRuntime.test.js` 通过，78/78 pass；`git diff --check` 通过。
- 失败处理记录：本轮无失败。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`docs/cli-reference.md`、`docs/vscode_cli_plugin_dev_guide.md`。

## 任务列表

- [x] 定位当前配置中心、Vibe 运行时和目标系统人工交互实现。
- [x] 实现全局人工交互设置与国际化。
- [x] 实现 Vibe 人工澄清协议、弹窗表单和提交/拒绝链路。
- [x] 补充测试与文档。
- [x] 执行构建与相关测试，归档计划。

## 决策记录

- 2026-08-08：采用显式结构化协议触发人工交互，避免猜测普通自然语言提问。

## 当前结论

已完成全局“人工交互”配置、Codex Vibe 结构化澄清请求拦截、Webview 表单弹窗、提交继续与拒绝终止链路。构建、相关单元测试与空白检查均通过，计划可归档。
