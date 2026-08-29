# Freshness Report

热区文档的 freshness 默认按 `30` 天阈值检查；如果存在 `last_verified_at`，优先使用该字段，否则回退到文件修改时间。

| 文档 | 状态 | Freshness | last_verified_at | modified_at | Read | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `.ch/docs/MEMORY.md` | `active` | `stale` | 2026-07-18 | 2026-08-24T05:35:11+00:00 | ~19 | 这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。** |
| `.ch/docs/memory/ACTIVE_RISKS.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~15 | starter placeholder |
| `.ch/docs/memory/EVENT_MEMORY.md` | `active` | `starter` | template-fill-when-adopted | 2026-08-29T02:14:18+00:00 | ~18 | starter placeholder |
| `.ch/docs/memory/LESSONS_LEARNED.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~14 | starter placeholder |
| `.ch/docs/memory/PENDING_ITEMS.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~14 | starter placeholder |
| `.ch/docs/memory/PROJECT_CONTEXT.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~15 | starter placeholder |
| `.ch/docs/memory/README.md` | `active` | `fresh` | 2026-08-29 | 2026-08-29T02:14:18+00:00 | ~18 | 这里放的是**默认优先召回的短记忆**，目的不是替代其他文档，而是避免代理每次都从全仓文档冷启动。 |
| `.ch/docs/memory/ROLLING_SUMMARY.md` | `active` | `starter` | template-fill-when-adopted | 2026-08-29T02:14:18+00:00 | ~22 | starter placeholder |
| `.ch/docs/memory/USER_PREFERENCES.md` | `active` | `starter` | template-fill-when-adopted | 2026-05-21T02:07:45+00:00 | ~15 | starter placeholder |

## Active Plan Activity

- 当前无 active plan
