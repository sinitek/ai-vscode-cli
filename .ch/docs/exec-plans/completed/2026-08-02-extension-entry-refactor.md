# extension.ts 入口运行时重构计划

- 日期：2026-08-02
- 状态：completed
- 负责人：Graph `summary-extension-refactor`
- owner：graph_msg_1785741214299_b4e1e4b93c393
- claimed_at：2026-08-03T15:36:41+08:00
- completed_at：2026-08-03T16:50:13+08:00
- claim_ttl：已完成并归档
- previous_owner：graph_msg_1785683322596_8d0486c3981e8（status=`needs-review`，`review-extension-refactor` 2/2 failed，running nodes=none；旧 claim 已失效）
- handoff_to：无

## 背景

用户目标是继续重构 `src/extension.ts`，尝试把文件压到 3000 行以下；但 3000 行只是期望指标，不是硬性成功条件。历史基线为 `wc -l src/extension.ts` 输出的 6764 行；one-shot 与 interactive runtime 抽取后，本轮实施前基线为 `wc -l src/extension.ts` 输出的 5092 行；OpenCode subagent runtime 抽取和评审时为 4968 行。

本计划继续作为唯一 active 执行计划使用，不创建重复计划。旧 owner `graph_msg_1785683322596_8d0486c3981e8` 对应 Graph run 当前为 `needs-review`，无 running 节点，且 `review-extension-refactor` 已 2/2 failed；按原 `claim_ttl` 的 Graph run 生命周期语义，旧 claim 已失效，本轮由 `graph_msg_1785741214299_b4e1e4b93c393` 接管。

本次仍是内部结构重构：保持 VS Code 插件已有命令、面板、CLI runner、Graph/Loop、会话持久化、停止/清理、trace、i18n 和错误提示行为不变，仅调整 extension 入口与运行时 host 的代码边界。

截至 2026-08-03 `sync-extension-runtime-docs` 节点，one-shot、interactive 和 OpenCode subagent runtime 已迁入 `src/extensionHost/`，`src/extension.ts` 当前为 4968 行，低于 6764 行历史基线和 5092 行本轮基线，但未达到 3000 行。剩余体量主要是组合根、Graph/Loop/session/model/config 装配和共享生命周期适配；继续拆分应作为后续独立职责重构推进，不能为了行数迁移非内聚代码。

收束节点执行期间，另一个工作流提交了 `39aa2d9`（`fix loop max rounds resume limit`），在 `src/extension.ts` 的 Loop orchestration 区域净增加 3 行，未覆盖 OpenCode subagent runtime 抽取 diff。当前工作区因此为 4971 行；4968 行仍是本次抽取本身通过 focused 验证和独立评审时的结果。

本轮上游审计只推荐一个合理窄候选：把 `src/extension.ts:3453-3588` 附近的 OpenCode subagent server/monitor 准备逻辑迁入 `src/extensionHost/openCodeSubagentRuntime.ts`，并继续由 `extension.ts` 作为组合根导入、注入到 one-shot 与 parallel prompt runtime host。实现节点已采纳该候选；除该候选外，OpenCode runtime profile、active run stream、Loop orchestration、session/workspace/lifecycle 桥接和 host 创建大依赖注入对象均因依赖面过宽或属于组合根职责而停止拆分。

## 目标

- 本轮仅评估并执行一个内聚候选：OpenCode subagent runtime 准备逻辑抽取；实现节点已确认候选成立并完成迁移。
- 保持 `extension.ts` 为组合根：只负责导入、显式装配、路由和必要生命周期适配，不把剩余入口整体搬进另一个大文件。
- 保持现有用户行为不变，并通过 focused 构建、契约测试、运行时测试和评审确认无行为回归。
- 记录本轮抽取前后的 `src/extension.ts` 和目标 host 行数；5092 行是本轮实施前基线，4968 行是 focused 验证后的抽取结果，收束时叠加范围外提交后的当前值为 4971 行，3000 行以下不是强制验收。
- 保留历史记录：one-shot 与 interactive runtime 已完成抽取，相关行数、测试和文档结果继续作为背景证据。

## 范围

