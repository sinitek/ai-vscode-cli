# Loop+ 显式任务依赖

- 日期：2026-11-17
- 类型：feature
- 关联计划：无；本 feature 的测试与文档同步均记录于本计划，不另建 test/docs 计划。
- 状态：completed
- 完成范围：实现、补充四项验收需求及约定 macOS 源码验证已主审通过；本轮最终文档交付仍待独立主审，父任务完成由宿主决定。
- 负责人：主任务协调与独立验收；原始四个交付 owner 与补充交付 owner
- owner：explicit-deps-final-docs 续接原文档 owner 完成事实同步与归档；不接管源码
- claimed_at：2026-11-17
- claim_ttl：本轮最终文档交付期间；交付后由主任务独立审查
- handoff_to：主任务独立审查最终文档与全部开放事件门禁

## 背景

本 feature 把 Loop+ 任务依赖变成显式数据，并按补充需求同步新批次依赖优先验收与四项上限，防止后继把“执行结束”误当作“前置可消费”，并保持独立工作并行推进。2026-11-17 主任务已确定显式依赖的派发契约；仓库内稳定规格见 [调度设计](../../../design-docs/loop-plus-scheduling.md#显式任务依赖)。本计划是唯一执行记录，最终实现和约定验证已完成并归档；契约、各次执行事实和独立审查分别列明，不能把本次文档提交写成已验收。

## 目标

以同一父任务稳定 `subtaskId` 上的 `dependsOn?: string[]` 贯穿解析、调度、持久化、提示、投影与恢复。后继只在前置最新 attempt 满足真实确认条件时准入；无进展的依赖等待能回到主模型处理，不形成永久 wait。补充目标：共享 `LOOP_PLUS_ACCEPTANCE_BATCH_MAX = 4` 只限制单批验收，不影响并发、派发或轮次额度、不等待凑满；新批次按依赖前置优先和独立项稳定到达顺序领取，保留已冻结批次、报告 FIFO 和最终门禁。

## 范围

| 所有权 | 负责交付 | 集成关注 |
| --- | --- | --- |
| explicit-deps-contract | 共享纯 helper、decision/store 契约及对应测试 | trim/复制/拒绝非法字段、reprompt 三态语义、记录往返 |
| explicit-deps-scheduler | scheduler spec/execution/seenAttempt、图校验、满足条件、阻塞与恢复及对应测试 | 新旧快照、最新 attempt、前向引用、无副作用拒绝、独立回填 |
| explicit-deps-host | orchestration/strategies/prompt、任务投影与宿主测试 | 整份决策后提升、先持久化后启动、不可进展 wait、恢复/巡检 |
| explicit-deps-docs | 调度设计、能力规格、FEATURE_INVENTORY、cli-plugin-runtime ontology、本计划 | 事实来源与证据状态，不修改其它 owner 源码/测试 |

补充交付所有权：`explicit-deps-review-order` 续接 scheduler，负责 `prepareReviewBatch` 和行为测试；`explicit-deps-review-protocol` 负责共享四项常量与提示/协议测试；`explicit-deps-review-docs` 负责 round-12 五份阶段文档。宿主新接线由原 orchestration owner 在生命周期修复审查及 API 落定后续接；`explicit-deps-review-host` 主体及 `explicit-deps-review-host-prompts` 提示修复、`explicit-deps-review-order-boundaries` 内核边界修复均已主审。`explicit-deps-prompt-fixture-native` 完成局部夹具修正和最终约定 macOS 验证，经主审通过。最终文档仍由原 owner 统一维护，不另开竞争 owner。

各 owner 按稳定契约并行；共享核心文件每个只有一个 owner。写前重读，保留他人更改，小型不竞争修改局部协调并报告；共享符号或契约竞争交由主任务重排。各实现与阶段文档已有对应完整验收；本次最终文档仍须独立审查，不能仅凭测试通过或存在测试源码收口。

## 非目标

不扩展工作区隔离、预算系统、新证据系统、UI 布局、全局 batch barrier 或共享轮次门禁。不改变已有冻结批次及报告 FIFO、宿主调度/启动所有权、原冲突和容量保护、最终完成门禁或经典 Loop 行为。允许在领取全新验收批次时改变事件顺序，不让晚到前置改写当前批次；群聊只读投影既有冻结前缀，无主题或交互变化。不修改运行中的 scheduling state、active ids、任务记录或 loopPlus 快照；不提交、发布或执行发布脚本。

## 验收标准

- [x] 普通 dispatch 省略/[] 无依赖，引用同父任务稳定 ID；与 attempt/session/continueFromSubtaskId 无推断关系。纯 helper 保序、trim、复制且拒绝非法类型、空白、自依赖及重复。
- [x] 同批有效候选可前向引用；未知引用、环和被局部拒绝候选充当前置均拒绝。坏图候选集合不入队、不启动、不改变状态，既有局部拒绝语义保留。
- [x] 只按 seenAttempts 追加顺序取最新 attempt；完整验收须 completed + reviewed/passed，免完整验收须 completed + requiresAcceptance=false + reported。失败/停止/关闭/未确认均不放行。
- [x] 后继受阻保持 pending、不占运行/写锁，独立项回填；修复原 ID 的新 attempt 能解阻，不同新 ID 不自动替代；已启动后继不被后续重派自动取消。
- [x] reprompt 缺省继承依赖、[] 清空、列表替换，requiresAcceptance 缺省 true。控制图预检先于停止旧 attempt，不能引用同决策尚未 dispatch 的新 ID。
- [x] 报告/验收确认 API 不自行提升；整份决策确认/控制/派发应用后提升、先持久化后启动；同决策确认后重派无提前启动，提交失败回滚且不 launch。
- [x] dependencyBlocks 为每条未满足依赖的独立副本，仅非空时进入 view/dispatch，原冲突与容量字段兼容；提示与任务投影保留依赖。
- [x] 全部 pending 受依赖阻塞且无 running/review/report 时唤醒主模型；不可进展 wait 有界纠错，恢复/巡检覆盖且不绕过停止保护。
- [x] version=1 旧快照缺字段兼容，新 execution/seenAttempt 持久化并一致；损坏字段、未知引用、环及不一致拒绝恢复。
- [x] 新批次使用共享四项上限，不等待凑满、不改变其它额度。事件使用自身 seenAttempt 的依赖、前置使用最新 attempt；独立就绪项稳定按到达顺序，链/菱形/传递阻塞覆盖，截断不能让后继越过未选入本批的待审前置。
- [x] 前置 open 或报告未确认只暂缓相关后继；reviewed（包括 failed）、reported 或 closed 允许独立审查既有后继交付，但不放宽新的 pending 执行成功条件；报告先按 FIFO 显式确认，后续决策再领取相关后继。
- [x] `prepareReviewBatch` 返回 items/dependencyBlocks/view 独立副本，正安全整数校验变更前抛 RangeError，stopped/completed 不变更；实际 currentReview+reviewQueue 前缀与选择一致，未选项稳定保留，无候选时 currentReview=null，状态变化才提交一次，不加持久队列/快照版本。
- [x] 宿主全新批次显式准备并先持久化再请求，失败回滚 scheduler 与新 MainStep，不启动/确认；已有冻结批次、重试/刷新/同宿主续跑及消息/报告前缀保持，晚到前置不改写当前批次。群聊仍只读投影该真实前缀。
- [x] 全队列不可领取时不发空 review、不以 raw hasReview 造成 consumer/watchdog 忙循环；有活跃前置可等待、无活跃工作则回主模型有界处理，消息/报告可先消费。未确认事件/报告/消息及 running/pending 均保留完成门禁。
- [x] 设计与两份能力清单的阶段交付已独立主审；实现、契约、改动合理性、边界及覆盖缺口已审查。最终状态/ontology 激活/归档同步由本轮提交，仍待独立文档主审。
- [x] 源码稳定后单一执行者完成约定的 macOS 原生验证与未覆盖依赖回归，准确记录平台边界；Windows 未执行不声称通过。

## 影响面

- 代码目录：`src/loopPlusDependencies.ts`、`src/loopPlusDecision.ts`、`src/loopTaskStore.ts`、`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusDecisionStrategies.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/loopPlusPanelProjection.ts`。
- 文档目录：`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`、`.ch/docs/TESTING.md`、`.ch/docs/runbooks/local-development.md`、`.ch/docs/runbooks/PITFALLS.md`、本计划。
- 配置与脚本：不新增配置；遵循 `.ch/docs/TESTING.md` 的现有验证入口。
- `ARCHITECTURE.md`：无需修改，纯内核/宿主/投影边界未变，字段与准入细节收敛至既有调度设计。根 AGENTS 与架构边界不变；已验证的异步收尾教训进入 `runbooks/PITFALLS.md`，最新原生范围同步 `TESTING.md` 和 `runbooks/local-development.md`。按 MEMORY 规则，稳定契约已进入设计/能力/ontology，阶段证据由本归档保留，可复用操作进入 runbook；无需再向其它热区重复写入，不更新 ROLLING_SUMMARY 或 EVENT_MEMORY。

## 风险与缓解

- 同决策先确认旧成功再重派可能误放行后继：延迟提升至完整决策之后，补宿主顺序测试。
- 局部候选拒绝、历史依赖与控制副作用交错可能破坏图：分离局部过滤和图预检，旧执行停止前完成控制校验。
- 损坏字段被归一化清空可能绕过依赖：恢复严格检查 execution/seenAttempt 与完整图，旧缺字段单独兼容。
- 选序与冻结/提交前缀不一致可能丢失或重复事件：只在新批次显式准备，将结果写回实际前缀，先持久化，失败回滚；复用 heldBatchIntact、提交与群聊前缀校验。
- raw hasReview 与可领取项混淆可能空审查或忙循环：复用内核阻塞结果，状态改变后重算；活跃等待与无活跃死等分流，有界纠错不先重置计数。
- 失败前置导致无可运行工作：暴露逐项原因并唤醒主模型，有界协议纠错/blocked，保留未完成事实。
- 共享工作区和 dist 有并发风险：不覆盖其它 owner 文件，各 owner 临时输出隔离；统一验证只由单一执行者串行操作共享 dist。提交失败不启动，不通过手改快照绕过门禁。

## 验证计划

- 最小相关验证：各代码 owner 使用唯一临时输出，按仓库 tsconfig 编译本范围测试与实际依赖，启用 `--noEmitOnError` 后用 `node --test` 执行；精确命令、源文件、结果由各自报告提供。所有共享接口已落盘并经实际编译/测试，不能用 stub 冒充集成通过。
- 实际测试入口：`src/test/loop/loopPlusDependencies.test.ts`、`src/test/loop/loopPlusDecision.test.ts`、`src/test/loop/loopTaskStore.test.ts`、`src/test/loop/loopTaskStorePersistence.test.ts`、`src/test/loop/loopPlusScheduler.test.ts`、`src/test/loop/loopPlusSchedulerDependencies.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/test/extensionHost/loopPlusDecisionStrategies.test.ts`、`src/test/extensionHost/loopPlusPromptBuilders.test.ts`、`src/test/extensionHost/loopPlusHandoffContracts.test.ts`、`src/test/extensionHost/loopPlusAcceptanceCompletionGate.test.ts`、`src/test/extensionHost/loopPlusDependenciesIntegration.test.ts`。各组实际执行与主审范围见下表，路径存在与源码检查本身不等于通过。
- 补充最小覆盖：内核两组 scheduler 文件及新增选序用例，协议 decision 与 PromptBuilders；宿主接线五组为 Orchestration、DecisionStrategies、HandoffContracts、AcceptanceCompletionGate、DependenciesIntegration，覆盖四项截断、真实重派历史、冻结/晚到、落盘回滚、报告先确认、零可选等待/死等、恢复/watchdog 及最终门禁。由各 owner 隔离输出执行，文档 owner 不代跑。
- 文档/ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`；本轮最终八份交付的结构、引用路径、ontology anchor、归档唯一性、旧 active 引用清理及保留式核对。
- 统一源码验证（已完成）：源码稳定后由单一执行者在实际仓库串行运行一次默认三轮 `python3 verify_mac.py --report <全新临时路径>/verification.json`，不传减少轮数参数；由入口完成一次 `npm run build` 与必要回归，不额外预热 build。已记录前后源码/测试/脚本指纹，未变范围的独立依赖报告继续复用，不为入口未列入而重复补跑。开始前只读检查空闲，结束后共享 dist 被外部构建接管；原始证据在共享输出之外保存，详见下节边界。
- 平台与费用边界：本轮文档 owner 不构建、不读取共享 dist、不运行真实 CLI 或付费模型。已完成统一入口使用临时 HOME 与本机模拟模型的约定范围，不等于真实模型或图形宿主端到端；macOS 结果不能冒充 Windows。Windows 原生需另机对同一源码执行 `python verify_win.py` 并留报告。

## 实际交付、主审与证据复用

以下依据主通信各次独立审查及其来源 attempt 报告汇总，本轮文档 owner 未运行任何 Node、构建或原生入口。各组统计不累计为一次全组通过，旧结果只按仍匹配的范围复用。

| 交付与来源阶段 | 已审查执行事实与边界 |
| --- | --- |
| 原始依赖契约、内核与宿主 | helper/decision/store、图和最新 attempt 准入、完整决策后提升等已主审；内核索引修复 49/49、store 71/71、早期宿主 267 保留原覆盖，不证明后来新增选序 |
| 创建保护 | 最终 `npm run build` 成功及持久化 35/35，已通过“协议纠正与创建保护验收”；不冒充最终入口 |
| 生命周期恢复 | 隔离编译、HandoffContracts 22/22、选定 Orchestration 6/6，经“立即续跑修复审查与宿主选序接线”主审；立即恢复无 sleep/flush，旧 consumer 不侵入新 lifecycle |
| 四项协议/提示 | decision 38/38、PromptBuilders 32/32，经“四项上限与依赖验收提示审查”主审；证明协议形状和提示，不代替宿主选序 |
| 新批次内核 | 主体两组 58/58；首次边界主审发现失败前置原因硬编码、NUL 拼接去重丢边及传递阻塞回归缺口，修复后 Dependencies 19/19 经“验收选序边界修复复核”通过；两次不相加 |
| 宿主选序接线与提示修复 | 五组 211 项合并有效证据（最后定向 8/8），主体接线已审阅；首次主审因冻结解释时效和重复 view 构造拒绝。修复后新增 2 项与未变 10 项构成 12 项有效证据，经“冻结提示修复验收与最终原生验证续接”主审；不写为最终全组重跑 |
| adapter | 依赖集成 1/1，未变范围复用；未列入统一入口不表示它被入口执行 |
| 阶段文档 round-4 / round-12 | 两阶段五份文档均主审通过；各自 ontology validate、9/9 工具测试、结构/链接/保留审计只覆盖当时内容。本次激活和归档构成新的文档检查范围 |
| round-17 局部夹具及最终原生 | 显式局部 `subtaskRoundLimit=100`，生产默认 200 保持；隔离真实 TypeScript 编译（206 源/声明、0 diagnostics）与精确失败用例 1 项通过，其余 31 项名称过滤未执行。最终入口及限定边界见下一节，已由“局部夹具与最终 macOS 原生交接验收”主审 |

### 最终 macOS 原生证据及边界

单一执行者在实际仓库运行一次 `python3 verify_mac.py --report <全新临时目录>/verification.json`，默认三轮（不传 `--runs`），退出 0、`passed=true`、`fullyVerified=false`。由入口完成标准 `npm run build`，75 个规定回归文件 **1350/1350**，失败/取消/跳过/TODO 均为 0。实际命令参数与机器报告 `checks[name=regression].evidence.files` 一致，以下五个门禁文件均实际列入（源文件入口对应编译后的 `.js`）：

- `src/test/loop/loopTaskStore.test.ts`
- `src/test/loop/loopTaskStoreCoreCoverage.test.ts`
- `src/test/loop/loopTaskStorePersistence.test.ts`
- `src/test/extensionHost/loopPlusHandoffContracts.test.ts`
- `src/test/extensionHost/loopPlusAcceptanceCompletionGate.test.ts`

三轮 pool 和一次公共 runner 的原会话交接均通过，真实 `process/exit` 后恢复原 thread，另一会话保留；四组进程退出、stdio 关闭、临时目录删除与监督收尾全部通过，20 个自有诊断进程已不存在。环境为 macOS 15.6.1 arm64、Node 24.22.2、npm 11.19.1、默认 PATH Codex 0.167.2；使用隔离临时 HOME 和本机模拟模型，未减少轮数、更换 CLI、预热 build、全局安装或调用付费模型。机器 JSON、阶段日志、公共 runner 报告、真实文件清单、编译结果、夹具差异及逐文件指纹由 round-17 attempt 保留；本机临时路径仅记录于 attempt 报告，不写入持久文档。

前后共核对 707 个源码/测试/脚本/构建配置文件。稳定快照后先有四处外部测试漂移，主审又发现三处后到夹具变化；以下七处均不在本次 75 文件执行清单，不能宣称它们当前内容通过：

- `src/test/session/sessionMessageActions.test.ts`
- `src/test/webview/clipagescriptruntimecoverage.test.ts`
- `src/test/webview/loopPlusModeEntry.test.ts`
- `src/test/webview/looppluswebviewintegration.test.ts`
- `src/test/loop/loopPromptQueue.test.ts`
- `src/test/loop/opencodeloopmodewebview.test.ts`
- `src/test/session/conversationTabLock.test.ts`

产品源码、规定回归源文件、脚本和构建配置在主审及本轮只读指纹核对时仍匹配。入口后共享 dist 被其它构建接管；原始执行通过事实保留，但当前 dist 不是本次入口的独占产物，不由本轮证明。未因明示边界重复入口或补跑其它 owner 用例。

历史失败保留且不累计统计：先前入口标准 build 成功、75 文件 1322 通过/1 失败，716 文件指纹相同；HandoffContracts 的 dispatch commit failure 恢复用例预期 starts=1、实际 0，生命周期修复后主审通过。当时三轮 pool 与公共 runner 未执行。随后 round-16 入口标准 build 成功、75 文件 1349 通过/1 失败，707 文件指纹不变；冻结批次用例未显式给出轮次预算，却假定 100，与生产默认 200 冲突。round-17 仅在该局部夹具显式给 100，保留并发 2、派发 1、四项上限及所有冻结/报告/门禁断言，再完成此前未通过的约定入口。不能把这两次失败报告与本次 1350 或其它分组相加。

未覆盖 Windows、已安装扩展/图形宿主、真实模型完整业务任务、其它 CLI 和全仓单测，`fullyVerified=false` 保持；macOS 不能代替 Windows 本机验证，不宣称发布或整仓完全验证。本次最终文档自身的独立主审尚未发生，父任务整体完成仍由宿主按所有开放事件/报告/消息/运行门禁决定。

### 最终文档与记忆同步

- 两份能力清单与设计更新为实现及约定 macOS 源码范围已主审通过，链接本唯一归档证据；保留所有依赖、四项选序、冻结与执行成功门禁合同，不改轮次预算或 Vibe 内容。
- 四条原有稳定规则 `plugin.rule.loop_plus_explicit_dependency_graph`、`plugin.rule.loop_plus_dependency_latest_attempt_gate`、`plugin.rule.loop_plus_dependency_review_order`、`plugin.rule.loop_plus_dependency_host_handoff` 激活为 active；仅同步相关既有验收/容量/投影规则的过期交叉说明，不改其它业务规则。
- `TESTING.md` 与 `runbooks/local-development.md` 保留历史记录并补最新限定结果；异步收尾教训进入 `runbooks/PITFALLS.md`。已进入正确事实源，无需其它 memory 热区、ROLLING_SUMMARY、EVENT_MEMORY 或新 skill，避免自动流水重复占用召回面。
- round-18 最终文档实测：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 退出 0（2 domains、17 concepts、16 relations、150 rules、2 workflows、3 documents）；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 退出 0、9/9。此后 ontology/工具/测试未变，结果仍有效，未为刷新证据重复运行。
- 本次临时 Python 文档审计退出 0：八份交付的结构/围栏/空白、14 处新增或迁移 Markdown 链接/锚点、37 个新增不同源码路径、八条相关变更规则的 91 个 source_refs、归档唯一性与旧 active 入链清理均通过；规则 ID/顺序及其它 JSON 字段保留，轮次预算、Vibe 和既有 PITFALLS 内容保留。首次审计把功能表中的轮次预算误当独立章节，修正审计定位后通过，没有因此修改预算内容。
- 全部 59 处本地 Markdown 链接中有两条本轮开始前已存在的无关历史失效链接（能力规格的旧 CLI 配置 docs 计划、PITFALLS 的旧 Windows 通知 docs 计划），本次新增/迁移链接无错误；保留原状交主任务判断，不将全文件链接写为无缺陷。
- scoped `git diff --check` 退出 0；人工核对相对本轮开始副本的增量、执行/验收门禁分离及证据边界。校验后仅补本计划的实测记录，再对该新增段、链接/结构/空白和其它七份内容指纹做末次核对；旧 round-12 结果不代替本次激活/归档检查。无构建、Node、原生入口、浏览器或共享 dist 读取。

## 任务列表

- [x] 原始依赖契约、实现、阶段文档及各自独立主审。
- [x] 补充四项协议、新批次选序、边界修复及宿主接线/提示时效修复，均独立主审通过。
- [x] 局部预算夹具修正，经隔离真实编译及精确用例验证并主审。
- [x] 单一执行者完成一次默认三轮 macOS 入口、规定回归及公共 runner 交接；原始通过事实、历史失败原因和外部漂移边界分别保留。
- [x] 最终事实同步、四规则激活与唯一计划归档；本轮文档独立验收仍交主任务，不预写通过。

## 决策记录

- 2026-11-17：使用显式逻辑任务依赖，不从会话来源或修复关联推断。当前 attempt 的真实确认结果才是准入依据，已启动后继不追溯取消。
- 2026-11-17：普通派发与 reprompt 的缺省含义不同，控制图预检在副作用前；确认 API 不擅自提升，整份决策应用后统一持久化并启动。
- 2026-11-17：依赖死等回到主模型有界处理，不以自动取消、绕过依赖或永久 wait 代替业务判断。
- 2026-11-17：只维护本 feature 单份执行计划；文档交付和代码交付并行，验证事实按各 owner 实际报告复用，统一验证前不声明整体完成。

- 2026-11-17 补充：新批次显式 prepareReviewBatch，将依赖优先结果置于实际提交前缀；已有冻结批次不改写，报告 FIFO 不变，验收已处理与执行成功门禁严格分离。四项上限独立于轮次预算，不等待凑满。

- 归档决策（2026-11-17）：主任务已接受原始及补充实现、round-17 局部夹具与约定 macOS 验证，故完成事实同步并归档；最终文档本身的独立验收保持开放。

## 当前结论

实现与约定 macOS 源码验证已完成并主审通过，计划按 2026-11 月份归档。契约、历史失败修复及最终原生证据的范围保持可查；当前 dist、七处外部测试和未测平台/产品场景没有被扩写为通过。本次最终文档交付 requiresAcceptance=true，仍待主任务独立审查，不能据此替宿主确认父任务整体完成。无布局、主题或交互改动，群聊仍只读投影冻结前缀，本轮无需浏览器或 UI 检查；不重跑可信且仍有效的构建、Node 回归或原生入口。
