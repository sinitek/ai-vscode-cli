---
name: harness-workbench
description: Use when you need to launch or explain the local Python management page for task-board, work-frontier, generated docs, and harness maintenance entry points.
---

# Harness Workbench

目标：提供一个零依赖 Python 管理页，把 task board、frontier、generated docs 和常用 harness 入口集中到浏览器中查看。

## 什么时候用

- 用户想用一个本地页面维护或浏览 harness 状态。
- 需要快速查看 active plans、task board、frontier、changed paths 和关键文档入口。
- 希望避免引入 Node、数据库或常驻复杂服务。

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/harness-workbench/scripts/serve_workbench.py`
2. 浏览器打开终端输出的地址，默认是：
   - `http://127.0.0.1:8765`
3. 如需换端口：
   - `python3 .agents/skills/harness-workbench/scripts/serve_workbench.py --port 8899`

## 能力边界

- 只使用 Python 标准库。
- 默认只读展示状态，不提供浏览器内写文件能力。
- 页面数据来自 repo 文件和 generated artifacts；缺失时会给出生成命令提示。
- 不替代正式 IDE，也不引入 CodeBuddy 产品依赖。

## 不要这样做

- 不要把它变成模板必需的常驻服务。
- 不要把浏览器页面里的临时状态当成长期事实来源。
- 不要在 starter 里预置当前仓库的真实任务数据。
