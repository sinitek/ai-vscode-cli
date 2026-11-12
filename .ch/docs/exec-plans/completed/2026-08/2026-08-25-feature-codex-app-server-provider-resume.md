# Codex app-server provider-aware resume — 新功能开发

- 日期：2026-08-25
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-25
- claim_ttl：本轮
- handoff_to：
- 类型：feature
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-25-codex-app-server-provider-resume.md`

## 本类型目标

支持跨模型/provider 切换保留 threadId，thread/start 与 thread/resume 传当前 TOML modelProvider；不重放历史，保留服务端加密 reasoning 限制。

## 范围与所有权

- 支持跨模型/provider 切换保留 threadId，thread/start 与 thread/resume 传当前 TOML modelProvider；不重放历史，保留服务端加密 reasoning 限制。
- 本记录只承担 新功能开发；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 支持跨模型/provider 切换保留 threadId，thread/start 与 thread/resume 传当前 TOML modelProvider；不重放历史，保留服务端加密 reasoning 限制。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-08-25-docs-codex-app-server-provider-resume.md](2026-08-25-docs-codex-app-server-provider-resume.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

Codex app-server 的 thread 历史由 `threadId` 持久化。当前插件在模型或 Codex 配置切换时主动丢弃已映射 thread，导致新回合看不到旧上下文；同时 app-server 恢复请求没有显式传入当前配置的 `modelProvider`。

### 目标

跨模型或 provider 切换时优先通过 `thread/resume` 复用同一 `threadId`，并显式传递当前 `modelProvider`，让 Codex app-server 按官方恢复路径继续会话。

### 范围

- Codex app-server thread 参数构造与运行时 provider 读取。
- Codex interactive runner 的 thread 选择策略。

### 非目标

- 不重放旧工具调用或重新发送完整历史事件。
- 不替换 Codex app-server 或 CLI 版本。
- 不处理 provider-specific 加密 reasoning 历史的服务端兼容性缺陷。

### 验收标准

- [x] 当前 `model_provider` 被传给 Codex app-server 的 thread 请求。
- [x] 模型或配置切换仍复用已有 threadId。

### 影响面

- 代码目录：`src/interactive/`、`src/extensionHost/`。
- 配置与脚本：无。

### 风险与缓解

- provider-specific 加密历史仍可能被 Codex 服务端拒绝；保留 app-server 原始错误并记录限制，不伪造历史重放。
- 旧配置没有 `model_provider`；请求省略该字段，继续使用 Codex 自动恢复。

### 决策记录

- 2026-08-25：采用官方 `thread/resume` 语义，不增加历史事件重放开关。

### 当前结论

已完成 provider-aware resume：模型或配置切换保留 threadId，`thread/start` / `thread/resume` 传入当前 TOML 的 `modelProvider`，移除无效 `persistExtendedHistory` 请求字段。服务端无法解密跨 provider/account 的加密 reasoning 历史时仍会保留原始错误，这是 app-server 限制而非可由客户端重放解决。

## 分类依据与真实状态

feature：扩展跨 provider/model 的恢复能力；未补造发布版本将其硬归 bugfix。test：新增 provider 解析/请求测试且实际修 fixture；docs：产品、运行时与 ontology 明确更新，不能藏成功能附带同步。20/20及加密历史仍可能失败的事实保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
