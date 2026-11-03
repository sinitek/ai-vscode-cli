# Codex 通知分发策略化重构

- 日期：2026-11-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-03
- claim_ttl：本次会话
- handoff_to：-

## 背景

`src/interactive/codexRunner.ts` 的 `handleNotification` 同时负责通用事件前置过滤、线程/回合生命周期、文本增量、推理、任务列表、工具回放、错误和条目事件处理，当前函数约 378 行，分支密集。新增 Codex App Server 事件或调整某类事件时，需要在同一大函数中修改并承担较高回归风险。

## 目标

使用策略注册表将按 `method` 的通知处理拆成职责单一的私有处理器，保留统一前置过滤、转发和压缩完成逻辑，使协议事件扩展点可检索、可独立审阅，并保持现有行为不变。

## 范围

- `src/interactive/codexRunner.ts` 的通知分发与事件处理拆分。
- 复用现有 Codex Runner 生命周期和运行时辅助函数。
- 扩展现有 Codex 生命周期测试，覆盖通知别名、任务列表、条目事件、未知方法、空参数与主子线程错误路由。

## 非目标

- 不改变 Codex App Server 协议字段、事件顺序、错误文案或完成条件。
- 不新增用户可见功能，不调整 `codexRunnerRuntime.ts` 的事件语义。
- 不重构其他 CLI Runner 或 Loop/Loop+ 编排。

## 验收标准

- [x] `handleNotification` 只保留通用前置流程和策略查找，按事件类型委派到私有处理器。
- [x] 现有线程、回合、推理、文本、工具、错误、token usage 和 item 事件行为保持一致。
- [x] `npm run build` 通过，相关 Codex 测试全部通过。
- [x] 代码变更不引入无关行为或用户可见功能变化。

## 影响面

- 代码目录：`src/interactive/codexRunner.ts`
- 测试目录：`src/test/interactive/codexRunnerLifecycle.test.ts`、相关 Codex Runner 测试
- 文档目录：执行计划；用户可见功能清单无需更新

## 风险与缓解

- 风险：事件分支提取时改变 `this` 上下文或提前返回语义。
- 缓解：策略注册表绑定当前 Runner；保留原有前置过滤和每个事件分支的返回点；执行现有生命周期回归测试。
- 风险：遗漏事件别名或策略映射。
- 缓解：为 reasoning、item started/completed 等别名建立显式多键映射，并以现有事件测试覆盖。
- 回滚：仅逆向本计划的 Runner、测试和架构说明差异，不恢复或覆盖其他并发任务的文件。

## 验证计划

- 最小相关验证：`npm run build`。
- 单元自测命令：`node --test dist/test/interactive/codexRunnerLifecycle.test.js dist/test/interactive/codexRunnerReuse.test.js dist/test/interactive/codexRunnerSubagent.test.js dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexAppServerEvents.test.js`
- 扩展验证：运行全部 Codex 单测及共享交互运行时、策略测试；本次不涉及 Webview，不运行浏览器验证。

## 测试与清单同步

- 单元测试新增/更新：新增 3 条通知路由回归；复用现有 fake App Server 夹具，不引入新测试框架。
- 单元自测结果：原有 63 项相关测试全部通过；最终扩展验证 134/134 通过（包含新增 3 项）；新增 3 项在重构前 `HEAD` 实现上也全部通过，证明测试锁定既有契约。最终标准构建和标准 `dist/` 中的新增回归均通过。
- 失败处理记录：新增成功路径测试最初把换行与后续推理文本预期为一个 chunk，实际协议按 summaryPartAdded 和 textDelta 分开发送；转发事件断言也需包含原有 turn.started，并排除启动时的 codex.lifecycle。两者均属于新增断言不准确，保持运行逻辑不变，仅修正预期。全量构建一度遇到另一会话并发修改 `src/test/session/sessionMessageHandlersCoreCoverage.test.ts` 的 `Calls.promptGlobals` 尚未补齐（TS2339），以及两个构建同时操作 `dist/` 的 ENOTEMPTY；本任务未修改并发文件，改用独立 outDir 验证，待并发改动收敛后标准构建重试通过。
- 功能清单：无需更新，用户可见行为不变。
- 相关文档同步：`ARCHITECTURE.md` 补充通知入口与处理器职责；本计划记录重构边界与验证结论。业务概念、状态机、事实来源路径均未改变，无需更新 ontology；不将单次内部整理写入热区记忆。

