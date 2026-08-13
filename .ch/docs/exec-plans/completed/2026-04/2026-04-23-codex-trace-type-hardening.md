# Codex trace 类型判定与去重加固

- 日期：2026-04-23
- 状态：completed
- 负责人：Codex

## 背景

已归档的 `2026-04-23-codex-web-search-trace-gap.md` 解决了首个真实暴露的 `web_search` trace 缺失问题，但用户进一步指出：不能只修 `web_search`，其它 trace 类型也不能因为 started/completed 阶段载荷不完整或内容变化而被误判、误去重或提前抢占上屏机会。

## 目标

1. 把 Codex app-server 的 trace 判定从“按单一类型特判”提升为“按事件阶段 + 有效内容”的通用策略。
2. 避免 `item.started` 的空/弱内容抢占 `item.completed` 的上屏机会。
3. 为当前已支持的关键 trace 类型补充最小回归校验，覆盖非 `web_search` 的 started/completed 边界。

## 范围

- `src/interactive/codexRunner.ts` 的 Codex trace 上屏与去重逻辑。
- `src/interactive/codexAppServerEvents.ts` 的 trace 候选提取纯函数。
- `scripts/` 下的最小回归校验脚本。
- `.ch/docs/runbooks/PITFALLS.md` 与本执行计划文档。

## 非目标

- 不改动 Claude / Gemini 交互链路。
- 不重构聊天区 UI。
- 不引入新的测试框架。

## 验收标准

- [x] `web_search` 之外的 started/completed trace 类型也不会因为 started 空内容而提前占用去重位。
- [x] 同一条 trace 在 started/completed 内容相同时不会重复上屏；completed 内容更完整时不会被错误吞掉。
- [x] 已补充并执行最小回归校验，至少覆盖 `command_execution`、`mcp_tool_call`、`web_search` 三类场景。
- [x] 已同步沉淀本次“通用阶段判定”规则与验证方式。

## 影响面

- 代码目录：`src/interactive/`
- 文档目录：`.ch/docs/runbooks/PITFALLS.md`、`.ch/docs/exec-plans/completed/`
- 配置与脚本：`scripts/validate_codex_item_trace_candidates.js`

## 风险与缓解

- 风险：过度泛化后改变既有 trace 展示节奏，导致气泡噪音增多。
- 缓解：仅对“内容是否足够上屏”和“相同内容去重”做收敛，不做大规模 UI 行为调整，并以最小脚本锁定关键期望。

## 验证计划

- 最小相关验证：`npm run build`、`node scripts/validate_codex_item_trace_candidates.js`
- 扩展验证：`node scripts/validate_codex_web_search_trace.js`、`node scripts/validate_codex_collab_timeout.js`

## 测试与清单同步

- 单元测试：仓库暂无现成测试基建，本次继续用 `scripts/validate_codex_item_trace_candidates.js` 做最小回归校验。
- 功能清单：无需更新；本次为既有 trace 解析链路加固，无新增能力。
- 相关文档同步：已更新 `.ch/docs/runbooks/PITFALLS.md` 记录通用判定策略。

## 任务列表

- [x] 复核现有 `web_search` 修复与其它类型的 started/completed 处理差异
- [x] 抽出通用 trace 候选提取与内容去重逻辑
- [x] 补充非 `web_search` 的最小回归校验
- [x] 执行构建与校验
- [x] 同步文档并归档执行计划

## 决策记录

- 2026-04-23：从“仅修复 `web_search`”扩展为“按事件阶段 + 有效内容 + 内容去重”的通用 Codex trace 判定策略。
- 2026-04-23：对 `mcp_tool_call` 的 started 阶段不再固化 `inProgress` 等易变 status，仅在 completed 且状态异常时补充状态行，避免 started/completed 因状态差异产生无意义重复。

## 当前结论

- 已确认真实日志中大规模出现 started 空内容的是 `web_search`，但当前实现原先对 `command_execution` / `mcp_tool_call` 同样存在“按 id 抢占去重位”的结构性风险。
- 现已在 `src/interactive/codexAppServerEvents.ts` 中抽出通用 trace 候选函数，把 started 是否允许上屏、completed 是否提供更完整内容统一收敛为纯函数。
- `src/interactive/codexRunner.ts` 的去重已从“只看同类 id 是否见过”提升为“同类型同 id 的已上屏内容签名”；相同内容不重复，内容升级不会被吞掉。
- 已执行：`npm run build`、`node scripts/validate_codex_item_trace_candidates.js`、`node scripts/validate_codex_web_search_trace.js`、`node scripts/validate_codex_collab_timeout.js`。
