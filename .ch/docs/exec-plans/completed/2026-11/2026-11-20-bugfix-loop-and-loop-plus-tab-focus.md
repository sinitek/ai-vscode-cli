# Loop 与 Loop+ 后台状态抢占标签焦点修复

- 日期：2026-11-20
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-20
- claim_ttl：本轮
- handoff_to：无

## 背景

经典 Loop 子任务启动和收尾会自动切换可见标签；Loop+ 后台派发子任务时会创建子任务标签并异步发布完整面板快照。用户点击另一个主任务标签后，旧活动标签快照可能先于宿主确认到达并覆盖 Webview 的新选择。

## 目标

经典 Loop 和 Loop+ 的后台执行、状态刷新与收尾都尊重用户最近一次明确选择的主任务标签；经典 Loop 原有的前台子任务自动展示行为保持不变。

## 范围

- 为用户标签选择增加单调版本，宿主拒绝迟到的旧选择，面板状态携带生成时版本。
- Webview 收到旧版本面板快照时保留较新的本地选择，同时接收后台标签列表更新。
- 经典 Loop 子任务切换及并行组收尾增加活动标签归属检查。
- 更新功能清单、Loop 群聊状态边界及 Ontology 规则，并增加两种模式的回归测试。

## 非目标

- 不改变 Loop+ 调度、派发、CLI 路由、子任务生命周期或标签关闭策略。
- 不改变用户明确打开群聊成员子任务时的导航行为。
- 不执行真实模型任务或发布扩展。

## 验收标准

- Loop+ 后台新增子任务并发布旧活动标签快照时，Webview 保持用户刚选择的主任务标签。
- 经典 Loop 后台启动、子任务结束及并行组收尾不抢焦点；前台原有自动展示和恢复行为保留。
- 快速连续选择时，迟到的旧选择消息不覆盖最新选择。
- 构建、定向回归、Ontology 校验及本次文件空白检查通过。

## 影响面

- 代码：`src/extension.ts`、`src/extensionHost/loopOrchestration.ts`、`src/panelMessageHandlers/session.ts`、`src/panelStateBuilder.ts`、`src/sessionMessageHandlers.ts`、`src/webview/types.ts`、`src/webview/viewContentScript/messageRendering.ts`、`src/webview/viewContentScript/historyPanels.ts`
- 测试：`src/test/extensionHost/subtaskCliExecution.test.ts`、`src/test/session/sessionMessageHandlersCoreCoverage.test.ts`、`src/test/webview/clipagescriptruntimecoverage.test.ts`
- 文档：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/design-docs/loop-group-chat-state-boundaries.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`

## 风险与缓解

- 风险：面板状态快照和标签选择确认异步交错，或快速连续点击导致旧确认晚到。
- 缓解：用户选择和面板快照共享单调修订号；Webview 保留更新的本地选择，宿主忽略旧修订号。

## 验证计划

- 最小相关验证：`npm run build`，随后运行 Loop 子任务、Loop+、会话标签及 Webview runtime 定向测试。
- 静态校验：Ontology `--validate`、本次修改文件的 `check_trailing_whitespace.js`、`git diff --check`。
- 扩展验证：不操作真实任务或已安装扩展；Webview 标签快照竞争由 runtime 回归覆盖。

## 测试与清单同步

- 单元测试新增/更新：经典 Loop 前后台切页及并行收尾测试；宿主迟到选择版本测试；Loop+ 旧面板快照和历史入口选择版本测试。
- 单元自测结果：根目录 `npm run build` 通过；`node --test dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/webview/clipagescriptruntimecoverage.test.js` 通过，456/456。
- 失败处理记录：本轮构建、定向回归及静态校验均通过，无失败项。
- 功能清单：已更新 Loop / Loop+ 用户标签选择和后台快照竞争行为。
- 相关文档同步：已更新标签群聊状态边界及 Ontology 会话标签规则。

## 任务列表

- [x] 排查经典 Loop 自动切页和 Loop+ 后台面板快照两条抢焦点路径。
- [x] 将 Loop 与 Loop+ 的修复和回归测试落到当前项目工作区。
- [x] 从当前项目工作区重跑构建、定向回归和静态校验。
- [x] 记录验证结论并归档本计划。

## 决策记录

- 2026-11-20：Loop+ 同样复现，需修复共享面板状态快照竞态，不能只依赖经典 Loop 自动切页门禁。
- 2026-11-20：按用户要求不提交、不推送，修复直接保留在当前项目工作区。
- 用户随后明确要求将经典 Loop 与 Loop+ 的修复一并提交并推送到主干。

## 当前结论

经典 Loop 自动切页现受活动标签归属保护。Loop+ 和经典 Loop 共用带 `selectionRevision` 的标签选择/面板快照协议，迟到选择及旧快照不能覆盖用户最新选择。根目录构建、456 项定向测试、Ontology、改动文件空白检查和 `git diff --check` 均通过。
