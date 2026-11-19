# 修复 Loop / Loop+ 中断子任务续跑

- 日期：2026-11-19
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

巡检把失联子任务从原执行流移除或推入验收，导致用户点击“继续”时不能续跑。保留可恢复的任务和原执行身份，只有真实完成回报才能进入正常验收流程。

## 范围与非目标

- 调整经典 Loop 等待批次、群聊继续入口及 Loop+ 失联预留恢复；不改变主动停止、真实失败和已有验收事件的处理。
- 不迁移历史验收记录，不修改模型、调度并发上限或界面样式。

## 验收标准

- 失联后不会直接推进主任务复核或为可恢复子任务创建验收事件。
- 继续可恢复未完成子任务，保留 Loop+ 原 attempt、会话及活跃同级；迟到结果不能回报旧执行。
- 真实成功结果可正常回报；继续说明仍交给原调度器。

## 影响面与风险

- 范围：扩展宿主编排、群聊控制状态、回归测试、恢复设计、功能清单和 ontology。
- 使用已有执行身份及持久化快照，不改存储格式；保留对无原始子任务记录的残留预留处理。

## 验证计划

- `npm run build` 后运行经典 Loop、Loop+ 编排、群聊入口及异常子进程集成测试；随后扩大相关回归范围。
- 验证 ontology 和变更空白检查，记录真实 CLI 或 GUI 未覆盖项。

## 交付与验证

- 经典 Loop 巡检后保留 `runtimeInterrupted` 父任务及原批次等待，上下文允许群聊继续恢复 blocked 子任务；不会把失联子任务作为已完成项交给主任务。
- Loop+ 巡检取消已失联 runner、保留开放 attempt 并标记子任务 blocked；显式续跑重启原 attempt，完成回报后才进入验收，无法关联记录的残留预留仍按失败验收处理。
- `npm run build`：通过。
- 定向单测：`loopWaitWatchdog` 与 `loopModelSwitchResume` 17 项通过；`loopPlusOrchestration` 与 `loopPlusRuntimeIntegration` 213 项通过；`loopGroupChatCoordinator` 48 项通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `git diff --check`：通过。未运行完整测试集或 Extension Development Host/真实 CLI 验证。
