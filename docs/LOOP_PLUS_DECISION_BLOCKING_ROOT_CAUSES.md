# Loop+ 主任务决策拒绝的版本与根因分析

## 结论与边界

用户感到“从 1.9.0 起更容易因主任务决策被拒而暂停”，与代码演进中**决策进入更多有状态门禁、失败后仍以有界重试结束**相符；但仓库里没有按版本、CLI、决策阶段和拒绝类别汇总的同口径尝试量。因此，这只是机制解释，不足以证明 1.9.0 是故障首次出现的版本，不足以证明拒绝率或最终暂停率实际上升，也不能将整体波动归因给某个提交。

关键边界：1.8.15 与 1.9.0 的 [决策解析器](../src/loopPlusDecision.ts) 在两提交之间没有差异，故不能将相邻版本间的症状直接归因于解析器改写。早期解析器已经会丢弃不能归一化的输出；“有校验”不等于已有当前所有事件、快照与返工关联规则。后续规则逐步增加，合法决策的边界变窄；受保护的验收、报告、依赖、返工和完成门禁则是安全不变量，不应为降低拒绝数而绕过。

本文是版本/事故分析，不复述 [决策可靠性长期实施方案](LOOP_PLUS_DECISION_RELIABILITY.md)，不接管 lp322 或其它功能设计、清单、本体与在途计划。未记录历史原始回复、完整提示、任务 ID、私有路径、令牌或用户运行明细。所述当前原因码与分阶段诊断是本地源码观察，不是历史事故取证。

## 基线、演进与发布核对

用 `git show` 核对提交对象中的 package 版本与 author/committer 日期；版本号以该提交实际 `package.json` 为准，而非提交标题。1.9.x 同日多次提交可处于相同 package 版本，不应把每个提交误称为单独发布版本。

| 节点 | package.json 版本；提交日期 | 与决策/症状有关的可核源码事实 |
| --- | --- | --- |
| `e41004e0` | `1.8.15`；2026-11-11 | `src/loopPlusDecision.ts` 已提供抽取 JSON 对象、JSON.parse 与决策归一化；`src/loopPlusScheduler.ts` 已提供队列/完成判断，`src/extensionHost/loopPlusOrchestration.ts` 已调用解析器并应用宿主决策。解析失败返回空决策，编排可形成阻塞；所以早期已有基础校验和拒绝路径。 |
| `65f2bcfe` | `1.9.0`；2026-11-12 | `git diff e41004e0 65f2bcfe -- src/loopPlusDecision.ts` 为空。该提交的 Loop 源码变化集中在 `src/loopModelSwitch.ts`、`src/extensionHost/loopModelSwitchResume.ts`、`src/extensionHost/loopGroupChatPanelCoordinator.ts`、`src/webview/loopModelSwitchDialog.ts` 及 Loop 会话/面板投影；支持切换模型并继续停止任务。不能从新增路由和中断恢复本身推出 JSON 拒绝增加。 |
| `34aade46` | `1.9.3`；2026-11-13（提交标题为协议纠错功能） | `src/loopPlusDecision.ts` 开始返回带原因的解析结果；新增 `src/loopPlusProtocolRepair.ts`；`src/extensionHost/loopPlusOrchestration.ts` 收到解析/状态拒绝后保存纠错上下文并可重问。这改变拒绝的可诊断性和恢复路径，不等于拒绝根因首次出现。 |
| `1b3dfb1f` | `1.9.6`；2026-11-15 | `src/extensionHost/loopPlusOrchestration.ts` 隔离 attempt 并冻结当前验收批次；`src/extensionHost/loopPlusPromptBuilders.ts` 与 `src/extensionHost/loopPlusDecisionStrategies.ts` 随之遵守批次。冻结事件身份/顺序后，旧 ID、漏项、重排更容易被判为不符合当前快照；这是可解释的拒绝边界变化。 |
| `07953676` | `1.9.11`；2026-11-17 | `src/loopPlusScheduler.ts` 加入显式依赖、报告队列和依赖优先验收批次；`src/loopPlusDecision.ts` 接受 `reportEventIds`、`dependsOn`、`taskType` 等契约字段，`src/extensionHost/loopPlusOrchestration.ts` 冻结/核对报告 FIFO 顺序并结合快照派发。解析器仍有字段/数量验证，但新增跨字段与宿主状态拒绝面。 |
| `2334317f` | `1.9.13`；2026-11-18 | 该提交版本节点 package 为 `1.9.13`；后续 `261519f6`（2026-11-19，package 同为 `1.9.13`）在编排中加入验收前派发独立工作窗口。窗口关闭时普通 `dispatch` 不等于合法；窗口开启也仅允许通过预检、立刻启动且不越过冻结验收的派发。提示形状与宿主状态会影响拒绝。 |
| `5647ac92` | `1.10.0`；2026-11-23 | `src/loopPlusDecision.ts`、`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusDecisionStrategies.ts` 增强失败验收必须有返工或明确无返工理由、欠返工阻止完成。错误的修复归属、ID 或不处理真实失败项会被拒绝/阻断；这是更强契约，不是 JSON 语法校验。 |
| `4fa4a84b` | `1.10.3`；2026-11-24 | `src/loopPlusProtocolRepair.ts`、`src/extensionHost/loopPlusOrchestration.ts` 将协议失败后的自动纠错收敛为一次续跑，续跑仍无有效决策则暂停；这使“拒绝后暂停”成为显式有界结果。该版本号由提交 package 确认。 |
| `a7895ada` | `1.10.3`；2026-11-25；当前提交 | 本工作区 `package.json` 已改为 `1.10.5`，但未提交；该提交自身仍是 `1.10.3`。工作区决策解析器、策略、编排、运行时与诊断文件还有未审查改动，属于 **1.10.5 工作区候选观察**，不视作已提交版本或已修复。 |

