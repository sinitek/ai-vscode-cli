# 产研部员工 Worker 构建空窗修复

- 日期：2026-11-19
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-19-bugfix-department-codex-employee-large-callback.md`（此前处理会话绑定后的大工具回调）

## 背景与目标

16:30:26 本仓启动标准构建，16:30:35 至 16:30:36 三个员工准备均以通道失联结束。持久准备记录停在未绑定，员工 Owner 目录未创建。宿主从源码仓的 `dist` 载入，而编译输出在失败期间重新生成。日常构建必须保留可启动的员工 Worker，失败编译也需保留上一份输出。

## 范围、风险与验收

- 调整 `npm run build`，继续用 TypeScript 校验并生成输出。打包入口仍按原流程清理旧产物。
- 开发构建保留旧输出，涉及文件改名或删除时，在隔离副本或宿主退出后显式清理。完整端到端运行使用固定构建快照。
- 用隔离回归夹具复现旧命令删除 Worker，验证修复后的失败编译保留 Worker，成功编译可生成并执行新输出。
- 用本机真实 Codex 和隔离 VS Code 验证员工执行、结果回传及清理。

## 验证结果

- `node --test scripts/build.test.js` 在旧构建命令下复现编译报错覆盖可运行 Worker，修复后保留旧 Worker 并能启动下一次成功编译的新 Worker。`npm run build` 通过。
- `node --test scripts/build.test.js scripts/fixtures/department_*_eh_scenario.test.js scripts/verify_department_full_eh_integration.test.js` 通过，共 81 项。另运行编译后的 `departmentcodexbootstrap`、`departmentleadercallbackprotocol`、`departmentproductioncomposition`、`departmentcoldstartproductionhost` 四个测试文件，共 88 项通过。
- 隔离副本运行 `node scripts/verify_department_full_eh_integration.js --product <实体构建副本> --report <新报告路径>`。早期失败定位为夹具仍读取旧的模块数文案及已移除的验收计数，改为识别现有文案和使用已存在的持久子任务及事件断言后通过。
- 在真实 VS Code 和 Codex 0.167.2 下，分别用两份物理构建在首个组长派发时执行 `npm run build`。以临时 Node 预载把 `tsc` 入口暂停 7 秒，以便稳定观察构建窗口。旧命令在派发时确实缺失 Worker，复现 `department-codex-owner-channel-unobservable`，零员工请求。新命令在派发时保留 Worker，首个员工在构建退出前进入原生 Responses，两个员工结果、组长验收、总监汇报、Owner 凭证与容量返还全部通过。两组构建均正常退出，VS Code 宿主均以码 0 退出。
- 真实验证使用隔离任务与本机 Responses 夹具。用户原任务保留。功能清单无需调整，因为变更发生在开发构建和测试夹具。业务角色、权限、协议和状态机无变更，无需更新 ontology。
