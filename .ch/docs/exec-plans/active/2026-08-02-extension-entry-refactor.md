# extension.ts 入口运行时重构计划

- 日期：2026-08-02
- 状态：in-progress
- 负责人：协作
- owner：graph_msg_1785683322596_8d0486c3981e8
- claimed_at：2026-08-02T15:19:46+08:00
- claim_ttl：Graph run 生命周期内有效
- handoff_to：review-extension-refactor

## 背景

用户目标是继续重构 `src/extension.ts`，尝试把文件压到 3000 行以下；但 3000 行只是期望指标，不是硬性成功条件。当前基线为 `wc -l src/extension.ts` 输出的 6764 行。上游规划确认主要体量集中在 `runPromptOneShot` 和 `runPromptInteractive` 两条提示运行流，本轮适合按运行时职责抽取，而不是把组合根整体改名搬迁到另一个大文件。

本次计划是内部结构重构：保持 VS Code 插件已有命令、面板、CLI runner、Graph/Loop、会话持久化、停止/清理、trace、i18n 和错误提示行为不变，仅调整 extension 入口与运行时 host 的代码边界。

截至 2026-08-03 文档同步节点，one-shot 与 interactive runtime 已迁入 `src/extensionHost/`，`src/extension.ts` 当前为 5092 行，低于 6764 行基线但未达到 3000 行。剩余体量主要是组合根、Graph/Loop/session/model/config 装配和共享生命周期适配；继续拆分应作为后续独立职责重构推进，不能为了行数迁移非内聚代码。

## 目标

- 将 `runPromptOneShot` 相关运行逻辑迁入专用 one-shot host，`extension.ts` 只保留显式装配、路由和必要生命周期适配。
- 将 `runPromptInteractive` 相关运行逻辑迁入专用 interactive host，并复用窄接口和共享类型，避免复制业务规则。
- 保持现有用户行为不变，并通过 focused 构建、契约测试、运行时测试和评审确认无行为回归。
- 记录每个阶段的 `src/extension.ts` 实际行数；若最终仍高于 3000 行，必须说明剩余职责为何应保留在组合根中。

## 范围

- `src/extension.ts` 中 one-shot 和 interactive 提示运行时的抽取边界。
- 新增或调整 `src/extensionHost/promptOneShotRuntime.ts`、`src/extensionHost/promptInteractiveRuntime.ts`、`src/extensionHost/promptExecutionShared.ts`。
- 迁移后同步相关契约测试的 canonical source，避免测试继续读取旧的 `extension.ts` 文本切片。
- 更新运行时边界文档和本执行计划的阶段记录。

## 非目标

- 不替换 VS Code 插件技术栈、构建系统、测试框架或 CLI runner 架构。
- 不改变任何用户可见命令、配置项、面板行为、文案、国际化键或存储格式。
- 不为达成 3000 行数字而搬迁非内聚代码、复制运行规则或引入大而泛的工具模块。
- 不刷新 generated recall，不写入长期记忆目录，不修改 `.ch/docs/memory/` 或 `.ch/docs/runbooks/PITFALLS.md`。
- 若实现阶段确认没有用户行为变化，不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`；理由是本次只改变内部结构，不新增、删除或调整功能清单中的能力。

## 验收标准

- [x] `src/extension.ts` 基线 6764 行已记录，one-shot 抽取后 6101 行，interactive 抽取后 5092 行。
- [x] one-shot 运行时抽取后，OpenCode stream、hidden retry、fresh-session recovery、任务列表、长期记忆、自动压缩、错误提示和 i18n 行为保持不变。
- [x] interactive 运行时抽取后，Codex、Claude、OpenCode runner 事件映射、final answer、hidden retry、tab 状态、session adoption、subagent progress 和 dispose 行为保持不变。
- [x] 新 host 使用可检索的显式依赖类型和输入边界，不新增 `Record<string, any>` 扩散、魔法闭包或同名包装函数自递归。
- [x] 契约测试 canonical source 从旧 `extension.ts` 切片迁移到对应 runtime 文件，同时保留 extension host 装配断言。
- [x] `npm run build`、focused runtime/contract tests 和 `npm run test:unit` 的结果已记录；失败时按 implementation_defect、stale_test_contract、missing_write_scope、environment_failure 或范围外历史失败分类。
- [x] 3000 行以下是目标但非强制验收；当前高于 3000 行，文档已说明继续拆分为何不应按行数硬拆。

## 影响面

- 代码目录：`src/extension.ts`、`src/extensionHost/`。
- 测试目录：`src/test/extensionDeactivateStopAll.test.ts`、`src/test/extensionHostExtractionContracts.test.ts`、`src/test/opencodeCommandRunner.test.ts`、`src/test/promptOneShotRuntime.test.ts`、`src/test/promptInteractiveRuntime.test.ts`。
- 文档目录：`ARCHITECTURE.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、本计划文件。
- 配置与脚本：不计划修改 `package.json`、TypeScript 配置、构建脚本或产品功能清单。

## 风险与缓解

