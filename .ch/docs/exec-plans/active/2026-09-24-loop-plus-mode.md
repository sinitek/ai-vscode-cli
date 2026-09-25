# Loop+ 完成事件驱动验收

- 日期：2026-09-24
- 更新：2026-09-25
- 状态：in-progress
- 负责人：Codex
- owner：loopplus-plan-design（只维护本计划与候选设计；不代表功能已实现）
- claimed_at：2026-09-25
- claim_ttl：保持到真实 Webview 场景被复核或本计划归档；占用不表示 Loop+ 已经可用

本文是执行记录，不是已交付功能说明。阶段一的内核、模式/持久化/独立决策契约和中英文帮助正文保持通过。第 3 轮的真实入口、模式选择器和 FIFO 投影，以及当时的 105 项宿主、20 项投影，只保留为历史阶段证据。第 4 轮原恢复、重复 `finish`、被拒绝派发、基础 payload、按 Tab 模式、主 prompt 和暂停展示已在各自切片通过。第 5 轮 host 27 项、runtime 18 项且最后一次隔离 `tsc` 退出码 0、UI 28 项通过，文档当时核对 80 个引用路径。第 6 轮 host 32 与 scheduler 23 属于同一次合并 55，不能把 32 和 23 再相加；runtime 23 覆盖旧 18；两份隔离 `tsc` 退出码都是 0；计划当时核对 84 个引用路径，文档检查退出码 0。这些计数不能相加，也不等于整体接入验收。取消收尾、基础报告故障、准备失败、自然控制器释放、消息无统一轮次、adapter 接线，以及第 6 轮暂停门禁、内部取消隔离和实际 run 时间窗，只记为切片通过。证据来自当前源码、回归和 AST/VM，不是真实宿主。第 5 轮 UI 28 与中英文帮助保持切片通过。自动识别的“未明确”不是失败。四份第 6 轮报告均无待人工确认。第 7 轮两份报告也无待人工确认。已主审的是：`npm run build` 退出码 0；全量 1168 项中 1162 通过、6 失败，重跑仍是相同 6 条。5 条是历史或环境失败。另 1 条在第 7 轮是新增提取测试。第 8 轮主审已接受修正：AST 约束 extension → adapter → host，隔离 `tsc` 通过，23 项通过、0 失败；不再写仍待修。第 7 轮 1168/1162/6 仍是历史全量，不能改成已重跑的 1163/5。真实隔离宿主只有启动、加载和 activation 调用证据，没有 DOM；`_doActivateExtension` 不等于 provider 已 resolve。帮助、模式持久化、FIFO、增量派发、停止/继续和 classic 未被接受。验证工具缺口见后文。本轮同批 build、全量和原生命令 bootstrap 不预写。Loop+ 仍不能当作用户功能。

## 背景

现有 AI 对话有 Vibe（`coding`）、Plan、Loop、Graph。经典主从 Loop 在同一批 `activeSubtaskIds` 对应子任务都结束后才唤醒主任务复核。`applyLoopMainDecision` 收到 `continue` 且没有子任务时，会把任务写成 `needs-review`，而不是继续等待。debate 只替换主任务规划/复核，共识通过后仍走这条批次链路。

用户要的 Loop+ 不再以“统一一轮全部结束后再复核”为节奏：任一子任务结束就验收；验收期间其他完成进入可见队列；验收后可以增量派发，也可以在仍有在途任务时保持父任务 `running` 并正常等待；全部运行、待启动和待验收事项收口后才结束。执行结束和验收完成不是同一状态。Vibe、经典 Loop、Graph 和 debate 的既有批次语义必须保留。

补充需求保持有效：使用说明的模式说明要用中英文写清 Loop 与 Loop+ 的区别；Graph 已经能按冲突组和重叠写路径处理冲突，帮助里不能再把“不能自动解冲突”写成缺点。图编辑器仍然没有，这个限制保留。

## 目标

- 记录已经阶段验收的内核与契约，并把历史切片、第 7 轮历史全量 1168/1162/6、第 8 轮已接受的提取契约、真实界面尚未执行和验证工具缺口分开。本轮同批 build、全量和原生命令 bootstrap 不预写。
- 给本轮独占验证、有条件记忆清理和本计划留下互不重叠的写入范围。公共规格、架构与 runtime references、ontology 和归档仍以整体证据收口为前提，不能引用本轮尚未主审的结果。
- 保持帮助文案里的 Loop / Loop+ 区别和 Graph 缺点修正。两处 `loop_plus` 选择器断言，以及 Loop+ 子消息不显示统一轮次，已有 UI 切片通过；这不勾选整体功能。
- 标明公共事实文件仍等整体证据收口后再处理。14 项本任务生成噪声已确认，本轮只获有条件清理授权，只记待执行，不预写已还原。完成前不归档本计划，也不把设计升为 active。

## 范围

- 本文件，以及设计 `.ch/docs/design-docs/loop-plus-scheduling.md`。
- 阶段一已验收的代码范围：`src/loopPlusScheduler.ts`、`src/loopPlusDecision.ts`、`src/cli/types.ts`、`src/promptRunState.ts`、`src/workspaceSettingsStore.ts`、`src/scheduledTaskStore.ts`、`src/loopTaskStore.ts`，以及帮助文案 `src/webview/viewContentHtml.ts`、`src/webview/viewContentI18n.ts` 和对应静态测试。
- 第 3 轮已交付、本文件只记阶段证据的切片：真实入口与可注入控制器、模式下拉与主子模型路径、群聊 FIFO 投影。
- 第 4 轮已经切片通过的宿主、运行时接线、UI、主 prompt 和暂停投影，以及第 5 轮已经切片通过的取消收尾、报告与准备异常、控制器释放、无统一轮次和 adapter 接线，本文件只记证据，不代验收整体接入。
- 第 6 轮四个 owner 的写入范围已经结束，见下方影响面。暂停门禁、内部取消隔离和 run 时间窗已切片通过。本计划只记录边界，不代写、不代验收整体接入。adapter、运行时集成测试、夹具和 Webview 集成测试已经存在；存在不等于真实宿主通过。
- 第 7 轮构建、全量失败分类和隔离宿主启动已经主审，并记在下方。第 8 轮提取契约修正也已主审接受。本文件不改那些产物，不把 23 项通过改写成全量重跑，也不代跑本轮 build 或真实界面。

## 非目标

- 本文件不实现调度器、运行时、模式选择器或持久化迁移，也不改同批代码。
- 不修改经典 Loop、debate、Vibe、Graph 的行为；Graph 帮助只修正错误缺点，不新增未核实能力。
- 不把本轮同批 build、全量或原生命令 bootstrap 写成已通过或已失败。第 8 轮已接受的只有提取契约 23 项，以及夹具和沙箱的有限结论，不勾选产品完成项。没有 Webview DOM 时，不把启动或 `_doActivateExtension` 写成 provider 已 resolve，也不写成产品不可用。
- 不把第 3 轮 UI 74/75 里那条旧帮助断言再写成待用户决策或当前失败。它已按主任务裁定更新，并通过第 4 轮 UI 切片；该通过仍不是整体功能验收。
- 在 Loop+ 真正可选并完成端到端验收前，不改 `FEATURE_INVENTORY`、能力规格、运行时事实源、设计索引、ontology 或 MEMORY。
- 不自行全量生成或回退 `.ch/docs/generated/memory-index/.local`。14 项有条件清理由独立 owner 在再核验并保全证据后执行；本文不预写已还原。
- 本轮文档切片不运行构建、单测、生成器、浏览器或真实 CLI。第 7 轮构建和失败分类，以及第 8 轮隔离 `tsc` 与 23 项，已经主审。真实 Webview DOM、独占 build 和全量仍未由本文验收。

## 验收标准

产品完成仍以下列未勾选项为准。已勾选的只有帮助正文，以及下面单独列出的阶段切片。第 4 / 第 5 / 第 6 轮切片通过都不改变这些产品勾选。原始三点仍是：任一执行结束就进入可见 FIFO 验收，验收后可增量派发或在仍有在途任务时正常等待，全部运行、待启动和待验收收口后才完成。帮助补充仍是：中英文区分 Loop 与 Loop+，Graph 不再把不能自动处理冲突写成缺点。

- [ ] Loop+ 是显式可选模式；经典 Loop 仍在整批活动子任务结束后才复核。
- [ ] 任一执行结束都能形成可排队的完成事件，且主任务上下文能看到当前验收项、仍在运行项和待验收队列。
- [ ] 同一时刻只有一个验收消费者；验收期间新完成只追加、不丢失、不被旧快照整表覆盖。
- [ ] 完成事件按 attempt 幂等；重复事件和过期 attempt 不改写新执行，也不污染已有 summary 或 report。
- [ ] 验收后的增量派发与既有运行任务、待启动任务一起做冲突和并发判断，复用现有路径规则。被拒绝的派发不得改写旧任务 meta。
- [ ] 无新任务但仍有在途任务是正常等待，父任务保持 `running`，不是 `blocked` / `needs-review`，也不空转重入主任务。中止已经结束后的显式继续，以及取消尚未结束时拒绝继续、保持 `stopped` 并及时 settle，已有宿主切片通过，产品项仍不勾选。
- [ ] 最终完成由运行时按最新状态放行；仍有运行、待启动、排队或当前验收时不能完成。加载已完成快照后完成信号 settle，以及自然完成后释放控制器，已有宿主切片通过，产品项仍不勾选。异常暂停后不再启动 pending 已有第 6 轮 host 切片，产品项仍不勾选。主任务和子任务 AI 不得直接写调度状态。
- [ ] 局部失败或局部停止可被验收且不取消兄弟任务；用户显式停止父任务后不再启动、不再唤醒，也不能领取或晚确认。
- [ ] 持久化恢复不把已经失去进程的记录假装为仍在运行，也不丢未验收事件；损坏的 `event_driven` 快照不能降成经典任务。
- [x] 模式说明用中英文区分 Loop 的整批集中复核和 Loop+ 的逐个验收、可见队列、验收后追加或等待，并区分执行结束与验收完成；Graph 缺点不再声称不能自动解冲突。这项只验收帮助文案和静态渲染，不代表选择器已上线或整体功能已验收。第 3 轮 75 项里与“下拉不得出现 Loop+”冲突的那 1 项，已由主任务批准改为要求两处 `value="loop_plus"`，同时保留双语正文和 Graph 检查。该更新包含在第 4 轮 UI 的 69 项通过里，不是待用户决策，也不是整体通过。
- [ ] 模式、会话、CLI 主子模型、中英文入口、主题、Windows 路径和经典 Loop 回归均有证据或如实记录的环境限制。基础 payload、按 Tab 的 `loopSchedulingMode`、主 prompt 的 `completed` 必需字段，以及 Loop+ 子消息不显示统一轮次，已有各自切片通过，产品项仍不勾选。真实 Webview 仍未验收。
- [ ] 行为落地且整体证据收口后，才同步功能清单、能力规格、运行时与架构事实来源、设计索引、ontology 与 MEMORY 判断，再处置生成辅助层并归档。第 8 轮契约 23 项不勾选本项。14 项生成噪声清理不是记忆上提。`plugin.loop_task` 与相关中断规则目前仍是经典整批语义，最终要区分 classic 与 `event_driven`，不能只加别名。第 5、第 6 和第 7 轮 recall 都只输出到任务沟通目录，没有再写仓库 generated 层。第 7 轮 anchor 为空，选中 `mem-7850a1dff0`，即当前 active plan；这次 ID 变化是 focus 召回结果，不是功能变化。

### 已通过的阶段切片

这些通过不等于端到端，也不等于真实 Extension Host / Webview 通过。自动附注里的“单测未明确”“未完成”或“编译未完成”只是摘要提取，不能推翻下列命令结果，也不是实际失败。本轮文档切片没有重跑这些命令，也不把不同测试集合相加后声称去重总数。

