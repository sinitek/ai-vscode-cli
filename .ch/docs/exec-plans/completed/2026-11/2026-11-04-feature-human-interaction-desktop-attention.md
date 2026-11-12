# 人工交互系统通知与窗口图标提醒

- 日期：2026-11-04
- 状态：completed
- 类型：feature
- 负责人：Codex

## 背景与目标

用户切到其他应用后，需要及时知道 Vibe 人工交互或 Loop/Loop+ 主任务澄清正在等待处理。

## 范围与非目标

- 接入现有人工交互和主任务澄清生命周期，仅后台窗口触发原生系统通知和可用的窗口图标提醒。
- Windows 使用系统通知和任务栏闪烁；macOS 在扩展存储生成并注册固定身份的 JXA 后台应用，调用现代 UserNotifications，不承诺 VS Code Dock 弹跳；Linux 使用可用的 notify-send 和 X11 wmctrl。
- 不新增依赖、不安装系统工具、不抢焦点、不修改技术栈；远程扩展宿主不在远程机器执行桌面提醒。
- 不新增声音，不承诺系统通知点击导航；勿扰模式、通知权限、Linux 桌面环境可能限制提醒。
- 保留当前工作区已有配置漂移修复；不创建分支或工作树，不覆盖用户未提交改动。

## 关联计划

- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-human-interaction-desktop-attention.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
- 文档交付：[2026-11-04-docs-human-interaction-desktop-attention.md](2026-11-04-docs-human-interaction-desktop-attention.md)。本计划只承接提醒实现和宿主接线。

## 验收标准

- 同一交互只发送一次通知；前台不发送；请求结束、取消、超时、返回窗口、扩展释放时停止图标提醒。
- 并发请求之间不互相清除仍需保留的图标提醒；慢速原生调用完成后不得遗留过期闪烁。
- 通知仅包含固定中文文案，不暴露问题、答案、密码、项目路径或模型输出。
- 两项提醒可在 VS Code 设置中独立关闭；工具缺失或原生调用失败不影响交互任务。
- 控制器、平台命令和宿主接线的历史回归、构建及本机验证结果见下文；测试开发不属本计划，其历史摘要按关联删除审计定位。

## 影响面

- 代码：`src/extension.ts`、提醒控制器与平台适配、`package.json`、相关测试。
- 文档：功能清单、能力规格、ontology；本计划。

## 风险与缓解

- Windows/Linux 非本机平台：验证命令生成及生命周期，不将 mock 当作真实系统展示验证。
- macOS 不具备稳定公开 Dock 接口：用户已通过结构化确认接受系统通知降级。
- 系统通知授权、勿扰与外部工具缺失：尽力提醒，失败记录日志，不阻塞原任务。
- 当前存在其他任务未提交改动：只改本任务接线位置，保留已有差异。

## 验证计划

- `npm run build`
- 新增提醒测试与现有人机交互、主任务澄清相关测试。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- 本机 macOS 实际执行固定文案系统通知；明确区分命令成功和用户是否肉眼看到。

## 任务列表

- [completed] 核对现有入口、平台边界与用户选择。
- [completed] 实现提醒控制器、平台适配和宿主接线。
- [completed] 完成提醒控制器、平台适配和宿主接线。
- [completed] 验证实现边界并记录未覆盖平台。

## 决策记录

- 2026-11-04：用户确认“按稳定能力实现”，不要求 macOS Dock 弹跳；采用系统自带工具、无新增 npm 依赖。
- 2026-11-04：裸 osascript 返回成功，但用户未看到通知；usernoted 日志记录 `com.apple.ScriptEditor2 needs a valid url to ask permissions, none found`。改为生成具有固定 bundle ID 的本地通知应用，不改通知权限、不绕过勿扰。
- 2026-11-04：应用放在临时目录、使用旧 AppleScript 通知均被系统拒绝；持久目录中注册固定身份应用并改用 `UNUserNotificationCenter` 后，成功显示授权请求。用户在系统设置手动开启权限，系统 API 授权状态由 1 变为 2。
- 2026-11-04：JXA completion handler 的 Objective-C 桥接实测触发非主线程异常；回调只保存结果，主线程 run loop 处理。JavaScript `null` 触发器被系统解码为 `NSNull` 并报 XPC 4097；改用 `$()` 表达 nil，投递成功。
- 2026-11-04：按用户要求统一通知标题和 macOS 助手显示名为“携宁 CLI 提醒”；保持 bundle ID 不变。文案改为启动参数，不写死在缓存脚本中。
- 2026-11-04：通知授权可等待最长 60 秒，但不占用窗口提醒串行状态队列；补充授权未完成时焦点恢复、交互结束与释放仍能及时清理的测试。

