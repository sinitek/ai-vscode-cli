# Loop 中断状态与恢复运行配置修复

- 日期：2026-07-14
- 状态：completed
- 负责人：Codex
- owner：当前会话
- claimed_at：2026-07-14
- claim_ttl：当前修复执行期
- handoff_to：无

## 背景

Loop 主任务进入 `stopped`、`error` 或 `needs-review` 后，群聊已展示“任务已中断，需要人工复核或继续”，但主任务 Tab 仍可能被残留编排所有权判为执行中。随后从群聊继续任务时，恢复链固定使用任务创建时的 `task.cli` 查找配置和模型，没有采用主任务 Tab 最新选择的 CLI 分组、激活配置和模型。

## 目标

修复 Loop 主任务中断后的运行态收口，并确保显式继续同一 Loop 任务时使用主任务 Tab 当前选择的 CLI 分组、激活配置和模型。

## 范围

- Loop 任务运行控制状态计算与编排所有权生命周期。
- Loop 群聊“继续执行”的目标 Tab、CLI、配置和模型解析。
- 显式恢复同一任务时的 CLI/会话归属迁移。
- Loop 轮次和子任务重试在派发前的中断终态检查。
- 对应单元测试、功能清单、运行时事实文档和避坑记录。

## 非目标

- 不改变 Loop 主任务决策 JSON、子任务并发、重试或辩论协议。
- 不改变普通 Vibe/Coding 任务的分组、配置和模型选择逻辑。
- 不改动 CLI 配置文件内容或模型目录管理。

## 验收标准

- [x] Loop 任务状态为 `stopped`、`error` 或 `needs-review` 时，即使残留运行所有权尚未完成异步释放，主任务也不再显示执行中。
- [x] 终止后立即继续不会因旧编排 `finally` 清理而误删新编排所有权。
- [x] 群聊“继续执行”使用主任务 Tab 当前 CLI、该 CLI 当前激活配置和当前模型。
- [x] 主任务 Tab 切换 CLI 后仍能找到原 Loop 任务，并以同一任务 ID 恢复；任务记录迁移到新 CLI/会话归属。
- [x] 旧轮次和重试发现 Store 已进入中断终态后不再重新派发或把任务写回 `running`。
- [x] 相关单元测试、TypeScript 编译和 Node 构建通过。

## 影响面

- 代码目录：`src/loopDebate.ts`、`src/loopOrchestrationOwnership.ts`、`src/loopTaskStore.ts`、`src/sessionTabs.ts`、`src/panelDiagnostics.ts`、`src/extension.ts`
- 测试目录：`src/test/loopDebate.test.ts`、`src/test/loopOrchestrationOwnership.test.ts`、`src/test/loopTaskStore.test.ts`、`src/test/conversationTabLock.test.ts`、`src/test/loopDebateCoordinator.test.ts`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`.ch/docs/references/`、`.ch/docs/runbooks/`、`docs/插件功能清单.md`
- 配置与脚本：无

## 风险与缓解

- 风险：旧编排尚在退出时用户立即恢复，旧编排释放动作可能覆盖新运行所有权。
- 缓解：把任务级编排所有权由布尔集合改为引用计数，每次运行只释放自身的一份所有权。
- 风险：跨 CLI 恢复时错误绑定到无关 Tab 或会话。
- 缓解：优先按 Loop 消息中的 `taskRole=main + loopTaskId` 匹配；仅在缺少消息上下文时按任务原 CLI 的 session 绑定回退。
- 风险：跨 CLI 后任务记录仍留在旧 CLI 路径，后续会话绑定和历史枚举不一致。
- 缓解：显式恢复前同步更新 `cli`、`sessionId` 和 `taskStoreFile`，复用现有原子迁移写入逻辑。
- 风险：任务在子任务重试等待期被停止，等待结束后旧路径重新派发。
- 缓解：主编排、子任务重试和单轮运行在派发前重新读取持久化终态，发现中断立即退出。

## 验证计划

测试分层、适用性与失败处理统一遵循 `.ch/docs/TESTING.md`。