- 风险：运行时抽取遗漏停止、清理、hidden retry、session adoption 或消息持久化边界，导致用户行为回归。
- 缓解：先审计当前边界，再按 one-shot 和 interactive 两段串行抽取；每段后运行 focused tests，并由独立 review 节点核对生命周期。
- 风险：旧测试继续读取 `extension.ts` 文本切片，造成 stale contract 误报。
- 缓解：为契约测试设置独立适配节点，明确将 canonical source 更新到对应 runtime 文件，失败时按 `stale_test_contract` 分类。
- 风险：为减少行数过度抽象，产生循环依赖、宽泛 `Record<string, any>` 或同名包装函数自递归。
- 缓解：新 host 只接受显式窄接口，抽取与函数职责强相关的 helper；评审节点核查依赖方向和递归风险。
- 风险：并发 Graph 节点同时写 `dist/**` 或文档导致噪音。
- 缓解：源码、测试、文档和 build artifacts 已通过 Graph `conflictGroup` 分组；本节点只写本计划文件。
- 当前未决风险：无本节点范围内未决风险；最终评审仍需由 `review-extension-refactor` 节点核查生命周期、依赖方向和剩余组合根职责。

## 验证计划

- 最小相关验证：
  - `wc -l src/extension.ts src/extensionHost/promptOneShotRuntime.ts src/extensionHost/promptInteractiveRuntime.ts src/extensionHost/promptExecutionShared.ts`
  - `git diff --check -- ARCHITECTURE.md .ch/docs/design-docs/vscode-cli-extension-runtime.md .ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md`
- 单元自测命令：
  - `npm run build`
  - `npm run build && node --test dist/test/extensionHostExtractionContracts.test.js dist/test/extensionDeactivateStopAll.test.js dist/test/opencodeCommandRunner.test.js dist/test/sessionPersistenceWiring.test.js`
  - `npm run build && node --test dist/test/promptOneShotRuntime.test.js dist/test/promptInteractiveRuntime.test.js`
- 扩展验证：
  - `npm run test:unit`

## 测试与清单同步

- 单元测试新增/更新：`adapt-one-shot-contract-tests` 新增 `promptOneShotRuntime.test.ts` 并迁移 one-shot canonical source；`adapt-interactive-contract-tests` 新增 `promptInteractiveRuntime.test.ts` 并迁移 interactive canonical source。
- 单元自测结果：`test-one-shot-runtime` 记录 `npm run build` 退出码 0，one-shot focused tests 65/65 通过；`test-interactive-runtime` 记录 `npm run build` 退出码 0，one-shot/interactive host、OpenCode、deactivate、session persistence、Graph runtime 与 Loop queue focused tests 86/86 通过，`git diff --check` 退出码 0。
- 失败处理记录：focused 验证最终无失败；过程中 stale contract 与环境类问题已在对应测试适配节点记录并修正。`test-unit-full` 记录 `npm run test:unit` 退出码 0，842/842 tests passed。
- 功能清单：本次实现保持用户行为不变，仅调整内部结构和测试 canonical source；因此继续不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或兼容入口功能清单。
- 相关文档同步：`sync-runtime-docs` 更新 `ARCHITECTURE.md` 和 `.ch/docs/design-docs/vscode-cli-extension-runtime.md`，并在本计划回填实际行数、职责边界、focused 验证和 3000 行结论。

## 阶段记录

- 2026-08-02 基线：`src/extension.ts` 6764 行。
- 2026-08-02 one-shot 抽取后：`src/extension.ts` 6101 行，`promptOneShotRuntime.ts` 994 行，`promptExecutionShared.ts` 38 行。
- 2026-08-02 interactive 抽取后：`src/extension.ts` 5092 行，`promptInteractiveRuntime.ts` 1210 行，`promptExecutionShared.ts` 59 行。
- 2026-08-03 文档同步时当前行数：`src/extension.ts` 5092 行，`promptOneShotRuntime.ts` 994 行，`promptInteractiveRuntime.ts` 1210 行，`promptExecutionShared.ts` 59 行。
- 3000 行状态：未达到。原因是 `extension.ts` 仍承担组合根、生命周期、Webview/command 路由、Graph/Loop/session/model/config host 装配和共享运行状态适配；继续压缩应按这些职责另开节点拆分，不应在本轮为数字目标强搬。

## 任务列表

- [x] 记录 6764 行基线、范围、非目标、风险、验证命令和 3000 行非强制原则。
- [x] 审计当前 `runPromptOneShot`、`runPromptInteractive`、停止路径和可迁移 helper。
- [x] 抽取 one-shot 运行时 host，并记录阶段性 `src/extension.ts` 行数。
- [x] 适配 one-shot 契约测试和 runtime 测试。
- [x] 验证 one-shot focused 构建与测试。
- [x] 抽取 interactive 运行时 host，并记录最终 `src/extension.ts` 行数和剩余职责。
- [x] 适配 interactive 契约测试和 runtime 测试。
- [x] 验证 interactive focused 构建与测试。
- [x] 同步运行时边界文档和本计划。
- [x] 运行完整单元测试并记录失败分类。
- [ ] 通过评审后归档执行计划。

## 决策记录

- 2026-08-02：以当前磁盘 `wc -l src/extension.ts` 的 6764 行作为重构基线。
- 2026-08-02：3000 行以下是目标，不是强制验收；最佳实践优先于压行数。
- 2026-08-02：本次只做内部结构重构；无用户行为变化时不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 2026-08-02：`extension.ts` 继续作为组合根，运行时业务逻辑按 one-shot 和 interactive host 分阶段迁移。
- 2026-08-03：文档同步确认当前 `extension.ts` 5092 行，未达 3000 行但符合最佳实践边界；功能清单无需更新，因为没有用户可见行为变化。

## 当前结论

运行时抽取、契约适配、focused 构建、focused 测试和 `npm run test:unit` 均已完成并记录。`sync-runtime-docs` 已同步运行时边界文档；下一步由 `review-extension-refactor` 核查生命周期、依赖方向和剩余组合根职责。计划保持 active，待评审通过后由 `finalize-exec-plan` 归档。
