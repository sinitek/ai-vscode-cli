# extension.ts 入口运行时重构计划 — 行为保持重构

- 日期：2026-08-02
- 状态：completed
- 负责人：Codex
- claimed_at：2026-08-03T15:36:41+08:00
- completed_at：2026-08-03T16:50:13+08:00
- claim_ttl：已完成并归档
- handoff_to：无
- 类型：refactor
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-02-extension-entry-refactor.md`

## 本类型目标

仅抽取内聚的 one-shot、interactive 与 OpenCode subagent runtime host，保留 extension 组合根、生命周期及用户行为；3000 行不是硬验收。

## 范围与所有权

- 仅抽取内聚的 one-shot、interactive 与 OpenCode subagent runtime host，保留 extension 组合根、生命周期及用户行为；3000 行不是硬验收。
- 本记录只承担 行为保持重构；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 仅抽取内聚的 one-shot、interactive 与 OpenCode subagent runtime host，保留 extension 组合根、生命周期及用户行为；3000 行不是硬验收。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-08-02-docs-extension-entry-refactor.md](2026-08-02-docs-extension-entry-refactor.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

用户目标是继续重构 `src/extension.ts`，尝试把文件压到 3000 行以下；但 3000 行只是期望指标，不是硬性成功条件。历史基线为 `wc -l src/extension.ts` 输出的 6764 行；one-shot 与 interactive runtime 抽取后，本轮实施前基线为 `wc -l src/extension.ts` 输出的 5092 行；OpenCode subagent runtime 抽取和评审时为 4968 行。
本次仍是内部结构重构：保持 VS Code 插件已有命令、面板、CLI runner、Loop、会话持久化、停止/清理、trace、i18n 和错误提示行为不变，仅调整 extension 入口与运行时 host 的代码边界。
截至 2026-08-03 `sync-extension-runtime-docs` 节点，one-shot、interactive 和 OpenCode subagent runtime 已迁入 `src/extensionHost/`，`src/extension.ts` 当前为 4968 行，低于 6764 行历史基线和 5092 行本轮基线，但未达到 3000 行。剩余体量主要是组合根、Loop/session/model/config 装配和共享生命周期适配；继续拆分应作为后续独立职责重构推进，不能为了行数迁移非内聚代码。
收束节点执行期间，另一个工作流提交了 `39aa2d9`（`fix loop max rounds resume limit`），在 `src/extension.ts` 的 Loop orchestration 区域净增加 3 行，未覆盖 OpenCode subagent runtime 抽取 diff。当前工作区因此为 4971 行；4968 行仍是本次抽取本身通过 focused 验证和独立评审时的结果。
本轮上游审计只推荐一个合理窄候选：把 `src/extension.ts:3453-3588` 附近的 OpenCode subagent server/monitor 准备逻辑迁入 `src/extensionHost/openCodeSubagentRuntime.ts`，并继续由 `extension.ts` 作为组合根导入、注入到 one-shot 与 parallel prompt runtime host。实现节点已采纳该候选；除该候选外，OpenCode runtime profile、active run stream、Loop orchestration、session/workspace/lifecycle 桥接和 host 创建大依赖注入对象均因依赖面过宽或属于组合根职责而停止拆分。

### 目标

- 本轮仅评估并执行一个内聚候选：OpenCode subagent runtime 准备逻辑抽取；实现节点已确认候选成立并完成迁移。
- 保持 `extension.ts` 为组合根：只负责导入、显式装配、路由和必要生命周期适配，不把剩余入口整体搬进另一个大文件。
- 保持现有用户行为不变，并通过 focused 构建、契约测试、运行时测试和评审确认无行为回归。
- 记录本轮抽取前后的 `src/extension.ts` 和目标 host 行数；5092 行是本轮实施前基线，4968 行是 focused 验证后的抽取结果，收束时叠加范围外提交后的当前值为 4971 行，3000 行以下不是强制验收。
- 保留历史记录：one-shot 与 interactive runtime 已完成抽取，相关行数、测试和文档结果继续作为背景证据。

### 范围

- `src/extension.ts:3453-3588` 附近的 OpenCode subagent server attach / managed startup / ready wait / monitor dispose 准备逻辑。
- 已新增 `src/extensionHost/openCodeSubagentRuntime.ts`，复用 `src/extensionHost/promptExecutionShared.ts` 中已有 `OpenCodeRuntimePreparation` / `PreparedOpenCodeSubagentRuntime` 类型。
- `src/extension.ts` 只保留 `createDisabledOpenCodeSubagentMonitor`、`prepareOpenCodeSubagentRuntime` 的导入与对 `createPromptParallelRuntimeHost`、`createPromptOneShotRuntimeHost` 的显式依赖注入。

### 本轮写入范围

- `implement-cohesive-extraction` 授权写入：`src/extension.ts`、`src/extensionHost/**`；不得修改测试或文档。

### 非目标

- 不替换 VS Code 插件技术栈、构建系统、测试框架或 CLI runner 架构。
- 不改变任何用户可见命令、配置项、面板行为、文案、国际化键或存储格式。
- 不为达成 3000 行数字而搬迁非内聚代码、复制运行规则或引入大而泛的工具模块。
- 不移动 `prepareOpenCodeRuntime`、`runPrompt`、`runLoopPromptOrchestration`、`stopAllRuns`、session persistence wiring、command registration 或 activation/deactivation。
- 不拆分 active run / trace / assistant stream 状态机、Loop main orchestration wrapper、session/workspace/lifecycle 桥接或 host 创建和大依赖注入对象；这些仍属于组合根或依赖面过宽职责。
- 不刷新 generated recall，不写入长期记忆目录，不修改 `.ch/docs/memory/` 或 `.ch/docs/runbooks/PITFALLS.md`。
- 若实现阶段确认没有用户行为变化，不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`；理由是本次只改变内部结构，不新增、删除或调整功能清单中的能力。

### 验收标准

- [x] `src/extension.ts` 基线 6764 行已记录，one-shot 抽取后 6101 行，interactive 抽取后 5092 行。
- [x] 本轮当前基线 5092 行已记录。
- [x] 本轮唯一合理候选已记录：OpenCode subagent runtime 准备逻辑；其余剩余职责给出停止拆分结论。
- [x] 实现节点已采纳候选，`src/extension.ts` 仅保留导入和依赖注入，新 host 使用显式窄类型，不复制业务规则。
- [x] 本轮未走停止抽取路径；剩余停止条件已限定为 OpenCode runtime profile、active run stream、Loop orchestration、session/workspace/lifecycle 桥接和大依赖注入对象等宽职责。
- [x] one-shot 运行时抽取后，OpenCode stream、hidden retry、fresh-session recovery、任务列表、长期记忆、自动压缩、错误提示和 i18n 行为保持不变。
- [x] interactive 运行时抽取后，Codex、Claude、OpenCode runner 事件映射、final answer、hidden retry、tab 状态、session adoption、subagent progress 和 dispose 行为保持不变。
- [x] 新 host 使用可检索的显式依赖类型和输入边界，不新增 `Record<string, any>` 扩散、魔法闭包或同名包装函数自递归。
- [x] `review-extension-boundary` 已通过，确认抽取边界内聚、依赖单向且显式，生命周期、停止和持久化契约保持不变。
- [x] 3000 行以下是目标但非强制验收；当前高于 3000 行，文档已说明继续拆分为何不应按行数硬拆。

### 影响面

- 代码目录：`src/extension.ts`、`src/extensionHost/openCodeSubagentRuntime.ts`，并复用 `src/extensionHost/promptExecutionShared.ts` 中既有窄类型。
- 行为哨兵：`src/test/promptOneShotRuntime.test.ts`、`src/test/promptInteractiveRuntime.test.ts`、`src/test/extensionDeactivateStopAll.test.ts`、`src/test/sessionPersistenceWiring.test.ts`、`src/test/loopPromptQueue.test.ts` 不应因本轮窄抽取发生行为变化。
- 配置与脚本：不计划修改 `package.json`、TypeScript 配置、构建脚本、产品功能清单或 `media/official_skills_catalog.json`。

### 风险与缓解

- 风险：OpenCode subagent server attach / managed startup / ready wait / monitor dispose 迁移遗漏，导致 one-shot 或 parallel run 的 silent progress、subagent connection 或 cleanup 行为回归。
- 缓解：实现节点只移动 `createDisabledOpenCodeSubagentMonitor`、`prepareOpenCodeSubagentRuntime` 这一组内聚逻辑；仍由 `extension.ts` 注入到 `createPromptParallelRuntimeHost` 和 `createPromptOneShotRuntimeHost`。
- 风险：为减少行数继续移动 OpenCode runtime profile、active run stream、Loop orchestration 或 session persistence wiring，造成依赖面扩散或行为回归。
- 缓解：这些职责明确列为非目标；发现必须移动未授权范围或宽职责时返回 `missing_write_scope` 或停止抽取结论。
- 风险：新 host 过宽、复制业务规则、产生反向依赖或宽泛 `Record<string, any>`。
- 缓解：新 host 只接受显式窄接口，复用 shared 类型，评审节点核查依赖方向、类型边界和是否真实降低组合根复杂度。

### 测试与清单同步

- 范围外工作区观察：`package.json` 存在既有版本号 dirty diff（`0.18.5 -> 0.18.6`）；评审未发现其影响入口重构验收，本轮未修改或处理。

### 阶段记录

- 2026-08-02 基线：`src/extension.ts` 6764 行。
- 2026-08-02 one-shot 抽取后：`src/extension.ts` 6101 行，`promptOneShotRuntime.ts` 994 行，`promptExecutionShared.ts` 38 行。
- 2026-08-02 interactive 抽取后：`src/extension.ts` 5092 行，`promptInteractiveRuntime.ts` 1210 行，`promptExecutionShared.ts` 59 行。
- 2026-08-03 本轮审计结论：唯一候选是 OpenCode subagent runtime 准备逻辑；除该候选外，其余剩余职责停止拆分。
- 2026-08-03 OpenCode subagent runtime 抽取后：`src/extension.ts` 4968 行，`openCodeSubagentRuntime.ts` 201 行，`promptOneShotRuntime.ts` 994 行，`promptInteractiveRuntime.ts` 1210 行，`promptExecutionShared.ts` 59 行。
- 2026-08-03 并发工作区变化：范围外提交 `39aa2d9` 在 Loop orchestration 区域净增加 3 行，当前 `src/extension.ts` 为 4971 行；OpenCode subagent 抽取 diff 未被覆盖。
- 3000 行状态：未达到。原因是 `extension.ts` 仍承担组合根、生命周期、Webview/command 路由、Loop/session/model/config host 装配和共享运行状态适配；继续压缩应按这些职责另开节点拆分，不应在本轮为数字目标强搬。

### 任务列表

- [x] 记录 6764 行基线、范围、非目标、风险、验证命令和 3000 行非强制原则。
- [x] 审计当前 `runPromptOneShot`、`runPromptInteractive`、停止路径和可迁移 helper。
- [x] 抽取 one-shot 运行时 host，并记录阶段性 `src/extension.ts` 行数。
- [x] 抽取 interactive 运行时 host，并记录最终 `src/extension.ts` 行数和剩余职责。
- [x] 抽取 OpenCode subagent runtime 准备逻辑。
- [x] 通过 `review-extension-boundary` 后归档执行计划。

### 决策记录

- 2026-08-02：以当前磁盘 `wc -l src/extension.ts` 的 6764 行作为重构基线。
- 2026-08-02：3000 行以下是目标，不是强制验收；最佳实践优先于压行数。
- 2026-08-02：本次只做内部结构重构；无用户行为变化时不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 2026-08-02：`extension.ts` 继续作为组合根，运行时业务逻辑按 one-shot 和 interactive host 分阶段迁移。
- 2026-08-03：本轮最多执行一个窄抽取；若 `OpenCode subagent runtime` 候选复核不成立，则保持源码不变并把停止证据交给后续评审。
- 2026-08-03：`OpenCode subagent runtime` 候选已由实现节点采纳并通过 focused 验证；本轮没有用户可见行为变化，因此不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或兼容入口功能清单。
- 2026-08-03：独立评审和完整单测均通过，本轮到此停止继续拆分；后续只有在出现新的单一内聚职责和独立验收范围时才另开计划，不以 3000 行作为硬指标。
- 2026-08-03：并发提交 `39aa2d9` 与 OpenCode subagent 抽取职责不重叠；当前 4971 行状态复验通过，不回退或吸收该范围外提交。运行时文档中的 4968 行只代表抽取评审快照。

### 当前结论

计划完成并归档。OpenCode subagent runtime 窄抽取将本轮基线5092行降至评审4968行，新host 201行；范围外39aa2d9叠加后4971行，未覆盖本次抽取。入口继续作为组合根，命令、配置、会话、Loop、CLI、停止和持久化行为保持。未达3000行但剩余职责不宜为压行硬拆；专项/全量通过及临时outDir环境失败完整历史验证证据见删除审计，文档4968/4971漂移见关联docs；未执行长期记忆沉淀。

## 分类依据与真实状态

refactor：源文明确命令/Loop/CLI/持久化行为不变，仅内聚抽取；test：原测试适配节点实际新增两组 runtime 测试及迁移 canonical source；docs：原 sync-extension-runtime-docs 节点实际同步三份运行时文档。851/851 与当前产物 852/852 属历史复验，临时 outDir 的74项环境失败、未达3000行及4968/4971漂移不得抹去。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
