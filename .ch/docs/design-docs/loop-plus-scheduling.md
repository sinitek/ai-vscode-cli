# Loop+ 完成事件调度

- 状态：proposed
- 相关计划：`.ch/docs/exec-plans/active/2026-09-24-loop-plus-mode.md`、`.ch/docs/exec-plans/completed/2026-09/2026-09-26-loop-plus-batch-review.md`
- 相关规格：尚无。落地前不要写入 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- 相关目录：`src/loopPlusScheduler.ts`、`src/loopPlusDecision.ts`、`src/loopTaskStore.ts`、`src/extensionHost/`、`src/webview/`

这仍不是已上线设计，状态保持 `proposed`。阶段一的内核和独立决策契约保持通过。第 4 轮原恢复、重复结束、旧记录污染、基础 payload、主 prompt、真实快照刷新、按 Tab 模式和暂停展示，第 5 轮取消收尾、基础报告故障、准备失败、自然完成释放控制器、消息无统一轮次和 adapter 接线，以及第 6 轮暂停门禁、内部取消隔离和实际 run 时间窗，已在各自切片通过。计数和未验收边界只记在执行计划里，本文不另留一份通过记录，也不把切片通过写成整体接入。这三项的证据来自当前源码、回归和 AST/VM，不是真实宿主验收，也不是真实 CLI 已回放旧决策。第 7 轮 1168/1162/6 是历史全量。第 8 轮提取契约已接受，不再写仍待修，但不把全量改成 1163/5，也不等于真实界面通过。本轮同批 build、全量和 bootstrap 不预写，也不是本文的已上线行为。

## 背景

经典 Loop 的主从模式按批工作。同一批活动子任务按现有规则错峰启动，互不冲突的任务可以并行；父任务要等这批 `activeSubtaskIds` 清空后才复核。`LoopMainDecision` 仍是 `completed | continue | blocked`。`continue` 且解析不到子任务时，`applyLoopMainDecision` 把记录写成 `needs-review` 并清空活动子任务。debate 只替换主任务规划/复核，共识通过后仍走这条子任务批次链路。Graph 和 Vibe 不使用这套批次屏障。

这个模型不满足“一个子任务结束就验收，验收时其他完成排队，验收后再决定派发或等待”。如果只增加一个下拉选项，或只删掉批次等待，主任务会看不到待验收队列，也可能把正常等待误判成需要人工复核。

## 目标

- 增加可选的 Loop+，使验收由完成事件驱动，而不是由整批结束驱动。
- 让主任务在验收时知道当前项、仍在运行项和待验收队列。
- 验收之后允许增量派发；没有新任务但还有在途任务时，父任务保持 `running` 并正常等待。
- 只有运行、待启动、待验收和尚未查看的用户消息都清空，并且运行时复核过最新状态，才允许结束。
- 群聊“我要说话”在主任务空闲时唤醒它；主任务正在执行时只入队。当前调用结束后，主任务一起查看这批消息，并决定立刻派发子任务，或等待某个仍在运行或待启动的子任务结束后再发起。

## 非目标

- 不改变 Vibe、Plan、经典 Loop、Graph 或 debate 的现有批次语义。Graph 帮助只删除“不能自动解冲突”这句错误缺点，不改变 Graph 调度。
- 不把已验收内核重写成另一套调度器，也不让 AI 输出直接改调度状态。
- 不替换 `conflictGroup` 与写路径重叠规则，不新造第二套 Windows 路径语义，也不在本文规定并发额度数字。
- 不把 Loop+ 的等待协议混进经典 Loop 的 `continue` / `needs-review`。
- 不要求用户按同步轮次操作。`estimatedRemainingRounds` 只是兼容可选字段，不是产品节奏。
- 不把已经存在的帮助文案当成模式选择器或群聊投影。

## 约束

