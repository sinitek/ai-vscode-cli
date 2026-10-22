# 交互 Runner 生命周期策略化

- 日期：2026-10-22
- 状态：completed
- 负责人：协作
- owner：Loop attempt round-1-refactor-interactive-runner-lifecycle
- claimed_at：2026-10-22
- claim_ttl：本次尝试
- handoff_to：无

## 背景

`src/interactive/manager.ts` 同时负责 Codex、Claude、Grok 的构造、复用判断、`setRunner` 元数据和共享 Map / idle timer。三个平台的差异写进同一类的分支里，改一处复用规则就要碰缓存、释放和定时器。`configService` 与 `commandRunner` 已有 `cliRuntimeConfigStrategies`、`cliRunArgStrategies`，不再重复抽取。

选题依据：主审比较候选后指定交互 Runner 生命周期。decision-model 对 `runner_lifecycle` 的分类只作为选题辅助（confidence=0.85），不是实现或验收证据。

已核对事实来源：

- Ontology `plugin.local_cli`、`plugin.cli_session` 的 `source_refs` 指向 `.ch/docs/references/cli-runtime-reference.md`、`ARCHITECTURE.md` 和 `src/interactive/`。本次不改变会话所有权、续接状态机或来源路径。
- `ARCHITECTURE.md` 引用的 `.ch/docs/design-docs/vscode-cli-extension-runtime.md` 在磁盘上不存在。运行事实以 `.ch/docs/references/cli-runtime-reference.md` 为准，不重建缺失设计文档。
- CodeGraph 索引有待同步文件和未解析引用。调用边界以直接搜索为准：`src/extension.ts`、`src/extensionHost/interactiveTurnCodex.ts`、`interactiveTurnClaude.ts`、`interactiveTurnGrok.ts`、`promptInteractiveRuntime.ts`、`src/contextCompactionRunner.ts`。

## 目标

保持 `InteractiveRunnerManager` 公开 Facade。用显式、类型完整的 Codex / Claude / Grok 策略表隔离平台差异，由 Manager 唯一执行查找、复用或先释放再创建、注册和 touch。

## 范围

- `src/interactive/manager.ts`
- `src/interactive/runnerLifecycleTypes.ts`
- `src/interactive/runnerLifecycleStrategies.ts`
- `src/test/interactive/manager.test.ts`
- `src/test/interactive/runnerLifecycleStrategies.test.ts`
- `ARCHITECTURE.md`
- `.ch/docs/references/cli-runtime-reference.md`
- 本执行计划

## 非目标

- 不新增依赖，不调整技术栈，不改 UI、CLI 协议、会话持久化、Loop/Graph 调度或 runner 底层进程。
- 不改其它功能的策略模块。
- 不引入继承层级、DI 容器、事件总线或通用插件框架。
- 不把 Grok `sessionId.trim()` 推广到其它方法，不规范化 command、cwd 或路径分隔符。
- 不修改 Loop+ 任务记录、active ids、调度状态、loopPlus 快照或其它 attempt 报告。
- 不提交 git，不创建分支，不清理用户数据，不改写真实 CLI 配置。
- 不更新 `FEATURE_INVENTORY.md`：用户可见行为保持不变。若实现中发现必须改变用户契约，停止扩大范围并在报告中说明。
- 不把自动任务记录写入 `ROLLING_SUMMARY.md`。语义和来源映射无变化时不改 ontology。
- 不重建缺失的 `vscode-cli-extension-runtime.md`。

## 验收标准

- [x] `InteractiveRunnerManager` 仍从 `src/interactive/manager.ts` 导出，公开方法名、参数含义、同步返回类型和无参构造保持兼容。
- [x] 三个 `getOrCreate*` 委托同一个查找 → 判断复用 → 更新或先释放再创建 → 注册 → touch 流程。
- [x] 策略负责请求规范化、创建、复用判断、复用更新、`setRunner` 元数据和停止动作；不另建缓存、定时器，也不自行回收 Map 中的 entry。
- [x] 策略模块运行时不导入 manager。
- [x] 下列兼容契约有行为测试，且不删除或弱化 `codexThreadSelection.test.ts`、`grokRunner.test.ts`、`grokCliHostWire.test.ts` 的既有断言：
  - 键为 `${cli}:${sessionId}`。OpenCode、缺失 sessionId 的查询、释放和活动方法保持 false、null 或无操作。
  - Codex 只按 command、cwd 和规范化 configId 决定复用；复用时调用既有 `updateOptions`。
  - Claude 不复用已 `isDisposed` 的 runner；thinking / interactive / model / isolate 严格一致；command、cwd、entrypoint 沿用旧值为空才通配；复用时优先保留 runner 已有 session id。
  - Grok 空白 session 在改缓存前抛出 `Error("empty grok session")` 且 `reason="empty"`；只有 `isReusable()` 且 command、cwd、thinking、interactive、model 一致才复用。`agentArgs` 与 `localSessionId` 不是重建条件。停止走 `cancelTurn`。
  - `setRunner` 同对象只刷新元数据并 touch；不同对象先释放旧 entry。Codex 缺省字段覆盖或清空；Claude / Grok 省略的可选字段保留旧值。保存的参数数组是副本。`setRunner` 不调用 `updateOptions`。
  - `hasClaudeRunner` 排除已释放对象；`hasCodexRunner` / `hasGrokRunner` 只做对象身份检查。`detachRunner` 只在键和对象都匹配时摘除且不 dispose。`disposeForCli` 不影响其它 CLI。
  - 24 小时超时、`IDLE_TIMEOUT_MS - 2000` 阈值、touch、活动期取消 timer、结束后恢复、旧 timer 不释放新 entry、释放顺序和错误传播保持不变。
