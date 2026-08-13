# 核心单元测试覆盖率基线

- 日期：2026-07-15
- 状态：completed
- 负责人：Codex
- owner：核心测试覆盖率改造

## 背景

插件已有 TypeScript 单测，但此前没有统一的单测脚本、核心模块白名单或可执行的覆盖率门禁，因此无法验证“核心功能 100% 单元测试覆盖率”的目标。本计划只建立可重复的测试与覆盖率基线；不把当前未覆盖的代码表述为已达标。

## 目标

- 保持现有 `tsc` 编译与 `node:test` 测试框架。
- 以 `c8` 统计编译产物的 V8 覆盖率，并通过 source map 回报 TypeScript 源文件。
- 为核心模块设置语句、行、函数、分支均为 100% 的硬门禁。
- 将项目级单测、核心单测和核心覆盖率验证分别提供为稳定入口。

## 范围

### 核心覆盖率口径

`test:core-coverage` 只通过下列编译后文件纳入统计；列表对应用户可见执行链路中的 Loop 状态与持久化、CLI 命令执行、会话/消息编排：

- `src/loopTaskStore.ts`：Loop 任务记录、持久化、通信文件和迁移边界。
- `src/loopMainFailure.ts`：主任务连续失败状态与重置。
- `src/cli/commandRunner.ts`：CLI 命令构建、子进程执行和 OpenCode 输出解析。
- `src/sessionStore.ts`：会话与消息文件的读写、清理和规范化。
- `src/sessionLifecycle.ts`：CLI 会话 ID 提取与会话生命周期控制。
- `src/sessionMessageActions.ts`：会话消息操作。
- `src/sessionMessageHandlers.ts`：面板消息到执行链路的编排。
- `src/sessionMessageRouter.ts`：面板消息类型路由。
- `src/promptRuntime.ts`：提示词与上下文装配。

核心命令仅执行与以上链路相关的编译后测试：`loopTaskStore`、`loopMainFailure`、`loopLegacyMigration`、`opencodeCommandRunner`、`commandRunnerCoreBranches`、`opencodethinkingintegration`、`promptRuntime`、`sessionMessageActions`。这避免无关的配置页面静态样式断言或本机 CLI 安装探测影响核心覆盖率信号。

### 非目标

- 不改变用户可见功能、CLI 协议或核心测试白名单。
- 不做无关生产重构；仅允许为消除类型约束下不可达的覆盖率分支做等价小清理。
- 不将 `extension.ts`、配置页面、静态 Webview 拼接、媒体资源或非核心 CLI 适配器纳入本批 100% 声明。
- 不降低阈值，也不以排除未覆盖核心文件来获得绿灯。
- 不修复本次发现的项目级历史失败。

## 验收标准

- [x] `npm run build` 可以完成 TypeScript 编译至 `dist`。
- [x] `npm test` / `npm run test:unit` 是可重复的项目级单测入口。
- [x] `npm run test:core` 是可重复的核心链路单测入口。
- [x] `npm run test:core-coverage` 使用白名单和 `c8 --all --check-coverage`。
- [x] 覆盖率门禁显式要求语句、行、函数、分支均为 100%。
- [x] 核心白名单的四项覆盖率均达到 100%。见“最终结果”。
- [ ] 项目级全量单测全部通过。当前有 3 项范围外历史基线失败，见“风险与缓解”；本计划的完成口径是核心覆盖率门禁。

## 影响面

- 代码目录：`src/loopTaskStore.ts`、`src/sessionLifecycle.ts`、`src/cli/commandRunner.ts` 有小型等价清理；核心覆盖测试文件补齐边界用例。
- 配置与脚本：`package.json`、`package-lock.json`，新增开发依赖 `c8@^10.1.3`（Node `>=18`）。
- 文档目录：本执行计划。

## 验证计划

- 构建：`npm run build`
- 项目级单测：`npm test`
- 核心链路单测：`npm run test:core`
- 严格覆盖率：`npm run test:core-coverage`

`c8` 的报告和临时 V8 数据写入 `node_modules/.cache/sinitek-cli-core-coverage`，不在仓库根目录产生覆盖率文件。

## 基线结果（2026-07-15）

- `npm run build`：通过。
- `npm run test:core`：106 通过，0 失败。
- `npm run test:core-coverage`：测试本身为 106 通过，0 失败；覆盖率门禁失败（预期），当前白名单为语句 51.11%、行 51.11%、函数 61.78%、分支 64.74%。
- 已完整达标的核心模块：`loopMainFailure.ts`、`sessionMessageRouter.ts`（四项均为 100%）。
- 主要缺口：`sessionLifecycle.ts`（行 8.86%）、`sessionStore.ts`（行 22.88%）、`promptRuntime.ts`（行 36.75%）、`sessionMessageHandlers.ts`（行 40.32%）、`loopTaskStore.ts`（行 66.87%）、`sessionMessageActions.ts`（行 76.40%）、`commandRunner.ts`（行 83.24%）。
- `npm test`：524 通过，3 失败。两项 `commandResolution.test` 受本机真实 `~/.npm-global/bin/opencode` 干扰，未使用测试临时 HOME；一项 `configappcompactlayoutstyles.test` 找不到预期 CSS 选择器。它们不在本任务允许修改范围，也不影响核心测试集合的 106 项结果。

