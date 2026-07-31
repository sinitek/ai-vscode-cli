# 携宁 CLI 配置全屏 VS Code 面板

- 日期：2026-07-31
- 状态：completed
- 负责人：Codex
- owner：Codex 当前任务
- claimed_at：2026-07-31
- claim_ttl：当前任务完成前
- handoff_to：

## 背景

当前对话面板点击“配置”后已经通过 `ConfigManagerPanel` 创建 VS Code `WebviewPanel`，并复用了携宁 CLI 配置页面的配置档案、Codex / Claude / OpenCode 编辑、Skills、MCP、导入导出等完整交互。但是承载层仍保留旧 Web 页面视觉体系：配置资源固定使用 Clay 浅色配色、装饰阴影和自定义字体；重复打开面板时还会保留原焦点。用户希望点击“配置”后立即进入 VS Code 内的全屏配置界面，交互和功能尽量保持现有携宁 CLI 配置页一致，但视觉只使用 VS Code 主题语义色。

## 目标

1. 把“配置”入口明确收敛为前台聚焦的 VS Code 全屏编辑器 WebviewPanel，不再表现为需要跳转或保留焦点的 Web 页面。
2. 保留现有配置中心的完整交互、配置协议和配置服务，不复制或重写 Codex / Claude / OpenCode 领域逻辑。
3. 用 VS Code 主题语义变量覆盖旧 Web 固定色、字体、阴影和装饰性样式，自动适配浅色、高对比度和深色主题。
4. 同步中英文、自动化测试、产品能力清单与运行时事实文档。

## 范围

- `src/webview/configPanel.ts` 的打开、聚焦和面板生命周期行为。
- `src/webview/configView.ts` 的 VS Code 主题语义样式注入和全屏根布局。
- 配置页宿主与静态资源相关单元测试。
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与必要的运行时设计说明。

## 非目标

- 不重写 `media/config/assets/config-app-ui.js` 的配置业务交互。
- 不改变 Codex / Claude / OpenCode 配置文件格式、保存边界、Skills 或 MCP 领域行为。
- 不替换现有前端技术栈，不引入新的打包器、UI 框架或依赖。
- 不通过全局命令强制隐藏用户的 VS Code 侧栏、面板或改变其持久化工作台布局。

## 验收标准

- [x] 点击“配置”会创建或前台聚焦唯一的配置 `WebviewPanel`，使用编辑器主区域承载且不保留聊天输入焦点。
- [x] 配置页根节点占满可用编辑器区域，继续支持窄屏目录、Codex / Claude / OpenCode 配置、Skills、MCP、导入导出和现有消息协议。
- [x] 配置页颜色、字体、选择、焦点、按钮、输入框、列表、状态和遮罩均来自 `--vscode-*` 语义变量，不再强制固定浅色 Clay 调色板。
- [x] 新增或修改的用户可见行为具备中英文事实说明；`media/official_skills_catalog.json` 的 description 仍全部为中文。
- [x] 最小相关单元测试、TypeScript 编译和项目 build 通过。

## 影响面

