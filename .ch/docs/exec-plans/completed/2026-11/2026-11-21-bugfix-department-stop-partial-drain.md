# 产研部冷中止和部分执行退出

- 日期：2026-11-21
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-generation-response-size.md`

## 背景与目标

旧代次响应断连，另一组仍可接收原执行中止。冷宿主需要持久停止总监派发，原协调进程需要向各个已绑定的 Owner 转发中止，即使其它执行的清理证据暂不可用。

## 范围与验收

同一个群聊中止请求覆盖总监和各组原执行。启动配置检查与完整退出证明不前置阻塞中止。部分失败显示退出未确认并保留原占用和继续门禁，成功路径必须经过原有完整清理结算。用定向单测复现旧代次应答失败、个别 Owner 不可达和无绑定票据，随后验证真实扩展宿主的正常停止与冷恢复路径。

## 实现和验证

- 冷中止持久保存总监状态，先并行发出取消，再准备结算路由。原协调端点通信失败时向可验证的原 Owner 发送中止。协调进程在原宿主失联时独立取消全部已绑定的执行。只有原清理凭证齐全才确认退出与释放占用。
- `npm run build` 通过。`node --test dist/test/runtime/departmentgenerationauthority.test.js dist/test/extensionHost/{departmentcoldgenerationrecovery,departmentruntimecomposition,departmentruntimeintegration,departmenttreecontrolintegration,departmentproductionwiring,departmentproductioncomposition,departmentleaderproductionhost}.test.js dist/test/loop/departmentGroupChatHost.test.js` 通过 278 项。
- `node --test scripts/verify_department_full_eh_integration.test.js scripts/fixtures/department_continuation_eh_scenario.test.js` 通过 46 项。首次与运行时套件并跑时，旧脚本一条 80 毫秒计时断言先命中全局截止，隔离重跑通过。
- `node scripts/verify_department_full_eh_integration.js --scenario <场景> --product <隔离产物> --report <报告>` 使用 macOS VS Code、Codex CLI 0.167.2 和本机确定性 provider，通过 `cold-recovery`、`stop-continue`。报告位于 `/tmp/sinitek-dept-partial-stop-evidence.OSQ5xb/`。
- 本体校验、`git diff --check` 通过。现场只读复核显示两个原代次均已封闭派发，部分原 Owner 不可达或退出未确认，仍有无绑定票据。原任务的退出结算仍然待确认。当前交付为已构建的工作区补丁。
