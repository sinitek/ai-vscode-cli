# Topic Corpus

这个文件把 observation entries 按 topic 分组，作为跨任务复用和 reference pack 导出的轻量 corpus 起点。

## gotcha

- Entries: 1
- Estimated read cost: ~46 tokens

- `mem-431f2548e1` `rule` 热区记忆面 -> `.ch/docs/memory/README.md`

## rule

- Entries: 1
- Estimated read cost: ~39 tokens

- `mem-c1d7e714b7` `rule` 记忆流转规则 -> `.ch/docs/MEMORY.md`

## Reference Pack Hint

如果某个 topic 已经稳定，可以把对应原始事实来源、runbook、design docs 和 skills 纳入 `reference-pack` 的自定义 preset；不要导出 generated corpus 本身作为唯一事实来源。