上述版本中，Marketplace VSIX 下载端点对 `1.8.15`、`1.9.0`、抽样 `1.9.x`、`1.10.0`、`1.10.2` 和 `1.10.3` 返回可获取（HTTP 200）；本次核查未取得/验证 VSIX 内部 manifest 与源码对应关系，也未确认 `1.10.5` 发布。故只确认端点可取对应版本包，不声称已在运行环境验证其内容；尤其不得把 `1.10.5` 工作区候选称为已发布或修复。源码提交日期不是 Marketplace 发布时间。

1.9.0 相邻比较还显示运行时模型路由和停止任务恢复的用户可见路径扩大：群聊继续可经原运行时恢复或主模型目标回退。它们可能改变实际选择的 CLI/模型、会话及最终回复来源，从而成为分层统计的混杂因素；相邻差异没有证明这些变化会导致空回复或解析失败。1.9.0 的群聊验收气泡/定位、显示摘要修正等面板变化亦不能单独证明点击未到达或后台拒绝。需用事件链和对应运行记录验证。

## 决策到暂停的因果链

1. **CLI 最终文本采集。** `src/extensionHost/loopPlusRuntimeAdapter.ts` 的 `runMain` 等待调用完成，再由 `readInvocation`、`selectLoopPlusInvocationAssistant` 根据 run 边界、主任务角色和消息来源取最终助手文本；执行被停止、未完成或没有可匹配 invocation 时可得到 `null`。CLI 能力、会话续接与边界选择不同，最终采集不是“模型必定返回了 JSON”。必须区分没有文本、调用未完成、选错/未选中本轮消息和文本确实不是对象。 |
2. **候选提取和语法解析。** 当前 `src/loopPlusDecision.ts` 的 `parseLoopPlusDecisionWithFeedback` 从文本提取 JSON 对象，容忍注释和有效值尾逗号，再解析候选。`null`、空白文本属于 `EmptyResponse`；未找到候选、截断/非法 JSON 属格式错误。它们不是结构字段不合约或宿主状态不允许。早期实现已有 JSON 对象抽取和 JSON.parse，但无当前分层的反馈诊断；后期诊断改善分类，不反证历史原因。
3. **字段与跨字段校验。** JSON 可解析仍须有有效 `status`、该状态的字段和受限子任务数/分类；依赖字段需自洽，验收中的新任务须恰好关联到真实验收项或合法独立工作。当前失败项需有有效返工，或符合规则的无返工理由。`taskType` 与写文件/编码声明冲突、漏填派发项、数量越限、`subtasks` ID 重复、`reviews[].subtaskIds` 与 `independentSubtaskIds` 漏项/重项/引用未知项，都属结构或关联拒绝，**不是 JSON 语法错**。
4. **宿主快照与门禁。** 解析后 `src/extensionHost/loopPlusOrchestration.ts` / `src/extensionHost/loopPlusDecisionStrategies.ts` 还需核对决策与 scheduler 快照：冻结验收 ID 及顺序、报告 FIFO、当前运行/排队项、派发窗口、依赖、原子任务身份与未结返工。失败返工必须可关联当前失败事件或欠返工记录，按合法原逻辑 ID 继续，并且不能覆盖或撞上其它现有 ID；事件找不到原任务、同一决策重复派发 ID、用无关 ID 顶替，都属**宿主关联/状态拒绝**。它们不能被描述为解析器的 JSON 错误。
5. **有界续跑或暂停。** 2026-11-13 的 `34aade46` 已加入协议失败纠错；2026-11-24 的 `4fa4a84b` 将自动纠错变为一次续跑，仍无合法决策即按协议暂停。一次续跑只给主任务再依据当前快照回答的机会，不确认事件、不消费报告、不重试业务派发、不豁免完成门禁。因而不同上游拒绝最后可汇聚到相同暂停表现；只看暂停通知不能倒推出发生在采集、JSON、schema 或宿主校验哪一层。

## 三类可见症状

### 空回复或“JSON 格式”拒绝

`EmptyResponse` 只说明交给解析器的最终内容为空/空白。可能由调用未完成/中止、无本轮可选消息、适配器本轮边界问题或真实空回复导致，不能单凭此码归咎模型，也不等价于非法 JSON。若有非空文本但缺少对象、候选截断或语法错误，才是候选提取/JSON 语法层；存在合法 JSON 对象但字段、数量、分类或验收关联不合约，是结构校验层。历史泛化“格式错误”文案不足以将这些情形拆开。

### 派发项数量或任务分类拒绝

解析器确有子任务数组/数量、项形状、ID 唯一性、分类和编码交付等校验；上限还受当前轮次/空槽及决策类型影响。因而“数量不对”既可能是 JSON 内数组形状/数量校验，也可能是通过解析后宿主快照不允许立即派发；“任务分类不对”则是字段契约及跨字段一致性问题。需保存受控拒绝类别、字段路径及适用索引才能判定。不同版本的派发额度、验收窗口、并发槽和任务类型契约有变化，不能将后版阈值倒套到早期回复。

