# Loop+ 子任务调度

## 发送与启动反馈

Vibe、Loop 和 Loop+ 共用发送反馈。通过本地配置/路由检查并实际发送 `sendPrompt` 时，立即以既有用户气泡样式显示原始提示词预览，同时在助手气泡显示三点等待动画和对应模式的准备文字；Loop+ 仍先确认验收方案。收到 `runStatus.start` 后显示“等待模型响应”，直到首次助手正文/思考输出或该调用结束。预览和等待独立于持久化消息，不进入历史、导出或模型上下文。每个 Tab 保存自己的临时提交状态，切换时只展示当前 Tab；减少动态效果模式保留静态三点与文字。

请求使用可选 `requestId`，预加载持久化用户消息时将其作为 `messageId`；Webview 只在当前 Tab 收到这个 ID 的真实消息后隐藏预览，不用提示词文字推断确认。宿主无论正常返回、配置拒绝、提前退出还是异常，都以 `promptSubmissionSettled` 回传同一 ID 和提交时的目标 Tab。旧回执不能清除新请求；未收到本次 start 时，旧运行输出和终态也不能清除准备状态。取消验收方案、本地配置/路由拒绝不创建等待气泡。宿主拒绝保持既有错误提示，真实配置校验仍在执行之前。

发送处理器在配置校验、角色快照和历史记录完成后先预加载用户消息，再异步刷新完整面板并进入执行。完整面板读取所有 CLI 配置和模型，仅为展示投影，不作为三种模式的启动条件；同步异常或异步刷新拒绝独立记日志，不阻断执行。配置拒绝后的刷新也不阻塞提交回执。CLI 初始化、配置应用、会话所有权和压缩等待仍遵循原有执行约束，等待气泡覆盖这些真实等待。

实现：`src/sessionMessageActions.ts`、`src/webview/viewContentScript/taskListAndUi.ts`、`src/webview/viewContentScript/windowMessageDispatch.ts`。回归：`src/test/session/sessionMessageActions.test.ts`、`src/test/webview/clipagescriptruntimecoverage.test.ts`。

宿主崩溃后手动续跑子任务的状态、完成回报与主任务重建规则见 [Loop / Loop+ 宿主中断后的完成回报](loop-crash-recovery.md)。

会话连续性：每次 attempt 可以新建展示 Tab，但不必新建 CLI 会话。验收失败 review 关联的修补项自动续接原子任务，主模型也可用 `continueFromSubtaskId` 显式选择连续工作来源；控制重派保留原子任务来源。持久化绑定、配置兼容、串行执行及边界见 [Loop 子任务会话复用](loop-subtask-session-reuse.md)，原有调度和验收条件保持不变。

控制清理：主模型 `close` / `reprompt` 的关页要求不会被此前的普通停止吞掉；attempt 句柄丢失时仍按父任务和子任务身份清理旧闲置 Tab。自动完成与手动继续完成共用旧标签清理入口，跳过仍在执行的 Tab，并以清理快照及当前 attempt 的标签位置保护之后创建、尚在等待启动的替代 Tab。

停止后显式继续先核对开放 attempt。没有宿主句柄的残留预留以 `stopped / lost-process` 进入验收，再恢复调度；原子任务记录或 Tab 已缺失也能从快照恢复，不要求用户找回旧 Tab。已有验收事件保留，失联不算成功。尚未启动 CLI 的来源锁、后台压缩和启动准备等待可取消，避免空 Promise 永久占用 running；实际调用已经开始时仍等待其收尾，中文提示说明等待条件，不能仅凭关闭 Tab 认定进程退出。

用户停止绑定点击时的 Tab。Loop+ 停止先设置内存停止标记并关闭 scheduler 父门，再取消当前主调用和未结算子调用，之后持久化停止快照；不会等待面板或配置刷新才取消。经典 Loop 主标签先停止同一父任务的全部活动运行。内部抢占只取消当前模型调用，不能复用会停止整个父任务的用户操作路径。回归见 `src/test/extensionHost/loopPlusRuntimeWiring.test.ts` 与 `src/test/extensionHost/loopPlusOrchestration.test.ts`。

