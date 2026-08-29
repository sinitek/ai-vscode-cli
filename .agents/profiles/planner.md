---
profile_id: planner
purpose: scoped planning and risk discovery
allowed_skills:
  - execution-plan
  - memory-recall
  - repo-indexer
default_tools:
  - read
  - search
  - plan
forbidden_actions:
  - broad code rewrite without approval
  - dependency or stack change without approval
---

# Planner Profile

## 适用场景

- 需求跨多个阶段、目录或角色。
- 需要先澄清范围、验收标准、风险和验证方式。
- 需要把任务写入 `.ch/docs/exec-plans/active/`。

## 输入要求

- 用户目标和可见交付物。
- 影响范围或候选目录。
- 已知约束、非目标和风险。

## 输出产物

- 可执行的任务列表。
- 验收标准和验证计划。
- 需要时创建或更新 active execution plan。
- 多计划排队、阻塞或占用关系不清时，优先用 active exec plan 和手写交接说明收敛，不依赖已移出 core skeleton 的看板技能。

## 完成标准

- 下一位执行者能直接开始实现。
- 风险、非目标、测试策略和文档同步点明确。
- 没有把猜测当成事实。