- `src/extension.ts:3453-3588` 附近的 OpenCode subagent server attach / managed startup / ready wait / monitor dispose 准备逻辑。
- 已新增 `src/extensionHost/openCodeSubagentRuntime.ts`，复用 `src/extensionHost/promptExecutionShared.ts` 中已有 `OpenCodeRuntimePreparation` / `PreparedOpenCodeSubagentRuntime` 类型。
- `src/extension.ts` 只保留 `createDisabledOpenCodeSubagentMonitor`、`prepareOpenCodeSubagentRuntime` 的导入与对 `createPromptParallelRuntimeHost`、`createPromptOneShotRuntimeHost` 的显式依赖注入。
- 迁移后同步相关契约测试的 canonical source，避免测试继续读取旧的 `extension.ts` 文本切片。
- 更新运行时边界文档和本执行计划的阶段记录。

## 本轮写入范围

- `update-extension-exec-plan` 授权写入：`.ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md`。
- `implement-cohesive-extraction` 授权写入：`src/extension.ts`、`src/extensionHost/**`；不得修改测试或文档。
- `adapt-extension-contract-tests` 授权写入：`src/test/**`；不得越权修改实现。
- `test-focused-extension-refactor` 授权写入：`dist/**`；不得修改 `src` 源码或测试。
- `sync-extension-runtime-docs` 授权写入：`ARCHITECTURE.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md` 和本计划。

## 非目标

