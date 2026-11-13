# 系统通知独立于窗口焦点

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：feature

## 背景与目标

现有提醒控制器把系统通知与窗口闪烁共用后台条件，前台任务完成会直接丢弃通知。用户要求前台、后台都发送系统通知，任务栏闪烁仅在后台触发。

## 范围与非目标

- 调整共享提醒控制器，覆盖人工交互、Vibe、经典 Loop 与 Loop+ 主任务完成。
- 保留通知开关、远程宿主边界、事件去重、并发聚合、子任务过滤和异步清理。
- 不改变依赖、CLI、系统通知设置或安装发布流程。说明文档与同步维护原分别归已退役 docs、chore companion，非现行职责；已完成回归开发的历史证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-desktop-notification-focus.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。

## 验收标准

- 前台人工交互及主任务完成各发送一次系统通知，不请求任务栏闪烁。
- 后台通知与闪烁正常，返回前台清理闪烁；切换窗口与重复完成事件不重发通知。
- 通知关闭、远程宿主、扩展释放和发送失败仍按原边界处理，通知等待不阻塞窗口清理。

## 风险与缓解

- 焦点恢复与排队完成事件存在竞争：先派发系统通知，再清理完成窗口状态；历史回归证据见上述来源审计，不代表存在存活 test 计划。
- 系统接收不等于横幅展示：本机检查编辑器通知身份、Notifier.Setting 及仅本插件的通知历史，不把命令退出成功称为已显示。
- 回滚限控制器行为；文案及同步风险分别见关联计划。

## 验证计划与历史结果

- 历史行为验证包括构建、66 项回归和真实 Windows transport；回归证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-desktop-notification-focus.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。迁移归属审计的本来源 notes 保留环境依赖恢复及同步后 135 项通过的摘要，原 chore 完整日志已不可导航，均非本轮执行。

## 本机 Windows 验证

- 使用构建后的 `dist/humanInteractionAttention.js` 与 `dist/desktopAttention.js`，创建隔离的前台状态控制器，调用真实 Windows transport，不写运行记录。
- 完成事件重复上报一次，再切换控制器状态到后台并刷新；结果为 `notificationCommands=1`、`windowCommands=0`、无错误，验证前台通知派发和完成事件不重放。
- 实际通知发送身份为已注册的 `Microsoft.VisualStudioCode`；发送后 `NotifierSetting=Enabled`，系统历史中本插件 `Group=sinitek-cli-tools` / `Tag=task-completed` 的记录为 1。
- 已调用真实系统通知；接口成功与历史记录不代替用户对横幅可见性的确认。Linux/macOS 通过相关单测验证共享逻辑与既有适配器，未做真机桌面展示验证。

## 最终结论

- 两处后台门槛已移除：通知先独立派发，后台条件仅约束窗口图标提醒，前台完成状态在通知派发后清理。
- 源码与构建产物已修复；当前已加载的扩展需要加载本次构建后才会采用新行为。本次不执行安装、重载或发布。
- 功能清单、规格、架构与 ontology 事实同步由关联 docs 交付，不另增热区记忆或事件条目。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留系统通知焦点与宿主回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-desktop-notification-focus.md`；不再作为现行测试开发责任。
- 历史文档分工：系统通知焦点规则与使用说明同步，共享本来源的历史背景与接口。 原 docs companion `2026-11-05-docs-desktop-notification-focus.md#背景与目标` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- [十一月迁移归属审计](../../migrations/2026-11-11-nov-active.json)（原 `2026-11-05-chore-desktop-notification-focus.md` 已退役，仅历史追溯）：分别承接系统通知远端同步与本机构建依赖恢复，共享本来源的历史背景与接口。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。

## 退役同步维护的失败与限制

[十一月迁移审计](../../migrations/2026-11-11-nov-active.json)以 `old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-desktop-notification-focus.md` 保留原分工和摘要：曾同步 `origin/master 65d669c`，首次缺少 `@iarna/toml`、完整安装中止、Windows GBK 失败，后经 UTF-8 恢复并记录同步后 135 项通过。它是历史摘要，不恢复原 chore 的完整命令/日志，也不表示本轮安装依赖或同步远端。前台 1 通知/0 闪烁与横幅未确认、Linux/macOS 未真机的边界仍见上文。
