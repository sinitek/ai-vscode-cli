# 交互轮次策略化 — 行为保持重构

- 日期：2026-10-18
- 状态：completed
- 负责人：协作
- owner：Loop attempt round-1-interactive-turn-strategies
- claimed_at：2026-10-18
- claim_ttl：本次尝试
- handoff_to：无
- 类型：refactor

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-interactive-turn-strategies.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-18-docs-interactive-turn-strategies.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

抽取交互回合策略，保持三平台轮次与宿主生命周期。仅承担行为保持重构；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的行为保持重构；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-refactor-interactive-turn-strategies.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- `src/extensionHost/promptInteractiveRuntime.ts` 的 `runPromptInteractive` 在同一个 while 循环里为 Codex、Claude、Grok 各写一套 runner 生命周期、流事件映射和收口。三套收口重复，改一个 CLI 要翻整段函数。

## 目标

- 用与 `cliRuntimeConfigStrategies.ts` 相同风格的显式策略注册表拆出三套 attempt。只改善可维护性，不改变用户可见行为。

## 范围

- 新增 `src/extensionHost/interactiveTurnStrategy.ts`、`interactiveTurnCodex.ts`、`interactiveTurnClaude.ts`、`interactiveTurnGrok.ts`。

- `promptInteractiveRuntime.ts` 保留 attempt 顺序、命令准备、hidden retry、消息、持久化、debug 日志、catch、cleanup 和 `interactiveRunsByTabId` 注册。

- host 内新增 `settleInteractiveAttempt`，由策略在 try 内、finally dispose 之前调用。

## 非目标

- 不给 OpenCode 注册交互策略，未知 cli 仍抛 `interactive-runner-unsupported:`。

- 不改 `InteractiveRunnerManager` 的公开方法，不改 one-shot、parallel、template、Loop/Loop+、配置策略、webview、i18n。

- 不改功能清单、ontology、任务记录或 `~/.sinitek_cli`。

- 不提交、不更换依赖、不启动真实 CLI，也不做 UI 改动。

## 验收标准

- [x] 注册表键恰好是 `codex`、`claude`、`grok`，没有 `opencode`。

- [x] 策略无跨 attempt 可变状态；消息、持久化和 hidden retry 仍通过 host 端口调用。

- [x] 收口在策略的 try 内、dispose 的 finally 之前执行。三种 unmanaged dispose 规则保持原样。

- [x] 工厂签名和 `return { runPromptInteractive };` 不变。

- [x] 相关构建通过。指定测试里与本次重构相关的用例通过；两处失败在未改动的 HEAD 上同样失败。

## 影响面

- 代码目录：`src/extensionHost/`、`src/test/extensionHost/`。

- 配置与脚本：无。

## 风险与缓解

- 风险：策略函数返回后再 settle，会在人工交互和 cleanup 之前 dispose unmanaged runner。缓解：策略在自己的 try 里调用 `settleInteractiveAttempt`，finally 仍只负责原有 dispose。

- 风险：把三种 dispose 收成一种。缓解：Codex、Claude、Grok 各自保留原来的保留条件；Claude 继续使用 `hasClaudeRunner?.`。

- 回滚：删除四个策略文件，把三套 attempt 放回 `runPromptInteractive`。无数据迁移。

## 验证计划

- 最小相关验证：`npm run build`，再运行策略测试、交互运行时测试、Grok host/runner、源码契约和 OpenCode command runner。

- 不适用：真实 CLI、浏览器、全量 `npm run test:unit`。

## 测试与清单同步

- 源码契约：`extensionHostExtractionContracts.test.ts` 只改交互运行时这一条的断言落点。Codex 回调断言改到 `interactiveTurnCodex.ts`，Claude `onSessionId` 断言改到 `interactiveTurnClaude.ts`。

- 单元自测结果：见下方最终验证。

- 失败处理记录：指定测试 156 项里 154 项通过、2 项失败。对照 HEAD 的 `promptInteractiveRuntime.ts` 重跑这两项，失败相同。分类为既有失败，未改断言，也未为了让断言通过而改变空白 chunk 或 `extension.ts` 调用。

- 不修改 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，也不新增 i18n 文案。

- 交互运行时仍由原工厂承接，因此不修改 ontology。

- `promptInteractiveRuntime.ts` 当前 1276 行。

## 任务列表

- [x] 抽出 Codex、Claude、Grok 的 attempt 策略和端口

- [x] host 保留循环、收口和原有 dispose 规则

## 决策记录

- 2026-10-18：采用显式策略注册表，而不是类继承、DI 容器或 mode 旗标。三套流映射留在各自文件，host 只按 cli 取值。

- 2026-10-18：`settleInteractiveAttempt` 留在 host。策略在 try 内调用它，把 `"continue" | "return"` 交回循环。异常继续进入 host 现有 catch，finally 仍在抛出和正常离开时 dispose。

## 当前结论

- 策略注册表已经承接三个 CLI 的 runner 生命周期和流事件映射。attempt 顺序、命令准备、hidden retry 和收口仍在 host。指定测试中的交互行为、Grok runner 和 OpenCode bounded utf8 契约通过。两处既有失败与本次拆分无关。全量单元、真实 CLI 和浏览器验收未执行。

## 最终验证

- 工作目录是 Loop 工作区。

- `npm run build`：退出码 0。tsc 无错误。

- `node --test dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/interactive/grokRunner.test.js dist/test/cli/opencodeCommandRunner.test.js`：退出码 1。156 项中 154 通过、2 失败。

- 失败 1：`extension delegates Loop, parallel, one-shot, and interactive prompt runtime wiring to extensionHost hosts`。断言要求 `await runPromptOneShot(promptInput, target, executionOptions);`，`src/extension.ts` 实际是 `await runPromptOneShot(attemptInput, attemptTarget, executionOptions);`。该文件不在本次写入范围。用 HEAD 的交互运行时重跑，失败相同。

- 失败 2：`Grok session updates enter the existing assistant, thinking, and tool channels`。期望助手文本 `Hello world`，实际 `Hello world   `。原 `onAssistantDelta` 会追加非空空白 chunk。用 HEAD 源码重跑，实际值相同。同文件中“preserves whitespace deltas”用例通过。

- 未运行：`npm run test:unit`、真实 CLI、浏览器或 Extension Development Host。本任务没有 UI 改动，浏览器验收不适用。

## 未覆盖项

- 未把既有的 `extension.ts` 调用名差异或 Grok 空白 chunk 断言改成与当前实现一致。

- Linux 与 Windows 没有在本次执行机上单独跑交互测试。dispose 与流映射仍复用原 runner 和 manager。