## 风险与缓解

- 风险：100% 目标被宽泛的全扩展覆盖率稀释或被静态 Webview 代码错误纳入。缓解：`--include` 仅接受以上九个编译模块，且 `--all` 强制未执行的白名单模块计为缺失。
- 风险：覆盖率命令被无关项目级失败阻塞。缓解：核心测试集显式列出，只运行覆盖核心链路所需的测试；全量失败仍保留在 `npm test` 基线中。
- 风险：会话和 CLI 模块包含文件系统、子进程和 VS Code 依赖。缓解：后续测试必须延续现有 `vscodeMock`、临时目录和子进程 mock，不得调用真实 CLI 或网络。
- 风险：并行补测可能暂时改变基线数字。缓解：每批测试合并后重新执行严格命令，保留四项指标和退出码。

## 后续测试分批策略

1. Loop 持久化：补齐 `loopTaskStore.ts` 的错误路径、保存/读取失败、保留期清理、任务/子任务状态规范化和迁移冲突测试；保持 `loopMainFailure.ts` 100%。
2. CLI 执行：补齐 `commandRunner.ts` 的可观测命令分支、JSONL/plain 输出、非零退出、错误事件和终止路径，全部 mock 子进程。
3. 会话持久化与生命周期：为 `sessionStore.ts`、`sessionLifecycle.ts` 补齐文件 I/O、空值、保留期、异常和恢复分支的隔离单测。
4. 消息编排：为 `sessionMessageActions.ts`、`sessionMessageHandlers.ts`、`sessionMessageRouter.ts` 补齐所有面板消息的成功、拒绝、异常和状态推进分支。
5. 提示词编排：覆盖 `promptRuntime.ts` 的上下文、附件路径、内存注入和无效输入路径。
6. 每批完成后执行 `npm run test:core` 与 `npm run test:core-coverage`；仅在四项指标均为 100% 时将本计划标记为 completed。

## 测试与清单同步

- 单元测试新增/更新：补齐 `loopTaskStoreCoreCoverage`、`commandRunnerCoverage`、`sessionLifecycleCoreCoverage` 等核心覆盖率边界测试。
- 单元自测结果：见“最终结果”。
- 失败处理记录：未修改三项项目级历史失败；核心覆盖率运行与其隔离。
- 功能清单：不需要更新。本次只改变开发验证和内部测试覆盖，不改变用户可见能力或配置契约。
- 相关文档同步：本执行计划已更新。

## 决策记录

- 2026-07-15：选用 `c8@^10.1.3`，而非替换测试框架；它兼容 Node `>=18`，支持 `node:test`、source map、模块白名单及四项 100% 门禁。
- 2026-07-15：以编译产物 `dist` 作为 `c8` 输入，覆盖率通过 source map 映射回 `src`；这样与发布前的 TypeScript 编译路径一致。
- 2026-07-15：将核心测试集与全量测试集分离，保留全量失败信号，同时使核心门禁只反映定义的用户执行链路。
- 2026-07-15：对类型约束下不可达的私有防御分支做等价收敛，包括 OpenCode `--format json` 插入点、Loop 树遍历空栈 guard、`SessionStore` 强类型 bucket 访问。

## 当前结论

核心覆盖率工具、统一命令、模块白名单和严格 100% 门禁已建立并达标。`test:core-coverage` 覆盖白名单内九个核心模块，语句、行、函数、分支均为 100%。项目级 `npm test` 的三项历史失败仍按范围外风险保留，不影响核心门禁完成结论。

## 最终结果（2026-07-15）

- `test:core` 和 `test:core-coverage` 已接入 `loopTaskStoreCoreCoverage`、`commandRunnerCoverage`、`sessionStoreCoreCoverage`、`sessionLifecycleCoreCoverage`、`sessionMessageActionsCoreCoverage`、`promptRuntimeCoreCoverage`、`sessionMessageHandlersCoreCoverage`；九个 `--include` 白名单和四项 100% 阈值未改。
- `./node_modules/.bin/tsc --noEmit -p ./`：通过。
- `npm run test:core`：通过，188/188。
- `npm run test:core-coverage`：通过，188/188；白名单模块 statements / branches / functions / lines 均为 100%。
- `npm run build`：通过；由 `npm run test:core` 和 `npm run test:core-coverage` 的前置步骤执行。