- [x] `npm run build` 与本次相关回归通过。两例范围外历史失败已用原 `manager.ts` 复现。`git diff --check` 通过。

## 影响面

- 代码目录：`src/interactive/`、`src/test/interactive/`。
- 文档目录：`ARCHITECTURE.md`、`.ch/docs/references/cli-runtime-reference.md`、本计划。
- 配置与脚本：无。

## 风险与缓解

- 风险：抽取时把平台差异重新堆进共享流程，或让策略各自持有 Map / timer。缓解：共享流程只接收策略的判断和注册结果；timer 与 `entries` 留在 Manager。
- 风险：复用条件、缺省字段或数组副本被“整理”后改变宿主行为。缓解：先补行为测试，再抽取；既有三份测试文件的断言不删不改。
- 风险：构造或 `updateOptions` 失败后留下半成品 entry，或吞掉错误。缓解：先创建 runner，成功后再写入 Map；失败原样抛出。
- 风险：新模块反向导入 manager 形成循环依赖。缓解：类型放在 `runnerLifecycleTypes.ts`，策略只依赖 runner 与选择规范化。
- 回滚：恢复 `manager.ts` 并删除新策略模块。无数据迁移。

## 验证计划

- 最小相关验证：`npm run build`，然后运行新增测试与下列回归。
- 单元自测命令：

```bash
npm run build
node --test dist/test/interactive/manager.test.js dist/test/interactive/runnerLifecycleStrategies.test.js dist/test/interactive/codexThreadSelection.test.js dist/test/interactive/runnerRetention.test.js dist/test/interactive/grokRunner.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js
git diff --check
```

- 扩展验证：不跑全量 `npm run test:unit`，不启动真实 CLI 或 VS Code。本任务不改变界面，不做浏览器验收。
- 定时器用受控时钟，不等待真实 24 小时。每个测试结束释放 Manager。

## 测试与清单同步

- 单元测试新增/更新：扩展 `src/test/interactive/manager.test.ts`；新增 `src/test/interactive/runnerLifecycleStrategies.test.ts`。
- 单元自测结果：`npm run build` 退出码 0。随后 `node --test` 覆盖 manager、新策略、codexThreadSelection、runnerRetention、grokRunner、grokCliHostWire、promptInteractiveRuntime、interactiveTurnStrategy、extensionHostExtractionContracts。汇总 136 项，通过 134，失败 2，退出码 1。`git diff --check` 退出码 0。
- 失败处理记录：两例失败分类为历史失败或范围外失败。临时把 `src/interactive/manager.ts` 还原到改动前并重新编译后，同样的两条失败仍在，退出码 1。失败是 `extension delegates Loop, parallel, one-shot, and interactive prompt runtime wiring to extensionHost hosts`（`extension.ts` 现为 `await runPromptOneShot(attemptInput, attemptTarget, executionOptions)`，测试仍匹配 `promptInput, target`）和 `Grok session updates enter the existing assistant, thinking, and tool channels`（期望 `Hello world`，实际 `Hello world   `）。本次未改这些断言或对应实现。
- 功能清单：用户可见对话、续接、停止和配置行为不变，不更新 `FEATURE_INVENTORY.md`。
- ontology：概念、关系、状态机和 `source_refs` 不因内部策略拆分而变化。`implementation_paths` 已包含 `src/interactive`。不修改 ontology，也不因此运行 validate。
- 相关文档同步：架构说明职责边界、为何用策略而不是继承、新增平台时的修改点和测试入口；CLI 运行参考补生命周期事实。不写 `ROLLING_SUMMARY.md`。

## 任务列表

- [x] 补充刻画既有行为的回归测试
- [x] 抽出策略表和共享生命周期流程
- [x] 构建、运行相关单测并同步文档
- [x] 归档本计划并写 attempt 报告

## 决策记录

- 2026-10-22：采用显式策略表加一个共享流程，不使用继承。缓存、键、释放、touch 和 idle timer 如果下放到子类，三个平台会各持有一份生命周期。
- 2026-10-22：策略文件使用仓库既有的 camelCase 文件名 `runnerLifecycleStrategies.ts`，而不是建议范围里的全小写文件名。全小写和 `cliRuntimeConfigStrategies.ts` 的命名不一致。

