# 首次加载默认辅助栏入口 — 新功能开发

- 日期：2026-10-06
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-06-secondary-sidebar-default.md`（历史标识，原文件已替换）
- 关联计划：[十月迁移归属审计](../../migrations/2026-11-11-oct.json)（原 `2026-10-06-chore-isolated-development-window.md` 已退役，仅历史追溯）; 原 docs companion `2026-10-06-docs-secondary-sidebar-default.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 依赖与背景

历史职责边界：feature 的辅助栏贡献与 chore 的开发窗口隔离是独立改动，不强造先后；原测试曾覆盖两者，历史文档记录保留兼容版本决策；该覆盖关系仅作历史说明。

## 历史归档范围

让新布局默认将聊天容器注册到原生辅助栏，保持已保存布局。 原始日期、状态和类型见头部；原文中的实现约束、验收、追加决策、历史验证、失败及未覆盖边界保留在下方。测试计划移除审计（如头部所列）仅记录历史测试职责与证据，不表示本类型重新执行。

## 原文归属记录

## 背景与目标

- 聊天视图当前默认贡献到 Activity Bar，用户希望首次加载显示在 VS Code 辅助栏。采用原生声明，不强制修改用户已经保存的布局，不提高当前最低 VS Code 版本。

## 范围与非目标

- 修改聊天容器贡献点。

- 使用 VS Code 1.104+ 原生辅助栏，不修改全局侧边栏位置，不强制迁移既有视图，不修改 Webview 内容、会话或 CLI 调用。

## 验收标准

- VS Code 1.104 及以上的新布局默认在辅助栏注册现有聊天容器。

- 保持容器和视图 ID、双语标题、命令及 `autoOpenPanel` 开关契约。

- 已有布局、其他扩展位置不被强制覆盖。

- 最小相关测试、构建、ontology 与差异校验通过，完成隔离的本机真实宿主验证或记录限制。

## 影响面与风险

- 不再同时声明同 ID 的 `activitybar` 容器，避免开发宿主重载时复用旧的主侧栏注册；容器和视图 ID 保持不变，让 VS Code 恢复既有布局。

- VS Code 1.104 才支持原生辅助栏贡献点，因此同步最低兼容版本；回滚时恢复 `activitybar` 声明并回退版本契约。

## 验证计划

- `npm run build`

- `node --test dist/test/webview/panelViewLocation.test.js dist/test/webview/viewProvider.test.js dist/test/extensionHost/commandRegistry.test.js`

- `git diff --check`

- 用隔离用户数据与临时工作区启动本机 Extension Development Host，核对同 ID 双声明在已有状态下会复用旧位置，支持本次移除 Activity Bar 重复贡献的判断。

## 任务列表

- [completed] 核对原生支持版本与容器复用行为。

- [completed] 完成验证、同步业务语义并归档。

## 决策记录

- 2026-10-06：本机 VS Code 1.140 的容器注册实现会对同 ID 容器复用第一次已注册的位置；开发宿主或已有状态复用旧 Activity Bar 注册时，重复声明不能保证辅助栏。改为只声明 `secondarySidebar`，并把最低兼容版本同步到 `^1.104.0`。

- 不增加用户可见字符串，继续复用现有中英文 contribution 标题，测试验证两份语言文件。

## 当前结论

- 改动后 `npm run build` 与 11 个相关测试通过，Ontology 校验和差异检查通过；已完成隔离 Extension Development Host 验证。记忆热区不写单次任务记录，稳定兼容性契约进入运行时设计与 ontology。

## 退役维护分工的追溯边界

原 `2026-10-06-chore-isolated-development-window.md` 对应 `run_dev.sh --new-window` 的独立开发启动维护，按头部迁移来源在[十月审计](../../migrations/2026-11-11-oct.json)定位；与辅助栏 feature 不强造前后依赖。现行启动方式见[本地开发手册](../../../runbooks/local-development.md#6-一键启动开发主机windows--macos--linux)，它不替代原维护页的完整历史验证。原文最初“不提高版本”与后来 `^1.104.0` 的决策差异仍保留。
