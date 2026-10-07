# 计划标题

- 日期：2026-09-25
- 状态：completed
- 负责人：Codex / 人类
- owner：
- claimed_at：2026-09-25
- claim_ttl：本次会话

## 背景

Loop 主任务进入 `needs-review` 后，用户关闭主任务 Tab，Tab 仍会自动重新出现。现场同时存在其他 Loop 主任务和子任务，但该任务自身 `activeSubtaskIds` 为空。

## 目标

确保 `needs-review`、`error`、`stopped`、`completed` 的 Loop 主任务 Tab 关闭后不会被群聊刷新或其他任务活动重新创建；用户明确继续时仍可创建缺失主 Tab。

## 范围

- Loop 主任务 Tab 查找与创建。
- Loop 群聊面板状态刷新。
- 相关回归测试和功能清单。

## 非目标

- 不改变用户主动继续任务的语义。
- 不重构 CLI Runner、队列或无关 Tab/Graph 生命周期。

## 验收标准

- [x] 群聊面板刷新不再为终态任务创建主 Tab。
- [x] 未显式要求创建时，终态任务不会因为缺少主 Tab 而新建。
- [x] 用户点击继续时仍显式允许创建缺失主 Tab。
- [x] 运行中的任务在子任务完成后仍可恢复缺失主 Tab。
- [x] 相关测试通过，`npm run build` 通过。

## 影响面

- 代码目录：`src/extensionHost/promptRunRuntime.ts`、`src/panelDiagnostics.ts`。
- 文档目录：本执行计划、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/runbooks/PITFALLS.md`。
- 配置与脚本：无。

## 风险与缓解

- 风险：阻止终态自动建 Tab 后，用户继续任务时找不到主 Tab。
- 缓解：群聊“继续执行”和恢复原始运行时显式传入 `createIfMissing: true`。
- 风险：运行中的任务主 Tab 被关闭后无法在子任务完成时恢复。
- 缓解：默认创建只保留给 `status === "running"`。

## 验证计划

- 最小相关验证：群聊协调器和主任务运行时测试。
- 单元自测命令：`npm run build`；`node --test dist/test/loop/loopDebateCoordinator.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/session/conversationTabLock.test.js`。
- 扩展验证：需要在 Extension Development Host 中关闭 `needs-review` 主 Tab，并保持群聊面板打开。

## 测试与清单同步

- 单元测试新增/更新：群聊渲染不创建 Tab；终态任务默认不创建，显式继续才创建。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/loop/loopDebateCoordinator.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/session/conversationTabLock.test.js` 20/20 通过；`git diff --check` 通过。
- 失败处理记录：无。
- 功能清单：已同步 Loop 主任务 Tab 生命周期条目。
- 相关文档同步：已补充 PITFALLS。

## 任务列表

- [x] 定位 Loop 主任务生命周期与重开触发点。
- [x] 修复终态任务关闭 Tab 后被自动重建。
- [x] 补充回归测试并执行最小验证。

## 决策记录

- 2026-09-25：其他正在运行的主任务或子任务不会把 `needs-review` 任务重新置为运行；群聊面板每 5 秒刷新才是关闭后 Tab 反复出现的直接原因。
- 2026-09-25：终态任务默认不创建缺失主 Tab，只有调用方显式 `createIfMissing: true` 才创建。

## 当前结论

根因是 `resolveLoopMainPromptTarget` 在主 Tab 缺失时无条件创建，而群聊面板自动刷新每次都会解析主目标。现已让终态任务默认只查找现有 Tab，用户继续路径显式允许创建。
