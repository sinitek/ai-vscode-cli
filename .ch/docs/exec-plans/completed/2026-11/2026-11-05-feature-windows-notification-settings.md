# Windows 通知状态与首次设置引导

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：feature

## 背景与目标

用户在 Windows 仍未看到系统通知，要求沿用 macOS 的通知设置体验，支持状态检查、手动处理和首次自动弹出。现有 Windows 授权查询固定返回 `not-required`，界面隐藏处理按钮；本机 WinRT `ToastNotifier.Setting` 为 `Enabled`，这只能证明系统允许投递，不能证明横幅展示。

## 范围与非目标

- 在现有 Windows transport 查询真实通知状态；禁用和系统策略分别给出可操作说明。
- 复用工具设置中的通知页签及授权消息，Windows 支持打开系统通知设置和刷新；页签文案统一为“通知设置”。
- 本机 Windows 任一通知开关开启时，首次自动打开系统通知设置；成功打开后用扩展全局状态记录，不随启动或配置刷新重复弹出。打开失败保留重试能力。
- 保留 macOS 的原生首次授权、Linux 说明、远程宿主边界、通知开关、前后台通知与后台闪烁规则。
- 不改用户的系统通知开关、勿扰模式、依赖版本或发布流程。

- 本计划仅承担 Windows transport/生产 host/通知 Webview 状态与引导；事实文档同步原由已退役 docs companion 承接（仅历史分工），已完成回归开发按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-windows-notification-settings.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。

## 验收标准

- Windows 显示真实允许、用户关闭、全局关闭、系统策略限制及查询失败状态。
- Windows 可手动打开系统通知设置，刷新不弹窗、不发送通知；查询失败仍保留设置入口。
- 首次自动引导跨扩展重启只成功弹出一次，两类通知都关闭或远程 workspace 宿主不触发；配置并发刷新不重复打开。
- macOS 首次授权和已拒绝后手动打开设置的行为保持通过。

- 明确区分投递成功与可见横幅；保留最小Windows本机实际确认，不补造其他平台原生验收。

## 影响面与风险

- `src/desktopAttention.ts`、`src/extensionHost/humanInteractionAttentionHost.ts`、通知 Webview 文案与交互。
- Windows 经典桌面通知接口没有 macOS 式的授权对话框，首次自动引导使用系统提供的 `ms-settings:notifications`，界面明确说明实际操作。
- 首次引导异步执行，防止配置变更竞争；设置打开失败或扩展存储失败按现有日志处理，不阻塞任务。
- 回滚范围限于 Windows 授权适配、现有界面和同步文档。

## 事实来源与决策

- 本次 memory-recall focus：`Windows 系统通知 通知授权 工具设置 首次引导`，anchor 为空；召回退化为 baseline，未展开无关 Loop 计划，改由 ontology 的通知规则与当前实现定位事实。
- ontology：`plugin.rule.notification_authorization_guidance`、`plugin.rule.human_interaction_desktop_attention`。
- Microsoft `NotificationSetting` 文档：<https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.notificationsetting>。

## 任务列表与当前进展

- 已完成 Windows 原生状态映射、发送前状态检查、首次设置引导及持久化/并发合并，工具设置页签统一为“通知设置”，查询失败仍保留 Windows 设置按钮。
- 用户先纠正为“只看到系统设置，没有通知横幅”，后确认通知横幅开关已开启；再次调用编译后的实际 Windows transport 后，用户确认“有了，原来是免打扰，有的”。根因是 Windows 免打扰抑制横幅，发送链路正常，无需切后台。没有据此改换通知身份、Tag 或强制突破展示策略。

- [x] 原生状态映射/发送前检查、全局状态首次引导、并发合并与重试能力。
- [x] 查询失败保留设置入口；保留Mac授权、Linux与远程边界。

## 验证计划与历史Windows结果

历史验证为构建、93项相关回归和五浏览器场景；测试计划移除审计保留构建、浏览器 smoke 命令及五场景结果摘要，但长 `node --test` 命令被截断，且未保留测试开发细节。来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-windows-notification-settings.md`。文档/103条规则校验原指向 docs companion（已退役，完整记录未恢复）。以下是真实历史 host 与投递结果，不是本轮执行：

- 真实 VS Code 验证：用 `code.cmd --extensionDevelopmentPath=<仓库>/.tmp/windows-notification-settings/extension --extensionTestsPath=<仓库>/.tmp/windows-notification-settings/native-tests.cjs --user-data-dir=<仓库>/.tmp/windows-notification-settings/vscode-user --extensions-dir=<仓库>/.tmp/windows-notification-settings/vscode-extensions --disable-extensions --skip-welcome --skip-release-notes --disable-workspace-trust --new-window` 加载编译后的生产 host。结果为 `settingsOpened=true`、`authorization.status=authorized`、`errors=[]`，首次打开记录成功；结果文件 `.tmp/windows-notification-settings/native-result.json`。
- 原生展示：本机原生 `ToastNotifier.Setting=Enabled`，通知历史包含对应分组，系统日志显示送达当前会话；这些证据没有单独当作横幅成功。用户处理免打扰后重试，明确确认实际横幅显示。Windows 真实展示验收通过。
- 诊断期间一条临时 `node -e` 命令受 PowerShell 参数引号影响未执行；改用 here-string 通过 stdin 传给 Node 后，生产 transport 调用退出 0。该错误属于验收命令引用问题，未改业务代码。

## 收尾边界

- 新增状态/引导功能在当前源码中完成；真实 Host 验证使用隔离开发扩展，未替换用户安装的扩展包，也未执行发布脚本。
- 本机实际展示问题已确认解决；Mac/Linux 的新增平台边界通过自动化验证，未在本机执行其他操作系统的原生通知。
- 记忆判断：稳定规则进入规格、ontology 与 runbook；未新增用户偏好或脚本化需求，无需更新滚动摘要。排障结论已完整进入 runbook，不重复写事件记忆。

## 当前状态

原 completed 保留；真实 Windows 展示由用户解除免打扰后确认，未换身份/Tag或绕过系统策略。来源审计列出五场景、smoke 命令、results 目录位置及截图检查说明；这些是审计留存的结果和产物位置说明，不证明产物当前仍存在。验收服务停止与场景清理仍只是本计划正文记录的收尾事实，审计未记载。来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-windows-notification-settings.md`。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留 Windows 通知状态与首次引导回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-windows-notification-settings.md`；不再作为现行测试责任。
- 历史文档分工：Windows 通知引导规格与免打扰排障同步，共享本来源的历史背景与接口。 原 docs companion `2026-11-05-docs-windows-notification-settings.md#背景与目标` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
