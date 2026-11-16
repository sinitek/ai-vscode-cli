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
