# Topic Corpus

这个文件把 observation entries 按 topic 分组，作为跨任务复用和 reference pack 导出的轻量 corpus 起点。

## plan

- Entries: 2
- Estimated read cost: ~126 tokens

- `mem-7525b245ac` `plan` Codex 组长大型原生回调私有 IPC 修复 -> `.ch/docs/exec-plans/active/2026-11-18-bugfix-department-codex-large-callback.md`
- `mem-52c8a09d98` `plan` Loop+ 启动前配置锁超时后显式继续 -> `.ch/docs/exec-plans/active/2026-11-18-bugfix-loop-plus-config-lock-resume.md`

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
