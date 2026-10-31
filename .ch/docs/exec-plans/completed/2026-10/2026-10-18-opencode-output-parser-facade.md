# OpenCode 输出解析外观拆分

- 日期：2026-10-18
- 状态：completed
- 负责人：协作
- owner：Loop attempt round-2-opencode-output-parser-refactor
- claimed_at：2026-10-18
- claim_ttl：本次尝试
- handoff_to：无

## 背景

`src/cli/commandRunner.ts` 在实施前为 1532 行，同时负责 VS Code terminal、spawn、runtime overlay、进程终止，以及 OpenCode JSONL、可见事件、活动跟踪、session/message id、export 文档解释和失败文案。主审已比较方向并采纳外观拆分。CodeGraph 对 `commandRunner.ts` 明确 stale，调用关系只作候选，实施以当前源码为准。

实施前基线（真实仓库 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli`）：`git diff` 为空。`git status --short` 只有当时位于 active 的未跟踪 Grok 任务临时计划。该文件不属于本次范围，原样保留；该临时计划已在后续目录整理中删除，此处只保留历史基线事实，不保留已失效路径。

## 目标

把 OpenCode 纯输出解释移到 `src/cli/openCodeRunOutput.ts`。`commandRunner.ts` 保留进程外观，并再导出原公开解析符号。行为与调用方式保持不变。

## 范围

- 新增 `src/cli/openCodeRunOutput.ts`，按原算法搬移纯解析类型、常量、helper、正则、活动跟踪和失败文案。
- `commandRunner.ts` 保留进程、终端、overlay、停止和 `recoverOpenCodeMissingAssistantOutput`。`OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS` 继续在外观定义并导出。`OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES` 随解析器迁移并再导出。
- 新增 `src/test/cli/openCodeRunOutput.test.ts`。
- 更新 `ARCHITECTURE.md` 的 CLI 服务层短段。
- 本计划归档在 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-opencode-output-parser-facade.md`。active 副本在完成后删除。

## 非目标

- 不改变用户可见行为、文案、UI、国际化、配置或持久化 schema，因此本次不更新 `FEATURE_INVENTORY`。
- 不修改 Webview、调用方、既有 command runner 测试、已完成的参数策略和运行配置策略、Loop 调度与生命周期。
- 不引入新依赖、DI 容器、类继承或 mode 参数。
- 不修改 ontology 数据。`plugin.local_cli` 的 `implementation_paths` 仍是 `src/cli`，业务语义和来源路径保持。
- 不补建缺失的 `.ch/docs/design-docs/vscode-cli-extension-runtime.md`。
- 不提交、不发布、不回滚其他工作，不改宿主任务记录、active ids、loopPlus 快照、调度状态或其他任务通信文件。
- 不调用真实 OpenCode、模型服务，不读写真实用户配置，不启动 VS Code。

## 验收标准

- [x] 公开解析符号仍可从 `commandRunner.ts` 按原名称、参数、返回形状和同步/异步特性使用。
- [x] 纯解析模块不依赖 vscode、extension、commandRunner、配置服务、fs 或 child_process。
- [x] `recoverOpenCodeMissingAssistantOutput` 与 export 超时留在进程外观。
- [x] 既有 command runner 测试不改断言，新增测试直接加载纯解析模块。
- [x] `npm run build` 后指定单测通过，普通 Node 可直接 require 构建产物。
- [x] 本次编辑只落在授权路径。收尾时工作区另有并发改动，已原样保留，见验证记录。

## 影响面

- 代码目录：`src/cli/`、`src/test/cli/`。
- 文档目录：`ARCHITECTURE.md`、本计划。
- 配置与脚本：无。

## 风险与缓解

- 风险：搬移时改动选择算法、排序或文案。缓解：解析函数体与 `recoverOpenCodeMissingAssistantOutput`、进程尾部相对 HEAD 逐行相同。
- 风险：再导出丢失类型或运行时绑定。缓解：显式再导出；既有 facade 测试与新增直接导入测试通过。
- 风险：解析模块间接引入 vscode。缓解：依赖限定为四个纯模块；测试和 `require` smoke 均未加载 vscode。
- 回滚：删除新模块，把解析函数放回 `commandRunner.ts`。无数据迁移。

## 验证计划

