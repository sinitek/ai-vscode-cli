# Codex web_search 关键 trace 气泡缺失修复

- 日期：2026-04-23
- 状态：completed
- 负责人：Codex

## 背景

用户反馈 AI 对话面板里的关键过程气泡明显少于原始流式日志，尤其是网络查询。经对照同一回合的截图、run stream 导出与会话持久化消息文件，已确认这是一个真实缺陷：`web_search` 的 `item.started` 事件先到但 `query` 为空，插件却在 started 阶段先按 `id` 去重；等 `item.completed` 携带真实查询语句到达时，又被误判为重复，从而没有生成 trace 气泡。

## 目标

1. 修复 Codex `web_search` started/completed 事件的上屏判定，确保真正带查询内容的 completed 事件能生成聊天气泡。
2. 为该解析规则补最小回归校验，避免后续再次出现“流式日志有网络查询、聊天区无关键气泡”的回归。
3. 同步沉淀本次真实踩坑到仓库文档，方便后续排障。

## 范围

- `src/interactive/codexRunner.ts` 的 `web_search` 事件解析逻辑。
- `src/interactive/codexAppServerEvents.ts` 中与 `web_search` 事件内容提取相关的纯函数。
- `scripts/` 下最小回归校验脚本。
- `.ch/docs/runbooks/PITFALLS.md` 与本执行计划文档。

## 非目标

- 不改动 Claude / Gemini 交互链路。
- 不做聊天区 UI 重构。
- 不改动除 `web_search` 以外的其它 trace 类型上屏策略。

## 验收标准

- [x] `web_search` started 事件在无有效 query 时不再抢先占用去重位。
- [x] `web_search` completed 事件带有效 query / url 时，会生成对应 trace 气泡。
- [x] 已补充并执行最小回归验证，覆盖“started 空 query + completed 有 query”的回归场景。
- [x] 已同步记录本次坑点与验证方式。

## 影响面

- 代码目录：`src/interactive/`
- 文档目录：`.ch/docs/exec-plans/active/`、`.ch/docs/runbooks/PITFALLS.md`
- 配置与脚本：`scripts/validate_codex_web_search_trace.js`

## 风险与缓解

- 风险：Codex app-server 后续可能继续演进 `web_search` 条目结构，仅依赖单一字段可能再次漏判。
- 缓解：抽出纯函数统一兼容 `query` / `action.query` / `action.url`，并以最小验证脚本覆盖关键输入形态。

## 验证计划

- 最小相关验证：`npm run build`、`node scripts/validate_codex_web_search_trace.js`
- 扩展验证：复现一次实际带 web search 的 Codex 回合，确认聊天区出现 `web search ...` trace 气泡。

## 测试与清单同步

- 单元测试：仓库暂无现成测试基建，本次补充 `scripts/validate_codex_web_search_trace.js` 作为最小回归校验。
- 功能清单：无需更新；本次为既有交互链路缺陷修复，无新增能力。
- 相关文档同步：补充 `.ch/docs/runbooks/PITFALLS.md` 记录根因、触发条件与验证方式。

## 任务列表

- [x] 复核截图、run stream 与持久化消息，确认缺陷根因
- [x] 修复 `web_search` trace 上屏逻辑
- [x] 补充最小回归校验脚本
- [x] 执行构建与校验
- [x] 同步文档并归档执行计划

## 决策记录

- 2026-04-23：按用户选择，采用“只对 `item.completed` 的 `web_search` 事件产出 trace”策略，避免 started 空 query 先占用去重位。

## 当前结论

- 已确认问题不在 Webview 过滤层，而在 Codex app-server 事件解析层。
- 本次最小安全修复点是：`web_search` 只在 completed 阶段且存在有效查询内容时才生成 trace，并在此时再做去重。
- 已在 `src/interactive/codexAppServerEvents.ts` 中抽出纯函数，统一兼容 `query`、`action.query`、`action.url` 三种来源。
- 已执行 `npm run build` 与 `node scripts/validate_codex_web_search_trace.js`。
- 额外执行了基于真实 `CodexInteractiveRunner` 的扩展验证：同样的“今天上海天气”回合现在已能实际打印 `web search weather: Shanghai, China` trace。
