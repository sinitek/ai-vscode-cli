# 主任务与 Vibe 完成桌面提醒

- 日期：2026-11-04
- 状态：completed
- 类型：feature
- 负责人：Codex

## 背景与目标

人工交互已具备后台系统通知和窗口提醒。本次沿用“携宁 CLI 提醒”身份，在 Vibe 成功结束或经典 Loop / Loop+ 主任务真正完成时提醒；子任务、主模型中间轮次、上下文压缩、失败、取消和暂停不触发完成提醒。

## 范围与非目标

- 复用本机桌面传输和统一窗口提醒生命周期；任务完成与人工交互并发时不得互相清除窗口提醒。
- 仅后台提醒，回到窗口后清理图标提醒；前台完成不留待下次切后台重放。
- 完成通知与窗口提醒提供独立应用级开关，默认开启；文案固定，不包含任务、路径或会话内容。
- 不改变调度、验收、取消、超时或授权语义；不新增依赖、不抢焦点、不增加声音、不承诺通知点击导航或 macOS Dock 弹跳。
- Windows / macOS 差异基于实际实现和平台官方文档；不把命令成功等同于用户看见。

## 关联计划

- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-task-completion-desktop-attention.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
- 文档交付：[2026-11-04-docs-task-completion-desktop-attention.md](2026-11-04-docs-task-completion-desktop-attention.md)。本计划只承接完成提醒实现和业务过滤。

## 验收标准

- Vibe 成功运行各执行路径与经典 Loop / Loop+ 最终主任务完成均接入，子任务和中间主模型轮次不通知。
- 同一完成事件去重；前台、远程 workspace 宿主、失败、停止和压缩均保持静默。
- 通知和窗口通道独立、异步且尽力而为，失败不阻塞主任务。
- 并发人工交互与完成提醒共享窗口状态，恢复焦点和释放能清理迟到窗口调用。
- 构建与相关测试通过，功能清单、架构和 ontology 同步。

## 影响面与风险

- 代码：`src/humanInteractionAttention.ts`、`src/desktopAttention.ts`、`src/macosDesktopNotifications.ts`、`src/taskCompletionAttention.ts`、`src/extension.ts`、`src/extensionHost/`。
- 配置：`package.json`，保留已有其他任务版本改动。
- 风险：中间轮次误报、压缩误报、两种提醒互相清除、授权等待阻塞；通过业务过滤、明确完成钩子、统一控制器及回归测试缓解。
- 不撤销工作区既有人工交互提醒实现及其他并发改动。

## 验证计划

- `npm run build` 后运行桌面提醒、执行宿主和 Loop+ 最小相关单测。
- 用隔离持久存储路径执行一次 macOS 原生完成通知，记录投递结果；不修改既有授权。
- `git diff --check`、变更范围空白检查、ontology validate 与 ontology Python 测试。
- Windows / Linux 无真机环境，明确记录未验证范围。

## 任务列表

- [completed] 核对现有提醒、执行记录与主任务真正完成入口。
- [completed] 实现完成提醒与业务过滤。
- [completed] 验证提醒边界并整理 Windows / macOS 差异。

## 决策记录

- 2026-11-04：遵循用户补充，只有主任务或 Vibe 完成提醒，子任务不提醒。主模型一次调用结束不代表主任务完成。
- 2026-11-04：人工交互与完成提醒共享同一窗口状态管理，使用独立的完成提醒设置，不再创建会互相停止的第二套控制器。
- 2026-11-04：Vibe 用运行 ID、Loop 主任务用任务 ID 与完成持久化时间标识完成事件；最近 512 个事件去重。同一主任务续跑并再次完成可正常提醒，历史重复加载不会补发。多项完成聚合一个待查看状态，避免长期后台无限积累记录。

## 验证结果

