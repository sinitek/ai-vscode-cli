# Topic Corpus

这个文件把 observation entries 按 topic 分组，作为跨任务复用和 reference pack 导出的轻量 corpus 起点。

## plan

- Entries: 2
- Estimated read cost: ~195 tokens

- `mem-8f3107f15f` `plan` CLI 跨平台运行时策略收敛 -> `.ch/docs/exec-plans/active/2026-11-24-refactor-cli-runtime-policy-convergence.md`
- `mem-707183a27e` `plan` Loop+ 主决策 JSON 格式诊断 -> `.ch/docs/exec-plans/active/2026-11-25-bugfix-loop-plus-decision-json-diagnostics.md`

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