Tasklist:

- [completed] 完成 CodeGraph、Ontology 与现有文档调查
- [completed] 将 Codex 通知处理拆为策略注册表和私有处理器
- [completed] 运行构建与相关测试并完成计划归档

## 决策记录

- 2026-11-03：选择 Codex Runner 的通知分发作为重构点；相较已有 Runner 生命周期策略，该函数仍集中承载大量协议分支，且已有高覆盖生命周期测试可约束行为。
- 2026-11-03：采用轻量策略注册表，不拆出新的跨模块抽象，避免把私有运行状态和 `this` 回调扩散到多个文件。
- 2026-11-03：使用 decision-model skill 对候选分型复核，返回 `notification_dispatch`，confidence 为 0.87；不选已有策略化生命周期模块，也不扩大到插件入口整体拆分。
- 2026-11-03：任务初始工作区干净；未创建分支或 worktree，遵守未经用户要求不新建分支的限制。之后出现提示词收藏功能的并发编辑，只验证和保留，不在本任务中接管。

## 当前结论

已完成内部策略化重构，不改变产品契约。15 个协议方法键委派给 11 个私有处理器（含显式忽略处理器），共享活动操作和生命周期状态仍只属于 Runner。`handleNotification` 从 378 行降至 38 行，条件/分支 AST 节点从 81 个降至 7 个；整个 Runner 文件仅增加 24 行，维护收益来自职责分离而非强行缩短代码。对提取前后分支体做机械一致性检查，11 项全部一致（仅移除重复参数解析、末尾 return，并复用已解析的 thread 参数）。

## 验证记录

- `npm run build`：最终退出码 0；标准构建与单测串行执行。
- `node --test dist/test/interactive/codexRunnerLifecycle.test.js dist/test/interactive/codexRunnerReuse.test.js dist/test/interactive/codexRunnerSubagent.test.js dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexAppServerEvents.test.js`：最初拆分完成后 63/63 通过。
- `node node_modules/typescript/bin/tsc -p ./ --outDir node_modules/.cache/sinitek-codex-refactor/dist`：退出码 0；使用忽略的独立产物目录避开并发构建清理。
- `node --test "$PWD"/node_modules/.cache/sinitek-codex-refactor/dist/test/interactive/codex*.test.js "$PWD"/node_modules/.cache/sinitek-codex-refactor/dist/test/extensionHost/interactiveTurnStrategy.test.js "$PWD"/node_modules/.cache/sinitek-codex-refactor/dist/test/extensionHost/promptInteractiveRuntime.test.js`：134/134 通过，0 跳过。
- `node --test --test-name-pattern='Codex notification routing' dist/test/interactive/codexRunnerLifecycle.test.js`：最终标准构建后 3/3 通过。
- 基线对照：临时、非仓库 require hook 将 Runner 加载替换为 `git show HEAD:src/interactive/codexRunner.ts` 的转译结果，以相同新增回归验证原实现，3/3 通过；不修改工作区源码。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，domains=2、concepts=16、relations=15、rules=95、workflows=2。
- `git diff --check -- src/interactive/codexRunner.ts src/test/interactive/codexRunnerLifecycle.test.ts ARCHITECTURE.md`：通过。
- 未运行全仓单测、真实 Codex CLI 或 Extension Development Host：本次为纯内部等价提取，无协议/配置/UI 行为变更；相关事件通过既有模拟 App Server 与进程级回归覆盖。真实服务兼容性未另行认证。

归档路径：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-codex-notification-dispatch-refactor.md`。
