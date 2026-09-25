# Topic Corpus

这个文件把 observation entries 按 topic 分组，作为跨任务复用和 reference pack 导出的轻量 corpus 起点。

## plan

- Entries: 3
- Estimated read cost: ~296 tokens

- `mem-538cb1444d` `plan` Loop+ 完成事件驱动验收 -> `.ch/docs/exec-plans/active/2026-09-24-loop-plus-mode.md`
- `mem-91b4245892` `plan` 可维护性重构 -> `.ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md`
- `mem-d3aa6ffe1b` `plan` 计划标题 -> `.ch/docs/exec-plans/active/2026-09-25-loop-needs-review-tab-reopen.md`

## gotcha

- Entries: 1
- Estimated read cost: ~46 tokens

- `mem-431f2548e1` `rule` 热区记忆面 -> `.ch/docs/memory/README.md`

## rule

- Entries: 1
- Estimated read cost: ~39 tokens

- `mem-c1d7e714b7` `rule` 记忆流转规则 -> `.ch/docs/MEMORY.md`

## Topic Reuse Hint

如果某个 topic 已经稳定，应优先回链对应原始事实来源、runbook、design docs 和 core skills；不要把 generated corpus 本身复制成唯一事实来源。
