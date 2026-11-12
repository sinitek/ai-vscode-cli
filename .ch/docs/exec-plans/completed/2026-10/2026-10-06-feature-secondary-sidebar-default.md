# 首次加载默认辅助栏入口 — 新功能开发

- 日期：2026-10-06
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-06-secondary-sidebar-default.md`（历史标识，原文件已替换）
- 关联计划：[维护/构建/发布治理](2026-10-06-chore-isolated-development-window.md); [文档](2026-10-06-docs-secondary-sidebar-default.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

让新布局默认将聊天容器注册到原生辅助栏，保持已保存布局。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature 的辅助栏贡献与 chore 的开发窗口隔离是独立改动，不强造先后；原测试曾覆盖两者，docs 保留兼容版本决策；该覆盖关系仅作历史说明。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-06-feature-secondary-sidebar-default.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

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