- 最小相关验证：`npm run build`，然后 `node --test` 运行新增解析测试和三份 command runner 测试。
- 扩展验证：消费方 `openCodePromptRunTemplate`、`promptOneShotRuntime`、`promptParallelRuntime`、`contextCompactionRunner`、`sessionMessageActions` 的已编译测试。
- smoke：普通 Node `require("./dist/cli/openCodeRunOutput.js")`。
- 边界：`git diff --check`、`git diff --stat`、`git status --short`。
- ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。
- 不适用：VS Code Extension Host、真实 CLI、浏览器、全量 `npm run test:unit`。

## 测试与清单同步

- 单元测试新增：`src/test/cli/openCodeRunOutput.test.ts`，9 个行为测试。
- 单元自测结果：见下方最终验证。
- 失败处理记录：第一次相关单测 95 个里失败 1 个。失败在新测试夹具：期望 thinking 标签后的 assistant 文本被 trim，既有 `splitThinkingTaggedContent` 保留标签后的原文。分类为新夹具与既有算法不一致，不是实现缺陷，也不是旧断言过期。只修正新夹具，未改解析实现和旧测试。随后完整重跑通过。
- 功能清单：用户可见行为、文案、UI、国际化和持久化 schema 未由本次拆分改变，因此本次不修改 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- ontology：语义和 `src/cli` 实现路径仍有效，本次不修改 ontology。`--validate` 通过。
- 相关文档同步：`ARCHITECTURE.md` CLI 服务层增加 Facade、纯解析模块、export 副作用归属、测试入口和本计划路径。`commandRunner.ts` 当前 528 行，`openCodeRunOutput.ts` 当前 1033 行。

## 任务列表

- [x] 建立本计划并记录基线
- [x] 搬移纯解析模块并保留进程外观
- [x] 补行为测试
- [x] 构建、指定单测、smoke、文档与归档

## 决策记录

- 2026-10-18：主审采纳外观拆分。解析与进程执行分离；export 的进程副作用留在 `commandRunner.ts`。
- 2026-10-18：CodeGraph 索引对 `commandRunner.ts` stale，符号调用清单只作候选，源码以直接读取的当前文件为准。
- 2026-10-18：ontology `plugin.local_cli` 的 source_refs 指向 CLI 运行参考和 Grok 交互实现，implementation_paths 为 `src/cli` 与 `src/interactive`。本次不改业务语义，不改 ontology。

## 最终验证

命令都在 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli` 执行。

1. `npm run build`（`npm run clean && tsc -p ./`）两次均退出码 0。第二次是在修正新测试夹具之后，作为最终构建。
2. `node --test dist/test/cli/openCodeRunOutput.test.js dist/test/cli/opencodeCommandRunner.test.js dist/test/cli/commandRunnerCoverage.test.js dist/test/cli/commandRunnerCoreBranches.test.js`：95 tests，95 pass，0 fail。
3. `node --test dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/core/contextCompactionRunner.test.js dist/test/session/sessionMessageActions.test.js`：70 tests，70 pass，0 fail。
4. 普通 Node smoke：`require("./dist/cli/openCodeRunOutput.js")` 成功。运行时导出为活动字节上限、11 个解析函数；没有 `OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS`，也没有 vscode。
5. `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：validation passed，domains=2 concepts=17 relations=16 rules=43 workflows=2 documents=3。
6. `git diff --check`：通过，无空白错误。

行数辅助指标：`commandRunner.ts` 1532 → 528；`openCodeRunOutput.ts` 1033；新测试 524。

## 未验证限制

- 未启动 VS Code，未加载 Extension Development Host。
- 未调用真实 OpenCode CLI 或模型服务，未读写真实用户配置。
- 未运行浏览器或全量 `npm run test:unit`。
- 进程停止的 Windows `taskkill` 路径由既有 mock 测试覆盖，本次 macOS 环境没有实际执行 Windows 停止。
- 没有运行 `codegraph sync`。索引仍 stale，不作为本次行为证据。

## 当前结论

纯解析模块与进程 Facade 已分离，公开符号和 recover 行为由新测试与既有 facade、消费方测试锁定。完成计划只保留本归档。实施期间仓库出现与本次无关的并发工作区改动，包括 package.nls 内联、Webview 和若干文档；本次没有回滚或继续修改它们。`ARCHITECTURE.md` 除本次 CLI 段落外，目录树里 `i18n.ts` 注释也被该并发改动更新，已按“其他改动原样保留”留下。
