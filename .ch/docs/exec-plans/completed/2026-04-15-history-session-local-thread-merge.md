# 修复历史会话恢复时 local 临时会话污染与 invalid thread id

- 日期：2026-04-15
- 状态：completed
- 负责人：Codex

## 背景

当前 VS Code 插件在 Codex/Claude 交互式会话开始后，真实 thread/session id 尚未返回前，会先创建 `local_*` 临时会话并落盘。随后真实 id 返回时，历史消息与会话记录没有稳定迁移到真实会话，导致：

1. 历史列表出现 `local_*` 临时会话污染。
2. 恢复到这些 local 会话时，可能只能看到不完整消息。
3. 继续发送消息时会把 `local_*` 误当成真实 Codex thread id 续接，触发 `invalid thread id`。

## 目标

修复 interactive 会话在真实 thread/session id 到达后的迁移链路，确保历史列表和恢复行为落到真实会话上，并避免继续发送消息时使用无效 local id。

## 范围

- `src/extension.ts` 中 interactive 会话的 session/thread 迁移与历史恢复逻辑。
- 最小相关验证脚本/用例。
- 必要的文档同步。

## 非目标

- 不修改 CLI 技术栈。
- 不重做整个会话存储结构。
- 不引入大型测试框架。

## 验收标准

- [x] local 临时会话在真实 thread/session id 到达后不会继续污染最终历史列表。
- [x] 恢复历史会话后能读取到完整消息。
- [x] 在恢复后的会话继续发消息，不会再把 `local_*` 作为 Codex thread id 使用。
- [x] Node 项目执行 `npm run build` 无报错。

## 影响面

- 代码目录：`src/extension.ts`、`src/interactive/sessionHistoryRepair.ts`
- 文档目录：`.ch/docs/exec-plans/completed/`、`.ch/docs/runbooks/`
- 配置与脚本：`scripts/validate_history_session_fix.js`

## 风险与缓解

- 风险：迁移逻辑误删真实会话或错误合并消息。
- 缓解：仅在 local->真实 id 的明确场景下迁移；合并时按 message id 去重并保持顺序；补最小验证。

## 验证计划

- 最小相关验证：构造 local 会话 + 真实 threadId 到达场景，验证消息迁移、历史可见、恢复后续发不再使用 local id。
- 扩展验证：`npm run build`。

## 测试与清单同步

- 单元测试：补最小验证，不引入新框架。
- 功能清单：本次为缺陷修复，若无用户可见能力新增则说明无需更新。
- 相关文档同步：记录执行计划与验证结果。

## 任务列表

- [x] 定位 root cause：local 临时会话先落盘，真实 id 到达后未正确迁移。
- [x] 实现 local 会话迁移/合并到真实会话。
- [x] 增加无映射 local 会话的保护，避免继续发送时直接使用 local id。
- [x] 补最小验证并执行 build。

## 决策记录

- 2026-04-15：优先在真实 thread/session id 到达时迁移/合并 local 会话，兼容处理已落盘历史数据，避免只做表层拦截。

## 当前结论

已完成修复与最小验证：

- 启动/切换工作区时会尝试修复已存在的 local 历史副本，并优先合并到真实会话。
- 真实 thread/session id 到达时，会把 local 会话消息迁移/合并到真实会话并移除 local 历史项。
- 若某条历史只剩 local 临时会话、确实没有真实远端 id，则会阻止继续回复并提示原因。
- 已执行 `npm run build` 与 `node scripts/validate_history_session_fix.js`；功能清单无需更新（本次为缺陷修复，无新增能力）。
