# Loop+ 最多验收次数

- 日期：2026-09-29
- 状态：completed
- 负责人：Codex
- owner：loop-plus-max-acceptances
- claimed_at：2026-09-29
- claim_ttl：已完成

## 背景

经典 Loop 的 `loopMaxRounds` 不约束 Loop+。Loop+ 需要单独的验收次数上限，避免事件驱动验收无限继续。

## 目标

在“AI任务配置”增加 Loop+ 最多验收次数，默认 100，允许范围 1–999，并在宿主调度中强制执行。

## 范围

- 全局工具设置、面板状态、Webview 数字输入和中英文文案。
- Loop+ 任务记录保存该上限；已有任务只升不降。
- 一次成功确认的子任务 attempt 计 1 次。整批确认若会超过上限，则不提交，父任务进入 `needs-review`，验收队列保持不变。
- 已达上限后不再派发新子任务。没有新验收事件时仍可完成父任务。

## 非目标

- 不改变经典 Loop 最大轮次。
- 不改变 Loop+ 单次派发子任务上限或同时运行上限。
- 不把内部 200 次主决策安全上限改成这个设置。

## 验收标准

- [x] 设置默认 100，小于 1 归 1，大于 999 归 999，写入 `~/.sinitek_cli/settings.json`。
- [x] 超限批次不被确认，队列保留，任务进入 `needs-review`。
- [x] 提高上限并继续后，可以验收原先排队的项。
- [x] 达到上限后，带新子任务的 dispatch 不会启动新 attempt。

## 影响面

- 代码目录：`src/loopPlusDecision.ts`、`src/loopTaskStore.ts`、`src/toolSettings.ts`、`src/extensionHost/`、`src/webview/`、`src/extension.ts`、`src/i18n.ts`
- 文档目录：功能清单、能力说明、CLI 参考、Loop+ 调度设计、ontology
- 配置与脚本：无

## 风险与缓解

- 风险：把一批多事件拆开确认会破坏 Loop+ 批次协议。
- 缓解：整批放不下就整批拒绝，不部分确认。

## 验证计划

- 最小相关验证：`npm run build` 后运行相关 `node --test`。
- 单元自测命令：见实现收尾。
- 扩展验证：不启动真实 CLI。

## 测试与清单同步

- 单元测试新增/更新：设置归一化、消息保存、Webview、调度、任务记录、提示词。
- 单元自测命令：`npm run build`；`node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusContracts.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js`；`node --test --test-name-pattern "normalizes the Loop+ acceptance limit" dist/test/webview/clipagescriptruntimecoverage.test.js`。
- 单元自测结果：实现后的 `npm run build` 已通过，本收尾未再改源码，`dist/` 新于相关源文件。收尾重跑 Loop+ 决策、契约、编排、提示词 69/69 通过；设置、消息保存和静态页面 42/42 通过；Webview 输入归一化 1/1 通过。
- 失败处理记录：`dist/test/webview/clipagescriptruntimecoverage.test.js` 全文件仍有既有失败 `boots the runtime...`，断言 `taskListPanel.style.display` 期望 `block`、实际 `none`。原因是该标签 `loopTaskRole: "main"`，而 `isLoopMainTaskListTab` 从 2026-09-26 起隐藏 Loop 主任务任务列表。与本次验收上限无关，未改任务列表。
- 功能清单：更新 `FEATURE_INVENTORY.md`。
- 相关文档同步：能力说明、运行时参考、调度设计、ontology。

## 任务列表

- [x] 确认计数单位和配置入口
- [x] 接入设置、记录和界面
- [x] 调度强制执行
- [x] 测试与文档

## 决策记录

- 2026-09-29：一次验收等于一个 `seenAttempts` 中新变为 `reviewed` 的 attempt。幂等重放不计。`loopPlusMaxAcceptances` 跟随任务记录，全局设置只升不降。

## 当前结论

已实现并归档到 `.ch/docs/exec-plans/completed/2026-09/2026-09-29-loop-plus-max-acceptances.md`。Loop+ 最多验收次数在“AI任务配置”中设置，字段 `loopPlusMaxAcceptances`，默认 100，范围 1–999，写入 `~/.sinitek_cli/settings.json`。它不读取经典 Loop 的 `loopMaxRounds`。一次验收等于一个新变为 `reviewed` 的子任务 attempt；整批超限则不提交，父任务进入 `needs-review`，验收队列保持不变。已达上限后不再派发新子任务。新建任务写入当时全局值，之后全局设置只升不降。