- 用户可见名称是 Loop+。内部模式是顶层 `InteractiveMode` 的 `loop_plus`，常量是 `LOOP_PLUS_INTERACTIVE_MODE` 与 `LOOP_PLUS_DISPLAY_NAME`。它不是第三种 `LoopExecutionMode`，也不复用 `plan`。`normalizeVisibleInteractiveMode` 必须保留 `loop_plus`；`plan` 仍归 `coding`，`lobster` 仍归 `loop`，未知值仍归 `coding`。
- 任务记录使用可选 `schedulingMode`。`resolveLoopSchedulingMode` 只在 trim 后恰好为 `event_driven` 时返回该值；缺省、空值和未知值都是 `classic`。显式 `classic` 会原样保留，未知值在落盘时省略字段。宿主必须看 `schedulingMode`，不能只因为 `loopPlus` 对象存在就当成 Loop+。
- `loopPlus` 保存内核整份快照。store 只做 JSON 往返，不校验、不解释、不应用。`event_driven` 在快照缺失、`null`、数组、字符串或部分损坏时仍保持 `event_driven`，不把父状态改成 `completed`，也不把队列清成空数组。内核加载失败必须抛出，不能静默降成经典任务。
- 执行结束和验收完成不是同一状态。成功、局部失败和局部停止都可以成为待验收结果。
- 主任务和子任务 AI 不得写 `schedulingMode`、`loopPlus`、队列、running、pending、`parentStopped` 或父任务完成状态。解析器只产出决策；宿主按顺序调用内核，再持久化 `snapshot()`。
- 主任务提示禁止输出或续写 Tasklist / todo。主任务 Tab 不展示任务列表浮层，也不因父任务仍在运行而保留上一轮列表；正在执行的是当前编排决策和子任务，不是历史清单。子任务 Tab 仍展示自己的当前任务列表。
- 持久化恢复沿用现有边界：缺失或未知父状态不得恢复成运行中。快照里的 `phase` 字符串不是事实源，运行相位由停止、完成、当前验收、队列和在途集合推导。
- 子任务临时根、Windows junction / hardlink 和任务结束清理继续走 `src/loopSubtaskExecutionRoot.ts`。
- 子任务 attempt 成功结束（outcome 为 `completed`，对应经典 run status `end`）后，先取走本次助手结果，再固定自动关闭该子任务 tab。失败、停止，以及用户中止后的原 tab 不关闭，便于继续。用户在子任务 tab 手动继续并成功结束后同样先关闭 tab，再通知验收。这与经典 Loop 的成功收尾一致，不提供关闭开关。
- 中英文模式说明走现有 Webview i18n 和现有帮助弹窗；颜色继续复用 VS Code 主题变量。本设计不新增主题。

## 方案选项

1. 新的顶层对话模式。产品上与 Vibe、Loop、Graph 并列，调度完全独立。代价是所有 `InteractiveMode` 分支、定时任务、会话恢复和设置都要审计。最终决策采用它，但仍要逐个分支接入，不能只加一个未归一的枚举。
2. Loop 内部的第三种执行方式。可以少改顶层模式，但执行方式归一化会吞掉新值，而且 debate 与经典主从共用批次链路。
3. 只去掉批次等待，仍用现在的决策和活动子任务数组。无法表达验收期间到达的完成事件，也不能区分正常等待和 `needs-review`。

## 最终决策

选择选项 1：Loop+ 是新的顶层对话模式，内部值为 `loop_plus`。经典 Loop 与 debate 继续走原来的批次路径。选项 2 和选项 3 不采用。

定时任务只要交互模式是 `loop_plus`，落盘就不保存 `loopExecutionMode`。Workspace 里按 CLI 记住的经典执行方式不要因为当前模式是 Loop+ 而删除。旧记录没有 `schedulingMode` 时仍是 classic，不能伪造出 Loop+。

### 决策协议

`parseLoopPlusDecision` / `normalizeLoopPlusDecision` 从左到右取第一份能通过校验的 JSON 对象。畸形 JSON、示例对象和经典 `continue` 会被跳过；没有合法决策时返回 `null`，并且不修改入参。子任务最多 6 个，prompt trim 后至少 80 个字符；有 `subtasks` 时只使用该数组，否则单个 `subtask` 对象算 1 个。id 重复、超限或任一子任务不完整，则整份为 `null`。

`estimatedRemainingRounds` 始终可选。合法数字或数字字符串夹到 0–100 的整数，非法值省略而不是拒绝整份决策。它不建立轮次屏障，也不是完成前提。`roundSummaries` 与 `completionRoundSummaries` 不进入 Loop+ 决策，也不是 `completed` 的条件。