### 失败返工关联或 ID 冲突

`reviews` 的失败结论须关联真实失败的逻辑任务；若需修复，派发返工须恰好关联失败项并沿用其原逻辑 ID，若无需返工则使用规则支持的显式理由。返工缺少合法来源、错连其它事件/任务、用新 ID 替代欠返工项或与同决策中的已有项 ID 冲突，通常在解析成功后由跨字段或宿主关联拒绝。**返工关联拒绝不是 JSON 语法错误。**“群聊继续后仍暂停”也可能只是将此类拒绝再次暴露，而不能据此断言按钮请求链路成功或失败。2026-11-26 09:35 的实例按沟通记录、当日日志和当前源码分层写在下一节。

## 2026-11-26 09:35：`validation.accept.failed_repair_missing`

这一节只分析当日记下的一则失败返工关联通知。观察、推断和未知分开写。当前源码用来说明校验顺序，不用来宣称当时加载的二进制与工作区逐行相同，也不宣称根因已经修复。

### 观察

**暂停通知。** 当前任务主沟通在 2026-11-26T09:42:25.070Z 收录了一则更新时间为 2026-11-26T09:35:19.019Z 的暂停，状态为 needs-review。具体原因以「决策协议校验失败（validation）」起句，原因码是 `validation.accept.failed_repair_missing`，后面是该码的固定提示，没有 `field=`。次数句是「主模型决策未通过校验，已自动继续执行一次，续跑后的决策仍未通过校验」。同一主沟通在 2026-11-26T08:12:05.002Z 的暂停写的是「已自动继续执行 3 次」，与当前 `src/loopPlusProtocolRepair.ts` 在 `LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT = 3` 时拼出的句子一致。09:35 的次数句则与提交 `a7895ada`（2026-11-25）中 `src/loopPlusProtocolRepair.ts` 的固定句子一致。该原因码的固定提示与提交 `081b33c7`（2026-11-26，提交说明为 version 1.10.5）以及当前工作区 `src/loopPlusProtocolDiagnostics.ts` 的表项一致。`a7895ada` 的树里没有这个原因码；`081b33c7` 的树里没有「已自动继续执行一次」。当前 `dist/loopPlusProtocolDiagnostics.js` 含有该提示，当前暂停构建器不会生成「一次」这句。这则通知因此同时带有两段目前不在同一已核提交里的文字。它证明写出通知的宿主使用了这个原因码和这两段文字。它没有证明加载的是 `a7895ada`、`081b33c7`、当前工作区或某个已发布包。

**决策形状来自派工记录。** 同一主沟通的「2026-11-26｜区分两次拒绝及本次派工边界」写明：09:35:16.496Z 的助手终态是可解析的 `accept`；四项结论依次为通过、失败、通过、失败；第 2、4 项都没有 `subtaskIds` 或 `noRepairReason`；同一响应的 `subtasks` 含返工候选，另有单独的 `independentSubtaskIds`。该记录把第三个候选称为已经正确标成独立工作。暂停正文没有四项结论、行下标或原始对象。本尝试在任务沟通文件里没有找到该原始 JSON，也没有重放解析器。

**当日保留日志。** `src/logger.ts` 把诊断写到用户主目录下的 `.sinitek_cli/logs`。2026-11-26 主日志全文里，`loop-plus-protocol-miss`、`loop-plus-dispatched`、`loop-plus-protocol-recovery`、`failed_repair_missing` 和 `state.dispatch.rejected` 的出现次数都是 0。性能日志在 09:35:18.871Z 至 09:35:18.920Z 有 `mode=loop_plus`、`role=main` 的 runner、invocation 和 main-turn，结果都是 `returned`；main-turn 时长约 1444.6 秒。09:35:16.496Z 不在这两份日志的时间戳中。主日志 09:35:22.087Z 有一条 `loop-group-chat-continue-settled`；本尝试没有解读它的载荷。08:21:32Z 的主日志行是 `conversation-tab-close`（.275Z、.279Z）和 `loop-plus-subtask-tab-auto-closed`（.413Z）。暂停通知上的 08:21:32.130Z 与这些行不是同一条记录。

**当前源码里的三层顺序。** 下面是工作区阅读，不是对 09:35 原文的重放。

