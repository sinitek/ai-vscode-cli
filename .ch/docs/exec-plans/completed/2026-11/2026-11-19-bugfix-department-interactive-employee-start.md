# 产研部交互员工首轮启动与总监等待修复

- 日期：2026-11-19
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-19-bugfix-department-director-wait-state.md`
- 状态：completed
- 负责人：Codex

## 背景、范围与风险

本机日志先出现交互员工 `department-interactive-invocation-never-started`，随后所属组长清理无法核验，总监报熔断诊断缺失。生产 Loop+ 新员工 Tab 初始无会话，但部门交互 Owner 在普通 runner 有机会建立会话之前就要求本地会话。保留既有续接、原生授权与清理门禁，不迁移历史任务、不发布扩展。当前工作树含相关未提交代码，验证采用物理隔离源码副本，不清理共享 `dist/`。

## 验收与验证

- [x] 新交互员工先获得本地会话，本地键不充当真实 CLI 会话；有效续接不改绑，取消和目标不匹配不启动。
- [x] 诊断保留具体启动阶段、attempt 与安全错误码，不输出会话或提示词；未知清理仍保留容量。
- [x] 总监缺失 blocker 时，仍有其他组长工作就等待；无活动组长且有宿主证实的失败时，说明真实阻塞，不误称已向模型补诊断。关联实现及回归见 `2026-11-19-bugfix-department-director-wait-state.md`。
- [x] `npm run build`、交互员工及总监定向回归、Ontology 校验与功能清单同步。

## 实现与验证

- 已核对 2026-11-19 `department-interactive-invocation-never-started` 日志和持久快照；失败 attempt 是本组 Grok 员工 `platform-antd-finish`。总监收到的 `DEPARTMENT_NATIVE_UNKNOWN` 是该组 Loop+ 主调用进入未知清理后的 fail-closed 结果，不是 Grok 服务错误。
- 修复新交互员工 Tab 的本地会话键初始化，增加按 attempt/stage 的白名单 lifecycle 日志，并将精确准备失败交给原 Loop+ attempt。
- 设计、功能清单与 Ontology 已同步。
- 根因已确认：新员工 Tab 的本地 `sessionId` 为空；入口将其当作执行前置条件而在启动 runner 前抛错，finally 再以 `department-interactive-invocation-never-started` 结束观察。员工准入因此正确保留未确认容量；总监收到的是后续 Loop+ `DEPARTMENT_NATIVE_UNKNOWN` 清理未知信号。
- 隔离副本 `/tmp/sinitek-department-employee-fix.63OjwN`：`npm run build` 通过；五个定向文件 `departmentinteractiveruntime`、`departmentruntimecomposition`、`loopPlusRuntimeIntegration`、`loopMainDecisionParsing`、`extensionHostExtractionContracts` 共 192/192 通过。Ontology 校验与测试 9/9 通过，范围空白检查通过。
- 公开 VS Code Extension Host 的真实 Grok 新员工启动未在本轮重放；验证覆盖生产入口结构契约和跨全部五种交互 CLI 的 Owner/Loop+ 运行时回归，不改动或恢复本机旧任务。
- 当前工作树存在并行未提交改动；本次只保留原工作区修改，隔离构建副本不影响共享 `dist/`。
