# Loop+ 未完成目标时暂停的排查方法

## 适用现象

Loop+ 聊天出现“任务已完成”，群聊最后若干子任务验收通过，但整体目标仍未完成，之后没有新派发。

## 必须区分的状态

- **单次 CLI 调用完成**：交互执行正常返回，可能只是生成了验收或阻塞决策，不代表父任务完成。
- **子任务验收通过**：只确认本次派发范围，工具、文档或诊断交付通过不能代替产品整体运行验收。
- **父任务完成**：需要有效的 `completed` 决策与父任务持久化完成状态。
- **主模型报告阻塞**：首次全局 `blocked` 会触发一次有限的剩余工作复核，不立即等同父任务暂停；复核后仍阻塞才将父任务持久化为 `needs-review`。暂停保留未完成状态，不等于主任务完成。
- **协议拒绝**：分为 `format`（解析器输入无可用对象或语法无效）、`validation`（字段或决策内关联不合约）、`state`（与宿主实时状态冲突）。暂停只是可能的处置结果，不能由暂停文案反推拒绝发生在哪一层。
- **有界自动续跑**：初次拒绝记为第 1 次失败，不占自动名额。原主任务会话最多自动请求三次新决策；第四次连续拒绝进入 `needs-review`，不等同于停止或完成。有效决策或用户显式继续获准后重置预算；停止、runner 确认取消、释放或完成后不得再启动续跑。拒绝日志含白名单原因码；恢复日志记录任务关联、阶段、失败计数、预算和结果。
- **历史累计决策暂停**：旧宿主的全局决策安全上限已移除，不要把旧摘要与当前连续协议拒绝预算混用。业务熔断由主模型比较修复证据和剩余工作后判断。
- **停止后的继续被拒绝**：历史提示 `running executions are still live` 对应 `loop-plus-resume-blocked`，表示编排仍有未结算 attempt，并不证明模型调用失败或 CLI 一定存活。分别核对当前宿主句柄、真实执行与启动准备，不以 Tab 缺失或旧快照推定结果。

当前调用链为 `applyBlockedDecision` → `loopPlusBlockReview=pending` → 带 `Bounded blocked review` 的一次主任务复核。若复核发现安全、独立的工作，继续派发并清除该复核状态；否则 `pauseForReview` → 编排宿主 `pause`，设置 `autoPaused`，持久化 `needs-review`、阻塞摘要与已复核状态，通知用户并记录到主任务沟通文件和群聊 transcript。该状态跨宿主重建保留；没有新的用户补充、派发或验收进展时，不会重复复核或自动发起相同阻塞调用。

## 熔断说明不完整或环境缺依赖

业务 `blocked` 气泡统一显示“熔断”，说明子任务多次尝试仍无法解决问题，整体任务尚未完成。核对子任务报告是否有新证据、部分修复或可行的下一步，再核对主模型记录的原因、已尝试动作和恢复条件。主模型调用失败与协议错误各有独立说明，历史记录中的“受阻”“阻塞”原文仍可用于排查。

先确认是否已经经过自动补充诊断：经典 Loop 同轮至多一次；Loop+ 先做一次剩余工作复核，缺失诊断时自动继续执行一次。最终说明应包含具体卡点、因果解释、未完成要求、证据、已尝试处理、首选解决方案、责任方、确认方式和恢复条件。“熔断诊断未补齐”表示主模型没有交付这些信息，不能据此推定业务无法完成；保留的原说明只作为待核实数据。

缺依赖时要明确缺的软件/包/版本和运行环境，区分未安装、PATH 不可见及版本不兼容。安装/配置步骤必须适用于已确认的平台、包管理器和授权，附验证命令和预期结果；未知信息明确列出，不猜包名或默认存在 brew/winget/sudo。检查实际执行任务的扩展宿主、远程环境或容器，另一个终端可用不能证明该环境可用。条件满足后继续同一任务，先确认解阻，只补未完成工作并复用有效结果。能在现有授权内安全修复的应继续执行或派发修复；确需用户选择/授权时使用 clarify，不把问题直接丢给用户。

