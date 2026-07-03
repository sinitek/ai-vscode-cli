# task-board 生成物

这里存放由 `task-board` skill 生成的任务工作台产物。

## 生成方式

在仓库根目录运行：

```bash
python3 .agents/skills/task-board/scripts/build_task_board.py
```

## 产物

- `task-board.md`：给人阅读的任务工作台。
- `task-board.json`：给 Python 管理页、脚本或其他轻量 UI 消费的数据源。

## 事实来源

`task-board.*` 是可重建产物，不是长期事实来源。真实事实仍应维护在：

- `.ch/docs/exec-plans/active/`
- `.ch/docs/handoffs/`
- `.ch/docs/memory/`
- git 工作区和测试输出

复制模板后，本目录默认只保留说明文件，不预置当前任务数据。
