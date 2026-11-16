# Semantic Review

The merge was performed on a branch created from refreshed `origin/master`. The working result preserves both the mainline contracts and accepted department implementation. All 13 Git conflict paths were reviewed and then staged as resolutions.

| Conflict path | Resolution and contract retained |
| --- | --- |
| `.ch/docs/product-specs/FEATURE_INVENTORY.md` | Kept current mainline/department facts and historic outcomes; added round-676 integration boundary and the still-pending workspace-count override. |
| `src/extension.ts` | Kept mainline event, attempt, session/configuration and effective-setting paths; kept department composition, cold generation recovery, first-generation environment snapshot and awaited retirement wiring. Restored the effective Loop+ workspace setting accessor after build found its destructuring gap. |
| `src/extensionHost/loopGroupChatPanelCoordinator.ts` | Preserved ordinary task read and mainline continuation/session constraints while retaining department-aware task identity, capacity, allocation and organization controls. |
| `src/extensionHost/loopPlusDecisionStrategies.ts` | Preserved the mainline decision contracts and explicit department decision route without allowing role/icon projection to grant authority. |
| `src/extensionHost/loopPlusOrchestration.ts` | Retained frozen acceptance-batch/event/attempt state, stop and retry rules, and mainline settlement; retained department leader-only route, per-round Ledger admission, immutable attempt identity, and collaboration delivery gates. |
| `src/interactive/codexAppServerPool.ts` | Kept both pool lifecycle and cancellation/release changes. No cleanup or run completion was inferred from a missing endpoint or a pool callback. |
| `src/loopTaskStore.ts` | Preserved mainline history retention, strict migration reads and task store identity behavior together with department metadata, authority routing and controlled source identity. Restored the migration helper through `normalizeLoopTaskStoreForStorage`, retaining the shared retention and department normalization path. |
| `src/sessionMessageActions.ts` | Retained department configuration scope/identity routing and mainline request identifiers, prompt result settlement and session conflict behavior. |
| `src/test/core/workspaceSettingsStore.test.ts` | Kept global and workspace effective-limit tests plus department configuration shape/invalid-input tests. |
| `src/test/loop/loopTaskStore.test.ts` | Kept mainline migration/retention/event snapshot coverage and department metadata/controlled-source assertions. |
| `src/webview/loopGroupChatPanel.ts` | Kept CSP nonce, exact director-only department modal targeting, original tab label and task identity checks alongside mainline loading-ready and prompt lifecycle handling. |
| `src/webview/types.ts` | Unioned department configuration fields with mainline request ID/workspace limit fields; no field was used as a permission shortcut. |
| `src/webview/viewContentScript/windowMessageDispatch.ts` | Kept department configuration updates and mainline prompt settlement dispatch in the same listener. |

The imported cold entity has 55 path differences from c76. It was compared by path and source contents, not applied as a final-only patch. Changes already represented by the candidate ancestry were not duplicated. The three-way result was checked at overlap points for mainline session/configuration/event contracts and department ownership/admission contracts. The `.local` generated memory artifact was excluded. Full paths and source closure identities are in `sources.json`.

The round-676 build found three source-integrity defects in the combined input: one missing test callback close in `departmentproductionwiring.test.ts`, one missing import binding for `getEffectiveLoopPlusDecisionSubtaskMax`, and the missing task store migration helper. Those narrow repairs have compile/build evidence from round 676 but no behavior-test evidence from that attempt.

## Round 694 Acceptance Corrections

The table above records the round-676 merge-time reasoning; it did not prove every runtime contract survived. The acceptance review found these two semantic omissions in the actual result.

