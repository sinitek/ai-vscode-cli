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
- 关联计划：原 docs companion `2026-10-06-docs-chinese-only-ui.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 历史归档范围

移除产品语言切换与英文运行时分支，界面固定简体中文。 原始日期、状态和类型见头部；原文中的实现约束、验收、追加决策、历史验证、失败及未覆盖边界保留在下方。测试计划移除审计（如头部所列）仅记录历史测试职责与证据，不表示本类型重新执行。

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
