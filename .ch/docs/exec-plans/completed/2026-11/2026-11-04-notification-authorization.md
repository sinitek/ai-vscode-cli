# 通知自动授权与使用说明入口

- 日期：2026-11-04
- 状态：completed
- 负责人：Codex

## 背景与目标

macOS 通知首次授权不能只依赖后台任务触发。扩展本机启动时，在通知开关开启的前提下自动申请未决定的权限；拒绝后不再自动弹窗。使用说明新增“通知授权”页签，提供所有平台的说明和 Mac 专属状态、授权与系统设置入口。

## 范围与非目标

- 复用稳定的“携宁 CLI 提醒”身份，授权和发通知共享助手及串行队列。
- 未决定时手动按钮直接请求系统授权；已拒绝时打开系统通知设置，不能强制重弹系统授权。
- 不增加声音、Dock 弹跳、远程通知、依赖或改变任务完成判定。
- 工作区初始干净，直接在当前分支实施；不创建分支或提交。

## 验收标准

- 本机 Mac 首次启动自动请求；授权或拒绝后不重复请求，查询状态不触发授权。
- 关闭两类系统通知时不自动申请；远程扩展宿主不调用本机通知工具。
- 模式说明默认选中；通知授权页签支持鼠标、键盘、加载、失败和刷新。
- Mac 按钮区仅在本机 Mac 显示，拒绝后可主动打开系统设置；Windows/Linux 显示适用说明。
- 授权操作不发送测试通知，不阻塞任务、清理或扩展激活。

## 影响面与风险

- 代码：macOS 通知助手、桌面传输、扩展宿主、Webview 协议/说明弹窗。
- 文档：功能清单、能力规格、通知排障、本体。
- 系统只记录首次决定，拒绝后仅能手动设置。助手目录升级但保留 bundle ID；避免重用旧脚本。
- 串行原生启动防止并发授权和发通知竞争；失败可重试、不缓存权限快照。

## 验证计划

- `npm run build`。
- 通知助手、传输、宿主与使用说明相关 Node 回归。
- Chromium 验证完整 Webview 的页签、状态与按钮消息，检查窄宽视口和控制台错误。
- 本机执行只读授权诊断，避免修改用户真实授权；系统首次弹窗和 Windows 实机边界如未覆盖明确记录。
- ontology 校验及其单测。

## 测试与清单同步

- 单元测试新增/更新：通知助手的只查询/只授权/拒绝/并发/失败恢复；桌面传输跨平台；宿主自动授权、开关、远程、手动设置及拒绝恢复；Webview 页签、请求相关性、超时、跨平台按钮、视图销毁后的迟到回复。
- 单元自测结果：`npm run build` 通过。`node --test dist/test/core/macosDesktopNotifications.test.js dist/test/core/desktopAttention.test.js dist/test/core/humanInteractionAttention.test.js dist/test/core/taskCompletionAttention.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/extensionHost/taskCompletionAttentionHost.test.js dist/test/webview/notificationAuthorization.test.js dist/test/webview/loopPlusModeHelp.test.js dist/test/webview/viewProvider.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js`：236/236 通过。
- 失败处理记录：浏览器非 Mac 场景发现全局按钮的 `display: inline-flex` 覆盖 `[hidden]`。分类为实现缺陷；为本功能按钮补显式隐藏 CSS 和回归断言，重跑构建、236 项测试及非 Mac 浏览器场景通过。未扩大修改全局按钮规则。
- 功能清单和相关文档：已同步 `FEATURE_INVENTORY.md`、能力规格、通知排障和 ontology，保留稳定 bundle ID；不写自动任务到滚动摘要，不新增重复事件记忆。

## 验证证据与边界

- Chromium 使用完整 `getWebviewHtml` 输出和模拟宿主授权回包（无外部登录服务，不适用 API 登录），通用 runner 执行桌面 1280×900、窄面板 420×800、手动拒绝/刷新和非 Mac 按钮隐藏四个场景，全部通过，无浏览器/网络错误。包含键盘页签切换、操作按钮在首屏内、模态框范围和页签不重叠断言。
- 浏览器结果：`.tmp/notification-authorization/{desktop,narrow,request,windows}/result.json`；截图：`.tmp/notification-authorization/desktop/success.png`、`.tmp/notification-authorization/narrow/success.png`。人工查看截图后将状态/按钮上移，避免窄面板首屏操作入口不可见。任务专用 server/scenario 文件验证后删除，保留结果和截图。
- 本机使用新助手的 `getAuthorization()` 调用原生 `--diagnose`，结果 `{"platform":"darwin","status":"authorized"}`；未发送测试通知、未重置系统权限。安装的系统设置扩展 `CFBundleIdentifier` 确认为 `com.apple.Notifications-Settings.extension`，与跳转目标一致。
- 本机已授权，未清除权限来复现首次系统弹窗；首次允许/拒绝及恢复使用原生脚本 VM、宿主单测和 Chromium 回包场景覆盖，不等同于未授权机器的系统弹窗实机验收。Windows/Linux 的原生通知也未做本次真机验收。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过（103 rules）；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过。
- Impeccable 检测无报告项；`git diff --check` 通过。未运行发布脚本、未创建分支或提交。

## 当前结论

实现、回归、构建、界面检查、本机只读诊断和文档同步完成。首次授权使用操作系统的稳定决定，不通过更换身份或清除权限反复弹窗；拒绝后的主动操作转系统设置。