| Contract | Round-676 integrated result and evidence | Corrected result |
| --- | --- | --- |
| Modal-only leader refresh | `refresh` returned immediately on missing `panelsByTaskId.get(leaderId)`, before enumerating valid director-modal `bindings`. `refreshOpenPanelForTask` correctly recognized the binding, but the invoked refresh dropped it. The acceptance probe selected `department host loads in-page leader and routes actions, ask thread, preview and refresh without panel alias`; it waited at `coordinator.open()` because the old fake panel never emitted `loopGroupChatChat:loadingReady`. It was stopped after about 56 seconds with exit 1 and 0 assertions passed. This established a fixture mismatch only; refresh behavior was not reached. | `refresh` now keeps `panel` optional, retains `openingPanels` protection for an existing panel, computes current subscribers, and exits only when both panel and subscribers are absent. Modal state is still updated only after current-scope, current-record, binding identity, root and instance checks, including validation after awaits. No leader-id alias is registered. Retained behavior assertions cover contentPatch and close/stale-instance rejection once the handshake fixture is made protocol-compatible. |
| Unknown explicit Codex thread notification | The round-676 integrated `routeNotification` retained the pre-extraction core fallback: `singleActiveListener()` claimed and delivered any explicit unknown `threadId` when exactly one listener was active. The contract source is mainline `f1e15cee57ed5e93492a0b6fbb6ac8693fd64b2a`, which removed that fallback in `src/interactive/codexAppServerPool.ts`; the extraction to `codexAppServerPoolCore.ts` had not carried it over. | The active core no longer treats a sole active listener as evidence for an explicit thread id. Unknown ids remain in the existing bounded buffer until a confirmed `thread/start` or `thread/resume` response or a known parent establishes ownership. Known-owner routing, parent-child routing, exclusive owned-execution no-thread routing, operation generations, source/sequence metadata, owned failure accounting and cleanup logic are unchanged. Regression assertions cover both shared and new connection variants, pre-response buffering/replay, and affected owned-execution paths. |

The round-694 code, test and browser-smoke path identities are appended to `sources.json`. Its build and test results belong only to the resulting child commit, and do not retroactively alter the round-676 build record or the interrupted probe. Security review for this repair was defensive source review plus fake-transport regression; no exploit or intrusion scan was performed.

## Round 695 Mainline And Workspace Integration

Normal fetch of configured `origin` succeeded, confirming the cached ref already at `2cda37b568465c3ace4c5cbe3c953471260496e2` (pre/post unchanged); `origin/HEAD` resolves to `origin/master`. Relative to round-676's `e890e36352570b6cda9fc531df06ca2007a09ec6`, the intervening commits are `0c0bb86ce552c5f125bcac0de64ce86161064ea2` (optional per-attempt acceptance, report queue, pause-before-send) and `2cda37b568465c3ace4c5cbe3c953471260496e2` (main activity projection). Mainline was merged as `4b47d0a76d36c3bb973c48a74d52825e66a0f8b6`, with c40 first parent and refreshed master second parent. Accepted workspace source `40c77d3eb7eabd511ab569cdc25e08e6ed348d5a` was then merged as `b7524181b4b96f68d2fd51ebc9a7c2685e4f6a86` (tree `a5f13bf10b1d2cac226bf61339ee910cad2cdf23`). No source worktree was modified.

