# 总监主会话标签的关闭权限

- 日期：2026-11-27
- 类型：bugfix
- 状态：completed
- 负责人：Codex

## 目标与范围

产研部 ☀️ 总监标签应在失败、等待复核、停止和完成后保留。宿主原来只锁定运行中的主任务，手动关闭、会话接管和部分后台清理共用同一入口。旧日志的 `direct` 不能区分触发来源。

## 实施与验收

在宿主区分用户关闭与自动清理，保护已绑定的总监标签和恢复的历史标签。保留员工交接回收及已有关闭按钮准入。以单测覆盖误清理、手动关闭、会话接管和持久化，运行 `npm run build` 及隔离扩展宿主验证。

## 验证结果

- `npm run build` 通过。会话、部门调度、Loop+ 运行集成及 Webview 相关的 574 项测试全部通过。覆盖 `error`、`needs-review`、`stopped`、`completed`，包括重载、迟到清理和显式关闭。
- macOS 隔离 VS Code 使用本地模型夹具，经公开入口创建产研部并使总监转入 `needs-review`。从界面读取原标签的 ☀️ 标记，点击其关闭按钮后核对同一标签 ID 已从工作区记录移除。宿主退出码为 0。报告位于 `.tmp/director-tab-eh-final.json`。
- 初次宿主验证中新建相邻标签后，侧栏分页导致定位原标签的等待超时。重跑时先准备相邻标签，再创建总监任务并验证同一个标签。
- 单独执行 `node --test dist/test/extensionHost/loopPlusEntryRouting.test.js`，6 项通过，2 项在 Loop+ 提问的 VM 测试夹具中失败。夹具缺少 `resolveCompletedLoopSubtaskTabBinding`。记录位于 `.tmp/director-tab-routing-final.log`。
- 功能清单、部门设计及 ontology 已同步，ontology 校验通过。
