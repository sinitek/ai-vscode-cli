# OpenCode Loop 主任务空响应恢复

- 日期：2026-07-14
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-14
- claim_ttl：1 day
- handoff_to：

## 背景

实际任务 `msg_1783998484827_4b2d85596667a` 在第 3 轮全部子任务完成后正常唤醒第 4 轮主任务。OpenCode 进程以退出码 0 结束，但 JSONL 只有 `step_start` 与 `step_finish(reason=unknown)`，没有 `text` 事件；插件随后把空正文直接标记为 `needs-review`，显示 `Main task did not return a valid loop decision JSON.`。

## 目标

让 Loop 主任务在 OpenCode 偶发返回空正文时先走既有 hidden retry；若已确认是旧 session 的无 provider-error 空成功响应，则有界地 rollover 到 fresh session 并重发完整主任务 prompt。合法当前回复仍按原状态机进入 JSON 决策校验，非空非法决策继续进入人工复核。

## 范围

- OpenCode one-shot / parallel 成功退出判定
- Loop 当前尝试与历史对话正文的隔离
- OpenCode 空成功响应的诊断日志
- Loop 主任务 fresh-session recovery、tab/任务记录改绑与恢复提示
- 最小回归测试和运行时事实文档

## 非目标

- 不修改 OpenCode provider、模型或用户配置
- 不改变子任务重试策略和辩论模式 artifact 协议
- 不恢复或继续执行用户当前的 Harness/Playwright 业务任务
- 不新增前端配置或替换现有技术栈

## 验收标准

- [x] 主任务进程成功但当前尝试没有 assistant 正文时，不被历史回复误判成功，而是进入既有有界 hidden retry
- [x] 非空但不是合法 `LoopMainDecision` 的响应保留原人工复核语义，并新增不记录正文内容的结构化诊断日志
- [x] 当前尝试返回正文时正常完成运行层判定；空响应达到既有 hidden retry 上限后按错误收口
- [x] 已有远端 session 的 Loop 主任务首次无 provider-error 空成功响应，会在下一次重试新建 session、重发完整主提示并改绑任务记录；其它路径不会重复 rollover
- [x] 回归测试覆盖历史回复误判、当前回复恢复成功、普通任务兼容和失败上限
- [x] 相关构建、定向测试和运行时文档验证通过

## 影响面

- 代码目录：`src/extension.ts`、`src/openCodeRunCompletion.ts`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/runbooks/`
- 配置与脚本：无

## 风险与缓解

- 风险：重试复用同一轮时误读上一条合法 assistant 内容。
- 缓解：Loop 运行层使用当前 OpenCode 进程尝试解析出的非 thinking assistant 正文，不使用历史消息锚点判定。
- 风险：无限重试或新增另一套重试上限。
- 缓解：直接复用现有 `HIDDEN_RETRY_MAX_RETRIES` 与等待序列，不增加配置或嵌套重试。
- 风险：把真实 provider error 或子任务失败错误归因为会话过长。
- 缓解：fresh recovery 仅在 Loop 主任务、已有远端 session、无 JSON provider error 且本轮未 rollover 时排队一次；否则保留原错误/重试语义。

## 验证计划

- 最小相关 unit：`dist/test/openCodeRunCompletion.test.js`
- 模块/统一 unit：OpenCode runner、最终答复与 hidden retry 定向测试
- typecheck / build：`npm run build`
- Chromium smoke：不适用；本次只改 Extension Host 状态机，无浏览器页面行为

## 测试与清单同步

- 单元测试新增/更新：扩展 `src/test/openCodeRunCompletion.test.ts`、`src/test/opencodeCommandRunner.test.ts`，并新增 `src/test/loopTaskStore.test.ts` 的 session-store 改绑断言
- 单元自测结果：`npm run build` 通过；7 个相关测试文件共 103/103 通过；`git diff --check` 通过
- 失败处理记录：无测试失败；无需调整断言或隔离环境问题
- 功能清单：已新增“主任务空响应有界恢复”可靠性条目
- 相关文档同步：已更新能力规格、运行时设计、CLI 参考与 PITFALLS

## 任务列表

- [x] 核对实际日志、任务记录和原始 OpenCode JSONL
- [x] 追踪调用链并确定最小恢复边界
- [x] 实现有界重试与诊断日志
- [x] 补回归测试并完成首次 build/定向验证
- [x] 同步事实来源文档
- [x] 执行最终扩展验证并归档计划

## 决策记录

- 2026-07-14：根因以实际日志为准，确认不是子任务未结束，而是主任务被唤醒后产生了退出码 0 的无正文响应。
- 2026-07-14：根因位于成功退出判定，不在 `LoopMainDecision` JSON 提取器；Loop 后续轮次复用初始用户消息锚点时，不能用旧轮次正文证明当前进程有回答。
- 2026-07-14：沿用既有 OpenCode hidden retry 上限和等待序列，不新增 Loop 专属嵌套重试或配置。
- 2026-07-14：功能清单新增可靠性条目；运行时设计、CLI 参考和 PITFALLS 使用同一“当前尝试正文”口径，删除直接错误收口的冲突描述。
- 2026-07-14：现场 SQLite 元数据证明失败 session 已累计约 919k input / 6.7m cache-read token；同 profile 的新 session 有 `finish=stop` 和实际 token，fork 继承空响应，判定为 session 级故障而非 provider/model 配置故障。
- 2026-07-14：OpenCode 1.17.18 的 `opencode export` 在 128 KiB 截断，不将其误判为持久化 JSON 损坏；对 fork 发送 `/compact` 仍为 `reason=unknown, input=0, output=0`，因此不依赖 compact 自动恢复。
- 2026-07-14：采用一次 fresh-session recovery：保留旧历史，完整重发 self-contained Loop 主提示，捕获新 `sessionID` 后同步 tab、UI 消息与 Loop task store；JSON provider error、子任务、普通任务和第二次空响应继续原语义。

## 最终结论

第一阶段的当前尝试判定与 hidden retry 已在现场生效：原 session 的三次主任务请求均为 `step_start -> step_finish(reason=unknown)` 且 `input=0/output=0`。同 profile 的 fresh smoke 有实际 input/output token 并以 `stop` 结束，fork 仍复现旧 session 的空响应，故不修改 provider/model 配置。

最终实现会把符合条件的首次主任务空成功响应从错误 trace 改为本地化会话恢复提示；下一次隐藏重试创建 fresh OpenCode session 并重发完整主提示。新 session ID 被保存到当前 tab 与 Loop 任务存储，旧 session 和历史不被删除。fresh session 再次空响应、provider JSON error、普通任务和子任务均不会继续 rollover，仍按既有有界重试/错误流程收口。
