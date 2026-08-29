# Agent Profiles

Agent profile 用来定义“角色契约”，把 CodeBuddy 式 subagent 的优点转译成 repo-native Markdown 规则。

Profile 不是新的运行时，也不是强制调度器。它只回答：

- 这个角色适合做什么？
- 输入必须包含什么？
- 允许使用哪些 skills？
- 不能做哪些事？
- 产出和交接标准是什么？

## 默认角色

- `planner.md`：拆解需求、识别风险、产出执行计划。
- `implementer.md`：按计划做小范围实现、补验证、更新相关文档。
- `reviewer.md`：审查 diff、风险、测试缺口和交接质量。

## 使用规则

- 多阶段任务先选一个主 profile，再按需要切换。
- profile 只收窄角色边界，不覆盖根级 `AGENTS.md` 和 `.ch/docs/` 的稳定规则。
- 如果任务需要跨会话继续，输出必须能被 active exec plan 继续承接。
