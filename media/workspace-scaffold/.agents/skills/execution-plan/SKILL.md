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
2. 记录目标、背景、范围、非目标、验收标准、影响面、风险、验证计划、单元自测命令、未决问题。
3. 把任务列表与计划状态保持一致。
4. 如果实现过程中出现关键决策或偏离，立刻写回计划或相关设计文档。
5. 收尾前，检查相关文档是否需要同步更新，包括：
   - `ARCHITECTURE.md`
   - `.ch/docs/*.md`
   - `.ch/docs/design-docs/*`
   - `.ch/docs/product-specs/*`
   - `.ch/docs/references/*`
6. 对有一定复杂度的功能，按项目现有测试体系执行单元自测；若失败，先按实现缺陷、断言过期、夹具问题、环境问题、历史失败或范围外失败分类，再修复、隔离或记录。
7. 工作真正完成且计划头部状态标记为 `completed` 后，把计划移入 `.ch/docs/exec-plans/completed/<YYYY-MM>/`，月份取计划日期，并留下验证结论；不要把完成计划平铺在 `completed/` 根目录。
8. 归档后更新仓库内引用该计划的具体路径，验证目标文件存在，并在结果中返回完整归档路径。
9. 需要枚举历史完成计划时，递归扫描 `.ch/docs/exec-plans/completed/**/*.md`，并使用完整相对路径作为计划标识。

## 产出要求

- 给出当前计划文件路径
- 标记当前阶段
- 明确已经验证了什么、还缺什么
- 记录单元自测命令、结果和失败处理结论

## 不要这样做

- 不要为一两个小改动滥建计划
- 不要省略验收标准
- 不要在计划里隐藏未验证风险
