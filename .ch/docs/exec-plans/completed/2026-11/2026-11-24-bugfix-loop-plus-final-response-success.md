# Loop+ 子任务最终答复成功判定修复

- 日期：2026-11-24
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Codex 子任务正常结束并返回最终答复后，调度器仍因隔离执行目录清理返回 `ENOTEMPTY` 将其标记为失败。同时，完成文案只查询主运行消息缓冲，误显示“任务中断”。普通 Loop+ 子任务的当前执行有最终答复且 CLI 调用正常结束时，按成功处理；临时目录清理失败单独诊断。

## 目标与范围

- 完成文案直接使用本次运行的消息缓冲验证最终答复，不等待会话写盘。
- 普通 Loop+ 最终答复已完成时，执行根释放失败不覆盖成功结果；清理错误仍保留日志和清理观察。
- 保持部门 Owner 的资源清理门禁及无最终答复、CLI 失败、停止等现有规则。

## 验收标准

- [x] 子任务会话含本轮 Codex 最终答复时，成功终态展示验收文案，即使答复不在主运行消息缓冲。
- [x] 普通 Loop+ 有最终答复但执行根清理失败时返回 completed；清理失败仍可诊断。
- [x] 无最终答复、执行失败、停止与部门 Owner 清理门禁保持原行为。

## 影响面

- 代码：`src/extension.ts`、`src/extensionHost/promptRunRuntime.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`。
- 测试：`src/test/extensionHost/loopPlusRuntimeWiring.test.ts`、`src/test/extensionHost/loopPlusRuntimeIntegration.test.ts`。
- 事实来源：Loop+ 调度设计、功能清单、本体规则。

## 风险与缓解

- 误把执行目录清理失败等同于 CLI 成功会掩盖泄漏；保留 `cleanupFailed`、清理日志及部门 Owner 必需资源门禁，只有普通子任务的业务 attempt 结果不被改写。
- 本次消息缓冲无最终答复时，仍走既有失败路径。

## 验证计划

- 最小相关验证：`npm run build`。
- 单元自测：`node --test dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js`。
- 最终答复显示使用扩展集成中消息缓冲隔离回归；清理结果使用运行时集成回归。

## 测试与清单同步

- 单元测试新增/更新：最终答复不在主缓冲、清理失败但业务成功。
- 单元自测结果：`npm run build` 通过；wiring、interactive 与本次清理/最终答复定向回归通过；Ontology 校验、改动范围空白校验及 `git diff --check` 通过。完整 Loop+ integration 有 1 项既有协议续跑用例失败（`Loop+ 在原主任务中修复验收 JSON，不重复执行已完成子任务`，实际 `needs-review`、期望 `completed`），其余 71 项通过；该用例不在本次改动范围。
- 功能清单：更新 Loop+ 子任务最终答复与清理诊断说明。
- 相关文档同步：更新 Loop+ 调度设计与 Ontology。

## 任务列表

- [x] 从本机运行记录核对最终答复、失败结果及清理错误。
- [x] 修复完成文案的消息来源和清理/业务结果混淆。
- [x] 补回归，验证构建、本体和相关单测。

## 决策记录

- 2026-11-24：实际失败根因是隔离执行根清理 `ENOTEMPTY`；“任务中断”完成气泡来自另一个错误的消息缓冲查询。分别修复，不改写无答复或部门资源失败门禁。

## 当前结论

完成文案从本次运行的消息缓冲核对最终答复；普通 Loop+ 清理失败作为独立诊断，不能覆盖成功结果。部门 Owner 的清理门禁保持原样。
