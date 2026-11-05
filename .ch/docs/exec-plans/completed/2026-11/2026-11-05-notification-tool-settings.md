# 通知授权迁移至工具设置

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex

## 目标与范围

将“使用说明”的通知授权页签迁移到“工具设置”，保留 Mac 授权状态、手动授权、拒绝后的系统设置入口与其他平台说明。提供“任务完成通知”和“人机交互通知”两个独立、默认开启的系统通知开关，复用现有应用级 VS Code 配置，保留已有选择，不另建权限或配置来源。不改变窗口图标提醒、通知投递条件、系统权限和默认值，不发布、不提交。

## 验收标准

- 使用说明仅保留模式说明；工具设置新增“通知授权”，支持鼠标、键盘和窄面板。
- 两类系统通知开关读取当前配置，修改后全局持久化并立即生效；保存失败显示错误并恢复真实状态。
- 查询、刷新不申请权限；保留 Mac 未决定权限申请及拒绝后打开系统设置的行为。
- 构建、相关单测、Chromium 桌面/窄面板与跨平台模拟通过；同步产品文档和 ontology。

## 影响面与风险

- 代码：Webview HTML、脚本、状态协议、会话设置处理及组合根。
- 风险：迁移后旧 DOM 引用残留、应用级配置误存工作区、窄面板标签溢出、失败后开关假成功。
- 缓解：复用两项 application 配置和现有提醒宿主；增加协议、保存失败、状态回显、页签与浏览器回归。

## 验证计划

- `npm run build` 后运行 Webview、设置路由、面板状态及通知宿主相关 `node --test`。
- 使用完整 Webview HTML 与模拟宿主回包进行 headless Chromium 验证，不修改本机真实通知设置。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、空白检查和 UI 检测。

## 任务列表

Tasklist:
- [completed] 确认通知配置与设置结构
- [completed] 迁移标签并接入通知开关
- [completed] 验证功能并同步文档

## 测试与文档同步

- `npm run build` 通过。
- `node --test dist/test/webview/notificationAuthorization.test.js dist/test/webview/loopPlusModeHelp.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/viewProvider.test.js dist/test/core/humanInteractionAttention.test.js dist/test/core/taskCompletionAttention.test.js`：289/289 通过。
- `npm run test:page`：406/406 通过，包含重新构建。
- Chromium 完整 Webview + 模拟宿主回包验证 5 个场景通过：1280×900 桌面、420×800 窄面板、已有关闭设置与两个开关独立更新/重开保持、Mac 手动拒绝后刷新不再申请、Windows 隐藏 Mac 控件与保存失败状态恢复。无浏览器、HTTP 或网络错误；桌面和窄面板截图人工检查通过。
- 浏览器证据：`.tmp/notification-tool-settings/{desktop,narrow,independent,denied,windows}/result.json`；截图分别位于对应目录的 `success.png`。任务专用 server/scenario 文件验证后删除，保留结果和截图。
- 失败分类：首轮单测两个失败为旧使用说明 DOM 断言过期，更新后全部通过；首轮浏览器失败为模拟宿主在全局定义 `state` 与真实 Webview 冲突的夹具问题，改为 IIFE 隔离后五个场景全部通过，未修改产品代码迎合夹具。
- 功能清单、能力规格、通知排障和 ontology 已同步。`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过；UI detector 无报告项；`git diff --check` 通过。
- 沿用既有主题、开关、应用级设置及通知宿主，不改变原生通知实现；未更改系统权限、未发送通知、未修改真实编辑器设置。首次系统授权弹窗和 Windows/Linux 原生通知未在本轮真机重验。架构边界未变化，无需更新 `ARCHITECTURE.md`；无新可复用经验，未更新 memory 热区或事件记忆。
- 工作区出现并行的 Loop+ 排查文档与 PITFALLS 导航修改，均保留，不纳入本任务。

## 当前结论

功能、构建、相关单测、页面测试、浏览器验证及文档同步完成。两个开关按用户确认均默认开启且独立控制，不强制重置已有用户配置。没有发布、创建分支或提交。
