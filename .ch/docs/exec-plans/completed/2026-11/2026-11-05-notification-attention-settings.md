# 通知设置闪烁开关与文案精简

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex

## 背景与目标

已有任务完成、人机交互的系统通知与窗口提醒配置，但工具设置只展示系统通知。补齐既有闪烁开关，精简冗长的说明。

## 范围与非目标

- 复用两类 `WindowAttention` 应用级配置，默认开启，独立于系统通知，保留已有用户设置。
- 打通工具设置的读取、全局保存、回显和失败恢复；精简说明，仅显示当前平台的操作提示。
- 不改变原生通知投递、授权流程、后台提醒触发规则，不新增依赖。

## 验收标准

- 工具设置 → 通知设置可以分别控制任务完成、人机交互的图标闪烁。
- 缺省开启，保存全局配置，立即生效；已有关闭选择不被覆盖。
- 关闭闪烁不影响系统通知；关闭系统通知不影响闪烁；保存失败回显实际配置。
- 通知说明简明，系统授权与刷新入口保留，平台说明不混杂。

## 影响面、风险与缓解

- 代码：Webview、面板状态、消息保存协议；复用现有提醒控制器和配置。
- 文档：功能清单、能力规格、通知管理 ontology。
- 风险：新增设置未完整回显、通知与闪烁意外耦合；用配置保存、状态恢复及控制器测试覆盖。
- 回滚：撤回设置页及消息协议新增项；原有配置与提醒实现不变。

## 验证计划

- `npm run build`。
- 通知 Webview、会话设置消息、面板状态及提醒控制器相关单元测试。
- 本机 Chromium 验证真实静态页面与交互；当前 macOS 无法验收 Windows 原生任务栏闪烁，明确保留限制。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。

## 测试与清单同步

- 单元测试：已补充四项配置独立更新、缺省及失败恢复、平台提示切换、宿主配置变化立即停止或恢复闪烁而不影响系统通知的断言。
- 构建：`npm run build` 通过。
- 最小相关单测：`node --test dist/test/webview/notificationAuthorization.test.js dist/test/webview/loopPlusModeHelp.test.js dist/test/session/sessionMessageActions.test.js dist/test/core/humanInteractionAttention.test.js dist/test/core/taskCompletionAttention.test.js dist/test/core/desktopAttention.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/extensionHost/opencodethinkingintegration.test.js`，125 项通过。
- 扩展回归：`node --test dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/viewProvider.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/core/macosDesktopNotifications.test.js dist/test/extensionHost/taskCompletionAttentionHost.test.js`，226 项通过。
- 浏览器：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/notification-attention-smoke/<name>.json`，Windows 桌面、390px 窄面板、保存失败恢复、macOS 已有关闭配置、Linux 五场景通过；真实静态 HTML/主题样式及通知相关脚本配合模拟宿主，不更改真实用户配置。检查桌面和窄面板截图，开关及按钮无重叠；无浏览器或网络错误。结果与截图保留于 `.tmp/notification-attention-smoke/results/`，任务临时夹具收尾删除。
- 失败分类：首次浏览器运行遇到环境问题（`/tmp` 中不完整的 Playwright 安装、旧记录中的 Edge 路径不存在），改用系统默认临时目录中已有 Playwright 与自动检测的 Chromium；随后修正静态 HTML 以未闭合 script 结束的夹具拼装方式。均不修改业务代码以绕过验证；最终五场景全通过。
- 结构校验：ontology validate 通过（105 rules）；`git diff --check` 通过；Impeccable detector 无发现。
- 未覆盖：未运行全量单测；当前 macOS 环境不能实测 Windows 原生任务栏闪烁，宿主配置联动由模拟 Windows 单测覆盖，需 Windows 本机验收原生视觉效果。
- 功能清单、能力规格、ontology：已同步。仅补齐已有配置入口，不改变通知原生实现，无需更新架构或 runbook。
- 记忆：属于现有配置入口补齐，无需新增热区或事件记忆。

## 任务列表

- [completed] 确认通知链路与设置入口。
- [completed] 添加闪烁开关并精简文案。
- [completed] 验证行为并同步文档。