- `npm run build`：通过，日志 `/tmp/sinitek-completion-attention-build.log`。
- 提醒与完成入口单测 123 项全部通过：`node --test dist/test/core/humanInteractionAttention.test.js dist/test/core/desktopAttention.test.js dist/test/core/macosDesktopNotifications.test.js dist/test/core/taskCompletionAttention.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/extensionHost/taskCompletionAttentionHost.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`；日志 `/tmp/sinitek-completion-attention-tests.log`。
- 执行宿主与 Loop 接线相关 94 项全部通过：`node --test dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusEntryRouting.test.js dist/test/extensionHost/loopTaskStateMachine.test.js`；日志 `/tmp/sinitek-completion-attention-runtime-tests.log`。两组共 217 项通过。
- 全量 `node scripts/run_unit_tests.js`：2809 项，2802 通过、4 失败、3 跳过；日志 `/tmp/sinitek-completion-attention-full-tests.log`。4 项与本任务前人工交互提醒验证的历史失败一致：`loopPlusModeEntry.test` 两项、`looppluswebviewintegration.test` 一项缺少 `readVisibleConfigSelections`，`runPromptHistoryWebview.test` 一项缺少 `vscode`。三个测试文件及 `src/webview` 与 HEAD 无差异，分类为范围外夹具问题，未修改无关代码。
- 本次新增的 Loop+ 通知测试首次未提供 `reviewEventIds`，触发既有验收门槛使 Promise 未收口；分类为新增测试夹具错误，补齐真实 review 事件后 123 项全部通过，未改动验收门槛。
- macOS 最小本机真实验证：Node 调用编译后的 `notifyTaskRunCompletion` → 统一控制器 → 原生 transport，复用既有隔离持久助手目录；投递结果 `{"status":"submitted","authorizationStatus":2,"alertSetting":2}`。日志 `/tmp/sinitek-completion-attention-macos-smoke.log`。未重置授权、未修改 bundle ID。系统接受投递不等于用户实际看见横幅。
- ontology validate：通过（100 条规则）；ontology Python 测试 9 项全部通过。
- `git diff --check` 与本任务变更文件 trailing whitespace 检查：通过。
- 新增/更新 `ARCHITECTURE.md`、两份产品清单与 ontology 完成提醒规则。无新的可复用事故或跨会话开放问题，不追加 `EVENT_MEMORY.md`；保留上轮原有记忆改动。

## Windows 与 macOS 对比依据

- 代码入口由 CodeGraph 定位，最终行为以当前文件直接读取、构建、回归与 macOS 本机投递验证为准。
- Windows：实际编辑器身份发送静默 Toast，按编辑器主进程枚举可见窗口并用 `FlashWindowEx` 的 `FLASHW_TRAY | FLASHW_TIMERNOFG`（14）请求任务栏闪烁；显式 stop（0）及恢复焦点清理，不抢焦点。不同通知类型分配不同 Tag。官方文档确认该 API 不改变窗口激活状态，`FLASHW_TIMERNOFG` 持续至窗口前台。
- macOS：独立固定身份后台助手发送 `UNUserNotificationCenter` 通知，复用原有授权和缓存；没有接入宿主 VS Code 的 Dock 弹跳。原生 `NSApplication.requestUserAttention` 是应用自身的注意力请求，不代表扩展能从独立助手弹跳宿主 Dock 图标。助手为 `LSUIElement`，不创建额外 Dock 图标。
- 两端都可能受通知设置或勿扰影响；不保证显示，也不承诺点击通知导航到具体任务。Windows / Linux 无真机环境；未运行 Extension Development Host 完整端到端；构建不代表安装或发布，需使用更新后的扩展。
- 官方核对来源（2026-11-04，通过直接请求读取）：
  - https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-flashwindowex
  - https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-flashwinfo
  - https://developer.apple.com/documentation/appkit/nsapplication/requestuserattention(_:)
  - Apple 官方文档 JSON：`https://developer.apple.com/tutorials/data/documentation/appkit/nsapplication/requestuserattention(_:).json`。

## 当前结论

完成提醒已实现并通过相关验证；用户要求的子任务过滤、主任务最终完成门槛、前台静默、压缩静默、两类提醒并发清理与设置独立均有回归覆盖。未发布、未安装、未提交代码，保留其他任务版本及工作区改动。归档：`.ch/docs/exec-plans/completed/2026-11/2026-11-04-task-completion-desktop-attention.md`。
