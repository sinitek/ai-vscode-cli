# 产研部复用普通 Loop+ 执行

- 日期：2026-11-22
- 类型：refactor
- 状态：completed
- 关联计划：[群聊气泡剪贴板修复](2026-11-22-bugfix-group-chat-clipboard.md)（同一用户反馈）

## 背景与目标

生产日志与任务快照显示：Codex 员工 Owner 持久状态为 `cleanup-failed`，未产生回执；清理观察拒绝后，组织把组长标记为 blocked，下一次组长复核被 `leader-member-not-running` 拒绝并显示 `DEPARTMENT_NATIVE_UNKNOWN`。现有证据未留存 Owner 内部哪一项清理事实失败。上次分类修复没有改变这条执行链。

## 范围、风险与验收

- 新组织固定使用普通 Loop+ 主任务和员工执行、会话、异常复核与停止；组织层仅编排、统计和汇报，容量统计不拒绝普通 Loop+ attempt。
- 旧组织保留原 Owner 停止、核验与持久责任，不把未知原执行当作已结束，不迁移或重跑真实任务。
- 验证新组织不触发 Owner 执行/停止和员工清理观察，单个员工失败仍能由组长复核，正常完成及停止继续可用；运行构建和相关回归，更新功能、设计、ontology。

## 验证结果

- 真实调度器夹具模拟员工异常退出，通过组长事件复核、再次派发、验收、容量归还及停止继续，Owner 调用计数为零。
- 合入主工作区后，`npm run build`、ontology 校验和 `git diff --check` 通过。产研部、Loop+、群聊和剪贴板相关编译后单测 1168 项全通过，`node --test scripts/verify_department_full_eh_integration.test.js` 通过 39 项。
- 主工作区构建的隔离 VS Code 和真实 Codex 通过公开 Webview 入口完成两个模块。本机确定性响应服务处理 19 个请求，零失败，宿主退出码为 0。见[组合验证手册](../../../runbooks/department-full-eh-integration.md)。
- 截图中的旧任务仍保留原有记录，旧 Owner 清理事实无法核验。此轮验证使用新建隔离任务。