| Overlap | Resolution and preserved behavior |
| --- | --- |
| `src/extension.ts` and `src/extensionHost/promptRunHandoff.ts` | Kept department admission/preparation and its `finally` rejection of unstarted resources around the mainline per-tab handoff. Main-task and normal tab prompts use the request-ID handoff; department configuration is prepared before the actual prompt send. |
| `src/interactive/codexAppServerPool.ts`, `src/interactive/codexAppServerPoolCore.ts`, `src/interactive/codexRunner.ts`, `src/interactive/codexRunnerCore.ts` | Pause changes were made in pre-extraction monoliths while this branch runs extracted cores. Kept runtime-injection wrappers and ported `releaseStoppedThread` plus `waitForStopped` into the active core. Stop waits for operation tail and interrupt completion, checks current tab/request scope during native release, and uses the same home-scope thread lease, active-owner check, and native `thread/unsubscribe`/`notLoaded` evidence. It adds no second pool state and does not convert thread unload into department receipt/CLOSED evidence. Existing owned-execution and shared-pool guards remain in the active core. |
| `src/extensionHost/loopPlusOrchestration.ts`, `src/loopPlusDecision.ts` | Combined exact frozen report ID validation/queueing with department collaboration validation and leader-only routing. Reports are captured in the prompt step and decision IDs must match it; collaboration remains a wait-only action rejected during an active review batch. Department employee-capacity context remains in the prompt. |
| `src/extensionHost/loopPlusRuntimeAdapter.ts`, coordinator and panel projection | Preserved the department leader abort signal and main-activity callback, while deriving busy state and projecting department task/root state together. Activity display does not grant modal access; modal-only refresh authorization and loading guards remain in the coordinator. |
| `src/test/loop/loopTaskStore.test.ts`, runtime fixture, webview scripts | Kept department malformed-metadata persistence tests and the mainline per-attempt acceptance persistence test. Fixture carries main-activity notifications. Pause-ready handling and department configuration scope messages coexist; send includes both `pauseBeforeSend` and scoped configuration. |
| Extracted `codexAppServerPool.ts` / `codexRunner.ts` adapters | These remain small wrappers over the invoked `*Core` classes with captured runtime ports. The fetched monolithic bodies were not retained as a second implementation; relevant stopped-thread behavior was migrated into active core classes. |

The 40c source is a sibling of c40 at common base `ac1b8199d3c164f76c1043bc21bfffc13a0ae60e`, not an old patch to replay. Its 24-path change is integrated as a merge commit. Workspace values remain per-item optional overrides over valid global values; empty clears only that item, invalid reads inherit, invalid writes reject, and the production resolver uses effective values. The UI and atomic store update behavior are retained.

The refreshed mainline produced eleven text-conflict code/test paths in the first-parent merge; these are part of 32 overlapping paths, not the total overlap count. All unmerged hunks were manually resolved by combining both contracts; the merge index then had zero unmerged paths and `git diff --cached --check` passed. Exact source paths and hashes are in `sources.json`. No whole-file side selection was used for conflicting product files. The wrapper-only result in the two extracted adapters follows their active imports/runtime constructors; implementation behavior lives in the core modules.

The first combined targeted run found a pre-existing fixture mismatch: the orchestration capacity test provided global totals without `leaderAllocation` but asserted group-specific emergency admission text. Both c40 and the combined builder only emit that text for a validated allocation. The fixture now provides revision/source/desired/applied/active/available/pending fields and updates occupancy/balance together. Production capacity policy and assertions were not weakened. The complete orchestration file passed 137/137 after tsc; the standard build predates this test-only edit and remains valid for the unchanged production source. All commands and rerun boundaries are recorded in the round-695 report.


### Automatically merged overlaps and evidence scope

`round695-path-identities.json` names all 32 mainline-overlap and 5 workspace-overlap paths and records each available source blob/SHA-256 plus result SHA-256. The 11 text-conflict paths are separate from automatically merged overlaps. Its per-path `overlapResolution` records the merge basis, including adapter/core migration; content identity is not behavior acceptance. Additional automatically merged areas were reviewed as follows:

| Paths | Merge basis and limit |
| --- | --- |
| `loopPlusDecisionStrategies.ts`, `loopPlusPromptBuilders.ts`, `loopTaskStore.ts` | Report acknowledgement and finish gating coexist with department collaboration parsing, capacity/allocation prompt context and metadata normalization. Frozen report acknowledgement is distinct from review acknowledgement; optional acceptance is per attempt. Parser/store/prompt and prescribed strategy/orchestration checks cover the combination. |
| `promptRunState.ts`, `sessionMessageActions.ts`, `sessionMessageHandlers.ts` | New no-acceptance completion text and pause/request APIs coexist with department target/configuration scope. Pause failure retains input; unknown/changed targets reject. Handoff tests cover waiting/identity paths; real UI-to-EH remains open. |
| `loopGroupChatPanel.ts`, `loopGroupChatPanelRenderer.ts`, `loopGroupChatPanelTypes.ts`, `types.ts` | Existing department modal shell/roles/authorization retained; report disposition and no-acceptance label use the existing inactive style. Busy projection uses actual main activity. Workspace-prefixed settings and pause request fields are separate. Activity/modal tests and generated-runtime tests cover selected behavior, not a browser acceptance rerun. |
| `settingsAndOverlays.ts` | Workspace capacity cards/save scope and pause controls remain independent message flows. Its workspace merge is disjoint from the pause additions. Generated-runtime tests cover scope/request rejection and failure restoration. |
| `loopPlusOrchestration.test.ts`, `loopPlusPromptBuilders.test.ts`, `loopPlusRuntimeIntegration.test.ts`, `codexThreadHandoff.test.ts`, `loopGroupChatPanel.test.ts`, `loopTaskStore.test.ts`, `clipagescriptruntimecoverage.test.ts` | Retain both sides' assertions; execute the prescribed files and selected new activity cases. The only fixture correction supplies allocation metadata already required by the production prompt; no assertion is removed. |
| `sessionMessageActionsCoreCoverage.test.ts`, `looppluswebviewintegration.test.ts` | Retain mainline pause/message and existing department-related assertions through disjoint hunk merge. These two full files were not rerun; focused handoff/generated runtime checks do not claim their full coverage. |
| `cli-plugin-runtime.json`, `FEATURE_INVENTORY.md` | Keep mainline optional acceptance/pause/activity facts and department/workspace configuration facts together. Ontology structure validation and 9 tool tests pass. Historical unresolved gates are retained; neither source's completed feature description closes department acceptance. |

Round-695 measured `/tmp/round674-delivery-manifest.json` as SHA-256 `28a1bc69a4488c46aa24ee4d0a5379c12e07d7714df0e8ad3b0794352c85c412`, differing from the supplied/historical `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`. Both are retained explicitly. Round-698 reconciliation reads the original round-674 report line 109: its SHA is the round-695 measured value. The later handoff is a transcription error; no source mutation is supported by the evidence. All 55 entity source files exist and their individual source/result hashes are recorded. This is not evidence that the handoff hash matched or that the entire old execution closure was rerun.

## Round 698: Full Regression Findings