1. **JSON 可解析。** `src/loopPlusDecision.ts` 先抽取对象并做 `JSON.parse`，然后才做字段校验。空文本或语法错误走 `format`，其中包括 `EmptyResponse`。09:35 通知的类别是 validation。派工记录称终态是可解析的 `accept`。两者方向一致，原始文本仍未附在沟通文件中。
2. **跨字段验收协议拒绝。** `readAcceptReviews` 在 `subtasks` 与 `reviews[].subtaskIds`、`independentSubtaskIds` 的集合相等检查之前返回：某一项 `acceptance === "failed"`，且 `subtaskIds` 为空，且没有非空 `noRepairReason`。原因句包含「验收失败必须关联修复子任务」。`loopPlusProtocolParseDiagnostic` 只在原因句包含该句时映射到 `validation.accept.failed_repair_missing`。按当前调用顺序，进入该函数表示 `subtasks` 已通过形状校验，并且 `independentSubtaskIds` 已是合法 ID 数组或被省略为空数组。失败行上的两个处置字段仍要单独出现；写在 `subtasks` 或独立列表里的候选不会填上该行。函数在第一处缺失处返回，后面的 `validation.accept.unlinked_subtasks` 不会再发出。`protocolMiss` 放进暂停的是原因码和固定提示，带 `reviews[index]` 的解析器原因句不进入这段文字。09:35 通知只有固定提示、没有 `reviews[`，与这条当前路径的可见结果相符。这不能反推当时二进制逐行相同。
3. **后续宿主状态拒绝尚未发生在这则通知里。** `applyAcceptDecision` 在决策解析成功之后才提交验收批次并调用 `dispatchSubtasks`。`state.dispatch.rejected` 来自 `dispatched.rejected.length > 0`。`state.repair.linkage_conflict` 和 `state.repair.source_unavailable` 也是状态码。09:35 的原因码停在校验层，没有记录后续派发结果。沟通记录里即使已经放了返工候选，这则暂停也没有证明宿主会接受那些候选。

### 08:21 的 `state.dispatch.rejected` 仍是未知

主沟通另收录更新时间 2026-11-26T08:21:32.130Z 的暂停。原因码是 `state.dispatch.rejected`，字段是 `subtasks`，次数句同样是「已自动继续执行一次」。这是更早的一条宿主状态通知，原因码与 09:35 不同。它可以用来对照两类暂停。它不提供 09:35 的根因，也没有给出被拒项。

当前 `src/loopPlusScheduler.ts` 的拒绝枚举是 `invalid_spec`、`duplicate_attempt`、`active_subtask`、`parent_stopped`、`completed`、`invalid_dependencies`。`loop-plus-dispatched` 会带上枚举以及子任务和 attempt 标识；`loop-plus-protocol-miss` 会带上 `rejectionKind` 和 `reasonCode`。两者都走 `logInfo`。`appendLog` 在未开启调试、非强制、且级别不是 ERROR 时直接返回，所以这些 INFO 默认不落盘。当日主日志没有这两类事件，既与该实现相容，也与「当时没有调用该日志函数」相容。主沟通把「同 ID 未结清」记为可能原因；这里保持为未证明。`loop-task-owner-route-rejected` 上的短原因 `identity-lock-present` 是另一事件，不能填进 `state.dispatch.rejected`。性能日志里 08:20:43Z 和 08:22:39Z 的主调用 `returned`，以及 08:23:35Z 的 `main-turn` `failed`，都没有原因码，也不能指定被拒项。

### 推断

在派工记录的四项顺序与当前解析器的提前返回同时成立时，第 2 项失败行会先触发缺返工关联；第 4 项即使同样缺字段，也不会出现在同一条拒绝文案里。固定提示中的「恰好一项同 ID 返工」和 `independentSubtaskIds` 是原因码说明，不是这次宿主已经核对过 ID 集合的记录。派工记录里的「正确标为独立工作」是该记录自己的分类。当前解析器要等失败行的处置字段齐备后，才做集合相等检查。

### 未知

- 原始助手文本、冻结批次的事件顺序、返工候选是否与失败项同逻辑 ID，以及独立列表与 `subtasks` 是否集合一致。
- 写出该通知的扩展构建、提交和发布包。次数句与固定提示目前分属相邻提交，加载身份未核定。
- 自动续跑的那一次是否同样缺字段。通知只保留最终原因码。
- 若两行处置字段被补上，宿主派发会不会再拒绝。09:35 的校验失败没有进入派发结果。
- 08:21 的拒绝枚举和被拒项。
- 09:35:18.920Z 的性能条目与 09:35:19.019Z 的暂停是否同一次调用。两者时间相邻，没有共享关联字段。本尝试没有用任务标识去对齐。

### 尚未实施的提示与诊断

下面是缩短同类排障的设计观察。本尝试没有改提示或日志，也不表示 09:35 或 08:21 已被解释完毕。

当前 `src/extensionHost/loopPlusPromptBuilders.ts` 已有静态规则：失败项要在该行 `subtaskIds` 放恰好一项原逻辑 ID 返工，或填写 `noRepairReason`；独立剩余工作放 `independentSubtaskIds`。快照示例不能点名「本批哪几行失败且两个处置字段都空」。`buildLoopPlusProtocolContinuationPrompt` 重复原因码和同一段固定提示。对派工记录描述的这次形态，续跑提示可以只列出失败且两个处置字段都空的下标，并写明 `subtasks` 里已有对象仍须由模型写入对应 `reviews[i].subtaskIds`，或改填非空 `noRepairReason`；独立列表保持独立。宿主不宜代填，因为某个候选属于哪一项失败验收仍是验收判断。这个改法针对「候选已写出、行上指针缺失」，不放宽返工、验收或完成门禁。

常驻诊断可以只强制记录 `rejectionKind`、`reasonCode`、review 条数、缺处置的失败下标，以及 `subtasks` 与 `independentSubtaskIds` 的数量。不记录 ID、标题、prompt、reason 原文、路径或令牌。`state.dispatch.rejected` 只常驻各拒绝枚举的计数，不常驻子任务标识，也不把整份 `loop-plus-dispatched` 载荷升为常驻。当日主日志没有原因码，暂停通知又把解析器下标换成固定提示，所以现有材料无法从日志单独还原四项结论。上述摘要若存在，就可以把校验层缺字段和状态层派发枚举分开。当前实现尚未这样记录。

