# CLI 跨平台运行时策略收敛

- 日期：2026-11-24
- 类型：refactor
- 关联计划：无
- 状态：in-progress
- 负责人：协作
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：主任务 CLI 运行时策略收敛实现与验收

## 背景

当前七个受支持 CLI 共用部分基础设施，但配置读写、CLI 参数组装、交互 Runner 生命周期和 turn 分派已经分别有集中服务或策略入口。具体而言，`configService.ts` 与 `cliRuntimeConfigStrategies.ts` 管理配置读写策略；`cliRunArgStrategies.ts` 集中管理 argv；交互 Runner 的生命周期 registry 和 turn handler registry 已存在；OpenCode one-shot 与 parallel 已调用共同的 `openCodePromptRunTemplate.ts`。不能将这些已有能力误报成待从头建设。

重构前需收敛的边界：`promptInteractiveRuntime.ts` 内重复/分散的交互准备与 CLI 分支，分散的执行模式能力与路由规则，以及一次性与交互进程的启动、环境/平台选项和终止策略。已存在的 CLI 子进程基础运行时、argv helper 和平台终止模块是实现基础，不代表所有原生交互协议可以合并。

## 目标

把跨 CLI 的共同编排收敛到 typed 策略与适配器：主流程依据显式能力表选择执行模式、准备与生命周期策略；将 Codex app-server、ACP（各 CLI 自身的原生能力）、ZCode 原生协议等差异，以及 win32/darwin/linux 的启动和终止差异留在专用 adapter/process policy 中。提供可执行的 CLI × 平台矩阵测试，守住现有支持边界、原生语义和资源收口契约。

本目标不是创建或强推一套 vendor-neutral 原生协议，也不以“抽象统一”作为改变 CLI 行为的理由。

## 范围

本轮分为三个实现边界。进程策略可独立于七 CLI 能力/路由与交互准备集成推进：

1. **交互准备策略**：整理 `promptInteractiveRuntime.ts` 的运行前能力解析、配置/模型/argv/隔离信息准备与 CLI 专用准备 hook。保留现有 `interactiveTurnStrategy.ts` 和 Runner lifecycle registry；转交给已存在的 turn/lifecycle 策略，不复制其职责。明确准备失败、取消、配置变化和 session 接管的顺序与所有权。
2. **任务模式能力与路由表**：建立七 CLI 对 interactive、one-shot、parallel 的当前支持及前置条件表；此表是交互准备和主入口路由集成的前置，而不是继续沿用重复的散落判断。先以 `.ch/docs/references/cli-runtime-reference.md` 当前矩阵和实际入口为基线；保留显式不支持组合与原错误/降级行为，不凭抽象扩大支持范围。
3. **进程策略与 typed adapters（可独立推进）**：在已有 argv 策略及 `cliProcessRuntime.ts`、`processArgv.ts`、`processTermination.ts` 基础上，归并一次性和交互式执行可共用的解析、环境优先级、spawn 平台选项及进程组/树终止请求；保留各 adapter 的协议启动、流处理、取消握手、超时升级和完成判据。CLI 原生协议参数留在 typed adapter，不由通用进程策略推断或替代；实际 child close、stdio drain 和 session release 独立取证。

顺序与依赖：进程策略独立交付；另一条依赖链先建立七 CLI × 执行模式能力表（round-7，round-9 修复面板注入），再整合交互准备和主入口路由（round-10）。两条工作流最终按实际受影响契约选择测试与审查，不设全部 CLI、全部平台或整批测试通过这一笼统门禁。共享符号有冲突时由主任务协调，不做大范围替换。

## 本轮实际进展与依赖

- 进程策略：早期 `round-4-cli-process-foundation.md` 只记录一次性 runtime 接入；`round-8-cli-process-foundation.md` 交付 Codex/app-server、Claude SDK、Grok/ACP、DSH、Kimi Code、ZCode 六个交互 spawn 路径的接入。主通信 lp8 已通过此交付的代码审查并接受报告所列检查；不等同于真实 CLI 或原生进程树验证，stop/signal/taskkill 不能替代 child close、stdio drain 或 session release 证据。
- 能力策略及路由集成：`round-7-cli-execution-capability-policy.md` 交付七 CLI 能力/压缩候选策略；主审指出面板注入契约缺口，`round-9-cli-execution-capability-policy.md` 恢复 `PanelStateBuilderDeps.isInteractiveSupported` 注入并经主审通过。`round-10-cli-task-and-interactive-strategy-integration.md` 交付 `interactiveLaunchStrategy.ts`、`promptInteractiveRuntime.ts` 和 `extension.ts` 的策略集成；主审通过其选路、六 CLI 参数准备及协议/生命周期代码审查，lp10 当时未通过的是缺少宿主运行与技能的产物验收。
- 宿主与技能：主审接受 lp12 的隔离 macOS Extension Development Host smoke 结果；lp12 尝试因外层目录清理 `ENOTEMPTY` 且技能当时未交付，未通过事件验收。lp13 补交 `.agents/skills/vscode-extension-host-smoke/SKILL.md` 并通过主审，复用 lp12 实测，不增加运行证据，也不证明旧目录已清理。
- 行为等价取证已推进到压缩准入（lp16–18）、用量与窗口来源（lp17）以及 ZCode 发布和释放等待的所有权（lp21、lp26）。各 CLI 的已审边界、定向用例与剩余缺口见“能力与所有权证据”。
- lp32 对修正 Claude stdin 夹具后的工作树完成当时的全量 Node 回归。lp33 在同次构建产物上完成隔离 macOS 面板入口检查，并按依赖核对复用 round-23 的两项浏览器烟测。最终 macOS 全量回归及其复用范围见“修复后 macOS 全量回归”。
- 隔离 macOS 原生诊断已取证。lp36 确认 Codex 的两次自然 drain 和同一线程恢复。lp37 确认 ZCode 的关闭与进程清理，跨进程恢复原会话失败。具体适用范围见“原生 CLI 生命周期诊断”。
- 清单与本体：既有交付未报告 CLI 支持能力、用户可见行为或本体语义变化，本轮文档校正不改功能清单/ontology；共享工作区的其他差异不归入本轮。若后续审查发现实际语义或事实来源路径改变，再按相应规则更新。