出现 `confirmedEventIds` 或 `acceptedEventIds` 时整份决策为 `null`。`reviewEventId` 与 `reviewEventIds` 不能同时出现。解析器不能丢掉未声明的复数确认字段后假装只确认了当前项。

- `dispatch`：必须有 1–6 个子任务，禁止携带 `reviewEventId` 或 `reviewEventIds`。宿主把子任务交给内核 dispatch；冲突或超额的进入 pending，不能只在新批次内部判断。
- `accept`：确认本轮验收批次。只有一项时必须有一个 trim 后非空的 `reviewEventId`；多于一项时必须有按顺序完全相同的 `reviewEventIds`，不能只写第一项。可以带 0–6 个子任务。零个新任务时结果不带 `subtasks`。宿主必须先确认这组 id 就是本轮冻结的批次，再调用 `submitReviewBatch`；不一致时不得改确认成另一组。确认后仍有在途工作，父任务保持 `running`。追加新任务只走这条 `accept`，不走 `completed`。
- `wait`：不能有 `reviewEventId` 或 `reviewEventIds`，也不能有新子任务。它不隐式确认当前项，不写失败总结，也不改变父状态。宿主不得把它实现成 `submitReview`，更不能因此进入 `blocked` 或 `needs-review`。没有验收批次的用户消息轮次里，只有仍有 running 或 pending 时才允许 `wait`；它表示先等在途子任务结束，而不是立刻派发一个占位子任务。没有在途工作时，`wait` 仍按原规则进入人工复核，不能空转。验收批次开着时不能 `wait`。
- `blocked`：只表示真正无法继续，不是“还有任务在跑”。不能带 `reviewEventId`、`reviewEventIds` 或新子任务。`finalSummary` 可选。解析器不改父状态。
- `completed`：必须同时有非空 `answerConclusion`、非空 `finalSummary`、`acceptance.passed === true`、至少一条且全部通过的 checks，以及至少一条且全部通过的 `requirementCoverage`。没有验收批次时省略确认字段。只有一项时可以带一个非空 `reviewEventId`；多于一项时必须带顺序完全相同的 `reviewEventIds`。字段存在但为空，或两种确认字段同时出现，则整份拒绝。不能附带子任务。解析器不完成任务。宿主在确认字段与本轮冻结批次一致时先 `submitReviewBatch` 确认整批，再检查剩余 running、pending、当前验收和排队。剩余工作只拒绝把父记录写成 `completed`，不撤销这次确认，也不能再对同一批 `accept` 并追加子任务。没有任何剩余工作时，最后一批同样合法的 `completed` 可以确认该批并完成父任务，这不是非法完成。父任务被用户停止时仍不能完成。

经典 `normalizeLoopMainDecision` 不变。

### 集合分离

内核同时区分：

- `running`：已启动的执行。
- `pending`：已接收但尚未启动的任务。
- `reviewQueue`：按完成到达顺序排列的待验收事件，不按启动顺序。
- `currentReview`：唯一消费者正在验收的一项。

`visibleReviewCount` 等于排队数加当前项。群聊投影要把当前项和另行计数的排队数同时给主任务，不能用父任务 `running` 或经典 `activeSubtaskIds` 为空来猜测没有待验收项。投影只读现有 `event_driven` 快照，不要求宿主为展示新增 API。群聊时间线不复用经典 `activeSpeaker`。快照 `running` 里的每个子任务在时间线末尾显示“思考中”气泡和打字动画；`activity` 为 `reviewing` 时再追加主任务气泡。`pending`、`review_pending`、`paused`、`stopped` 和 `completed` 不把主任务显示成正在生成，但 `paused` 与 `stopped` 仍为尚未结束的 running 子任务保留该动画。

### 完成事件与单消费者

