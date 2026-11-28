# 产研部重启后的运行状态

- 日期：2026-11-28
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-27-bugfix-department-restart-task-history.md`
- 状态：completed
- 负责人：Codex

## 目标与范围

VS Code 重启后，太阳标签、组长标签、总监及组长群聊应根据当前宿主的执行情况显示状态。覆盖默认受控目录重新取得所有权、历史目录、异常退出和其他窗口仍持有来源的情况。继续和整组中止沿用原有身份与容量核验。

## 验收与验证

- [x] 使用带有 `running` 记录和开放员工任务的隔离数据，在新 Extension Host 验证标签首屏、群聊和刷新。
- [x] 核对本窗口仍有调度器、其他窗口持有来源、已结束任务的表现，检查读取的副作用。
- [x] 完成构建、定向回归、功能清单与本体校验，记录运行证据。

## 调查记录

此前的重启用例把数据放在独立历史目录，旧宿主释放来源后才启动新宿主。标签和分钟巡检各自读取任务状态，群聊的本地执行判断还依赖组织控制查询。此次从实际的默认受控目录和恢复后的首屏开始验证。

旧构建在 `--restart-owned` 首屏复现太阳标签的 `running` 样式。生产存储的两份组长记录在打开标签后均变为 `stopped + runtimeInterrupted`。普通 Loop 的显示查询触发了孤儿任务写回，而总监保留磁盘上的 `running`。当前实现将来源写权和本地执行分别判定，标签、群聊和分钟巡检共用 `observeDepartmentExecution`，成员历史记录按只读方式展示。

## 验证结果

- `npm run build` 通过，扩展从 `dist/extension.js` 加载。
- 14 个标签、群聊、所有权与恢复测试文件共 213 项通过。部门整组中止、显式继续与总监等待控制器另有 10 项通过。针对性测试日志在 `.tmp/department-restart-liveness/final-tests.log` 和 `.tmp/department-restart-liveness/final-resume.log`。
- `node scripts/verify_department_conversation_host.js` 分别使用 `--restart-owned`、`--restart-abrupt`、`--restart-history`、`--restart-needs-review`。4 个 macOS VS Code 实例均正常退出，Webview 错误数为 0。每个场景分别核对任务文件和沟通文件的哈希，异常退出场景另核对原 Owner 标记的原始内容。夹具通过生产仓储预置历史任务，新宿主实际恢复面板和嵌入群聊。
- 两个独立 Node 宿主同时打开隔离任务目录，第二个宿主将原窗口持有的任务读为“待核实”。旧版标记缺少 PID、不同主机、非法 PID 与同机进程退出分别有回归覆盖。
- 本体校验和 9 项本体工具单测通过。功能清单、群聊边界、UI 契约和排查手册均已同步。
