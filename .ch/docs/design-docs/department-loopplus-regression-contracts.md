# Department Loop+ Regression Contracts

This document records the regression boundaries for live employee-capacity prompts and stopped Loop+ lifecycle recovery. It describes test contracts; it does not establish that the capacity provider is wired to the production pool or extension host.

## Capacity prompt contract

- Capacity is read from the injected host provider while each main decision prompt is built. The provider receives the validated department root id and the actual leader task id.
- An already-issued CLI invocation keeps the prompt captured at its call boundary. Refreshing a request object is not evidence that a running model received the changed text.
- A later initial, user, review, closeout, continue, or supplemental decision can use a newer snapshot. Missing, mismatched, inconsistent, or throwing provider results must be rendered as unknown, never synthesized as zero or the default quota.
- Employee regular capacity is shared by leaders within one department root. Different roots remain isolated. Every active employee, including overflow, occupies capacity. An overflow lease stays active until cleanup releases it, and a leader cannot stack a second outstanding overflow lease.
- The prompt is advisory. The host must atomically recheck admission at launch because another leader may consume positive balance after prompt construction. Local concurrency, file conflicts, pause, cancellation, and acceptance gates remain authoritative.
- The director model does not consume employee capacity; ordinary Loop+ has no department-capacity prompt context.

## Stop and continue contract

- Stopping a parent does not prove the adapter lifecycle is idle while a parked runner still owns execution responsibility.
- The regression must first observe the original lifecycle pending and a continue request refused without creating another task. It then releases the original runner, waits for actual task idle and lifecycle settlement, and explicitly continues to verify that the saved stopped attempt enters review and its acceptance event is recorded.
- Fixture recovery is bounded and observable. Releasing a runner in failure cleanup is recovery only; it is not evidence that the execution completed normally.

## Historical verification status (rounds 228–232)

- The isolated orchestration case passed and verifies a supplemental decision sees the provider's newer zero-balance snapshot and overflow availability while the issued invocation remains fixed.
- The adapter-level case passed with a deterministic in-memory task persistence port. Its first model invocation kept the positive-balance prompt captured at invocation time; after provider state changed to unavailable, the next closeout prompt rendered unknown without synthesizing zero or the default quota.
- The stop/continue case passed with the same persistence port: it observes the original lifecycle pending, refuses the concurrent continue without creating another task, releases the parked runner, waits for idle, and explicitly continues to review the saved stopped attempt.
- A focused real-host admission scenario was attempted separately and failed during fixture root registration before its atomic recheck assertion. No real-pool admission result is claimed.
- The injected persistence port makes adapter state deterministic but does not test JSON task-store serialization or cold recovery. Earlier accepted builder results remain reusable only within their reported scope. These checks do not close real-host admission, production-tree stop/continue, or cold-recovery gaps above.

## Ontology synchronization

Round 234 synchronizes the department/capacity rule and employee admission workflow entries with the root-isolated, leader-shared employee balance contract, the advisory decision-time snapshot, the one-outstanding-overflow rule, and the host's atomic launch recheck. Keep actual release ownership and recovery evidence in the resource-runtime ontology; a prompt snapshot is not an execution lease.

## Round 232 Host Admission and Stop Evidence

- The real-host regression runs in a child process with isolated `HOME`, `USERPROFILE` and `CODEX_HOME`. It creates the root through `createDepartmentProductionTaskStore` and `prepareDepartmentTaskRecord`, then verifies it through `readLoopTaskRecord` before registering the real `DepartmentOrchestrationHost` and `DepartmentCapacityPool` against the real Loop+ adapter.
- The stale-positive-prompt case is gated while another leader consumes the last regular employee slot. When released, the real host grants the first leader's single overflow lease against current occupancy. This verifies atomic recheck, not native resource execution or the complete production tree.
- The same-group second-overflow case exposes an unresolved product mismatch: the scheduler leaves the new attempt in `running` while the pool's `acquireEmployeeWithOverflow` waiter remains pending. No additional execution root, tab or worker starts and the existing overflow lease remains owned, but the host does not reject the request into review. The call chain is `createDepartmentOrchestrationHost.acquireAttemptExecution` -> `DepartmentCapacityPool.acquireEmployeeWithOverflow` -> `acquire`/`drain` (which keeps an ineligible waiter queued) -> adapter `startAttempt` awaiting the lease. The production owner should decide whether this request must be rejected synchronously when the leader already owns overflow, and should add a direct admission result that the adapter can settle into review. This test-only attempt does not change that production chain.
- The stop regression now waits for the `loop-plus-resume-blocked` host message, checks stopped state and unchanged task/main/attempt counts while the parked runner remains live, then waits with a bounded lifecycle-settlement predicate before explicit continue. The saved stopped attempt is tied to the finish event in the review prompt and remains marked stopped after review.
- At round 232, the targeted real-host test failed on the pending-versus-rejected behavior above; round 234 below supersedes this admission result. The targeted stop/continue test and isolated standard build pass. Production full-tree stop/recovery, cold task-store recovery, and native resource/platform gates remain outside this test contract.


