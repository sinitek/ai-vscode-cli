# CLI 模型选择策略注册表

- 日期：2026-10-22
- 状态：completed
- 负责人：协作
- owner：refactor-cli-model-selection-strategies-20261022
- claimed_at：2026-10-22
- claim_ttl：本轮 attempt
- handoff_to：主任务

## 背景

`modelSettings.ts` 在读取普通选择、main/subtask 角色选择、候选列表和持久化键时反复区分 Grok 与其他 CLI。候选比较已经完成：`panelDiagnostics.ts` 职责混杂，但单纯拆文件收益有限；prompt runtime 已有 Template Method，重写风险较高。本次选定模型选择。任务给出的 decision-model confidence 为 0.92。本轮不再重新选题，也没有再次调用决策模型。

## 目标

用轻量、类型安全的 Strategy 注册表收拢四个 CLI 的模型选择差异，保持现有行为、公开宿主 API 和持久化 schema。

## 范围

- 新增 `src/extensionHost/cliModelSelectionStrategies.ts`，导出 `CliModelSelectionStrategy` 与 `createCliModelSelectionStrategies`。
- `createModelSettingsHost` 的模型读取、角色读取、候选、可管理候选、普通/角色选择、展示名，以及 Loop 思考力度的存储键解析，改为委托该注册表。
- 补充策略单测和宿主集成回归。
- 在 `ARCHITECTURE.md` 记录边界。
- 因实现路径新增，把新模块补进 `plugin.config_profile` 的 `source_refs` 与 `implementation_paths`。

## 非目标

- 不改变 UI、文案、交互或用户可见模型选择。
- 不改 `modelSelectionStore` 导出 API，不重写 add/rename/delete/move。
- 不把思考力度归一化、Grok 读盘刷新、运行前复核或 PanelState 错误文案搬进策略。
- 不引入类继承、依赖注入框架或模块级可变策略状态。
- 不修改用户配置、凭据、Loop 调度状态，不提交 git。
- 不重建 CodeGraph 索引，不更新 `FEATURE_INVENTORY.md` 或 `ROLLING_SUMMARY.md`。
- 不修复与本次行为保持无关的历史失败。

## 验收标准

- [x] 注册表编译期覆盖 `codex` / `claude` / `opencode` / `grok`。
- [x] Codex、Claude、OpenCode 委托现有 store 函数；Claude 仍没有插件侧模型管理；OpenCode main/subtask 与 primary/small 仍走原 store。
- [x] Grok 候选只来自注入的原始 config id 缓存，managed 恒为空，选择值是配置表键，相同展示名不合并。
- [x] null/undefined config id 的持久化键只通过注入 resolver 生成；策略不复制 `GROK_HOME` 路径规则。
- [x] 宿主仍负责写盘，选择操作各调用一次 `writeModelStore`。
- [x] `npm run build` 通过。新增策略测试通过。已记录两处历史失败，未改断言。

## 影响面

- 代码目录：`src/extensionHost/modelSettings.ts`、`src/extensionHost/cliModelSelectionStrategies.ts`、`src/test/extensionHost/cliModelSelectionStrategies.test.ts`
- 文档目录：`ARCHITECTURE.md`、本计划、`.ch/docs/ontology/domains/cli-plugin-runtime.json`
- 配置与脚本：无

## 风险与缓解

- 风险：Grok 失效角色选择若改成回退普通选择，会改变现有 resolver 行为。
- 缓解：缺失角色仍用 `stored ?? 普通选择` 再交给 `resolveGrokConfigModel`；已保存但失效的角色值原样进入同一 resolver。
- 风险：工厂捕获 store 或缓存快照会让 `syncFromDeps`、异步刷新和多 host 串扰。
- 缓解：每次操作传入当前 store；缓存与缺省键都是调用时执行的注入函数。
- 风险：统一接口让 Claude 获得模型管理。
- 缓解：Claude 策略只调用现有 store 函数，store 对 Claude 仍返回空选择。