## 非目标

- 不更换或标准化 Codex app-server、Claude SDK、OpenCode CLI、Grok/DSH/Kimi ACP、ZCode 原生协议；不假设它们消息、取消、恢复或结束信号等价。
- 不新增 CLI、执行模式或用户设置，不改变现有 UI、CLI 支持矩阵及会话续接语义；不重做配置存储或 argv 策略。
- 不把进程 `kill` 请求、ACP cancel、session/close 回执、超时或 runner manager 注销当作实际子进程退出/资源释放证明。
- 不改与收敛无关的 Loop/部门执行所有权、记忆/调度记录、生成产物或依赖版本。

## 验收标准

- [x] 七 CLI 的配置、argv、交互 turn/lifecycle registry 与 OpenCode 共用模板在实现中得到复用，不新建竞争事实来源（既有代码审查）。
- [x] 交互准备、执行模式能力/路由、跨模式进程策略各有明确 typed 契约及责任边界；现有 CLI 原生适配器仍决定协议行为（lp8 进程接入、lp9 面板注入修复及 lp10 集成代码审查）。
- [x] **模式路由**：保留七 CLI 的 interactive/one-shot/parallel 支持与拒绝条件，以及 OpenCode 动态 one-shot/parallel 选路（round-7 策略与 round-10 入口定向用例及代码审查）。
- [ ] 保留 `codex`、`claude`、`opencode`、`grok`、`dsh`、`kimi-code`、`zcode` 的能力矩阵及 `win32`、`darwin`、`linux` 的平台注入/模拟策略。七 CLI 模式表和三平台策略分支已有证据；本次原生运行只验收 macOS 的受影响路径，Linux、Windows 原生运行本次免测，不计为通过，也不构成归档门禁。
- [ ] 在 macOS 按各 CLI 的适用生命周期契约验证成功、失败、取消、超时、并发/重复收尾及 spawn error；核对进程、stdio、临时覆盖层和 registry 无提前释放或遗留。round-8 与 lp26 提供夹具证据。按“原生 CLI 生命周期诊断”与“后续 macOS 原生 CLI 与定向取证”所列范围复用原生结果，继续核对其余适用场景的退出与资源收尾。
- [x] **压缩资格与宿主准入**已完成源码审阅与定向取证（lp16–18）。OpenCode 保留原生策略与候选资格，生产宿主仍静默或非静默拒绝执行。DSH 无手动入口和自动候选资格，runner 仍拒绝。真实 CLI 的压缩执行与生命周期时序按实际影响另行核对。
- [ ] **用量与窗口展示等价**按 CLI 保留缺测、占位、窗口来源、Tab/会话隔离和允许的迟到更新。复用 lp17 的审阅、lp21 与 lp26 的 ZCode 所有权夹具及后续生产 adapter 到所属 Tab 的定向发布证据。lp33 宿主未提交提示；实际 Webview 展示、受影响的会话替换及合法迟到更新仍按各 CLI 契约核对。
- [x] 已有构建和定向检查按各自范围复用；隔离 macOS Extension Host smoke 与技能交付分别有经主审接受的证据。不以它们替代行为等价或 CLI 原生生命周期核对。
- [x] 修复后 macOS 构建、Node runner 与 `npm run test:unit` 均退出 0，lp78 已核对复用依据。lp33 的 macOS 面板入口和两项既有 Playwright 夹具仍按原范围记录。
- [ ] 严格外联隔离的 macOS 历史标题烟测须在同次匹配构建中观察真实 Extension Host 激活、宿主内网络和 HOME 拒绝、历史 UI/session-store 断言及进程清理。lp269 仅完成证据诊断，`host smoke: not_run`。
- [x] 计划状态只根据实际交付更新；未满足最终验收和主任务审查前保持 active/in-progress，不为归档降低标准。

## 影响面

- 代码目录：预计 `src/extensionHost/promptInteractiveRuntime.ts`、`src/extensionHost/interactiveTurnStrategy.ts`、`src/extension.ts` 路由入口、`src/cli/cliRunArgStrategies.ts`、`src/cli/cliProcessRuntime.ts`、`src/cli/processArgv.ts`、`src/cli/processTermination.ts`、`src/interactive/*Runner.ts` 与对应 `src/test/`；最终文件取决于实现复用点，不预授权无关改写。
- 文档目录：本计划；若 CLI 支持矩阵、原生生命周期、平台注意事项或分层事实发生变化，再同步 `.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/cli-process-runtime.md`、`ARCHITECTURE.md` 中受影响事实。
- 配置与脚本：原则上不变；若能力映射影响产品可见支持或行为，更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。若改变 ontology 概念/关系/权限/流程/事实来源路径，按 ontology skill 更新并验证。

## 风险与缓解

