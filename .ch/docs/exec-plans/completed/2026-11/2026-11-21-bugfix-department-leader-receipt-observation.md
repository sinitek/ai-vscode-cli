# 产研部组长原 Owner 回执观察修复

- 日期：2026-11-21
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-20-bugfix-department-task-catalog-contention.md` 和 `.ch/docs/exec-plans/completed/2026-11/2026-11-21-feature-department-advisory-capacity.md`。
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-21
- claim_ttl：本轮任务结束
- handoff_to：无

## 背景与目标

北京时间 2026-11-21 05:45 的组长日志记录会话持久化或绑定失败。09:34 的组长在原 Owner 已写入完整回执后报观察失败。隔离 worker 证实旧代码在活动会话字段随 Tab 关闭变得不可读时提前断开原通道。现存日志足以定位失败阶段，未保存具体拒绝分支。

## 范围与验收

- [x] 用独立组长 worker 验证任务会话读取不可用时仍能观察原 Owner 回执。
- [x] 启动前核对活动会话，关闭后匹配持久账本、原执行身份与回执。
- [x] 会话绑定阶段和 producer 校验记录固定枚举。

## 影响面与风险

涉及组长 Codex bootstrap、执行 producer、定向回归及对应运维文档。回执只经原客户端观察，后续组织释放继续独立复核原代次和完整凭证。

## 验证结果

`npm run build` 和 216 项定向测试通过。`departmentleadercodexowner.test.ts` 同时验证 Tab 关闭后原回执仍可观察、账本缺失时拒绝，以及日志脱敏和序号一致。隔离 macOS VS Code / Codex 使用本机确定性响应，工作区额度场景收齐五份原 Owner 回执并核验 CLOSED 集合和自然退出。报告为 `/tmp/sinitek-department-final-eh.json`。

广域回归 1371 项中 1366 项通过。`close racing worker readiness` 和 `closure-persistence` 在干净基线 `32743245` 同样失败，另三项 Tab 提问 FIFO 在同一基线失败。证据为 `/tmp/sinitek-department-domain-verified.log`、`/tmp/sinitek-advisory-baseline.log` 和 `/tmp/sinitek-department-fifo-baseline.log`。运行中的原任务日志为只读取证，修复使用隔离宿主验证。