- [x] 内核：无歧义长度前缀事件 ID、未发布旧冒号 ID 拒绝、父停止后拒绝 `claimNextReview` 和晚到 `submitReview`、`resumeParent` 必须先清掉旧 running 才成功，成功时保留队列与 pending 且只返回新 `started`。第 3 轮主任务对照当前源码复核后阶段验收。隔离 `tsc` 通过；`node --test` 为 21 项通过、0 失败，其中原 13 项仍在。
- [x] 契约：`loop_plus` 独立模式、缺省/未知 `schedulingMode` 为 classic、损坏 `event_driven` 快照不降级、`loopPlus` 原样保存完整快照；`dispatch` / `accept` / `wait` / `blocked` / `completed` 由独立解析器实现。`npm run build` 退出码 0；相关测试 57 项通过、0 失败。
- [x] 帮助正文：第 2 轮隔离 `tsc` 通过，帮助专项与静态页覆盖合计 12 项通过、0 失败；当时选择器还没有加入，其中含后来被替换的“下拉不得出现 Loop+”断言。第 4 轮 UI 切片改成要求两处 `value="loop_plus"` 后，该断言包含在单独记录的 69 项通过里。12 项与 69 项不是同一集合，也不相加。

### 第 3 轮阶段证据，整体未验收

下列计数是当时的证据，不是当前通过记录，也不是总功能验收。本轮不重跑，也不和第 4 轮计数相加。

- 宿主：真实入口已在经典批次循环之前分流 `event_driven`，并有可注入控制器。最后一次根构建退出码 0。构建后入口、控制器和当时受影响的回归共 105 项通过、0 失败，其中 Loop+ 入口与控制器 13 项，其余 92 项是当时的回归。之后宿主和运行时文件又被修改，这 105 项只保留为历史证据。
- 群聊投影：隔离测试 20 项通过、0 失败，其中投影 7 项、真实 HTML 4 项、经典群聊回归 9 项。覆盖当前项、FIFO、running、pending 和坏快照。第 4 轮暂停投影另有 23 项，不并入这 20 项。
- UI：当时 75 项中 74 通过、1 失败。失败只在 `src/test/webview/loopPlusModeHelp.test.ts`：它仍禁止下拉匹配 `loop_plus`。这是第 3 轮当时的结果。第 4 轮已经按批准更新该断言，并通过单独的 69 项切片；不要把 74/75 再当成当前失败。
- 整体接入、跨模块回归、真实 Extension Host / Webview 在第 3 轮都未验收。第 4 轮切片没有改变这个总判断。

### 第 4 轮切片证据，整体未验收

主任务已复核六份完整报告，待确认项均为无。下列计数各自有效。不得把 host 21、runtime 相关 36、UI 69 与另 30、prompt 6、panel 23 相加后声称去重总数。报告末尾自动识别的“单测未明确”或“未完成”不是失败；以各报告中的退出码和通过计数为准。host 与 UI 中途隔离 `tsc` 退出码 2，唯一错误是同批 `src/test/extensionHost/loopPlusRuntimeWiring.test.ts` 的临时语法；更晚的 runtime-wiring 最终隔离 `tsc` 退出码 0，该错误已经消除。本轮不重跑这些命令。

- host：`loopPlusOrchestration` 21 项通过、0 失败。覆盖停止初始调用并等待中止后的显式继续、加载已完成快照后完成信号 settle、重复 `finish` 不改 summary/report、被拒绝的同 ID 派发不改旧 meta，以及延迟启动、安全门限和同步抛错。
- runtime 相关：入口、wiring、会话 Tab、抽取契约和 `conversationTabLock` 共 36 项通过、0 失败；最终隔离 `tsc` 退出码 0。覆盖落盘后的队列快照刷新、按任务读取 `loopSchedulingMode`、子任务局部停止、父停止先关门禁、恢复绑定和执行根清理。这组测试主要是 helper 和内存 controller，不是生产 adapter 集成，也不是真实面板。
- UI：一组 69 项通过、0 失败；另一组 30 项通过、0 失败。两组分开记录。69 项覆盖基础 `normalizePromptPayload` 保留 `loop_plus` 和角色字段、按 Tab 的 `loopSchedulingMode`、定时标签，以及两个选择器的 `value="loop_plus"`、中英文区别和 Graph 不再声称不能自动解冲突。30 项是相关 Webview 回归。
- 主 prompt：6 项通过、0 失败。五态示例从生成提示词提取后交给当前解析器；缺字段的 `completed` 会被拒绝。
- 暂停投影：23 项通过、0 失败。原 20 项仍在。`needs-review` / `error` 显示暂停并保留队列，不再只靠 phase 显示正在验收。真实面板刷新不在这 23 项里。
- 第 4 轮计划文档核对过 78 个引用路径且当时全部存在。那只是历史文档证据，不是代码通过，也不能代替本次重新核对。

这些切片说明第 4 轮原来打开的恢复死等、重复 `finish`、旧 meta、基础 payload、按 Tab 模式、主 prompt 和暂停展示已经在各自范围内通过。整体接入仍未最终验收。

### 第 5 轮切片证据，整体未验收

主任务已复核第 5 轮四份完整报告，待确认项均为无。下列计数各自有效，不得把 host 27、runtime 18、UI 28 或当时的 80 个文档路径相加后声称去重总数。UI 中途隔离 `tsc` 退出码 2，唯一相关错误是同批 `src/extension.ts` 的 `loopPlusParentGateDepth` 未定义；更晚的 runtime 隔离 `tsc` 退出码 0，而且当前该文件已有这个声明，临时错误已经消除。报告末尾自动识别的“未完成”或“未明确”不是失败。本轮不重跑这些命令。

- host：`loopPlusOrchestration` 27 项通过、0 失败。原 21 项仍在。覆盖取消尚未 settle 时拒绝继续并及时 settle、报告失败后保留完成队列、准备失败变成可见的 failed 完成事件，以及自然完成后释放控制器。这是切片通过。
- runtime：18 项通过、0 失败；最后一次隔离 `tsc` 退出码 0。生产入口接到 `createLoopPlusRuntimeAdapter`。这是 adapter 接线的切片通过，不是真实 Extension Host，也不是整体通过。
- UI：28 项通过、0 失败。Loop+ 子消息按自己的任务 ID 关联到明确且一致的 `event_driven` 时，不再显示统一轮次；classic、缺省、未知或同一任务模式冲突仍保留原标签。这不是真实 Webview。
- 文档：当时核对 80 个引用路径且全部存在。那只是当时的文档证据，不是代码通过，也不能代替本次重新核对。

第 5 轮原先打开的取消收尾、基础报告故障、准备失败、自然控制器释放和消息无统一轮次，因此记为切片通过。adapter 接线同样只是切片通过。整体接入仍未最终验收。

### 第 5 轮当时复现，随后由上述切片覆盖

下面是第 5 轮复核当时的探针观察，保留为历史，不再是当前打开缺陷。当时的同批修改在被对应报告复核之前也不能写成已修复；该限制已经由上面的切片证据解除，但不能外推成整体通过。

- 取消尚未结束时继续会悬挂。dispatch A 后 `stopParent`，A 的 abort promise 尚未 settle 就立即 `tryRun(resumeRequested=true)`：父状态是 `stopped`，返回的 done 不 settle。稍后 A 结束，running 为 0、reviewQueue 为 1，仍然没有新主调用。裁定后来由 host 27 项覆盖：旧执行仍在取消时拒绝本次继续，保持 `stopped` 并及时 settle；取消完成只排队；下一次显式继续才逐项验收，且不复活旧 attempt。
- `recordAttempt` 抛错时，当时的 `safeApplyFinish` 会吞掉已经生效的 finish，持久化仍是 running 为 1、queue 为 0。裁定后来由 host 切片覆盖：完成队列必须落盘，错误可见，并进入可恢复暂停，不假称报告成功。第 6 轮当时另复现了暂停之后仍启动 pending，随后由第 6 轮 host 切片覆盖，见下一节，不把两条混成同一项。
- `prepareCommunication` 抛错后，当时 `startAttempt` 为 0，持久化仍占着 running。host 切片随后把它收成可见的 failed 完成事件。
- 自然 `completed` 后，当时 `hasController(taskId)` 仍为 true。host 切片随后覆盖自然完成释放；加载已完成快照时释放的旧用例仍然有效，但不能代替这条自然完成路径的证据。
- Loop+ 子消息当时仍选择带轮次的标签。UI 28 项随后按消息任务 ID 关联 `loopSchedulingMode`，不再用当前下拉猜测。

### 第 6 轮切片证据，整体未验收

主任务已复核第 6 轮 host、runtime、预检和计划四份完整报告，待确认项均为无。自动识别的“未明确”不是失败。下列计数各自有效，不得把 host 32 与 scheduler 23 再相加，也不得把它们和第 5 轮 host 27、runtime 18、UI 28 或文档路径相加。本轮不重跑这些命令，也不把它们写成真实宿主通过。

- host 与 scheduler：同一次 `node --test` 合计 55 通过、0 失败、0 跳过、0 取消。分开复跑同一隔离 dist 时，host 32（原 27 仍在，新增 5）、scheduler 23（原 21 仍在，新增 2）。隔离 `tsc` 退出码 0。32 与 23 属于这 55，不能再加一次。
- runtime：23 通过、0 失败、0 跳过、0 取消，覆盖旧 18。其中 EntryRouting 2、RuntimeIntegration 14、RuntimeWiring 7。隔离 `tsc` 退出码 0。这是生产 adapter、当前源码回归和 AST/VM 证据，不是真实 Extension Host。
- 文档：当时核对 84 个引用路径且全部存在；尾随空白检查和 `git diff --check` 退出码 0。那只是当时的文档证据。
- UI 与帮助：第 5 轮 UI 28 项和中英文帮助保持切片通过。本轮没有新的 UI 计数。

第 6 轮原先打开的异常暂停后启动 pending、内部取消误停父任务、助手正文早于实际 run 起点，因此记为切片通过。整体接入仍未最终验收。第 7 轮已经主审构建、全量失败分类和宿主启动，见下方；那些结果不回写成这三项的真实场景通过。本批测试修正和场景恢复不由本计划预写。

切片通过的行为是：

- 自动暂停退回尚未启动的预约。代际门禁拦住旧回调，不再写成 running，也不当成 lost-process。在途结束只入队，不把父任务改回 `running`，也不提前启动后继。显式继续按原来的 attempt 启动一次。证据是当前源码和 host / scheduler 回归，不是真实宿主。
- 生产 adapter 的 abort 调用 `cancelInvocation`，不走用户父停止。用户从主任务或群聊显式停止时，仍先关闭父门禁，再取消全部。证据是当前接线和 AST/VM，不是真实 Extension Host。内部 runner 既有 “stopped by user” 文案与父停止隔离分开，不宣称已经改掉所有 runner 文案。
- 助手正文只取 `max(boundary.startedAt, run.startedAt)` 到 `run.endedAt`。合法预载 user 可以早于 run 起点，不因此丢掉窗口内正文。这不是声称真实 CLI 已经回放旧决策。

未单独覆盖、但不写成已复现缺陷：自动暂停后再执行父停止的组合没有单独夹具；未暂停时，父停止仍把延迟链里的 running 预约收成 stopped。重载时快照里仍有 running 不会自动 settle。finish 落盘和紧接着的恢复落盘都失败时，仍不做内部无限重试。这些按第 6 轮报告披露，最终验证可以补私有探针。

### 第 6 轮当时复现，随后由上述切片覆盖

下面是第 6 轮开工前的只读探针，保留为历史，不再是当前打开缺陷。探针使用内存夹具，或从当时源码抽出函数后在 VM 里执行；周边依赖是 stub。这从来不是真实 Extension Host、真实 CLI 或真实 Webview。探针过程里有两类不计产品失败的问题：首次加载 adapter 时缺 vscode 模块，改用仓库既有 mock 后才能运行，这是环境夹具缺失；第一版 host 探针缺任务库和主沟通字段，主提示词没有进入，补全基础任务字段后才复现，这是探针数据不全。最终没有改源码、仓库根构建产物或真实用户任务库。当时同批正在修改的代码，在被第 7 轮主审复核之前也不能写成已修复；该限制已经由上面的切片证据解除，但不能外推成整体通过。

