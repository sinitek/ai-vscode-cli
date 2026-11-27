# 总监优先处理组长阻塞事件

- 日期：2026-11-27
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-27-bugfix-department-leader-blocker-recovery.md` 已实现原组长恢复，本次补齐调度唤醒。

## 背景与目标

总监当前受经典 Loop 累计轮次限制。在总监回合执行期间到达的组长阻塞，可能被较早生成的暂停决策覆盖。总监应由部门事件驱动，并在已有协调回合返回后优先处理新阻塞。

## 范围与验收

- 正在等待的总监在组长阻塞结算后立即运行，有在途回合时串行复核最新汇报。
- 总监超过经典 Loop 轮次后继续消费部门事件，空闲时等待下一次唤醒。
- 总监可以继续使用原组长恢复流程。显式停止、澄清和宿主恢复核验依然有效。非部门 Loop 调度不在本次范围。

## 实施与验证

- 组长失败或阻塞结算会推进阻塞事件版本并唤醒总监。宿主在决策产生副作用前核对版本，跳过在途旧决策，串行开启下一轮协调。
- 工作区及隔离快照的 `npm run build` 通过。`node --test --test-timeout=30000 dist/test/extensionHost/{departmentruntimecomposition,departmentorchestration,departmentruntimeintegration,departmentproductioncomposition,loopMainDecisionParsing,loopTaskStateMachine,loopPlusRuntimeIntegration}.test.js` 共 309 项通过。覆盖超过经典轮次仍能恢复原组长、兄弟组长仍在运行时使在途暂停决策失效、处理完事件后回到等待，以及停止后迟到结算。
- macOS 隔离 VS Code 使用真实 Codex CLI 和本机确定性响应服务。运行 `node <隔离构建>/scripts/verify_department_full_eh_integration.js --scenario loop-plus --product <隔离构建> --report <报告>`，使用关联计划的阻塞夹具。公开入口创建部门后，原组长通过同一会话接收总监恢复指令，从代次 1 续到代次 2，完成验收、总监汇报与容量归还。宿主正常退出，报告在 `.tmp/director-event-eh.lZBysx/report-final.json`。
- 早期宿主试跑先后遇到隔离副本缺验收脚本、默认 Playwright 路径缺失、确定性夹具依赖原有协议标识。补齐脚本，指定本机 Playwright 模块，并保留原有 `使用经典 Loop JSON 决策。` 协议标识后通过。线上模型和 Windows/Linux 实机仍待对应环境验证。
- 已同步产研部设计、功能清单和 ontology。ontology 结构校验、9 项 ontology 单测及 `git diff --check` 通过。
