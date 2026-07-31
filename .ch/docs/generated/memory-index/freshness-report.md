# Freshness Report

热区文档的 freshness 默认按 `30` 天阈值检查；如果存在 `last_verified_at`，优先使用该字段，否则回退到文件修改时间。

| 文档 | 状态 | Freshness | last_verified_at | modified_at | Read | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `.ch/docs/MEMORY.md` | `active` | `stale` | 2026-05-21 | 2026-06-29T05:11:09+00:00 | ~19 | 这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。** |
| `.ch/docs/memory/ACTIVE_RISKS.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~15 | starter placeholder |
| `.ch/docs/memory/EVENT_MEMORY.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-29T01:09:57+00:00 | ~20 | starter placeholder |
| `.ch/docs/memory/LESSONS_LEARNED.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~14 | starter placeholder |
| `.ch/docs/memory/PENDING_ITEMS.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~14 | starter placeholder |
| `.ch/docs/memory/PROJECT_CONTEXT.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~15 | starter placeholder |
| `.ch/docs/memory/README.md` | `active` | `stale` | 2026-05-21 | 2026-07-25T14:49:44+00:00 | ~18 | 这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。 |
| `.ch/docs/memory/ROLLING_SUMMARY.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-29T01:09:57+00:00 | ~22 | starter placeholder |
| `.ch/docs/memory/USER_PREFERENCES.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~15 | starter placeholder |

## Active Plan Activity

- `.ch/docs/exec-plans/active/2026-06-04-trace-error-bubble-dedupe.md` 最后修改于 2026-06-25T01:59:58+00:00，读取成本约 588 tokens
- `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md` 最后修改于 2026-07-14T01:27:53+00:00，读取成本约 916 tokens
- `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md` 最后修改于 2026-07-07T01:50:50+00:00，读取成本约 338 tokens
- `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md` 最后修改于 2026-07-14T03:33:01+00:00，读取成本约 1597 tokens
- `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md` 最后修改于 2026-07-14T01:27:53+00:00，读取成本约 463 tokens
- `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` 最后修改于 2026-07-11T03:33:13+00:00，读取成本约 1645 tokens
- `.ch/docs/exec-plans/active/2026-07-12-cli-config-visualization.md` 最后修改于 2026-07-13T04:55:42+00:00，读取成本约 5599 tokens
- `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md` 最后修改于 2026-07-15T01:12:08+00:00，读取成本约 5964 tokens
- `.ch/docs/exec-plans/active/2026-07-31-p0-performance-memory-hardening.md` 最后修改于 2026-07-31T01:25:56+00:00，读取成本约 2028 tokens