- 异常暂停后，待启动任务仍被启动，并把磁盘状态强写成 running。并发上限为 1，A、B 写范围不重叠；A 运行、B pending。A 结束时 `recordAttempt` 抛出报告错误，A 解决为 completed 后刷新。之前是 attempts 只有 A、status 为 running、running 为 A、pending 为 B。之后 attempts 含 A 和 B、status 仍为 running、done 已结束、主调用数仍为 1、running 变为 B、pending 为空，消息含 started 和 report-failed。A 仍留在当前验收，不是完成事件丢失。当时错误分支在保留失败后仍启动本次返回的 `started`。裁定后来由 host 切片覆盖：暂停退回尚未启动预约，在途结束只入队，显式继续按原 attempt 启动一次。
- 内部单次取消被当成用户父停止。探针加载真实 host，并从当时 `src/extension.ts` 抽出停止函数后执行；这不是真实 Extension Host。主 handle 的 abort 按当时 adapter 接线调用 `stopRunForTab('main')`。dispatch A、B、C。A 完成后开始验收 A；B 完成时报告抛错。之后父状态是 stopped、`parentStopped` 为 true、running 为 0，队列留下 B 和 C，C 被取消。裁定后来由 runtime 切片覆盖：内部 `cancelInvocation` 不走用户父停止；用户显式停止仍先关闭父门禁。
- 助手正文可以早于实际 run 起点。`selectLoopPlusInvocationAssistant` 在 boundary 起点为 100、合法 run 窗口为 200 到 300 时，仍选中创建时间为 150 的正文。当时判断只要求不早于 boundary 起点、不晚于 run 结束。裁定后来由选择器切片覆盖：还必须不早于实际 run 起点，并保留合法预载 user。这仍然不声称真实 CLI 已经回放旧决策。

### 待验证风险，不是已复现缺陷

第 7 轮隔离宿主启动保留为历史。第 8 轮主审接受的真实证据只到宿主启动、加载开发扩展和发出 activation 请求，没有 Webview DOM。`ExtensionService#_doActivateExtension` 不能当成 provider 已 resolve，也不能当成帮助或调度通过。帮助、模式持久化、FIFO、增量派发、停止/继续和 classic 未被接受。没有可证明的 Loop+ 产品回归。夹具正负语义和沙箱有限结论已接受；fixture 自检不是真实模型。本轮同批独占 build、全量和确定性原生命令 bootstrap 不预写。第 7 轮 1168/1162/6 不改成 1163/5。其余 5 条已分类失败不在本计划修理。技术 `loopRound=1` 仍然存在。第 6 轮 runtime 23 已覆盖时间窗下界。真实 DOM 被主审之前，不把 AST/VM 或选择器通过升格成 CLI 已回放旧决策。

下列验证预期需要纠正，它们不是已复现产品缺陷：

- 生产 3 秒错峰保留。A、B、C 按 4.2 秒、7 秒、9 秒各自运行时长记录。400ms 不能证明 B 已在途。只改验证时序或屏障，不改生产。
- 正常等待不要求额外主模型 `wait`。父任务保持 `running`、没有忙循环、不计失败即可。
- 准确 `eventId` 的 `completed` 先确认当前项，再拒绝父任务提前结束。最后唯一 D 可以合法收口。负向场景独立，不重验已确认的 A。第 8 轮私有夹具已拆开正负场景；这不是产品修复，也不是真实 DOM 通过。
- 帮助检查必须真正 assert。Graph 文案只限定缺点。统一轮次禁用只检查 Loop+ 真实消息。这些断言还没有碰到真实帮助 DOM。
- 验证工具仍需补齐，不能把缺口全写成外部环境。`run-real-host` 只调 core。`drive-scheduler` 只实现 core，成功检查以 fixture 日志为主，不能代替任务记录和群聊 DOM。没有 control、classic、early 的完整驱动。CDP 的 `findSession` / `Runtime.evaluate` 只查 target 默认 context，不定向 frame 或 execution context。帮助路线没有传 extension tests path。原 extension-tests 只执行打开面板命令并保持约 20 秒，未进入帮助路线，也不适合长场景。下一动作是独占 build、全量，以及确定性原生命令 bootstrap。重复键盘或 AX 不再作为默认方案。只操作隔离宿主，并核验进程身份，不关闭用户 VS Code。

隔离预检若把“真实任务库修改时间不变”当成污染标准，也过强。当前 Loop 协调器会正常更新自己的记录。应验证沙箱进程只写 sandbox HOME，不以控制面的正常更新时间判污染。这同样不是产品缺陷。

## 影响面

- 阶段一已验收代码：上面的内核、契约和帮助文件。`src/extension.ts` 里已经有经典批次循环之前的 `event_driven` 分流；这只说明入口存在，不说明接入已验收。
- 第 4 轮的 prompt 与暂停投影写入范围已经切片通过。本批不改 `src/extensionHost/loopPlusPromptBuilders.ts`、`src/panelStateBuilder.ts` 或群聊投影实现。沟通报告和私有验证目录不属于仓库范围，不列在这里。
- 第 5 轮的宿主、runtime、UI 和计划范围已经结束，并被本轮范围取代。当时 UI 集成测试的候选名使用了另一种大小写，而且当时这几个新文件还不存在；那只是历史。现在磁盘上的实际文件是 `src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/test/extensionHost/loopPlusRuntimeIntegration.test.ts`、`src/test/extensionHost/fixtures/loopPlusRuntimeFixture.ts` 和 `src/test/webview/looppluswebviewintegration.test.ts`。
- 第 6 轮四个写入范围已经结束，并且互不重叠。宿主公开 API 和 `ConversationTabSummary.loopSchedulingMode` 契约保持冻结。下面是当时的范围，切片已经通过，不是整体验收，也不是本批还在改的文件。
  - `loopplus-host`：`src/extensionHost/loopPlusOrchestration.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/loopPlusScheduler.ts`、`src/test/loop/loopPlusScheduler.test.ts`。暂停门禁已切片通过。报告未改 `src/extension.ts`、真实 adapter、UI 或公共类型。
  - `loopplus-runtime-wiring`：实际改了 `src/extension.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts` 和对应 runtime 测试与夹具。报告写明 `src/extensionHost/promptRunRuntime.ts` 未改，门禁 helper 已存在。内部取消隔离和时间窗已切片通过。未改纯宿主状态机、调度内核或 UI。
  - `loopplus-validation-preflight`：不写仓库文件，只准备隔离路线。路线已经可交接。它不是冒烟通过，也没有把环境证实为不可用。
  - `loopplus-plan-design`：当时只改本计划与 `.ch/docs/design-docs/loop-plus-scheduling.md`。本轮继续只改这两份文档。
- 第 9 轮写入范围仍然互斥。`loopplus-final-validation` 独占 build、全量和确定性原生命令 bootstrap，以及自己的私有验证目录。`loopplus-memory-cleanup` 只在再核验并保全证据后精确还原已确认的 14 项生成噪声，不改其它索引、热区、计划或用户改动。本计划只改这两份文档。不读同批尚未返回的结论，不占 `dist`，不预写他人结果。
- 文档目录：本轮只更新本计划和 Loop+ 设计。索引、规格、架构、ontology、MEMORY、用户功能清单入口和生成辅助层留到下一收尾批，清单见下方。
- 配置与脚本：不改。

## 风险与缓解

- 风险：把 Loop+ 做成现有 Loop 的默认路径，或让 `continue` 且无子任务继续落入 `needs-review`。缓解：独立可选分支；正常等待保持 `running`，不得复用该经典分支，也不得清空经典 `activeSubtaskIds` 屏障。
- 风险：把第 3 轮 105 项、20 项、74/75，第 4 轮的 21、36、69、30、6、23，第 5 轮的 host 27、runtime 18、UI 28 和当时 80 个文档路径，或第 6 轮的合并 55、runtime 23 和 84 个文档路径相加后当成去重总数或整体通过。缓解：host 32 与 scheduler 23 属于同一次 55，不能再相加；runtime 23 覆盖旧 18，不能再加旧 18。自动识别的“未明确”或“未完成”不是失败。帮助选择器断言只在对应 UI 切片里通过。
- 风险：把第 5 轮或第 6 轮切片通过，或第 7 轮构建通过，写成整体通过。缓解：取消收尾、基础报告故障、准备失败、控制器释放、消息无轮次、adapter 接线、暂停门禁、内部取消隔离和 run 时间窗只记切片通过。第 7 轮只证明构建退出码 0 和历史全量分类，不证明真实场景。第 8 轮提取契约 23 项已接受，但不能写成全量重跑。本轮同批 build 和全量不预写。
- 风险：把内存、AST 或 VM 证据写成真实宿主验收，或把选择器通过写成真实 CLI 已经回放旧决策。缓解：第 6 轮三项来自当前源码、回归和 AST/VM。第 8 轮提取契约的 AST 只约束调用结构。二者都不是 Extension Host 回放，也不是 provider 已 resolve。
- 风险：帮助切片或第 7 轮构建让读者以为 Loop+ 已经可选。缓解：产品验收标准保持未勾选。帮助、模式持久化、FIFO、增量派发、停止/继续和 classic 没有真实 DOM。启动和 activation 调用不是 provider resolve。本轮 bootstrap 不预写。
- 风险：接入时重写已验收内核，或手改 `parentStopped`。缓解：宿主保存整份 `snapshot()`。暂停门禁已经留在既有调度文件里，公开宿主 API 和 Tab 契约仍不改。切片通过不是再授权重写内核。
- 风险：验收快照覆盖队列，或完成事件被重复消费。缓解：运行、待启动、队列和当前验收分开；按 attempt 去重；单消费者。重复 `finish` 也不得改已有 summary/report。
- 风险：被拒绝的派发改写仍在运行的任务 meta。缓解：拒绝路径不得写回旧标题或旧报告。
- 风险：只在新批次内部做冲突检测，或另造额度数字。缓解：增量派发把运行中和待启动一起交给现有路径规则；`maxConcurrency` 由宿主作为策略传入，本计划不规定具体数字。
- 风险：等待被实现成忙循环，或主任务因看不到队列而提前结束。缓解：等待是事件挂起；完成门禁读最新状态；AI 决策不能直接写调度状态。停止后的继续不能停在无调用的 idle。
- 风险：父停止、局部失败和恢复互相误伤。缓解：局部结果只进入验收；父停止冻结启动、领取和晚确认；恢复前先收口旧 running。
- 风险：基础 payload 或页面全局模式把 `loop_plus` 收成别的模式。缓解：基础归一化保留该值；每个 Tab 只读记录里的 `loopSchedulingMode`。
- 风险：文档先行被误认为能力已上线，或把欢迎层、CDP、窗口阻挡写成 Loop+ 产品回归，或把 400ms 的 A、缺少主模型 `wait`、提前 `completed` 写成产品缺陷。缓解：计划保持 `in-progress`，设计保持 `proposed`，不归档，不升 active。公共事实仍等整体证据收口。真实界面没有 DOM。生产 3 秒错峰保留；A、B、C 为 4.2 秒、7 秒、9 秒。正常等待不要求额外主模型 `wait`。准确 `eventId` 的 `completed` 先确认当前项，再拒绝父任务提前结束；最后唯一 D 可以合法收口。第 8 轮私有夹具已拆开正负场景，真实 DOM 仍未观测。这些都不是已复现产品缺陷。
- 风险：把此前已经进入 git 差异的 `.ch/docs/generated/memory-index/.local` 当成产品事实，或自行回退、重新生成，或把召回 ID 变化当成功能变化，或把第 8 轮来源审查当成记忆已经上提。缓解：第 5 到第 8 轮 recall 都只输出到任务沟通目录，没有再写仓库 generated 层。第 6 轮 anchor 为空，命中 `mem-afae5cc814`。第 7 轮 focus 是 Loop+ `event_driven` 验收队列、暂停门禁、内部取消和真实宿主，anchor 为空，选中 `mem-7850a1dff0`。第 8 轮 focus 是 Loop+ `event_driven` 验收队列最终验证 Webview，anchor 为空，选中 `mem-3624ba969d`，即当前 active plan。ID 变化不是功能变化。第 8 轮已确认 14 项是本任务 focus 和临时计划生成投影，不是稳定事实；HEAD 为 `6ae83b3208d27ae55e7d6b6be6b102c0af1c37c3`。本轮只授权独立 owner 再核验并保全证据后精确还原，本文只写待执行，不预写已还原。清理不依赖功能通过，也不是记忆上提。不改其它索引、热区、计划或用户改动。第 9 轮 recall 只写本项私有证据目录，anchor 为空，选中 `mem-538cb1444d`，没有写仓库 `.local`。

