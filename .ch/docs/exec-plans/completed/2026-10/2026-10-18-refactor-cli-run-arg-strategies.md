# CLI 启动参数策略化 — 行为保持重构

- 日期：2026-10-18
- 状态：completed
- 负责人：协作
- owner：Loop attempt round-1-cli-run-arg-strategies
- claimed_at：2026-10-18
- claim_ttl：本次尝试
- handoff_to：无
- 类型：refactor

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-cli-run-arg-strategies.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-18-docs-cli-run-arg-strategies.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

以策略表抽取四平台启动 argv，保持参数顺序和导出。仅承担行为保持重构；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的行为保持重构；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-refactor-cli-run-arg-strategies.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- `src/cli/commandRunner.ts` 的 `buildCliArgs` 同时负责基础参数、thinking 参数、模型参数、项目指令隔离、Codex 图片与 `--skip-git-repo-check`、OpenCode variant/auto/run。四个平台的差异写在同一条 if 链里。后续改一个平台时缺少单独入口。

## 目标

- 用与 `src/config/cliRuntimeConfigStrategies.ts` 相同风格的策略注册表集中平台启动参数差异。`commandRunner` 保留兼容外观。任何 CLI 的 argv 不变。

## 范围

- 新增 `src/cli/cliRunArgStrategies.ts`。

- `commandRunner` 把 `buildCliArgs`、`applyOpenCodeVariantArg`、`applyOpenCodeAutoArg`、`buildOpenCodeRunArgs`、`applyProjectInstructionIsolationArgs` 委托或移走，并继续导出前两个函数。

## 非目标

- 不改变 Codex、Claude、OpenCode、Grok 的 argv。

- 不导出、不重命名私有 `RunCliOptions`。`runCli`、`runCliStream`、`captureCliOutput`、OpenCode JSON 解析、进程 spawn 和 kill 留在 `commandRunner.ts`。

- 不改交互轮次策略、`extension.ts`、webview、i18n、功能清单、ontology、Loop/Loop+、配置档案 CRUD。

- 不改 `src/test/cli/commandRunnerCoverage.test.ts` 和 `src/test/cli/opencodeCommandRunner.test.ts` 的既有断言。

- 不把 Grok 交互 stdio 参数移入本策略。`buildGrokAgentStdioArgs` 与 `getGrokCommand` 仍留在 `src/cli/config.ts`。

- 不提交、不更换依赖、不启动真实 CLI，也不做 UI 改动。

## 验收标准

- [x] 四个平台以完整 `Record<CliName, CliRunArgStrategy>` 注册，键恰好是 claude、codex、grok、opencode。

- [x] OpenCode 的 `includeThinkingArgs` 为 false，另外三个为 true。外观只在该标志为 true 且 `thinkingMode` 有值时读取 thinking 参数。

- [x] `buildCliArgs` 的顺序固定：基础参数、thinking、模型、隔离、`applyBeforePrompt`、空 prompt 返回、否则 `appendPrompt`。

- [x] `buildCliArgs` 与 `applyOpenCodeVariantArg` 仍从 `commandRunner` 导出。策略不导入 `commandRunner` 或 `extension.ts`，策略对象不调用 `vscode.workspace`。

- [x] Grok 隔离只追加一次 `--pure`，不追加 `--skip-git-repo-check`。

- [x] 相关构建和指定单测通过，既有断言未改。

## 影响面

- 代码目录：`src/cli/`、`src/test/cli/`。

- 配置与脚本：无。

## 风险与缓解

- 风险：外观选项类型过窄，既有对象字面量调用无法编译。缓解：策略只读取窄字段；`buildCliArgs` 另接受历史调用里的 `openCodeSmallModel`、`openCodeSmallVariant`、`envOverrides`、`cwd`、`processLabel`，但不使用它们。

- 风险：把四个平台揉成带 mode 字符串的一份实现。缓解：每个平台一个工厂函数，注册表没有继承和 DI。

- 回滚：删除新策略模块，把参数分支放回 `commandRunner.buildCliArgs`。无数据迁移。

## 验证计划

- 不适用：真实 CLI、浏览器、全量 `npm run test:unit`。

## 测试与清单同步

- 单元自测结果：见下方最终验证。

- 失败处理记录：第一次 `npm run build` 失败，错误是 `promptOneShotRuntime.ts` 的对象字面量含有 `openCodeSmallVariant`，而当时的 `CliRunArgOptions` 没有该字段，`TS2561`。分类为实现签名过窄，不是断言过期。补上外观输入里的历史可选字段后重跑构建。未改调用方，也未放宽既有测试断言。

- 本次只重排内部入口，argv 不变，不修改 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，也不修改 i18n。

- 概念、所有权、状态和跨域场景没有变化。因此不修改 ontology。

- 不扩写长期记忆。

## 任务列表

- [x] 抽出四个平台的启动参数策略

- [x] 让 commandRunner 委托外观并保留原导出

## 决策记录

- 2026-10-18：采用显式策略注册表，而不是继承、DI 容器或一个 mode 字符串。`getCliArgs`、`getThinkingArgs`、`applyModelArg` 只由 `buildCliArgs` 外观调用。

- 2026-10-18：Codex、Claude、Grok 的 `sessionId` 继续不写入 argv。OpenCode 的 `--session` 仍只在 `appendPrompt` 中按原规则追加。

- 2026-10-18：Grok 交互 stdio 参数不进入本注册表。

## 当前结论

- 策略注册表已经承接四个平台的启动参数差异。`commandRunner` 仍导出 `buildCliArgs` 和 `applyOpenCodeVariantArg`。指定测试已通过。全量单元、真实 CLI 和浏览器验收未执行。

## 最终验证

- 工作目录是 Loop 工作区。`src` 链到仓库源码。`npm run clean` 删除工作区里的 `dist` 符号链接，没有删除 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/dist`。下面的通过结果针对工作区本地重新编译的 `dist`。仓库里原有的 `dist` 没有在本次刷新。

- `npm run build`：通过。tsc 无错误。第一次因外观选项类型过窄失败，补齐历史可选字段后通过。

- `node --test dist/test/cli/cliRunArgStrategies.test.js dist/test/cli/commandRunnerCoverage.test.js dist/test/cli/opencodeCommandRunner.test.js`：88/88 通过。其中新增策略测试 7 项，`commandRunnerCoverage` 17 项，`opencodeCommandRunner` 64 项。

- 未运行：`npm run test:unit`、真实 CLI、浏览器或 Extension Development Host。本任务没有 UI 改动，浏览器验收不适用。

## 未覆盖项

- 进程 spawn、kill、OpenCode JSON 解析和运行时 overlay 没有在新测试里重写；原有 `commandRunnerCoverage` 与 `opencodeCommandRunner` 仍覆盖其中一部分。

- 仓库原 `dist` 与工作区 `dist` 现在是两份构建产物。下次在仓库目录执行测试前需要重新 `npm run build`。
