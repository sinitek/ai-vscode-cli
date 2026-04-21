# 避坑指南

这个文件用于沉淀 **已经真实踩过的坑**，而不是猜测性的“注意事项”清单。

目标只有一个：让后续的人或代理在遇到相同问题前，就能提前知道风险、触发条件、规避方式和验证方法。

## 记录原则

- 只有真实发生过、已确认会重复出现或有明显复发风险的问题，才写进来。
- 记录要写清楚“现象 → 条件 → 根因 → 规避方式 → 验证方法”，不要只写一句结论。
- 优先记录会反复浪费时间的问题，例如环境坑、脚手架坑、兼容性坑、发布坑、权限坑、隐式前置条件。
- 如果某个坑只属于某个子系统，也可以在对应目录下补充更贴身的文档，但这里应保留索引或摘要。
- 问题被彻底消除后，可以标记“已失效/已修复”，不要悄悄删除历史经验。

## 建议模板

```md
## <坑点标题>

- 状态：有效 / 已修复 / 仅历史版本有效
- 首次发现：YYYY-MM-DD
- 适用范围：模块 / 环境 / 脚本 / 版本

### 现象
- 看到什么报错、错误行为或异常结果？

### 触发条件
- 在什么前提下会出现？

### 根因
- 已确认的根因是什么？如果只是推断，要明确写“推断”。

### 临时绕过
- 当前如何快速恢复或继续推进？

### 长期规避
- 以后应该怎么做，才能避免再次踩坑？

### 验证方式
- 修改后如何确认这个坑已被规避？

### 关联资料
- 相关代码路径、runbook、issue、设计文档、外部链接
```

## 当前状态

- 当前为模板初始状态，等待目标项目按真实踩坑情况持续补充。

## Interactive 历史会话被 local 临时 ID 污染，恢复后出现 invalid thread id

- 状态：已修复
- 首次发现：2026-04-15
- 适用范围：`src/extension.ts` 的 Codex / Claude 交互式会话历史恢复链路

### 现象
- 历史会话列表里会出现 `local_*` 临时会话。
- 恢复这类历史会话后，可能看不到完整历史消息。
- 在该会话继续发送消息时，Codex 报错：`invalid thread id ... found 'l' at 1`。

### 触发条件
- 交互式会话开始后，真实 thread/session id 尚未返回前，扩展先创建了 `local_*` 临时会话并落盘。
- 真实 id 返回后，没有把 local 会话稳定迁移/合并到真实会话。

### 根因
- local 临时会话用于承接首条消息的落盘，但真实 id 到达时只更新了当前运行态，没有清理历史里的 local 会话副本。
- 历史恢复时如果继续选中了 local 会话，后续续接会把 `local_*` 误当成真实 Codex thread id。

### 临时绕过
- 修复前可手动删除 `local_*` 历史项，改选对应的真实 UUID 会话；若没有真实会话，只能查看历史，不能继续回复。

### 长期规避
- 真实 thread/session id 到达时，立即把 local 会话消息迁移/合并到真实会话并移除 local 历史项。
- 恢复历史会话前，先尝试把 local 会话修复到真实会话；如果确实没有真实远端 id，则直接阻止继续回复并提示原因。

### 验证方式
- 构造 local 会话 + 真实 UUID 会话同时存在的样本，验证会命中真实会话并合并完整消息。
- 在仓库执行：`npm run build` 与 `node scripts/validate_history_session_fix.js`。

### 关联资料
- 代码：`src/extension.ts`、`src/interactive/sessionHistoryRepair.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-04-15-history-session-local-thread-merge.md`

## Codex 协作子任务 wait 超时只回传 timed_out，AI 对话里没有明确错误

- 状态：已修复
- 首次发现：2026-04-21
- 适用范围：`src/interactive/codexRunner.ts` 的 Codex app-server 流式事件解析链路

### 现象
- Codex 在开启 explorer / worker 子任务后，主任务执行到 `wait` 时可能中途结束或停住。
- 日志里可能只能看到回合结束，AI 对话气泡里没有明确错误。
- 真实超时结果可能只是工具输出 `{"status":{},"timed_out":true}`，不是顶层业务异常。

### 触发条件
- Codex 使用协作子任务工具（例如 `spawn_agent` / `wait`）。
- `wait` 返回的是超时结果而不是抛错。
- 插件只解析传统 `item/started` / `item/completed` 条目，没有消费 `rawResponseItem/completed` 中的工具原始输出。

### 根因
- Codex app-server 新增了 `rawResponseItem/completed`、`collabAgentToolCall` 等协作相关事件。
- 插件旧逻辑没有识别这些新事件，因此 `wait` 的超时结果不会被转成用户可见错误。
- `account/rateLimits/updated` 这类账号配额通知只是普通 notification，不会直接导致中断；真正的问题是协作工具超时结果没有上屏。

### 临时绕过
- 修复前只能从 debug/流式日志里人工寻找 `timed_out`、`collab`、`turn.completed` 等线索。

### 长期规避
- 解析 `rawResponseItem/completed`，记录 function/custom tool 的 `call_id -> toolName` 映射。
- 当 `wait` 的原始工具输出包含 `timed_out: true` 时，立即转成 AI 对话中的明确错误。
- 同时解析 `collabAgentToolCall`，把明确的子任务失败状态也映射为对话内错误。

### 验证方式
- 在仓库执行：`npm run build` 与 `node scripts/validate_codex_collab_timeout.js`。
- 如需手工验证，可构造一次使用 explorer 子任务并等待超时的 Codex 回合，确认 AI 对话出现错误提示。

### 关联资料
- 代码：`src/interactive/codexRunner.ts`、`src/interactive/codexAppServerEvents.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-04-21-codex-collab-wait-timeout-surface.md`
