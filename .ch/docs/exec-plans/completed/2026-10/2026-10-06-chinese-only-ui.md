# 插件界面固定简体中文

- 日期：2026-10-06
- 状态：completed
- 负责人：Codex / 协作
- owner：Codex
- claimed_at：2026-10-06
- claim_ttl：本轮任务
- handoff_to：

## 背景

插件产品界面不再提供语言切换。工具设置中的 locale 选项、主 Webview 的英文翻译表、运行时语言分支及旧 locale 参数均已移除，Webview 与 Graph 界面固定使用简体中文。

## 目标

清理 UI 语言选择和英文界面运行时分支，使插件界面固定为简体中文，并让测试与当前行为一致。

## 范围

- 收敛主 Webview、配置页、Loop、Graph 的 UI locale 接口。
- 移除多语言运行时翻译逻辑和语言选择测试。
- 更新中文断言、覆盖率路径、产品规格和功能清单。

## 非目标

- 不翻译或改写 CLI 配置、Skills、MCP 服务返回的用户数据。
- 不改变用户提示词、模型输出语言或长期记忆内容本身。
- 不修改此前已完成的 Loop/Graph 完成气泡、运行动画或侧栏行为。

## 验收标准

- [x] 工具设置不包含 locale 选项或配置键。
- [x] Webview 与配置页固定 `zh-CN`，无英文 UI 翻译词典或运行时翻译观察器。
- [x] UI 渲染入口不再接受用于切换界面的 locale 参数。
- [x] 相关测试、覆盖率配置及当前产品文档不再依赖已删除的多语言实现。
- [x] `npm run build` 与定向回归测试通过；Graph 中既有的 `.vscodeignore` dagre 依赖断言仍为范围外失败。

## 影响面

- 代码目录：`src/i18n.ts`、`src/webview/`、`src/extensionHost/`、`src/config/`、相关测试。
- 文档目录：`README.md`、`.ch/docs/product-specs/`、`.ch/docs/design-docs/`。
- 配置与脚本：`package.json` 覆盖率包含列表、`package.nls*.json`。

## 风险与缓解

- 风险：locale 参数还影响非 UI 文本或提示语。
- 缓解：只移除 UI 语言选择分支；保留用户内容和 CLI 数据，不改模型提示语言策略。

## 验证计划

- 最小相关验证：构建后运行 Webview、Loop、Graph、设置处理与配置页相关测试。
- 单元自测命令：`npm run build`；`node --test dist/test/core/i18n.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActions.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/loop/loopDebatePanel.test.js dist/test/graph/graphRunPanel.test.js`。
- 扩展验证：搜索代码和当前产品文档中的 locale 选择、英文运行时翻译及已删除文件引用。

## 测试与清单同步

- 单元测试新增/更新：固定中文渲染及移除语言设置行为的回归覆盖。
- 单元自测结果：`npm run build` 通过；Loop/Loop+ 定向测试 `25/25` 通过；本轮 Graph/Webview 定向测试 `63/64` 通过。
- 失败处理记录：唯一失败为既有 `src/test/graph/graphRunPanel.test.ts` 的 `.vscodeignore` 断言，当前 `.vscodeignore` 缺少 `!node_modules/@dagrejs/**`，与中文单语改造无关，未修改。
- 功能清单：更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：更新产品能力说明和运行时架构说明。

## 任务列表

- [x] 移除工具设置语言选择与配置项
- [x] 移除主 Webview 英文词典
- [x] 清理剩余 locale 运行时分支
- [x] 更新测试、覆盖率与产品文档
- [x] 执行构建与定向回归测试

## 决策记录

- 2026-10-06：只移除插件 UI 的多语言切换能力；不改变 CLI 数据、用户提示词或模型输出语言。

## 当前结论

工具设置 locale 配置、主 Webview 英文文案表、配置页英文 DOM 翻译、Graph 英文短标签和旧测试双语言分支均已移除；当前 UI 固定简体中文。除范围外的 dagre `.vscodeignore` 历史断言外，构建和本轮定向回归已通过。