- 代码目录：`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`.ch/docs/exec-plans/`
- 配置与脚本：`package.json` 现有 build/test 脚本；不新增依赖

## 风险与缓解

- 风险：旧静态 CSS 选择器较多，仅替换少量页面样式可能在深色主题下残留低对比度颜色。
- 缓解：在宿主层集中映射全部 `--clay-*` 颜色变量到 `--vscode-*`，并为 Ant Design 的输入、按钮、选择和弹层补充语义化宿主覆盖；通过源码断言覆盖固定浅色回归。
- 风险：强制执行 VS Code 工作台最大化命令会修改用户布局。
- 缓解：只使用 `WebviewPanel` 的编辑器主区域与显式聚焦，不调用改变全局工作台布局的命令。
- 风险：配置页业务资源体积较大，重写 UI 会扩大回归面。
- 缓解：保留现有静态资源和桥接协议，只调整宿主行为与主题适配层。

## 验证计划

- 最小相关验证：配置面板创建/复用、焦点参数、主题 CSS 注入、消息桥接和静态资源加载测试。
- 单元自测命令：`npm run build`；`node --test dist/test/cliPageConfigCoverage.test.js dist/test/cliPageStaticRenderCoverage.test.js dist/test/configappcompactlayoutstyles.test.js dist/test/configappcompactcontrols.test.js`
- 扩展验证：`npm run test:unit` 中与配置页相关的测试；`node --check media/config/assets/config-app-ui.js`；`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：更新 `cliPageConfigCoverage.test.ts` 与 `configappcompactcontrols.test.ts`，覆盖面板复用时前台聚焦、nonce 主题层、静态资源无固定颜色、Ant Design token 从当前 VS Code 主题解析，以及主题变更监听。
- 单元自测结果：在并发工作树改动出现前 `npm run build` 通过；最终 `node --check media/config/assets/config-app-ui.js` 通过；配置面板、静态壳、紧凑布局、Codex / Claude / OpenCode 配置编辑器相关测试 70/70 通过；`git diff --check` 通过。
- 失败处理记录：`npm run test:page` 共 161 项，158 项通过，3 项失败；失败均位于本次未修改的 `src/test/openCodeThinkingWebview.test.ts` 测试夹具，分别缺少 `updateCodexLoopThinkingSelectOptions` 和 `getOpenCodeCompatModelRole`。最后一次 `npm run build` 还受到并发会话修改的 `src/test/clipagescriptruntimecoverage.test.ts:1022`（`TS18046: 'idleRender' is of type 'unknown'`）阻断；这些均归类为范围外工作树问题，未为通过测试改动无关代码。
- 功能清单：已更新配置中心入口、编辑器主区域全屏承载和 VS Code 主题行为。
- 相关文档同步：已更新能力规格、运行时设计说明以及 `docs/cli-reference.md`、`docs/插件功能清单.md` 兼容入口。

## 任务列表

- [x] 核对现有配置入口、WebviewPanel、配置协议和配置服务边界。
- [x] 实现前台聚焦的全屏配置面板和 VS Code 主题适配层。
- [x] 补充配置页宿主与主题回归测试。
- [x] 同步功能清单、能力规格和运行时设计说明。
- [x] 完成 build、相关单测、静态检查和计划归档。

## 决策记录

- 2026-07-31：复用现有 `ConfigManagerPanel`、配置桥接协议和静态配置 UI，只迁移宿主行为与主题层，避免复制配置领域逻辑。
- 2026-07-31：将“全屏”定义为 VS Code 编辑器主区域内的唯一、前台聚焦 WebviewPanel；不执行会改变用户工作台布局的最大化命令。
- 2026-07-31：主题适配集中放在 `configView.ts` 宿主样式中，旧资源仍负责布局与交互，颜色全部由 VS Code 语义变量接管。
- 2026-07-31：Ant Design 不能继续继承旧 Web 主题的固定浅色 token；配置 UI 在运行时读取当前 `--vscode-*` 计算值构造组件主题，并在 VS Code 主题属性变化时重新生成 token。

## 当前结论

已完成。点击“配置”会立即打开或重新聚焦编辑器主区域内唯一的配置 `WebviewPanel`；配置档案、三套 CLI 编辑器、Skills、MCP、导入导出和消息协议保持原行为。宿主 CSS 与 Ant Design token 均使用 VS Code 主题语义值，并可跟随主题切换。由于当前环境没有 `code` CLI，未启动 Extension Development Host 做人工截图验收；配置相关 70 项自动化测试、JavaScript 静态检查和差异检查通过。TypeScript 构建曾在本任务改动完成后通过，最终重跑被并发会话在范围外测试夹具的类型错误阻断，页面测试集中的 3 个范围外夹具失败也已记录。