## Round 234 Atomic duplicate-overflow refusal

- `DepartmentCapacityPool.tryAcquireEmployeeWithOverflow(rootTaskId, leaderTaskId, attempt, limits?, signal?)` uses the existing synchronous `acquire`/`drain` grant rule. A new ineligible request resolves `null` without retaining a waiter; waiting APIs keep their existing queue behavior. Held and pending identities remain idempotent. Each grant occurs before Promise callbacks run, so same-turn competing requests can grant only one outstanding overflow for the group. Different leaders and roots remain isolated.
- `DepartmentOrchestrationHost.acquireAttemptExecution` uses this immediate admission port after authoritative task/organization/leader-lease/attempt validation and repeats its authority checks after the Promise boundary. Pending requests also retain their subtask identity, rejecting conflicts. Positive balance permits regular employees even while the original overflow lease remains live. No change was made to cleanup ownership, persistence-before-leader-release, or native Owner lifecycles.
- The first repair exposed a second product issue: generic adapter `stopped` results enter the orchestration resumable-interruption path and retain `running`. An explicit department admission refusal now produces `failed` with `部门执行准入被拒绝，子任务未启动`; cancellation keeps the existing stopped path. The normal scheduler finish path creates the exact event for review without creating a root, tab or worker. Ordinary Loop+ delegation and legacy admission semantics are preserved.
- The isolated real-task-store fixture gates the first positive prompt while another leader consumes the last regular slot. The issued prompt remains fixed; the real host grants one overflow using current occupancy. A subsequent distinct attempt must appear as its exact failed finish event (matching subtask, attempt and eventId) in review, disappear from running/pending, and create no execution resources. The existing overflow identity must remain unchanged. Merely seeing scheduler running or an unrelated review item does not pass.
- The child uses a fresh `HOME`/`USERPROFILE`/`CODEX_HOME` before loading modules and the genuine controlled production store/update router, complete root/leader metadata, fixed routes and common acceptance plan. Each wait/recovery settlement is bounded, retained leader lifecycle Promises must settle, and failure diagnostics include pending scheduler state. The parent requires both exit 0 and `DEPARTMENT_ADMISSION_REGRESSION_COMPLETE`, with a 20 s child watchdog and 25 s spawn timeout. Deadline termination, forced recovery or early exit cannot pass or count as release proof.
- Auxiliary host cases use an explicit deterministic persistence port, not the controlled-storage source; their scope is the real host/pool/adapter contract. Tests that previously depended on duplicate-overflow queuing now gate an actual pool grant's return across cancellation, parent-identity changes or lost execution observation. Expansion tests issue a fresh decision after balance recovery instead of reviving a refused attempt.

### Round 234 evidence and limits

All new build/test processes used physical source copy `/private/tmp/loopplus-round234-3r92fet0`, with real cwd checked before `npm run build`, physical `src`/`dist`, and read-only reuse of shared `node_modules`. The host-provided cwd itself links `src`, docs and `dist` to the shared repository, so it was used only for source edits. Previously disclosed shared-dist clean/build actions remain historical incidents; this round neither repairs nor uses those shared artifacts.

- Standard `npm run build`: passed after correcting the fixture's typed scheduler projection. The final build includes the capacity port, host, adapter and tests.
- `node --test dist/test/departmentcapacity.test.js`: 5/5 new immediate-admission cases passed.
- `node --test --test-name-pattern='department pool enforces|cancelled capacity waiters|restore rejects active|restore validates atomically|capacity keeps custom|duplicate waiting identities|employee identity requires|overflow is explicit|overflow snapshot validation' dist/test/loop/department.test.js`: 9/9 directly relevant waiting/capacity/restore compatibility cases passed.
- `node --test --test-name-pattern='leader prompts are decision snapshots|real host/adapter/pool reserves|employee admission rechecks|expansion and ordinary completion|lost .* observation fences|installed department hook' dist/test/extensionHost/departmentruntimeintegration.test.js`: 9/9 host/adapter cases passed, including the genuine isolated controlled-store scenario. The first targeted run failed before the adapter refusal fix and auxiliary persistence repair; these were classified and repaired, not accepted as passes.
- Unchanged prior orchestration balance, adapter snapshot and ordinary stop/continue evidence is reused within its original scope. The adapter increment applies only to explicit department refusal, not the ordinary cancellation/continue paths; the common runtime fixture is unchanged. No old large suite or unchanged balance case was rerun.

This is controlled host admission evidence with deterministic bottom execution, not real Codex/native resource or whole-department release acceptance. Production full-tree stop/continue, cold recovery, real CLI/UI, other CLIs and Windows/Linux platform/root gates remain unverified here. Final integration and parallel group-capacity changes require central review.