## 实现与测试

- `src/humanInteractionAttention.ts`：后台判断、按交互去重、并发待处理、独立开关、串行窗口状态、异步通知与迟到清理；澄清使用 try/finally 包装。
- `src/desktopAttention.ts`：无 shell 的 `execFile`，默认 8 秒超时；Windows 已安装编辑器身份的静默 Toast 和按主进程 PID 的 `FlashWindowEx`；Linux 已有 notify-send 与 X11 wmctrl。
- `src/macosDesktopNotifications.ts`：全局存储内原子生成、缓存、签名、注册 JXA 应用；无新增依赖；60 秒共用 deadline，启动命令 65 秒超时，独立 JSON 结果文件，完成后清理。正式缓存版本 `macos-v4`。
- `src/extensionHost/humanInteractionAttentionHost.ts`：焦点与配置事件、平台身份、本机/远程宿主边界和释放；`src/extension.ts` 普通交互、经典 Loop 澄清、Loop+ 依赖注入接线。
- 新增控制器、原生命令、macOS 助手与宿主接线测试，并更新 Loop+ 注入回归。macOS 脚本通过 VM 直接执行，覆盖 nil、主线程桥接、授权、拒绝、投递失败、诊断和超时；不是只检查脚本文本。

## 验证结果

- `npm run build`：通过。
- 最小相关命令：

```sh
node --test dist/test/core/humanInteractionAttention.test.js dist/test/core/desktopAttention.test.js dist/test/core/macosDesktopNotifications.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/core/humanInteraction.test.js dist/test/core/humanInteractionHistory.test.js dist/test/core/orchestratorClarification.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js
```

- 相关 157 项全部通过，覆盖普通提交、取消、超时、经典澄清包装与 Loop+ 注入。输出：`/tmp/sinitek-desktop-attention-tests.log`。
- 全量 `node scripts/run_unit_tests.js`：2788 项，2781 通过、4 失败、3 跳过。失败均属于范围外 Webview 夹具：`loopPlusModeEntry.test` 两项和 `looppluswebviewintegration.test` 一项缺少 `readVisibleConfigSelections`；`runPromptHistoryWebview.test` 一项缺少 `vscode`。相关 Webview 源码和失败测试文件 `git diff --quiet HEAD` 无差异；单独重跑三个测试文件复现相同 4 项失败（20 通过）。未扩大修复范围。输出：`/tmp/sinitek-desktop-attention-full-tests.log`、`/tmp/sinitek-desktop-attention-out-of-scope-tests.log`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（99 条规则）。`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项全部通过。`git diff --check` 与 `node scripts/check_trailing_whitespace.js <本次变更文件>`：通过，包含新增未跟踪文件。
- 本机 macOS 15.6.1：真实编译、签名、注册、启动助手并调用系统通知 API。拒绝权限时正确失败、不影响任务；手动授权后回报 `{"status":"submitted","authorizationStatus":2,"alertSetting":2}`。用户要求重发后，结构化确认“看到了”，实际展示通过。
- 真实验证调用编译后的 `createMacOSDesktopNotificationSender` 和 `runDesktopAttentionCommand`，使用 Application Support 下隔离持久目录、固定中文测试文案；正式扩展使用 `context.globalStorageUri.fsPath`，未写入项目、交互问题或答案。
- Windows/Linux 没有真机环境，只验证生成命令、身份/PID 过滤及状态生命周期；没有将 mock 结果写成真实展示通过。未启动 Extension Development Host，完整用户任务以宿主接线回归与本机原生助手验证覆盖，发布后仍建议在三平台分别人工验收。

## 文档与记忆同步

- 同步功能总表、能力规格、架构、ontology；真实失败原因和排障步骤上提到 PITFALLS，并保留一条事件记忆。无需修改滚动摘要、用户画像或新增 skill。
- 保留其他任务的版本和配置改动，不提交、不建分支。

## 当前结论

两项提醒已接入，macOS 用户可见展示已验证；构建、相关回归、ontology 与结构校验通过，全量范围外失败已分类记录。本计划完成归档；Windows/Linux 真实展示与 Extension Development Host 端到端验收作为已明确的平台覆盖限制保留。