- 事件 ID 是 `loop-plus-finish#` 加两段十进制长度前缀。`buildLoopPlusFinishEventId("a:b", "c")` 为 `loop-plus-finish#3:a:b1:c`，`("a", "b:c")` 为 `loop-plus-finish#1:a3:b:c`。两者不同。
- 未发布的 `loop-plus-finish:` 冒号拼接不做迁移。恢复时 `eventId` 必须等于该条 `subtaskId` / `attemptId` 的规范编码，并且能解析回同一对；否则抛出 `Invalid Loop+ scheduler snapshot`，不能映射到另一个 tuple。
- 版本号仍是 1。宿主持久化整份 `snapshot()`，至少包括 `version`、`maxConcurrency`、`phase`、`parentStopped`、`completed`、`seq`、`wakeSeq`、`wakePending`、`userMessageQueue`、`running`、`pending`、`reviewQueue`、`currentReview` 和 `seenAttempts`。旧快照没有 `userMessageQueue` 时读成空数组；字段存在但不是去空白后的非空字符串数组则拒绝。加载时不信任 `phase` 文本。
- `seenAttempts[*].outcome` 可选，只在执行结束后写入 `completed`、`failed` 或 `stopped`，验收后保留。旧快照没有该字段时仍可加载。`open` 不能带 outcome，非法 outcome 拒绝恢复。群聊不单独渲染当前验收、待验收队列、仍在运行、待启动和验收结果卡片，数量留在 Loop+ 汇总计数。成员列表不把调度 attempt 显示成验收状态：已确认且 outcome 为 `completed` 显示验收成功，`failed` 或 `stopped` 显示验收失败；旧快照缺少 outcome 时，失败或停止的执行在子任务记录里是 `blocked`，只有这种记录显示验收失败，否则显示验收成功。尚未确认的队列仍是待验收，不提前写成验收失败。
- `userMessageQueue` 只保存尚未被主任务查看的用户消息，不把消息本身变成验收事件。开始一轮验收时，当前项和当时已经排在 `reviewQueue` 里的完成事件一起确认；当时已经到达的用户消息也放进这一轮。没有待验收项时，积压消息仍先于下一条验收被单独查看。查看成功后只确认本轮开始时的前缀，执行期间新到的消息和完成事件留到下一轮。父任务停止、完成或主任务连续失败达到上限时不自动唤醒。未见过的用户消息是完成阻断项 `user_messages`。
- 已完成的 Loop+ 父任务不写经典回答结论和最终总结气泡。缺少这些气泡不能把它当成“完成信息不全、仍可恢复”的任务。用户之后在同一会话提交新的目标时，宿主新建一个绑定该 session 的 Loop+ 任务并启动主任务；新目标不能只追加到旧任务的 `supplementalRequirements`，也不能因为旧快照 `completed` 而被吞掉。显式继续一个已经完成的快照仍然只结算并释放控制器，不重新打开旧父任务。
- 主任务和子任务发给模型的协议提示词仍写入会话消息，用来锚定本轮结果。展示层不渲染这些消息：trim 后以 `You are the Loop+ main reviewer.` 或 `You are one independent Loop+ execution attempt.` 开头的内容，不出现在对话气泡、历史会话、当前运行提示和提示词历史里。不要从存储删除它们，否则本轮助手结果对不上。
- 没有当前验收且父任务未停止时，队首进入当前验收，并只在新的 wake 边沿返回 `wake: true`。已有当前验收时，新事件只追加。
- 同一 attempt 的重复 `finish` 不覆盖新执行。已经按规范 ID 验收过的 `submitReview` 幂等成功且不推进队列。当前项不匹配时返回 `mismatch`，没有当前项时返回 `no_current`。
- 同一时刻只有一个验收消费者。宿主只在 `wake === true` 时唤醒一次，只启动本次返回的 `started`。

### 增量派发

验收或初始派发后，新任务必须与已经在运行和尚未启动的任务一起判断：