## 验证计划

本轮只有文档，所以不运行 `npm run build`、`npm clean`、单测、生成器、浏览器或真实 CLI，也不写仓库根 `dist/`。这不撤销此前切片、第 7 轮历史全量和第 8 轮已接受的 23 项，也不重跑它们，更不把 1168/1162/6 改成 1163/5。本计划不占用验证环境，不依赖同批报告，不预写本轮 build、全量或 bootstrap。

已记录、本轮不重跑的证据：

- 阶段一内核：隔离 `tsc` 退出码 0；调度测试 21 项通过、0 失败。这是内核切片，不和第 4 轮宿主 21 项相加。
- 阶段一契约：`npm run build` 退出码 0；决策、契约、任务存储、定时任务和 workspace 设置相关测试 57 项通过、0 失败。
- 阶段一帮助正文：隔离 `tsc` 退出码 0；当时帮助专项与静态页覆盖合计 12 项通过、0 失败。其中含后来被替换的“禁止选择器”断言，不和第 4 轮 UI 的 69 项相加。
- 第 3 轮宿主：根构建退出码 0；构建后 105 项通过、0 失败。这是历史证据，不是本批修改后的通过记录。
- 第 3 轮投影：20 项通过、0 失败。第 4 轮暂停投影的 23 项另记，不并入这 20 项。
- 第 3 轮 UI：75 项中 74 通过、1 失败。那 1 项是当时的过期帮助断言。第 4 轮已经更新并包含在单独的 69 项通过里，不能把 74/75 再当成当前失败。
- 第 4 轮 host：21 项通过、0 失败。中途 `tsc` 退出码 2 只来自同批 RuntimeWiring 测试语法，已由更晚 runtime-wiring 最终 `tsc` 退出码 0 消除。
- 第 4 轮 runtime 相关：36 项通过、0 失败；最终隔离 `tsc` 退出码 0。
- 第 4 轮 UI：69 项通过、0 失败，另 30 项通过、0 失败。不合并成去重总数。中途 `tsc` 退出码 2 的原因与 host 相同，已被更晚编译消除。
- 第 4 轮主 prompt：6 项通过、0 失败；隔离 `tsc` 退出码 0。
- 第 4 轮暂停投影：23 项通过、0 失败；隔离 `tsc` 退出码 0。
- 第 4 轮文档核对：78 个引用路径当时存在。这只是历史文档证据。

- 第 5 轮 host：27 项通过、0 失败。不和第 4 轮宿主 21 项相加，也不和 runtime、UI 相加。
- 第 5 轮 runtime：18 项通过、0 失败；最后一次隔离 `tsc` 退出码 0。这是 adapter 接线切片，不是真实宿主。
- 第 5 轮 UI：28 项通过、0 失败。中途隔离 `tsc` 退出码 2 只来自同批 `loopPlusParentGateDepth` 未定义，已被更晚 runtime 编译和当前声明消除。自动识别的“未完成”不是这 28 项失败。
- 第 5 轮文档核对：80 个引用路径当时存在。这只是当时的文档证据。
- 第 6 轮 host 与 scheduler：同一次 55 通过、0 失败。分开计数是 host 32、scheduler 23，二者属于这 55，不能再相加。隔离 `tsc` 退出码 0。
- 第 6 轮 runtime：23 通过、0 失败，覆盖旧 18。隔离 `tsc` 退出码 0。不是真实宿主。
- 第 6 轮文档核对：84 个引用路径当时存在；尾随空白和 `git diff --check` 退出码 0。这只是当时的文档证据。
- 第 6 轮预检：隔离脚本与场景自检退出码 0；无独占确认拒绝启动，退出码 2。当时没有真实宿主执行。
- 第 7 轮构建：`npm run build` 退出码 0。这是已主审构建，不是本轮重跑，也不是最终验收。
- 第 7 轮全量：1168 项，1162 通过，6 失败，跳过 0。只重跑失败所在文件仍是相同 6 条。14 个 Loop+ 测试文件不在失败 location。不把 1162 写成这些文件的精确通过总数。
- 第 7 轮 5 条历史或环境失败：`config.inspect` mock、2 条本机 locale、trace 旧正则、Codex 额外 `model_reasoning_summary`。有证据，不是本批产品回归。
- 第 7 轮当时的第 6 条失败：新增提取测试要求 `extension.ts` 直接出现 `createLoopPlusOrchestrationHost`。源码是 `extension.ts` 创建 `createLoopPlusRuntimeAdapter`，adapter 再创建该 host。这是历史分类。第 8 轮已接受测试侧 AST 修正，不再是仍待修，也不把全量改成 1163/5。
- 第 7 轮真实宿主：隔离 Extension Development Host 已启动，扩展已激活。当时的欢迎层、CDP 无响应和窗口阻挡使帮助、core、control、classic 没有执行。这是历史阻挡，不是当前唯一结论。第 6 轮合并 55 和 runtime 23 保持切片通过，不重复相加。
- 第 7 轮文档：计划当时 85 个引用存在，无大小写或私有路径污染。那只是当时的文档证据。两份报告无待人工确认。
- 第 8 轮已接受、本轮不重跑：提取契约隔离 `tsc` 退出码 0，23 项通过、0 失败。真实界面仍只有启动、加载和 activation 调用，没有 DOM。

第 6 轮三项已由上述切片覆盖，不再是当前打开缺陷。自动识别写“未明确”或“未完成”的报告，只要上面的退出码和计数成立，就不算失败。四份第 6 轮报告均无待人工确认。第 7 轮全量不能代替真实场景。第 8 轮 23 项已接受，但不写进第 7 轮计数。本轮 build、全量和 bootstrap 不写进本节。

本轮文档核验：

- 对照第 9 轮主审、第 8 轮四份报告和第 7 轮历史全量。提取契约不再是当期失败。真实 DOM 仍未执行。不把本轮同批 build、全量或 bootstrap 预写成通过或失败。
- 本轮 ontology 状态为 ready。`plugin.loop_task` 与 `plugin.rule.loop_subtask_interruption_isolated` 仍是经典整批语义，`source_refs` 仍指向 `ARCHITECTURE.md` 的 Loop 子任务执行隔离和能力规格。本轮不改 ontology。最终必须区分 `event_driven`，不能只加别名，而且要等整体证据收口。
- 检查两份文档引用的仓库路径是否存在，并检查尾随空白和 diff 空白。UI 集成测试按磁盘实际文件名核对，不再沿用旧的大小写候选。
- 确认仓库文档正文没有用户主目录、任务记录路径或密钥。

### 验收矩阵

