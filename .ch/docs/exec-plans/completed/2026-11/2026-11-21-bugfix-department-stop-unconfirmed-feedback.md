# 产研部中止未确认的转发与反馈

- 日期：2026-11-21
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-stop-partial-drain.md`

## 背景与范围

两个原代次已经封闭派发。只读探测发现一个原协调端点断连，多个原 Owner 无法提供退出证据。冷中止只在首次请求断连时向原 Owner 转发，后续轮询断连或已有控制冲突会跳过这条路径。日志受调试开关影响，群聊只显示统一的未确认文案。

## 验收

- 首次请求或轮询通信失败、已有控制冲突及退出未确认时，向通过身份复核的原 Owner 转发中止。
- 冷中止按组记录固定失败分类及转发结果。群聊反馈按实际原因区分连接异常与退出未确认。
- 原清理凭证继续决定容量结算与继续。用已有真实 worker 集成夹具验证转发、保留占用和无新执行。

## 验证结果

- `npm run build` 通过。`node --test --test-reporter=tap dist/test/extensionHost/departmentcoldgenerationrecovery.test.js` 通过 13 项。首次回归断言把另一组自身的原执行中止误计为后备转发，已改用逐组诊断核对原请求及后备动作。
- `node --test --test-reporter=tap dist/test/runtime/departmentgenerationauthority.test.js dist/test/extensionHost/{departmentruntimecomposition,departmentruntimeintegration,departmenttreecontrolintegration,departmentproductionwiring,departmentproductioncomposition,departmentleaderproductionhost}.test.js dist/test/loop/departmentGroupChatHost.test.js` 通过 268 项。
- macOS 隔离 VS Code 宿主在真实 Codex CLI 和本机确定性 provider 下通过 `cold-recovery` 与 `stop-continue`。使用 `node scripts/verify_department_full_eh_integration.js --scenario <场景> --product <隔离构建> --report <新报告>`。报告目录为 `/tmp/sinitek-dept-stop-feedback-evidence.HFo2Mx/`。
- 本体校验与 `git diff --check` 通过。功能清单及代次协调协议设计已同步。

## 原任务状态

总监已持久保存为停止，两组原代次均已封闭派发。按账本和原协调端一致的原绑定补发中止后，45 个原 Owner 端点不可达，1 个未确认退出，另有 1 张原协调端票据无绑定。这条历史任务缺少完整退出证据，仍保留原占用。隔离宿主验证覆盖当前改动的运行路径，原窗口仍使用加载时的插件代码。
