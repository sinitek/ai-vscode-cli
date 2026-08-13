# OpenCode 代办任务浮层可靠性修复

- 日期：2026-07-12
- 状态：completed
- 当前阶段：实现、文档、测试与构建均已完成
- 负责人：Codex
- owner：当前用户会话
- claimed_at：2026-07-12T19:05:00+08:00
- claim_ttl：本任务完成即释放
- handoff_to：无

## 背景

`~/.sinitek_cli/logs/sinitek-cli.opencode.2026-07-12.1.log` 中存在多条真实 `todowrite` JSONL 事件，任务位于 `part.state.input.todos`。当前工作树的解析器可从最近日志中识别 13 条任务列表事件，但用户在 OpenCode 执行期间仍未稳定看到与 Codex 相同的任务列表浮层。现有链路把任务列表和工具 trace 分成两条 Webview 消息，且运行中的 `setMessages` 刷新会无条件重置任务列表，缺少“trace 已显示但任务浮层未同步”的回退与诊断证据。

## 目标

1. OpenCode `todowrite` 事件继续通过专用 `taskListUpdate` 协议更新对应 tab。
2. 同一条工具 trace 携带任务列表元数据，作为面板浮层的原子回退通道。
3. 运行中的 tab 刷新消息时保留外部任务列表，不因会话重载瞬间清空。
4. 日志记录任务列表转发的 tab、来源、数量和完成数量，便于现场核验。
5. 补充后端流、Webview 浮层和真实事件形状的回归测试。

## 范围

- `src/cli/` OpenCode 任务列表事件类型。
- `src/openCodeTabStream.ts` 并行 tab 流动作。
- `src/extension.ts` OpenCode 任务列表转发、trace 元数据和诊断日志。
- `src/webview/` 外部任务列表统一应用与运行中状态保留。
- `src/test/` 定向回归测试。
- OpenCode 运行时能力与功能清单事实文档。

## 非目标

- 不改变 OpenCode CLI 参数、模型、provider 或会话策略。
- 不改变 Codex / Claude 任务列表协议和视觉主题。
- 不持久化已完成运行的临时任务列表。
- 不修改无关 Loop、MCP、Skills 或会话功能。

## 验收标准

- [x] 真实 `todowrite` 事件可产出任务列表和工具 trace。
- [x] 专用任务更新与 trace 元数据任一路径均可驱动活动 tab 浮层。
- [x] 运行中的 `setMessages` 不清空已显示的外部任务列表。
- [x] 运行完成后任务浮层仍按既有规则关闭。
- [x] 日志可看到 OpenCode 任务列表转发摘要。
- [x] 定向单测、TypeScript 构建通过。

## 影响面

- 代码目录：`src/cli/`、`src/webview/`、`src/test/`
- 编排入口：`src/extension.ts`、`src/openCodeTabStream.ts`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/runbooks/`

## 风险与缓解

- 风险：同一列表通过专用消息和 trace 回退重复应用。
- 缓解：Webview 使用同一幂等归一化函数；重复内容只覆盖当前列表，不重复追加。
- 风险：保留运行中列表导致完成后残留。
- 缓解：只在 tab 忙碌且来源为 external 时保留；既有 `runStatus` 完成路径继续显式清空。
- 风险：并行后台 tab 的任务列表污染活动 tab。
- 缓解：所有消息继续携带目标 `tabId`，trace 回退只应用到消息所属 tab。

## 验证计划

- 最小相关测试：OpenCode task parser、OpenCode tab stream、Webview task list 浮层状态。
- 共享回归：OpenCode command runner 与 tab stream 测试。
- 构建：`npm run build`。
- 定向命令：`node --test dist/test/openCodeTaskList.test.js dist/test/openCodeTabStream.test.js dist/test/openCodeTaskListOverlay.test.js dist/test/opencodeCommandRunner.test.js`。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/openCodeTaskListOverlay.test.ts`，更新 `src/test/openCodeTabStream.test.ts`、`src/test/opencodeCommandRunner.test.ts`。
- 单元自测结果：`npm run build` 通过；定向 OpenCode/浮层测试 `53/53` 通过；全量 `node --test dist/test/*.test.js` 为 `493/493` 通过；`git diff --check` 通过。
- 真实日志复核：`sinitek-cli.opencode.2026-07-12.1.log` 可解析 `13` 条任务列表事件，其中当前主会话 `2` 条。
- 失败处理记录：首次定向测试有 1 条测试夹具源码提取失败，分类为测试夹具问题；修正默认参数函数的 body 定位后重跑全部通过，未改业务实现迎合测试。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档：已同步能力规格、CLI 运行时参考和 `PITFALLS.md`。
- 资源检查：`media/official_skills_catalog.json` 共 56 条 description，非中文描述为 0。

## 任务列表

- [x] 核对真实 OpenCode 日志事件
- [x] 对比 Codex 与 OpenCode 浮层链路
- [x] 实现可靠送达与状态保留
- [x] 补充回归测试和诊断日志
- [x] 同步事实文档并完成构建验证

## 决策记录

- 2026-07-12：最近 OpenCode 日志中的 13 条 `todowrite` 均可被当前解析器识别，问题焦点从事件格式转向 Webview 送达、刷新覆盖和可观测性。
- 2026-07-12：保留现有 `taskListUpdate` 协议，同时让同一条 trace 携带任务列表元数据，避免只显示工具气泡却不显示浮层。
- 2026-07-12：扩展宿主按 tab 缓存仍在运行的最新列表，并在 panel state 重建后重放；运行结束立即释放。
- 2026-07-12：Webview 的消息刷新仅在 tab 空闲时清理 external 列表，运行完成仍由 `runStatus` 统一关闭浮层。

## 当前结论

OpenCode `todowrite` 已形成专用任务更新、trace 元数据回退、运行中状态保留和 panel 重放四层保障；后端日志可按 `opencode-task-list-forwarded` 核对转发摘要。构建、定向测试、全量 Node 测试、diff 检查和真实日志复核均通过。
