# Windows 通知状态与首次设置引导

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex

## 背景与目标

用户在 Windows 仍未看到系统通知，要求沿用 macOS 的通知设置体验，支持状态检查、手动处理和首次自动弹出。现有 Windows 授权查询固定返回 `not-required`，界面隐藏处理按钮；本机 WinRT `ToastNotifier.Setting` 为 `Enabled`，这只能证明系统允许投递，不能证明横幅展示。

## 范围与非目标

- 在现有 Windows transport 查询真实通知状态；禁用和系统策略分别给出可操作说明。
- 复用工具设置中的通知页签及授权消息，Windows 支持打开系统通知设置和刷新；页签文案统一为“通知设置”。
- 本机 Windows 任一通知开关开启时，首次自动打开系统通知设置；成功打开后用扩展全局状态记录，不随启动或配置刷新重复弹出。打开失败保留重试能力。
- 保留 macOS 的原生首次授权、Linux 说明、远程宿主边界、通知开关、前后台通知与后台闪烁规则。
- 不改用户的系统通知开关、勿扰模式、依赖版本或发布流程。

## 验收标准

- Windows 显示真实允许、用户关闭、全局关闭、系统策略限制及查询失败状态。
- Windows 可手动打开系统通知设置，刷新不弹窗、不发送通知；查询失败仍保留设置入口。
- 首次自动引导跨扩展重启只成功弹出一次，两类通知都关闭或远程 workspace 宿主不触发；配置并发刷新不重复打开。
- macOS 首次授权和已拒绝后手动打开设置的行为保持通过。
- 构建、相关回归、ontology 校验、浏览器冒烟和最小 Windows 本机验证通过；明确区分投递成功和可见横幅。

## 影响面与风险

- `src/desktopAttention.ts`、`src/extensionHost/humanInteractionAttentionHost.ts`、通知 Webview 文案与交互、对应测试和通知规格。
- Windows 经典桌面通知接口没有 macOS 式的授权对话框，首次自动引导使用系统提供的 `ms-settings:notifications`，界面明确说明实际操作。
- 首次引导异步执行，防止配置变更竞争；设置打开失败或扩展存储失败按现有日志处理，不阻塞任务。
- 回滚范围限于 Windows 授权适配、现有界面和同步文档。

## 验证计划

- `npm run build`，然后运行通知 transport、控制器、宿主、Webview、viewProvider 和通知设置相关回归。
- ontology 校验及 UTF-8 环境下的 ontology Python 单测。
- 用 Chromium 验证通知设置页签、Windows 按钮、状态刷新及 macOS/Linux 显示边界。
- 用构建后的 Windows transport 查询真实状态、执行一次通知投递；实际打开 Windows 通知设置验证 URI。记录已验证和未验证的边界。

## 事实来源与决策

- 本次 memory-recall focus：`Windows 系统通知 通知授权 工具设置 首次引导`，anchor 为空；召回退化为 baseline，未展开无关 Loop 计划，改由 ontology 的通知规则与当前实现定位事实。
- ontology：`plugin.rule.notification_authorization_guidance`、`plugin.rule.human_interaction_desktop_attention`。
- Microsoft `NotificationSetting` 文档：<https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.notificationsetting>。

## 当前进展

- 已完成 Windows 原生状态映射、发送前状态检查、首次设置引导及持久化/并发合并，工具设置页签统一为“通知设置”，查询失败仍保留 Windows 设置按钮。
- 已同步架构、功能清单、能力规格、ontology 和排障记录；Mac 授权流程及 Linux 边界保持原有行为。
- 用户先纠正为“只看到系统设置，没有通知横幅”，后确认通知横幅开关已开启；再次调用编译后的实际 Windows transport 后，用户确认“有了，原来是免打扰，有的”。根因是 Windows 免打扰抑制横幅，发送链路正常，无需切后台。没有据此改换通知身份、Tag 或强制突破展示策略。
- ontology 校验和范围检查通过，临时验收服务已停止，五份任务专用浏览器场景已删除；结果与截图保留在忽略目录中。任务完成并归档。

## 已执行验证

- `npm run build`：通过。
- `node --test --test-reporter=spec dist/test/core/desktopAttention.test.js dist/test/core/humanInteractionAttention.test.js dist/test/core/macosDesktopNotifications.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/webview/notificationAuthorization.test.js dist/test/webview/loopPlusModeHelp.test.js dist/test/webview/viewProvider.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js`：93 项通过，无失败或跳过。覆盖原生状态、首次引导持久化/并发/失败重试、远程边界、Mac 授权、Windows 设置入口与超时恢复。
- 浏览器：通过隔离安装的 Playwright 1.61.1 和本机 Edge，运行 `node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/windows-notification-settings/<scenario>.json`；`windows-denied`、`windows-unavailable`、`windows-narrow`、`macos-first-authorization`、`linux-no-authorization` 五场景通过，无浏览器或网络错误。桌面和窄面板截图已检查，无按钮重叠。产物位于忽略目录 `.tmp/windows-notification-settings/results/`，未修改项目依赖。
- 真实 VS Code 验证：用 `code.cmd --extensionDevelopmentPath=<仓库>/.tmp/windows-notification-settings/extension --extensionTestsPath=<仓库>/.tmp/windows-notification-settings/native-tests.cjs --user-data-dir=<仓库>/.tmp/windows-notification-settings/vscode-user --extensions-dir=<仓库>/.tmp/windows-notification-settings/vscode-extensions --disable-extensions --skip-welcome --skip-release-notes --disable-workspace-trust --new-window` 加载编译后的生产 host。结果为 `settingsOpened=true`、`authorization.status=authorized`、`errors=[]`，首次打开记录成功；结果文件 `.tmp/windows-notification-settings/native-result.json`。
- 原生展示：本机原生 `ToastNotifier.Setting=Enabled`，通知历史包含对应分组，系统日志显示送达当前会话；这些证据没有单独当作横幅成功。用户处理免打扰后重试，明确确认实际横幅显示。Windows 真实展示验收通过。
- 诊断期间一条临时 `node -e` 命令受 PowerShell 参数引号影响未执行；改用 here-string 通过 stdin 传给 Node 后，生产 transport 调用退出 0。该错误属于验收命令引用问题，未改业务代码。
- `$env:PYTHONUTF8='1'`、`$env:PYTHONIOENCODING='utf-8'` 环境下运行 `python .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains、16 concepts、15 relations、103 rules、2 workflows、3 documents；`python -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- `git diff --check`：通过。变更范围核对仅包含本次通知状态/引导、回归和对应事实文档，无依赖或发布流程变更。

## 收尾边界

- 新增状态/引导功能在当前源码中完成；真实 Host 验证使用隔离开发扩展，未替换用户安装的扩展包，也未执行发布脚本。
- 本机实际展示问题已确认解决；Mac/Linux 的新增平台边界通过自动化验证，未在本机执行其他操作系统的原生通知。
- 记忆判断：稳定规则进入规格、ontology 与 runbook；未新增用户偏好或脚本化需求，无需更新滚动摘要。排障结论已完整进入 runbook，不重复写事件记忆。
