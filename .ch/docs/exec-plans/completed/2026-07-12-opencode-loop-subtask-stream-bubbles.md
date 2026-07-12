# OpenCode Loop 子任务流式对话气泡修复

- 日期：2026-07-12
- 状态：completed
- 负责人：Codex
- owner：当前用户排障任务
- claimed_at：2026-07-12T16:09:42+08:00
- claim_ttl：任务完成并归档后释放
- handoff_to：无

## 背景

真实运行日志显示，OpenCode Loop 并行子任务持续产生 `step_start`、`text`、`reasoning` 和 `tool_use` JSONL 事件，Webview 的原始流面板能够看到这些事件，但子任务对话区在进程退出前没有对应气泡。代码审计确认 `runPromptParallel` 当前只向 Webview 转发 `rawStreamDelta` 和任务列表更新，只有进程成功退出后才从完整 stdout 解析并追加最终 assistant 消息。

仓库同时存在另一个正在运行的 Codex Loop 子任务，会修改 `src/extension.ts`。本修复必须等该文件停止并发写入后，基于最新内容做窄范围补丁，禁止覆盖其未提交改动。

## 目标

1. OpenCode Loop 并行子任务收到可见 `text` 事件时，立即在对应 conversation tab 创建或更新 assistant 气泡。
2. `reasoning` / `step_start` 继续显示为 thinking 气泡，`tool_use` 继续显示为 trace 气泡，`todowrite` 继续更新对应 tab 的任务列表。
3. 进程退出后的完整最终文本只补齐未流式展示的尾部，不重复生成完整答案。
4. 流式消息进入当前会话消息存储，并保持 Loop 子任务元数据。

## 范围

- `src/extension.ts` 中 OpenCode 并行运行的 JSONL 消费、消息存储和 Webview 定向消息转发。
- 与并行 OpenCode 流式气泡行为相关的单元回归测试。
- OpenCode 运行时事实文档和功能清单说明。

## 非目标

- 不改变 OpenCode CLI 参数、provider/model 配置、会话续接协议或 hidden retry 策略。
- 不移除原始流面板，不改变普通前台 OpenCode 运行的既有气泡行为。
- 不修改当前并发 Codex Loop 子任务的 Skill 注入契约和实现逻辑。

## 验收标准

- [x] 并行 OpenCode `text` JSONL 事件在进程退出前定向产生 `appendMessage` / `assistantDelta`，对应 tab 可实时看到正常对话气泡。
- [x] thinking、tool trace 和 `taskListUpdate` 保持按 tab 定向展示。
- [x] 最终完整 stdout 与已展示文本去重，不产生重复完整回答。
- [x] 流式消息保留 `taskRole`、`lobsterTaskId`、`lobsterRound`、`lobsterSubtaskId`。
- [x] 定向单测和 `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`，必要时新增就近可测试辅助模块。
- 测试目录：`src/test/`。
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`。
- 配置与脚本：无。

## 风险与缓解

- 风险：`src/extension.ts` 正被另一个 Loop 子任务并发修改。
- 缓解：先确认进程与文件 mtime 稳定，再基于最新磁盘内容应用窄补丁；补丁前后核对 diff，不回滚既有改动。
- 风险：流式文本与退出时完整文本重复。
- 缓解：记录本轮已展示 assistant 文本，退出时仅追加尚未展示的尾部；不再无条件追加完整 finalText。
- 风险：后台 tab 事件未立即渲染。
- 缓解：消息同时写入宿主消息存储并携带 `tabId`；切换 tab 后仍可从会话存档恢复。

## 验证计划

- 最小相关验证：OpenCode JSONL 事件解析与并行消息转发回归测试。
- 单元自测命令：`node --test dist/test/opencodeCommandRunner.test.js`，以及新增/更新的并行流式测试。
- 扩展验证：`npm run build`，再运行相关 conversation tab / Loop 回归测试。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/openCodeTabStream.test.ts`，更新 `src/test/opencodeCommandRunner.test.ts` 的并行 visible-event 接线断言。
- 单元自测结果：`npm run build` 通过；OpenCode 定向测试 `40/40` 通过；conversation tab / OpenCode 扩展定向测试 `57/57` 通过；全量 `node --test dist/test/*.test.js` 为 `478/478` 通过。
- 失败处理记录：无。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新能力规格、CLI 运行时参考和 `PITFALLS.md`。

## 任务列表

- [x] 对齐真实 OpenCode Loop 日志与任务记录。
- [x] 定位并行路径仅转发原始流的根因。
- [x] 等待并发编辑结束并复核最新代码。
- [x] 实现按 tab 的实时气泡与最终文本去重。
- [x] 补充回归测试、构建与文档同步。

## 决策记录

- 2026-07-12：根因定位为 `runPromptParallel` 只消费任务列表事件并转发 `rawStreamDelta`，未复用前台 OpenCode 的 visible-event 气泡链路。
- 2026-07-12：保留原始流作为诊断面，同时新增对话气泡，不在 Webview 端解析 OpenCode 协议。
- 2026-07-12：修复必须在扩展宿主层完成，以维持“Webview 不感知 CLI 协议”的架构边界。
- 2026-07-12：新增 `src/openCodeTabStream.ts` 作为并行 tab 的有状态 JSONL visible-event 适配层，统一生成 assistant start/delta、trace 和 task-list actions，并记录已展示正文用于 final text 去重。
- 2026-07-12：并发 Skill 文档子任务已在自身提示词中明确要求保留既有 OpenCode 文档 hunk；本任务完成时相关文档内容仍在且 `git diff --check` 通过。

## 当前结论

根因已修复：OpenCode 并行/Loop 子任务继续保留 `rawStreamDelta` 诊断记录，同时实时把 stdout JSONL visible events 写入对应 conversation tab 的消息存储和气泡协议。`text` 形成普通 assistant 气泡，`reasoning` / `step_start` 形成 thinking 气泡，`tool_use` 形成 trace，`todowrite` 更新任务列表；进程退出时只补齐未展示尾部。构建、定向测试、全量测试和差异检查均通过。
