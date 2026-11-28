# 任务诊断默认启用与日志分级

- 日期：2026-11-27
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 目标与范围

- 全局调试默认开启，保留显式关闭。关闭时只新增错误日志；性能、原始 CLI 输出和普通诊断跟随开关。
- 减少非任务输出，保留并补足 Loop+ 子任务结果、验收及产研部恢复、派发和清理诊断。
- 不修改任务状态推进、会话、回放、日志保留或历史收据；不读取真实用户日志。

## 验收与验证

- [x] 在隔离 HOME 验证默认开启、关闭、重新开启及保留清理；验证错误与正常事件的级别。
- [x] 回归 Loop+ 和产研部关键路径、验证编译及 ontology、同步功能清单和排障文档。

## 风险与缓解

- CLI 详细日志可能含提示词和原始输出：设置界面提示，支持关闭；新增结构化事件只写标识、阶段、计数和结果。
- 诊断不得作为恢复、容量或任务状态证据，写入失败不影响编排。

## 验证结论

- `npm run build`：通过。
- `node --test dist/test/core/logger.test.js dist/test/core/performanceLog.test.js dist/test/extensionHost/loopPlusDiagnostics.test.js dist/test/extensionHost/departmentlifecyclediagnostics.test.js dist/test/loop/loopplusdecisionhelper.test.js`：21/21 通过。
- `npm run build && node --test dist/test/core/logger.test.js dist/test/core/performanceLog.test.js dist/test/extensionHost/departmentlifecyclediagnostics.test.js dist/test/extensionHost/loopPlusDiagnostics.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`：构建通过，225/225 通过。
- 扩展运行 `dist/test/loop/departmentGroupChatHost.test.js` 时，日志策略之外的 director allocation writer 用例失败（断言收到的错误为 `undefined`，预期包含“持久保存失败”）；该用例涉及当前工作树中的产研部 allocation 改动，不属于本计划范围，未修改。
- Ontology 校验通过；Ontology 单元测试 9/9 通过；`git diff --check` 通过。
- `node --test dist/test/loop/loopTaskStorePersistence.test.js` 在测试加载阶段失败：当前工作树中既有的 `src/loopTaskStore.ts` → `src/extensionHost/loopPlusDiagnostics.ts` → `src/loopPlusProtocolDiagnostics.ts` → `src/loopPlusDecision.ts` 循环依赖在 `LOOP_PLUS_TASK_TYPES` 初始化前读取该常量。本次未改动该既有依赖链。

## 当前结论

调试日志默认开启；关闭后插件仅保留错误日志。性能及非错误任务诊断都遵循调试开关。Loop+ 与产研部保留丰富的成功阶段诊断，并始终记录关键失败、未确认和持久化错误。界面噪声、配置/导出成功事件已移除。