- **模式路由回归**：CLI × 模式抽象可能误将不支持路径开放或把 parallel 误路由至 interactive。先从当前支持矩阵和所有调用入口建立显式表；保留 unsupported 原因及部门/Loop 专用约束，对支持和拒绝的每个组合断言。
- **能力/压缩/用量混淆**：模式能力、压缩候选资格、压缩执行准入和 UI 用量可见性是不同契约。不得用同一 `supportsInteractive`/`supportsCompaction` 布尔值替代真实的上下文；在能力表、压缩策略与宿主准入/展示侧分别保留原规则。
- **原生协议语义丢失**：将不同 CLI 生硬压为统一协议可能丢失 resume、cancel、turn 事件或结束信号。adapter 只共享输入/输出类型和调度端口；原生协议及其专属终止顺序留在各 adapter，并以各自回归测试护栏。
- **跨平台启动差异**：shell 解析、argv0、cwd/PWD、环境合并、detached 进程组、Windows `taskkill` 与 macOS 登录 shell 存在差异。逐项定义 policy precedence；每个平台分支可注入测试，不通过真实 shell 字符串拼接暴露参数注入。
- **成功/失败与资源所有权竞态**：spawn error、取消、超时、并行调用和重复 dispose 可能造成双回调、提前释放或孤儿子进程。将实际 child `close`、stdio drain、受管临时 overlay 清除和 adapter 级会话收尾作为不同证据；超时只触发收尾升级，不能伪造完成。保留可幂等收尾和重复停止测试。
- **安全边界扩大**：typed process API 若接收不可信命令、argv、env 或路径可导致任意执行/注入。保持 API 为受信任内部调用，外部输入先经过 CLI allowlist、固定能力映射和路径/配置验证；不记录密钥、配置原文或 prompt。
- **回滚**：分边界、小步提交候选实现（本计划本身不提交）；任一 adapter 语义无法证明等价时回退该 adapter 的抽取，保留独立旧路径并记录未收敛差异，不牵连已经验证的其它边界。

## 验证计划

- 最小相关验证：每边界改动后先 `npm run build`，再只运行受影响的编译后 `node:test` 文件；共享 `dist/` 构建与测试串行，遵循 `.ch/docs/TESTING.md`。具体命令按最终测试落点确定，不宣称尚未实现的用例已通过。
- 单元自测命令（按实际改动选择，构建和读取 `dist/` 的步骤不得并行）：

  ```sh
  npm run build
  node --test dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js
  node --test dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js
  node --test dist/test/cli/cliProcessRuntime.test.js dist/test/cli/processArgv.test.js dist/test/cli/processTermination.test.js dist/test/cli/cliProcessPolicy.test.js
  ```

  `cliProcessPolicy.test.js` 已列入 round-8 定向命令，能力表与入口测试分别见 round-7 和 round-10 原报告。上述命令用于后续受影响范围，不为刷新证据重复运行。运行 `npm run validate:whitespace` 校验文档空白。
- 扩展验证：受影响的 `src/test/cli/`、`src/test/interactive/`、`src/test/extensionHost/` 用例；必要时 `npm run test:core` 或 `npm run test:unit`。一个执行者独占 `dist/`。若进程/生命周期公共契约明显变化，再按范围核对 `npm run test:core` 与其它调用者。
- 矩阵断言：对七 CLI 与三平台测试 capability 支持/拒绝、启动命令解析、argv 原样传递、env 覆盖顺序、cwd/PWD、detached/shell/windowsHide/stdio 选项、平台终止动作、取消/close/drain 成功与失败。按 capability 表枚举可运行模式组合；明确原生协议不是跨平台模拟可替代的测试对象。
- 行为等价最小用例（作为独立验收项，不以既有测试或模拟接入代替）：模式路由逐 CLI 覆盖支持和拒绝的 interactive/one-shot/parallel 组合；手动压缩覆盖每 CLI 的显示/禁用、原生调用和结束/拒绝路径；自动压缩覆盖每 CLI 的候选资格、成功条件、时序/超时/停止以及 OpenCode 的原生策略和原交互宿主准入门；用量覆盖各 adapter 的成功、缺测/非法值、窗口来源与未知窗口、Tab/会话替换隔离、合法迟到与失效迟到事件，并显式确认 DSH `adapter-fallback` 和不压缩。按实际触及契约选择对应现有或新增的编译后测试，例如 `dist/test/extensionHost/promptInteractiveRuntime.test.js`、`dist/test/core/contextCompactionRunner.test.js`、`dist/test/interactive/<adapter>Runner.test.js`、`dist/test/extensionHost/interactiveTurn<Adapter>.test.js`、`dist/test/webview/clipagescriptruntimecoverage.test.js`；实施前确认具体案例/名称，禁止把此清单误报为已新增或已通过。
- 原生平台/CLI 证据按受影响契约判断：注入 `win32/darwin/linux` 的策略测试只能证明模拟分支。本次只在 macOS 对受影响的原生 CLI 生命周期、Shell、process tree、SDK/ACP 或宿主路径取证，逐项记录实际环境、命令、结果及报告路径。既有单测按未受后续改动影响且命令/指纹范围吻合的边界复用，不作为新增路径的证明。
- 本机与平台边界：2026-11-25 用户明确本次只做 macOS 原生测试。Linux、Windows 原生运行本次免测，不安排重做预检，不以 macOS、平台注入或 fixture 结果声称两平台原生通过。此次调整仅收窄原生验证范围，三平台策略分支和七 CLI 能力约定保持不变。
- 失败处理记录：出现失败时按实现缺陷、过期断言、测试夹具、环境问题、历史失败、平台未覆盖分类；修复后重跑失效的最小相关检查并记录范围，不能吞掉失败或把模拟/跳过当通过。

## 测试与清单同步

- 单元测试新增/更新：交互准备与失败/取消顺序、每种 CLI 的能力矩阵与拒绝路径、一次性/交互进程策略、平台参数与环境顺序、进程退出/stdio drain、超时/信号升级及幂等清理。
- 单元自测结果（均来自原报告，按对应改动范围复用，本轮未重跑）：
  - round-7 能力策略：`npm run build` 通过；七 CLI 能力矩阵/压缩/one-shot/parallel 定向集 205/205、能力策略与压缩 runner 子集 74/74、DSH 用量 fallback/OpenCode 面板/Webview 定向集 247/247 通过。未验证随后接入的生产主路由或面板注入修复。
  - round-8 进程策略：进程策略/生命周期及六交互 runner 定向集 288 项通过；最终 Claude stderr drain 改动后重新构建、Claude 22 项定向复测及 `git diff --check` 通过。注入平台/进程夹具（含 Claude Node 子进程）不代表真实 CLI 或原生进程树。
  - round-9 面板注入修复：隔离输出目录构建及 `opencodethinkingintegration.test.js` 10/10 通过，含 OpenCode/Codex 双向注入；未重跑 round-7 矩阵、压缩、DSH 或 Webview 套件。
  - round-10 入口集成：`npm run build`、交互准备/取消与失败、launch/turn 策略、生产入口 helper、OpenCode 模板及指定用量/会话回归定向集 192/192、代码范围 `git diff --check` 通过。Claude Windows shim 用例是平台注入，不是原生 Windows 运行。

