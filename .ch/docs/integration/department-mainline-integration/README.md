# Department Mainline Cumulative Integration

This is the review handoff for the local cumulative integration branch. It records source identity and conflict decisions; it does not certify the department feature as complete.

## Base And Delivery

- Worktree: `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-mainline-integration-round676-20261116`
- Branch: `codex/department-mainline-integration-round676-20261116`
- Initial integration mainline: `origin/master` at `e890e36352570b6cda9fc531df06ca2007a09ec6` (round-676 snapshot).
- Candidate source: `a3a0d37a0723791645259c4abebbd6d129d52b79`, tree `87f0009e53b5aebd14f206ebad73993a4b38c492`, sole parent `e0ec605fc0b38ab0a59bb2268faac84efbeb3668`
- Merge base: `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`
- Latest fetched default branch for round 695: `origin/HEAD -> origin/master` at `2cda37b568465c3ace4c5cbe3c953471260496e2`. This attempt's normal fetch succeeded without changing the already refreshed cached ref (pre/post `2cda37b5`); the original round-676 base `e890e363` lacks both later commits, `0c0bb86c` and `2cda37b5`.
- Round-695 mainline merge: `4b47d0a76d36c3bb973c48a74d52825e66a0f8b6`, tree `e54800c7976b40f2e702adb789bc9f388e489f2e`, parents `c40acbfc78c7bdd6bf54d036b07dbdaaac0fe443` and `2cda37b568465c3ace4c5cbe3c953471260496e2`.
- Accepted workspace-capacity source: `40c77d3eb7eabd511ab569cdc25e08e6ed348d5a`, tree `39e191a4482b40f75072ea44463df0f7e7a4da68`, sole parent `ac1b8199d3c164f76c1043bc21bfffc13a0ae60e`.
- Final commit/tree after round-695 integration materials: recorded in the round-695 attempt report.

The integration branch was created from the fetched mainline before merging the candidate. The merge commit parent order is mainline first, candidate second. No source worktree or shared dirty checkout was changed.

## Cumulative Sources

The role-icon source already descends from its accepted allocation, prompt, avatar and prior integration history; those commits were not cherry-picked again. The complete accepted cold-recovery entity at `/tmp/department-cold-mixed-round674-product` was compared against its provable Git baseline `c76b5132d6c0430dfb03f150fb8220010265e32f`. That comparison found 55 tracked source/script/document paths, listed in `sources.json`; the generated `.ch/docs/generated/memory-index/.local` artifact was excluded. This imported the complete dirty cumulative entity, not just its final 12-path patch.

Cold source identity:

- Source closure: `c806bda98c0d408b20db775112ce2c62460084b8f44718e3930485fce11751bd`
- Scripts closure: `d677e1691181020ddca60d3c61071083041e738fa0e204f3a76cce14e6d1ec13`
- Round-674 patch SHA-256: `eda945156e60e6c0aa6351eaae323e785e6eaa62a9552c92024dad99dfcfc55e`
- Round-674 manifest SHA-256 recorded in the handoff: `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`. Round-695 read-only measurement of the existing file is `28a1bc69a4488c46aa24ee4d0a5379c12e07d7714df0e8ad3b0794352c85c412`; these differ. The path identity manifest retains the measured value and `sources.json` retains both. Round-698 reconciliation: the original round-674 report, line 109, records the measured `28a1bc69a4488c46aa24ee4d0a5379c12e07d7714df0e8ad3b0794352c85c412`; the later handoff value was a transcription error. There is no evidence of manifest mutation. The round-695 mismatch observation remains historical; the entity was not recopied or reapplied.
- Provenance: round-443 cold entity copied from round-440, whose cumulative source traces through round-437 to the c76 baseline; see the round-674 attempt report for the original execution manifests and limits.