宿主仍存活但完成回调丢失时，仍按 5 分钟周期核对实际执行所有权，并保留既有 5 分钟启动交接宽限。主模型空闲、无活动同级时，已确认失联且仍有任务记录的子任务保留开放 attempt，标为 `blocked`，等待显式继续；无法关联任务记录的残留预留才按失败事件交回调度器。准备、收尾和手动续跑不算失联，空队列仍可触发主任务收尾检查。详见[等待巡检](loop-crash-recovery.md#宿主仍存活时的等待巡检)。

每分钟巡检只允许当前宿主重发普通 Codex Loop+ 主任务已发送且明确意外退出的回合，沿用原回合请求，并复核原工作区、已打开的主 Tab、任务、会话、线程和运行状态。不自动续跑已关 Tab 的任务、子任务、手动停止、阻塞或其它暂停状态。AI 面板与群聊分别持久记录 `userStopSource` 为 `ai-panel` 和 `group-chat`，两者都先关闭续跑资格再取消调用。

首次意外退出不计数。后续自动续跑再次意外中断才累加持久计数，连续第三次进入 `needs-review` 并停止自动续跑。任一子任务提交验收通过，或无需验收的成功报告被确认时，清零与该调度快照一起提交；包括普通报告确认和验收前独立派发时的报告确认。待确认报告、验收失败和显式继续不清零。分钟巡检复用原调度上下文，不确认验收、不重启子任务，也不同于[主任务按需续跑计划](#主任务按需续跑计划)。

## 调度边界

### 显式前置依赖

v1 快照在执行记录与尝试历史中保留 `dependsOn`，引用同一父任务内的子任务 ID。历史无此字段仍兼容。派发和重派先校验未知引用、自依赖、重复和环路，恢复时拒绝不支持或前后不一致的快照。重派省略依赖则继承，传空数组则清除。普通 Loop+ 在所有最新前置尝试执行成功后自动提升待启动后继。产研部仍以验收通过或免验收报告确认作为额外准入条件。阻塞只影响有依赖边的后继，独立工作仍可使用其余容量。

处理同一份宿主决策时，先完成验收、免验收报告确认、控制与新派发登记，再统一按最新尝试和剩余容量提升待派发。控制和登记仅更新尝试及 pending，持久化预留成功后才排入启动。若同一份 `accept` 通过旧前置又登记同 ID 的新尝试，仍在排队的后继按新尝试判断准入，独立工作照常填槽。

### 每轮简单事项直办

Loop 与 Loop+ 在首次、补充需求、用户消息、继续、验收及收尾的每轮主决策中，都先按 `src/loopDirectExecutionPolicy.ts` 判断当前事项是否特别简单：目标明确、局部低风险、结果能从操作本身直接确认，不需要独立调查、设计或协作，且用户与项目规则均未要求测试、构建或独立验收。满足时由主任务直接处理，不按操作类型、文件数或行数设白名单，也不为了流程完整派发微型子任务。

独立简单补充事项可与其它工作同轮处理，但不能争抢运行中、排队中或待验收任务的写入，不能接管或修补已派发产物。处理完简单事项后，仍按其它工作的状态返回 `dispatch`、`wait`、`accept` 或正常 `completed`；不能遗漏原要求、跳过待验收事件或因子模型失败回退主模型编码。

Loop+ 宿主每轮重新计算 `allowDirectCompletion`：仅无 running / pending / currentReview / reviewQueue 且无附加审查项时允许精简收口，不以是否存在历史子任务为条件。模型还必须确认所有原始及补充要求已完成且本轮符合直办条件，返回 `status=completed`、`directCompletion=true`、非空 `answerConclusion` 与 `finalSummary`，不携带子任务、事件确认、验收或覆盖清单字段。解析器默认拒绝该协议，须由宿主显式放行；用户消息确认、并发变化检查和 scheduler 完成门禁保持有效。其它 `completed` 的固定清单和附加审查校验不变。

### 验收审查与验证结果复用

2026-11-17 补充需求将全新验收批次调整为依赖前置优先、共享 `LOOP_PLUS_ACCEPTANCE_BATCH_MAX = 4`，独立就绪事件稳定按到达顺序选择；不等待凑满四项。有可领取项即启动验收，只有相关后继被暂缓，独立任务继续验收、派发与回填。实现与约定 macOS 源码验证已于 2026-11-17 通过主审，证据及覆盖边界见[唯一执行计划](../exec-plans/completed/2026-11/2026-11-17-feature-loop-plus-explicit-dependencies.md)；详细选序见[冻结验收批次与最终完成](#冻结验收批次与最终完成)。每个有效请求冻结宿主选定的有序 eventIds 及当时可见的用户消息/报告前缀。已有冻结批次不重排，未选及后到事件保留给后续决策；模型不能从最新记录自行加入、重排或替换本次 reviewEventId/reviewEventIds。其它子任务继续运行，群聊仅标记宿主只读查询返回的当前批次。

若 blocked 决策消费了本请求捕获的用户消息前缀，且仍有后到消息，宿主会明确捕获剩余前缀，让下一次有界决策实际看到这些消息；协议修复与正在执行的请求仍不改变冻结前缀。无新消息时原有有界 blocked 复核和暂停规则不变。

Loop+ 区分执行事实与验收判断。子任务明确汇报的测试、构建、启动等执行结果直接采信；只要仍覆盖当前改动，主模型不自行重跑，也不另派任务复现同一结果。无需为相信清楚的执行汇报而额外索要原始日志或独立复现。信任结果不等于确认覆盖完整，更不等于实现和验收天然通过。

- 每个当前待验收事件仍须审查相关代码、差异或其它交付物，判断实现完整性、接口/数据/文件契约、改动合理性、遗漏、回归风险与边界处理，并完成方案中已选的可维护性、安全、性能、UI 等附加审查。单测通过或子任务说“已完成”都不替代这些判断。
- 补充检查仅针对未覆盖要求、失败项、后续改动使结果失效的部分，或用户/项目明确要求的独立验证。运行或派发前说明已有结果、具体缺口和最小范围；不因“再确认一次”而整套重跑。已满足独立要求且仍有效的结果同样复用。单测通过不自动证明未测的跨任务集成行为。
- 汇报不清时先从已有输出或来源子任务补充说明，而不是直接重测。子任务报告需写清每项验证的范围、命令或操作、结果、未执行/未覆盖项，以及验证后可能影响结果的改动；未实际执行不能写成通过，代码中存在测试也不能当作运行成功。
- 收尾和续跑复用已经验收且未发生变化的执行与审查结果，聚焦新增需求、变化的交付物及未解决的集成问题。仍须核对最终需求覆盖，不绕过任何开放事件、失败事件或完成门禁；某事件的结果不能当作另一无关事件通过的依据。
- 六项固定清单、逐事件验收原因、已选附加项、批次确认、失败修复及宿主完成协议保持不变。复用是模型决策规则，不新增自动验收、配置开关或对自然语言报告的机械判真门禁；主模型仍不得自行实现或修复已派发工作。

### 子任务是否需要完整验收

主任务在每次 `dispatch` 子任务或 `reprompt` 新 attempt 时，逐项决定 `requiresAcceptance`。缺省按 `true` 兼容旧任务并保持完整验收；`reprompt` 是新的判断，省略标记不会继承旧 attempt 的免验收。只有明确设为 `false` 才跳过独立验收流程。这个标记只表示免去完整交付审查，不表示主任务可以忽略结果：成功 attempt 会进入独立持久化报告 FIFO，完成事件唤醒主任务；主任务读取对应报告、将结果用于剩余工作判断并按冻结顺序回传 `reportEventIds` 确认。确认不记为验收通过；报告未确认仍阻止父任务完成。失败和停止始终进入原验收队列，可从排队或当前验收位置恢复；恢复校验拒绝失败/停止被记为免验收成功报告。宿主恢复、主任务忙碌期间到达的新报告均保留，下一轮处理；每轮仅确认本次可见报告和用户消息前缀，晚到内容不越过完成门禁。免验收 attempt 与其它 attempt 一样占用子任务轮次；报告确认不再额外计数。群聊与成功调用的完成提示均显示“无需验收”，不生成验收通过气泡。

免验收判断看主任务能否直接使用具体执行证据，无需独立判断交付质量；任务类型、改动行数或模型能力都不能单独决定。以下子任务可设 `false`：

- **纯报告**：明确范围与命令的测试/构建执行且无无关改动、带来源的只读盘点、按指定输入机械生成报告，或结论清楚的隔离诊断。
- **明显简单的低风险改动**：意图明确、影响局部、结果可直接核对，且不需要判断实质行为、契约、安全或集成影响。比如用现有日志器添加固定且不含敏感信息的诊断日志，或不改变行为地重命名局部变量。子任务仍要检查局部差异、执行必要检查，并报告具体改动和结果。改共享默认值或输出敏感数据，即便只改一行也不免验收。
- **已授权的常规 Git 提交或推送**：只做交付操作，提交范围或待推送提交、目标分支及推送远端都明确。单独派发时走 `backend` 路由（全栈模式走全栈子模型）。改动需要先验收时，在验收通过后派发交付。用 `dependsOn` 声明执行前置，并避免与可能改变提交范围或目标引用的工作并发。子任务执行前核对范围和目标，执行后报告实际提交 SHA 与适用的推送结果。免验收不授予 Git 操作权限，不替代对提交内容的验收，不包含强推、改写历史等非常规操作；发现目标、范围异常或执行失败时停止并报告。

仍需判断代码、测试、文档、配置等交付质量，或存在失败归因、结果含糊、集成、安全、契约风险或明确独立复核要求时，保持 `true`。简单任务直办是另一条规则：只有整个请求明确、局部低风险、结果可直接核对，且没有用户或项目要求测试、构建、委派或独立验证时，主任务才可自行完成，不靠派发微任务绕开验收。

实现与回归：`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/promptRunState.ts`、`src/loopTaskStore.ts` 及其对应测试。

### 显式任务依赖

2026-11-17 本 feature 的实现、补充四项验收需求及约定 macOS 源码验证已通过主审；证据与覆盖边界见[唯一执行计划](../exec-plans/completed/2026-11/2026-11-17-feature-loop-plus-explicit-dependencies.md)。本节记录当前契约，不代表发布、已安装扩展或跨平台全量验证；本次最终文档仍待独立主审。

#### 依赖身份与输入

子任务使用可选 `dependsOn?: string[]` 声明同一父任务内的前置逻辑任务 ID，即稳定的 `subtaskId`。不引用 `attemptId` 或 CLI `sessionId`，也不从 `continueFromSubtaskId`、验收修复关联或共享会话推断依赖；这些字段仍只负责各自的来源与会话连续性。普通 `dispatch` 缺省或显式 `[]` 表示无依赖。

共享纯解析契约为 `readLoopPlusDependsOn(value: unknown, subtaskId: string): string[] | null`：`undefined` 返回 `[]`；显式非数组、非字符串元素、空白 ID、自依赖及 trim 后重复 ID 返回 `null`。合法列表 trim 后保留顺序，复制数组，避免调用方修改调度状态。未知引用与环由 scheduler 校验，不靠解析器猜测任务是否存在。

同一次 dispatch 中通过其它局部校验的有效候选可相互前向引用。先收集候选，再用各历史逻辑 ID 最新 attempt 的依赖与候选组成图；拒绝未知引用及任何环，包括跨历史任务与新候选形成的环。图检查使用 Map/Set 和非深递归遍历。非图类错误保留 `invalid_spec` 等局部拒绝和部分接受语义，被拒候选不算已存在的前置；候选图无效时，本次有效候选集合全部以 `invalid_dependencies` 及可读 detail 拒绝，不入队、不启动、不改变 scheduler 状态。

#### 前置满足条件

对每个逻辑 `subtaskId`，按 `seenAttempts` 的追加顺序选择最新 attempt。普通 Loop+ 的执行准入要求每个直接前置的最新尝试为 `outcome=completed`，且未被关闭。宿主持久化完成和启动预留后，自动启动满足并发和写入冲突限制的后继。完整验收或报告确认仍按原流程处理，并参与父任务完成判断。依赖已经验收的交付应在所需验收通过后派发。

产研部沿用下表准入条件。

| 产研部前置类型 | 必须同时满足 |
| --- | --- |
| 需要完整验收（含缺省） | `outcome=completed`、`disposition=reviewed`、`acceptance=passed` |
| 免完整验收 | `outcome=completed`、`requiresAcceptance=false`、`disposition=reported` |

最新尝试未完成、执行失败、停止或关闭时，后继继续等待。修复前置优先沿用原逻辑 ID，新尝试的结果用于判断准入。另派不同 ID 时，需要显式更新仍在排队的后继依赖。

验收失败修复必须复用失败事件所属的 `subtaskId`，不能为同一逻辑工作新增成员编号；每个失败事件在一次 `accept` 中最多关联一项修复，修复的新 `attemptId` 仍独立执行和验收。宿主在确认失败事件和关联一致后规范化任务 ID、沿用原成员元数据及兼容执行会话；新验收结果追加在同一逻辑任务的历史之后。群聊将该逻辑任务当前活动 attempt 显示为橙色“修复中”，并从普通“运行中”计数中独立统计。排队、验收中断和普通尚未确认重试不显示为修复中。

上述成功条件约束尚未启动的执行准入。已经启动的后继，不因其前置随后重派而自动取消，也不回写既有执行或验收事实。依赖等待的后继保持 `pending`，不占 running 槽、写入范围或冲突组，不生成虚假的完成事件；其它无依赖或依赖已满足且无冲突的任务继续回填。补充需求另为已结束执行的交付规定依赖优先验收顺序；前置已 reviewed（包括失败）、reported 或 closed 仅表示先行处理完成，可审查既有后继，绝不替代本节执行准入的成功条件。

#### 控制与整份决策的提升顺序

| 输入位置 | 省略 `dependsOn` | `dependsOn: []` | 显式非空列表 |
| --- | --- | --- | --- |
| 普通 dispatch | 无依赖 | 无依赖 | 使用该列表 |
| `controls.reprompt` | 继承原 attempt 列表 | 清空 | 替换 |

`reprompt` 仍创建新 attempt，并且省略 `requiresAcceptance` 时重置为 `true`；不能因依赖继承而继承免验收。控制图预检必须在停止旧 attempt、关页或其它控制副作用之前完成，非法控制不打断旧执行。控制可引用已经存在的逻辑 ID，不能引用同一决策中尚未 dispatch 的新 ID。

`acknowledgeReports` 和 `submitReviewBatch` 保留既有返回签名及不自行提升 pending 的语义。宿主先应用完整决策中的报告/用户消息确认、验收、controls 和新 dispatch，再统一调用 `promotePending`，持久化全部新预留后才 `launchAll`。例如同一决策确认 A 的旧成功并重派 A 时，必须先让 A 的最新 attempt 生效，B（`dependsOn: ["A"]`）不能在中途被放行。落盘失败恢复该次内存转换且不启动；图预检与提交失败回滚都需宿主测试，不能只用内核通过代替交接验证。

#### 阻塞观测与恢复

scheduler 导出 `LoopPlusDependencyBlock`，字段为 `subtaskId`、`attemptId`、`dependencyId`、`dependencyAttemptId: string | null` 和 `reason`。`getDependencyBlocks()` 为每个 pending 任务的每条未满足依赖返回独立副本；view 与 dispatch decision 仅在非空时携带可选 `dependencyBlocks`，不替换既有冲突 `block`、`conflict` 或 `concurrencyBlocked`。

普通 Loop+ 群聊从同一 view 读取 `dependencyBlocks`，按排队 attempt 展示未满足的直接前置，并按父任务子任务顺序映射现有成员编号。成员记录缺失时显示逻辑任务 ID，不编造编号。初次打开和增量刷新共用状态渲染，不重新判断依赖是否满足。

| reason | 最新前置 attempt 状态 |
| --- | --- |
| `execution_pending` | 开放执行或排队，等待执行完成 |
| `review_pending` | 产研部执行准入仍在等待完整验收，或后继验收在等待前置验收 |
| `report_pending` | 产研部执行准入或后继验收仍在等待免验收报告确认 |
| `failed` | 执行失败或停止。产研部执行准入也包含验收失败 |
| `closed` | 前置已关闭 |

没有 running、待验收或待确认报告，且全部 pending 均被依赖阻塞时，宿主必须唤醒主模型并明确列出依赖与原因，不能永久 `wait`。主模型可用原 ID 修复失败前置、通过 reprompt 调整 pending 依赖，或按既有有界 blocked 复核处理；不能绕过依赖或自动取消后继。此时显式 `wait` 没有可取得的进展，应进入已有有界协议纠错；冷恢复和等待巡检也必须识别此状态。停止、暂停和真实运行所有权保护仍适用，不自动复活已停止父任务。

依赖贯穿 `LoopSubtaskDecision`、`LoopSubtaskRecord`、`LoopPlusControlDecision`、scheduler spec/execution/seenAttempt、主/子提示及任务投影；scheduler 快照继续使用 `version=1`，新快照在 execution 和对应 seenAttempt 中保留列表。旧快照缺字段按无依赖兼容；显式损坏字段不能静默清空。恢复时核对类型、未知引用、环、execution 与对应 seenAttempt 的依赖一致性，坏图拒绝恢复。主模型仍负责规划与判断，scheduler 只管理准入和状态，宿主独占实际启动、持久化与唤醒。

#### 交付与验证边界

保留无 batch barrier、已有批次冻结、原并发/写入冲突保护及最终完成门禁。补充需求将全新批次改为依赖前置优先、最多四项，不改变免验收报告 FIFO；执行准入与验收选序分别判断。本 feature 不扩展工作区隔离、预算系统、新证据系统或 UI 布局；投影携带依赖不等于新增可视化页面。

已审查实现及其回归来源如下；各报告仅在未变范围复用，实际执行与历史失败归因汇总于归档计划：

- 协议与存储：`src/loopPlusDependencies.ts`、`src/loopPlusDecision.ts`、`src/loopTaskStore.ts`；回归入口 `src/test/loop/loopPlusDependencies.test.ts`、`src/test/loop/loopPlusDecision.test.ts`、`src/test/loop/loopTaskStore.test.ts`。解析、复制、reprompt 三态与记录往返已由对应 owner 交付并经主审；Dependencies 与 adapter 的独立证据按未变范围复用，不冒充统一入口清单。
- 内核：`src/loopPlusScheduler.ts`；回归入口 `src/test/loop/loopPlusScheduler.test.ts`、`src/test/loop/loopPlusSchedulerDependencies.test.ts`。prepareReviewBatch 主体与边界修复均已主审，覆盖依赖验收链/菱形、传递阻塞、截断、已处理失败前置、报告先确认、稳定独立顺序、复制及恢复；旧执行依赖结果不能代替新增选序证据。
- 宿主与提示：`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusDecisionStrategies.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/loopPlusPanelProjection.ts`；现有回归 `src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/test/extensionHost/loopPlusPromptBuilders.test.ts`、`src/test/extensionHost/loopPlusHandoffContracts.test.ts`、`src/test/extensionHost/loopPlusAcceptanceCompletionGate.test.ts`。宿主交接、生命周期与提示时效修复已主审，包含同决策确认后重派不提前启动、落盘失败不启动、恢复/巡检与不可进展 wait。

最终单一执行者已从实际仓库运行一次默认三轮 `python3 verify_mac.py --report <全新临时目录>/verification.json`：标准构建成功，75 文件 1350/1350，三轮 pool 与公共 runner 交接、退出/stdio/临时目录清理及监督收尾均通过。局部冻结批次夹具显式设置 `subtaskRoundLimit=100`，生产默认 200 保持；隔离真实 TypeScript 编译与精确定向 1 项通过。此前入口失败及修复原因分别保留，不累计报告统计。原始通过事实覆盖报告所列 macOS 源码范围；七处外部测试变化均不在 75 文件清单，当前共享 dist 已被其它构建接管，不能据此证明这些测试当前内容或当前 dist。`fullyVerified=false`，Windows、已安装扩展/图形宿主、真实模型完整业务任务、其它 CLI 及全仓单测未覆盖。详见[归档证据](../exec-plans/completed/2026-11/2026-11-17-feature-loop-plus-explicit-dependencies.md#最终-macos-原生证据及边界)。

### 子任务完成汇报与压缩顺序

Loop 与 Loop+ 的子任务只有本轮产生可关联的最终助手回复才算成功；CLI 正常结束但没有该回复时按中断/失败处理，不进入验收并保留子任务 Tab，其中 Loop+ 提示“任务中断，等待主任务重新派发。”。成功后先持久化完成结果并提交主任务汇报或验收事件，再立即关闭完成时捕获的旧子任务 Tab；旧 Tab 清理不等待同会话此前的压缩。随后按原条件串行压缩子任务自己的会话，失败或跳过不撤销已提交结果；汇报或验收事件提交失败则取消压缩/关页并保留 Tab。主任务验收、其它子任务派发不等待后台压缩。交互运行和 OpenCode 共用运行模板都通过 `src/loopSubtaskAutoCompact.ts` 延迟登记压缩，经典 Loop 在 `finalizeLoopSubtaskRun` 完成汇报后放行，Loop+ 仅在完成事件处理成功提交后放行，包含人工续接的完成事件；过期 attempt 的结果不能放行新 attempt 的压缩。

产研部 `executionMode: "loop-plus"` 组长的员工执行与恢复标签复用普通子任务的身份核对。专属 Owner 按自身运行回执清理。

后台压缩通过 `src/extensionHost/isolatedContextCompaction.ts` 使用独立运行状态和目标 Tab 消息路由，不占用或清理主模型运行槽，不改写主任务耗时。CLI 会话级等待同时覆盖原 Tab 和新 Tab 续接；同会话后续运行等待前序压缩完成，但已提交完成事件对应的旧 Tab 立即清理，不被压缩 flight 阻塞；其它会话照常执行。关页按完成时的标签顺序、对象、CLI、会话和子任务身份快照执行，跳过新增、替代、换绑和仍运行的标签；关闭入口返回后仍核对是否真正移除，未生效记录 auto-close-error，不伪报 auto-closed。单个旧标签关闭或刷新失败不阻断其它候选清理，最后汇总失败标签及原因；只剩成功子任务标签时通过 replaceLastTab 保留同 CLI 空白对话后关闭原标签，仍先检查活动运行与主任务关闭锁。清理后（包括部分失败）复核不再被引用的交互 runner，释放资源。压缩按启动时读取到的当前配置运行，不持有配置执行租约；并发切换可能影响后续读取，但不撤销已上报的完成状态。自动压缩开关、成功且超过五分钟的触发条件、三分钟压缩超时，以及主任务与普通对话既有策略保持不变；该超时不限制关页。

群聊补充需求是独立于主模型运行锁的本地输入：弹窗打开和连续提交不等待当前模型调用结束，也不依赖群聊内容补丁重建入口。提交按顺序写入任务记录与 transcript；Loop+ 通过 `submitUserMessage` 写入既有持久化 `userMessageQueue`，忙碌时不额外启动主模型或中断当前调用。消息确认只消费本次请求已捕获的队列前缀，新到需求留给后续调度；验收优先级与完成阻塞条件不变。经典 Loop 的补充需求仍随下次主任务提示读取，并在应用 completed 决策前核对调用开始时的需求快照；发生变化时返回 `pending-requirements`，原轮次重新判断，不遗漏收尾期间收到的要求。

Loop+ 主模型在每次成功验收批次的 `accept` 决策中给出 0–99 的总体进度整数，结合所有原始/补充需求及剩余工作判断，不按子任务数或验收次数推算；接收新需求后允许重新校准。宿主只在验收事件批次成功提交后持久化该值，协议重试、拒绝或未提交批次不更新。新建任务从 0% 开始，暂停、停止和续跑保留当前值；最终完成门禁成功并持久化时置为 100%。

经典 Loop 在批次全部结束后的主任务有效决策返回 `progressPercent`，宿主写入独立字段 `loopProgressPercent`；首次拆分不更新，旧协议省略时保留原值。进度判断只基于子任务汇报和原始/补充需求及剩余工作，不增加主模型验收，不按数量推算；未完成仅允许 0–99，最终完成写入 100。两种模式共享群聊展示：副标题仅任务 ID，左侧主任务标题为“主任务 N%”，中止按钮左侧以 18px 数字和主题色背景显示百分比。五档区间为 [0,20)、[20,40)、[40,60)、[60,80)、[80,100]，依次使用中性、蓝、紫、青、绿；进度与中止按钮在窄屏保持同组，内容补丁同步更新。

主任务用 `controls.reprompt` 纠正正在运行或排队的子任务时，必须同时提供非空 `title` 和至少 80 字的 `prompt`。新标题由主模型按纠正后的目标用简体中文描述，范围或目标改变时不得沿用旧标题；缺失、空白或非字符串标题会导致整份决策被拒绝并走既有协议重试，不会先停止旧执行。新标题沿原有调度、任务记录和群聊投影链路同步到新 attempt、成员名称和启动通知，子任务 ID 与会话连续性不变。`close` 仍不要求标题，历史消息不回写改名。

Loop+ scheduler 为纯状态内核，维护 `running`、`pending`、验收队列和可恢复快照；extension host 只启动 scheduler 返回的 `started` 项。生产并发容量与经典 Loop 每批派发、Loop+ 单次决定的派发上限共用 `loopPlusDecisionSubtaskMax`（界面“Loop/Loop+ 单次派发上限”，默认 6、范围 1–20），不再固定为 6。该配置在“工作区”Tab 支持可选覆盖，工作区设置优先于全局，留空/清空时继承全局，最终回退默认 6。`getEffectiveLoopPlusDecisionSubtaskMax` 每次读取当前工作区，统一供经典 Loop 提示/解析与 Loop+ 生产适配器使用；面板状态分开发送全局值与可为空的工作区覆盖值，避免编辑全局时显示工作区生效值。新建或继续 Loop+ 任务时，当前宿主容量策略覆盖旧快照容量；仍先验证原快照，并保留全部调度状态。运行中在构造下一次主模型请求、提交主模型决策及处理子任务结束通知前同步当前容量，不需要停止或显式继续，也不打断当前模型调用。scheduler 的 `updateMaxConcurrency` 仅更新准入策略，不自行启动任务；仍由后续 `dispatch` / `finish` 等状态转换返回 `started`。调低配置不取消已有运行项：快照容量至少覆盖已有运行预留，实际准入仍使用降低后的配置，运行数低于新上限才回填 pending，避免展示容量的保护下限被永久当成准入容量。主提示展示实际快照容量。显式宿主并发限制仍优先。扩展宿主按每次实际启动间隔约 1 秒错峰，错峰队列不改变 scheduler 的准入状态。Loop/Loop+ 共用子任务标签入口在创建标签后、首次刷新页面前发送运行中状态，覆盖会话及配置准备；尚未实际启动的准备失败或取消分别清除为 error 或 stopped，已启动调用仍由运行时负责终态与后台压缩。

### 冻结验收批次与最终完成

Loop+ 没有 batch barrier 或共享 round gate，宿主持有调度状态。有可领取验收项即请求主模型，不等待全部结束或凑满四项；被前置阻塞的完成事件保留，其它独立项继续验收和执行。执行完成只表示结果待处理，并不等于验收通过或父任务完成。以下记录已实现并通过主审的 2026-11-17 补充契约；约定 macOS 源码验证已完成，发布及其它运行环境不在该通过结论内。

#### 新批次依赖优先选序

共享 `LOOP_PLUS_ACCEPTANCE_BATCH_MAX = 4` 只限制单次验收事件数，独立于并发和单次派发容量；累计子任务派发不设总额度，不新增设置，不等待凑满。宿主仅在没有有效冻结批次、需要领取全新批次时显式调用 `scheduler.prepareReviewBatch(maxItems: number)`；不能在 finish、view、提示刷新、旧 claimNextReview 或 submitReviewBatch 中隐式调用或重排。

内核 API 返回 `{ items: LoopPlusReviewItem[], dependencyBlocks: LoopPlusDependencyBlock[], view: LoopPlusSchedulerView }`，三者保持复制隔离。`maxItems` 必须为正安全整数，无效值在任何变更前抛 `RangeError`；停止/完成时不领取、不改状态。选择使用当前 `currentReview + reviewQueue` 中事件自身 seenAttempt 的 `dependsOn`，并按每个依赖逻辑 ID 的最新 attempt 判断前置状态；使用操作内索引处理稳定拓扑顺序，不深递归或逐事件重扫全部历史。

| 最新前置状态 | 对已完成后继验收的影响 |
| --- | --- |
| reviewed（真实 passed、failed 或 cancelled）、reported、closed | 前置已先行处理，后继可独立受审；不代表依赖执行成功 |
| 有待审完成事件，包括 failed/stopped 结果 | 先选该前置，再选后继；允许按此前置顺序进入同一批，各自记录真实结论 |
| open，包括 running 或 pending | 暂缓相关后继，独立就绪事件继续按到达顺序领取 |
| 免验收成功报告尚未确认 | 保留报告 FIFO，先显式确认报告，在后续决策领取相关后继；不自动确认或把报告另作验收 |

链、菱形及传递依赖都遵守该顺序。只有已选入本批的待审前置才能成为本批后继的排序前提；四项截断不能让后继越过未入批前置。传递前置未就绪时后继也须暂缓。阻塞按既有 `LoopPlusDependencyBlock` 形状报告当前真实原因；“已选”不等于“已通过”，失败/停止前置也必须先审，不能要求其先成功才审后继失败交付。修复仍优先原逻辑 ID；新的 pending 执行继续要求最新 `completed + reviewed/passed` 或免验收 `completed + reported`，不被验收选序放宽。

`prepareReviewBatch` 把选中项组成实际提交前缀：首项为 currentReview，其余选中项放在 reviewQueue 头部；未选项稳定保留，无丢失或重复。没有可选项时，原 currentReview 放回保留队列且 currentReview 为 null。仅状态变化时提交一次内核状态，继续使用 `version=1`，不增加持久队列、快照版本或内核冻结状态。

#### 冻结、宿主交接与无进展处理

宿主优先复用已有有效冻结批次；领取全新批次后先保存选序快照，再按返回 items 构造 MainStep 并请求主模型。落盘失败回滚，不启动或确认任何交付。冻结包含有序 eventIds 与已见用户消息/报告前缀；协议重试、提示刷新、同宿主暂停续跑均保持它们。晚到事件（包括前置）只留给后续新批次，不 abort、扩批或重排当前请求；模型从最新记录看到其它事件也不得自行排序、加入或替换。`heldBatchIntact` 继续核对该实际 currentReview + reviewQueue 提交前缀，而非原始到达顺序。

冻结身份不冻结依赖原因：实际 MainStep 记录准备结果所属 scheduler 身份和 seq，`currentReviewDependencyBlocks` 仅在二者仍匹配时复用解释；状态变化或 scheduler 替换后丢弃过期解释，由后续调度重算。刷新和失败重试共用原 step，仅更新同一请求的提示，保留 eventIds、顺序及消息/报告前缀，不能为了刷新调用 prepare 重排队列。`buildMainRequest` 捕获一次 `wait().view` 复用，避免重复完整复制和观测。

验收失败、主模型失败重试和协议修复保留未确认批次；blocked 消费消息但不确认事件时只扣除已捕获前缀，不能让后到消息冒充已看消息。父任务停止、runtime generation 或 acceptancePlanEpoch 变化仍使旧答案失效。宿主重建已无存活请求，从持久化事件恢复，在领取全新批次时应用依赖优先规则；不推测已冻结或已确认身份。

宿主须区分“存在待审事件”与“存在可领取项”。全队列不可领取时不能发空 review 或在同一 consumer 中无限调用模型：先消费可见报告/消息，前置仍有活跃执行时可等待其事件；无活跃工作而依赖死等时回主模型处理具体依赖与真实阻塞，无进展 wait 仍走有界协议纠错。暂停/停止保护保持，不能自动取消后继、绕过依赖或伪造成功。

提交复用 `scheduler.submitReviewBatch`，只消费宿主冻结的实际 currentReview 与 reviewQueue 前缀，校验 ID 顺序并幂等记录 attempt；未选和后到事件不随本批提交。旧批次提交后由后续决策领取下一批，不重验已确认项。报告 FIFO 和显式确认门禁不变；验收不设总次数额度，每批最多四项，且不设累计子任务派发额度。

`completed` 可以确认本次冻结批次，但最终完成仍受全部未确认验收事件（包括不可领取事件）、报告、用户消息、running、pending 及等待续接结果的开放 attempt 约束。后到需求只留给后续处理，不重审已确认批次。仅最新全局门禁通过并成功持久化后，才能显示父任务整体完成。

群聊按 eventId 只读投影宿主冻结前缀，并核对它与 scheduler currentReview + reviewQueue 的实际提交前缀匹配；选序已在领取时形成该前缀，投影不从原始到达顺序自行排队。元数据缺失、不匹配、暂停、停止或释放时不显示整队列正在验收。批次内成员显示「正在验收」，未选及后到事件显示「等待验收」，等待计数覆盖完整队列。投影不领取、重排或提交事件，不变更 classic Loop、布局、主题或交互。

选序与接线的实际来源为 `src/loopPlusScheduler.ts`、`src/loopPlusDecision.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/loopPlusPanelProjection.ts`；回归入口为 `src/test/loop/loopPlusScheduler.test.ts`、`src/test/loop/loopPlusSchedulerDependencies.test.ts`、`src/test/loop/loopPlusDecision.test.ts`、`src/test/extensionHost/loopPlusPromptBuilders.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/test/extensionHost/loopPlusHandoffContracts.test.ts`。实现、选序边界和宿主提示时效均已主审；分组执行与最终 macOS 证据见[归档计划](../exec-plans/completed/2026-11/2026-11-17-feature-loop-plus-explicit-dependencies.md)，不能将旧分组统计相加成一次统一测试。

Loop 与 Loop+ 共用群聊的 780px 窄屏断点：标题栏下方只保留聊天区，任务信息与成员通过左侧居中开关作为浮层展示，而非上下堆叠。浮层开关属于 Webview 本地展示状态，内容补丁不重置它；断点变化会收起浮层，宽屏侧栏恢复常驻。点击外部、开关或 Esc 可关闭，隐藏时使用 inert 与 aria-hidden 隔离键盘焦点，不改变任务状态与聊天滚动位置。

## 群聊主任务活动状态

Loop+ 群聊的主任务活动状态结合调度快照与主任务 Tab 的实际运行态。主模型调用或已开始回答的提问处于运行中时，即使调度快照仍为 idle、waiting 或 review_pending，主任务成员和活动说明也显示运行中，并显示主任务思考气泡；仍在运行的子任务继续各自显示思考气泡。提问只在真正开始 CLI 调用后计为主模型活动，排队问题不改变状态。分解、验收、暂停、停止、完成、无效快照等已有状态优先保留，经典 Loop 不受影响。宿主在主模型调用及提问回答开始和结束时刷新已打开群聊。

## 主模型提问队列

Loop / Loop+ 群聊允许主模型忙碌时连续提问，显示“主模型正在处理，你的问题会放入队列。”。协调器在每次提交时保存问题并立即将其交给主会话队列，按任务跟踪等待和回答状态，不另设串行提交队列。提问不写入补充需求，不进入 scheduler 的用户消息或验收事件队列。

`loopMainQuestionQueue.ts` 以主任务 Tab 为互斥边界，主任务调用和提问按进入同一队列的先后顺序执行。待验收事件、用户消息、主任务编排或待收口状态不预留会话位置；只有实际发起的主模型调用入队。验收事件的选序、分批和补充需求消费仍由各自编排器负责。若队首问题因队列外的 Tab 运行暂不可执行，每 100ms 检查一次，不依赖 Webview 刷新，也不允许后续调用越过队首。

已开始的调用不会被抢占。例如验收一执行期间提交问题，后续验收二即使已经有待验收事件，也要在该问题之后调用主模型。互斥覆盖压缩等待、配置准备与 CLI 运行全过程；取消信号在异步准备完成后再次检查，避免取消后迟到启动。排队主任务尚未真正启动时，中止它不得误杀当前提问。

`LoopAskThread.queued` 标记等待空闲，`running` 覆盖等待及正在回答。输入与发送始终可用；等待不渲染回答动画，真正调用后才显示动画。中止排队只清空问题，不停止主任务；中止正在回答时仅停止该回答并清空后续问题。单次失败不阻塞后续问题，关闭面板不中断队列；宿主重启后仍将未完成提问标为停止，不自动重放。

## 容量感知拆分与轻量冲突协作

宿主把真实 `maxConcurrency` 传给主模型提示，显示并发上限、当前 `running` 预留后剩余的槽位与单次派发上限。已中断但仍开放的 attempt 继续占槽；pending 不算运行槽位，但已排队工作不得重复派发，且可能优先消耗释放的槽位。

- 最终目标仍需要工作且存在可并行的独立交付边界时，主模型争取达到当前配置容量上限；每批最多四项验收不限制任务运行或派发数量。边界不足、前置依赖、配置限制或空槽不足时允许少派或不派，不为凑数拆微任务。
- 按实现、稳定契约下的独立测试、文档、配置、脚本等交付边界拆分，不按模型角色个数拆分。同为后端、前端或全栈的多个独立任务可以并行；全栈模式不等于只能派一个任务，前后端模式不等于最多两个。
- 每个子任务声明精确的主要 `writeFiles` 和独立验收方式；`conflictGroup` 只表示真实共享可变资源，不以整个功能或角色统一分组。共享只读资料不产生写入冲突，已知共同写入路径必须如实声明，不能为提高并行而隐藏路径或清空冲突组。
- 共享契约、中心注册点等由一个任务负责，必要时先做小型前置任务，只串行真正相依的部分，其它交付不必一起等待。`dispatch` 和 `accept` 均寻找可回填的独立工作；开放验收批次先整批处理，再通过 `accept` 附带后续任务，不增加全批屏障。
- 极少量确有必要、可局部协调的附带范围外改动可以由子任务自行处理，不能仅因其存在可能性就取消主体并行。编码子任务写入前重读文件，保留其他任务改动，不盲目回退或覆盖；小范围互不竞争的改动局部协调并记录路径、原因和处理结果。同符号或共享契约的竞争修改应交由主模型重排，不能强行大范围重写。
- 调度器对明确 `writeFiles` 重叠与相同 `conflictGroup` 的串行保护不变。局部冲突协作是提示约定，不是文件锁、合并器或冲突率保证。

协议 `dispatch` 示例默认展示四个交付任务；`accept` 在单事件和多事件场景均展示假设的验收修复与独立后续交付。数量受单次派发上限与并发上限共同约束，上限为 1 时修复示例可只含修复。示例只表达协议形状，不代表真实验收结论、任务数量或角色配额。

### 验收修复与剩余目标同时推进

每次 `accept` 不仅处理本批缺陷，还需重新核对全部原始及补充需求中的未完成目标。最终目标仍需要新工作、有可用容量且存在没有前置依赖或写入冲突的独立交付时，应在同一决策中派发修复与独立工作，尽量达到配置容量上限，不必等后续验收批次全部处理完。某项验收失败、某个修复在运行，均不构成其它交付的全局屏障。计入已有 running 和可启动 pending，受真实冲突阻塞的 pending 不预留空槽；修复只补失败标准，独立任务推进另一项未满足要求，不重复仍有效的验证、不拆占位任务。目标已满足时不派新任务；剩余工作已有任务覆盖或暂不可并行时允许空的 subtasks，继续后续验收或等待；全部完成门禁通过后收口。

可选的 `accept.independentSubtaskIds` 只列出本次 `subtasks` 中独立于当前验收事件的任务 ID。事件相关修复和后续工作仍用 `reviews[].subtaskIds`，独立交付不必伪挂到某个通过或失败事件。所有任务在两种归属中合计必须恰好出现一次，不存在的 ID、重复或遗漏均拒绝；该字段只允许出现在 `accept`。省略字段时兼容原来的完整事件关联。

失败事件关联的修复按原规则复用原子任务会话，独立任务不自动继承该会话；真正独立的任务省略 `continueFromSubtaskId`，若延续其它已有工作仍可明确指定相容来源。调度器统一接收同一 `subtasks` 列表，继续应用实际写入冲突、冲突组、并发上限及会话串行保护，不新增执行队列或持久化迁移。

只派修复或留下可用槽位前，主模型在主沟通文件说明具体原因：没有其它有收益的可执行边界、真实前置依赖、写入所有权竞争，或已有 running/pending 占用容量。不可修的验收项仍保留失败结论和阻塞证据；有安全独立工作时继续推进，无独立工作且没有活动依赖可推进时才进入原有全局阻塞复核。整体完成仍须覆盖所有需求并满足开放工作及最终验收门禁。

回归入口：协议解析、主提示、宿主编排测试分别覆盖独立任务归属、单/多事件修复示例、独立会话来源与并发执行，以及 Windows 风格路径重叠、共享冲突组和容量排队；独立项先完成时仍立即验收，父任务继续等待未完成项。

## 准入与并行回填

- `running` 项（包括人工中断后等待续跑结果的开放 attempt）占并发槽，并通过 `writeFiles` 路径重叠与相同 `conflictGroup` 对新任务形成冲突约束。
- scheduler 依 pending FIFO 顺序检查候选项；同一次准入中已成功提升为 running 的项立即参加后续冲突检查。
- 由于冲突或并发上限仍未启动的 pending 项只保留队列顺序，不占并发槽，也不为后续候选预留写入范围。因此后续任务可越过被当前运行任务阻塞的 pending 项，填补可用并发槽。
- 后续候选仍必须与当前 running 及本次已提升的任务互不冲突。活动冲突释放后，再按 FIFO 选择最早的可运行项；更早 pending 项仍冲突时可以继续回填其它安全任务。
- 达到 `maxConcurrency` 时，仍未启动的任务留在 pending；结束任务会在同一 scheduler 转换中释放槽位并提升可运行项。

示例：A 写入 `x.ts` 正在运行，B 写入 `x.ts` 和 `y.ts` 因与 A 冲突而等待，C 仅写 `y.ts`。C 与 A 不冲突，应立即运行；B 在 A、C 中任一仍占用冲突范围时继续等待。

## 阻塞观测

scheduler 的 `dispatch` 返回值把 pending 原因归为运行中 `writeFiles` / `conflictGroup` 冲突或并发容量阻塞，`block` 指向实际活动 attempt，pending 项之间不报告互相阻塞。宿主 `loop-plus-dispatched` 日志目前记录 started/pending 的 attemptId 列表和 rejected 的 subtaskId/attemptId/reason，不额外声称日志已有逐项 blockedBy。

## 提交与展示交接契约

`writeLoopTaskStore(filePath, store): void` 保持同步签名，正常返回表示同目录临时文件已原子替换目标；写入或 rename 失败记录并抛出原异常。`updateLoopTaskRecord` 仅在任务不存在时返回 null，I/O 失败抛异常，记录外形保持。编排通过统一 update 边界将 null 视为未提交；`createLoopPlusPersistedTaskRefresher` 只在更新成功后刷新展示，同步刷新异常和异步刷新拒绝独立记录，不撤销已提交事实。真实生产接线仍由 `persistLoopPlusTaskUpdate` 装配。

提交不能以默认只读查询的容错结果为依据：update、append、bind 的来源/合并目标读取及当前目录冷查找采用严格契约，只有 ENOENT 算缺失；其余 I/O 错误原样传播，无法可靠归一化的数据在写入和清理前拒绝。其它候选不可读或损坏也可能使冷提交保守失败。改绑先核对规范化路径及文件系统身份，同文件别名只写已知来源，不清理；真正迁移先提交目标再清源，清源失败仍返回真实提交结果。legacy 仅由严格较新来源覆盖已有目标，相等时间戳保留目标；结合普通更新/append 时间戳不回退及迁移目标严格较新，防止旧副本在同毫秒或时钟回退后覆盖已提交结果。维护错误边界、缓存与查询规则集中见 [存储提交与恢复边界](loop-crash-recovery.md#提交失败与展示刷新失败)。

验收先提交 reviewed/真实 passed、failed 或 cancelled 结论及撤销原因，再确认用户消息和安排后续派发；验收提交失败恢复原内存批次。dispatch 和 close/reprompt 先提交新预留与元数据，再启动、取消或关闭相应 attempt；提交失败恢复本次内存转换，不宣称已经启动。用户停止仍先关父门和取消调用，停止落盘失败不会延迟取消或卡住生命周期。

父任务先检查完成门禁，完成状态只在最终提交边界转换；中间元数据写失败不能留下无重试补丁的内存 completed。最终提交失败保留控制器与 `completionPatch`，同宿主显式恢复只重试最终提交，成功后再发完成消息、提醒并释放，不重复验收和启动。子任务汇报或事件提交失败沿用 error 暂停和现有恢复路径，保留事件、结果与 Tab，取消成功压缩/关页；内存事件在磁盘恢复后显式继续提交。宿主重建只信任已通过任务更新端口保存且仍匹配原运行预留的结构化回执，恢复原验收或报告事件，不推进主任务完成；缺失回执时保留开放 attempt 和不确定结果说明。见[崩溃恢复](loop-crash-recovery.md#提交失败与展示刷新失败)。

真实磁盘回归见 `src/test/extensionHost/loopPlusHandoffContracts.test.ts`：使用隔离 HOME/USERPROFILE、真实 store/updater/refresher/host，注入底层 write/rename 错误；不以会抛错的 updateTask 替身代替整个提交链路。原子替换不扩展为跨进程合并、多文件事务或 fsync 断电耐久承诺。

### 立即续跑与异步收尾所有权

`done` 结束不代表旧 consumer 的 catch/finally 已结束。显式恢复可先建立新 lifecycle；旧 catch 只有仍属于原 lifecycle、且它未 settle 时才能暂停，不能暂停新生命周期。finally 核对 consumer identity，只释放自己的槽位，再处理立即恢复合并的 `pumpRequested` / `forcePrompt`，不能因生命周期改变而吞掉唤醒。主请求的 `currentMain`、`currentMainRequest` 与 `currentMainStep` 清理受同一 handle identity 保护，旧请求不能清空新请求。

已审查源码为 `src/extensionHost/loopPlusOrchestration.ts` 的 pump/runConsumer；真实磁盘回归 `src/test/extensionHost/loopPlusHandoffContracts.test.ts` 覆盖 write/rename 提交失败后直接从 done 恢复，`src/test/extensionHost/loopPlusOrchestration.test.ts` 的 `immediate resume after dependency promotion failure preserves its lifecycle and drains queued wake once` 覆盖原 attempt、已通过前置、新 done、一次消息消费、无重叠主调用及无误 abort。恢复前不加 sleep 或 flush；教训见[避坑指南](../runbooks/PITFALLS.md#loop-的-done-结束不代表旧-consumer-已收尾)。

## 协议矛盾后的自动纠错

主模型回复没有可解析的 JSON 对象时（空白、普通文本或损坏/不完整 JSON），宿主在同一 consumer 内自动重试，不按两次协议纠错上限暂停。超过两次连续格式失败后采用指数退避，延迟从 1 秒增长到最多 30 秒；格式修复提示要求只返回完整 JSON，不再重复附加前次非 JSON 摘要。总调用仍受全局决策安全上限约束，达到上限会保存协议原因并进入 `needs-review`；显式停止会中断退避且不会启动下一次主调用。

主模型返回了可解析 JSON、但决策结构/字段或调度状态校验失败时，宿主附带具体拒绝原因和上一份回复（最多 24000 字符），以本次最新运行快照和协议为准，同时保留当前冻结的验收批次和消息前缀，要求只重新生成完整 JSON，默认最多纠正两次。协议错误不转为业务 `blocked` 或用户澄清；后续合法决策按原流程确认验收、派发剩余工作或完成。

`accept.subtasks` 中每个任务 ID 必须恰好归属一个 `reviews[].subtaskIds` 或 `independentSubtaskIds`，补充需求产生的后续任务也适用。事件相关任务可关联 `passed` 项并保留真实结论；独立任务使用显式独立归属，不能为补齐关联伪造失败。解析失败不消耗验收事件或启动子任务；策略应用途中已提交的事件和已启动任务以最新快照为准，纠错不得重复处理。

scheduler 的派发拒绝（含 `active_subtask`）同样走 protocolMiss。dispatchSubtasks/dispatchDecisions 返回明确接受项和拒绝项，复用 scheduler 原因类型。部分接受时先保留已启动/排队项与已提交验收和消息确认，纠错请求携带最新快照及剩余拒绝原因，要求用 dispatch 只纠正未接受项；不重发已接受任务、不重验旧事件、不覆盖活动元数据，也不把 failed 改成 passed。后到事件留待后续新批次按依赖优先规则选序，不改当前冻结批次。只有整个合法交接成功后清零协议重试；部分成功不能反复清零而绕过有界重试。

结构化决策协议错误默认首答之后最多自动纠正 2 次，不放宽验收、完成或安全门禁；纯格式失败持续重试至合法决策或全局决策安全上限。完整接受的决策清除纠错上下文；结构化决策持续拒绝或格式重试达到安全上限才进入 `needs-review`，`finalSummary` 保存真实协议原因，主聊天、群聊和沟通文件复用同一说明，不再套用“主模型未提供阻塞原因”。显式继续或宿主重建后可从暂停摘要恢复纠错原因；旧记录未保存原因时明确指出证据缺失。当前待验收结果保留。

实现与回归：`src/loopPlusDecision.ts`、`src/loopPlusProtocolRepair.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusDecisionStrategies.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`。

## 全局阻塞复核与暂停留证

业务 `blocked` 的用户可见说明统一称“熔断”：子任务多次尝试仍无法解决问题，触发熔断，整体任务尚未完成。主聊天、群聊和暂停记录使用同一说明，保留原因、证据、解决方案及恢复条件；主模型调用失败与协议错误仍显示各自真实原因，不混作子任务问题。仅调整文案，不新增重试次数门槛，不改变下述状态机或历史模型原文。

主模型返回 `blocked` 不等于所有剩余要求均无法推进。每个无进展阶段首次出现全局阻塞时，宿主先将任务的 `loopPlusBlockReview` 保存为 `pending`，不确认原验收事件，再发起一轮带 `Bounded blocked review` 标记的复核。提示要求逐项核对根需求、补充需求与未完成事项，分辨外部依赖和仍可独立实施的工作；不能以删除门禁、重复失败诊断或编造成功替代推进。

有效复核决策将状态变为 `reviewed`，发现独立工作则沿用原 `dispatch` / `accept` 流程；再次确认 `blocked` 才暂停。待复核与已复核状态均持久化并跨宿主重建保留，新用户输入、成功派发或验收提交会清除状态；显式继续也重新开放一次复核。协议错误与总决策次数继续受已有上限约束，不因等待或加载历史自动无限调用模型。

最终 `blocked` 还需完整的结构化 `blocker`。`src/loopBlocker.ts` 共享字段校验和中文 Markdown 生成：`kind` 为 `recoverable` 或 `impossible`，`cause` 为因果说明，`affectedRequirements` / `evidence` / `attempts` 为非空字符串数组，`nextSteps` 每项含 `owner`、`action`、`verification`。可恢复时至少一步且必须提供 `resumeCondition`；无法完成时必须提供 `alternatives`（可说明无可行替代的依据），不附带无效继续尾注。数组/字段完整性由宿主校验，证据真实性仍由主模型和实际执行负责。

旧回复缺对象或字段不全时，解析器保留 `finalSummary` 并生成内部 `blockerIssue`；第一次 blocked 仍走剩余工作复核。复核后缺诊断进入现有 `protocolMiss`，携带具体缺项、模型原说明和旧回复，默认最多纠正两次；不确认验收、不新增子任务轮次、不清除队列。耗尽后保留协议失败及“熔断诊断未补齐”说明，显式继续可恢复纠错原因。完整诊断生成的 Markdown 覆盖模型自由摘要，沿用既有持久化与展示，不新增存储字段。经典 Loop 共用该诊断契约；缺对象时同轮补充一次主模型决策，仍缺失或非法就暂停并保留原说明，不新增子任务轮次或放宽完成/权限门禁。

可恢复 blocker 可附 1–3 项结构化 `recoveryOptions`（方案名、操作、验证），仅在 Loop+ 完成一次有界剩余工作复核后询问。复用主任务澄清表单和人工交互超时；超时采用首个尚未选过的方案，用户提交、超时选择均作为补充上下文续跑。选项不授予权限，必须在实际执行环境验证；无可行新方案或真实授权缺失时沿用原熔断暂停。方案回答持久化在补充需求中，重复尝试不会再次推荐相同操作。

最终暂停沿用 `needs-review`，保留活动 attempt 和验收队列。主聊天展示阻塞原因、未完成事项与恢复入口；`src/loopPlusPause.ts` 同步将该说明写入主任务沟通文件和群聊 transcript，按任务 ID、持久化更新时间与暂停原因标记去重。群聊解析暂停段落时隐藏该元数据，不改写持久化内容。聊天通知写入与文件记录异常隔离，不因单一展示失败丢失另一条证据，也不将暂停改为完成。

### 子任务执行错误上报

当前调用的终态为 `error` 时，使用实际抛出的错误消息和可用错误码，或该次运行的 `TaskRunRecord.failureDetail`。不取助手输出、旧轮次或其它 attempt 充当诊断；无诊断时明确说明。宿主在错误转交主模型和落盘前遮蔽可识别的凭证、限制消息长度，不追加堆栈或完整运行日志。

Loop+ 通过现有失败验收事件及 attempt 沟通文件上报；即使主任务已确认失败，本逻辑子任务的最新 attempt 仍失败且未关闭或取消验收时，后续决策仍可读取诊断。新一轮冻结的事件范围不变。最终 `blocked` 暂停摘要附上宿主观察到的相关原始错误，主模型仍负责判断受影响的要求、可独立推进的工作和恢复条件。新 attempt 替代、成功、主动停止或取消不伪造失败；执行清理、容量和最终完成门禁不变。经典 Loop 的失败留证见[崩溃恢复](loop-crash-recovery.md#经典-loop)。

## 完成提示分层

运行时把任务记录传给单次调用结束文案构建器：Loop+ 主任务显示“本轮调度已结束”，有本轮最终助手回复的子任务显示“等待主任务验收”，无最终回复的子任务显示“任务中断，等待主任务重新派发。”，普通对话与经典 Loop 保持原文案。父任务只有完成状态成功持久化后才显示“全部任务已完成”并触发既有完成提醒；子任务通过或主模型单次调用返回不代替整体目标完成。

## 主任务按需续跑计划

Loop+ 主模型可在 `dispatch`、`steer`、`accept` 或 `wait` 决策中自愿返回 `nextStepPlan`，仅包含必填 `objective`（最多 240 字符）和可选的 1 至 4 条 `acceptanceCriteria`（每条最多 120 字符）。主模型自行判断是否值得把后续工作留给下一次主任务决策；计划不复制当前调度快照或已完成工作，也不新增子任务。

首次领取新验收批次时，主任务先获得一次有限的派发优先机会：判断是否存在不依赖任何未验收结果、与冻结批次交付无写入冲突、并能在当前并发槽及轮次额度内立即启动的独立工作。有则先用 `dispatch + nextStepPlan` 派发，宿主持久化计划并立即以同一冻结批次续跑验收；没有则本轮直接验收，不空跑额外请求。依赖失败结论的修复及其它必须依据验收结果决定的工作留到验收决策或之后。预检无法证明所有提案都立即启动时，整份验收前派发不产生副作用并回到原冻结批次验收；已有冻结批次的重试不再开放此机会。该选序不改变子任务自身 `requiresAcceptance`、派发/验收协议或完成门禁。

宿主只在整份继续型决策通过校验并应用后，才将计划持久化到父任务记录；下一次主模型提示读取该计划，并仍以根需求、补充需求、最新任务记录、冻结验收/报告/消息前缀和 scheduler 状态为准。有效决策可省略计划以消费旧计划，也可直接替换；协议无效、协议纠错、`clarify`、非终态暂停和宿主重建保留待执行计划。模型确认 `blocked`、成功完成父任务或用户停止时清除计划。

计划只是压缩后续主任务决策上下文的提示，不确认验收、不代表完成、不触发派发，也不能覆盖验收顺序、报告/消息确认、依赖、并发、停止、轮次预算或最终完成门禁。`clarify`、`blocked`、`completed` 不允许携带新计划；现有事件驱动循环负责后续调用，不建立额外队列或调度状态机。

## 角色模型与子任务模式

前端历史快照若已保存独立模型或档案、但省略 `cli`，沿用该任务主 CLI；前端独立档案优先，仅同 CLI 且未保存独立档案时使用 `originProfile.configId`。这只恢复执行器身份，不替换前端模型，也不从当前激活配置猜测历史配置。仅有思考档、空白路由、非法 CLI 或跨 CLI 缺档案仍拒绝派发。运行时绑定主模型提示时，同 CLI 的前端、全栈命名角色也保留 CLI 身份，避免再次丢失。

角色路由的 CLI 身份与主 CLI 相同也必须写入全栈、前端请求快照，不能只在跨 CLI 时携带。模型快照取下拉实际显示值：独立角色模型存在时优先使用，未设置时取已有子模型；显式空字符串仍表示 CLI 默认，不等同于未设置。继续时改用当前配置也应用相同规则，尚未保存命名角色 CLI 时跟随主 CLI 并写入完整快照；保持原配置不迁移或猜测历史遗漏的模型。经典 Loop 同样不以是否跨 CLI 决定是否应用已解析的子模型及思考力度。

参数隔离覆盖 Codex、Claude、OpenCode、Grok、DSH、Kimi Code、ZCode，不做 Codex 特判。支持模型选择的 CLI 发送主子角色模型与思考档快照；Claude 按自身能力使用默认模型并保留子角色思考档。OpenCode 子任务模型在启动前水合配置时不得被主模型覆盖，显式角色思考档传入实际运行 variant；未指定时保留该配置、模型、角色自己的 variant。OpenCode 的 xhigh/max/ultra、DSH 的 medium 和 ZCode 原生档位不被通用归一化降档；既有子任务思考上限仍有效。OpenCode、Claude 布局的命名角色下拉同样绑定模型/思考修改事件。

Loop+ 用单一字段 `loopSubtaskMode` 表示 `fullstack` 或 `split`。新任务和输入区缺省 `fullstack`。全栈勾选时只展示并启用「子-全栈」，backend、frontend 和未归类编码都用这一套 CLI、configId、模型和思考力度。取消勾选才展示「子-后端」「子-前端」：frontend 走前端子模型，backend 和其它编码走后端子模型。主模型默认自行完成拆分、仓库推理和普通只读思考；只有规模大、至少能拆成两个相互独立且各自需要充分调查的分析方向，并且并行能显著缩短耗时或扩大覆盖时，才一次派发多个主模型 `general` 子任务。小/中型思考或单一分析方向不派 `general`。需要委派的非简单编码/写入任务（包括代码、测试、文档、配置和脚本）优先按互不冲突且可分别验收的交付边界一次拆成多个子任务并行；存在共享文件或强依赖时保持单任务，不为增加数量而拆分。`general` 读取主 CLI、主档案、`modelRouting.main` 和 `originProfile.mainThinkingMode`，不能携带 `writeFiles` 或 `codingDelivery`。纯回答/只读请求若不需要独立证据或并行分析，主模型直接 `completed`，不创建子任务。

三套配置分别落在 `loopSubtask*`、`loopSubtaskFrontend*`、`loopSubtaskFullstack*`，以及 `modelRouting.subtask` / `subtaskFrontend` / `subtaskFullstack`。切换模式只改变显隐和路由，不互相覆盖。全栈角色第一次缺失时从原子模型完整配置初始化一次，并用 `loopFullstackRoleSeededByConfigId` 记住，避免来回切换重拷贝。空模型字符串表示用户选择 CLI 默认模型，与整组配置缺失区分。

模式和三套配置随发送、排队、`PromptRunInput`、根任务记录和续跑保存。已运行任务绑定创建时的快照。原配置续跑保留原模式和各组配置；当前配置续跑改用当前模式。没有模式、也没有独立前端子路由的旧任务按 fullstack 沿用原子模型，执行不变。已经保存前后端独立配置但没有模式的记录按 split 恢复。未知非空模式或分类拒绝，不猜测。子配置不可用时失败，不回退主模型编码。用户可以把子角色设成与主角色相同的模型名。

群聊续接弹窗分别使用原任务模式和当前配置模式生成模型摘要：split 展示主模型、子-后端、子-前端，fullstack 展示主模型、子-全栈；隐藏角色不进入摘要。原任务模式从任务记录携带，旧任务通过 `resolveStoredLoopSubtaskMode` 沿用同一兼容规则，只有未记录模式且无全栈路由的旧全栈任务才展示原子模型作为全栈模型。当前配置预览完整传递模式、全栈 CLI 及独立角色模型读取回调，与确认续跑时的 `resolveCurrentLoopModelPair` 输入保持一致。经典 Loop 继续使用原有主/子模型摘要。

主模型提示注入当前模式、可用角色和编码约束。fullstack 不再要求为了选模型把所有编码拆成前后端。提示词不是只读沙箱。经典 Loop、普通聊天和 OpenCode `small_model` 不读这个开关。

## 验收方案快照

新建 Loop+ 根任务时，Webview 在 `sendPrompt` 前弹出“主模型验收方案”弹窗，把用户确认的复选项和“其它”审查内容作为 `loopPlusAcceptancePlan` 快照随请求提交。宿主只在该请求属于 `loop_plus` 且不是续跑/恢复/补充需求时接受该字段，归一化后连同 `loopTaskId` 一起写入 `LoopTaskRecord.loopPlusAcceptancePlan`；空基线快照不落盘，读不到的旧任务按固定清单处理。

- 方案下拉第一项是「新增方案」（未保存草稿），其后始终是内置「默认方案」和已保存方案。每次打开使用当前项目最近一次有效选择，明确选回内置默认也会记忆；未保存的新建草稿不覆盖最近选择，无效或已删除选择回退内置默认。方案名称输入框不显示标签，占位文字是「方案名称」：内置默认显示「默认方案」且只读、保存按钮禁用；新增方案预填「新建方案」，自定义方案可以改名和保存。勾选「其它」后的文本域也不显示标签，占位文字是「审查内容」。自定义方案保存时若名称已存在则覆盖那一条，不再新增第二条；「系统默认」和「默认方案」均为保留名称。旧版已保存的「默认方案」在读入时自动改名为「新建方案」，重名时使用「新建方案（2）」等后缀；保留稳定 ID、检查项、其它文本、时间戳及选中关系，后续工作区设置写入会持久化迁移结果，不改既有任务快照。已保存方案可删除，删除前弹出确认；内置方案没有删除按钮。下拉、「保存」和「删除」始终同一行，窄屏时下拉收缩，按钮不换行。

- 快照与模板解耦：弹窗里的方案是可复用模板，任务记录里的是确认时刻的副本。之后修改或删除模板不改变已启动任务；续跑、恢复、补充需求直接读任务记录里的快照。
- 提示注入：`initial` / `review` / `closeout` / `continue` / `user` 五类主模型提示共用同一份快照，只在固定验收清单之后追加已勾选审查项与有效“其它”文本，要求逐项给出证据或显式“不适用”。固定清单、调度协议和“主模型不得自行实现或修复被派发工作”的约束不变。
- 简短验收反馈：`accept` 或 `completed` 真正结束验收后，Loop+ 群聊追加一条「验收结果」气泡。气泡在表格外上方显示真实子任务名、整体验收结果及事件原因；批量确认列出本批所有子任务名和各自结论，共用一张明细表。两列表格仅保留默认及附加检查，第一列是审查内容，第二列是审查结果（通过或未通过，以及证据型原因），不再添加“验收事件”或整体结果首行；原因语言按任务、证据和上下文选择，不强制中文。即使没有附加快照，也必须显示固定六项默认验收：实现完整性、契约一致性、测试验证、产物可运行性、改动合理性、回归与边界检查。「其它」仅展示本次结论和原因，不重复长篇审查要求。
- 完成门禁：正常 `completed` 要求所有已选 `acceptancePlanResults[].passed` 为 true；任一附加项失败即拒绝并反馈具体原因。`accept` 仍允许失败，保留证据并进入修复；未选附加项和已授权 directCompletion 的既有边界不变。

- 反馈协议：`accept.reviews[].reason` 解释各事件的结果，`accept.acceptance.checks[].detail` 和 `completed.acceptance.checks[].detail` 解释六项默认检查；已选择的附加项通过 `acceptancePlanResults[].reason` 解释。每条原因按 Unicode 字符计数不超过 50 字，不适用时说明具体限制，不能编造通过证据。运行时拒绝缺失、空白或超长原因，以及缺少默认项或所选附加结果的决策，走既有协议重试，不生成兜底评价或部分气泡；未发生验收时不写气泡。通用解析入口仍兼容旧数据，严格校验由 Loop+ 运行时启用。
- 固定基线不可关闭：归一化时强制包含基线项，前端布尔值、旧版数据或可选配置都无法移除。
- 模板持久化：方案与当前选中项存工作区设置（`loopPlusAcceptancePlans` / `loopPlusAcceptancePlanSelection`），系统默认是内置只读项，不写入存储。只改模板不会改写已启动任务。
- 群聊修改：Loop+ 群聊顶部「验收方案」打开同一弹窗，确认后把当前复选项写回该任务的 `loopPlusAcceptancePlan`。下一次主模型验收提示立即读取新快照；若复核或收尾正在进行，宿主中止这一轮并按新快照重新提问。空基线会清掉任务上的附加快照。主任务状态为 `completed` 后不再显示该按钮。

## 事实来源与验证

验收反馈以本轮确认事件为边界：`accept` 之后仍按原流程调用主任务收尾，但收尾没有新确认事件时只总结、不生成验收表格，没有派发子任务的直接完成同样只总结。直接 `completed` 确认新事件仍显示对应子任务表格，修复的新 attempt 不被历史确认抑制。展示依据当前决策的确认事件 ID，恢复后同样适用，不依赖内存去重标记；不改写用户已有 transcript，不删除历史气泡；符合简单直办条件且无开放工作或附加审查的收尾，可使用下述 directCompletion 精简协议，其它收尾检查不变。

- 实现：`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/loopPlusSubtaskMode.ts`、`src/subtaskCliRoute.ts`、`src/loopPlusAcceptancePlan.ts`、`src/extensionHost/loopPlusAcceptancePlanHost.ts`、`src/webview/viewContentScript/acceptancePlan.ts`
- 回归：`src/test/loop/loopPlusScheduler.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/test/core/loopPlusAcceptancePlan.test.ts`、`src/test/extensionHost/loopPlusAcceptancePlanHost.test.ts`、`src/test/webview/loopPlusAcceptancePlanDialog.test.ts`
- 验证：`npm run build`；`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/webview/loopPlusAcceptancePlanDialog.test.js dist/test/loop/loopTaskStore.test.js dist/test/core/workspaceSettingsStore.test.js`

## 累计子任务派发

经典 Loop 与 Loop+ 不设父任务级累计子任务派发或重派上限。历史全局设置 `loopPlusSubtaskMaxRounds`、任务记录中的同名字段及旧累计计数均不参与调度；历史值即使达到原上限，也不会阻止后续派发。Loop+ 快照 `seenAttempts` 继续用于调度、验收与恢复，不再作为额度判断。单次派发数量和并发容量仍受当前 `loopPlusDecisionSubtaskMax` 限制；依赖、文件冲突、验收顺序和失败保护保持不变。


### 需求变更：撤销验收与关闭子任务

主任务在用户取消或调整需求、本次交付不再需要时，可对当前冻结批次逐项返回 `reviews[].acceptance="cancelled"`，`reason` 必须非空且最多 50 字。宿主依照原 eventId 顺序提交整批，移除相应待验收事件，在 `seenAttempts` 保存 `acceptance=cancelled` 与 `acceptanceReason`；不撤回既有已验收结论，不将撤销记录为通过或失败。允许混合 passed/failed/cancelled；尚需验收的项继续提供六项默认检查和已选附加审查。全批撤销时无需 `acceptance` / `acceptancePlanResults`，也不生成虚构检查结果。群聊显示「验收已撤销」及原因，保留定位反馈与恢复能力。

撤销仅结算本次待验收交付，不满足依赖执行成功条件；后继继续阻塞并报告 closed 原因。主任务须按最新需求显式调整 pending 依赖、重派原 ID 或关闭已无必要的后继，不自动放行或级联取消。剩余交付和最终父任务完成继续遵守原门禁，晚到事件及消息保留给后续决策。

运行中、排队中及人工中断的开放子任务继续用 `controls:[{id,action:"close",reason}]` 直接关闭。`reason` 可选以兼容旧协议；提供时须非空且最多 50 字，保存到子任务摘要和群聊关闭说明。宿主先持久化 closed 状态，再中断实际调用并关闭旧标签；不产生验收事件，迟到结果不能重开任务。群聊将其显示为「已关闭」。交付已结束并在验收队列中的任务使用 cancelled，不能用 close 绕过冻结批次。