### 能力与所有权证据

以下对应主通信 `main-task.md` 截至 lp33 的复核和相应尝试报告。`lp` 指主通信引用的尝试编号，`round-*.md` 指 `subtasks/` 中的报告文件名。

- 共享策略选择模式、准备启动并发出平台停止请求。Codex app-server 的 shutdown 和释放顺序、Claude SDK 的 `query` 与 `AbortSignal`、Grok ACP 的 session/cancel、DSH 和 Kimi 各自的退出等待与升级、ZCode 原生 `session/close` 及 OpenCode CLI 的原生命令由各自适配器保留。round-8 验证了注入的 `win32`、`darwin`、`linux` 分支及进程夹具。真实 Windows `taskkill`/进程树、Linux/macOS 原生 CLI 的 POSIX shell 与进程组，以及对应协议的 child `close`、stdio drain、session release 仍需按改动路径分别取证。
- lp16–18 压缩审阅见 `round-17-audit-compaction-capability-preservation.md` 和 `round-19-opencode-silent-host-rejection-test.md`。Codex、Claude、Grok、Kimi Code、ZCode 有手动入口、可进入交互成功后的自动链并通过宿主能力门槛，各自的原生压缩或回退仍由 `contextCompactionRunner.ts` 的 adapter 决定。OpenCode 手动入口可见，one-shot/parallel 共享成功后自动候选链，原生 `/compact` 策略保留。实际 `isInteractiveSupported("opencode")` 为 false，runner 在准备命令前拒绝。lp18 隔离构建和 `node --test dist/test/core/contextCompactionRunner.test.js` 71/71 验证静默拒绝不查命令、不准备配置、不启动流、不写 transcript。非静默拒绝、可准入夹具上的静默成功及 OpenCode 模板时序另有 round-7/10 定向证据。DSH 可交互，但无压缩入口、自动候选和 runner 准入，round-7 的能力、runner 与 Webview 集覆盖这一差异。
- lp17 用量审阅见 `round-17-audit-context-usage-boundaries.md`。Webview 按 Tab 存储用量，在 CLI/会话替换时清旧值。消息只含 `tabId`，同 Tab 的迟到事件由宿主校验归属。round-7 的 247/247 含 Webview 夹具，覆盖七 CLI 显示、来源、缺测与 Tab/会话分隔。逐 CLI 的解析与发布证据如下。

| CLI | 计数、窗口及迟到发布契约 | 已有定向证据及边界 |
|---|---|---|
| Codex | 主线程事件的 `last` 用量及事件 `modelContextWindow`，未知窗口为空，运行中缺测显示 pending。只发布当前 run 的更新。 | lp17 静态核对及 round-7 显示夹具。lp17 所列 round-7/8/10 定向命令未执行专属用量解析和主线程事件套件。 |
| Claude | 主请求的 input/cache/output 计数。精确模型匹配的最终窗口标记 `claude-model-window`，缺测不造占位。旧 run 或会话映射不匹配时拒绝发布。 | round-10 的宿主会话/旧回调集及 round-8 的 SDK runner 集。独立 tracker 套件不在这些定向命令内。 |
| OpenCode | 主 session 的 `step_finish` 用量，配置中精确模型 `limit.context` 标记 `opencode-model-window`，未知为空。排除子任务及过期 attempt 的异步窗口结果。 | round-10 的 one-shot 宿主和共享模板用例、round-7 显示夹具。独立 parser/metadata 套件不在这些定向命令内。 |
| Grok | 匹配 session 的 ACP 用量或响应计数，窗口来自协议事件，运行中缺测显示 pending。完成后只允许原 Tab/session/runner 且无新 run 的快照。 | round-8 runner 夹具含合法迟到快照，round-7 覆盖显示。独立 Grok protocol suite 不在该批定向命令内。 |
| DSH | ACP `usage_update.used/size`，窗口保留 `adapter-fallback` 标注。完成后仅原 Tab/session/runner 且无新 run 时接受迟到用量。 | round-7/10 的 `dshInteractiveHostWire` 用例覆盖旧 run、非法值与 fallback，round-8 含协议/runner 夹具。实际 DSH loopback/API 未验证。 |
| Kimi Code | ACP `usage_update.used/size`，窗口按 `kimi-config-window` 标注模型目录配置值，缺测不造占位。完成后仅原 Tab/session/runner 且无新 run 时接受迟到用量。 | round-8 的协议与 runner、round-7 显示夹具。上述定向集没有独立宿主迟到发布集成证据。 |
| ZCode | `projection.contextUsed/contextWindow`，标记 `zcode-projection`，初始化零值和缺失值不发布。启动和流式用量由当前 run 及其原 runner 守卫，有 UI session 时同时校验该会话的 runner。 | round-8 runner、round-7 显示夹具及下述 lp21/lp26 所有权用例。独立 projection parser 未列入这些定向命令。 |

- lp17 发现 ZCode 同 Tab 的旧 run 或被替换 runner 可发布用量。早期 lp19 的 12/12 未覆盖失主早退跳过结算。lp21（`round-21-zcode-usage-owner-guard.md`）经审接受，构建、ZCode turn 12/12、宿主筛选集 2/2。仍有效的原 run 经中文 `RUNNER_DISPOSED` 错误收尾，已替换的 run 不影响新 run/session。lp26（`round-28-daily-fix-zcode-owner-boundaries.md`）最终构建和 `managedZcodeDisposal` / `interactiveTurnZcode` 23/23，覆盖两种释放顺序及模拟的 exit/close/stdout EOF 屏障、失效等待者静默、原错误保留、替代者只发送一次以及失效回放无面板/调试副作用。lp21 的宿主 2/2 对应启动期替换，lp26 对应等待释放和回放。两组结果均限于夹具。

