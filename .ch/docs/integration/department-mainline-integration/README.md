# Department Mainline Cumulative Integration

This is the review handoff for the local cumulative integration branch. It records source identity and conflict decisions; it does not certify the department feature as complete.

## Base And Delivery

- Worktree: `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-mainline-integration-round676-20261116`
- Branch: `codex/department-mainline-integration-round676-20261116`
- Fetched default branch: `origin/master` at `e890e36352570b6cda9fc531df06ca2007a09ec6`
- Candidate source: `a3a0d37a0723791645259c4abebbd6d129d52b79`, tree `87f0009e53b5aebd14f206ebad73993a4b38c492`, sole parent `e0ec605fc0b38ab0a59bb2268faac84efbeb3668`
- Merge base: `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`
- Final merge commit/tree/parents: recorded in the round-676 attempt report after commit to avoid a self-reference.

The integration branch was created from the fetched mainline before merging the candidate. The merge commit parent order is mainline first, candidate second. No source worktree or shared dirty checkout was changed.

## Cumulative Sources

The role-icon source already descends from its accepted allocation, prompt, avatar and prior integration history; those commits were not cherry-picked again. The complete accepted cold-recovery entity at `/tmp/department-cold-mixed-round674-product` was compared against its provable Git baseline `c76b5132d6c0430dfb03f150fb8220010265e32f`. That comparison found 55 tracked source/script/document paths, listed in `sources.json`; the generated `.ch/docs/generated/memory-index/.local` artifact was excluded. This imported the complete dirty cumulative entity, not just its final 12-path patch.

Cold source identity:

- Source closure: `c806bda98c0d408b20db775112ce2c62460084b8f44718e3930485fce11751bd`
- Scripts closure: `d677e1691181020ddca60d3c61071083041e738fa0e204f3a76cce14e6d1ec13`
- Round-674 patch SHA-256: `eda945156e60e6c0aa6351eaae323e785e6eaa62a9552c92024dad99dfcfc55e`
- Round-674 manifest SHA-256: `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`
- Provenance: round-443 cold entity copied from round-440, whose cumulative source traces through round-437 to the c76 baseline; see the round-674 attempt report for the original execution manifests and limits.

The original difference is the 55-path c76-to-cold-entity delta. The final difference is the complete mainline-to-merge-commit tree, including all accepted candidate history plus this cold cumulative entity: 453 paths (343 added, 110 modified, zero deleted; 168,999 insertions and 3,593 deletions). Inspect the exact final path list with `git diff --name-status e890e36352570b6cda9fc531df06ca2007a09ec6 <final-commit>`. These are intentionally separate comparisons and are not represented as a single patch.

## Conflict Review

There were 13 Git unmerged paths. Each is listed with the merge decision in `semantic-review.md`. The reviewed worktree result was staged as the resolution; no whole-file ours/theirs selection was used. In addition, 55 cold-entity source differences were reviewed as a cumulative import, with disjoint changes retained by three-way merge and overlapping changes checked against current contracts. The round-674 integration needed three minimal fixes found by the new build: closing a production-wiring test callback, restoring access to the mainline effective workspace Loop+ limit, and restoring the task-store migration helper using the current normalization path.

## Reused Evidence And Open Gates

Reused only within the exact source snapshots stated by the round-675 and round-674 reports: round-675 build, final 14 distinct targeted cases (11 unchanged plus 3 rerun after fixture repair), and 1440 dark / 280 light display fixtures; round-674 build, 7 targeted Node cases, ontology validation and 9 ontology tests, plus its limited macOS second-EH and Codex worker-exit runs. The original round-675 two test failures and Tabs timeout remain recorded. Round-674's history limitation on the older guard branch remains. The quota run-1/2 cleanup remains unknown; run-4's full driver failed while its later read-only review passed within narrower evidence bounds.

This attempt ran one final successful standard `npm run build` after the three fixes. It did not run product unit tests, browser, CLI, EH or full regression on the combined tree. Workspace-level leader/employee count overrides were requested after integration began and remain unimplemented and unverified. Necessary Windows/Linux evidence, actual UI-to-EH/CLI composition, remaining cold-recovery acceptance, and final full regression remain open. Build success does not close those gates.

## Round 694: Semantic Merge Repair

This repair continues from round-676 commit `ac1b8199d3c164f76c1043bc21bfffc13a0ae60e` in this worktree and branch. It preserves that merge history and adds a child commit; it does not fetch, recreate the integration, or change the central workspace-count/configuration files owned by the parallel settings task.

The acceptance review identified two concrete omissions that the earlier conflict summary had incorrectly described as preserved:

- In `src/extensionHost/loopGroupChatPanelCoordinator.ts`, the integrated `refresh` returned as soon as `panelsByTaskId` lacked a standalone panel. A director's panel can instead own a valid leader-modal binding without registering an alias under the leader id. The corrected path computes matching subscribers before deciding there is no work, applies `openingPanels` only when a panel exists, and permits the existing scope/root/instance validation and post-await revalidation to update a modal-only subscriber. No alias or authority shortcut was introduced.
- In `src/interactive/codexAppServerPoolCore.ts`, extraction into the active pool core omitted mainline commit `f1e15cee57ed5e93492a0b6fbb6ac8693fd64b2a`'s notification rule. The incorrect result let `singleActiveListener()` claim and receive an explicit unknown `threadId`. The corrected core keeps known-owner and known-parent child routing, buffers an unknown explicit thread id within the existing bound, and leaves start/resume response confirmation responsible for ownership and replay. The no-thread and owned-execution exclusive-owner paths are unchanged.

The first acceptance probe of the modal-only load/action/refresh case did not reach its assertion: the fake Webview never emitted the newer `loadingReady` handshake. This was a fixture protocol mismatch, not a pass or a production timeout fix. Round 694 adapts the fake Webview to emit `loadingReady` and a DOM-ready generation after page installation, uses bounded open waits, and retains the load, action, no-alias, refresh/content-patch, close and stale-instance assertions. The browser smoke similarly responds to the real loading handshake while leaving DOM-ready to the rendered page.

The detailed old-result, corrected-result, and source-identity records are in `semantic-review.md` and `sources.json`. The round-674 manifest identity remains SHA-256 `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`; all original 55 cumulative paths remain listed. Round-676's build result and the interrupted acceptance probe remain historical facts, separate from this repair's build and targeted tests. Real UI-to-EH/CLI behavior, final full regression, required platform evidence, and the separate workspace count override remain open.