这则 validation 通知也没有提供「某个 CLI 没有返回文本」的证据。空文本仍只对应采集结果里的 `format.EmptyResponse`，见上文因果链。

## 2026-11-26 10:37、10:58 与 12:09

这一节补录三次暂停，并和上一节的 08:21、09:35 对照。上一节正文保持原样。观察、有提交可以复核的推断、以及仍然开着的缺口分开写。本节核对时仓库 `HEAD` 是 `081b33c7`（`package.json` 为 `1.10.5`，提交时间 2026-11-26 07:42 UTC）。上一节把 `a7895ada` 记为当时的当前提交，那一句保留。工作区的 [协议诊断](../src/loopPlusProtocolDiagnostics.ts)、[暂停摘要](../src/loopPlusProtocolRepair.ts) 和 [决策解析器](../src/loopPlusDecision.ts) 与 `081b33c7` 的对应 blob 相同。编排、运行适配器和诊断落盘文件相对该提交还有未提交差异；下面引用的交接日志字段和通用码分支，在该提交里已有同名调用。源码用来说明可见文字能由哪些分支产生，不表示当时加载的二进制与该提交逐行相同。

三次暂停的原因码、`authoritative-handoff-used`，以及「已自动继续执行一次」都不在已核的 1.9.x 节点上。`git show <commit>:package.json` 与 `git grep` 核对过 `65f2bcfe`（`1.9.0`）、`34aade46`（`1.9.3`）、`1b3dfb1f`（`1.9.6`）、`07953676`（`1.9.11`）和 `261519f6`（`1.9.13`）：这些树里没有 `validation.invalid_decision`、`validation.accept.failed_repair_missing` 和 `authoritative-handoff-used`。`git diff e41004e0 65f2bcfe -- src/loopPlusDecision.ts` 为空，与上文基线一致。固定次数句「已自动继续执行一次」在 `4fa4a84b` 与 `a7895ada`（package 均为 `1.10.3`）。`081b33c7` 把该句改成限额插值，并同时放入上述两个原因码和权威交接的常驻 code。该提交早于这三次暂停，只说明仓库里已经有这段源码。

### 10:37：`validation.invalid_decision`

**来源与时间。** 这是当前任务主沟通自己的暂停，时间 2026-11-26T10:37:46.071Z。次数句是「已自动继续执行 3 次」。类别是 validation。原因码是 `validation.invalid_decision`。固定提示是「请按当前决策形状核对 status、必要字段及跨字段关联。」协议原因码一行没有 `field=`，正文也没有 `reviews[`。

**交接。** 2026-11-26 主日志在 10:37:45.975Z 有一条 `loop-plus-invocation-diagnostic`，stage 为 `projection`，code 为 `authoritative-handoff-used`。`081b33c7` 的常驻落盘只保留 stage、code 和进程号。当日这个 code 有 203 条，10:21–10:28 另有五条。性能日志在同一毫秒记下 `mode=loop_plus`、`role=main`、`cli=codex` 的 runner 与 invocation，结果都是 `returned`，二者共用一个 trace；10:37:46.013Z 的 main-turn 也是 `returned`，时长约 954.7 秒，trace 与前两条不同。性能记录的键是 time、traceId、mode、cli、role、phase、outcome、durationMs。交接诊断没有 trace，性能记录没有任务标识。暂停比这条诊断晚 96 毫秒。相邻时间还没有构成同一调用。

**解析、跨字段、宿主提交与恢复。** 通知使用 validation 类别，所以它不是这份通知里的 `format.EmptyResponse`。`081b33c7` 的 `loopPlusProtocolParseDiagnostic` 在缺少 `validationDiagnostic`、且原因句没有命中少数固定片段时，返回 `validation.invalid_decision`。会落到这个码的解析器句子包括逐行的 `reviews[index].reviewEventId`、`acceptance`、`reason`、`subtaskIds` 形状和 `noRepairReason` 用法。顶层句子「accept 必须使用 reviewEventId」命中另一片段，映射到 `state.review_batch.mismatch`。解析成功之后，同一提交的 `resolveAcceptanceRepairDecision` 若返回「修复必须关联当前验收批次中的原子任务。」，编排也把结果收成这个通用码；那是解析已经通过后的宿主关联分支。暂停只保留通用码和固定提示，两条路径的可见文字相同。次数句与该提交在 `LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT = 3` 时的 continuation-rejected 模板一致。它是超过限额后的摘要句，当日主日志没有对应的 `loop-plus-protocol-miss` 或 `loop-plus-protocol-recovery`。10:37:47.541Z 的 `loop-group-chat-continue-settled` 任务标识与当前沟通一致，状态为 needs-review，载荷没有 requestId。这是暂停之后的继续结算。

**已知事实。** 暂停文字、96 毫秒前的投影 code、性能记录的阶段和结果、以及 `081b33c7` 里能产生同一可见码的多条分支。

**可复核的推断。** 权威交接 code 只表示某次身份匹配且非空的终态正文被选为投影。通用码同时覆盖多条解析期原因和一条解析后的宿主关联句子。在交接诊断与暂停共享任务、attempt 或 trace 之前，不能把 `reviews[index].reviewEventId` 或其它字段写成 10:37 的原因。