The original difference is the 55-path c76-to-cold-entity delta. The previously recorded final difference was the e890-to-round-676 tree (453 paths: 343 added, 110 modified, zero deleted). Round 695 adds newer mainline contracts, the accepted workspace overrides, and merge materials; use the current round-695 report for the exact final tree path list. These source comparisons are separate and are not represented as a single patch.

## Conflict Review

There were 13 Git unmerged paths. Each is listed with the merge decision in `semantic-review.md`. The reviewed worktree result was staged as the resolution; no whole-file ours/theirs selection was used. In addition, 55 cold-entity source differences were reviewed as a cumulative import, with disjoint changes retained by three-way merge and overlapping changes checked against current contracts. The round-674 integration needed three minimal fixes found by the new build: closing a production-wiring test callback, restoring access to the mainline effective workspace Loop+ limit, and restoring the task-store migration helper using the current normalization path.

## Reused Evidence And Open Gates

Reused only within the exact source snapshots stated by the round-675 and round-674 reports: round-675 build, final 14 distinct targeted cases (11 unchanged plus 3 rerun after fixture repair), and 1440 dark / 280 light display fixtures; round-674 build, 7 targeted Node cases, ontology validation and 9 ontology tests, plus its limited macOS second-EH and Codex worker-exit runs. The original round-675 two test failures and Tabs timeout remain recorded. Round-674's history limitation on the older guard branch remains. The quota run-1/2 cleanup remains unknown; run-4's full driver failed while its later read-only review passed within narrower evidence bounds.

Round 676 ran one final successful standard `npm run build` after its three fixes; that result applies only to that snapshot. Round 695 fetched and merged later mainline commits plus the accepted workspace-capacity source. Workspace-level optional leader/employee count overrides are now present in the integrated tree. The new combined production source passed standard build; after a capacity test fixture correction, tsc and orchestration tests passed. The other targeted groups, source checks and exact commands/results are in the round-695 report. Necessary Windows/Linux evidence, actual UI-to-EH/CLI composition, remaining cold-recovery acceptance, and final full regression remain open. Build success does not close those gates.

## Round 694: Semantic Merge Repair

This repair continues from round-676 commit `ac1b8199d3c164f76c1043bc21bfffc13a0ae60e` in this worktree and branch. It preserves that merge history and adds a child commit; it does not fetch, recreate the integration, or change the central workspace-count/configuration files owned by the parallel settings task.

The acceptance review identified two concrete omissions that the earlier conflict summary had incorrectly described as preserved:

- In `src/extensionHost/loopGroupChatPanelCoordinator.ts`, the integrated `refresh` returned as soon as `panelsByTaskId` lacked a standalone panel. A director's panel can instead own a valid leader-modal binding without registering an alias under the leader id. The corrected path computes matching subscribers before deciding there is no work, applies `openingPanels` only when a panel exists, and permits the existing scope/root/instance validation and post-await revalidation to update a modal-only subscriber. No alias or authority shortcut was introduced.
- In `src/interactive/codexAppServerPoolCore.ts`, extraction into the active pool core omitted mainline commit `f1e15cee57ed5e93492a0b6fbb6ac8693fd64b2a`'s notification rule. The incorrect result let `singleActiveListener()` claim and receive an explicit unknown `threadId`. The corrected core keeps known-owner and known-parent child routing, buffers an unknown explicit thread id within the existing bound, and leaves start/resume response confirmation responsible for ownership and replay. The no-thread and owned-execution exclusive-owner paths are unchanged.

The first acceptance probe of the modal-only load/action/refresh case did not reach its assertion: the fake Webview never emitted the newer `loadingReady` handshake. This was a fixture protocol mismatch, not a pass or a production timeout fix. Round 694 adapts the fake Webview to emit `loadingReady` and a DOM-ready generation after page installation, uses bounded open waits, and retains the load, action, no-alias, refresh/content-patch, close and stale-instance assertions. The browser smoke similarly responds to the real loading handshake while leaving DOM-ready to the rendered page.

