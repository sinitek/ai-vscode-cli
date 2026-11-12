# Codex app-server 长连接复用 — 性能优化

- 日期：2026-09-26
- 状态：completed
- 负责人：Codex
- owner：codex-app-server-reuse
- claimed_at：2026-09-26
- claim_ttl：本次实现完成并归档
- 类型：perf
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-26-codex-app-server-reuse.md`

## 本类型目标

复用app-server连接与已加载thread减少冷启动/initialize/resume，热回合turn/start、停止turn/interrupt；provider等连接身份变化才冷启动，重试复用tab。

## 范围与所有权

- 复用app-server连接与已加载thread减少冷启动/initialize/resume，热回合turn/start、停止turn/interrupt；provider等连接身份变化才冷启动，重试复用tab。
- 本记录只承担 性能优化；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 复用app-server连接与已加载thread减少冷启动/initialize/resume，热回合turn/start、停止turn/interrupt；provider等连接身份变化才冷启动，重试复用tab。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-09-26-docs-codex-app-server-reuse.md](2026-09-26-docs-codex-app-server-reuse.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

每个 Codex 回合都新起 `codex app-server`，重复 `initialize` 和 `thread/start` / `thread/resume`。后者会重载 config、创建 session、固定 MCP profile 并 websocket prewarm。Loop 子任务重试还会新建 tab，再次冷启动。

### 目标

- 同一条 app-server 连接只 `initialize` 一次。
- 已加载 thread 的后续回合只发 `turn/start`。
- provider、工作区、启动参数或进程退出后才冷启动并 `thread/resume`。
- 停止已加载回合时发 `turn/interrupt`，不杀进程。
- Loop 子任务重试复用原 tab / thread。

### 范围

- `src/interactive/codexAppServerPool.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/manager.ts`
- `src/extensionHost/loopOrchestration.ts`

### 非目标

- 不把 Loop 子任务并进父 thread。
- 不改变 OpenCode / Claude 的执行方式。
- 不在已订阅的热 thread 上靠 `thread/resume` 覆盖 provider。

### 验收标准

- [x] 同一 runner 的第二回合不再 spawn，且不再发送 `initialize` / `thread/start` / `thread/resume`。
- [x] 两个相同启动参数的 runner 共享一次 `initialize`，各自 `thread/start` 一次。
- [x] 已加载 thread 上停止会发送 `turn/interrupt` 且不 SIGTERM。
- [x] 冷启动阶段停止仍终止进程。
- [x] Loop 子任务重试不新建 tab。
- [x] 模型变化仍复用 runner；配置档案、cwd、multi-agent 变化仍更换 runner。

### 影响面

- 代码目录：`src/interactive/`、`src/extensionHost/loopOrchestration.ts`

### 风险与缓解

- 风险：热 thread 上 `thread/resume` 的 override 会被 app-server 忽略。
- 缓解：provider 进入连接键；变化时换进程再冷 `thread/resume`。模型、effort、cwd、sandbox、approval 继续走 `turn/start`。
- 风险：多 runner 共用 stdio 时子线程事件串线。
- 缓解：按 `threadId` / `parentThreadId` 路由，未归属事件先缓冲。

### 任务列表

- [x] 会话级长连接与 turn/start 复用
- [x] 子任务共享连接，重试复用 thread

### 决策记录

- 2026-09-26：连接键包含命令、app-server 参数、cwd、CODEX_HOME、modelProvider。已加载 thread 不因模型变化而 resume。

### 当前结论

长连接复用已落地。未做真实 `codex` CLI 的手工回合计时。

## 分类依据与真实状态

perf：目标明确减少每回合进程与thread恢复冷启动，是性能优化而非新增通用功能；test：Reuse测试和mocks实际开发；docs：五类事实源实际更新。58项57过、修正provider断言后16项过及未做真实Codex计时原样保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
