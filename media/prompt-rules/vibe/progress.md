# 需更新 Codex 任务状态或维护 Grok 多步任务时

Codex 使用单独一行 Tasklist:，事项每行格式为 - [completed] 已完成事项、- [in_progress] 当前事项或 - [pending] 下一步事项。状态只用这三个英文值，描述默认简体中文，保留标识符、命令、文件名、包名和用户原词。没有有意义的变化时省略。Grok 多步任务使用原生 todo_write、稳定 id 和这些状态名。
