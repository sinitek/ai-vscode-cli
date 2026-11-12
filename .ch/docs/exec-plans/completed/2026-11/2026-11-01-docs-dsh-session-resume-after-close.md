# DSH 会话恢复事实文档同步

- 日期：2026-11-01
- 状态：completed
- 类型：docs
- 负责人：Codex

## 关联计划

- 文档共同背景及恢复行为实现见 [`2026-11-01-bugfix-dsh-session-resume-after-close.md`](2026-11-01-bugfix-dsh-session-resume-after-close.md)；markerless 和隔离边界回归见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-01-dsh-session-resume-after-close.md`）。

## 目标与范围

同步 CLI runtime reference、FEATURE_INVENTORY、PITFALLS 和 ontology 中 DSH_HOME 与 ACP session ID 绑定、跨 Tab 恢复、markerless 有界查找、安全路径及无法恢复已删除临时目录的边界。不改变实现或测试范围。

## 验收与真实结果

- 上述事实源同步已完成；没有修改 Loop/Loop+ 调度逻辑。
- 原计划记录的 whitespace 和 ontology validate 均通过；本次迁移未重跑这些历史检查。

## 当前结论

独立事实文档维护已按原记录完成，状态 `completed`；本记录不替代后续对事实源的全仓引用审查。

## 验证计划

本轮仅核对本记录与关联来源的历史证据、职责分配及具体链接；原业务命令与执行结果以本记录和关联计划的历史记录为准，不重跑测试、构建、浏览器或真实CLI。
