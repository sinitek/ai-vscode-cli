---
memory_type: project_context
scope: project
status: active
last_verified_at: template-fill-when-adopted
source_of_truth: .ch/docs/memory/PROJECT_CONTEXT.md
derived_from: []
supersedes: []
related_paths: []
---

# 项目上下文

这个文件只保留**跨会话优先需要知道**、且相对稳定的项目级事实。

## 什么时候更新

- 项目目标结构发生稳定变化
- 核心构建/测试命令变化
- 新增或调整跨模块边界、关键约束、关键入口
- 某项规则已经足够稳定，值得从计划或设计文档上提

## 不该写什么

- 单次任务的临时背景
- 只在某一阶段有效的操作细节
- 大段架构解释
- 无来源的推断

## 建议结构

### 项目目标

- starter 默认留空；接入真实项目后补充 3 到 5 条长期有效目标。

### 关键路径

- starter 默认留空；接入真实项目后补充核心目录、入口文件、关键脚本。

### 核心命令

- starter 默认留空；接入真实项目后补充 build、test、dev、lint 等最小命令集。

### 跨模块约束

- starter 默认留空；接入真实项目后补充必须优先遵守的边界。

### 事实来源

- starter 默认留空；接入真实项目后链接到对应 `ARCHITECTURE.md`、设计文档、计划或规格。
