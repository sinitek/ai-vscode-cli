---
name: execution-plan
description: Use for non-trivial, multi-step, risky, or cross-cutting work that needs a resumable in-repo plan, explicit acceptance criteria, validation notes, and documentation sync.
---

# Execution Plan

目标：把长周期任务变成仓库内可继续、可验收、可交接的执行记录。分类、命名、拆分和归档以 `.ch/docs/exec-plans/README.md` 为单一事实来源，使用 `.ch/docs/exec-plans/TEMPLATE.md`。

## 什么时候用

- 任务分为多个阶段，涉及多个目录、系统边界或角色。
- 涉及迁移、重构、质量治理、平台改造或安全/可靠性基线。
- 本轮不能一次性完全收尾，需要给后续代理或人类留下清晰上下文。

## 工作流

1. 创建或更新 `.ch/docs/exec-plans/active/YYYY-MM-DD-<type>-<kebab-case-slug>.md`。日期后只能出现一个 type：`feature`、`bugfix`、`refactor`、`chore`、`docs`、`test`、`perf`；不要使用 `feat` 或 `fix`。具体含义以 README 为准，`bugfix` 专指已发布版本中的 bug 修复。
2. 记录目标、背景、范围、非目标、验收标准、影响面、风险、验证计划、测试命令和未决问题。
3. 一个任务包含多个实质工作类型时，按类型分别建计划；每份分别有目标、范围、验收、验证和真实状态。在“关联计划”写具体路径并说明共同背景与依赖。禁止只选主类型、混合多个 type、复制整篇混合正文或把实质工作藏在附带事项中。仅记录验证执行证据不构成 `test` 开发计划。
4. 把任务列表与计划状态保持一致；拆分不伪造完成，也不改变既有阻塞状态。
5. 如果实现过程中出现关键决策或偏离，立刻写回计划或相关设计文档。
6. 收尾前，检查架构、主题文档、产品规格、记忆、测试结果及 ontology 是否需要同步。
7. 只有计划真实完成且状态为 `completed` 后，才按计划日期归档到 `completed/YYYY-MM/`；不要把完成计划平铺在 `completed/` 根目录。
8. 归档或迁移后更新应更新的具体引用并核对目标；枚举历史完成计划时递归扫描 `completed/**/*.md`，保留完整相对路径。

## 产出与验证

- 记录当前计划路径、阶段、已验证与未验证范围、命令和结果、失败处理结论及下一步。
- 不要为一两个小改动滥建计划，不要省略验收或隐藏未验证风险。