The round-694 handoff recorded the round-674 manifest as SHA-256 `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`; the differing round-695 file measurement is recorded above. Round 698 checked the original round-674 report line 109 and confirmed that the round-694 value was a later transcription error, not the original source identity. All original 55 cumulative paths remain listed. Round-676's build and interrupted probe, round-694 repair results, and the round-694 workspace feature results retain their original snapshot boundaries. Round-695 sources, semantic decisions, and open gates are recorded in `semantic-review.md` and `sources.json`. Real UI-to-EH/CLI behavior, final full regression, required platform evidence, and combined capacity/cold-recovery acceptance remain open.

## Round 698: Official Full Regression (Failed)

Input was accepted commit `464d1113f13b1bc0f2b59ea1ba4c09976ebed713`, tree `cb6ef3649b90ed1a7dbe3b9ea78a83c503f63bd4`. Reused its standard build/final fixture tsc after checking the existing output: 838 TS inputs had outputs/current source maps and no newer source, 1674 dist files; recorded dist SHA-256 `957a64ba83397d9b3c6ee3675863274698c5a178554d66f81b31f7485d7b1563`. This is consistency evidence, not a match against an archived prior build manifest.

Official discovery `node scripts/run_unit_tests.js --list` found 397 compiled test files. One `node scripts/run_unit_tests.js` run exited **1**: **5439 tests, 5265 passed, 165 failed, 6 cancelled, 3 skipped**, 215.475 seconds. The full log remains `/tmp/round698-unit-first.log`; its hash, full discovered list and all 171 named failed/cancelled entries are retained in [round698-full-regression.json](round698-full-regression.json). The suggested session core and Loop+ webview integration files were included and had no reported failure; they were not modified merely to match the suggested scope.

Six owned-execution tests timed out at their existing 10-second deadlines while expecting unconfirmed-thread delivery. After output was idle for over 60 seconds, only the six validated test descendants were SIGTERM'ed; the exact failed file process was then terminated to release its leaked watchers. The official runner itself was allowed to finish. This was controlled test reclamation, not natural cleanup or behavior success; cancellations remain failures. No unknown historical worker was touched. Three DSH live/environment-gated cases remain skipped.

Seven test-local fixtures/assertions were repaired without changing production code: real admission/preparer dependencies and AbortController for ordinary prompt health; prompt submission wait helper for group-chat button; department projection/classList.contains for tooltip; generated-runtime constants for notification authorization; actual select.options and exact four accepted modes for OpenCode/Loop+ mode tests. No production wait, authorization, owner/receipt/CLOSED assertion, UI style or behavior was relaxed. Four tsc executions passed at the successive fixture inputs. Final valid distinct coverage is **121 cases across seven files**: unchanged 69 prompt + 4 button cases from the second retest, 28 tooltip/notification cases from the final retest, and 20 mode cases. The intermediate missing-AbortController failure/incomplete run and later 92/94 run remain recorded.

Of the first run's 171 failed/cancelled entries, 105 are covered by those passing file retests; **60 failed and 6 cancelled entries in 24 files remain unresolved**. These are reconciled first-run counts, not a second full-suite result. Central store/error-propagation and pause/mode-revocation concerns need one coordinated repair owner; capacity/cold/owner failures are handed to the respective parallel owners/main review. Other extraction, lifecycle, platform mock and missing-lockfile failures retain individual provisional classifications in the JSON. No baseline comparison establishes them as historical. A second whole-suite run of unchanged unresolved inputs would add no missing coverage, so it was not used to refresh evidence; only affected files were recompiled/retested. Production repairs must revalidate their affected callers and the final official full run remains a gate.

Manifest reconciliation is closed as a transcription issue: original round-674 report line 109 contains `28a1bc69a4488c46aa24ee4d0a5379c12e07d7714df0e8ad3b0794352c85c412`, matching the round-695 measurement. The later `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412` value remains historical erroneous handoff evidence. Original 55 paths/closure records and all earlier failures remain; no old entity was rehashed/imported or external report changed.