### 当日回归与模拟证据

- round-23 首次 `npm run test:unit` 构建通过，Node 6,125 通过、21 失败、3 跳过，退出 1。`round-23-daily-full-regression-evidence.md` 所列 Python 白名单 78 通过、1 跳过，跳过项需要原生 Windows `cmd.exe`。发布器、发布相关测试及 Python 全量发现均未运行。后续五组定向处理涉及命令探测与会话健康夹具、ZCode 所有权、普通 Loop+ 租约清理诊断、部门冷停止夹具，范围见各 `round-28-daily-*.md` 报告。部门冷停止只定向验证 `poll-disconnect`，同一准备段的其余三个场景未在该尝试单跑。
- lp29（`round-29-daily-full-regression-evidence.md`）在 `master@93326019` 集成工作树执行一次 `npm run test:unit`。TypeScript 构建通过，Node 汇总 6,147 项，其中 **6,143 通过、1 取消、3 跳过**，汇总 fail 为 0，另列 `claudeToolPolicy.test.js` 文件失败。采样显示示例解析器子进程停在 `fs.readFileSync(0, "utf8")`，约 8 分 51 秒后用 TERM 中止，命令退出 **143**。该快照前后源码、测试和 Git 状态一致，本次运行没有正常结束。
- lp30 将 Claude 示例解析器测试的 stdin 夹具从同步子进程管道改为普通文件 fd，生产提示与断言保留，定向 6/6 通过。lp32（`round-33-daily-post-stdin-full-regression.md`）在修复后的 `master@93326019` 集成工作树执行一次最终 `npm run test:unit`，内置构建、Node runner 和整条命令均退出 **0**。最终汇总 **6,152 项，6,149 通过、0 失败、0 取消、3 跳过**。两个 stdin 回归用例和该文件其余四项均通过，工作树文件指纹在检查前后一致。跳过项不计入通过数，涉及真实 DSH 会话的 cwd/恢复、Loop+ 验收失败后恢复及配置的 loopback 模型。
- 宿主与技能证据：round-12 在 macOS 15.6.1 arm64 / VS Code 1.144.0 的同次隔离 Extension Development Host 确认扩展激活、`sinitek-cli-tools.openPanel` 成功、`textarea#promptInput` 可见且尺寸非零；测试宿主退出 0 且进程组退出，AgentHost `listen EINVAL` 警告未进一步诊断。round-13 交付技能，报告确认与原稿逐字节一致且格式/空白检查通过；未重启宿主。此次 smoke 不覆盖 Windows/Linux 原生运行、安装态扩展或真实 CLI/SDK/ACP/模型调用。
- `round-23-daily-vscode-simulation-evidence.md` 使用初次回归的构建在 macOS 15.6.1 arm64 / VS Code 1.144.0 再验证真实隔离宿主激活、打开面板及输入框渲染，宿主退出 0、进程组清空。该次禁用 CLI，未提交提示。两项独立 Chromium/Playwright fixture smoke 均退出 0。`scripts/loop_plus_acceptance_navigation_smoke.cjs` 覆盖 280px 下同名成员初验/复验 4 次定位且无浏览器错误。`scripts/department_workspace_capacity_settings_smoke.cjs` 覆盖 1440px 深色及 280px 浅色的容量设置、继承、保存/重载和错误重试。浏览器 fixture 模拟 VS Code API，未串联生产宿主执行。
- lp33（`round-33-daily-final-affected-simulation.md`）核对工作树指纹与 lp32 一致，使用其 `dist/` 补跑隔离 macOS 15.6.1 arm64 / VS Code 1.144.0 Extension Development Host。ZCode 所有权和 Loop+ 清理诊断模块都在扩展入口的加载依赖内。真实 VS Code API 确认扩展已激活并成功执行 `sinitek-cli-tools.openPanel`，CDP 在同一 workbench 的 Webview 中确认 `textarea#promptInput` 可见（231 × 58.5 px）。宿主及 harness 均退出 0，未观察到本扩展错误，临时数据与进程已清理。隔离配置禁用全部 CLI 并将命令替换为 `/usr/bin/true`，没有提交提示或触发真实 ZCode 执行与 Loop+ 生产准入清理。
- lp33 复用 round-23 的两项 Playwright 结果。Loop+ 导航的 83 个本地编译依赖、容量设置的 115 个本地编译依赖均不包含上述两个生产改动模块，对应源码没有在原烟测启动后写入。导航脚本、manifest 和 `media/` 未见工作树差异。容量主脚本和主题夹具脚本也无差异，修改时间早于原烟测。两项原有结果仅覆盖相应 fixture，lp33 未重跑浏览器。
- lp33 的范围限于 macOS 宿主加载、面板打开和可见性。原生 Windows/Linux、已安装 VSIX、真实用户提示与模型调用仍缺运行证据。后续如有改动，按改动路径及构建的一致性核对证据是否仍适用。
- 失败处理记录：round-10 首次定向测试的新增断言经修正后以最终通过结果为准。round-12 的外层目录清理 `ENOTEMPTY` 是该尝试的失败记录，与 smoke 结果分开；round-13 技能交付不消除该清理失败，也不推断非空原因。

### 原生 CLI 生命周期诊断