## 验证计划

- 最小相关验证：`npm run build`，再运行下方单测命令。
- 单元自测命令：见「测试与清单同步」。
- 扩展验证：无新的可启动产物。不启动真实 CLI、外部服务或扩展宿主。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/extensionHost/cliModelSelectionStrategies.test.ts`。未改 `grokConfigModels.test.ts` 的既有断言。
- 单元自测结果：
  - `npm run build`：最终通过（exit 0）。此前两次失败是新测试的 TypeScript 语法和 OpenCode `small` 角色类型，已在测试内修正后重编通过。
  - `node --test dist/test/extensionHost/cliModelSelectionStrategies.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/cli/grokmodelselection.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/extensionHost/opencodethinkingrefreshstate.test.js dist/test/loop/subtaskCliRoute.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js`
  - 结果：48 项，46 通过，2 失败。新策略文件 10 项全部通过。
  - `git diff --check`：通过，无空白错误。
  - ontology `--validate` 通过；ontology unittest 9 项通过。
- 失败处理记录：
  - `grokConfigModels.test.ts` 的 `getSelectedCliModel("grok", null) === "updated"`：改代码前在干净工作区已失败，现象同为 `null !== 'updated'`。`refreshGrokConfigModels` 在 config id 为空时直接返回，null 缓存没有模型，选择因此落成空字符串。该断言与「刷新触发条件保持原样、缓存按原始 config id 查询」冲突。分类为历史失败，不改断言，不改刷新条件。
  - `extensionHostExtractionContracts.test.ts` 期望 `await runPromptOneShot(promptInput, target, executionOptions);`。当前 `src/extension.ts:5245` 是 `attemptInput, attemptTarget`。本次 diff 不包含 `extension.ts`。分类为历史/范围外失败。
- 功能清单：行为保持，终端可见的模型下拉、展示名、managed 列表、刷新和持久化都没有变化。`FEATURE_INVENTORY.md` 无需更新。
- 相关文档同步：`ARCHITECTURE.md` 已记录策略边界。ontology 只补充新实现路径。未写 `ROLLING_SUMMARY.md`。

## 任务列表

- [x] 核对架构、规格 4.8、Grok Build 参考、现有宿主与 `cliRuntimeConfigStrategies` 风格
- [x] 用 ontology status-report 和 `plugin.config_profile` 核对 source_refs；CodeGraph 仅作导航，磁盘代码为准
- [x] 新增策略注册表并改宿主委托
- [x] 补充策略与宿主回归测试
- [x] 构建、相关测试、空白检查和 ontology 校验
- [x] 归档本计划

## 决策记录

- 2026-10-22：采用函数式 `Record<CliName, CliModelSelectionStrategy>`，不用抽象基类。Grok 规则留在 Grok 策略；另外三个 CLI 共用 store-backed 工厂。
- 2026-10-22：缺省 Grok 存储键由宿主在操作时调用 `resolveGrokConfigPath()` 注入，策略不硬编码路径。
- 2026-10-22：历史失败不在本次修复。

## 当前结论

行为保持的策略委托已落地。新测试和其余相关回归通过。两处失败有改代码前或未改文件的证据，保持原断言。没有启动扩展。

上面这一节是重构落地当时的结论。当时的 46/48 是真实结果，不能改写成当时已经通过。下面一节记录主审核验之后的验收修复。

## 主审核验与验收修复

- 日期：2026-10-22
- 范围：只修验收测试的夹具和结构断言。不改生产 TypeScript，不改 UI、CLI 协议、持久化 schema 或用户可见行为。

主审已核对策略实现边界符合原合同，并重新执行 `npm run build` 成功。指定的 8 个测试文件仍是 48 项、46 通过、2 失败，所以上一阶段不能完成验收。本轮先在未改测试源码的 `dist` 上复现这两处失败，再按当前源码修测试。

复现命令：

`node --test dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js`

结果：15 项，13 通过，2 失败。

- `grokConfigModels.test.js`：`getSelectedCliModel("grok", null)` 为 `null`，期望 `'updated'`。
- `extensionHostExtractionContracts.test.js`：全文件匹配不到 `await runPromptOneShot(promptInput, target, executionOptions);`。

决策模型辅助分类（`decision-model-preview`，request `04221a29-d2f9-9d65-bbac-88ee5fffc5af`）：

- 第一处选择 `implementation_defect`，confidence 0.38，低于 0.5，建议人工复核。磁盘上的 `refreshGrokConfigModels` 在解析出的 config id 为空时直接返回，不读盘、不写 null 缓存。这是既定合同，不能改刷新条件，也不能让策略拿合成键查缓存。失败原因是夹具把 `getWorkspacePreferredConfigIdForCli` 固定成 `"profile"`，无档案选择没有经过 `resolveGrokModelForRun` 建立 null 缓存。不采用该低置信度分类。
- 第二处选择 `stale_structural_assertion`，confidence 0.86。人工核对 `src/extension.ts` 约 5238–5246 行：外层 `promptAutoRepairController.run(promptInput, target, { execute })` 收到原始参数；`execute` 回调里的 interactive、parallel、one-shot 都把 `attemptInput`、`attemptTarget`、`executionOptions` 传给对应运行时，parallel 判断使用 `attemptTarget.tabId`。本次重构没有修改 `extension.ts`。结构断言改为只检查这段回调，不把调用改回旧形状。

修复：

- `grokConfigModels.test.ts`：preferred config id 可切换。切到 `null` 且 heartbeat 不提供档案时，`getActiveConfigIdForCli("grok")` 为 null；`refresh(null)` 不增加 `readGrokConfigText` 次数，未加载时普通和角色选择仍为空。随后 `resolveGrokModelForRun("updated")` 再读当前有效配置，并按 null 活跃 id 写入 null 缓存。普通选择与 main/subtask 选择仍断言为 `"updated"`。持久化键是 ``grok:${resolveGrokConfigPath()}``，不是 `"null"`，也不写死路径；已有 `profile` 的普通选择和角色选择不被覆盖。进入非法配置和空配置前恢复 `"profile"`。读取次数按步骤断言：无档案刷新前的次数、刷新后不变、`resolveGrokModelForRun` 后加 1，最终为该基线再加 5。没有删除读取次数断言，也没有直接写内部 null 缓存。
- `extensionHostExtractionContracts.test.ts`：保留 runtime 工厂导入、装配、Loop 委托，以及禁止重新内联 `runPromptInteractive` 的断言。旧的两条全文件调用断言改为上述 auto-repair `execute` 片段内的三条运行时传参断言。

`FEATURE_INVENTORY.md` 不更新。本次只修验收测试，宿主选择、刷新条件和用户可见行为都没有变。不写 `ROLLING_SUMMARY.md`，不扩写根 `AGENTS.md`，不改 ontology。

## 验收修复后的验证

修复后实际执行：

- `npm run build`：通过，exit 0。
- `node --test dist/test/extensionHost/cliModelSelectionStrategies.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/cli/grokmodelselection.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/extensionHost/opencodethinkingrefreshstate.test.js dist/test/loop/subtaskCliRoute.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js`
  - 结果：48 项，48 通过，0 失败。exit 0。duration_ms 272.407125。
- `git diff --check`：通过，exit 0。在真实仓库 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli` 重跑同样通过。本轮 symlink 工作区里的 `git status` 会把符号链接工作树误看成整仓删除，不以那份状态作为改动清单。

上一阶段 46/48 仍然有效，表示修复前的结果。修复后的指定组合是 48/48。验收结论：夹具和结构断言已按当前宿主合同与 `extension.ts` 调用链对齐，指定测试全部通过，生产行为未改。没有启动真实 CLI、扩展宿主或浏览器。没有新增可启动产物，artifacts 不适用。未跑全仓 `npm run test:unit`，也未做 ontology 校验，因为本轮没有改 ontology。