- 写范围冲突复用 `conflictGroup` 与 `writeFilePathsOverlap`，实现通过 `buildLoopSubtaskExecutionPlan` 的同一路径语义。
- 路径比较继续使用现有规范化：反斜杠转斜杠、合并重复分隔符、去掉尾部斜杠、忽略大小写，并用父目录前缀判断重叠。
- `maxConcurrency` 是宿主必须传入的正整数策略。内核在超额度时把任务留在 pending，不另选一个产品数字。`loopParallel` 本身仍没有数字上限。
- 一次 `dispatch` 或 `accept` 能附带的子任务数由 `loopPlusDecisionSubtaskMax` 决定。它来自工具设置“AI任务配置”，写入 `~/.sinitek_cli/settings.json`，默认 6，范围 1–20。宿主在解析决策和生成下一轮主任务提示时读取当前值；未配置时仍用 `LOOP_PLUS_DECISION_SUBTASK_MAX`。这个上限不替代 `maxConcurrency`，也不改变经典 Loop 的批次上限。
- 错峰继续使用 `LOOP_SUBTASK_LAUNCH_INTERVAL_MS`（3 秒）。内核返回 `started` 后由宿主延迟，调度器内部不睡眠。
- 待启动任务必须参与冲突判断。同一子任务有未验收 attempt 时，新 attempt 被拒绝。

### 正常等待与完成门禁

- `accept` 确认当前项后没有新任务，但 running、pending、队列或新的当前验收仍有任一项，这是正常等待。父任务状态保持 `running`，不新增一种等待状态。
- `wait` 是尚未确认的挂起。它不是 `blocked`，也不是经典 `needs-review`。
- 等待必须挂在下一次 `finish` 的 wake、用户显式停止或用户显式 `resumeParent` 上。`wake === false` 时不得立刻再次调用主任务。
- 内核 `complete()` 在 running、pending、`review_queue`、`current_review` 或 `parent_stopped` 任一存在时拒绝。宿主不能只相信模型的 `completed` 文本。
- 安全复核次数或连续失败上限可以继续存在，只防止失控，不把 Loop+ 变回同步轮次产品。

### 停止、失败、重试、恢复和清理

- 局部失败或局部停止形成该执行的可验收结果，不停止兄弟任务，也不取消尚未冲突的待启动任务。
- `claimNextReview` 先看 `completed`，再看 `parentStopped`，最后才是 `already_held`。父停止时返回 `reason: "parent_stopped"`、`item: null`，不改状态；当前项仍留在视图里。
- 晚到的 `submitReview` 在父停止后不消费当前项、不推进队列。空 ID 仍是 `invalid_event`。同一规范 ID 若已经 reviewed，停止期间仍幂等成功且不改状态。
- 父停止后的 `finish` 仍可把结果记入队列，但 `wake: false`、`started: []`，不提升 pending。
- 用户继续时只能显式调用 `resumeParent`。加载快照不会自动恢复，宿主也不能手改 `snapshot.parentStopped`。
- `resumeParent` 在仍有 running 时返回 `running_outstanding`，不改队列、pending、`seenAttempts`，也不把旧 running 放进 `started`。宿主必须先用真实结果或 `finish(outcome: "stopped")` 收口每一个旧进程。
- 成功恢复时 running 已经为空：清除 `parentStopped`，把当前验收放回队列队首并清空当前项，保留其余队列、未能启动的 pending 和全部 `seenAttempts`，只提升现在有额度且无冲突的 pending。返回的 `started` 只有这些新项。队列里还有验收项时 `wake: true` 且 `wakeSeq` 增加一次，否则不唤醒。
- 恢复还拒绝超并发、running 互相冲突，以及同一子任务有多个未验收 attempt 的快照。这些快照不会被修成空闲。进程已消失的记录由宿主先收口，不能假装仍在运行。
- 资源清理继续包括子进程、受管服务和子任务临时根。父停止、执行结束和扩展停用都要走到现有清理责任，避免队列账本残留出第二个消费者。
- 异常暂停（`error` / `needs-review`）退回尚未启动的预约，不启动新进程，也不把父状态改回 `running`。代际失效的旧回调不得再写成 running。在途结束只入队。显式继续按原 attempt 启动一次。第 6 轮 host 切片已覆盖该行为，不是真实宿主验收。自动暂停后再父停止、连续落盘失败仍按报告披露，不写成已复现缺陷。
- 内部单次 `cancelInvocation` 不走用户父停止，不把父任务写成 stopped，也不取消其它在途任务。用户从主任务或群聊显式停止仍先关闭父门禁，再取消全部。第 6 轮 runtime 切片来自当前接线和 AST/VM，不是真实 Extension Host。既有 runner 文案 “stopped by user” 不表示父记录已经是用户停止。
- 本次调用的助手正文只取 `max(boundary.startedAt, run.startedAt)` 到 `run.endedAt`。合法预载 user 可以早于 run 起点，不因此丢弃窗口内正文。这不是声称真实 CLI 已回放旧决策。