- **Codex（lp36，`round-38-daily-codex-native-drain.md`）** 在 macOS 15.6.1 arm64、Node v24.22.2、Codex CLI 0.167.2 上，用与共享 `dist/` 对应的独立构建副本执行 `scripts/verify_codex_owned_native_drain.js --live`。隔离 HOME/CODEX_HOME 限制到本地 Responses fixture，两个预期提示请求均到达回环服务。诊断退出 `0`，`passed: true`、`forcedCleanup: false`。两次均观测到 `turn/completed`、业务 promise 结算、NDJSON EOF 与队列排空、请求 consumer 收尾和 runner listener 解除。两个 app-server 子进程先 `exit` 再 `close`，均为 `0`、无信号，stdin `finish/close`、stdout/stderr `end/close` 均已观测。第二个 app-server 用 `thread/resume` 恢复同一原生线程，线程文件归属于隔离 CODEX_HOME。验证器清理临时根后，诊断另行清理外层 TMPDIR 内残留的空启动锁并确认目录为空。证据限于该版本、快照与回环 fixture 的自然退出，真实用户会话、远程模型、取消、超时及异常 stdio 仍未覆盖。
- **ZCode（lp37，`round-38-daily-zcode-native-lifecycle.md`）** 在 macOS 15.6.1 arm64、Node v24.22.2、`zcode-app-cli` 3.16.3-41 / `zcode-runtime` 0.17.0 上，用隔离 HOME、设置及会话数据执行 `scripts/verify_zcode_runner_lifecycle.js --live`。A/B 创建与订阅成功，B 在 A 关闭期间发出读取，A 完成 dispose 后收到 B 自己的快照。A 的 `session/close` ACK、stdout/stderr EOF、child `exit` 和 `close` 均在 `dispose_complete` 前观测到，两次 `dispose()` 返回同一 Promise。新进程以原 A ID 调用 `session/resume` 得到 RPC `-32004`，无成功快照，脚本退出 `1` 且 `passed=false`，原因未确定。失败后 B 有 `session/close` ACK，恢复进程只观测到 stdin 结束及后续资源事件。五个受跟踪子进程均为 `0`、无信号退出并触发 `close`，两个可读流均到达 EOF，隔离根目录已删除。B 和恢复进程缺少单独的 dispose Promise 完成观测。提示生成、真实用量发布、用户会话及跨进程持久化状态均未验证。
- **OpenCode（lp44，`round-44-daily-opencode-native-drain-current-source.md`）** 在 macOS 15.6.1 arm64、OpenCode 1.19.5 与本地 provider 下，两轮共用同一原生会话，两次任务进程自然退出，stdio 和 consumer 排空，生产 receipt/stopped 收尾得到确认，`forcedCleanup=0`。复用以报告所核对的 94 文件生产依赖闭包为界，不覆盖真实 VS Code 宿主或用量发布。
- 诊断报告的 `completed` 表示取证完成，不改变 ZCode 恢复失败结论。按路径继续核对 macOS 受影响的真实 CLI 会话与用量发布、其余退出和资源释放场景。lp32 的三项 DSH 跳过和 lp33 禁用 CLI 的覆盖限制继续适用。

### 后续 macOS 原生 CLI 与定向取证

- 主审接受 lp54（`round-59-macos-zcode-persisted-session.md`）对已交互、已持久化的 ZCode 会话恢复：合成回环回合后，新 PID 以原 ID 和同 workspace 恢复快照并订阅，两进程正常退出、双流 EOF，所属 Tab 收到 `24/32000`。空会话的历史 `-32004` 失败结论仍适用，恢复阶段用量为 `null`。
- 主审接受 Codex lp58 的单轮所属 Tab `12/258400` 发布，以及 OpenCode lp59 对 lp44 原生事件的回放、实际模型元数据查询和所属 Tab `0/32768` 发布。主审也接受 Claude lp73（`round-74-macos-claude-sdk-usage.md`）的 29/29 定向测试及合成双文本块用量 `90/200000`，以及 Kimi lp77（`round-78-macos-kimi-acp-usage.md`）在原生 ACP `end_turn` 前向所属 Tab 发布唯一一条 `23/8192`。Kimi 报告保留外层 shell 退出 1 与探针断言通过的区别。这些发布证据止于探针宿主接口；OpenCode 的零值有效，非零用量与压缩后刷新未覆盖。
- `round-59-macos-grok-acp-usage.md` 报告真实 Grok ACP 本机合成回合向所属 Tab/session 发布用量，进程清理升级至 `SIGKILL` 且双流关闭。`round-59-macos-dsh-isolated-live-regression.md` 报告分别按名称启用并通过三个 DSH 用例（cwd/原会话恢复、Loop+ 验收失败后恢复、合成回环模型与 `adapter-fallback` 用量）；这些是独立的具名集成结果，全量套件的三项跳过仍按实际运行计数。两份报告均限于本机合成服务及对应探针，未覆盖 VS Code Webview、安装态或外部模型。
- 主审接受 lp60 的 macOS 自有进程组 TERM 后升级清理（合成子进程）及 lp61 的真实 Codex 热回合中断、原线程保留和随后排空（分别见 `round-61-macos-owned-process-group-escalation.md`、`round-61-macos-codex-hot-turn-interrupt.md`）。这些断言按各自的进程和 CLI 场景复用。

### 修复后 macOS 全量回归

- 主通信 lp78 已回执 `round-266-macos-post-repair-full-regression.md`，该报告对照原始执行 `round-79-macos-post-repair-full-regression.md`。工作树、构建、记录中的测试和依赖输入在 `a7895adaedb757412efd078a8b4f084aee9463ea` 对应快照匹配。复用一次 `npm run test:unit` 的结果，内置 `npm run build`、Node runner 和 npm 总入口均退出 0。**6,164 项，6,161 通过，0 失败，3 跳过**。三项 DSH live 因该次未启用而跳过。此证据覆盖对应快照的 macOS 构建和 Node 单测；真实 Extension Host、UI/store 与安装态需要各自的运行证据。

### Linux 原生验证环境预检

