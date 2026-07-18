# Topic Corpus

这个文件把 observation entries 按 topic 分组，作为跨任务复用和 reference pack 导出的轻量 corpus 起点。

## plan

- Entries: 8
- Estimated read cost: ~565 tokens

- `mem-0b64dd15aa` `plan` Trace Error Bubble Dedupe -> `.ch/docs/exec-plans/active/2026-06-04-trace-error-bubble-dedupe.md`
- `mem-bbc18d3434` `plan` Loop 主任务失败终止护栏 -> `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md`
- `mem-4b483bd801` `plan` MCP 市场全量检测与权威刷新 -> `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`
- `mem-5233a00937` `plan` Codex、Claude、OpenCode CLI 配置可视化扩展 -> `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md`
- `mem-e2fabd8a2e` `plan` Loop Group Chat UI Follow-ups -> `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md`
- `mem-fe60588b95` `plan` Loop 红蓝辩论主持人轮流点名调度 -> `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md`
- `mem-b7b003c3a1` `plan` 官方 skills 版本刷新与最新判断修复 -> `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md`
- `mem-d336cba178` `plan` Harness 单元自测与 Chromium Playwright 能力吸收 -> `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md`

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