- 最小相关 unit（命令、结果或不适用理由）：关键回归包含 `loopDebate.test.js`、`loopOrchestrationOwnership.test.js`、`loopTaskStore.test.js`、`conversationTabLock.test.js`、`loopDebateCoordinator.test.js`，随下述相关测试集通过。
- 模块/统一 unit（命令、结果或等价关系）：`node --test --test-concurrency=1 dist/test/conversationTabLock.test.js dist/test/loopDebate.test.js dist/test/loopDebateCoordinator.test.js dist/test/loopDebatePanel.test.js dist/test/loopOrchestrationOwnership.test.js dist/test/loopPromptQueue.test.js dist/test/loopSubtaskLifecycle.test.js dist/test/loopSubtaskProgress.test.js dist/test/loopTaskStore.test.js dist/test/opencodedualmodelwebview.test.js dist/test/opencodeloopmodewebview.test.js dist/test/opencoderolemodelruntime.test.js dist/test/sessionMessageActions.test.js`，通过，118/118。
- typecheck/build（命令、结果或不适用理由）：`npm run build` 通过；`git diff --check` 通过。
- Chromium headless smoke（适用性及理由、scenario、命令、退出码、`result.json`/截图、未覆盖风险）：不适用；本次变更是 VS Code Extension Host 编排、Store 迁移和纯状态逻辑，没有独立浏览器运行目标，Webview 只消费既有 PanelState 字段。

## 测试与清单同步

- 单元测试新增/更新：新增群聊继续运行时选择、编排所有权引用计数测试；更新中断终态、跨 CLI 主 Tab 定位和任务 Store 迁移测试。
- 单元自测结果：相关测试 118/118 通过，`npm run build` 通过。
- 失败处理记录：统一 `npm test` 已完成编译，但并发中的 `src/test/chromiumPlaywrightSmoke.test.ts` 引用了尚未落到 `.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs` 的脚本，运行因开放句柄停止时退出码为 130；后续排除 Chromium 的全量尝试先通过 419 项，随后另一个并发构建清理 `dist/test`，造成 26 个 `MODULE_NOT_FOUND`。两类失败均不是 Loop 产品断言失败，本任务未修改该 Chromium harness 工作；以隔离串行的 118 项相关测试作为本次验收依据。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `docs/插件功能清单.md`。
- 相关文档同步：已同步能力规格、运行时设计、CLI 运行时参考和 `.ch/docs/runbooks/PITFALLS.md`；`media/official_skills_catalog.json` 无需修改，并确认 56 条 description 均含中文。
- 记忆收尾：用户可见行为已进入 product specs，稳定运行时边界已进入 design/reference，复发原因与规避方式已进入 PITFALLS；无需重复写入 L1-L3 热区或新增 skill。

## 任务列表

- [x] 定位中断运行态与恢复参数链根因。
- [x] 补充失败回归测试。
- [x] 实现终态优先、所有权引用计数和跨 CLI 恢复。
- [x] 增加轮次与重试派发前的中断终态门禁。
- [x] 同步事实文档。
- [x] 运行分层验证并归档计划。

## 决策记录

- 2026-07-14：`completed` 仍保留现有“底层运行尚未释放时可显示运行中”的兼容行为；本次只让明确中断终态 `stopped/error/needs-review` 优先结束 UI 运行态。
- 2026-07-14：显式恢复的权威运行配置来自主任务 Tab 当前 CLI，而不是任务创建时快照；模型再按该 CLI 当前激活配置解析。
- 2026-07-14：跨 CLI 继续保留原任务 ID，并迁移任务的 CLI、session 和 Store 文件归属，避免制造第二个逻辑任务。
- 2026-07-14：所有权使用引用计数而不是布尔 Set，确保重叠退出窗口中每个编排只释放自己的所有权。

## 当前结论

修复已完成。Loop 明确中断终态现在优先结束视觉运行态和主 Tab 锁定；旧编排退出不会清除新恢复编排的所有权，旧轮次和重试也不会在停止后复活任务。群聊“继续执行”会定位原主任务 Tab，并使用该 Tab 当前 CLI 分组的激活配置和模型恢复同一任务；跨 CLI 时同步迁移任务 Store 归属。构建和 118 项相关测试全部通过，无未决的本任务事项。