| 场景 | 期望 | 建议验证 | 当前状态 | 限制与最小解除动作 |
| --- | --- | --- | --- | --- |
| 可控异步，A 先完成且 B 仍在跑 | A 的 `finish` 立即进入当前验收并最多唤醒一次；B 保持 running，不等整批结束 | 注入时钟和可控 Promise 的内核测试；随后用真实 adapter 复测 | 阶段一内核 21 项含 FIFO。第 5 轮 runtime 18 项含 adapter 接线。整体未验收 | adapter 文件已经存在，接线只是切片通过。不用本开发任务当夹具 |
| 验收中 B/C 排队 | B、C 按完成顺序 FIFO 入队，不丢、不被旧快照覆盖；`visibleReviewCount` 含当前项，排队数另列 | 内核队列测试；群聊只读投影测试；真实快照刷新 | 内核队列已阶段验收。投影 23 项含暂停。runtime 36 项含落盘后刷新。不是真实面板 | 阶段四看 Webview。复核前不能写成界面已可见 |
| 零派发等待 | `accept` 带当前事件且零个新任务：确认该项后，仍有在途则父任务保持 `running`。`wait` 不带 `reviewEventId`、不隐式确认、不新增子任务 | 解析器测试已覆盖形状；真实 adapter 断言没有立即再次唤醒，也没有写成 `needs-review` | 解析器已阶段验收。正常等待不要求额外主模型 `wait`。第 7 轮没有真实时间线 | 后续回归继续断言 wake 次数和父状态。不要把提前 `completed` 当成这条 `accept`。切片通过不是整体验收 |
| 提前 `completed` 与最后收口 | 准确 `eventId` 的 `completed` 先 `submitReview` 当前项。仍有 running、pending 或待验收时，只拒绝父任务 `completed`，且不能再 `accept` 同一项追加。最后只剩当前项时，同样合法的 `completed` 确认该项并完成。追加新任务必须走 `accept` | 私有验证拆开正向 FIFO、追加 D 与提前完成负向。不改生产 | 第 7 轮夹具给 A 提前 `completed`，因而不能再 `accept` A 派发 D，并把最后 D 的合法 `completed` 误标非法。这是验证预期错误，不是已复现产品缺陷。本批纠正尚未主审 | 不修生产迁就夹具。帮助检查必须真正 assert；Graph 只限定缺点；统一轮次只查 Loop+ 真实消息；CDP 请求必须有界。这些尚未执行，不预写通过 |
| 恢复死等与完成悬挂 | 停止初始主调用并等中止结束后，显式继续必须产生新的主调用。已完成快照恢复后完成信号必须 settle | 宿主恢复测试，使用真实控制器而不是只构造内存快照 | 第 4 轮 host 21 项已覆盖这两条，切片通过。整体未验收。取消尚未 settle 时继续已有第 5 轮 host 切片 | 不把切片通过写成端到端 |
| 取消尚未结束时继续 | 旧执行仍在取消时拒绝本次继续，保持 `stopped` 并及时 settle。取消完成只排队，不自动恢复。下一次显式继续才验收，不复活旧 attempt | 延迟 abort、立即重试、晚主响应和再次显式继续的宿主回归 | 第 5 轮 host 27 项切片通过。整体未验收。这不是第 6 轮已切片通过的内部取消隔离 | 不把切片通过写成真实宿主通过 |
| 增量冲突与额度 | 新任务与 running、pending 一起用 `conflictGroup` 和 `writeFilePathsOverlap`；超额留在 pending。内核要求宿主传入正整数 `maxConcurrency`，自身不发明数字，也不自己做 3 秒延迟 | 内核 dispatch / promote 测试；真实 adapter 上的增量入口 | 内核规则已阶段验收。宿主额度和生产 adapter 增量入口未验收 | 沿用 `src/extensionHost/loopOrchestration.ts` 的 `LOOP_SUBTASK_LAUNCH_INTERVAL_MS`（3 秒），不另造错峰 |
| 被拒绝派发 | 同一子任务已有未验收 attempt 时拒绝新 attempt，且不改旧标题、summary 或 report | 宿主派发测试：快照标题与任务记录标题保持原值 | 第 4 轮 host 21 项已覆盖，切片通过。整体未验收 | 拒绝路径不得写回旧 meta。不把切片通过写成端到端 |
| 重复 finish | 同一 attempt 的重复 `finish` 不覆盖新执行，也不把已有结果改成过期 `blocked` | 宿主幂等测试，断言 summary、report 和尝试次数不变 | 第 4 轮 host 21 项已覆盖，切片通过。整体未验收 | 基础报告失败已有第 5 轮 host 切片。暂停后不启动 pending 另列，且第 6 轮已切片通过，不混进这条 |
| 报告写入失败 | `recordAttempt` 失败不得吞掉已生效的 finish。完成队列必须落盘，错误可见，并进入可恢复暂停；不假称报告或整体验收成功 | 宿主异常测试：抛出报告写入错误后持久化 queue 不为 0，且后续显式继续能处理保留项 | 第 5 轮 host 27 项切片通过。整体未验收。暂停之后不启动 pending 见下一行，第 6 轮 host 切片已覆盖 | 不把队列保留或暂停门禁切片写成整体通过 |
| 沟通准备失败 | `prepareCommunication` 失败不得留下没有进程的 running。结果应是可观察的 failed 完成事件或可恢复暂停 | 宿主启动测试：准备抛错后 running 不含该 attempt | 第 5 轮 host 27 项切片通过。整体未验收 | 不把切片通过写成真实进程核对 |
| 自然完成释放控制器 | 自然 `completed` 后 done 已 settle，并且 `hasController` 为 false。晚回调不得重建或改写完成态 | 宿主完成测试。加载已完成快照的旧用例不能代替自然完成路径 | 第 5 轮 host 27 项切片通过。加载已完成快照的释放仍然有效。整体未验收 | 不把切片通过写成端到端 |
| 空转与丢唤醒 | 只有返回的 `wake === true` 才唤醒一次；`wake === false` 不得立刻重入。丢失 true 时队列不得被当成已消费 | 集成测试覆盖 finish 与 resume 的 wake 边沿，并驱动生产 adapter | 未做本批最终验收。基础报告失败已有第 5 轮 host 切片，不再是当前打开项 | 宿主只启动本次 `started`，并持久化 `wakeSeq` / `wakePending`。正常等待不要求额外主模型 `wait` |
| 停止、坏快照、显式恢复 | 父停止后 `claimNextReview` 与晚到确认失败且不消费当前项。旧冒号 ID、超额度、running 冲突、同一子任务多个未验收 attempt 在内核加载时拒绝，store 仍保持 `event_driven` 且不改父状态。`resumeParent` 在 running 非空时原样拒绝；宿主先 `finish` 旧进程后，成功结果保留队列、pending 和 `seenAttempts`，`started` 只含新提升项 | 已验收内核测试与 store 往返；宿主停止/继续测试 | 内核与 store 切片已验收。中止已经结束后的显式继续有 host 21 项。用户停止按钮和真实进程核对未验收 | 禁止手改 `parentStopped`。恢复后先核对真实进程，消失的进程用 `finish(outcome: "stopped")` 收口 |
| 模式入口、定时任务、Tab | 新任务可显式选择 `loop_plus`；定时任务保存该模式且不附带 `loopExecutionMode`；已有任务按记录恢复；不同主 Tab 使用各自的 `loopSchedulingMode` | 选择器、定时配置、会话 Tab 和基础 payload 测试 | 存储与定时落盘已阶段验收。UI 69 项和 runtime 36 项分别覆盖选择器与按任务模式。整体未验收 | Webview 不得再把 `loop_plus` 收成 Vibe。宿主不得把所有主 Tab 解析成 `loop` |
| 基础 payload | 基础 `normalizePromptPayload` 保留 `loop_plus` 和角色模型字段。冲突队列与暂停后发送走这条路径时也不能丢 | 直接调用基础函数的 UI 测试，而不是只测旁边的补回函数 | 第 4 轮 UI 69 项已覆盖，切片通过。整体未验收 | 不把切片通过写成真实发送已验收 |
| 主 prompt 协议 | 主 prompt 写明 `completed` 必需的 `answerConclusion`、`finalSummary`、`acceptance` 和 `requirementCoverage` 结构 | prompt builder 测试。手工 JSON 不能代替提示词断言 | 第 4 轮 prompt 6 项已覆盖，切片通过。整体未验收 | 解析器契约不变。真实模型是否按提示词输出仍待阶段四 |
| 暂停面板 | `needs-review` / error 不显示正在验收或思考气泡；暂停期间队列仍可见，并与正在验收区分 | 投影测试：正常 running、暂停持有项、暂停队列、显式继续后的显示，以及旧 main_sub / debate | 第 4 轮投影 23 项已覆盖，切片通过。真实面板刷新未做真实环境 | 不把投影通过写成 Webview 已可见 |
| Loop+ 子消息轮次 | Loop+ 子消息不显示统一的“第 1 轮”。按消息任务 ID 关联 Tab 的 `loopSchedulingMode`；未知或 classic 保留原轮次逻辑 | 直接调用标签函数，并补 UI 链路回归。不能用当前下拉猜测 | 第 5 轮 UI 28 项切片通过。不是真实 Webview。整体未验收 | 不把夹具通过写成界面已经可见 |
| 本次 run 结果隔离 | 生产 adapter 不得把技术 `loopRound=1` 下的旧 assistant 或 status 当成本次新决策。无新输出、提前返回和旧 run 晚到都要隔离，并且正文不得早于实际 run 起点 | 驱动 `extension.ts` 实际使用的 adapter 的集成测试，覆盖 run 起点下界 | 第 5 轮 runtime 18 项是 adapter 接线。第 6 轮 runtime 23 覆盖旧 18，并包含时间窗下界。不是真实 CLI 回放。第 8 轮仍没有这条真实 DOM | 切片通过不是 Extension Host 已执行 `runPrompt`。本轮 bootstrap 不预写结果 |
| 异常暂停后不启动 pending | 报告失败等异常进入暂停后，不再启动未开始的任务，也不把磁盘状态强写成 running。未启动项保留。显式继续可以恢复，并且只启动一次 | 并发上限为 1 的宿主回归：A 运行、B pending，A 的报告写入抛错后 B 仍 pending，状态不是新的 running | 第 6 轮 host 切片通过：自动暂停退回尚未启动预约，代际门禁拦住旧回调，在途结束只入队且不改回 running，显式继续按原 attempt 启动一次。host 32 与 scheduler 23 属于合并 55。不是真实宿主 | 不把切片通过写成真实 CLI。自动暂停后再父停止、连续落盘失败仍按报告披露，不是已复现缺陷 |
| 内部取消不误停父任务 | 内部单次请求取消不调用用户 `stopRunForTab`，不把父任务写成 stopped，也不取消尚未结束的其它任务。用户从主任务或群聊显式停止时，仍先关父门禁再取消全部 | 执行当前停止函数的行为测试：验收 A 时 B 报告失败，C 仍保留；另测用户显式停止会取消全部 | 第 6 轮 runtime 切片通过：内部 `cancelInvocation` 不走用户父停止，用户停止仍关闭父门禁。证据是当前接线、回归和 AST/VM，不是真实 Extension Host。runner 既有 “stopped by user” 文案不表示父记录已停止 | 不把 VM 证据写成真实宿主。不宣称已改所有 runner 文案 |
| 助手正文不早于 run 起点 | 选择本次调用结果时，正文时间必须不早于实际 run 起点，也不晚于 run 结束。boundary 起点更早时，不能把 run 开始前的正文算进来。合法预载 user 保留 | 直接调用 `selectLoopPlusInvocationAssistant`：boundary 为 100、run 为 200 到 300、正文为 150 时必须不选中 | 第 6 轮选择器切片通过：助手正文限定 `max(boundary.startedAt, run.startedAt)` 到 `run.endedAt`，合法预载 user 保留。不是真实 CLI 回放 | 不把函数通过写成 Extension Host 已回放旧决策 |
| 模型与 i18n | Codex / Claude / OpenCode 的主子模型和继续选择不被 Loop+ 改写；中英文帮助与选择器文案一致 | 现有设置/继续模型测试，加一条 Loop+ 路由；帮助正文和两处选择器断言 | 帮助正文和两处 `loop_plus` 选择器已有 UI 69 项切片通过。模型路由未做真实 CLI | 不在本批调用真实 CLI。切片通过不是整体验收 |
| Linux / macOS / Windows 路径 | 反斜杠、重复分隔符、尾部斜杠、大小写和父目录重叠继续走 `writeScope`；临时根 junction 语义不变 | 当前环境可跑路径单测；junction 只在 Windows 宿主做 | 规则未改，本轮未重跑。第 8 轮仍只有启动、加载和 activation 调用，没有 DOM。Linux 与 Windows 真机未执行。这不是产品回归 | 不能把 macOS 启动写成三平台场景通过，也不能预写本轮成功 |
| 经典整批回归 | `runLoopRound`、整批屏障、`continue` 无子任务进入 `needs-review`、debate 批次语义不变 | 生产 adapter 上跑现有 Loop 决策、lifecycle 和 debate 测试 | 第 7 轮全量 1168/1162/6 仍是历史。classic 真实场景没有执行。提取断言已由第 8 轮 23 项接受，不是全量重跑 | 不把 1162 或 23 写成经典场景通过。Loop+ 不得复用该屏障。本轮全量不预写 |

### 已结束：第 6 轮缺陷修复与真实验证预检

第 5 轮的取消收尾、基础报告故障、准备失败、自然控制器释放、消息无统一轮次和 adapter 接线，以及第 6 轮的暂停门禁、内部取消隔离和实际 run 时间窗，都已经切片通过，不再是当前打开项。adapter、运行时集成测试、夹具和 `src/test/webview/looppluswebviewintegration.test.ts` 已经存在。存在和切片通过都不能代替未执行的真实场景。

第 6 轮预检已经给出隔离路线，不再写成“尚无结论”。第 7 轮已经启动隔离宿主，见下一节。预检和夹具自检仍不是冒烟通过。

### 已主审：第 7 轮构建、全量回归和隔离宿主启动

第 7 轮验证证据已经主审。两份报告均无待人工确认。`npm run build` 退出码 0。全量 1168 项：1162 通过、6 失败、0 跳过。只重跑失败所在文件仍是相同 6 条。14 个 Loop+ 测试文件不在失败 location，不能据此写出它们的精确通过总数。

5 条有历史或环境证据，不是 Loop+ 产品回归：`config.inspect` mock、2 条本机 locale、trace 旧正则、Codex 额外 `model_reasoning_summary`。第 6 条是本次新增提取测试，错误要求 `extension.ts` 直接出现 `createLoopPlusOrchestrationHost`。当前源码是 `extension.ts` 创建 `createLoopPlusRuntimeAdapter`，adapter 再创建该 host。调用链存在。这是第 7 轮当时的分类。第 8 轮已接受测试侧 AST 修正，见下一节；这里的 1168/1162/6 不改成 1163/5。

隔离 Extension Development Host 已经启动，扩展已激活。不再写“尚未启动”。当时的欢迎层、CDP 无响应和窗口阻挡，使中英文帮助、core、control 和 classic 真实场景都没有执行。这是第 7 轮阻挡描述；第 8 轮已绕开欢迎层，当前结论以下一节为准。构建通过、全量里未列入失败 location 的 Loop+ 文件，以及夹具场景自检，都不是最终验收。环境阻挡不是已证明的 Loop+ 回归。第 6 轮 host 合并 55 与 runtime 23 保持已通过，不重复相加。本轮只证明该次 macOS 隔离宿主能起来，不能推断 Linux 或 Windows，也不能把日志里的启动写成已经看见 `finish`、`wake`、`claim`、`started` 或 Webview 队列。

生产 3 秒错峰保留。第 7 轮夹具把 A、B、C 记成各自运行时长 4.2 秒、7 秒、9 秒，但没有真实时间线。正常等待不要求额外主模型 `wait`。这些夹具仍不是真实模型，不得包装成端到端模型验证。

### 已主审：第 8 轮提取契约，不是全量重跑

