# Topic Corpus

这个文件把 observation entries 按 topic 分组，作为跨任务复用和 reference pack 导出的轻量 corpus 起点。

## plan

- Entries: 2
- Estimated read cost: ~94 tokens

- `mem-404964a44a` `plan` Loop 全 CLI 模型与思考力度路由修复 -> `.ch/docs/exec-plans/active/2026-11-03-bugfix-loop-cli-model-routing.md`
- `mem-85ae764cb4` `plan` Loop routing live acceptance and 1.7.6 release gate -> `.ch/docs/exec-plans/active/2026-11-03-chore-loop-routing-live-acceptance-release.md`

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
