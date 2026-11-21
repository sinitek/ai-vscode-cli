# 产研部一次中止整组任务

- 日期：2026-11-21
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-leader-receipt-observation.md`
- 状态：completed
- 负责人：Codex

## 背景与目标

产研部中止应停止总监、所有组长 Loop+ 和活动员工。原流程等待单独取消的成员收尾后才向其它组长发出停止，已标记阻塞的组长也会跳过停止调用。群聊将原执行清理投影成额外的核验操作。

## 范围与验收

- 中止立即关闭派发，并行发出整组停止，保留已产出的结果。
- 群聊只提供一次中止。已持久化停止且无待清理责任的任务可以直接走原继续流程。
- 收尾异常有明确反馈。原执行身份和真实清理责任仍由宿主处理。

## 验证结果

- `npm run build` 通过。`node --test --test-timeout=30000 dist/test/extensionHost/department{runtimecomposition,runtimeintegration,treecontrolintegration,coldgenerationrecovery}.test.js dist/test/loop/departmentGroupChat{Host,Panel}.test.js` 通过 210 项。初轮旧夹具仍尝试手工结束已取消的员工，并要求并发停止分别执行，已按新契约更新。
- `node --test scripts/verify_department_full_eh_integration.test.js scripts/fixtures/department_continuation_eh_scenario.test.js` 通过 46 项。公开续接驱动复用按根任务定位的 CDP 适配器，修复旧遍历方式找不到活动群聊的问题。
- `DEPARTMENT_STOP_FEEDBACK=1 DEPARTMENT_UI_DIST=dist node scripts/department_group_chat_host_smoke.cjs` 通过。浏览器结果保存在 `/tmp/sinitek-department-single-stop-browser/result.json`。
- `node scripts/verify_department_full_eh_integration.js --scenario stop-continue --product <隔离产品目录> --report <报告路径>` 使用隔离 macOS VS Code、真实 Codex CLI 和本机确定性服务通过公开中止、原 Owner 清理、占用释放和公开续接，报告为 `/tmp/sinitek-department-single-stop-eh-cdp.json`。
- 本体校验通过，已同步群聊交互契约、产研部设计及功能清单。
