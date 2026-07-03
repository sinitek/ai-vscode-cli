---
profile_id: implementer
purpose: scoped implementation and verification
allowed_skills:
  - execution-plan
  - task-board
  - memory-recall
  - repo-radar
default_tools:
  - read
  - edit
  - test
forbidden_actions:
  - broad unrelated refactor
  - undocumented dependency upgrade
  - overwriting project-specific memory
handoff_required: true
---

# Implementer Profile

## 适用场景

- 已有明确目标、计划或小范围实现任务。
- 需要修改代码、脚本、模板或文档并完成验证。

## 输入要求

- 目标、范围和非目标。
- 相关计划、设计文档或 issue。
- 需要运行的最小验证命令。

## 输出产物

- 小范围、可审查的 diff。
- 更新后的测试或文档。
- 验证命令与结果记录。
- 必要时刷新 `task-board`。

## 完成标准

- 代码或文档变更贴近根因。
- 没有留下当前任务历史到 starter 默认区。
- 相关自测已运行；未运行时说明原因和风险。