回归：`src/test/loop/loopBlocker.test.ts`、`src/test/extensionHost/subtaskCliExecution.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`。旧任务只保存 `finalSummary`，仍可展示；新决策的 `blocker` 不完整会被要求补齐。

## 只读取证顺序

先确认故障实例实际加载的扩展版本、CLI、父任务和主会话，按时间对齐调用、暂停前快照和群聊通知（日志时间的 `Z` 表示 UTC）。从任务记录关联到沟通文件，不猜 attempt 文件名。只读核对本地证据；记录时只取受控诊断字段和脱敏关联信息，不抄录提示、回复、用户正文、凭据或私有路径。

1. **确认本轮是否采集到最终助手文本。** 查同一主调用是否启动、是否有匹配的 run 及其终态，再用本地会话记录和可用的 CLI 原生终态证据核对本轮助手消息。`runMain` 经 `readInvocation` 按调用开始时的边界、任务和角色匹配 run；选择最终消息时排除旧消息、重复 ID、时间窗外或不匹配的消息和空白正文。没有匹配 run、run 未正常结束或没有可选消息时，适配器可能返回 `null`；启动记录不等于结束。`format.EmptyResponse` 只说明解析器收到 `null`、空值或空白输入。没有同轮采集证据时，将“模型是否实际给出空回复”记为未知；不能用相邻回合的正文补证。当前协议日志没有逐调用的 run 匹配、助手消息选中结果或文本长度分桶。
2. **区分候选格式和字段校验。** 在 `loop-plus-protocol-miss` 查看 `rejectionKind`、`reasonCode` 和可选 `fieldPath`。`format.ObjectNotFound` 表示未找到对象起始符；有候选时按格式原因码查截断、引号、分隔符等。解析器兼容 JSONC 注释和有效值后的尾逗号；解析诊断可附候选内从 1 开始的行列，但 `formatDiagnostic` 和位置不是该日志字段。`validation` 则检查当前状态要求的字段、子任务形状/数量、分类及声明、验收中每项新增工作是否恰好归属一处。例：`validation.subtasks.InvalidSubtaskCount` 看适用字段和当轮契约；`validation.accept.unlinked_subtasks` 区分 `reviews[].subtaskIds` 与 `independentSubtaskIds`。`validation.invalid_decision` 是通用回退码，不能据此判定具体字段。
3. **用暂停前快照核对宿主门禁。** 看到 `state` 就按具体原因码复核实时约束，而不是继续改 JSON 语法：`state.review_batch.mismatch` 核对本轮冻结验收 ID 与顺序；`state.report_batch.mismatch` 核对报告 FIFO；`state.dispatch_window.preflight_failed` 核对预检时的空槽、依赖及拟派发项；`state.repair.source_unavailable` / `state.repair.linkage_conflict` 核对原任务、原逻辑 ID 与冲突；`state.completion.repair_required` 核对尚欠返工。决策内自相矛盾的关联与依赖当前快照才会暴露的冲突不是一类。该日志还含 `taskId`、`held`、`dispatchWindow`、`protocolFailureCount`、`attemptState`；`held` 反映是否有当前 held 验收项，`dispatchWindow` 的 `open` / `closed` 来自本 step 的派发窗口标志，不能从有无待验收项推算。检查当时的 `running`、`pending`、`reviewQueue`、`currentReview`、`completed` 和 `parentStopped`；恢复后的快照不能反证当时的门禁。
4. **核对自动续跑或暂停。** 在同一 `taskId` 的时间窗对照 `loop-plus-protocol-recovery`：`result=continuation_requested` 表示请求在原主任务会话按当前 step 重判，不等于主调用已启动；`recovered` 表示协议失败状态已清除，不等于父任务完成；`paused` 表示走到协议暂停分支，结合 `needs-review`、`finalSummary` 和 `loop-plus-protocol-paused` 的宿主通知/沟通记录确认落地；`manual_resume` 表示显式继续时清除已有连续失败计数（没有待清除计数时，不保证出现）。该日志还含 `protocolFailureCount`、`automaticRetryLimit`、`attemptState`（`first`、`retry` 或 `explicit_resume`）。以 [调度设计](../design-docs/loop-plus-scheduling.md#协议失败后的自动续跑) 为预算参考，不在手册另定次数；排查历史实例时以实际加载版本和日志字段为准。`loop-plus-protocol-miss` 与 `loop-plus-protocol-recovery` 走普通诊断日志，非调试配置可能不记录；`loop-plus-protocol-paused` 是通知/暂停记录标识，不是这两类日志之外的第三个结构化事件。区分业务 `blocked`、CLI 调用失败和手动停止；不要通过修改快照、伪造验收或反复点击绕过门禁。
5. **对照群聊“继续执行”入口。** Webview 发出 `loopGroupChatChat:continueTask`，到协调器后才记录 `loop-group-chat-continue-received`。按相同 `taskId`、`requestId` 和时间窗口顺查下表；这些事件通过宿主常驻日志入口写入。仅有此前的暂停或后续的协议拒绝不能证明按钮事件已抵达，也不能和没有 `requestId` 的其它恢复混作同一次点击。

| 群聊宿主事件 | 看什么、不能推断什么 |
| --- | --- |
| `loop-group-chat-continue-received` | `panelMatchesTask` 辅助核对来源面板；事件出现才有该入口的收件证据。缺记录时核对实例版本、面板/任务和日志时间窗，标为“到达未确认”。源码未接通配对的 Webview 发送日志，不能凭缺行判定点击未发出或传输丢失。 |
| `loop-group-chat-continue-started`、`loop-group-chat-continue-evaluated`、`loop-group-chat-continue-rejected` | `started` 只表示协调器受理，不是 CLI 启动；`evaluated` 的 `status`、`schedulingMode`、`runningTask` 是评估时的宿主视图。按 `rejected.reason` 排查，如 `continuation_already_active`（可在 `started` 前拒绝）、`active_subtasks`、`main_tab_active` 或 `model_unavailable`。 |
| `loop-group-chat-continue-subtasks-resumed`、`loop-group-chat-continue-subtasks-fallback`、`loop-group-chat-continue-dispatch` | 先用 `path` 区分 `original_runtime` 与 `main_target`。子任务续跑路径已接管时不要求紧随主任务 `dispatch`；`dispatch` 只说明选定路径和 `cli` 并提交续跑，不证明已启动。 |
| `loop-group-chat-continue-task-started` | 带 `requestId` 的任务启动回调；普通主任务路径在获取编排归属时回报，不等于 CLI 已返回文本。未见回调时记为“启动未确认”，先看是否走子任务路径、被拒绝或已结算；确认启动后，再按父任务和时间对照新一轮协议日志与任务状态（协议日志没有 `requestId`）。 |
| `loop-group-chat-continue-failed`、`loop-group-chat-continue-settled` | `failed.errorName` 是协调器捕获的异常类型；`settled.taskStatus`、`settled.canContinue` 是协调器收尾时的任务视图，不是决策通过或父任务成功的证明。重复请求的早期拒绝可直接给面板发结算消息，不一定有对应的 `settled` 日志。 |

群聊有待验收但主任务在等时，先对照最近主调用的 `Acceptance batch count` 和 `reason=execution_pending` 等依赖说明。后继队列有事件、验收批次为零，且前置最新 attempt 仍开放，表示依赖暂缓，不是事件丢失；前置旧 attempt 不能替代最新重跑。先确认最新 attempt 是真实在跑、等待启动还是已失联。分钟验收巡检只补可领取的验收，不会跳过该前置，也不会重启子任务。

## 典型误判与后续处理

- VS Code 崩溃后不能只凭持久化 running / activeSubtaskIds 认定还有进程。新运行核对保留子任务关联并记 `runtimeInterrupted=true`；手动继续原子任务，成功结果会重建 Loop+ 完成回报并通知主任务验收，其余失联子任务仍需继续。不要删除快照、修改 attempt ID 或伪造完成。旧版 stopped 记录若没有中断标记，需显式继续父任务；不得把用户主动停止猜成崩溃。实现与验收边界见 [恢复设计](../design-docs/loop-crash-recovery.md)。

- 子任务全部执行结束且 `phase=reviewing`，不代表验收决策已被接收。读取原主模型 JSON，用 `parseLoopPlusDecisionWithFeedback` 按运行时选项只读回放，核对 `reviewEventId(s)`、`reviews` 和 `subtasks`；新任务须恰好归属一个 `reviews[].subtaskIds` 或 `independentSubtaskIds`。事件相关任务可关联通过项并保留真实结论，独立剩余交付使用独立列表。只派修复时检查沟通文件中的剩余目标、空槽及依赖说明，避免把局部验收缺口当全局屏障。不要直接改持久化任务或替主模型伪造通过。
- 协议暂停后，先依据受控原因码补齐缺失条件，再使用群聊继续入口按当前快照重新判断；旧摘要没有可识别原因码时走通用安全提示。不要回灌原回复，也不需要重做仍有效的业务审阅和测试。
- `mainAiFailureCount=5` 不等于模型服务连续报错。先核对 `mainAiLastFailureMessage`：若为 CODEX_THREAD_HANDOFF_FAILED / waiting_close，失败可能发生在发起模型请求之前。0.145.0 原生默认卸载为 30 分钟，旧共享策略的 75 秒交接等待不能收敛；原生会话 metadata 的创建版本只证明创建时版本，历史启动版本仍应与实际可执行路径证据区分。
- 兼容策略仅共享已确认支持即时卸载的版本，其余连接按 runner 归属专用；恢复前等待原进程实际退出，不强杀共享或外部 writer。Loop+ 对不可重试的会话错误第一次就暂停，保留当前验收与队列；其它错误最多连续五次。群聊、主聊天、暂停文件展示相同原因，旧空摘要从失败字段重建。
- 停止后若子任务已不存在，显式继续应把无句柄的开放预留结算为 `stopped / lost-process`，保留原验收事件，由主模型重新评审或派发；不要求恢复已经消失的子 Tab。当前源码另支持取消来源租约、后台压缩及 CLI 启动前的准备等待；取消只释放等待者，不停止前驱/原压缩，迟到准备不启动 CLI。已开始的实际调用仍需确认收尾。旧扩展中的内存等待不会因修改源码自动消失，应在其余任务允许重载后使用新源码验证；不要直接清空 running 或修改运行 JSON。
- `Codex app-server 异常退出（code 127）：...command not found...` 是 shell 启动缺命令，应与普通工具执行正文区分。宿主 PATH 能解析不保证登录 shell 能找到；自动修复可固定发现的可执行文件绝对路径，在原 Tab 新会话重放原输入一次，停止/被替代时不重放。已有明确可用命令时，普通文件或 cwd 的 ENOENT 不应触发该修复。
- `ENOSPC` 先用当前磁盘空间与写入错误核对是否仍存在；历史磁盘满不能解释空间恢复后的所有暂停，也不能因当前空间充足否定历史失败。
- Loop+ 是事件驱动调度，不使用经典 `currentRound` 计数；历史记录中的 0 不能证明主任务从未派发或执行。

- `run.completedWithDuration` 反映单次执行状态；与父任务暂停通知相邻出现时，应以父任务决策和状态解释整体进度。
- 群聊最后一项为“通过”不意味着全部要求完成；主任务沟通文件也不保证包含最终暂停原因，应继续查 `finalSummary` 和原生最终回复。
- 暂停通知会展示阻塞摘要与恢复条件，主任务沟通文件和群聊 transcript 也应有带去重标记的暂停段落；如果聊天通知写入失败，仍应核对文件记录与 `loop-plus-pause-message-failed` 日志。
- 部分恢复执行被前置条件阻塞时，仍需检查是否存在独立且安全的实现、测试或文档任务；整体排队为空只说明当前没有已派发工作，不证明所有剩余目标均无法推进。
- 无新证据时不要无限重复同一失败诊断，也不要通过删除门禁、伪造成功或修改任务记录强制“继续”。需要人工条件时明确缺失证据、负责人及恢复触发方式。
- 核对任务是否已被后续用户消息恢复；只读调查不能打断正在执行的 attempt，也不能用恢复后的 `running` 否定历史暂停。
- 产研部 Loop+ 冷启动后若根已是 `stopped`、模块仍显示 `running`，且部门快照 `runtime.stopping=true`，不能据此认定仍有执行。只读核对组长任务是否 `stopped`、Loop+ `parentStopped=true` 且 `running` 为空，以及持久容量是否为空；不要手改用户任务或容量 JSON。常规恢复的 `unverified-leader-session-or-plan` 栅栏只有在显式冷中止重新验证全部身份、停止回执，并成功写入及读回停止快照和空容量后才能解除；其它持久化或执行失败继续封闭续接。修复版本需要在扩展宿主重载后才生效。

## 子任务完成但标签仍保留

完成收尾顺序为：主任务接收完成回报并持久化 → 按现有开关和时长条件压缩子会话 → 关闭完成时捕获的原标签。主任务验收不等待后台压缩，同会话再次执行需等待收尾；压缩失败仍执行关页。失败、中断、回报失败及过期完成事件保留现场。

排查时对齐 `loop-subtask-auto-compact-failed`、`loop-subtask-tab-auto-close-error` / `loop-plus-subtask-tab-auto-close-error` 与对应 `tab-auto-closed` 日志。Loop+ 的 `loop-plus-report-failed`、`loop-plus-finish-ignored`、关页失败和关页成功事件在非调试配置下也会记录；关页失败包含 attempt 次数、是否重试及宿主错误。CLI 终态提示只表示子任务 run 结束，不证明 Loop+ 回报已持久化或标签已关闭。旧实现中经典 Loop 未等待压缩便关页，Loop+ 则在完成回报前关页；遇到活跃任务时共享清理可能跳过关页，调用方仍记录成功。当前实现会核对关闭是否生效，并保护压缩期间新增、替代、换绑或仍在运行的标签；Loop+ 完成回报提交后在相同身份守卫下最多重试一次，重试耗尽则保留标签并记录失败。关闭失败不会改写已成功的完成回报，应按错误原因核对原标签与当前任务，不要强关正在使用该会话的新任务。

当前源码还覆盖两个遗漏边界：旧标签关闭或界面刷新失败后继续清理本次成功标签，最终错误汇总包含实际失败标签；压缩期间主标签关闭导致只剩子任务标签时，自动关闭原标签并保留同 CLI 空白对话，在配置恢复前发布新标签状态，避免恢复失败留下旧界面，仍拒绝关闭活动运行和锁定主任务。回归入口为 `src/test/session/sessionTabCliSwitch.test.ts`。检查实例时同时核对运行中的扩展版本与宿主是否已重载；源码、磁盘已安装扩展版本及最后两条系统提示，均不能单独证明该旧实例采用当前关页逻辑。

## Loop 主任务 Tab 意外消失

搜索 `conversation-tab-close` 常驻日志，并按 `tabId`、`loopTaskId` 和时间顺序检查 `requested`、`rejected`、`skipped`、`closed`：`rejected` 的 `reason` 区分运行中 Tab、主任务仍运行、目标身份变化及宿主未实际关闭；只有 `closed` 表示宿主复核确认该 Tab 已移除。所有 Tab 关页都会记录；若 `taskRole` 与 `loopTaskId` 均为 `null`，表示当前没有解析出 Loop 身份，应结合 `tabId` 和同时间段运行日志判断是否是 Loop 元数据缺失。日志不含会话 ID 或消息正文。若看见 `closed`，再按相同时间窗口核对主任务终态、子任务交接/压缩关页及扩展停机日志；若没有该事件但 UI 标签消失，应检查面板 Tab 状态投影/刷新，而不是先推断底层会话被删除。

## 旧版本配置锁超时提示

当前版本已移除跨窗口配置锁、任务执行租约及启动时面板快照校验。若仍看到“等待其他窗口配置操作超时”，通常运行的是尚未重载的新版本之前的扩展宿主；检查实际加载的扩展版本并重载窗口。新版本不再产生 `RUNTIME_CONFIG_LOCK_TIMEOUT`，配置并发写入按最后完成者生效。

## 验证与事实来源

### 首次主决策终态交接

默认日志中的 `loop-plus-invocation-diagnostic` 只包含白名单 `stage` / `code`，不包含任务正文、路径、会话标识或异常文本。`execution` 阶段的 `early-exit`、`transport-interrupted`、`unknown` 只在异常证据足以分类时区分；`run`、`handoff`、`projection` 阶段分别标示运行完成、身份交接和投影缺失。事件缺失不证明未产出。运行时只将原生终态观察时绑定的同一助手消息交给首次校验；终态信号已观察但正文或身份绑定缺失时，会拒绝并禁止回退到普通消息投影；只有未观察到原生终态信号的 CLI 才沿用既有投影策略。后续消息、历史正文和其它会话均不能补齐。当前受控回归证明受控路径行为，不证明过去某次真实 CLI 的根因；CLI/版本及 VS Code 宿主现场验证仍需单独完成。

单次事故按上面的阶段标注已确认和未知，缺少最终文本或点击链路证据时不要补猜。结构查询用于定位，当前源码用于确认接线，历史运行记录用于证明事件发生；不要以当前源码或测试代替历史证据。版本演进和待补信号见 [根因分析](../../../docs/LOOP_PLUS_DECISION_BLOCKING_ROOT_CAUSES.md)。

- [运行适配器](../../../src/extensionHost/loopPlusRuntimeAdapter.ts)：`runMain`、`readInvocation` 与本轮最终助手消息选择。
- [决策策略](../../../src/extensionHost/loopPlusDecisionStrategies.ts)：`applyBlockedDecision`。
- [宿主编排](../../../src/extensionHost/loopPlusOrchestration.ts)：有界阻塞复核、`pause` 与显式继续路径。
- [协议提示](../../../src/extensionHost/loopPlusPromptBuilders.ts)：`blocked` 复核、`clarify`、`completed` 的契约。
- [决策解析](../../../src/loopPlusDecision.ts)、[受控诊断](../../../src/loopPlusProtocolDiagnostics.ts)与[纠错上下文](../../../src/loopPlusProtocolRepair.ts)：格式/字段诊断、宿主原因码与自动续跑。
- [群聊面板](../../../src/webview/loopGroupChatPanel.ts)与[宿主协调器](../../../src/extensionHost/loopGroupChatPanelCoordinator.ts)：继续请求、宿主收件与回执。
- [暂停沟通记录](../../../src/loopPlusPause.ts)：主聊天、主任务沟通文件与群聊 transcript 的暂停说明。
- [单次调用完成文案](../../../src/promptRunState.ts)：`buildTaskRunCompletionText`。
- [消息映射](../../../src/extension.ts)：`loopPlusHostMessage`。
- [编排回归](../../../src/test/extensionHost/loopPlusOrchestration.test.ts)：有界复核、跨重建状态、暂停记录与父任务完成提示边界。

只读排查或本文档维护不要求启动业务、调用真实诊断、修改用户任务、执行 build 或重跑运行时单测；若改变暂停、恢复或提示行为，再按 [测试规则](../TESTING.md) 补最小回归并执行 build。