## 影响与后续

- 纯调度内核已阶段验收，可作为宿主调用的 API。它本身不接触 VS Code、CLI 或磁盘。
- 模式、store 和决策解析已阶段验收。宿主已在经典批次循环之前增加 `event_driven` 分流。第 4 轮恢复死等、重复 `finish`、被拒绝派发、payload、按 Tab 模式、主 prompt 和暂停展示只在各自切片通过，不能当成接入完成。证据计数以执行计划为准。
- 使用说明要求保持有效：中英文写清 Loop 等整批执行结束后集中复核，Loop+ 一个执行结束就开始验收；开始验收时，队列里已经在等待的完成事件一起确认，并带上当时已经到达的用户消息。验收期间新到的完成仍进入可见队列，留给下一轮。之后可以追加任务，没有新任务但仍有运行任务就等待。执行结束不等于验收完成。该帮助不代替整体验收。
- 两处模式下拉都要求 `value="loop_plus"`，同时保留双语正文和 Graph 检查。这不是待用户决策。选择器断言已有 UI 切片通过，仍不是整体功能验收。
- Graph 运行时已经会因同一 `conflictGroup` 或重叠 `writeFiles` 串行化。帮助缺点只保留准备成本、界面复杂度，以及仍然没有图编辑器；不再写不能自动解冲突。这不改变 Graph 行为，也不新声称自动合并冲突内容。
- 基础 `normalizePromptPayload` 在 UI 切片中会保留 `loop_plus` 和角色模型字段。每个 Tab 只接受 `classic | event_driven`，未知或缺失为 classic；前端据此区分主任务模式，子任务仍是 coding，Graph 优先。这些都还不是端到端验收。Loop+ 子消息按自己的任务 ID 关联已有 `loopSchedulingMode` 为 `event_driven` 时不显示统一轮次，已有 UI 切片通过；未知或 classic 继续保留原轮次标签。这不是真实 Webview 验收。
- 群聊投影切片已经能在 `needs-review` / `error` 时显示暂停并保留 FIFO，不再只靠 phase 显示正在验收。真实面板刷新没有做真实环境验收。
- 主 prompt 切片已经写明 `completed` 的必需结构：非空 `answerConclusion`、非空 `finalSummary`、`acceptance.passed === true` 且 checks 全部通过、`requirementCoverage` 至少一条且全部通过。解析器契约不变。真实模型是否照做仍未验收，控制器里的手工 JSON 不能代替提示词。
- 定时任务的存储层已经能保留 `loop_plus` 且不写 `loopExecutionMode`。定时列表标签已有 UI 切片覆盖，真实定时执行未验收。
- 验收矩阵、切片计数、第 7 轮历史全量、第 8 轮已接受的提取契约、未执行的真实 DOM、验证工具缺口和生成噪声清理都以执行计划为准。adapter、运行时集成测试和夹具已经存在。存在、切片通过、23 项契约通过和构建通过都不等于整体验收。本设计不保留第二份通过记录，也不预写本轮同批结果。
- 后续互斥组才同步，本批不改：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/design-docs/index.md`、`ARCHITECTURE.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/ontology/`、`.ch/docs/MEMORY.md` 与 `.ch/docs/memory/`。规格、架构与运行参考及设计索引、ontology、记忆各自互斥。公共事实只能引用已主审验证结论。计划完成且验证收口后才归档到已存在的 `.ch/docs/exec-plans/completed/2026-09/`，现在不移动，也不与事实同步抢共享引用。`.ch/docs/design-docs/index.md` 还没有本文条目。`plugin.loop_task` 与 `plugin.rule.loop_subtask_interruption_isolated` 当前仍是经典整批语义；最终必须写清与 `event_driven` 的不同语义，不能只加别名。精确边界以执行计划为准。
- `.ch/docs/generated/memory-index/.local` 实际被 git 跟踪，此前 recall 留下的差异仍在。第 5 到第 8 轮 recall 都只输出到任务沟通目录，没有再写仓库 generated 层。第 6 轮 anchor 为空，命中 `mem-afae5cc814`。第 7 轮 focus 是 Loop+ `event_driven` 验收队列、暂停门禁、内部取消和真实宿主，anchor 为空，选中 `mem-7850a1dff0`。第 8 轮 focus 是 Loop+ `event_driven` 验收队列最终验证 Webview，anchor 为空，选中 `mem-3624ba969d`，即当前 active plan。ID 变化不是功能变化。本文不生成、不回退，也不把 recall 产物当事实。14 项本任务噪声已确认。本轮有条件清理只待执行，不预写已还原，也不是记忆上提。第 9 轮 recall 只写本项私有证据目录，anchor 为空，选中 `mem-538cb1444d`。

## 仍待后续阶段确定

- 宿主把哪个正整数传给 `maxConcurrency`。本文只固定端口，不选产品数字。
- 第 5 轮当时复现的取消收尾、基础报告故障、准备失败、自然控制器释放和消息无统一轮次，已经由对应切片覆盖，细节和计数只在执行计划里。它们不是整体通过，也不是本设计的已上线行为。
- 第 6 轮三项已经切片通过，但仍不能写成上线：异常暂停后退回尚未启动预约，在途结束只入队，显式继续按原 attempt 启动一次。内部 `cancelInvocation` 不走用户父停止；用户显式主任务或群聊停止仍先关闭父门禁。助手正文限定 `max(boundary.startedAt, run.startedAt)` 到 `run.endedAt`，并保留合法预载 user。证据来自当前源码、回归和 AST/VM。第 7 轮宿主已激活，但这些行为没有真实场景证据。
- 时间窗下界已有选择器切片，但不能据此声称真实 CLI 回放了旧决策。无新输出、提前返回和旧 run 晚到留在该切片的分层记录里。adapter 接线只是切片通过。
- 生产 adapter、运行时集成测试和夹具已经存在。后续真实回归仍要覆盖即时唤醒、零派发等待、丢唤醒、增量冲突、停止/恢复、上面三项切片和经典整批回归，不能只覆盖内存控制器。第 7 轮全量是历史证据，不是这些真实场景。本轮恢复结果不预写。正常等待不要求额外主模型 `wait` 调用，这不是产品缺陷。
- 第 7 轮 `npm run build` 退出码 0。全量 1168 项中 1162 通过、6 失败，重跑相同 6 条，保留为历史，不改成 1163/5。5 条历史或环境失败不修。第 8 轮提取契约已接受：AST 约束 extension → adapter → host，隔离 `tsc` 通过，23 项通过、0 失败。生产未改。不再写仍待修。这不是全量重跑，也不是最终验收。第 6 轮合并 55 和 runtime 23 保持切片通过，不重复相加。
- 裁定保持，不修生产。准确 `eventId` 的 `completed` 先确认当前项，再拒绝父任务提前结束；最后唯一 D 可以合法结束。负向场景独立。第 8 轮私有夹具已拆开，但没有真实 DOM。帮助必须真正 assert，Graph 只限定缺点，统一轮次只查 Loop+ 真实消息。3 秒错峰保留，A、B、C 为 4.2 秒、7 秒、9 秒。正常等待无需额外 `wait`。夹具不是真实模型。真实证据只到启动、加载和 activation 调用；`_doActivateExtension` 不是 provider 已 resolve。
- 验证工具仍需补齐：driver 只有 core，没有 control、classic、early 的完整驱动；CDP 缺少 frame/context 定向；原 extension-tests 未进入帮助路线，约 20 秒保持不适合长场景。下一动作是独占 build、全量和确定性原生命令 bootstrap，不再默认重复键盘或 AX。本轮结果不预写。
- `estimatedRemainingRounds=3` 只是估计：本批补齐验证；成功后并行公共规格与架构、runtime references；随后 ontology、归档引用和最终复核。公共事实和归档仍以整体证据收口为前提。现在不归档，不升 active。`plugin.loop_task` 与相关中断规则目前仍是经典整批语义，最终必须区分 `event_driven`，不能只加别名。
