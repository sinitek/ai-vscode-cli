# 产研部群聊状态与继续入口

- 日期：2026-11-21
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-stop-unconfirmed-feedback.md`

## 背景与范围

现场总监任务持久记录已经停止，运行账本仍保留待确认的原执行占用。群聊用待清理占用开放中止，同时隐藏继续执行，用户无法从工具栏判断当前状态和恢复条件。

## 实现与验收

- 可信总监已停止时隐藏中止。显式标记中断的历史运行记录在群聊同步显示为已中止。真实运行状态下仍可中止冷任务。
- 原执行退出待确认时显示禁用的继续按钮并说明原因。清理确认后按原有恢复检查启用继续，重复中止消息在宿主入口被忽略。
- 群聊交互契约、功能清单及本体同步更新。

## 验证结果

- `npm run build` 通过。`node --test --test-reporter=tap dist/test/loop/{departmentGroupChatHost,departmentGroupChatPanel,loopGroupChatCoordinator,loopGroupChatPanel}.test.js dist/test/extensionHost/{departmentruntimecomposition,departmenttreecontrolintegration}.test.js` 通过 256 项。
- `DEPARTMENT_UI_DIST=dist DEPARTMENT_STOP_FEEDBACK=1 node scripts/department_group_chat_host_smoke.cjs` 在 Chromium 通过。覆盖停止请求在途、停止后保留占用、窄屏、后续清理确认与实际继续按钮提交。组织控制使用合成夹具。
- 读取现场指定任务的原任务记录和运行账本，使用内存只读端口调用实际群聊投影和渲染。确认总监显示已中止，中止按钮隐藏，继续按钮可见且禁用。
- 扩展回归的 `loopPlusGroupChatPanel.test.js` 有一项既有调度依赖断言失败。单独调用未改动的 `createLoopPlusScheduler` 在渲染前复现，相关派发返回 1 项而断言预期 0 项。
- 本体校验与 `git diff --check` 通过。已打开的 VS Code 实例仍需加载本次构建才能看到变更。
