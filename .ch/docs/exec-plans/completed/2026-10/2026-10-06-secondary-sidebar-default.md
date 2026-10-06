# 首次加载默认辅助栏入口

- 日期：2026-10-06
- 状态：completed
- 负责人：Codex

## 背景与目标

聊天视图当前默认贡献到 Activity Bar，用户希望首次加载显示在 VS Code 辅助栏。采用原生声明，不强制修改用户已经保存的布局，不提高当前最低 VS Code 版本。

## 范围与非目标

- 修改聊天容器贡献点、补充开发启动窗口隔离回归测试，同步产品规格、运行时设计和 ontology。
- 使用 VS Code 1.104+ 原生辅助栏，不修改全局侧边栏位置，不强制迁移既有视图，不修改 Webview 内容、会话或 CLI 调用。

## 验收标准

- VS Code 1.104 及以上的新布局默认在辅助栏注册现有聊天容器。
- `run_dev.sh` 使用独立窗口启动开发宿主，不影响当前工作台的已保存布局。
- 保持容器和视图 ID、双语标题、命令及 `autoOpenPanel` 开关契约。
- 已有布局、其他扩展位置不被强制覆盖。
- 最小相关测试、构建、ontology 与差异校验通过，完成隔离的本机真实宿主验证或记录限制。

## 影响面与风险

- 实现：`package.json`、`run_dev.sh`；测试：`src/test/webview/panelViewLocation.test.ts`。
- 文档：README、功能清单、能力规格、运行时设计、`plugin.chat_panel` ontology。
- 不再同时声明同 ID 的 `activitybar` 容器，避免开发宿主重载时复用旧的主侧栏注册；容器和视图 ID 保持不变，让 VS Code 恢复既有布局。
- VS Code 1.104 才支持原生辅助栏贡献点，因此同步最低兼容版本；回滚时恢复 `activitybar` 声明并回退版本契约。

## 验证计划

- `npm run build`
- `node --test dist/test/webview/panelViewLocation.test.js dist/test/webview/viewProvider.test.js dist/test/extensionHost/commandRegistry.test.js`
- `bash -n run_dev.sh`
- `git diff --check`
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- 用隔离用户数据与临时工作区启动本机 Extension Development Host，核对同 ID 双声明在已有状态下会复用旧位置，支持本次移除 Activity Bar 重复贡献的判断。

## 任务列表

- [completed] 核对原生支持版本与容器复用行为。
- [completed] 移除主侧栏重复贡献并隔离开发窗口。
- [completed] 完成验证、同步业务语义并归档。

## 决策记录

- 2026-10-06：本机 VS Code 1.140 的容器注册实现会对同 ID 容器复用第一次已注册的位置；开发宿主或已有状态复用旧 Activity Bar 注册时，重复声明不能保证辅助栏。改为只声明 `secondarySidebar`，并把最低兼容版本同步到 `^1.104.0`。
- 2026-10-06：`run_dev.sh` 增加 `--new-window`，隔离开发宿主与当前工作台，避免调试启动影响当前 CLI 的布局状态。
- 不增加用户可见字符串，继续复用现有中英文 contribution 标题，测试验证两份语言文件。

## 当前结论

改动后 `npm run build` 与 11 个相关测试通过，Ontology 校验和差异检查通过；已完成隔离 Extension Development Host 验证。记忆热区不写单次任务记录，稳定兼容性契约进入运行时设计与 ontology。
