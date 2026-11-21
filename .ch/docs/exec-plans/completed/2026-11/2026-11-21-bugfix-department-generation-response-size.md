# 产研部原代次回包超限修复

- 日期：2026-11-21
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-single-stop.md`

## 背景与目标

现场一代组长累积 46 张执行票据，原 authority 仍监听，`observe` 的 65,690 字节回包超过 64 KiB，连接被服务端主动关闭。同一问题已影响员工启动回包和群聊中止。修复原代次的私有 IPC，让组长与员工能按正常中止流程收尾。

## 范围与验收

原 authority 和客户端共享 64 KiB 请求和 16 MiB 响应上限。响应超限返回固定错误码。冷中止在共同身份预检后并行发起总监中止和各组原代次控制。单组断连时可达组仍收到中止请求，完整原 Owner 回执仍是组织结算依据。沿用现有工作区的前序中止修复。

## 风险与验证

已运行 worker 使用启动时加载的代码。原群聊两个组的 authority 均已封闭，过大回包的组有 46 张票据和 45 条持久责任。原 Owner 有 44 个不可达、1 个清理未确认，另有 1 张无绑定的准备票据。另一组原 Owner 也不可达。现场仅有只读确认，原群聊的清理与停止结算仍无完整证据。

## 验证结果

- `npm run build` 通过。新增真实 worker 跨 64 KiB 复现于旧实现，修复后在 256 张票据边界验证完整快照、中止控制、轮询与拒绝续派。
- `node --test dist/test/runtime/departmentgenerationauthority.test.js dist/test/extensionHost/{departmentcoldgenerationrecovery,departmentruntimecomposition,departmentruntimeintegration,departmenttreecontrolintegration,departmentproductionwiring,departmentproductioncomposition,departmentleaderproductionhost}.test.js dist/test/loop/departmentGroupChatHost.test.js` 通过 277 项。两组冷中止测试核对可达原代次收到真实控制。首轮有一条测试仍期待前序版本的旧停止文案，已更新断言并保留原清理检查。
- `node --test scripts/verify_department_full_eh_integration.test.js scripts/fixtures/department_continuation_eh_scenario.test.js` 通过 46 项。首次实机测试在停止收尾保存代次前过早采样，公开停止和清理已经通过。将采样移至公开继续控件可用后，复测通过。
- `node scripts/verify_department_full_eh_integration.js --scenario <场景> --product <隔离产品目录> --report <新报告>` 在 macOS 隔离 VS Code、真实 Codex CLI 和本机确定性 provider 上通过 `stop-continue`、`cold-recovery`。报告为 `/tmp/sinitek-department-generation-response-evidence.5biPaWHQ/stop-continue-final.json` 和 `/tmp/sinitek-department-generation-response-evidence.5biPaWHQ/cold-recovery.json`。
- 产品清单、协调协议与生产接线设计已同步。本体校验及 `git diff --check` 通过。
