# 携宁 CLI 配置全屏 VS Code 面板

- 日期：2026-07-31
- 状态：completed
- 负责人：Codex
- owner：Codex 当前任务
- claimed_at：2026-07-31
- claim_ttl：当前任务完成前
- handoff_to：
- 类型：feature

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [docs：产品、运行时或审计文档写作](./2026-07-31-docs-vscode-config-fullscreen-panel.md)：同源历史任务；文档计划依据本实现的能力和兼容边界编写事实说明；写作不再属于本实现。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景

当前对话面板点击“配置”后已经通过 `ConfigManagerPanel` 创建 VS Code `WebviewPanel`，并复用了携宁 CLI 配置页面的配置档案、Codex / Claude / OpenCode 编辑、Skills、MCP、导入导出等完整交互。但是承载层仍保留旧 Web 页面视觉体系：配置资源固定使用 Clay 浅色配色、装饰阴影和自定义字体；重复打开面板时还会保留原焦点。用户希望点击“配置”后立即进入 VS Code 内的全屏配置界面，交互和功能尽量保持现有携宁 CLI 配置页一致，但视觉只使用 VS Code 主题语义色。

## 目标

1. 把“配置”入口明确收敛为前台聚焦的 VS Code 全屏编辑器 WebviewPanel，不再表现为需要跳转或保留焦点的 Web 页面。
2. 保留现有配置中心的完整交互、配置协议和配置服务，不复制或重写 Codex / Claude / OpenCode 领域逻辑。
3. 用 VS Code 主题语义变量覆盖旧 Web 固定色、字体、阴影和装饰性样式，自动适配浅色、高对比度和深色主题。
4. 实现既有中英文UI与配置协议兼容；独立自动化测试开发不归本记录（原test计划已删除），产品清单及运行时写作仍归关联docs。

## 范围

- `src/webview/configPanel.ts` 的打开、聚焦和面板生命周期行为。
- `src/webview/configView.ts` 的 VS Code 主题语义样式注入和全屏根布局。
- `media/config/assets/`中Ant Design token与主题变更监听的实现；不承担独立测试开发（原test计划已删除）或关联docs的文档写作。

## 非目标

- 不重写 `media/config/assets/config-app-ui.js` 的配置业务交互。
- 不改变 Codex / Claude / OpenCode 配置文件格式、保存边界、Skills 或 MCP 领域行为。
- 不替换现有前端技术栈，不引入新的打包器、UI 框架或依赖。
- 不通过全局命令强制隐藏用户的 VS Code 侧栏、面板或改变其持久化工作台布局。

## 验收标准

- [x] 点击“配置”会创建或前台聚焦唯一的配置 `WebviewPanel`，使用编辑器主区域承载且不保留聊天输入焦点。
- [x] 配置页根节点占满可用编辑器区域，继续支持窄屏目录、Codex / Claude / OpenCode 配置、Skills、MCP、导入导出和现有消息协议。
- [x] 配置页颜色、字体、选择、焦点、按钮、输入框、列表、状态和遮罩均来自 `--vscode-*` 语义变量，不再强制固定浅色 Clay 调色板。
- [x] 用户可见界面保持原中英文兼容；`media/official_skills_catalog.json`的description仍全部为中文。事实说明写作由关联docs验收。
- [x] 最小相关单元测试、TypeScript 编译和项目 build 通过。

## 影响面

- 代码目录：`src/webview/`、`media/config/assets/`
- 文档影响与写作责任：见关联docs。
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

- 测试开发与原始验证/失败明细见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，本实现记录仅消费验证证据。
- 产品/运行时/审计文档及功能清单写作见关联[docs计划](./2026-07-31-docs-vscode-config-fullscreen-panel.md#范围与非目标)，不属于本实现范围。

## 任务列表

- [x] 核对现有配置入口、WebviewPanel、配置协议和配置服务边界。
- [x] 实现前台聚焦的全屏配置面板和 VS Code 主题适配层。
- [x] 配置页宿主与主题接口的历史回归证据留存删除审计（不接回测试开发）；事实说明由关联docs写作。
- [x] 完成 build、相关单测、静态检查和计划归档。

## 决策记录

- 2026-07-31：复用现有 `ConfigManagerPanel`、配置桥接协议和静态配置 UI，只迁移宿主行为与主题层，避免复制配置领域逻辑。
- 2026-07-31：将“全屏”定义为 VS Code 编辑器主区域内的唯一、前台聚焦 WebviewPanel；不执行会改变用户工作台布局的最大化命令。
- 2026-07-31：主题适配集中放在 `configView.ts` 宿主样式中，旧资源仍负责布局与交互，颜色全部由 VS Code 语义变量接管。
- 2026-07-31：Ant Design 不能继续继承旧 Web 主题的固定浅色 token；配置 UI 在运行时读取当前 `--vscode-*` 计算值构造组件主题，并在 VS Code 主题属性变化时重新生成 token。

## 当前结论

已完成。点击“配置”会立即打开或重新聚焦编辑器主区域内唯一的配置 `WebviewPanel`；配置档案、三套 CLI 编辑器、Skills、MCP、导入导出和消息协议保持原行为。宿主 CSS 与 Ant Design token 均使用 VS Code 主题语义值，并可跟随主题切换。由于当前环境没有 `code` CLI，未启动 Extension Development Host 做人工截图验收；配置相关 70 项自动化测试、JavaScript 静态检查和差异检查通过。TypeScript 构建曾在本任务改动完成后通过，最终重跑被并发会话在范围外测试夹具的类型错误阻断，页面测试集中的 3 个范围外夹具失败也已记录。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