第 7 轮 1168 项、1162 通过、6 失败保留为历史全量，不能改成已重跑的 1163/5。第 8 轮主审接受提取契约修正，不再写仍待修。`extensionHostExtractionContracts` 不再要求 `extension.ts` 字面出现 `createLoopPlusOrchestrationHost`，改为 TypeScript AST 约束 extension 创建 adapter、adapter 的 `host()` 创建 orchestration host，并保留定时配置优先、`loop` / `loop_plus` 分流、Graph 分支和 `runEventDrivenLoopPrompt`。隔离 `tsc` 退出码 0。契约、入口路由和 runtime wiring 合计 23 项通过、0 失败。生产源码未改去迎合旧字面断言。其余 5 条历史或环境失败未重跑、未修。这不是产品验收，也不是全量通过。

### 已主审的有限真实证据，界面仍未执行

第 8 轮接受私有夹具的正负语义修正和沙箱操作的有限结论。不接受真实帮助、模式持久化、FIFO、增量派发、停止/继续或 classic 场景。已有日志只证明宿主启动、加载开发扩展并发出 activation 请求。不能把 `ExtensionService#_doActivateExtension` 等同于 provider 已 resolve。没有 Webview DOM，也没有可证明的 Loop+ 产品回归。fixture 自检不是真实模型调用。不要用正在开发 Loop+ 的这个任务、它的任务记录或当前会话当夹具。

### 仍待补齐：验证工具

这些是可执行缺口，不能全称外部环境。`run-real-host` 只调 core。`drive-scheduler` 只实现 core，成功检查以 fixture 日志为主，不能代替真实任务记录和群聊 DOM。没有 control、classic、early 的完整驱动。CDP 的 `findSession` / `Runtime.evaluate` 只查 target 默认 context，不定向 frame 或 execution context。帮助路线没有把原 extension-tests 传进 extension tests path。该脚本只执行打开面板命令并保持约 20 秒，不适合长场景。下一动作是独占 build、必要全量，以及确定性原生命令 bootstrap。重复键盘或 AX 不再作为默认方案。本文不预写本轮结果。

裁定保持，而且不修生产：准确 `eventId` 的 `completed` 先确认当前项；仍有运行、待启动或待验收时拒绝父任务提前结束；最后唯一 D 可以合法结束。负向场景独立，不重验已确认的 A。3 秒错峰保留。A、B、C 为 4.2 秒、7 秒、9 秒。正常等待无需额外主模型 `wait`。必须观测真实任务记录和群聊 DOM。

### 待执行：14 项生成噪声的有条件清理

第 8 轮只读审计和主审复核确认 14 个当前 tracked `.local` 文件与快照一致，HEAD 为 `6ae83b3208d27ae55e7d6b6be6b102c0af1c37c3`。它们是本任务 focus 和临时计划生成投影，不是稳定事实。本轮授权独立 owner 在再核验并保全证据后精确还原这 14 项。只写待执行，不预写已还原。不改其它索引、热区、计划或用户改动。这项清理不依赖 Loop+ 功能通过，也不是 MEMORY 上提。

### 本轮不预写

`estimatedRemainingRounds=3` 只是估计：本批补齐验证工具并做独占 build、全量和确定性 bootstrap；成功后再并行公共规格与架构、runtime 事实；随后 ontology、归档引用和最终复核。若验证证明只剩外部条件，按当时剩余可执行事项调整，不预承诺通过。计划保持 `in-progress`，设计保持 `proposed`。不归档，不升 active。同批结果不写成已验收。

下面的前提和步骤仍未执行。本计划不代跑。

前提：

- 单独打开一个干净工作区，使用单独的 Extension Development Host，不复用正在跑开发任务的窗口。
- 只使用该隔离工作区里已配置、可启动的本地 CLI。模型调用失败要记为环境失败，不能改调度契约迁就。
- 证据形式：测试命令的退出码和通过计数；宿主日志里的 `finish`、`wake`、`claim`、`started`；Webview 同时可见当前验收、另行计数的排队项和仍在运行项。证据写在当轮沟通或测试输出，不把私有输出目录写进仓库。
- 平台：Linux 与 macOS 可在对应宿主记录路径 smoke；Windows 另记 junction / hardlink 临时根。缺少某个平台时写明未跑，不能推断通过。
- 草稿纠正：fixture 不能用早于生产 3 秒错峰的 400ms 结束来证明 B 已在途。A、B、C 用 4.2 秒、7 秒、9 秒作为各自运行时长。正常等待以父任务 `running`、无忙循环、不计失败为准，不要求主模型再输出 `wait`。沙箱只写 sandbox HOME，不以真实任务库的正常更新时间判污染。追加 D 走 `accept`，不要给 A 提前 `completed`。

待执行步骤，由验证 owner 执行，本计划不代跑：

1. 在隔离工作区新建 Loop+ 任务，确认选择器值是 `loop_plus`，经典 Loop、Vibe、Graph 和 debate 入口仍按原模式启动。
2. 派发可控的短任务 A 和长任务 B。A 结束后用 `accept` 验收，B 仍显示运行。确认 Loop+ 真实消息没有统一的“第 1 轮”；这条不扩大到 classic 消息，Graph 只检查缺点不再写不能处理冲突。B 的在途证据必须越过生产 3 秒错峰，或使用明确屏障。400ms 结束的 A 不够；按 4.2 秒、7 秒、9 秒记录 A、B、C 各自运行时长。
3. 验收 A 期间让 B 与另一个 C 完成，确认两者按完成顺序排队且刷新后不丢。
4. 对 A 用 `accept` 提交零个新任务，确认父任务仍是 `running`，主任务没有空转重入。宿主可以直接进入等待，不把缺少额外 `wait` 调用当成失败。不要用 `completed` 代替这次 `accept`；提前 `completed` 会确认 A，之后不能再派发 D。
5. 再派发一个与运行中任务写路径重叠的任务，确认它 pending；并发超出宿主额度时同样 pending。
6. 在子任务取消尚未结束时继续，确认本次调用及时结束且保持停止；取消完成后队列仍在，下一次显式继续才验收。
7. 用户停止父任务后确认不能领取、不能晚确认。把残留 running 逐个收成停止结果，再显式继续；旧 running 不复活，未验收队列还在，只有新 `started` 被启动。
8. 用损坏的 `event_driven` 快照或未发布旧冒号事件 ID 恢复，确认任务不降成经典完成。自然完成后确认控制器已释放。
9. 另建一个经典 Loop 任务，确认同一批还有活动子任务时主任务不会提前复核，且 classic 子消息仍保留原轮次标签。
10. 让一个子任务在报告写入失败后进入暂停，确认尚未启动的任务保持 pending，父状态不被强写成新的 running；显式继续后才启动一次。
11. 在验收进行中让另一个子任务的内部请求取消，确认父任务不因此停止，其余子任务不被取消；另一次用户显式主任务或群聊停止仍先关门禁再取消全部。
12. 在实际 run 开始前放入同任务、同角色、同 round 的助手正文，确认本次调用结果不选中它。这仍不是宣称历史 CLI 已经回放过旧决策。
13. 正向场景用 `accept` A 追加 D，并在 B、C 排队时保持可见 FIFO。负向场景另测：A 仍有其它工作时收到准确 `eventId` 的 `completed`，A 已确认且父任务不完成；最后只剩 D 为当前项时，合法 `completed` 可以收口。两组不要混成一个夹具，也不要改生产。帮助缺失断言必须非零失败。CDP 请求本身有界。

## 测试与清单同步

- 单元测试新增/更新：本轮无代码改动，不新增测试。内核、契约、帮助、宿主、UI、prompt 和投影测试仍由对应 owner 维护。
- 单元自测结果：本轮不跑 build 或单测。阶段一的内核 21 项、契约 57 项、帮助 12 项，第 3 轮的 105 项、20 项和 74 加 1 失败，第 4 轮的 host 21、runtime 36、UI 69 与另 30、prompt 6、panel 23，第 5 轮的 host 27、runtime 18、UI 28，以及第 6 轮的合并 55 和 runtime 23，都按各自边界保留，不相加。第 7 轮已主审的全量是 1168 项、1162 通过、6 失败，不与上述切片相加，也不改成 1163/5。第 8 轮隔离 `tsc` 与 23 项另记，不并入该全量。文档尾随空白和引用存在性在本轮核验。
- 失败处理记录：本轮没有新的测试运行。第 3 轮那 1 项帮助失败是过期断言，第 4 轮 UI 切片已经更新并通过；它不是环境失败。自动识别的“未明确”或“未完成”不是失败。第 5 轮和第 6 轮切片已有通过计数。第 6 轮三项不再缺少修复后的切片结果，但这些结果不是整体通过。UI 中途 `tsc` 退出码 2 已消除，不再当成当前失败。第 7 轮 5 条历史或环境失败保留证据，本计划不修。第 6 条提取断言已由第 8 轮测试侧修正接受，不再是仍待修，也不是全量重跑。真实 DOM 未执行，不记通过。
- 功能清单：尚未同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，也尚未同步 `docs/插件功能清单.md`。帮助文案和未整体验收的选择器都不是 active 能力。
- 相关文档同步：本轮只更新本计划和 `.ch/docs/design-docs/loop-plus-scheduling.md`。

### 下一收尾批可派发的互斥写入，本批明确不改

本轮仍不改下面任何公共文件。公共事实和归档以整体证据收口为前提。后续可以引用第 7 轮历史全量分类和第 8 轮提取契约 23 项，但不能把本轮尚未返回的 build、全量或真实 DOM 写成已交付。四组写路径继续互斥。最后归档同时依赖全部事实同步和验证收口。现在不归档，设计不升 active。`estimatedRemainingRounds=3` 只是估计：本批补齐后，成功时并行公共规格与架构、runtime 事实，再做 ontology、归档引用和最终复核。若只剩外部条件，按当时剩余可执行事项调整，不预承诺通过。

