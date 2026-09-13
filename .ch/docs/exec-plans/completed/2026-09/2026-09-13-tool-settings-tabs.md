# 工具设置 Tab 重构

- 日期：2026-09-13
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：

## 背景

工具设置当前将所有全局项集中在“全局”页签，并单独提供“自动清理”页签。用户需要更清晰地区分常规偏好与 AI 任务行为，同时保留全局自动清理配置。

## 目标

将工具设置调整为“常规配置”“AI任务配置”“工作区”三个 Tab；把历史保留天数放入常规配置，移除“全局”和“自动清理”两个旧 Tab。

## 范围

- Webview 设置 Tab、面板内容、DOM 引用和 Tab 切换逻辑。
- 中英文 Tab 文案及相关测试断言。
- 产品规格、运行时参考和设计文档中对设置页归属的描述。

## 非目标

- 不改变任何设置字段、默认值、持久化位置或清理逻辑。
- 不改变工作区设置内容及工具设置视觉主题。

## 验收标准

- [x] 设置弹窗仅显示“常规配置”“AI任务配置”“工作区”三个 Tab。
- [x] 常规配置包含调试、自动文件标签、语言、macOS Shell、历史保留天数。
- [x] AI任务配置包含隐式子代理、人工交互、执行后自动压缩上下文、Loop 最大轮次和子任务最大思考力度。
- [x] Tab 切换、默认激活状态、历史保留天数保存行为和工作区设置行为均正常。
- [x] 相关中英文静态与设置归属运行时覆盖测试通过，构建通过。

## 影响面

- 代码目录：`src/webview/viewContentHtml.ts`、`src/webview/viewContentI18n.ts`、`src/webview/viewContentScript/coreBootstrap.ts`、`src/webview/viewContentScript/settingsAndOverlays.ts`。
- 测试目录：`src/test/webview/cliPageStaticRenderCoverage.test.ts`、`src/test/webview/clipagescriptruntimecoverage.test.ts`、`src/test/webview/multiAgentSettingWebview.test.ts`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/design-docs/`。

## 风险与缓解

- 风险：旧 DOM 标识仍被脚本或测试引用，导致设置弹窗初始化或切换失败。
  - 缓解：统一检索旧标识，更新元素映射、事件监听和静态/运行时覆盖。
- 风险：文档继续把设置描述为“全局页”或“自动清理页”。
  - 缓解：同步当前事实来源，历史归档计划保留原始事实。

## 验证计划

- 最小相关验证：`npm run build`。
- 单元自测命令：`node --test dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/multiAgentSettingWebview.test.js`。
- UI 机械检查：`node /Users/fangjiawei/.codex/skills/impeccable/scripts/detect.mjs --json src/webview/viewContentHtml.ts src/webview/viewContentI18n.ts src/webview/viewContentScript/coreBootstrap.ts src/webview/viewContentScript/settingsAndOverlays.ts`。

## 测试与清单同步

- 单元测试新增/更新：更新三个 Webview 覆盖测试中的 Tab 与面板断言。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/multiAgentSettingWebview.test.js` 12/12 通过；`npm test` 947 项中 946 项通过，本次新增的 Tab 交互断言通过。
- 失败处理记录：`dist/test/webview/clipagescriptruntimecoverage.test.js` 中既有 `shouldHideParsedTaskListMessage` 对 `Tasklist update:` checkbox 列表的断言失败，与本次 Tab 改动无关；该失败在改动前的基线逻辑中已存在，本次未扩大范围修复。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，记录三 Tab 归属。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md` 和 `docs/cli-reference.md`。

## 任务列表

- [x] 确认现有 Tab 结构和目标归属
- [x] 重构 Webview Tab、面板和脚本引用
- [x] 更新国际化、测试与事实文档
- [x] 执行构建、单测和 UI 机械检查

## 决策记录

- 2026-09-13：保留现有三个设置领域数量，将旧“全局”拆为“常规配置”和“AI任务配置”；工作区 Tab 保持不变。

## 当前结论

已完成 Tab 重构、国际化、测试和事实文档同步。构建与定向测试通过，UI 机械检查无发现；全量测试仅保留 1 项与本次无关的既有任务列表解析断言失败。