This successor changes tests and review materials only, so ontology data, feature inventory and business plans are unchanged. No new product behavior or authorization is claimed. Real UI-EH/CLI, capacity/cold composition, necessary native platform evidence and original-directory final switch/clean handoff remain open. The exact successor commit/tree/parent and clean status are in the round-698 attempt report; do not treat commit 464's earlier full-regression gate as closed.

## Round 704：通用夹具修复与已接受额度来源合入

从 `c5395f834c6892dea743e513aa860f6f35f03226` 续接，完整 merge 已接受额度三提交 `ab99922e7fbda0669f22a4adbffeb28ffec21bfc` → `b992d3b668c495f398fa20d4620166733a0bf86b` → `b02cfe1a34c427937efd625735cf267bc67ac711`，merge `2f6caca23a6389da016905fe1cf238b78bbe44db`，无冲突。七路径与 b02 逐文件相同，未改产品运行逻辑；复用其19项及真实工作区2/6→额度3/0/3、原4份receipt/精确CLOSED/容量归还和4 worker自然退出的已接受范围。不是只拿最终runbook，也没有合入未正式接受的lp701/lp702。

九个普通测试文件修复：loopPlusEntryRouting以TypeScript AST取函数；promptExecutionShared保留展开executionOptions与部门附加参数；continueModelChoice精确定位classic创建边界的createTask回调/createdTask，断言路由和origin持久化先于该任务transcript；loopPromptQueue验证scope/历史标志和运行Loop排队、busy非Loop冲突、普通派发及pause发送保留草稿；OpenCode CSS按完整同选择器聚合并顺序覆盖属性，保留主题/布局断言，拒绝把部门/Loop+带父选择器规则误作普通规则；panelViewLocation仅可选核对ignored/untracked锁文件，其余manifest注册/引擎/中文/icon断言不变；commandRunnerCoverage每平台创建自己的controller并恢复mock，非原生Windows证据；OpenCode serve及role-model用例等待真实process/stdio lifecycle、temp confirmed后检查overlay；contextCompactionRunner保留真实manager/cwd/fingerprint/trust及配置隔离，补VS Code mock的inspect。单case诊断实际异常为 `config.inspect is not a function`，不是生产身份算法失败。

必要编译三次tsc均exit0。九文件首次定向195项193过2失败（CSS suffix和第二overlay同类等待缺口），修复两文件后只复测75/75；其余七文件120项仍有效，最终九文件195个不同case通过。两次单case诊断均exit1，原false和随后捕获异常均保留。精确命令/日志SHA/九输入base及result SHA在 `round698-full-regression.json` 的 `round704Followup`。末次编译后只改文档/证据，不使测试失效；生产源码没有变化。复用有效build、旧七文件121项与额度19项，不重复browser/EH/全量。

round698官方首次仍是5439项、5265过/165失败/6取消/3跳过、exit1，强制回收自有fake worker的事实不变。本轮覆盖其10个原失败，剩余50失败、6取消/15文件只是对账，不是新官方运行或全量通过。store/cold/capacity各有唯一所有者；lp701发送/lp702传输虽done，尚未正式接受/合入。groupChatHost两项原失败也保留待组合判断，不因额度实机成功就标解决。统一生产修复正式合入后才安排最终官方全量。

55路径冷累计来源、manifest原始round674第109行正确SHA `28a1bc69a4488c46aa24ee4d0a5379c12e07d7714df0e8ad3b0794352c85c412` 及后继错误 `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`、round695测量及历史失败全部保留。未重做导入/来源审计。最终commit/tree见round704报告；真实混合冷恢复/遗留authority、必要原生Linux/Windows、最终原打开目录分类保护/切换分支/clean仍开放。原master脏树和其它来源未写入，不提前归档根feature。