**剩余缺口。** 同一调用的原始原因句、字段路径、review 下标、是否已经进入宿主返工解析、各次自动续跑的原因，以及加载的构建。

### 10:58 与 12:09：`validation.accept.failed_repair_missing`

**来源与时间。** 2026-11-26T10:58:04.244Z 写在一份来源任务自己的主沟通里；当前任务主沟通在 2026-11-27T00:51:14.520Z 的补充需求原样转载了它。2026-11-26T12:09:15.877Z 写在另一份来源任务自己的主沟通里；当前任务主沟通在 2026-11-27T00:51:31.414Z 原样转载了它。两则的状态都是 needs-review。次数句都是「主模型决策未通过校验，已自动继续执行一次，续跑后的决策仍未通过校验」。原因码都是 `validation.accept.failed_repair_missing`，后面是与 09:35 相同的固定提示，没有 `field=`，也没有 `reviews[`。

**失败行与缺失关联。** 10:58 的来源沟通在 09:35 那则暂停和这则暂停之间，没有逐项结论、下标或原始对象；对应任务目录是空的，没有可重放的决策。12:09 的来源沟通在暂停前有一节文字，写明工作表原生检查有失败并准备按该失败续修，同时安排其它检查。那一节没有决策对象，没有 review 下标，也没有写下 `subtaskIds` 或 `noRepairReason` 是否出现。12:09 来源任务更早的两则暂停仍把解析器句子直接写入具体原因：2026-11-25T08:32:43.844Z 为 `reviews[1]`，2026-11-25T10:00:57.094Z 为 `reviews[2]`。10:58 来源任务在 2026-11-25T08:01:16.343Z 也有一则 `reviews[1]`。那些下标属于当时的通知正文，不能填进 2026-11-26 这两则固定提示。

在 `081b33c7` 的映射里，这个原因码只在原因句包含「验收失败必须关联修复子任务」时出现。该句由某一失败行的 `subtaskIds` 为空、且没有非空 `noRepairReason` 产生，句子里带有下标；暂停模板留下原因码和固定提示，不留下下标。按这个映射，通知表示校验层至少有一行失败验收缺少这两处处置，并且还没有进入派发。10:58 与 12:09 的次数句却是「一次」，而该提交的暂停模板已经改成限额插值；`a7895ada` 有「一次」，树里没有这个原因码。这一点与上一节对 09:35 的提交核对相同：两段文字不在同一已核提交里。因此「缺的是失败行上的返工关联或免修理由」依赖于当时宿主使用了这个映射。行号、所缺的原逻辑关联，以及 `subtasks` 里是否已经写有候选，两起都没有同一调用的证据。09:35 的四项形状来自上一节引用的派工记录，只属于那一次。

**交接、宿主提交与恢复。** 性能日志在 10:58:04.088Z 有 runner 与 invocation `returned`，10:58:04.140Z 有 main-turn `returned`（时长约 672.6 秒，trace 与 runner 不同）；暂停在 10:58:04.244Z。约 9 秒后还有另一次 main `returned`，同一分钟里还有子任务阶段记录。12:09:15.766Z 有 runner 与 invocation `returned`，12:09:15.801Z 有 main-turn `returned`（时长约 1917.2 秒）；暂停在 12:09:15.877Z。这些性能记录同样没有任务标识。两个时间窗的主日志都没有 `authoritative-handoff-used`。`081b33c7` 的适配器只在身份匹配的非空终态正文上写这个 code；普通投影成功时不写。缺这条记录不能单独说明交接失败，也不能说明使用了权威交接。10:58:06.139Z 与 12:09:18.778Z 的 `loop-group-chat-continue-settled` 任务标识分别与两份来源沟通一致，状态为 needs-review，载荷含 requestId。通知停在 validation 码。按该提交的顺序，这个原因码来自解析失败，验收批次的宿主提交还在解析成功之后。加载构建未核定，所以这是条件性顺序，不是对当时原文的重放。两则都只保留最终原因码。

**已知事实。** 两份来源沟通与当前主沟通转载的暂停文字、固定提示、次数句，以及性能日志里相邻的 main `returned`。12:09 暂停前的文字只记录了续修意图。更早暂停里的 `reviews[1]`、`reviews[2]` 仍留在那些旧通知中。

**可复核的推断。** 在 `081b33c7` 的映射与当时宿主一致时，原因码对应「失败行缺少返工关联和免修理由」这一类，并且停在校验层。行号不在暂停里。次数句与该映射所在提交的暂停模板不一致，所以这个推断保持为条件性的。

**剩余缺口。** 两起各自的失败下标、所缺关联、`subtasks` 与 `independentSubtaskIds` 的形状、自动续跑那一次的原因、性能条目与暂停是否同一次调用，以及写出「一次」和这个原因码的加载构建。

### 与 08:21、09:35 对照：同一改动与独立观察

