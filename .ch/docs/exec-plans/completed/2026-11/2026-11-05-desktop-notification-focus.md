# 系统通知独立于窗口焦点

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex

## 背景与目标

现有提醒控制器把系统通知与窗口闪烁共用后台条件，前台任务完成会直接丢弃通知。用户要求前台、后台都发送系统通知，任务栏闪烁仅在后台触发。

## 范围与影响面

- 调整共享提醒控制器，覆盖人工交互、Vibe、经典 Loop 与 Loop+ 主任务完成。
- 同步设置描述、使用说明文案、功能清单、能力规格、架构与 ontology。
- 保留通知开关、远程宿主边界、事件去重、并发聚合、子任务过滤和异步清理。
- 不改变依赖、CLI、系统通知设置或安装发布流程。

## 验收标准

- 前台人工交互及主任务完成各发送一次系统通知，不请求任务栏闪烁。
- 后台通知与闪烁正常，返回前台清理闪烁；切换窗口与重复完成事件不重发通知。
- 通知关闭、远程宿主、扩展释放和发送失败仍按原边界处理，通知等待不阻塞窗口清理。
- 构建、相关单元测试、ontology 校验和本机 Windows 投递验证完成。

## 风险与缓解

- 焦点恢复与排队完成事件存在竞争：先派发系统通知，再清理完成窗口状态，增加回归用例。
- 系统接收不等于横幅展示：本机检查编辑器通知身份、Notifier.Setting 及仅本插件的通知历史，不把命令退出成功称为已显示。
- 回滚仅涉及本次控制器与文案改动。

## 验证计划

- `npm run build`
- `node --test dist/test/core/humanInteractionAttention.test.js dist/test/core/desktopAttention.test.js dist/test/core/taskCompletionAttention.test.js dist/test/core/macosDesktopNotifications.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/extensionHost/taskCompletionAttentionHost.test.js dist/test/webview/notificationAuthorization.test.js`
- `python .agents/skills/ontology/scripts/search_ontology.py --validate`
- `python -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`
- 用构建后的控制器调用真实 Windows transport，验证前台事件派发、无窗口闪烁及本插件通知历史。

## 测试与清单同步

- 已更新共享控制器与 Windows 宿主回归测试，覆盖前台、后台、焦点竞争、通知关闭、远程宿主、去重和失败路径。
- `npm run build` 通过；上述七个 Node 测试文件共 66 项全部通过，无跳过。
- ontology 校验通过；`PYTHONUTF8=1 PYTHONIOENCODING=utf-8` 下上述 Python 单测 9 项全部通过。
- 首次构建失败分类为环境依赖缺失：本机未安装 manifest 已声明的 `@iarna/toml`。完整 npm 安装因重新解析依赖树耗时而中止，改用 `npm pack @iarna/toml@2.2.5 --ignore-scripts` 仅恢复该包，未改依赖版本或锁文件；之后构建通过。
- 首次 Python 单测失败分类为 Windows 编码环境问题：父进程按 GBK 解码 UTF-8 子进程输出。启用上述 UTF-8 环境后全部通过，未改测试实现。
- 已同步 `FEATURE_INVENTORY.md`、能力规格、设置描述、使用说明、`ARCHITECTURE.md` 和 ontology 两条提醒规则。使用说明仅修改文案，既有 Webview 单测已通过，无布局或交互变化，未启动浏览器验收。

## 本机 Windows 验证

- 使用构建后的 `dist/humanInteractionAttention.js` 与 `dist/desktopAttention.js`，创建隔离的前台状态控制器，调用真实 Windows transport，不写运行记录。
- 完成事件重复上报一次，再切换控制器状态到后台并刷新；结果为 `notificationCommands=1`、`windowCommands=0`、无错误，验证前台通知派发和完成事件不重放。
- 实际通知发送身份为已注册的 `Microsoft.VisualStudioCode`；发送后 `NotifierSetting=Enabled`，系统历史中本插件 `Group=sinitek-cli-tools` / `Tag=task-completed` 的记录为 1。
- 已调用真实系统通知；接口成功与历史记录不代替用户对横幅可见性的确认。Linux/macOS 通过相关单测验证共享逻辑与既有适配器，未做真机桌面展示验证。

## 最终结论

- 两处后台门槛已移除：通知先独立派发，后台条件仅约束窗口图标提醒，前台完成状态在通知派发后清理。
- 源码与构建产物已修复；当前已加载的扩展需要加载本次构建后才会采用新行为。本次不执行安装、重载或发布。
- 稳定规则已沉淀至规格、架构与 ontology，局部修复过程仅保留在本计划，不另增热区记忆或事件条目。

## 提交前远端同步验证

- 同步 `origin/master` 的 `65d669c` 通知设置更新，处理功能清单、能力规格和 `viewContentStrings.ts` 三处文案冲突。保留“工具设置 → 通知授权”、两个独立通知开关及远端设置说明，并合入前后台系统通知、仅后台窗口提醒的规则。
- 同步后 `npm run build` 通过；以下十个测试文件共 135 项全部通过，无跳过：

```powershell
node --test --test-reporter=spec dist/test/core/humanInteractionAttention.test.js dist/test/core/desktopAttention.test.js dist/test/core/taskCompletionAttention.test.js dist/test/core/macosDesktopNotifications.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/extensionHost/taskCompletionAttentionHost.test.js dist/test/webview/notificationAuthorization.test.js dist/test/webview/loopPlusModeHelp.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/session/sessionMessageActions.test.js
```

- ontology 校验通过，UTF-8 环境下 ontology Python 单测 9 项全部通过；`git diff --check` 通过。
