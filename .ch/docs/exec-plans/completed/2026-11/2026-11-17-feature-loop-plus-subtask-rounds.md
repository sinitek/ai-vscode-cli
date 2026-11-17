# Loop+ 子任务轮次替换验收上限

- 日期：2026-11-17
- 类型：feature
- 状态：completed
- 负责人：Codex
- 关联计划：无；工作区另有显式依赖调度改动，本次提交排除该任务。

## 背景与目标

移除“Loop+ 最多验收次数”选项及验收额度门禁，增加“Loop+ 子任务轮次”，默认 100，范围 1–9999。

## 范围与验收标准

- 配置、消息协议、面板、任务持久化和模型上下文使用新的 `loopPlusSubtaskMaxRounds`。
- 每个成功入队的新 attempt（包括免验收、并行、重派）占一轮；同 attempt 恢复不重复计数，排队提升不重复计数。
- 新派发及 reprompt 整份决策的计划数量超过剩余额度时，不新增 attempt；验收和已入队工作不受轮次额度阻拦。
- 旧验收上限不迁移成轮次预算；旧任务缺少新配置时采用当前全局值。任务预算沿用只升不降的恢复约定。
- 不改经典 Loop 轮次、单次派发/并发限制、依赖满足与验收完成门禁。

## 影响面与风险

涉及 `src/extensionHost/loopPlus*`、设置/任务存储、Webview、相关测试与产品/ontology 文档。当前工作区已有未提交依赖调度实现，所有修改基于当前磁盘并保留其行为。使用持久化 scheduler 的 seenAttempts 计数，防止重启清零或漏算免验收。

## 验证计划

执行相关决策、编排、提示词、存储、设置和页面测试，`npm run build`；浏览器验证实际设置控件及上下界提交。更新功能清单、运行时参考、调度设计和 ontology，并验证 ontology。

## 当前进展

实现、测试与事实来源同步完成。固定 200 次主模型决策保护改为 `max(200, 子任务轮次 × 3)`，避免较高轮次设置被旧保护提前截断；显式注入的测试阈值保持优先。

## 工作区联合验证结果

- `npm run build`：通过。
- 相关 9 文件测试：`node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusContracts.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`：521/521 通过，日志 `/tmp/loop-plus-rounds-tests.log`。
- 覆盖超过剩余轮次的整批拒绝、并行与排队预留、免验收、close 不退轮次、reprompt 新轮次、恢复不重计、提高预算续派、既有验收不受预算阻拦。新增连续 101 项验收及超过 200 次主模型调用后完成回归，显式安全阈值旧测试仍通过。
- 扩展验证：`node --test dist/test/loop/loopTaskStore*.test.js dist/test/core/panelStateBuilder.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusAcceptanceCompletionGate.test.js dist/test/extensionHost/loopPlusHandoffContracts.test.js dist/test/loop/loopPlusPanelState.test.js`：157/158 通过，日志 `/tmp/loop-plus-rounds-integration.log`。
- 扩展失败分类：现有未提交依赖调度路径的交接恢复问题。`dispatch commit failure leaves no started or reserved attempt; recovery starts it once` 在恢复后预期启动 1 项，实际 0 项；该路径先持久化 pending，再提升 running，磁盘失败后仍保留 pending。仅在生成的 dist 中临时关闭本次轮次门禁并定向重跑仍失败，日志 `/tmp/loop-plus-rounds-budget-disabled-test.log`；已恢复 dist 并最终重新构建。没有改写该相邻任务的恢复契约或调整断言使其通过。
- 使用 chromium-playwright-smoke 的生产 HTML/运行时和模拟 VS Code 消息桥，1100×900 与 640×900 均通过；新控件可见、旧控件不存在、min=1/max=9999，输入 10000/0 分别提交 9999/1，新键为 `loopPlusSubtaskMaxRounds`，浏览器、HTTP、请求错误均为空。证据 `.tmp/loop-plus-rounds/browser/result.json`、`.tmp/loop-plus-rounds/browser-lower/result.json` 及各自 `success.png`，已检查截图。模拟桥不读取或修改真实用户设置，没有运行真实 CLI 或 Extension Development Host。
- ontology 校验通过，ontology Python 测试 9/9 通过；Impeccable 机械检查结果为空；`git diff --check` 通过。
- 已同步调度设计、功能清单、插件能力、运行时参考与 ontology；旧验收次数规则标记 historical，新建子任务轮次规则。当前功能事实已放入这些事实来源，不另扩热区记忆或 EVENT_MEMORY。
- 初轮测试中的 2 条调用索引断言属于移除验收门禁后的过期断言，改为按 submitReviewBatch 调用名核对；旧 999 上界断言同步为 9999。最终相关测试全部通过。

## 独立提交验证

在基于 HEAD 的隔离 worktree 中按本任务范围重建待提交内容，排除显式依赖调度实现及其测试。

- `npm run build`：通过。
- 按上述相关 9 文件命令执行单测：503/503 通过，日志 `/tmp/loop-plus-rounds-isolated-tests.log`。
- 按上述扩展验证命令执行存储、面板、运行时集成、验收完成门禁和交接回归：155/155 通过，日志 `/tmp/loop-plus-rounds-isolated-integration.log`。联合工作区中的交接恢复失败在独立版本未复现。
- 两组共 658 项测试全部通过，无失败、取消、跳过或 TODO。
- ontology `--validate` 和 `git diff --check`：通过。
- 待提交源码不包含显式依赖调度的新实现、字段或测试；原工作区共享源码未改写。
