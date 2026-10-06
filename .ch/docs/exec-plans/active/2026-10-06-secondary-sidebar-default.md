# 首次加载默认辅助栏入口

- 日期：2026-10-06
- 状态：in-progress
- 负责人：Codex

## 背景与目标

聊天视图当前默认贡献到 Activity Bar，用户希望首次加载显示在 VS Code 辅助栏。采用原生声明，不强制修改用户已经保存的布局，不提高当前最低 VS Code 版本。

## 范围与非目标

- 修改聊天容器贡献点、增加旧版回退回归测试，同步产品规格、运行时设计和 ontology。
- 不升级依赖或最低版本，不修改全局侧边栏位置，不强制迁移既有视图，不修改 Webview 内容、会话或 CLI 调用。

## 验收标准

- VS Code 1.104 及以上的新布局默认在辅助栏注册现有聊天容器。
- VS Code 1.85–1.103 保留 Activity Bar 入口，旧版可手动移动到辅助栏。
- 保持容器和视图 ID、双语标题、命令及 `autoOpenPanel` 开关契约。
- 已有布局、其他扩展位置不被强制覆盖。
- 最小相关测试、构建、ontology 与差异校验通过，完成隔离的本机真实宿主验证或记录限制。

## 影响面与风险

- 实现：`package.json`；测试：`src/test/webview/panelViewLocation.test.ts`。
- 文档：README、功能清单、能力规格、运行时设计、`plugin.chat_panel` ontology。
- 声明顺序是兼容性契约：先 `secondarySidebar` 后同 ID `activitybar`；顺序颠倒会使新版仍默认在左侧。测试固定该顺序与两份声明一致性。
- VS Code 1.103 及以下不支持原生辅助栏贡献点，保留旧默认位置而非调用内部移动命令。回滚只需移除新增贡献声明。

## 验证计划

- `npm run build`
- `node --test dist/test/webview/panelViewLocation.test.js dist/test/webview/viewProvider.test.js dist/test/extensionHost/commandRegistry.test.js`
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- `git diff --check`
- 用隔离用户数据与临时工作区启动本机 Extension Development Host，核对容器实际位置与原有打开入口。

## 任务列表

- [completed] 核对原生支持版本与旧版容器注册行为。
- [completed] 实施辅助栏优先声明与兼容性测试。
- [in_progress] 完成验证、同步业务语义并归档。

## 决策记录

- 2026-10-06：核对 Microsoft VS Code 1.103、1.104 与 1.85 的 `viewsExtensionPoint.ts`：1.104 引入 `secondarySidebar`，同 ID 容器只创建一次；旧版忽略未知位置但继续注册 `activitybar`。维持 `^1.85.0`，采用辅助栏优先的双位置同 ID 声明。decision-model 按“未经批准不提高最低版本”分类，选择保留兼容性，confidence=0.8。
- 不增加用户可见字符串，两种位置继续复用现有中英文 contribution 标题，测试验证两份语言文件。

## 当前结论

改动后 `npm run build` 与 11 个相关测试通过；待执行 ontology、打包校验及真实宿主验证。记忆热区不写单次任务记录，稳定兼容性契约进入运行时设计与 ontology。