- **Colima（lp40，`round-40-daily-linux-native-process-policy-check.md`）**：本地无 `node:24-bookworm`，唯一一次 `linux/arm64` 镜像拉取以退出码 `1` 结束，Docker 报告本地代理连接被拒绝（`connect: connection refused`）。未启动容器、构建或运行测试；这是环境阻塞，不是测试失败，本轮不重复拉取。
- **Parallels（lp41，`round-41-daily-linux-parallels-native-process-check.md`）**：Ubuntu 26.04 LTS ARM64 来宾的 Node 为 `v22.22.1`，不满足 Node 24 前置条件；唯一可见的源码挂载 `/media/psf/Home` 为 `fuse.prl_fsd`，挂载选项为 `rw`，不满足只读输入要求。预检按约定在复制源码、安装依赖（`npm ci`）、构建或运行测试之前停止；未写入工作树或更改 VM 配置，`prlctl status` 确认 VM 已恢复 `suspended`。
- 两次均只记录环境前置条件，未取得 Linux 原生子进程退出（`exit` / `close`）或 stdio 排空的证据，不判定测试通过或失败。Windows 原生行为也未验证。两平台按最新范围记为本次免测，预检历史不改写。

### 文档同步

- 功能清单：只有支持 CLI、模式、用户可见行为/流程/权限/验收变化才更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`；纯内部行为等价重构明确记为无需更新。
- 相关文档同步：实际矩阵/生命周期/事实边界变化时更新 `.ch/docs/references/cli-runtime-reference.md`；进程策略或资源释放契约变化时更新 `.ch/docs/design-docs/cli-process-runtime.md`；架构分层变化时更新 `ARCHITECTURE.md`。仅内部结构变动且事实未变化时不动这些文档。仅本体概念/关系/规则/跨域流程/来源变化时更新 ontology 并运行 `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`；否则记录无需同步原因。

## 任务列表

Tasklist:
- [completed] 核对仓库规则、支持矩阵、配置与 argv 策略、交互 turn/lifecycle registry、OpenCode 模板、平台进程实现及并发差异。
- [completed] 接入一次性 runtime 和六个交互适配器的共享进程策略；主任务已通过 lp8 代码审查及相应证据。
- [completed] 建立七 CLI × interactive/one-shot/parallel 能力策略表（round-7），并修复面板策略注入（round-9，主审通过）。
- [completed] 按能力策略集成交互准备与主入口路由，覆盖报告所列取消、失败、会话所有权和不支持组合（lp10 代码审查通过）。
- [completed] 取得隔离 macOS Extension Host smoke 实测（round-12），并在项目规范路径交付经验技能（round-13，主审通过）。
- [completed] 记录 lp16–18 压缩资格与宿主准入的审阅和定向证据，以及 lp17 用量审阅和 lp21/lp26 ZCode 所有权回归的实际范围。
- [in_progress] 按七 CLI 各自能力和所有权约定，补核 macOS 受影响路径上实际用量事件到当前 Tab 的发布与展示。
- [completed] 记录 lp32 最终集成 Node 回归、lp33 同次构建的 macOS 宿主实测及 round-23 浏览器证据的复用依据。
- [completed] 补录 lp36 Codex 自然 drain 和 lp37 ZCode 关闭、清理及恢复失败证据。
- [completed] 补录 lp40 Colima 拉取阻塞和 lp41 Parallels 环境预检，未验证 Linux 原生进程行为。
- [completed] 按用户确认将 Linux、Windows 原生运行标为本次免测，保留三平台注入策略及预检记录。
- [completed] 记录后续 macOS 原生 CLI、所属 Tab 发布、ZCode 已交互会话恢复和三项具名 DSH 集成结果的适用范围。
- [in_progress] 补核其余适用的 macOS 原生 CLI 生命周期场景，分别记录进程 close、stdio drain 和 session release。
- [completed] 记录 lp78 的修复后 macOS 全量回归及 lp268 的技能文档验收。
- [in_progress] 以当前工作区匹配的完整构建获取同次严格外联隔离的 macOS 历史 UI/store 证据；保留 lp45 的独立 UI/store 结果、lp47 的运行失败和 lp49 的技能验收。lp269 诊断完成，宿主烟测未执行。

## 决策记录

- 2026-11-24：复用既有配置、argv、交互 lifecycle/turn 和 OpenCode 模板策略；本次收敛不等于这些策略缺失。
- 2026-11-24：协议隔离在 CLI typed adapters，平台差异隔离在 process policy；不以 vendor-neutral 原生协议取代 Codex app-server、ACP、ZCode 等不同协议。
- 2026-11-24：矩阵单测模拟三平台分支，不能替代 Windows、macOS、Linux 各自原生主机验证；本机当前为 Darwin arm64。
- 2026-11-24：复用主审已接受的进程接入、策略注入修复、路由/交互准备代码和隔离宿主/技能证据；能力/行为保真和原生生命周期按证据缺口继续核对，不重开已经通过的验收项。
- 2026-11-24：本轮文档校正不改变 CLI 能力或 ontology 语义；不触碰或归因共享工作区其他事实文档差异。发现实际语义/来源改变时再更新相应文档并校验 ontology。
- 2026-11-25：按用户确认，本次原生运行验收仅限 macOS，Linux、Windows 本次免测。保留三平台注入策略、早期预检事实及七 CLI 行为约定。
- 2026-11-25：按用户补充要求保留版本 `1.10.4`。本任务不发布，不执行发布脚本。普通 Git 提交和推送等必要验收通过后，再核对交付文件、分支和远端。

## 当前结论

一次性 runtime 与六个交互适配器已接入共享进程策略。模式路由、压缩资格与准入、用量显示来源及 ZCode 所有权已有对应审阅与定向证据。各 CLI 仍保留自己的协议、用量来源和收尾契约。

整体保持 `active/in-progress`。本次原生验收仅限 macOS；Linux、Windows 本次免测，分别保留仅预检和未验证的历史结论。lp32 回归、macOS 面板入口、浏览器 fixture 和后续 CLI 定向结果均按各自范围复用。lp78 的全量 Node 回归已回执，lp268 的技能文稿已验收，lp269 的历史标题宿主烟测未执行。保持同次严格外联隔离的历史 UI/store，以及其余适用的 CLI 生命周期和用量展示验收项。适用验收项有证据且经主任务审查后再归档。

### lp46：合成历史标题的网络隔离复验（未完成）

- 复用 lp45 的 UI/store 断言与 lp44 构建；本轮 `diff -qr /private/tmp/round44-opencode-native-drain.wQj0r1/build/src "$PWD/src"` 为 0，HEAD 为 `93326019fe00b26f807aad6be3d45415890ec406`。macOS Seatbelt `sandbox-exec` 正、反向探针确认 `deny network-outbound` 可阻断本机 TCP/UDP/Unix 外联，也会阻断连接同一端口的非回环地址；因此移除了任何 CDP 出站例外，使用入站 loopback CDP 驱动 UI。
- 收紧规则后仅启动一次 VS Code 1.144.0 安装版宿主，带全新合成 HOME/workspace/extensions、短 TMPDIR、无代理、禁用 CLI 与 `/usr/bin/true` 命令、仅入站 loopback CDP、拒绝外联和隔离当前真实 HOME 读取。主程序 PID `45339` 在 DevTools listener 检查前退出，退出码 1；日志摘要仅能确认出现 DevTools listening 与权限拒绝，无法确定具体阻断的宿主依赖。进程组已排空，隔离目录已删除。因诊断不足，不扩大 Mach/文件/网络权限，也不启动普通网络可达宿主。
- 这不是 lp45 历史标题验证的替代，也未在受限宿主中观察到 Extension Host 的同进程 denial/CDP/UI/store 证据；旧 lp45 UI/store 仍有效，但明确不证明零网络。此项未解决，主任务应保留该边界。若另行调查，先在受限最小配置下定位宿主具体必要权限，再独立审查最小例外；不可外推至真实用户数据/CLI/模型、其他 CLI 或 Linux/Windows。

### lp47：分阶段诊断后的受限宿主复验（未完成）

- 使用 lp44 隔离构建前，再核对完整 `src` 与 `tsconfig.json` 均相同（`diff` 退出 0；HEAD `93326019fe00b26f807aad6be3d45415890ec406`），不重建共享 `dist`。macOS 15.6.1 arm64、Node v24.22.2、安装版 VS Code 1.144.0 / commit `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`。
- 先以同一拒绝所有外联、拒绝真实 HOME 访问的 Seatbelt 规则启动无扩展空工作台：主进程 PID/PGID `56866` 正常报告 CDP，`lsof` 确认为该进程组唯一绑定 `127.0.0.1:59040`，loopback `/json/version` 返回协议 `1.3`，随后进程组正常退出并清理。此阶段表明空工作台主进程和入站 loopback CDP 可用，不能定位扩展宿主权限错误。
- 随后一次真实扩展烟测仍在 Extension Host 同进程探针及历史 UI/store 断言前以 VS Code code 1 退出；该次 CDP 所有权及协议已先核验，故不同于 lp46「listener 所有权确认之前退出」。有限 stderr 摘要仅有 `Operation not permitted`，未能保留具体资源/系统调用或可靠 Extension Host PID。主进程、权限拒绝与 Extension Host/测试加载失败的具体关联仍未知，不将其猜作端口竞争或指定 Mach/文件权限，也不放宽网络门控。
- 子进程组排空、无强制清理，隔离 HOME、user-data、extensions、workspace、短 TMPDIR 均删除。lp45 合成 Codex 历史的真实历史按钮、中文标题、协议隐藏、自定义标题和 store 持久化断言仍是成功证据，但不是零外联宿主证据；lp47 没有重跑或宣称这些断言通过。真实用户数据、CLI/模型/外部服务及其他 CLI、Linux/Windows 均未覆盖。后续如继续，先改善最小非敏感的 Extension Host 阶段归因；在找到有证据的安全原因前，不加权限例外或用普通网络可达宿主替代。
- lp49 已验收 `.agents/skills/vscode-extension-host-smoke/SKILL.md` 的隔离证据说明（`round-49-daily-host-smoke-isolation-skill-update.md`）。lp47 的退出码 1 属于 VS Code 主进程，未取得 Extension Host 子进程 PID 或退出码。该验收仅覆盖技能文稿，不改变 lp47 运行失败，也不为 lp45 补上零外联证据。

### lp268–269：烟测技能已验收，历史标题宿主待验证

- lp268（`round-268-history-host-smoke-skill-guidance.md`）经主审接受 [烟测技能更新](../../../../.agents/skills/vscode-extension-host-smoke/SKILL.md)。该文档分别记录 Node 合成、真实宿主创建与激活、同宿主隔离拒绝、同次历史 UI/store 四类证据。清理说明记录进程身份采样的局限、采样与发信号的非原子边界，以及归属不明时拒绝信号并将清理记录为未确认。验收覆盖技能文稿及其定向检查。
- 最新宿主尝试 lp269（`round-269-daily-history-title-vscode-host-smoke.md`）完成有界诊断，**未启动 VS Code，`host smoke: not_run`**。旧 lp76 在 workbench 就绪前报 renderer `crashed`/6，未取得宿主标记；保留转储不足以归因，崩溃原因和可证实的安全启动修正仍未知。lp269 核对的 lp78 源码、测试输入与 `dist` 指纹匹配；媒体与旧宿主构建依赖等差异仍使完整烟测闭包无法确认。旧 lp45 UI/store、lp47 运行失败及后续合成清理检查继续按原范围记录。
- 同次真实 Extension Host 激活、宿主内网络和 HOME 拒绝、历史按钮和中文标题恢复、协议提示隐藏、自定义标题保护、session-store 持久化及真实进程清理仍无联合运行证据。恢复实测需先获得能定位启动失败且支持不降低隔离的修正依据，再核对完整隔离构建闭包匹配。此前保留验收门槛和 active 状态。