| 记录 | 已分开的层次 | 可由同一改动覆盖的部分 | 仍需独立观察 |
| --- | --- | --- | --- |
| 08:21 `state.dispatch.rejected`，字段 `subtasks` | 宿主派发状态。枚举和被拒项未知 | 保留 review 下标，或为失败行补提示，都不产生派发枚举 | 各拒绝枚举的脱敏计数。上一节已把「同 ID 未结清」保留为未证明 |
| 09:35 `failed_repair_missing` | 校验层。派工记录写明第 2、4 项失败且两个处置字段都空，`subtasks` 里另有候选 | 受控诊断保留失败下标后，今后同一原因码可以直接看到行。提示改动只针对「候选已写出、行上指针为空」 | 历史原文、续跑那一次、补字段后宿主会不会再拒绝 |
| 10:37 `invalid_decision`；附近有 `authoritative-handoff-used` | 通用校验码。交接 code 与暂停还没有同一调用证据 | 只有隐藏原因属于被折叠的行级句子时，保留下标才对得上这一次。现有材料没有这句原因 | 同一调用的原因句或字段路径，以及交接与暂停的关联字段 |
| 10:58、12:09 `failed_repair_missing` | 与 09:35 相同的原因码和固定提示。没有行号，也没有「候选已写出」的记录 | 把解析器下标留在受控诊断里，可以覆盖今后再次出现的这个码。它补不回这两次的历史行 | 各自的失败下标、缺失关联和 `subtasks` 是否已有候选；加载构建 |

对应的回归场景如下。这里只规定可区分这几类故障的检查，本尝试没有添加这些测试。

1. **被折叠的行级字段。** 冻结批次第二项的 `reviews[1].reviewEventId` 与冻结事件不一致，其余字段合法。受控结果应保留下标 1。`081b33c7` 现在把它映射为没有字段路径的 `validation.invalid_decision`。同时填写顶层 `reviewEventId` 与 `reviewEventIds` 的决策仍应得到 `state.review_batch.mismatch`，以免两种 review 事件拒绝合成一个码。这个场景约束诊断映射；它不是对 10:37 历史字段的指认。
2. **失败返工缺关联且保留下标。** 仅 `reviews[2]` 为 failed，`subtaskIds` 为空，且没有 `noRepairReason`。受控结果应为 `validation.accept.failed_repair_missing` 并带下标 2；同一次调用不再发出 `validation.accept.unlinked_subtasks`。记录不含 ID、标题或原因原文。这覆盖 09:35、10:58、12:09 的原因码类别，不填历史行号。
3. **执行完成而被主审判失败。** 冻结项的执行结果为 completed、主审结论为 failed 时，续跑提示仍给出同 ID 返工和 `noRepairReason` 两种形状。这只对应 09:35 派工记录里的形态。10:58 与 12:09 没有这份形态记录。
4. **派发枚举。** 合法 accept 之后，调度器以白名单枚举拒绝派发。结果保持 `state.dispatch.rejected`，并留下脱敏枚举计数，不改写成 validation。这对应 08:21，与前三个场景分开。
5. **交接与校验分开。** 身份匹配的非空终态正文写下 `authoritative-handoff-used`，随后的校验码单独记录。身份不匹配写下 `identity-rejected`，不能标成已使用权威交接。投影 code 没有任务或 trace 时，不用它命名校验字段。这对应 10:37 的证据边界。

## 提示、约束与群聊链路

- 冻结验收批次/attempt 隔离在 `1.9.6` 节点已进入编排路径；显式依赖、依赖优先批次和报告队列/FIFO 在 `1.9.11` 节点加入；验收前派发窗口在同 package 版本的 `261519f6` 加入实际分支。它们分别要求尊重批次身份、依赖可运行性、报告顺序及窗口条件，而非仅服从宽泛提示示例。
- 失败验收返工/无返工理由及欠返工完成门禁在 `1.10.0` 节点强化；协议纠错早于此已存在，自动续跑一次后暂停则在 `1.10.3` 提交进入路径。此前版本已经存在 JSON 解析、任务数组/字段、验收决策和 `canComplete` 一类基础校验，但不同版本检查范围不同；不能把“此前没有当前全部校验”写成“此前没有校验”。
- 提示由 `src/extensionHost/loopPlusPromptBuilders.ts` 根据快照生成，门禁由解析后的策略、scheduler 和编排路径强制执行。提示/示例可能概括或滞后于实时快照，而宿主决定是否接受；反过来，提示本身清楚也不保证模型输出遵守。旧快照、CLI 会话残留、模型路由差异、报告与验收恰逢并发、返工身份迁移都可能令表述和当次有效门禁看似不一致。需以本轮传入的受控决策形状和拒绝阶段复核，不能仅据提示推断宿主 bug。
- 群聊“继续”无响应需单独排查点击到达与执行。当前候选 `src/extensionHost/loopGroupChatPanelCoordinator.ts` 有继续消息接收、已评估/拒绝、开始、任务启动和 settled 等事件；`src/loopPlusProtocolDiagnostics.ts` 中受控 `reasonCode` 能区分格式、结构、状态拒绝，继续请求状态又能区分点击未到达、宿主拒绝、启动未确认及启动后再次拒绝。它们能构成**当前候选**的诊断边界，但不能回推历史点击链路；返工关联拒绝仅说明决策校验，不证明按钮事件是否送达。不要将未审查候选诊断或其回归测试当作历史因果证据。
- 群聊处理可读的既有设计和排障说明：[调度设计](../.ch/docs/design-docs/loop-plus-scheduling.md)、[暂停排查](../.ch/docs/runbooks/loop-plus-stop-diagnosis.md)。长期可靠性改造建议及其后续原因码/诊断工作归 [方案文档](LOOP_PLUS_DECISION_RELIABILITY.md) 与在途计划所有；本分析不替代该方案。