## 当前结论

交互 Runner 的平台差异已收进显式策略表，缓存、释放和 idle timer 仍只有 Manager 一份。首轮抽取后 `manager.ts` 为 331 行，策略 340 行，类型 149 行。2026-10-22 类型契约复核修复后，`manager.ts` 344 行，`runnerLifecycleStrategies.ts` 338 行，`runnerLifecycleTypes.ts` 164 行。维护性改善来自分工：改 Claude 通配或 Grok 停止动作不再改共享释放流程，新增平台也不复制 Map 和 timer。用户可见契约没有变化。归档路径：`.ch/docs/exec-plans/completed/2026-10/2026-10-22-interactive-runner-lifecycle.md`。

## 复核修复（2026-10-22）

主审确认运行行为基本保持，但类型契约失败。`RunnerRegistration<RunnerEntry> = Omit<TEntry, "idleTimer" | "lastUsedAt">` 不是分布式 Omit。把 `cli: "codex"`、Claude runner、`configId: null` 和其它公共字段先放进变量，再赋给 `RunnerRegistration<RunnerEntry>`，修复前可以编译；省略 Codex `configId` 也可以编译。直接赋给 `RunnerEntry` 则报 TS2322。在修复前的 `reuseOrCreate` 上插入 codex key 与 Claude 工厂探针，虚拟编译没有诊断。

修复决定：

- `RunnerRegistration` 改为 `TEntry extends unknown ? Omit<TEntry, "idleTimer" | "lastUsedAt"> : never`，并用 `RunnerEntryByCli`、`RunnerByCli`、`RunnerRegistrationByCli` 表达平台映射。不把专属字段改成可选，不把 runner 放宽成联合，不加索引签名。
- `reuseOrCreate` 与 `registerExternalRunner` 共用类型参数 `TCli`。查找、复用或先释放再创建、注册、touch 仍只有一套实现。返回已缓存 runner 时，TypeScript 会把 `RunnerEntryByCli[TCli]["runner"]` 收成 `never`；这里用按 `cli` 索引的 `platformRunners` 读取，每个分支都先由 `entry.cli` 收窄，没有 `as TRunner`。
- `withLifecycle` 接收分布式注册联合，按 `cli` 收窄后把补上 timer 的对象标成对应 `RunnerEntryByCli` 成员，再返回 `RunnerEntry`。没有整体 `as RunnerEntry`。
- 公开 `setRunner` 的参数仍是 CLI 与 runner 联合。Facade 在 `cli === "codex" | "claude" | "grok"` 之后各保留一次单断言，把联合送进已绑定的内部注册。这是公开签名兼容边界，不是共享流程里的无关联断言。没有 `any`、`@ts-ignore` 或双重断言。
- 删掉本轮之前未要求的四处代码注释。运行规则未改：Map、键、24 小时 timer、OpenCode 不入缓存、只有 Grok `getOrCreate` trim、三平台复用和 `setRunner` 缺省语义、停止动作、detach、活动计时和错误传播都保持原样。

编译期回归在 `src/test/interactive/manager.test.ts` 用项目 `typescript` 与 `tsconfig.json` 做虚拟文件诊断，不新增依赖，不放宽 tsconfig。三平台合法注册通过；跨平台 runner、缺失 `configId` / `isolateProjectInstructions` / Grok `command`、CLI 与工厂或注册结果不一致被拒绝。公开 `setRunner("codex", ..., claudeRunner, ...)` 仍能编译。`manager.test.ts` 现为 18 项：原有 2 项、首轮新增 14 项、本次类型契约 2 项。策略测试仍为 5 项。

复核验证，工作目录为仓库根：

- `npm run build`：退出码 0。
- `node --test dist/test/interactive/manager.test.js dist/test/interactive/runnerLifecycleStrategies.test.js dist/test/interactive/codexThreadSelection.test.js dist/test/interactive/runnerRetention.test.js`：退出码 0。32 项全部通过。相对首轮 30 项，多出的 2 项是本次类型契约测试。
- `node --test dist/test/interactive/grokRunner.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js`：退出码 1。106 项，通过 104，失败 2。失败仍是 `extension delegates Loop, parallel, one-shot, and interactive prompt runtime wiring to extensionHost hosts`（源码已是 `attemptInput, attemptTarget`，测试仍匹配 `promptInput, target`）和 `Grok session updates enter the existing assistant, thinking, and tool channels`（期望 `Hello world`，实际 `Hello world   `）。这两项是首轮已用旧 manager 复现的历史失败，本次没有新增失败，也没有改 `extension.ts`、Grok 回放或这两条断言。
- `git diff --check`：退出码 0。该命令不覆盖未跟踪文件；本次新增和修改文件另查了行尾空白与冲突标记，没有命中。

功能清单与 ontology 不更新：用户可见续接、停止、缓存和会话语义没变，概念、关系、状态机和 `source_refs` 也不变。没有为此运行 ontology validate。