- 不替换 VS Code 插件技术栈、构建系统、测试框架或 CLI runner 架构。
- 不改变任何用户可见命令、配置项、面板行为、文案、国际化键或存储格式。
- 不为达成 3000 行数字而搬迁非内聚代码、复制运行规则或引入大而泛的工具模块。
- 不移动 `prepareOpenCodeRuntime`、`runPrompt`、`runLoopPromptOrchestration`、`stopAllRuns`、session persistence wiring、Graph controls/runtime wrappers、command registration 或 activation/deactivation。
- 不拆分 active run / trace / assistant stream 状态机、Loop main orchestration wrapper、session/workspace/lifecycle 桥接或 host 创建和大依赖注入对象；这些仍属于组合根或依赖面过宽职责。
- 不刷新 generated recall，不写入长期记忆目录，不修改 `.ch/docs/memory/` 或 `.ch/docs/runbooks/PITFALLS.md`。
- 若实现阶段确认没有用户行为变化，不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`；理由是本次只改变内部结构，不新增、删除或调整功能清单中的能力。

## 验收标准

- [x] `src/extension.ts` 基线 6764 行已记录，one-shot 抽取后 6101 行，interactive 抽取后 5092 行。
- [x] 本轮当前基线 5092 行已记录，并确认旧 Graph claim `graph_msg_1785683322596_8d0486c3981e8` 已失效。
- [x] 本轮唯一合理候选已记录：OpenCode subagent runtime 准备逻辑；其余剩余职责给出停止拆分结论。
- [x] 实现节点已采纳候选，`src/extension.ts` 仅保留导入和依赖注入，新 host 使用显式窄类型，不复制业务规则。
- [x] 本轮未走停止抽取路径；剩余停止条件已限定为 OpenCode runtime profile、active run stream、Loop orchestration、session/workspace/lifecycle 桥接和大依赖注入对象等宽职责。
- [x] one-shot 运行时抽取后，OpenCode stream、hidden retry、fresh-session recovery、任务列表、长期记忆、自动压缩、错误提示和 i18n 行为保持不变。
- [x] interactive 运行时抽取后，Codex、Claude、OpenCode runner 事件映射、final answer、hidden retry、tab 状态、session adoption、subagent progress 和 dispose 行为保持不变。
- [x] 新 host 使用可检索的显式依赖类型和输入边界，不新增 `Record<string, any>` 扩散、魔法闭包或同名包装函数自递归。
- [x] 契约测试 canonical source 从旧 `extension.ts` 切片迁移到对应 runtime 文件，同时保留 extension host 装配断言。
- [x] `npm run build`、focused runtime/contract tests、CodeGraph affected 相关契约/入口测试、`git diff --check` 和行数检查的结果已记录。
- [x] 当前 Graph 的 `npm run test:unit` 退出码 0，TAP 汇总 851/851 通过，0 失败、0 跳过、0 todo。
- [x] `review-extension-boundary` 已通过，确认抽取边界内聚、依赖单向且显式，生命周期、停止和持久化契约保持不变。
- [x] 收束期间并发提交后，当前源码 4971 行、新 host 201 行；`npx tsc -p ./ --noEmit` 和只读 `node --test` 均退出码 0，当前构建产物 852/852 通过。
- [x] 3000 行以下是目标但非强制验收；当前高于 3000 行，文档已说明继续拆分为何不应按行数硬拆。

## 影响面

- 代码目录：`src/extension.ts`、`src/extensionHost/openCodeSubagentRuntime.ts`，并复用 `src/extensionHost/promptExecutionShared.ts` 中既有窄类型。
- 测试目录：`src/test/opencodeCommandRunner.test.ts` 和 `src/test/extensionHostExtractionContracts.test.ts` 已迁移 OpenCode subagent canonical source，并保留 `extension.ts` host 装配断言。
- 行为哨兵：`src/test/promptOneShotRuntime.test.ts`、`src/test/promptInteractiveRuntime.test.ts`、`src/test/extensionDeactivateStopAll.test.ts`、`src/test/sessionPersistenceWiring.test.ts`、`src/test/loopPromptQueue.test.ts`、`src/test/graphExtensionRuntime.test.ts` 不应因本轮窄抽取发生行为变化。
- 文档目录：`sync-extension-runtime-docs` 已同步 `ARCHITECTURE.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md` 和本计划。
- 配置与脚本：不计划修改 `package.json`、TypeScript 配置、构建脚本、产品功能清单或 `media/official_skills_catalog.json`。

## 风险与缓解

- 风险：OpenCode subagent server attach / managed startup / ready wait / monitor dispose 迁移遗漏，导致 one-shot 或 parallel run 的 silent progress、subagent connection 或 cleanup 行为回归。
- 缓解：实现节点只移动 `createDisabledOpenCodeSubagentMonitor`、`prepareOpenCodeSubagentRuntime` 这一组内聚逻辑；仍由 `extension.ts` 注入到 `createPromptParallelRuntimeHost` 和 `createPromptOneShotRuntimeHost`。
- 风险：`opencodeCommandRunner.test.ts` 仍把 `startOpenCodeServer`、`waitForOpenCodeServerReady`、`resolveOpenCodeSubagentConnection(getCliArgs("opencode")` 作为 `extension.ts` canonical source，合法迁移后造成 stale contract 误报。
- 缓解：契约适配节点已将相关 source 断言迁到 `src/extensionHost/openCodeSubagentRuntime.ts`，同时保留 `extension.ts` 对 one-shot / parallel prompt runtime host 的注入断言。
- 风险：为减少行数继续移动 OpenCode runtime profile、active run stream、Loop orchestration 或 session persistence wiring，造成依赖面扩散或行为回归。
- 缓解：这些职责明确列为非目标；发现必须移动未授权范围或宽职责时返回 `missing_write_scope` 或停止抽取结论。
- 风险：新 host 过宽、复制业务规则、产生反向依赖或宽泛 `Record<string, any>`。
- 缓解：新 host 只接受显式窄接口，复用 shared 类型，评审节点核查依赖方向、类型边界和是否真实降低组合根复杂度。
- 当前未决风险：无功能或测试 blocker；`review-extension-boundary` 已完成生命周期、依赖方向、显式依赖和剩余组合根职责核查，未要求返工。非阻断文档漂移是 `ARCHITECTURE.md` 和 `.ch/docs/design-docs/vscode-cli-extension-runtime.md` 仍记录评审快照 4968 行，尚未反映范围外提交后的当前 4971 行；这两个文件不在 summary 节点写入范围内。

## 验证计划

- 最小相关验证：
  - `wc -l src/extension.ts src/extensionHost/promptOneShotRuntime.ts src/extensionHost/promptInteractiveRuntime.ts src/extensionHost/promptExecutionShared.ts`
  - `wc -l src/extension.ts src/extensionHost/openCodeSubagentRuntime.ts src/extensionHost/promptExecutionShared.ts`
  - `git diff --check -- src/extension.ts src/extensionHost .ch/docs/exec-plans/active/2026-08-02-extension-entry-refactor.md`
- 单元自测命令：
  - `npm run build`
  - `npm run build && node --test dist/test/opencodeCommandRunner.test.js dist/test/extensionHostExtractionContracts.test.js dist/test/promptOneShotRuntime.test.js dist/test/promptInteractiveRuntime.test.js`
  - `npm run build && node --test dist/test/extensionDeactivateStopAll.test.js dist/test/sessionPersistenceWiring.test.js dist/test/loopPromptQueue.test.js dist/test/graphExtensionRuntime.test.js`
- 扩展验证：
  - `npm run test:unit`

## 测试与清单同步

- 单元测试新增/更新：`adapt-one-shot-contract-tests` 新增 `promptOneShotRuntime.test.ts` 并迁移 one-shot canonical source；`adapt-interactive-contract-tests` 新增 `promptInteractiveRuntime.test.ts` 并迁移 interactive canonical source。
- 本轮测试适配：`adapt-extension-contract-tests` 已把 OpenCode subagent server/monitor canonical source 从 `extension.ts` 迁到 `src/extensionHost/openCodeSubagentRuntime.ts`，并保留入口 host 注入断言；新增覆盖 configured attach、managed server、disabled monitor、幂等 dispose 和启动失败清理路径。
- 单元自测结果：`test-one-shot-runtime` 记录 `npm run build` 退出码 0，one-shot focused tests 65/65 通过；`test-interactive-runtime` 记录 `npm run build` 退出码 0，one-shot/interactive host、OpenCode、deactivate、session persistence、Graph runtime 与 Loop queue focused tests 86/86 通过，`git diff --check` 退出码 0；本轮 `test-focused-extension-refactor` 记录 `npm run build` 退出码 0，focused OpenCode subagent tests 64/64 通过，CodeGraph affected + 补充入口测试 148/148 通过，`git diff --check` 退出码 0。
- 失败处理记录：当前 Graph 的计划节点中，build、focused、affected/入口和全量验证均退出码 0，没有 `implementation_defect`、`stale_test_contract`、`missing_write_scope` 或范围外测试失败需要遗留；Graph events 中也没有 failed、blocked、stopped 或 skipped 节点。收束节点另行把当前源码编译到系统临时 outDir 后运行全量测试，因临时目录无法解析仓库 `cross-spawn`、`@dagrejs/dagre` 和 `media/` 相对路径而退出码 1（688 tests，614 pass，74 fail），分类为 `environment_failure`；改用已确认包含 OpenCode host 与并发 Loop 提交的当前仓库构建产物只读复跑后，852/852 通过。
- 完整单测结果：`test-unit-full` 记录 `npm run test:unit` 退出码 0，TAP 汇总 851/851 通过，0 失败、0 跳过、0 todo。
- 收束后验证：`npx tsc -p ./ --noEmit` 退出码 0；focused OpenCode tests 64/64 通过；当前仓库构建产物的 `node --test` 退出码 0，852/852 通过，覆盖并发提交新增的 Loop max-rounds 用例。
- 功能清单：本次实现保持用户行为不变，仅调整内部结构和测试 canonical source；因此继续不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或兼容入口功能清单。
- 相关文档同步：`sync-extension-runtime-docs` 已同步 `ARCHITECTURE.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md` 和本计划中的组合根与 host 边界、最终行数、focused 验证结果和停止条件。
- 范围外工作区观察：`package.json` 存在既有版本号 dirty diff（`0.18.5 -> 0.18.6`）；评审未发现其由本 Graph 节点链产生或影响入口重构验收，本轮未修改或处理。

## 阶段记录

- 2026-08-02 基线：`src/extension.ts` 6764 行。
- 2026-08-02 one-shot 抽取后：`src/extension.ts` 6101 行，`promptOneShotRuntime.ts` 994 行，`promptExecutionShared.ts` 38 行。
- 2026-08-02 interactive 抽取后：`src/extension.ts` 5092 行，`promptInteractiveRuntime.ts` 1210 行，`promptExecutionShared.ts` 59 行。
- 2026-08-03 文档同步时当前行数：`src/extension.ts` 5092 行，`promptOneShotRuntime.ts` 994 行，`promptInteractiveRuntime.ts` 1210 行，`promptExecutionShared.ts` 59 行。
- 2026-08-03 本轮 Graph 接管：旧 owner `graph_msg_1785683322596_8d0486c3981e8` 为 `needs-review` 且无 running 节点；当前 owner `graph_msg_1785741214299_b4e1e4b93c393` 基于 5092 行继续。
- 2026-08-03 本轮审计结论：唯一候选是 OpenCode subagent runtime 准备逻辑；除该候选外，其余剩余职责停止拆分。
- 2026-08-03 OpenCode subagent runtime 抽取后：`src/extension.ts` 4968 行，`openCodeSubagentRuntime.ts` 201 行，`promptOneShotRuntime.ts` 994 行，`promptInteractiveRuntime.ts` 1210 行，`promptExecutionShared.ts` 59 行。
- 2026-08-03 focused 验证：`npm run build` 退出码 0；OpenCode subagent focused tests 64/64 通过；CodeGraph affected + 补充入口测试 148/148 通过；`git diff --check` 退出码 0。
- 2026-08-03 完整验证：`npm run test:unit` 退出码 0，851/851 通过；独立评审复跑 `npx tsc -p ./ --noEmit`、64/64 focused tests、148/148 affected + 入口测试和 scoped `git diff --check`，均退出码 0。
- 2026-08-03 并发工作区变化：范围外提交 `39aa2d9` 在 Loop orchestration 区域净增加 3 行，当前 `src/extension.ts` 为 4971 行；OpenCode subagent 抽取 diff 未被覆盖。
- 2026-08-03 收束验证：当前源码 `tsc --noEmit` 通过，OpenCode focused tests 64/64 通过，当前构建产物全量 852/852 通过；临时 outDir 全量测试的 74 个模块/资源定位失败已分类为环境失败，不是实现缺陷。
- 2026-08-03 收束：当前 Graph 除 summary 外的所有节点均 passed，`review-extension-boundary` 未要求返工，执行计划归档到 `completed/`；两份运行时文档中的 4968 行评审快照作为非阻断数字漂移留待拥有对应写权限的后续任务同步。
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
- [x] 记录上一轮完整单元测试结果。
- [x] 核对旧 Graph claim 失效，并用当前 Graph 更新本 active 执行计划。
- [x] 抽取 OpenCode subagent runtime 准备逻辑。
- [x] 适配 OpenCode subagent canonical source 与入口 host 装配契约测试。
- [x] 运行 focused 构建、契约测试、行为哨兵测试、行数检查和 `git diff --check`。
- [x] 同步运行时边界文档和本计划的本轮最终行数、验证结果与停止条件。
- [x] 记录当前 Graph `test-unit-full` 节点的 851/851 完整单测结果。
- [x] 核对收束期间并发提交，并在当前 4971 行源码上完成类型检查、focused 和 852/852 全量只读复验。
- [x] 通过 `review-extension-boundary` 后归档执行计划。

## 决策记录

- 2026-08-02：以当前磁盘 `wc -l src/extension.ts` 的 6764 行作为重构基线。
- 2026-08-02：3000 行以下是目标，不是强制验收；最佳实践优先于压行数。
- 2026-08-02：本次只做内部结构重构；无用户行为变化时不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 2026-08-02：`extension.ts` 继续作为组合根，运行时业务逻辑按 one-shot 和 interactive host 分阶段迁移。
- 2026-08-03：文档同步确认当前 `extension.ts` 4968 行，未达 3000 行但符合最佳实践边界；功能清单无需更新，因为没有用户可见行为变化。
- 2026-08-03：旧 Graph claim 已失效，本计划不新建重复文件，由当前 Graph `update-extension-exec-plan` 接管。
- 2026-08-03：本轮最多执行一个窄抽取；若 `OpenCode subagent runtime` 候选复核不成立，则保持源码不变并把停止证据交给后续评审。
- 2026-08-03：`OpenCode subagent runtime` 候选已由实现节点采纳并通过 focused 验证；本轮没有用户可见行为变化，因此不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或兼容入口功能清单。
- 2026-08-03：独立评审和完整单测均通过，本轮到此停止继续拆分；后续只有在出现新的单一内聚职责和独立验收范围时才另开计划，不以 3000 行作为硬指标。
- 2026-08-03：并发提交 `39aa2d9` 与 OpenCode subagent 抽取职责不重叠；当前 4971 行状态复验通过，不回退或吸收该范围外提交。运行时文档中的 4968 行只代表抽取评审快照。

## 当前结论

计划完成并归档。本轮只实施了审计证明合理的 OpenCode subagent runtime 窄抽取：`src/extension.ts` 从本轮基线 5092 行降至评审时 4968 行，新 host 为 201 行；入口继续作为组合根，命令、配置、会话、Graph/Loop、CLI、i18n、存储、停止和持久化行为不变。收束期间范围外提交 `39aa2d9` 在 Loop orchestration 区域净增加 3 行，使当前工作区为 4971 行，但未覆盖本次抽取。Graph 原验证的 `npm run build`、64/64 focused tests、148/148 affected + 入口测试、`git diff --check` 和 851/851 全量单测均通过；叠加并发提交后又通过 `tsc --noEmit`、64/64 focused tests 和当前构建产物 852/852 全量只读复验。3000 行目标未达到，但剩余职责属于组合根、共享状态桥接或依赖面过宽边界，继续为行数拆分不合理；功能和测试无未决事项，仅有两份运行时文档仍保留 4968 行评审快照的非阻断数字漂移，本节点未执行长期记忆沉淀。