- 组 A，规格与用户清单：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`。写用户可见的 Loop+ 入口、可见 FIFO、验收后增量派发或正常等待、无统一轮次，以及执行结束不等于验收完成。中英文帮助里的 Loop / Loop+ 区别和 Graph 缺点修正只在整体验收后升为 active 能力。可以引用的已主审结论包括：第 7 轮构建退出码 0 和 1168/1162/6 历史分类，第 8 轮提取契约隔离 `tsc` 与 23 项通过且生产未改，以及真实界面仍未被接受。依赖：整体证据收口之后才升为 active。本轮同批结果不能预先写入。中英文帮助和 Graph 缺点修正仍是验收需求，不因本文勾选。
- 组 B，运行时与架构：`ARCHITECTURE.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/index.md`。写宿主分流、暂停门禁、内部取消与用户停止、run 时间窗、恢复和继续。索引补上本设计；整体验收前设计状态保持 `proposed`，不把索引条目写成已交付。依赖：同组 A。索引还依赖本设计文件仍在 active 路径，归档时再改路径。
- 组 C，ontology：`.ch/docs/ontology/domains/cli-plugin-runtime.json` 里的 `plugin.loop_task` 和 `plugin.rule.loop_subtask_interruption_isolated`，以及必要的 `source_refs`。当前两者都是经典整批语义：同一批按 3 秒错峰，`activeSubtaskIds` 清空后才复核，局部中断不终止仍为 running 的父任务，尚未启动项在中断期间标 skipped，用户从群聊或主任务停止时父子一起 stopped。`event_driven` 必须另写不同语义：任一执行结束就逐个验收，验收中其它完成进入可见 FIFO，没有新任务但仍有在途任务时父任务保持 `running` 且不计失败，全部运行、待启动和待验收收口后才完成。不能只在 aliases 里加 Loop+。依赖：组 A 和组 B 已经写清这组差异；若并行派发，提示词必须自带上述语义，不能等别名补丁。
- 组 D，记忆与生成层：`.ch/docs/MEMORY.md` 与 `.ch/docs/memory/` 的上提判定，以及被 git 跟踪的 `.ch/docs/generated/memory-index/.local` 差异来源审查。只在前三组形成跨会话仍需先读的稳定结论后上提。`last_verified_at` 仍是 2026-07-18，不得借本批改写。既有 `.local` 差异保留，审查来源后再决定保留、剥离或按来源重建。不自行生成，不自行回退。生成结果不是产品事实。依赖：组 A 到组 C 的稳定结论，以及验证收口。第 8 轮已确认 14 项噪声，本轮有条件清理只记待执行，不预写已还原，也不是记忆上提。上提仍依赖组 A 到组 C 的稳定结论和验证收口。第 7 轮选中 `mem-7850a1dff0`，第 8 轮选中 `mem-3624ba969d`，第 9 轮选中 `mem-538cb1444d`，都不是功能变化。

完成后把本计划头部改为 `completed`，按 `.ch/docs/exec-plans/README.md` 移入已存在的 `.ch/docs/exec-plans/completed/2026-09/`，文件名与当前计划文件名相同。该归档文件现在不存在，也不在本批创建。归档还要等最终重 build 和全量之后，不能与公共事实同步抢同一批共享引用。归档后必须更新仓库内引用并确认目标存在。现在不归档，设计保持 `proposed`，也不宣称 Loop+ 已经交付。

## 任务列表

### Tasklist:

- [completed] 阶段一：计划与只读审计、内核、模式/存储/决策契约、中英文帮助正文已阶段验收。
- [completed] 第 4 轮切片：恢复死等、重复 finish、被拒绝派发、基础 payload、按 Tab 模式、主 prompt 和暂停展示。计数不相加，整体未验收。
- [completed] 第 5 轮切片：取消收尾、基础报告故障、准备失败、自然控制器释放、消息无统一轮次、adapter 接线。host 27、runtime 18 且最后隔离 `tsc` 退出码 0、UI 28；文档当时 80 个路径。计数不相加。UI 中途 `loopPlusParentGateDepth` 未定义已消除。自动识别的未完成或未明确不是失败。整体未验收。
- [completed] 第 6 轮切片：暂停门禁、内部取消隔离、实际 run 时间窗。host 32 与 scheduler 23 属于合并 55，不相加；runtime 23 覆盖旧 18；两份隔离 `tsc` 退出码 0；计划 84 个引用存在，文档检查退出码 0。第 5 轮 UI 28 与中英文帮助保持切片通过。四份报告无待人工确认。证据来自源码、回归和 AST/VM，不是真实宿主。整体未验收。
- [completed] 第 7 轮已主审证据：`npm run build` 退出码 0；全量 1168 项中 1162 通过、6 失败，重跑相同 6 条。5 条历史或环境失败已分类。隔离宿主已激活。这不是最终验收，也不包含未执行的帮助、core、control、classic 场景。
- [completed] 第 8 轮已主审：提取契约 AST 约束 extension → adapter → host，隔离 `tsc` 通过，23 项通过、0 失败。生产未改。不把第 7 轮 1168/1162/6 改成 1163/5。夹具正负语义和沙箱有限结论已接受。真实 DOM 未接受。
- [in_progress] 阶段四：独占 build、全量，以及确定性原生命令 bootstrap。补齐 driver 的 control、classic、early，CDP frame/context 定向，并把原 extension-tests 从 20 秒保持改成适合长场景的帮助路线。重复键盘或 AX 不是默认方案。同批结果不预写。
- [pending] 阶段五：公共规格、架构与 runtime references、ontology、归档和最终复核。依赖整体证据收口。14 项生成噪声清理已获有条件授权，只待执行，不预写已还原，也不是记忆上提。计划保持 in-progress，设计保持 proposed。

预计剩余 3 轮只是本文档估计，不改父任务控制面上的 `estimatedRemainingRounds`。顺序是本批验证补齐，成功后并行公共规格与架构、runtime 事实，再做 ontology、归档引用和最终复核。不归档，不升 active。出现真实缺陷或只剩外部条件时按证据调整，不虚报完成。

## 决策记录

- 2026-09-25：Loop+ 群聊“我要说话”会唤醒主任务，或在主任务执行中进入 `userMessageQueue`，之后一起判断立刻派发还是等待。细节和验证见 `.ch/docs/exec-plans/completed/2026-09/2026-09-25-loop-plus-user-message-wake.md`。这不把整个 Loop+ 标成已上线。

- 2026-09-24：首轮先固定行为、后固定字面量。第 2 轮已经改成独立 `loop_plus`，本条只保留为历史。
- 2026-09-24：经典 `continue` 且无子任务转为 `needs-review` 是现有事实，不能当作 Loop+ 的正常等待。
- 2026-09-24：冲突规则复用 `conflictGroup` 与 `writeFilePathsOverlap`。路径规范化已经把反斜杠换成斜杠并忽略大小写。`loopParallel` 没有另一套数字并发上限。
- 2026-09-24：子任务启动间隔常量是 `LOOP_SUBTASK_LAUNCH_INTERVAL_MS`（3 秒），位于 `src/extensionHost/loopOrchestration.ts`。内核自己不延迟启动。
- 2026-09-24 第 2 轮：用户可见模式是 Loop+，内部 `InteractiveMode` 为 `loop_plus`。不复用 `plan`，也不新增第三种 `LoopExecutionMode`。任务 `schedulingMode` 为 `classic | event_driven`；缺省和未知都是 classic。该决定仍有效，并已由契约切片落地。
- 2026-09-24 第 2 轮：首轮内核的事件 ID 歧义和父停止后仍可领取，当时未验收。该结论已被 2026-09-25 第 3 轮取代，不再是打开缺陷。
- 2026-09-24 第 2 轮：模式说明要写清 Loop 等整批结束后集中复核，Loop+ 一个执行结束就逐个验收。Graph 已有冲突处理，帮助不再写不能自动解冲突。图编辑器仍然没有。该帮助要求保持有效。
- 2026-09-25 第 3 轮：主任务阶段验收内核、契约和帮助正文。精确契约以设计文档为准：坏快照不降级，完整 `snapshot()` 持久化，决策只表达意图，调度状态只能由宿主调用内核写入。`estimatedRemainingRounds` 仅兼容且可选；`roundSummaries` 不是 Loop+ 完成前提。
- 2026-09-25 第 3 轮：当时的阶段二并行 owner 是 `loopplus-host`、`loopplus-ui`、`loopplus-review-panel`。他们留下了入口、选择器和投影切片。该轮边界已被后续互不重叠范围取代，不能再按旧范围判断谁可以改哪个文件。
- 2026-09-25 第 4 轮：阶段一保持通过。105 项宿主测试和 20 项投影测试只记历史阶段证据。UI 74/75 的失败断言由主任务批准更新，无需用户决策。该更新后来包含在第 4 轮 UI 的 69 项通过里。
- 2026-09-25 第 4 轮：派发时，恢复死等、完成快照悬挂、重复 finish、被拒绝派发、基础 payload、主 prompt、快照刷新、按 Tab 模式和暂停面板都还打开。第 5 轮复核六份报告后，这些项改为各自切片通过，不再是当前打开缺陷。
- 2026-09-25 第 4 轮：每个会话 Tab 的 `loopSchedulingMode` 只取 `classic | event_driven`，未知或缺失为 classic。前端据此区分主任务模式；子任务仍是 coding；Graph 优先。该契约已有切片证据，整体接入仍未验收。
- 2026-09-25 第 4 轮：`.ch/docs/generated/memory-index/.local` 实际被 git 跟踪，且当时的 recall 写入了会话 focus。该差异仍待阶段五审查。本批不生成、不回退。
- 2026-09-25 第 4 轮：当时预计还有 4 个复核/批次。第 5 轮主任务已把剩余复核改为 3，本条只保留为历史。
- 2026-09-25 第 5 轮：host 21、runtime 相关 36、UI 69 与另 30、prompt 6、panel 23 均按原报告通过。host / UI 中途 `tsc` 错误是同批 RuntimeWiring 测试语法，已被更晚 runtime-wiring 最终 `tsc` 退出码 0 消除。这些集合不相加。自动识别的“未明确”不是失败。78 路径检查只是历史文档证据。
- 2026-09-25 第 5 轮：新的已复现缺陷是取消尚未结束时继续 done 悬挂、`recordAttempt` 抛错导致 finish 未落盘且未唤醒、`prepareCommunication` 抛错留下无进程 running、自然完成未释放控制器，以及 Loop+ 子消息仍显示第 1 轮。同批修复不算完成。
- 2026-09-25 第 5 轮：真实 adapter 与本次 run 结果隔离是待验证风险。技术 `loopRound=1` 可能和按 task、round、role 读取历史的路径相遇，但没有证据证明已经重放旧决策，因此不写成已复现缺陷。
- 2026-09-25 第 5 轮：本批四个 owner 的仓库写入范围互斥。宿主公开 API 和 Tab 摘要契约不变。预计剩余 3 个复核/批次：本批修复加 adapter / UI 集成、随后独占最终构建与必要全量回归及隔离真实冒烟、最后公共事实源同步、生成层审查和归档。真实环境本轮不跑；不可用时先写可执行替代和阻塞证据，不预先宣称成功。
- 2026-09-25 第 5 轮：本轮 recall 只写到任务沟通目录，没有再写仓库 generated 层。此前 `.local` 的 git 差异不自行回退。
- 2026-09-25 第 6 轮：第 5 轮 host 27、runtime 18 且最后隔离 `tsc` 退出码 0、UI 28 按原报告保留，文档 80 路径只是当时证据。这些集合不相加。UI 中途 `loopPlusParentGateDepth` 未定义已被更晚 runtime 编译和当前声明消除。自动识别的“未完成”或“未明确”不是失败。
- 2026-09-25 第 6 轮：第 5 轮决策里仍写成打开的取消收尾、基础报告故障、准备失败、自然控制器释放和消息无轮次，改为切片通过。adapter 接线也是切片通过。以上都不是整体通过。本条取代那些“仍然打开”的当前状态，不删除当时的复现记录。
- 2026-09-25 第 6 轮：新的打开缺陷是异常暂停后 pending 被自动启动并强写 running、内部 `main.abort` 接到用户 `stopRunForTab` 导致父停止且其余任务被取消、助手选择器接受实际 run 起点之前的正文。前两项是内存或当前函数探针，后一项是选择器函数复现。真实宿主未执行。同批待修代码不是已修复。不把选择器复现写成真实 CLI 已回放旧决策。
- 2026-09-25 第 6 轮：四个 owner 的写入范围互斥。host 修暂停门禁，runtime 修内部取消和时间窗，预检只准备私有验证环境且尚无结论，计划只改这两份文档。宿主公开 API 和 Tab 契约冻结。预计剩余 3 批：本批缺陷修复及真实验证预检；下一独占构建、必要全量回归和隔离真实冒烟；最后公共事实、生成层审查与归档。预检没有结论时，不把环境写成已被证实不可用。
- 2026-09-25 第 6 轮：adapter、运行时集成测试和夹具已经存在。UI 集成测试的实际文件名是 `src/test/webview/looppluswebviewintegration.test.ts`。第 5 轮使用的 `loopPlusWebviewIntegration.test.ts` 和“仍不存在”只保留为当时记录。
- 2026-09-25 第 6 轮：recall 只写到任务沟通目录，anchor 为空，命中 `mem-afae5cc814`。没有再写仓库 generated 层。既有 tracked `.local` 差异不自行回退，也不重新生成。计划保持 `in-progress`，设计保持 `proposed`，现在不归档，不宣称交付。
- 2026-09-25 第 7 轮：第 6 轮决策里仍写成打开的暂停后启动 pending、内部取消误停父任务、助手正文早于 run 起点，改为切片通过。host 自动暂停退回尚未启动预约，代际门禁拦住旧回调，在途结束只入队且不改回 running，显式继续按原 attempt 启动一次。内部 `cancelInvocation` 不走用户父停止，用户停止仍关闭父门禁。助手正文限定 `max(boundary.startedAt, run.startedAt)` 到 `run.endedAt`，合法预载 user 保留。证据来自当前源码、回归和 AST/VM，不是真实宿主。本条取代那些“仍然打开”的当前状态，不删除当时的复现记录，也不写成整体通过。
- 2026-09-25 第 7 轮：host 32 与 scheduler 23 属于合并 55，不重复相加；runtime 23 覆盖旧 18；两份隔离 `tsc` 退出码 0；计划 84 个引用存在，文档检查退出码 0。第 5 轮 UI 28 与中英文帮助保持切片通过。自动识别的“未明确”不是失败。四份报告无待人工确认。
- 2026-09-25 第 7 轮：预检已有隔离路线，不再写成尚无结论。真实运行仍待本批 `loopplus-final-validation`。它拥有 `dist` 和自己的私有验证目录。本计划不依赖同批报告，不占环境。400ms 结束的 A 不能证明 B 已在途；正常等待不要求额外主模型 `wait`。二者不是已复现产品缺陷。同批结果未经主审，不预写通过或失败。
- 2026-09-25 第 7 轮：预计剩余 2 批，只作文档估计，不改父控制估计。计划保持 `in-progress`，设计保持 `proposed`，现在不归档。下一收尾批按组 A 到组 D 的互斥文件清单派发，先有验证结论，引用更新不能漏。recall 只写到任务沟通目录，focus 为 Loop+ `event_driven` 验收队列、暂停门禁、内部取消和真实宿主，anchor 为空，选中 `mem-7850a1dff0`。ID 变化不是功能变化。既有 tracked `.local` 差异不生成、不回退。
- 2026-09-25 第 8 轮：第 7 轮“真实运行仍待本批”的当前状态被主审取代。构建退出码 0，全量 1168 项中 1162 通过、6 失败，重跑相同 6 条。5 条历史或环境失败保留。提取测试在该轮写入时仍记为当期失败，当时不预写成功。第 9 轮把当前状态改为已接受，不改这里的 1168/1162/6。宿主已激活；帮助、core、control、classic 未执行。环境阻挡不是产品回归。
- 2026-09-25 第 8 轮：准确 `eventId` 的 `completed` 先确认当前项，剩余工作只拒绝整体完成。最后唯一当前项可以合法收口。第 7 轮夹具提前完成 A，不能再 `accept` A 派发 D，并把最后 D 误标非法。下轮拆开正负场景，不修生产。帮助必须真正 assert。Graph 只限定缺点。统一轮次只查 Loop+ 消息。CDP 请求必须有界。3 秒错峰和无需额外 `wait` 保留。A、B、C 为 4.2 秒、7 秒、9 秒。夹具不是真实模型。
- 2026-09-25 第 8 轮：预计剩余 3 批，只作文档估计，不改父控制估计。计划保持 `in-progress`，设计保持 `proposed`，不归档，不升为 active。组 A 到组 D 仍互斥。公共事实只引用已主审结论。`plugin.loop_task` 仍是 classic 整批，最终区分 `event_driven`。归档依赖事实同步和验证收口，不同时抢共享引用。第 8 轮记忆审计只审查来源，不代表上提。tracked `.local` 不生成、不回退。recall 在任务沟通目录的 round-8-recall，focus 为 Loop+ `event_driven` 验收队列最终验证 Webview，anchor 为空，选中 `mem-3624ba969d`。ID 变化不是功能变化。
- 2026-09-25 第 9 轮：第 8 轮提取契约改为当前已接受。AST 约束 extension → adapter → host，隔离 `tsc` 退出码 0，23 项通过、0 失败。生产未改。第 7 轮 1168/1162/6 仍是历史全量，不改成 1163/5。其余 5 条不修。
- 2026-09-25 第 9 轮：真实证据停在启动、加载和 activation 调用，没有 DOM。`_doActivateExtension` 不是 provider 已 resolve。帮助、模式持久化、FIFO、增量派发、停止/继续和 classic 未接受。验证工具仍缺 control、classic、early 驱动，CDP frame/context 定向，以及适合长场景的 extension-tests 帮助路线。下一动作是独占 build、全量和确定性原生命令 bootstrap，不再默认重复键盘或 AX。同批结果不预写。
- 2026-09-25 第 9 轮：准确 `eventId` 的 `completed` 先确认当前项，再拒绝父任务提前结束；最后唯一 D 可合法结束。3 秒错峰和正常等待无需额外 `wait` 保留。14 项生成噪声已确认，有条件清理只写待执行。公共规格、架构与 runtime references、ontology 和归档仍等整体证据收口。计划 `in-progress`，设计 `proposed`。`estimatedRemainingRounds=3` 只是估计。recall 写本项私有证据目录，anchor 为空，选中 `mem-538cb1444d`，不写仓库 `.local`。

## 当前结论

阶段一保持通过。第 4 轮和第 5 轮已记录的切片保持通过。第 6 轮暂停门禁、内部取消隔离和实际 run 时间窗也已切片通过，不再是当前打开缺陷。host 32 与 scheduler 23 属于合并 55，runtime 23 覆盖旧 18，两份隔离 `tsc` 退出码 0。这些计数不能相加，也不能写成整体通过。证据来自当前源码、回归和 AST/VM。第 5 轮 UI 28 与中英文帮助保持切片通过。第 7 轮构建退出码 0，全量 1168 项中 1162 通过、6 失败，重跑相同 6 条，保留为历史，不改成 1163/5。5 条历史或环境失败仍不修。第 8 轮提取契约已接受：AST 约束 extension → adapter → host，隔离 `tsc` 通过，23 项通过、0 失败，不再写仍待修。这不是全量重跑。真实隔离宿主只有启动、加载和 activation 调用，没有 DOM；`_doActivateExtension` 不是 provider 已 resolve。帮助、模式持久化、FIFO、增量派发、停止/继续和 classic 未接受。driver 仍只有 core，CDP 缺少 frame/context 定向，原 extension-tests 未进帮助路线且 20 秒保持不适合长场景。下一动作是独占 build、全量和确定性原生命令 bootstrap。准确 `eventId` 的 `completed` 先确认当前项再拒绝父提前结束，最后 D 可合法结束。3 秒错峰和正常等待无需额外 `wait` 保留。14 项生成噪声已确认，有条件清理只待执行，不预写已还原。原始三点及中英文帮助、Graph 缺点修正仍是产品验收项，除帮助正文外不勾选完成。Loop+ 不能上线。本计划保持 `in-progress`，设计保持 `proposed`，不归档，不升 active。公共规格、架构与 runtime references、ontology 和归档仍等整体证据收口。本轮同批结果不写成已验收。

## 引用核对

下列引用在本次更新时目标存在：

- `.ch/docs/exec-plans/TEMPLATE.md`
- `.ch/docs/exec-plans/README.md`
- `.ch/docs/exec-plans/completed/2026-09/`
- `.ch/docs/design-docs/TEMPLATE.md`
- `.ch/docs/design-docs/loop-plus-scheduling.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/design-docs/loop-debate-multi-agent-mode.md`
- `.ch/docs/design-docs/graph-orchestration-mode.md`
- `.ch/docs/design-docs/index.md`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `.ch/docs/TESTING.md`
- `.ch/docs/MEMORY.md`
- `.ch/docs/memory/`
- `.ch/docs/ontology/README.md`
- `.ch/docs/ontology/`
- `.ch/docs/ontology/domains/cli-plugin-runtime.json`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/generated/memory-index/.local`
- `ARCHITECTURE.md`
- `docs/插件功能清单.md`
- `scripts/check_trailing_whitespace.js`
- `src/cli/types.ts`
- `src/promptRunState.ts`
- `src/workspaceSettingsStore.ts`
- `src/scheduledTaskStore.ts`
- `src/loopParallel.ts`
- `src/loopTaskStore.ts`
- `src/loopPlusScheduler.ts`
- `src/loopPlusDecision.ts`
- `src/shared/writeScope.ts`
- `src/extension.ts`
- `src/extensionHost/promptRunRuntime.ts`
- `src/extensionHost/loopOrchestration.ts`
- `src/extensionHost/loopPlusOrchestration.ts`
- `src/extensionHost/loopPlusPromptBuilders.ts`
- `src/extensionHost/loopPlusRuntimeAdapter.ts`
- `src/extensionHost/modelSettings.ts`
- `src/extensionHost/sessionTabs.ts`
- `src/sessionMessageActions.ts`
- `src/sessionMessageHandlers.ts`
- `src/sessionTabs.ts`
- `src/panelDiagnostics.ts`
- `src/panelStateBuilder.ts`
- `src/loopSubtaskLifecycle.ts`
- `src/loopDebate.ts`
- `src/loopSubtaskExecutionRoot.ts`
- `src/i18n.ts`
- `src/webview/types.ts`
- `src/webview/viewContentHtml.ts`
- `src/webview/viewContentI18n.ts`
- `src/webview/viewContent.ts`
- `src/webview/viewContentScript.ts`
- `src/webview/viewContentScript/coreRuntimeState.ts`
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/webview/viewContentScript/settingsAndOverlays.ts`
- `src/webview/viewContentScript/runStreamAndQueue.ts`
- `src/webview/viewContentScript/messageRendering.ts`
- `src/webview/viewContentScript/modelManager.ts`
- `src/webview/loopDebatePanel.ts`
- `src/webview/loopDebatePanelTypes.ts`
- `src/webview/loopDebatePanelRenderer.ts`
- `src/webview/loopDebatePanelStyles.ts`
- `src/test/loop/loopPlusScheduler.test.ts`
- `src/test/loop/loopPlusDecision.test.ts`
- `src/test/loop/loopPlusContracts.test.ts`
- `src/test/loop/loopPlusPanelState.test.ts`
- `src/test/loop/loopPlusGroupChatPanel.test.ts`
- `src/test/loop/loopDebatePanel.test.ts`
- `src/test/loop/loopPromptQueue.test.ts`
- `src/test/loop/loopSubtaskLifecycle.test.ts`
- `src/test/webview/loopPlusModeHelp.test.ts`
- `src/test/webview/loopPlusModeEntry.test.ts`
- `src/test/webview/looppluswebviewintegration.test.ts`
- `src/test/webview/cliPageStaticRenderCoverage.test.ts`
- `src/test/extensionHost/loopPlusOrchestration.test.ts`
- `src/test/extensionHost/loopPlusEntryRouting.test.ts`
- `src/test/extensionHost/extensionHostExtractionContracts.test.ts`
- `src/test/extensionHost/loopPlusPromptBuilders.test.ts`
- `src/test/extensionHost/loopPlusRuntimeWiring.test.ts`
- `src/test/extensionHost/loopPlusRuntimeIntegration.test.ts`
- `src/test/extensionHost/fixtures/loopPlusRuntimeFixture.ts`
- `src/test/session/sessionMessageActions.test.ts`
- `src/test/session/conversationTabLock.test.ts`
- `src/test/session/loopPlusSessionTabs.test.ts`

已知差异空白，不是断链：`.ch/docs/design-docs/index.md` 还没有 Loop+ 条目。第 5 轮写入时，adapter、运行时集成测试、夹具和 Webview 集成测试还不存在，而且当时把 UI 文件记成 `src/test/webview/loopPlusWebviewIntegration.test.ts`；那只是历史。这些文件现在存在，UI 的实际文件名是 `src/test/webview/looppluswebviewintegration.test.ts`，已经放进上面的清单。功能清单、能力规格、`docs/插件功能清单.md`、运行时设计、架构、参考手册、ontology 和 MEMORY 也还没有 Loop+ 事实。`plugin.loop_task` 与 `plugin.rule.loop_subtask_interruption_isolated` 仍是经典整批语义，最终要区分 `event_driven`，不能只加别名。`.ch/docs/generated/memory-index/.local` 存在且被 git 跟踪，但它是辅助生成层，不是产品事实。第 8 轮确认 14 项是本任务噪声。本轮有条件清理只待执行，不预写已还原，也不等于记忆上提。第 8 轮契约 23 项可以在整体证据收口后引用，但不能单独触发这些文件更新。归档还要等验证收口，不能提前改共享引用。