Round-695 merge-time explanations above are scoped reasoning, not proof that all shared callers still work. Official `node scripts/run_unit_tests.js` on accepted `464d1113` exited 1: 5439 tests, 5265 pass, 165 fail, 6 cancel, 3 skip. See [README](README.md#round-698-official-full-regression-failed) and [all named findings](round698-full-regression.json) for discovery, logs, classifications, cleanup intervention and exact retests.

| Repaired input | Cause and retained boundary |
| --- | --- |
| `promptSessionHealth.test.ts` | Extracted caller now needs actual admission/preparer declarations and VM AbortController. Real ordinary-metadata early exit runs; production admission is not mocked away. |
| `loopmaingroupchatbutton.test.ts` | `updateRunWait` also calls `syncPromptSubmissionWait`; include its real source. |
| `conversationtabsummarytooltip.test.ts` | Renderer needs actual department projection helper and `classList.contains`. Existing tooltip assertions stay. |
| `notificationAuthorization.test.ts` | Raw template contains department placeholders. Use generated runtime with actual constants and strings, then extract the same authorization/settings functions. |
| `opencodeloopmodewebview.test.ts`, `loopPlusModeEntry.test.ts`, `loopPlusModeHelp.test.ts` | Select doubles need actual `options`; modes are exactly coding/loop/loop_plus/department, rather than the older three. Classic/Loop+ summary tests include the real department helper. All original role/model/help assertions remain. |

Final distinct passing retests cover 121 cases in these seven files, reconciling 105 of the original failed entries. Intermediate missing-AbortController/incomplete run and subsequent 92/94 run remain failures. There was no production edit; final tsc includes all fixture changes. The official full result is not replaced by arithmetic or targeted passes.

The unresolved first-run 60 failed/6 cancelled entries expose limits of earlier broad preservation claims. In particular, `loopTaskStorePersistence` and handoff cases lose strict read/write errors: integrated `readLoopTaskStoreResult(..., true)` can return null where mainline throws, and boolean writes hide original errno. A central repair must preserve both strict persistence contracts and department identity/catalog authority. A session action can also reach dispatch after a mode is disabled across `postPanelState`; this needs the authorized send boundary rechecked. These are handed to one central repair owner/main review, not described as historical without baseline evidence. Six owned-execution cancellations conflict with confirmed-ownership buffering: update fake handshake expectations, never restore unknown-thread claiming. Parallel capacity/cold/native-owner failures retain exact evidence and exclusive ownership boundaries.

No business rule, UI design, ontology data or feature inventory changed in round 698. Its production source is still the accepted 464 input. The final official green run, real composition, platform conditions and directory handoff remain open. Manifest provenance is separately reconciled to original round-674 line 109; the erroneous later hash remains recorded above and in `sources.json`.

## Round 704：通用夹具修复与已接受额度来源合入

从 `c5395f834c6892dea743e513aa860f6f35f03226` 续接，完整 merge 已接受额度三提交 `ab99922e7fbda0669f22a4adbffeb28ffec21bfc` → `b992d3b668c495f398fa20d4620166733a0bf86b` → `b02cfe1a34c427937efd625735cf267bc67ac711`，merge `2f6caca23a6389da016905fe1cf238b78bbe44db`，无冲突。七路径与 b02 逐文件相同，未改产品运行逻辑；复用其19项及真实工作区2/6→额度3/0/3、原4份receipt/精确CLOSED/容量归还和4 worker自然退出的已接受范围。不是只拿最终runbook，也没有合入未正式接受的lp701/lp702。

九个普通测试文件修复：loopPlusEntryRouting以TypeScript AST取函数；promptExecutionShared保留展开executionOptions与部门附加参数；continueModelChoice精确定位classic创建边界的createTask回调/createdTask，断言路由和origin持久化先于该任务transcript；loopPromptQueue验证scope/历史标志和运行Loop排队、busy非Loop冲突、普通派发及pause发送保留草稿；OpenCode CSS按完整同选择器聚合并顺序覆盖属性，保留主题/布局断言，拒绝把部门/Loop+带父选择器规则误作普通规则；panelViewLocation仅可选核对ignored/untracked锁文件，其余manifest注册/引擎/中文/icon断言不变；commandRunnerCoverage每平台创建自己的controller并恢复mock，非原生Windows证据；OpenCode serve及role-model用例等待真实process/stdio lifecycle、temp confirmed后检查overlay；contextCompactionRunner保留真实manager/cwd/fingerprint/trust及配置隔离，补VS Code mock的inspect。单case诊断实际异常为 `config.inspect is not a function`，不是生产身份算法失败。

必要编译三次tsc均exit0。九文件首次定向195项193过2失败（CSS suffix和第二overlay同类等待缺口），修复两文件后只复测75/75；其余七文件120项仍有效，最终九文件195个不同case通过。两次单case诊断均exit1，原false和随后捕获异常均保留。精确命令/日志SHA/九输入base及result SHA在 `round698-full-regression.json` 的 `round704Followup`。末次编译后只改文档/证据，不使测试失效；生产源码没有变化。复用有效build、旧七文件121项与额度19项，不重复browser/EH/全量。

round698官方首次仍是5439项、5265过/165失败/6取消/3跳过、exit1，强制回收自有fake worker的事实不变。本轮覆盖其10个原失败，剩余50失败、6取消/15文件只是对账，不是新官方运行或全量通过。store/cold/capacity各有唯一所有者；lp701发送/lp702传输虽done，尚未正式接受/合入。groupChatHost两项原失败也保留待组合判断，不因额度实机成功就标解决。统一生产修复正式合入后才安排最终官方全量。

55路径冷累计来源、manifest原始round674第109行正确SHA `28a1bc69a4488c46aa24ee4d0a5379c12e07d7714df0e8ad3b0794352c85c412` 及后继错误 `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`、round695测量及历史失败全部保留。未重做导入/来源审计。最终commit/tree见round704报告；真实混合冷恢复/遗留authority、必要原生Linux/Windows、最终原打开目录分类保护/切换分支/clean仍开放。原master脏树和其它来源未写入，不提前归档根feature。


## Round 706：接受来源的 disjoint merge 与回执边界

本轮四次 merge 的来源/基线/parent/result blob身份见 `sources.json#round706AcceptedRepairIntegration`。send、transport以c539为共同基线；cold链以464为基线；capacity以已在整合祖先链的b02为基线。相对这些共同基线，两侧变更路径集合交集为空，顺序合入也无互相覆盖；无自动重叠合并、无实际冲突、无整段ours/theirs选择。已有额度三提交及旧七/九夹具均保持祖先历史与字节。cold的1c1c文档、fa6e实现和a90文档均在祖先链，未只合最后文档。15/16导入路径与各接受来源相同，groupChat仅下述本地测试更改。

- 发送源码保留最后await后、消息预载/runner前的当前设置授权；Loop+非阻塞投影与真实续接豁免仍是e161原输入。新冷控制不改此文件。
- cold可信只读组织投影核验root/workspace/taskStore/metadata，未知容量保持stop、完整stop前continue禁用，请求token隔离迟到成功。与已接受modal-only刷新/loading保护在不同位置，整份coordinator与a90源码相同，额度authorize/current/requestId去重/CAS也未更改。
- transport未知明确thread不构成凭证；fake reader barrier、raw确认与有界原生清理为dc4e原文件，没有把测试回调恢复为所有权证据。
- capacity原15项与f210文件相同，共享productionWiring/treeControl/SIMULATED_LEADER_CLI未在本任务修改。后继如改共享fake，需自行声明具体失效消费者。

群聊旧首错已由原官方JSON和cold88项记录确认，未先重跑：非法请求case对undefined做字符串断言；member撤销case全部post数1而预期0。生产`updateDepartmentEmployeeLimit`先authorize，再去重/服务/DTO/CAS，await后`current()`重验token、panel、成员和workspace，确认持久返回后才安装投影和回执。旧测试把HTML握手的askThread/contentPatch混入目标回执。修正为四字段精确匹配、唯一拒绝回执、每次非法请求零写入；撤销场景确认原writer实际启动一次、确认前无回执，身份变更及原调用结束后也无回执/重试。iframe断言关注额度能力而非无关patch。原有效0/reset/错误、重复请求和revision竞态测试均保持并在本轮30项通过，错误回复没有一律改成忽略。

新标准build及群聊全文件30/30覆盖此组合和本地TS输入；ontology validate覆盖合入数据结构。没有新的产品改写、视觉设计或授权策略变更，故无新增FEATURE_INVENTORY/现行计划事实。合入的冷设计/ontology更新保留其已审来源。未复跑原195/121/19及各来源有效检查、浏览器或真实CLI/EH，亦未以编译证明真实生命周期。

所有此前失败、manifest勘误和清理限制保留。当前已接受的cold混合五worker和旧根公开stop只证明其原输入；capacity12条after强制回收及round698六取消回收仍非自然成功。store74be仍未接受，cold共享夹具后继尚未整合，不能声称官方全量已过或把其done状态当接受。最终全量应在后继正式接受并实际合入后针对真实统一输入执行。

## Round 708：cold lifecycle accepted source integration

Accepted source `6879fc01ecc440a17b40f5bc50ae47ebe825a58d` is based on already-integrated cold-chain tip `a90b6c9eb498643a6a65a2dc9a23ce4bc032a91d`; all three cold ancestor commits remain in the merge ancestry. Its six actual changed paths are tests/fixtures only. Merge base with the current integration was `a90b6c9eb498643a6a65a2dc9a23ce4bc032a91d`; paths changed by the source do not intersect changes made on the integration side after that base. `git merge --no-ff` produced merge `60908f513dc979982893e2d94853c3a4174a614e` without unmerged paths or a textual conflict. No `ours`/`theirs` selection or manual contract rewrite was needed.

The accepted assertions retain real `t.mock`, bind-to-prior-turn accounting, one initial persist/build, actual consumer gating and drain, a valid coding task, `adapter.waitForTaskIdle`, original receipt/CLOSED/capacity-return/unique-successor checks. Group-chat exact receipt matching and invalid-request/CAS/late-reply protections remain from round706. Three forced fixture hygiene reclaims remain separate from natural `exit(0, null)` observations. The old OpenCode first-throw tracing limit is preserved.

Reused source-scoped evidence from the round706 cold report: final `tsc -p tsconfig.json` passed, all five affected compiled test files passed 60/60, and 794 non-test build artifacts matched byte-for-byte. Since this merge adds precisely those accepted six files unchanged and no production or shared helper changes, these results still cover the merged paths; no build/test rerun was needed solely for the merge commit. The original 5439-case official run remains failed. Store successor `94267bb3f4343c9ccee0f9f75e99c6a2f492df50` / `74be413f` remains unaccepted and unmerged; ordinaryMoves/handoff semantics remain open.
## Round 711：接受的严格存储来源、事实文档与统一回归

当前整合输入从已接受Round710 `0ee355624f7f878b60208726c1b7c5d788bb0f0a` 续接。`94267bb3f4343c9ccee0f9f75e99c6a2f492df50` 的完整历史包含 `74be413fbd1d67ae9ae59246bac92e409a85282f`，以独立 `--no-ff` merge `5bc951463b609072d1990c3787d90aa5a22ab8ad` 合入；随后独立合入接受文档 `2999a3b0589eaab2f52b355e41487cc44a2331c6`，merge `30627ab9eb86b3a484737e92161f517e8f3b5f13`。双方均为 `ort`、无冲突；九个存储实现/测试路径与两条事实文档路径分离，未发生需要人工择边的重叠自动合并。来源blob、SHA256与结果身份保存在 `sources.json#round711AcceptedStoreUnifiedIntegration`。

逐项合同按接受源码和lp709已接受文档核对：普通严格write/update/append保留原异常/errno及缺失任务null/no-op；普通迁移以目标持久化和catalog发布为commit，之后源维护失败不撤销权威；可选`ordinaryMoves`记录精确目标及旧源并兼容旧snapshot；known reader仅遵从精确目标/已知源，未知不回退；retention按单文件在同gate/当前catalog完整校验分类和提交，未知整文件保留；这些普通合同不提升owned，多文件未确认仍`ready=false`并保留marker/tombstone/受控根/显式恢复边界。Handoff仍只repair关联A、active B保持独立，不重复验收或消费消息。Round708 README继续引用JSON实际字段`changedPaths`；历史合法`sourcePathIdentities`字段未全局替换。

实际统一代码输入是 `30627ab9eb86b3a484737e92161f517e8f3b5f13` / tree `f342fe88dd76ca4ddb1e1e60331a2af2fb0c048d`。新标准build通过；官方runner对397编译测试文件发现5462项，5454 pass、3 fail、2 cancelled、3 skipped，exit1。此数不是先前Round698结果的覆盖或修订。具体三失败是department group host owner变更场景多一条post、loopTaskStore旧迁移场景未发现目标store、以及紧随其后的unsafe-root用例前置路径因前例残留而不成立；前者归因未确定，存储成功场景需生产根因诊断，第二存储断言属同文件后续受污染证据。两个10秒超时为 `departmentcodexexecutionlauncher.test.js` 的resume/raw session和Owner callback-failure；测试文件之后无子worker、无tmp fixture、无日志进展地挂起约12分钟。为取得runner汇总，只终止本轮唯一持有的该文件PID 74508；因此官方全量明确含受控中断，不能视作完整通过。失败名称和log SHA见机器材料。

没有将其他接受来源的证据扩展到最终全量。round707标准build及110项、round708 cold五文件60项/794非test artifact、round709 ontology 9项和本轮此前已接受的各分组结果仍只覆盖原输入。没有修改product behavior、UI、主题/交互或authority。后续由主审按具体独立所有者分配failures，必要的源码/fixture修复后再对实际统一输入完成全量；本轮不重复运行全量。
