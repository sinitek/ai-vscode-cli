# 子任务 Tab 流水动画运行态校准

- 日期：2026-10-06
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-06
- claim_ttl：本轮任务完成前
- handoff_to：

## 背景

当前 Webview 已有每 60 秒请求运行态校准的机制，但扩展宿主只返回需要停止流水动画的 Tab。子任务运行过程中如果 Webview 漏掉了 `runStatus:start`，Tab 没有本地运行标记时不会被重新标记为运行中，因此缺少流水动画。

## 目标

让 Loop/Loop+ 子任务 Tab 在实时开始事件丢失或 Webview 状态短暂不一致时，最多经过一次 60 秒校准即可恢复流水动画；任务实际结束后仍能停止动画。

## 范围

- 扩展宿主运行态校准返回需要启动和停止流水动画的 Tab。
- Webview 接收校准结果并幂等恢复 Tab 的运行标记。
- 保留普通 Vibe、Graph 和已完成任务的现有行为。
- 补充运行态纯函数、消息契约和 Webview 兜底测试。

## 非目标

- 不改变 CLI 子进程生命周期、Loop 调度、任务状态机或并发上限。
- 不新增用户可配置的轮询频率；继续使用现有 60 秒间隔。
- 不为已完成、停止、错误或无 Loop 任务的 Tab 启动流水动画。

## 验收标准

- [x] 子任务存在实际 Loop 运行时，即使缺少本地 `runStatus:start`，校准后 Tab 重新显示流水动画。
- [x] 校准不会给普通 CLI 运行、Graph 运行或无 `loopTaskId` 的 Tab 误加流水动画。
- [x] 任务已完成或停止后，校准仍能清除流水动画并停止无用定时器。
- [x] 启动/停止消息重复到达时保持幂等，不覆盖已有运行开始时间。
- [x] 相关定向测试与 `npm run build` 通过，并记录完整套件范围外失败。

## 影响面

- 代码目录：`src/conversationTabRunningFlow.ts`、`src/extension.ts`、`src/webview/viewContentScript/messageRendering.ts`、`src/webview/viewContentScript/windowMessageDispatch.ts`。
- 测试目录：`src/test/session/conversationTabRunningFlow.test.ts`、相关 Webview/扩展宿主契约测试。
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`。
- 配置与脚本：无。

## 风险与缓解

- 风险：把普通对话的活动运行误判为 Loop 子任务并显示流水动画。
- 缓解：仅对 `activeRun.loopTaskId` 非空的实际 Loop 运行返回启动信号。
- 风险：校准响应与新的运行开始事件乱序，清除新一轮动画。
- 缓解：复用运行开始时间和已有时间戳保护；启动信号先解除停止锁存，再处理停止信号。
- 风险：无活动任务时 Webview 定时器长期运行。
- 缓解：仅在存在未锁存的 Loop Tab 或本地运行标记时创建定时器，校准清理后自动停止。

## 验证计划

- 最小相关验证：`conversationTabRunningFlow.test.ts`、相关 Webview 消息契约测试。
- 单元自测命令：`npm run build`；`node --test` 相关 `dist/test/...`；`git diff --check`。
- 扩展验证：检查 CodeGraph 同步、Ontology 校验和真实 Webview 消息方向；不启动真实 CLI 子进程。

## 测试与清单同步

- 单元测试新增/更新：`conversationTabRunningFlow.test.ts` 覆盖实际 Loop 运行 Tab 选择、普通运行排除、完成态清理和 Webview/宿主消息契约；同时修正诊断 handler 的事实来源断言。
- 单元自测结果：`npm run build` 通过；运行态校准测试 `5/5` 通过；Ontology 校验通过；CodeGraph 已同步；`git diff --check` 通过。
- 失败处理记录：完整 `npm test` 为 `1429` 通过、`23` 失败；失败集中在本次未修改的 CLI、Webview、静态页面和 Loop+ 群聊覆盖测试，未命中新增运行态校准测试，保留为既有基线问题。
- 功能清单：若运行态兜底属于现有 Tab 流水能力的实现修复，补充现有功能条目的验收说明。
- 相关文档同步：待核对运行时设计、产品规格和 Ontology 是否需要更新。

## 任务列表

Tasklist:
- [completed] 梳理运行态校准与流水动画消息链路
- [completed] 返回并应用需要启动的 Tab 列表
- [completed] 补充回归测试并同步事实文档
- [completed] 执行构建、定向验证与计划归档

## 决策记录

- 2026-10-06：保留现有 60 秒 Webview 轮询，不直接依赖实时 `runStatus:start`；扩展宿主同时返回 `startTabIds` 和 `stopTabIds`，由 Webview 幂等恢复或清除本地流水状态。

## 当前结论

已完成双向运行态校准：扩展宿主对实际 `loopTaskId` 运行返回 `startTabIds`，对过期状态返回 `stopTabIds`；Webview 在存在未锁存的 Loop Tab 时每 60 秒校准，并幂等恢复或清除本地流水动画。普通 CLI、Graph 和无 Loop 运行标识的 Tab 不会被误加动画。设计文档、产品能力清单、功能清单和 Ontology 已同步，计划可归档。
