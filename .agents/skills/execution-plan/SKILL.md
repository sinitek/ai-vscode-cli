---
name: execution-plan
description: Use for non-trivial, multi-step, risky, or cross-cutting changes that need an in-repo execution plan, explicit acceptance criteria, validation notes, and documentation sync.
---

# Execution Plan

目标：把长周期任务变成仓库内可继续、可验收、可交接的执行记录。

## 什么时候用

- 任务分为多个阶段
- 涉及多个目录、多个系统边界或多个角色
- 涉及迁移、重构、质量治理、平台改造、安全/可靠性基线
- 本轮不能一次性完全收尾，需要给后续代理或人类留下清晰上下文

## 工作流

1. 使用 `.ch/docs/exec-plans/TEMPLATE.md` 创建或更新 `.ch/docs/exec-plans/active/<YYYY-MM-DD>-<slug>.md`。
2. 记录目标、背景、范围、非目标、验收标准、影响面、风险、验证计划、未决问题。
3. 把任务列表与计划状态保持一致。
4. 如果实现过程中出现关键决策或偏离，立刻写回计划或相关设计文档。
5. 收尾前，检查相关文档是否需要同步更新，包括：
   - `ARCHITECTURE.md`
   - `.ch/docs/*.md`
   - `.ch/docs/design-docs/*`
   - `.ch/docs/product-specs/*`
   - `.ch/docs/references/*`
6. 工作真正完成后，把计划移入 `.ch/docs/exec-plans/completed/`，并留下验证结论。

## 产出要求

- 给出当前计划文件路径
- 标记当前阶段
- 明确已经验证了什么、还缺什么

## 不要这样做

- 不要为一两个小改动滥建计划
- 不要省略验收标准
- 不要在计划里隐藏未验证风险
