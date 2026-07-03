---
name: task-board
description: Use when you need a generated task workbench view across active execution plans, changed files, checks, blockers, and review entry points.
---

# Task Board

目标：把当前 active execution plans、工作区变更、验证命令和阻塞点压缩成一个可审查的任务工作台。

## 什么时候用

- 任务跨多个阶段，需要让人快速看到当前进度。
- 同时存在多份 active plans，需要汇总状态、owner、下一步和阻塞。
- 收尾前需要检查变更文件、测试记录和剩余事项是否清楚。
- 需要给 Python 管理页或其他轻量 UI 提供稳定 JSON 数据源。

## 不该什么时候用

- 当前只是一次性小改动，且没有 active plan。
- 你要修改计划内容本身，而不是生成工作台视图。

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/task-board/scripts/build_task_board.py`
2. 查看 Markdown 工作台：
   - `.ch/docs/generated/task-board/task-board.md`
3. 如需给脚本或管理页消费，读取：
   - `.ch/docs/generated/task-board/task-board.json`
4. 如果发现计划字段、测试记录或阻塞信息缺失，回到对应 active plan 或 handoff 补齐事实来源。

## 产出要求

- 明确扫描了多少 active plans。
- 汇总 pending / in_progress / blocked / completed 的任务数量。
- 列出每份计划的 owner、下一步、阻塞、验证记录和源文件。
- 列出当前 git 工作区已变更文件，方便审查产物。
- 整篇 `private: true` / `memory_visibility: private` 的计划必须跳过，`<private>...</private>` 区块不得出现在 generated JSON/Markdown 中。
- starter/template 过滤只针对显式模板文件或明确声明为 template/starter 的占位计划，不能因为正文提到“starter 默认”之类说明文字就丢掉真实计划。

## 不要这样做

- 不要把 generated task board 当成唯一事实来源。
- 不要在 task board 里手写长期结论；长期事实应上提到 `.ch/docs/memory/`、design docs 或 runbooks。
- 不要把当前模板仓库的任务历史写入 starter 默认文件。
