# 插件界面固定简体中文 — 新功能开发

- 日期：2026-10-06
- 状态：completed
- 负责人：Codex / 协作
- owner：Codex
- claimed_at：2026-10-06
- claim_ttl：本轮任务
- handoff_to：
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-06-chinese-only-ui.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-06-docs-chinese-only-ui.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

移除产品语言切换与英文运行时分支，界面固定简体中文。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-06-feature-chinese-only-ui.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- 插件产品界面不再提供语言切换。工具设置中的 locale 选项、主 Webview 的英文翻译表、运行时语言分支及旧 locale 参数均已移除，Webview 界面固定使用简体中文。

## 目标

- 清理 UI 语言选择和英文界面运行时分支，使插件界面固定为简体中文，并让测试与当前行为一致。

## 范围

- 收敛主 Webview、配置页、Loop 的 UI locale 接口。

## 非目标

- 不翻译或改写 CLI 配置、Skills、MCP 服务返回的用户数据。

- 不改变用户提示词、模型输出语言或长期记忆内容本身。

- 不修改此前已完成的 Loop 完成气泡、运行动画或侧栏行为。

## 验收标准

- [x] 工具设置不包含 locale 选项或配置键。

- [x] Webview 与配置页固定 `zh-CN`，无英文 UI 翻译词典或运行时翻译观察器。

- [x] UI 渲染入口不再接受用于切换界面的 locale 参数。

- [x] `npm run build` 与相关定向回归测试通过。

## 影响面

- 代码目录：`src/i18n.ts`、`src/webview/`、`src/extensionHost/`、`src/config/`。

- 配置与脚本：`package.json` 覆盖率包含列表、`package.nls*.json`。

## 风险与缓解

- 风险：locale 参数还影响非 UI 文本或提示语。

- 缓解：只移除 UI 语言选择分支；保留用户内容和 CLI 数据，不改模型提示语言策略。

## 验证计划

- 最小相关验证：构建后运行 Webview、Loop、设置处理与配置页相关测试。

- 单元自测命令：`npm run build`；`node --test dist/test/core/i18n.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActions.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/loop/loopGroupChatPanel.test.js`。

## 测试与清单同步

- 单元自测结果：`npm run build` 通过；Loop/Loop+ 定向测试 `25/25` 通过。

## 任务列表

- [x] 移除工具设置语言选择与配置项

- [x] 移除主 Webview 英文词典

- [x] 清理剩余 locale 运行时分支

- [x] 执行构建与定向回归测试

## 决策记录

- 2026-10-06：只移除插件 UI 的多语言切换能力；不改变 CLI 数据、用户提示词或模型输出语言。

## 当前结论

- 工具设置 locale 配置、主 Webview 英文文案表、配置页英文 DOM 翻译和旧测试双语言分支均已移除；当前 UI 固定简体中文。构建和 Loop/Loop+ 定向回归已通过。