## 证据等级与待证假设

### 首次终态交接的受控证据

当前实现将原生终态观察状态独立于正文 handoff，并将原生终态观察与当时正在写入的助手消息引用绑定；适配器要求最终交接与调用身份匹配。原生终态已观察但正文/身份 handoff 缺失时，普通助手消息投影不会作为回退；未观察到原生终态的 CLI 仍沿用既有投影策略。测试证明受控 Codex 事件路径中，同一消息正文首次进入 Loop+ 校验且不触发补偿调用，错配、取消和身份错误拒绝。该结果只验证受控路径与代码契约，不能追认历史 CLI 调用是否产出终态、消息是否曾被投影或为何交接失败。默认诊断新增仅含固定阶段/原因码的常驻事件；没有相应记录或证据不足仍应记未知。真实 CLI 传输和 VS Code Extension Host 尚需按版本独立验证。

**已由提交/源码证实的机制**

- 1.8.15 与 1.9.0 决策解析器无差异；1.8.15 已有 JSON 解析、基本任务校验与宿主完成判断。
- 1.9.x 中冻结批次、显式依赖/报告 FIFO、验收前窗口逐步进入实际调度路径；1.10.0 的提交加入失败返工/完成门禁约束；1.10.3 的提交使协议拒绝最多自动续跑一次后暂停。
- 这些新增状态和关联约束提供了更多区别于 JSON 语法的拒绝路径，也使重试预算耗尽时拒绝可见为暂停。

**可能的放大因素，尚非发生率证据**

- CLI/模型路由与运行时恢复新增路径可能改变回复能力、续接会话或最终文本采集结果。
- 更多跨字段和宿主状态约束增加边界案例；提示示例与时变快照之间可能出现理解落差。
- 一次续跑上限使未自动纠正的单次拒绝更容易保留为暂停；但更严格门禁也可能阻止错误验收、重复返工或假完成。

**待证假设**

- **空文本/采集变化增加：**需按 CLI 版本对齐调用开始/结束、run 边界、本轮助手消息是否找到、最终文本长度分桶和 `EmptyResponse` 记录；没有文本不得保存内容本身。
- **格式/结构拒绝率在 1.9.0 后上升：**需逐版本统一 `status`/原因码口径，按有效主决策调用计数，并以一致脱敏规则重放历史 parser/contract；早期泛化 `null` 解析结果不能追认具体原因。
- **冻结/报告/依赖或返工门禁导致更多拒绝：**需保留拒绝阶段、当前冻结状态类别、字段/关联校验结果和实际被门禁拦截的分支；仅模型回复或暂停摘要不够。
- **派发数量/任务分类契约成为主要来源：**需采集适用版本的生效派发上限、模型提议数、分类验证结果与宿主预检结果，按一次决策而非单个任务项统一计数。
- **群聊点击链路未响应：**需为同一脱敏请求关联 Webview 发出/Host 收到、拒绝原因、启动确认、启动后结果与 settled 事件，并说明事件缺失究竟是未埋点还是未发生。当前代码不能替代历史遥测。
- **Marketplace 已发布版本与源码演进完全对应：**需保存发布产物、manifest/版本、构建提交 SHA 和发布渠道证据；package 版本、提交日期及下载端点可获取均不能单独证明产物源代码对应关系。

## 后续可比的观测口径

按 **扩展版本/提交与发布证据、CLI 名称及已核能力、主决策阶段、决策状态、拒绝类别、最终处置** 分层统计，不给各 CLI 强加统一参数或结构化输出能力。拒绝类别至少分 `no invocation / no final assistant text`、`format`（空文本需另标）、`schema/field`、`cross-field linkage`、`host state`、`click/continuation transport`、`start unconfirmed`、`post-start decision rejected` 和 `unknown`。发布版本需和本地候选分列。

- **首拒率** = 观察窗内至少一次被拒的主决策调用数 ÷ 同窗有最终回复且进入决策解析/校验的主决策调用数。另报告无最终回复率，不能把未调用或无文本的尝试暗中放入分母。
- **一次续跑成功率** = 首次拒绝后在预算内被自动续跑的主任务中，续跑返回并通过结构与宿主门禁的任务数 ÷ 首拒且实际启动自动续跑的任务数。另列未启动/缺启动确认和缺失日志，不把未尝试自动续跑的版本并入分母。
- **最终暂停率** = 观察窗内最终因主决策拒绝门禁而暂停的主任务数 ÷ 该分层内进入主决策流程的主任务数；记录观察窗、任务结束状态和重叠拒绝去重规则。用户主动停止、CLI 启动失败、普通业务 blocked/澄清需分开。
- 以“任务”为单位计算时按同一根任务去重；以“调用”为单位计算时一轮续跑是独立调用但不能独立冒充新任务。报告尝试量、任务量、重复拒绝数、版本/CLI 未知数和日志缺失率。
- 历史缺少逐调用的原因码、CLI 能力、最终文本采集结果、冻结快照及点击阶段埋点时，无法补算可比首拒率/续跑成功率/最终暂停率；将对应分母标成未知或不可比，不做版本因果结论。

不建议绕过验收、权限、依赖、返工或完成门禁；不建议把无法证明的历史故障改写为当前候选已修复。
