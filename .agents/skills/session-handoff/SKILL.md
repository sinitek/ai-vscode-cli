---
name: session-handoff
description: Use when a non-trivial task will continue in a later session and you need a concise in-repo handoff based on the handoff template and promotion checklist.
---

# Session Handoff

目标：把一次工作暂停时最关键的上下文收口成仓库内 handoff 文档，降低下一次会话的冷启动成本。handoff 的事实源是 `.ch/docs/handoffs/TEMPLATE.md`，脚本只负责实例化模板和填入少量仓库快照。

## 什么时候用

- 非平凡任务本轮不能完全收尾
- 当前任务会在下一次会话继续
- 需要把已完成、未完成、风险和上提动作明确交给后续代理或人类

## 工作流

1. 先确认当前任务确实需要跨会话交接，而不是只需要更新执行计划。
2. 在仓库根目录运行：
   - `python3 .agents/skills/session-handoff/scripts/create_session_handoff.py --slug <slug> --title "<title>"`
3. 打开生成的 handoff 文档，补全模板中的人工判断部分：
   - 本轮摘要
   - 已完成
   - 未完成 / 下一步
   - 验证结论
4. 按 `.ch/docs/MEMORY.md` 判断哪些内容需要上提到热区、设计、runbook、规格或 skills。

## 脚本边界

- 脚本只做机械化：生成日期化文件名、替换模板占位符、列出 active plans，并提取 pending item / active risk 的简短快照。
- 脚本不推断任务结论，不生成长篇 scaffold，不替代执行计划或记忆整理。
- 如果需要修改交接结构，优先编辑 `.ch/docs/handoffs/TEMPLATE.md`，不要在脚本里复制一份新骨架。

## 产出要求

- 告知 handoff 文件路径
- 明确当前停在什么位置
- 明确下一次最先该做什么

## 不要这样做

- 不要把 handoff 写成长流水账
- 不要用 handoff 替代执行计划
- 不要把应该上提的长期结论永远留在 handoff 里
- 不要把脚本当成复杂数据生成器；handoff 的质量主要来自人工补全和检查清单
