import test = require("node:test");
import assert = require("node:assert/strict");
import { spawnSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildLoopPlusDecisionHelperPromptContext,
  buildLoopPlusMainModelPrompt,
  buildLoopPlusSubtaskModelPrompt,
  resolveLoopPlusDecisionHelperScriptPath,
  type LoopPlusDepartmentEmployeeCapacitySnapshot,
  type LoopPlusMainPromptContext,
} from "../../extensionHost/loopPlusPromptBuilders";
import { isHiddenLoopPlusProtocolPrompt } from "../../loopPlusProtocolPrompt";
import { LOOP_DIRECT_EXECUTION_RULE_EN } from "../../loopDirectExecutionPolicy";
import { LOOP_PLUS_BLOCKED_SUMMARY_INSTRUCTION } from "../../loopBlockedSummary";
import { buildLoopBlockerSummary, LOOP_PLUS_BLOCKER_EXAMPLE } from "../../loopBlocker";
import { buildStructuredSvgSummaryPromptInstruction, SVG_SUMMARY_PROMPT_INSTRUCTION } from "../../finalAnswerProtocol";
import { LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES, type LoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import {
  LOOP_PLUS_ACCEPTANCE_BATCH_MAX,
  LOOP_PLUS_DECISION_SUBTASK_MAX,
  parseLoopPlusDecision,
  parseLoopPlusDecisionForFrozenInput,
  type LoopPlusDecision,
} from "../../loopPlusDecision";
import {
  createLoopPlusScheduler,
  requiresLoopPlusAcceptedDependencies,
  type LoopPlusExecutionRecord,
  type LoopPlusReviewItem,
  type LoopPlusSchedulerView,
} from "../../loopPlusScheduler";

const PROTOCOL_STATUSES = ["dispatch", "accept", "wait", "steer", "blocked", "clarify", "completed"] as const;
const PLURAL_CONFIRMATION_KEYS = ["reviewEventIds", "confirmedEventIds", "acceptedEventIds"] as const;

test("all Loop+ modes and main prompt kinds reuse reported execution without repeating covered checks", () => {
  for (const loopSubtaskMode of ["fullstack", "split"] as const) {
    for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
      const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind, loopSubtaskMode }));
      assert.match(prompt, /Reuse reported test, build, startup, and review results only while they cover unchanged deliverables/);
      assert.match(prompt, /do not rerun or redispatch solely to reproduce them/);
      assert.match(prompt, /Run or delegate checks only for uncovered, failed, invalidated, or explicitly required items/);
      assert.match(prompt, /state existing evidence, the concrete gap, and the smallest scope/);
      assert.match(prompt, /inspect its output or ask its source task first/);
      assert.match(prompt, /do not demand raw logs or independent reproduction/);
      assert.match(prompt, /At closeout or continuation, reuse unchanged accepted results/);
      assert.match(prompt, /one event's result does not prove another/);
      assert.match(prompt, /Keep final requirement coverage and all open-event completion gates/);
      assert.doesNotMatch(prompt, /do not treat the subtask claim as proof/);
    }
  }
});

test("department leaders receive a validated live employee balance for every main prompt kind", () => {
  const snapshot = {
    rootTaskId: "root-task",
    leaderTaskId: "leader-task",
    maxEmployees: 4,
    activeEmployees: 3,
    availableEmployees: 1,
    leaderOverflowActive: false,
    canAcquireOverflow: false,
    leaderAllocation: {
      revision: 1,
      source: "default" as const,
      desiredLimit: 2,
      appliedLimit: 2,
      activeEmployees: 1,
      availableEmployees: 1,
      pending: false,
    },
  };
  for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
    const prompt = buildLoopPlusMainModelPrompt(mainContext({
      kind,
      departmentEmployeeCapacity: {
        rootTaskId: "root-task",
        leaderTaskId: "leader-task",
        maxEmployees: 4,
        snapshot,
      },
    }));
    assert.match(prompt, /Regular employee total: 4/);
    assert.match(prompt, /Active employees in this department across all leaders, including overflow employees: 3/);
    assert.match(prompt, /Available regular employee balance: 1/);
    assert.match(prompt, /This leader group already has an overflow employee: no/);
    assert.doesNotMatch(prompt, /This leader may acquire an overflow employee now/);
    assert.match(prompt, /shared by all leaders within this department/);
    assert.match(prompt, /departments with different root task ids have separate balances/);
    assert.doesNotMatch(prompt, /across all departments/);
    assert.match(prompt, /Department capacity figures are advisory/);
  }
});

test("leader allocation prompt reports trusted default and manual limits without implying reservation", () => {
  const global = {
    rootTaskId: "root-task",
    leaderTaskId: "leader-task",
    maxEmployees: 20,
    activeEmployees: 10,
    availableEmployees: 10,
    leaderOverflowActive: false,
    canAcquireOverflow: false,
  };
  const promptFor = (leaderAllocation: unknown) => buildLoopPlusMainModelPrompt(mainContext({
    departmentEmployeeCapacity: {
      rootTaskId: "root-task",
      leaderTaskId: "leader-task",
      maxEmployees: 20,
      snapshot: { ...global, leaderAllocation } as LoopPlusDepartmentEmployeeCapacitySnapshot,
    },
  }));

  const defaultPrompt = promptFor({
    revision: 7,
    source: "default" as const,
    desiredLimit: 5,
    appliedLimit: null,
    activeEmployees: 4,
    availableEmployees: 1,
    pending: false,
  });
  assert.match(defaultPrompt, /Allocation source: default/);
  assert.match(defaultPrompt, /Desired regular employee limit for this group: 5/);
  assert.match(defaultPrompt, /Applied group limit: not yet applied/);
  assert.match(defaultPrompt, /Active employees in this leader group, including overflow employees: 4/);
  assert.match(defaultPrompt, /Regular employee balance available to this leader's next dispatch: 1/);
  assert.match(defaultPrompt, /Host allocation revision: 7/);
  assert.match(defaultPrompt, /Host reports this allocation pending: no/);
  assert.match(defaultPrompt, /Pending status comes from the host allocation snapshot/);

  const pendingManualPrompt = promptFor({
    revision: 8,
    source: "manual",
    desiredLimit: 3,
    appliedLimit: 5,
    activeEmployees: 4,
    availableEmployees: 0,
    pending: true,
  });
  assert.match(pendingManualPrompt, /Allocation source: manual/);
  assert.match(pendingManualPrompt, /Applied group limit: 5/);
  assert.match(pendingManualPrompt, /Host reports this allocation pending: yes/);
  assert.match(pendingManualPrompt, /The desired value is the latest reference for planning/);
  assert.match(pendingManualPrompt, /Applied records the reference at the latest real dispatch attempt/);
  assert.match(pendingManualPrompt, /Available regular employee balance: 10/);
  assert.match(pendingManualPrompt, /Choose how many employees to dispatch based on the work/);
});

test("unknown group allocation preserves valid global balance and never invents a default", () => {
  const global = {
    rootTaskId: "root-task",
    leaderTaskId: "leader-task",
    maxEmployees: 4,
    activeEmployees: 1,
    availableEmployees: 3,
    leaderOverflowActive: false,
    canAcquireOverflow: false,
  };
  const promptFor = (snapshot: unknown) => buildLoopPlusMainModelPrompt(mainContext({
    departmentEmployeeCapacity: {
      rootTaskId: "root-task",
      leaderTaskId: "leader-task",
      maxEmployees: 4,
      snapshot: snapshot as LoopPlusDepartmentEmployeeCapacitySnapshot | null | undefined,
    },
  }));
  const validAllocation = {
    revision: 1,
    source: "default",
    desiredLimit: 1,
    appliedLimit: 1,
    activeEmployees: 0,
    availableEmployees: 1,
    pending: false,
  };
  const invalidSnapshots: unknown[] = [
    { ...global },
    { ...global, leaderAllocation: { ...validAllocation, revision: -1 } },
    { ...global, leaderAllocation: { ...validAllocation, source: "computed" } },
    { ...global, leaderAllocation: { ...validAllocation, desiredLimit: 1.5 } },
    { ...global, leaderAllocation: { ...validAllocation, appliedLimit: "1" } },
    { ...global, leaderAllocation: { ...validAllocation, activeEmployees: -1 } },
    { ...global, leaderAllocation: { ...validAllocation, availableEmployees: 0 } },
    { ...global, leaderAllocation: { ...validAllocation, pending: "false" } },
    Object.defineProperty({ ...global }, "leaderAllocation", { get: () => { throw new Error("allocation read failed"); } }),
  ];
  for (const snapshot of invalidSnapshots) {
    const prompt = promptFor(snapshot);
    assert.match(prompt, /Available regular employee balance: 3/);
    assert.match(prompt, /This leader group's employee allocation: unknown/);
    assert.doesNotMatch(prompt, /Desired regular employee limit for this group/);
    assert.doesNotMatch(prompt, /can use an overflow exception/);
  }

  const invalidGlobal = promptFor({
    ...global,
    maxEmployees: 5,
    leaderAllocation: validAllocation,
  });
  assert.match(invalidGlobal, /Department-wide employee capacity: employee balance unknown/);
  assert.match(invalidGlobal, /This leader group's employee allocation: unknown/);
  assert.doesNotMatch(invalidGlobal, /Available regular employee balance: 3/);

  for (const identityMismatch of [
    { ...global, rootTaskId: "other-root", leaderAllocation: validAllocation },
    { ...global, leaderTaskId: "other-leader", leaderAllocation: validAllocation },
  ]) {
    const prompt = promptFor(identityMismatch);
    assert.match(prompt, /Department-wide employee capacity: employee balance unknown/);
    assert.match(prompt, /This leader group's employee allocation: unknown/);
    assert.doesNotMatch(prompt, /Available regular employee balance: 3/);
  }
});

test("group-local exhaustion is advisory while department balance remains", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    departmentEmployeeCapacity: {
      rootTaskId: "root-task",
      leaderTaskId: "leader-task",
      maxEmployees: 4,
      snapshot: {
        rootTaskId: "root-task",
        leaderTaskId: "leader-task",
        maxEmployees: 4,
        activeEmployees: 2,
        availableEmployees: 2,
        leaderOverflowActive: false,
        canAcquireOverflow: false,
        leaderAllocation: {
          revision: 2,
          source: "manual",
          desiredLimit: 1,
          appliedLimit: 1,
          activeEmployees: 1,
          availableEmployees: 0,
          pending: false,
        },
      },
    },
  }));
  assert.match(prompt, /Available regular employee balance: 2/);
  assert.match(prompt, /Regular employee balance available to this leader's next dispatch: 0/);
  assert.doesNotMatch(prompt, /This leader may acquire an overflow employee now/);
  assert.match(prompt, /Department capacity figures are advisory/);
});

test("group allocation counts a legacy overflow as actual occupancy", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    departmentEmployeeCapacity: {
      rootTaskId: "root-task",
      leaderTaskId: "leader-task",
      maxEmployees: 1,
      snapshot: {
        rootTaskId: "root-task",
        leaderTaskId: "leader-task",
        maxEmployees: 1,
        activeEmployees: 2,
        availableEmployees: 0,
        leaderOverflowActive: true,
        canAcquireOverflow: false,
        leaderAllocation: {
          revision: 3,
          source: "default",
          desiredLimit: 1,
          appliedLimit: 1,
          activeEmployees: 2,
          availableEmployees: 0,
          pending: false,
        },
      },
    },
  }));
  assert.match(prompt, /Available regular employee balance: 0/);
  assert.match(prompt, /This leader group already has an overflow employee: yes/);
  assert.doesNotMatch(prompt, /This leader may acquire an overflow employee now/);
  assert.match(prompt, /Active employees in this leader group, including overflow employees: 2/);
  assert.match(prompt, /Regular employee balance available to this leader's next dispatch: 0/);
});

test("zero and unknown department balances both leave dispatch count to the model", () => {
  const base = {
    rootTaskId: "root-task",
    leaderTaskId: "leader-task",
    maxEmployees: 2,
    activeEmployees: 2,
    availableEmployees: 0,
    leaderOverflowActive: false,
    canAcquireOverflow: true,
  };
  const promptFor = (snapshot: unknown) => buildLoopPlusMainModelPrompt(mainContext({
    departmentEmployeeCapacity: {
      rootTaskId: "root-task",
      leaderTaskId: "leader-task",
      maxEmployees: 2,
      snapshot: snapshot as LoopPlusDepartmentEmployeeCapacitySnapshot | null | undefined,
    },
  }));
  const open = promptFor({
    ...base,
    leaderAllocation: {
      revision: 1,
      source: "default",
      desiredLimit: 2,
      appliedLimit: 2,
      activeEmployees: 0,
      availableEmployees: 0,
      pending: false,
    },
  });
  assert.match(open, /Available regular employee balance: 0/);
  assert.match(open, /Department-wide regular employee balance is zero: yes/);
  assert.match(open, /Choose how many employees to dispatch based on the work, including when the balance is zero or unknown/);

  const validAllocation = {
    revision: 1,
    source: "default" as const,
    desiredLimit: 2,
    appliedLimit: 2,
    activeEmployees: 1,
    availableEmployees: 0,
    pending: false,
  };
  const unknownLeaderSnapshots: unknown[] = [
    { ...base },
    { ...base, leaderAllocation: { ...validAllocation, revision: -1 } },
    { ...base, leaderAllocation: { ...validAllocation, desiredLimit: "2" } },
    Object.defineProperty({ ...base }, "leaderAllocation", { get: () => { throw new Error("allocation getter failed"); } }),
    { ...base, leaderAllocation: { ...validAllocation, activeEmployees: 3 } },
    {
      ...base,
      leaderOverflowActive: true,
      canAcquireOverflow: false,
      leaderAllocation: { ...validAllocation, activeEmployees: 0 },
    },
  ];
  for (const candidate of unknownLeaderSnapshots) {
    const prompt = promptFor(candidate);
    assert.match(prompt, /Available regular employee balance: 0/);
    assert.match(prompt, /Department-wide regular employee balance is zero: yes/);
    assert.match(prompt, /This leader group's employee allocation: unknown/);
    assert.match(prompt, /Department capacity figures are advisory/);
    assert.doesNotMatch(prompt, /This leader may acquire an overflow employee now: yes/);
    assert.doesNotMatch(prompt, /This leader may acquire an overflow employee now: no/);
  }

  const unknownSnapshots: unknown[] = [
    undefined,
    null,
    { ...base, rootTaskId: "other-root" },
    { ...base, leaderTaskId: "other-leader" },
    { ...base, maxEmployees: -1 },
    { ...base, maxEmployees: 2.5 },
    { ...base, maxEmployees: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, maxEmployees: 3 },
    { ...base, activeEmployees: -1 },
    { ...base, activeEmployees: 1.5 },
    { ...base, activeEmployees: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, availableEmployees: -1 },
    { ...base, availableEmployees: 0.5 },
    { ...base, availableEmployees: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, availableEmployees: 1 },
    { ...base, leaderOverflowActive: "no" },
    { ...base, canAcquireOverflow: false },
    { ...base, activeEmployees: 0, availableEmployees: 2, leaderOverflowActive: true, canAcquireOverflow: false },
    Object.defineProperty({}, "rootTaskId", { get: () => { throw new Error("snapshot getter failed"); } }),
  ];
  for (const candidate of unknownSnapshots) {
    const prompt = promptFor(candidate);
    assert.match(prompt, /employee balance unknown/);
    assert.match(prompt, /Choose how many employees to dispatch based on the work, including when the balance is zero or unknown/);
    assert.doesNotMatch(prompt, /Available regular employee balance: 0/);
    assert.doesNotMatch(prompt, /This leader may acquire an overflow employee now: yes/);
  }

  const atLimitWithOverflow = promptFor({
    ...base,
    leaderOverflowActive: true,
    canAcquireOverflow: false,
    leaderAllocation: { ...validAllocation, activeEmployees: 1 },
  });
  assert.match(atLimitWithOverflow, /Regular employee total: 2/);
  assert.match(atLimitWithOverflow, /Available regular employee balance: 0/);
  assert.match(atLimitWithOverflow, /This leader group already has an overflow employee: yes/);
  assert.doesNotMatch(atLimitWithOverflow, /This leader may acquire an overflow employee now/);

  const expandedCapacityWithOutstandingOverflow = promptFor({
    ...base,
    maxEmployees: 4,
    activeEmployees: 3,
    availableEmployees: 1,
    leaderOverflowActive: true,
    canAcquireOverflow: false,
    leaderAllocation: { ...validAllocation, activeEmployees: 1, availableEmployees: 1 },
  });
  assert.match(expandedCapacityWithOutstandingOverflow, /Regular employee total: 4/);
  assert.match(expandedCapacityWithOutstandingOverflow, /Available regular employee balance: 1/);
  assert.match(expandedCapacityWithOutstandingOverflow, /This leader group already has an overflow employee: yes/);
  assert.doesNotMatch(expandedCapacityWithOutstandingOverflow, /This leader may acquire an overflow employee now/);

  const overflowPrompt = buildLoopPlusMainModelPrompt(mainContext({
    departmentEmployeeCapacity: {
      rootTaskId: "root-task",
      leaderTaskId: "leader-task",
      maxEmployees: 2,
      snapshot: {
        ...base,
        activeEmployees: 3,
        leaderOverflowActive: true,
        canAcquireOverflow: false,
        leaderAllocation: { ...validAllocation, activeEmployees: 3 },
      },
    },
  }));
  assert.match(overflowPrompt, /This leader group already has an overflow employee: yes/);
  assert.doesNotMatch(overflowPrompt, /This leader may acquire an overflow employee now/);
});

test("ordinary Loop+ prompt contract omits department capacity context", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind: "initial" }));
  assert.doesNotMatch(prompt, /Department employee capacity/);
  assert.doesNotMatch(prompt, /employee balance unknown/);
});

test("execution result reuse preserves event-level code review and every selected acceptance review", () => {
  for (const loopSubtaskMode of ["fullstack", "split"] as const) {
    for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
      const prompt = buildLoopPlusMainModelPrompt(mainContext({
        kind,
        loopSubtaskMode,
        acceptancePlan: {
          id: "review-all",
          name: "完整审查",
          checks: ["maintainability", "performance", "ui_aesthetics", "security", "other"],
          otherText: "需要独立检查的集成路径仍须检查",
          systemDefault: false,
        },
        currentEventId: "event-review",
        view: view({ currentReview: review("event-review", "sub-reviewed"), visibleReviewCount: 1 }),
      }));
      assert.match(prompt, /Independently inspect each delivered artifact and apply the checklist and selected reviews below/);
      assert.match(prompt, /Passing tests or a done claim alone is not acceptance/);
      assert.match(prompt, /A passing unit suite does not establish untested integration behavior/);
      assert.match(prompt, /Do not implement or repair that dispatched work yourself/);
      assert.match(prompt, /Do not send completed while any event fails its checklist/);
      for (const reviewLabel of ["Maintainability", "Performance", "User experience", "Security"]) {
        assert.match(prompt, new RegExp(`${reviewLabel} review:`));
      }
      assert.ok(prompt.indexOf("User experience review:") < prompt.indexOf("Security review:"));
      assert.ok(prompt.indexOf("Security review:") < prompt.indexOf("User-supplied review content"));
      assert.match(prompt, /keyboard operation and focus/);
      assert.match(prompt, /Explicitly identify any aspects not covered/);
      assert.equal(prompt.match(/User experience review:/g)?.length, 1);
      assert.match(prompt, /follow that requirement for the conflicting dimension only/);
      assert.match(prompt, /Keep reviewing all other applicable dimensions, including keyboard operation, feedback, error recovery, and narrow-width readability/);
      assert.match(prompt, /For all remaining cases include a result for every selected key: maintainability, performance, ui_aesthetics, security, other\./);
      assert.match(prompt, /需要独立检查的集成路径仍须检查/);
      const completed = parseExample(extractProtocolExamples(prompt), "completed");
      assert.deepEqual(completed.acceptance?.checks.map((check) => check.name), [
        "dispatched work", "contracts", "tests", "artifacts", "unauthorized changes", "omissions and regressions",
      ]);
      assert.deepEqual(completed.acceptancePlanResults?.map((result) => result.key), [
        "maintainability", "performance", "ui_aesthetics", "security", "other",
      ]);
      assert.ok(completed.requirementCoverage?.length);
    }
  }
});

test("unselected UX review is omitted even when the user requests a distinctive style", () => {
  for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
    const prompt = buildLoopPlusMainModelPrompt(mainContext({
      kind,
      rootPrompt: "做一个风格独特的页面",
      acceptancePlan: {
        id: "security-only", name: "安全检查", checks: ["security"], otherText: "", systemDefault: false,
      },
      currentEventId: "event-review",
      view: view({ currentReview: review("event-review", "sub-reviewed"), visibleReviewCount: 1 }),
    }));
    assert.match(prompt, /做一个风格独特的页面/);
    assert.doesNotMatch(prompt, /User experience review:|conflicting dimension only|ui_aesthetics/);
    assert.match(prompt, /For all remaining cases include a result for every selected key: security\./);
    const completed = parseExample(extractProtocolExamples(prompt), "completed");
    assert.deepEqual(completed.acceptance?.checks.map((check) => check.name), [
      "dispatched work", "contracts", "tests", "artifacts", "unauthorized changes", "omissions and regressions",
    ]);
    assert.deepEqual(completed.acceptancePlanResults?.map((result) => result.key), ["security"]);
  }
});

test("all main prompt kinds distinguish full acceptance, report confirmation, and direct execution", () => {
  for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
    const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind }));
    assert.match(prompt, /For every dispatched subtask, decide requiresAcceptance at dispatch time/);
    assert.match(prompt, /Reassess every reprompt as a new attempt: omission resets to true/);
    assert.match(prompt, /Report-only work may skip full acceptance/);
    assert.match(prompt, /A test is not automatically exempt, and a document is not automatically exempt/);
    assert.match(prompt, /The general simple-task rule is separate from requiresAcceptance/);
    assert.match(prompt, /Do not delegate a trivial task just to avoid review/);
    assert.match(prompt, /Reports marked no-acceptance must be explicitly acknowledged/);
    const dispatch = parseExample(extractProtocolExamples(prompt), "dispatch");
    const byId = new Map(dispatch.subtasks?.map((item) => [item.id, item]));
    assert.equal(byId.get("example-verification-report-subtask")?.requiresAcceptance, false);
    assert.equal(byId.get("example-local-log-subtask")?.requiresAcceptance, false);
    assert.deepEqual(byId.get("example-local-log-subtask")?.writeFiles, ["src/example-worker.ts"]);
    assert.equal(byId.get("example-subtask")?.requiresAcceptance, true);
    assert.equal(byId.get("example-frontend-subtask")?.requiresAcceptance, true);
  }
});

test("low-risk edits and authorized routine Git delivery skip only independent acceptance", () => {
  for (const loopSubtaskMode of ["fullstack", "split"] as const) {
    for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
      const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind, loopSubtaskMode }));
      for (const clause of [
        /Obviously simple, low-risk edits may skip full acceptance too/,
        /the edit is local and directly verifiable/,
        /must check the targeted diff, run any required checks/,
        /Neither task type, diff size, nor model capability alone decides it/,
        /the user or project requires independent review/,
        /A one-line change to a shared default or a log that exposes sensitive data is not exempt/,
        /An authorized ordinary Git commit or push with a known scope and target also uses requiresAcceptance=false/,
        /Route a standalone Git delivery as backend .* not read-only general/,
        /Keep it separate from implementation that still needs review/,
        /use dependsOn for prerequisite subtasks/,
        /Do not overlap with work that can alter the commit set or target ref/,
        /The exemption does not grant permission to commit or push, does not waive review of the contents/,
        /does not cover force-push, history rewriting/,
      ]) {
        assert.match(prompt, clause);
      }
    }
    const prompt = buildLoopPlusSubtaskModelPrompt({
      subtask: { id: "git-delivery", title: "提交变更", taskType: "backend", prompt: "GIT_DELIVERY_TOKEN" },
      communicationFile: "REPORT_TOKEN",
      loopSubtaskMode,
    });
    assert.match(prompt, /execute only the authorized commit or push/);
    assert.match(prompt, /Verify the intended files or commits, branch, and push remote before writing/);
    assert.match(prompt, /Do not edit the delivered files, include unrelated changes, bypass required hooks, force-push, or rewrite history/);
    assert.match(prompt, /Stop and report an unexpected scope, destination, or failure; report the actual commit SHA and push result/);
  }
});

test("protocol examples acknowledge the frozen report prefix when resuming scheduling", () => {
  const reportEventIds = ["report-event-a", "report-event-b"];
  const prompt = buildLoopPlusMainModelPrompt(mainContext({ reportEventIds }));
  const examples = extractProtocolExamples(prompt);
  for (const status of examples.keys()) {
    const parsed = parseExample(examples, status);
    assert.deepEqual(parsed.reportEventIds, reportEventIds);
  }
});

test("all main prompt modes preserve four frozen ids through refresh and late prerequisite arrival", () => {
  assert.equal(LOOP_PLUS_ACCEPTANCE_BATCH_MAX, 4);
  const frozen = ["event-prerequisite-z", "event-successor-a", "event-ready-c", "event-ready-b"];
  const reports = ["report-z-first", "report-a-second"];
  for (const loopSubtaskMode of ["fullstack", "split"] as const) {
    for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
      for (const latePrerequisite of [false, true]) {
        const prompt = buildLoopPlusMainModelPrompt(mainContext({
          kind, loopSubtaskMode, acceptanceEventIds: frozen, reportEventIds: reports,
          currentEventId: frozen[0], maxConcurrency: 2, subtaskMax: 1,
          view: view({
            currentReview: review(frozen[0], "prerequisite"),
            reviewQueue: [
              ...frozen.slice(1).map((id) => review(id, id)),
              ...(latePrerequisite ? [review("late-prerequisite", "late-prerequisite")] : []),
            ],
            visibleReviewCount: latePrerequisite ? 5 : 4,
          }),
        }));
        assert.match(prompt, /Acceptance batch count: 4/);
        assert.match(prompt, /Maximum acceptance batch size: 4/);
        assert.match(prompt, /frozen host-selected order/);
        assert.match(prompt, /protocol repair, retries, prompt refresh, and same-host recovery/);
        assert.match(prompt, /including late-arriving prerequisites, but those belong to the next batch/);
        assert.match(prompt, /Never reorder or expand the frozen batch from the latest record/);
        assert.match(prompt, /Frozen FIFO report prefix:\n1\. report-z-first\n2\. report-a-second/);
        assert.match(prompt, /then acknowledge the exact list/);
        assert.doesNotMatch(prompt, /FIFO review queue|Acceptance batch, oldest first|review queue, oldest first/);
        const examples = extractProtocolExamples(prompt);
        assert.equal(examples.has("completed"), !latePrerequisite);
        assert.equal(examples.has("dispatch"), false);
        assert.equal(examples.has("wait"), false);
        assert.equal(examples.has("steer"), false);
        for (const status of examples.keys()) {
          const parsed = parseExample(examples, status);
          assert.deepEqual(parsed.reportEventIds, reports);
          if (status === "accept" || status === "completed") {
            assert.deepEqual(parsed.reviewEventIds, frozen);
            assert.equal(parsed.reviewEventId, undefined);
            if (status === "accept") {
              assert.deepEqual(parsed.reviews?.map((item) => item.reviewEventId), frozen);
              assert.equal(parsed.subtasks?.length, 1);
            }
          }
        }
        assert.match(prompt, /Scheduler concurrency limit: 2/);
        assert.match(prompt, /Decision subtask limit: 1/);
        assert.match(prompt, /There is no cumulative per-parent subtask dispatch limit/);
        assert.match(prompt, /configured per-decision dispatch limit and currently available concurrency slots/);
        assert.doesNotMatch(prompt, /Subtask round limit|Remaining subtask rounds|rounds used/);
      }
    }
  }
});

test("dependency-first review rules preserve independent progress, real verdicts and execution gates", () => {
  for (const loopSubtaskMode of ["fullstack", "split"] as const) {
    for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
      const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind, loopSubtaskMode, acceptanceEventIds: [] }));
      for (const clause of [
        /selects prerequisites before successors when generating a new batch/,
        /preserving arrival order for independent ready items/,
        /Do not wait to fill the batch/,
        /running or pending prerequisite, or an unacknowledged no-acceptance report, defers only related successors/,
        /Independent review, dispatch, and refill continue/,
        /Acknowledge reports through the frozen FIFO report prefix first/,
        /Never confirm a report automatically or turn it into a separate acceptance review/,
        /reviewed \(passed or failed\), reported, or closed means it has been processed first, not that execution succeeded/,
        /judge the successor delivery independently/,
        /A failed prerequisite does not automatically fail any other event/,
        /A selected prerequisite is not yet passed/,
        /For execution admission.*latest attempt completes successfully/,
        /Acceptance or report acknowledgement is not required for execution admission/,
        /Failed\/stopped attempts and closed tasks do not release successors/,
        /complete decision.*before promoting pending work/,
        /New reservations are persisted before execution starts/,
        /no acceptance item is claimable, do not emit an empty review confirmation/,
        /When an active prerequisite can advance, waiting with no frozen acceptance batch is allowed/,
        /wait cannot make progress, even if review events remain queued/,
        /instead of waiting indefinitely/,
        /no batch barrier and no shared round gate/,
        /later events or messages, running or pending work, and open continuations prevent parent completion/,
      ]) {
        assert.match(prompt, clause);
      }
      assert.match(prompt, /Do not send accept when the acceptance batch is \(none\)/);
      const completed = parseExample(extractProtocolExamples(prompt), "completed");
      assert.equal(completed.reviewEventId, undefined);
      assert.equal(completed.reviewEventIds, undefined);
    }
  }
});

test("a newly frozen review offers one independent dispatch before acceptance", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    allowDispatchBeforeReview: true,
    currentEventId: "event-ready",
    acceptanceEventIds: ["event-ready"],
    view: view({ currentReview: review("event-ready", "finished-delivery"), visibleReviewCount: 1 }),
  }));
  assert.match(prompt, /One-time dispatch-first check for this newly frozen acceptance batch/);
  assert.match(prompt, /genuinely independent unfinished work that can start now/);
  assert.match(prompt, /include nextStepPlan for the automatic next main decision to review this unchanged frozen batch/);
  assert.match(prompt, /If no independent task can start immediately.*return accept now/);
  const dispatch = parseExample(extractProtocolExamples(prompt), "dispatch");
  assert.deepEqual(dispatch.nextStepPlan, { objective: "下一步验收当前冻结批次" });

  const ordinaryReview = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-ready",
    acceptanceEventIds: ["event-ready"],
    view: view({ currentReview: review("event-ready", "finished-delivery"), visibleReviewCount: 1 }),
  }));
  assert.doesNotMatch(ordinaryReview, /One-time dispatch-first check/);
});

test("Loop+ subtask prompts require applicable self-checks and evidence for main review", () => {
  for (const loopSubtaskMode of ["fullstack", "split"] as const) {
    for (const executionRole of ["backend", "frontend", "general"] as const) {
      const prompt = buildLoopPlusSubtaskModelPrompt({
        subtask: { title: "汇报验证范围", prompt: "完成本次任务并汇报执行情况", taskType: executionRole },
        executionRole,
        loopSubtaskMode,
        communicationFile: "ATTEMPT_REPORT_TOKEN",
      });
      assert.match(prompt, /^Loop\+ subtask self-check before reporting$/m);
      assert.match(prompt, /each requested deliverable meets the original subtask instructions and applicable design constraints/);
      assert.match(prompt, /Check affected contracts with callers, relevant edge cases, and regressions/);
      assert.match(prompt, /Run the smallest relevant checks that cover the delivery and any checks required by the task or project/);
      assert.match(prompt, /Record the exact commands used\. Explicitly identify failed and unverified checks and explain why/);
      assert.match(prompt, /produces a runnable artifact and startup is applicable, actually start it through its normal entry point/);
      assert.match(prompt, /Record the startup command and observed result/);
      assert.match(prompt, /If startup does not apply, record it as not applicable with the reason/);
      assert.match(prompt, /If applicable startup could not be verified, report it as unverified with the reason/);
      assert.match(prompt, /If this attempt changes files, review your own diff for unrelated changes/);
      assert.match(prompt, /Explain each necessary change outside the suggested scope with its path and reason in the attempt report/);
      assert.match(prompt, /Report each performed check's scope, command or action, result, and any untested or skipped areas/);
      assert.match(prompt, /Mention changes made after a check that may invalidate its result/);
      assert.match(prompt, /Do not rerun a still-valid covered check solely to create fresh evidence/);
      assert.match(prompt, /Your execution results are reusable facts, not a replacement for the main model's acceptance review/);
    }
  }
});

test("all main prompt kinds require a corrected Chinese title when reprompting", () => {
  for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
    const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind,
      view: view({ running: [execution("sub-running", "running")] }),
    }));
    assert.match(prompt, /reprompt requires a non-empty title/);
    assert.match(prompt, /title describing the corrected task in Simplified Chinese/);
    assert.match(prompt, /Do not reuse the old title/);
    const steer = parseExample(extractProtocolExamples(prompt), "steer");
    const reprompt = steer.controls?.find((control) => control.action === "reprompt");
    assert.ok(reprompt?.title?.trim());
  }
});

test("all main prompt kinds require readable Chinese blockers with recovery or impossibility explanations", () => {
  for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
    for (const blockedReviewSummary of [undefined, "缺少联调权限"]) {
      const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind, blockedReviewSummary }));
      assert.ok(prompt.includes(LOOP_PLUS_BLOCKED_SUMMARY_INSTRUCTION));
      assert.match(prompt, /Own routine implementation choices, including when the user has not suggested an alternative/);
      assert.match(prompt, /必须用简体中文/);
      assert.match(prompt, /只列不做就无法继续的事项，一条能说清就只写一条/);
      assert.match(prompt, /按当前要求无法完成/);
      assert.match(prompt, /能自行处理的继续执行或派发修复子任务/);
      const blocked = parseExample(extractProtocolExamples(prompt), "blocked");
      assert.equal(blocked.finalSummary, buildLoopBlockerSummary(LOOP_PLUS_BLOCKER_EXAMPLE, "event_driven"));
    }
  }
});

test("Loop+ bounded blocked review uses an authorized local replacement instead of stale provenance", () => {
  const replacement = "这两套本地测试预览可以用仓库现有模板重新生成，只替换这两套预览。";
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    kind: "review",
    blockedReviewSummary: "两份本地预览缺少历史发布凭据。",
    supplementalRequirements: [replacement],
  }));

  assert.ok(prompt.includes(replacement));
  assert.match(prompt, /Drop prerequisites introduced only by the plan or a subtask/);
  assert.match(prompt, /regenerate scoped test outputs from repository templates/);
  assert.match(prompt, /enforce any actual release permissions separately/);
});

function execution(subtaskId: string, state: LoopPlusExecutionRecord["state"]): LoopPlusExecutionRecord {
  return {
    subtaskId,
    attemptId: `${subtaskId}-attempt`,
    title: subtaskId,
    conflictGroup: null,
    writeFiles: [`src/${subtaskId}.ts`],
    state,
  };
}

function review(eventId: string, subtaskId: string): LoopPlusReviewItem {
  return {
    eventId,
    subtaskId,
    attemptId: `${subtaskId}-attempt`,
    outcome: "completed",
    detail: `${subtaskId}-detail`,
  };
}

function view(overrides: Partial<LoopPlusSchedulerView> = {}): LoopPlusSchedulerView {
  return {
    phase: "reviewing",
    seq: 4,
    wake: true,
    wakeSeq: 4,
    userMessageQueue: [],
    running: [],
    pending: [],
    reviewQueue: [],
    currentReview: null,
    visibleReviewCount: 0,
    canComplete: false,
    blockers: [],
    ...overrides,
  };
}

function mainContext(overrides: Partial<LoopPlusMainPromptContext> = {}): LoopPlusMainPromptContext {
  return {
    taskId: "task-token",
    rootPrompt: "ROOT_REQUEST_TOKEN",
    taskStoreFile: "TASK_RECORD_TOKEN",
    mainCommunicationFile: "MAIN_REPORT_TOKEN",
    kind: "review",
    view: view(),
    currentEventId: null,
    supplementalRequirements: [],
    maxConcurrency: 6,
    ...overrides,
  };
}

test("report-only handoff and outstanding repair prompt remain explicit and scoped", () => {
  const reportPrompt = buildLoopPlusMainModelPrompt(mainContext({
    kind: "continue", reportOnly: true,
    reportEventIds: ["report-1"],
    reportQueue: [{ eventId: "report-1", subtaskId: "report", attemptId: "report-1", outcome: "completed", detail: "evidence" }],
    acceptanceEventIds: [],
  }));
  assert.match(reportPrompt, /Report-only handoff/);
  assert.match(reportPrompt, /report-1/);
  assert.match(reportPrompt, /original frozen acceptance batch resumes/);
  const repairPrompt = buildLoopPlusMainModelPrompt(mainContext({ requiredRepairIds: ["source"] }));
  assert.match(repairPrompt, /Outstanding required repairs/);
  assert.match(repairPrompt, /same subtasks\[\]\.id/);
});

function linkageSection(prompt: string): string {
  const start = prompt.indexOf("Frozen review linkage from this snapshot, in frozen order.");
  const end = prompt.indexOf("Valid protocol examples follow.");
  assert.ok(start >= 0 && end > start);
  return prompt.slice(start, end);
}

function frozenReviewItems(section: string): Array<{
  reviewIndex: number;
  eventId: string;
  originalLogicalSubtaskId: string;
  outcome: string;
}> {
  return section.split("\n").flatMap((line) => {
    const prefix = "Frozen review item: ";
    if (!line.startsWith(prefix)) return [];
    return [JSON.parse(line.slice(prefix.length)) as {
      reviewIndex: number;
      eventId: string;
      originalLogicalSubtaskId: string;
      outcome: string;
    }];
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractProtocolExamples(prompt: string): Map<string, string> {
  const examples = new Map<string, string>();
  const pattern = /LOOP_PLUS_PROTOCOL_EXAMPLE ([a-z]+)\n```json\n([\s\S]*?)\n```/g;
  for (const match of prompt.matchAll(pattern)) {
    examples.set(match[1], match[2]);
  }
  return examples;
}

function parseExample(examples: Map<string, string>, status: string): LoopPlusDecision {
  const jsonText = examples.get(status);
  assert.equal(typeof jsonText, "string", `missing generated ${status} example`);
  const decision = parseLoopPlusDecision(jsonText);
  assert.ok(decision, `generated ${status} example was rejected`);
  assert.equal(decision?.status, status);
  return decision as LoopPlusDecision;
}

test("every Loop+ decision applies complexity-based direct execution including supplemental work", () => {
  for (const loopSubtaskMode of ["fullstack", "split"] as const) {
    for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
      for (const allowDirectCompletion of [false, true]) {
        const prompt = buildLoopPlusMainModelPrompt(mainContext({
          loopSubtaskMode, kind, allowDirectCompletion,
          supplementalRequirements: ["同步简单补充事项"],
          pendingUserMessages: ["处理这个小调整"],
        }));
        assert.ok(prompt.includes(LOOP_DIRECT_EXECUTION_RULE_EN));
        assert.ok(prompt.includes(`Direct completion available: ${allowDirectCompletion ? "yes" : "no"}`));
        assert.match(prompt, /not an operation whitelist/);
        assert.match(prompt, /Do not decide by file count, line count/);
        assert.match(prompt, /may be executed directly in every decision, even when Direct completion available is no/);
        assert.match(prompt, /Earlier reviewed work does not prohibit this path/);
        assert.match(prompt, /Do not conflict with running, pending, or unreviewed ownership/);
        assert.match(prompt, /Never use it to skip unreviewed events, failed or unfinished requirements/);
        assert.match(prompt, /同步简单补充事项/);
        assert.match(prompt, /处理这个小调整/);
        const directJson = prompt.match(/return (\{"status":"completed","directCompletion":true[^\n]+?\})\./)?.[1];
        assert.ok(directJson);
        assert.equal(parseLoopPlusDecision(directJson, { allowDirectCompletion })?.directCompletion, allowDirectCompletion ? true : undefined);
      }
    }
  }
});

test("acceptance reason language follows the task and conversation instead of forcing Chinese", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({ rootPrompt: "Verify the exported API and regression tests." }));
  assert.match(prompt, /language that best matches the task, evidence, and surrounding conversation/u);
  assert.match(prompt, /Chinese is not mandatory/u);
  assert.doesNotMatch(prompt, /50 characters/u);
  assert.doesNotMatch(prompt, /Write every acceptance reason and check detail in Simplified Chinese/u);
});

test("previous main decision next-step plan is exposed without overriding current gates", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    nextStepPlan: {
      objective: "验收成功后安排剩余交付",
      acceptanceCriteria: ["核对最新子任务结果", "保持现有完成门禁"],
    },
  }));
  assert.match(prompt, /Next-step plan from the previous main decision/);
  assert.match(prompt, /Objective: 验收成功后安排剩余交付/);
  assert.match(prompt, /1\. 核对最新子任务结果/);
  assert.match(prompt, /never overrides the root request, latest task record, scheduler state/);
  assert.match(prompt, /an objective and optional acceptanceCriteria/);
  assert.match(prompt, /Do not include nextStepPlan with clarify, blocked, or completed/);
});

test("all acceptance examples satisfy strict feedback for default and custom plans", () => {
  const plans: LoopPlusMainPromptContext["acceptancePlan"][] = [undefined, {
    id: "plan-custom", name: "上线审查", checks: ["security", "other"],
    otherText: "确认日志脱敏", systemDefault: false,
  }];
  for (const acceptancePlan of plans) {
    for (const eventIds of [[], ["event-a"], ["event-a", "event-b"]]) {
      const prompt = buildLoopPlusMainModelPrompt(mainContext({ acceptancePlan, acceptanceEventIds: eventIds,
        view: view({ currentReview: eventIds.length ? review(eventIds[0], "source-first") : null,
          reviewQueue: eventIds.slice(1).map((id) => review(id, "source-last")), visibleReviewCount: eventIds.length }),
      }));
      const examples = extractProtocolExamples(prompt);
      for (const status of ["accept", "completed"]) {
        if (status === "accept" && eventIds.length === 0) {
          assert.equal(examples.has("accept"), false);
          continue;
        }
        const parsed = parseLoopPlusDecision(examples.get(status), {
          requireAcceptanceFeedback: true,
          acceptancePlanKeys: acceptancePlan ? ["security", "other"] : [],
        });
        assert.equal(parsed?.status, status);
      }
      if (eventIds.length > 1) {
        const accepted = parseExample(examples, "accept");
        assert.equal(accepted.acceptance?.passed, false);
        assert.equal(accepted.acceptance?.checks.find((check) => check.name === "tests")?.passed, false);
      }
    }
  }
});

test("Loop+ suggests optional SVG in the main finalSummary without changing subtask prompts", () => {
  for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
    const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind }));

    assert.ok(prompt.includes(buildStructuredSvgSummaryPromptInstruction("finalSummary")));
    assert.doesNotMatch(prompt, /\[final_answer\]/u);
    assert.ok(parseExample(extractProtocolExamples(prompt), "completed"));
  }
  const subtaskPrompt = buildLoopPlusSubtaskModelPrompt({
    subtask: { id: "sub-1", title: "独立执行任务", prompt: "完成指定变更并记录验证结果。" },
    communicationFile: "/tmp/sub-1.md",
  });
  assert.ok(!subtaskPrompt.includes(SVG_SUMMARY_PROMPT_INSTRUCTION));
});

test("generated protocol examples satisfy the current parser and live event id", () => {
  const current = review("event-live-42", "sub-current");
  const queued = review("event-queued-7", "sub-queued");
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    view: view({
      currentReview: current,
      reviewQueue: [queued],
      visibleReviewCount: 2,
      running: [execution("sub-running", "running")],
      pending: [execution("sub-pending", "pending")],
      blockers: ["running", "pending", "review_queue"],
      canComplete: false,
    }),
    supplementalRequirements: ["SUPPLEMENTAL_TOKEN"],
  }));
  const examples = extractProtocolExamples(prompt);
  assert.deepEqual([...examples.keys()], ["accept", "blocked", "clarify"]);
  const liveExamples = extractProtocolExamples(buildLoopPlusMainModelPrompt(mainContext({
    view: view({ running: [execution("live-running", "running")], pending: [execution("live-pending", "pending")] }),
  })));
  const finalExamples = extractProtocolExamples(buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: current.eventId,
    view: view({ currentReview: current, visibleReviewCount: 1 }),
  })));

  const dispatch = parseExample(liveExamples, "dispatch");
  assert.equal(Object.prototype.hasOwnProperty.call(dispatch, "reviewEventId"), false);
  assert.ok(dispatch.subtasks);
  assert.ok(dispatch.subtasks.length >= 1 && dispatch.subtasks.length <= LOOP_PLUS_DECISION_SUBTASK_MAX);
  dispatch.subtasks.forEach((subtask) => {
    assert.ok(subtask.title.trim());
    assert.ok(subtask.prompt.trim());
    if (subtask.taskType === "general") {
      assert.equal(subtask.writeFiles, undefined);
      assert.match(subtask.prompt, /don't edit files/i);
      return;
    }
    assert.ok(subtask.writeFiles && subtask.writeFiles.length > 0);
    subtask.writeFiles?.forEach((file) => {
      assert.equal(file.startsWith("/"), false);
      assert.equal(file.includes("Users"), false);
      assert.equal(subtask.prompt.includes(file), true);
    });
  });

  const accept = parseExample(examples, "accept");
  assert.equal(accept.reviewEventId, "event-live-42");
  assert.deepEqual(accept.reviews, [{
    reviewEventId: "event-live-42", acceptance: "failed", reason: "用例失败，需先修复断言", subtaskIds: ["sub-current"],
  }]);
  assert.ok(accept.acceptance);
  assert.ok(!accept.subtasks || accept.subtasks.length <= LOOP_PLUS_DECISION_SUBTASK_MAX);

  const waiting = parseExample(liveExamples, "wait");
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "reviewEventId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "subtasks"), false);

  const steer = parseExample(liveExamples, "steer");
  assert.equal(Object.prototype.hasOwnProperty.call(steer, "reviewEventId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(steer, "subtasks"), false);
  assert.equal(steer.controls?.[0].id, "live-running");
  assert.equal(steer.controls?.some((control) => (
    control.action === "reprompt" && Boolean(control.title?.trim())
      && Boolean(control.prompt?.trim())
  )), true);

  const blocked = parseExample(examples, "blocked");
  assert.equal(Object.prototype.hasOwnProperty.call(blocked, "reviewEventId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(blocked, "subtasks"), false);
  assert.equal(typeof blocked.finalSummary, "string");
  assert.ok((blocked.finalSummary ?? "").trim());

  const clarify = parseExample(examples, "clarify");
  assert.equal(Object.prototype.hasOwnProperty.call(clarify, "reviewEventId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clarify, "subtasks"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clarify, "controls"), false);
  assert.equal(clarify.clarification?.formFields.length, 1);
  assert.equal(clarify.clarification?.formFields[0]?.type, "radio");

  const completed = parseExample(finalExamples, "completed");
  assert.equal(completed.reviewEventId, "event-live-42");
  assert.ok(completed.answerConclusion && completed.answerConclusion.trim());
  assert.ok(completed.finalSummary && completed.finalSummary.trim());
  assert.equal(completed.acceptance?.passed, true);
  assert.ok(completed.acceptance && completed.acceptance.checks.length > 0);
  assert.equal(completed.acceptance?.checks.every((check) => check.passed === true), true);
  assert.ok(completed.requirementCoverage && completed.requirementCoverage.length > 0);
  assert.equal(completed.requirementCoverage?.every((check) => check.passed === true), true);
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "subtasks"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "estimatedRemainingRounds"), false);
  assert.equal(JSON.stringify(completed).includes("roundSummaries"), false);

  const allExamples = new Map([...liveExamples, ...finalExamples, ...examples]);
  PROTOCOL_STATUSES.forEach((status) => {
    const raw = JSON.parse(allExamples.get(status) ?? "{}") as Record<string, unknown>;
    PLURAL_CONFIRMATION_KEYS.forEach((key) => {
      assert.equal(Object.prototype.hasOwnProperty.call(raw, key), false);
    });
    assert.notEqual(raw.status, "continue");
  });
  assert.equal(parseLoopPlusDecision(`Decision follows.\n\`\`\`json\n${examples.get("accept")}\n\`\`\``)?.status, "accept");
});

test("stripping required completed fields from the generated example is rejected", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    view: view({
      currentReview: review("event-live-42", "sub-current"),
      visibleReviewCount: 1,
    }),
  }));
  const completedJson = extractProtocolExamples(prompt).get("completed");
  assert.equal(typeof completedJson, "string");
  const base = JSON.parse(completedJson ?? "{}") as Record<string, unknown>;
  const cases: Array<Record<string, unknown>> = [];
  const withoutConclusion = { ...base };
  delete withoutConclusion.answerConclusion;
  cases.push(withoutConclusion);
  const withoutSummary = { ...base };
  delete withoutSummary.finalSummary;
  cases.push(withoutSummary);
  const acceptance = base.acceptance as Record<string, unknown>;
  cases.push({ ...base, acceptance: { ...acceptance, passed: false } });
  cases.push({ ...base, acceptance: { ...acceptance, checks: [] } });
  const checks = (acceptance.checks as Array<Record<string, unknown>>).map((check, index) => (
    index === 0 ? { ...check, passed: false } : check
  ));
  cases.push({ ...base, acceptance: { ...acceptance, checks } });
  cases.push({ ...base, requirementCoverage: [] });
  const coverage = (base.requirementCoverage as Array<Record<string, unknown>>).map((check, index) => (
    index === 0 ? { ...check, passed: false } : check
  ));
  cases.push({ ...base, requirementCoverage: coverage });
  cases.push({ ...base, reviewEventId: " " });
  cases.push({
    ...base,
    subtasks: [{
      id: "extra-completed-subtask",
      title: "Extra subtask",
      prompt: "分发禁止的子任务。",
    }],
  });
  cases.forEach((value) => {
    assert.equal(parseLoopPlusDecision(JSON.stringify(value)), null);
  });
});

test("prompt forbids plural confirmation keys and classic continue without cumulative dispatch gates", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    view: view({
      currentReview: review("event-live-42", "sub-current"),
      visibleReviewCount: 1,
    }),
  }));
  assert.match(prompt, new RegExp(`1 to ${LOOP_PLUS_DECISION_SUBTASK_MAX}`));
  assert.match(prompt, new RegExp(`0 to ${LOOP_PLUS_DECISION_SUBTASK_MAX}`));
  const limited = buildLoopPlusMainModelPrompt(mainContext({ subtaskMax: 3 }));
  assert.match(limited, /1 to 3 new self-contained subtasks/);
  assert.match(limited, /0 to 3 new subtasks/);
  assert.match(prompt, /There is no cumulative per-parent subtask dispatch limit/);
  assert.match(prompt, /configured per-decision dispatch limit and currently available concurrency slots/);
  assert.doesNotMatch(prompt, /Subtask rounds used|Subtask round limit|Remaining subtask rounds/);
  const clamped = buildLoopPlusMainModelPrompt(mainContext({ subtaskMax: 99 }));
  assert.match(clamped, /1 to 20 new self-contained subtasks/);
  assert.match(prompt, /a non-empty prompt/);
  PLURAL_CONFIRMATION_KEYS.forEach((key) => {
    assert.match(prompt, new RegExp(key));
  });
  assert.match(prompt, /classic Loop status continue/);
  assert.match(prompt, /roundSummaries/);
  assert.match(prompt, /estimatedRemainingRounds is optional/);
  assert.match(prompt, /Acceptance batch listed at request start is frozen and is the only batch to confirm/);
  assert.match(prompt, /those belong to the next batch/);
  assert.match(prompt, /Never add them to or otherwise change the reviewEventId or reviewEventIds/);
  assert.doesNotMatch(prompt, /host discards this answer|asks again with every queued event/);
  assert.match(prompt, /host submits this batch first, then checks its latest state/);
  assert.match(prompt, /Do not implement or repair that dispatched work yourself/);
  assert.match(prompt, /Run or delegate checks only for uncovered, failed, invalidated, or explicitly required items/);
  assert.match(prompt, /do not rerun or redispatch solely to reproduce them/);
  assert.match(prompt, /loopPlus snapshot/);

  const examples = extractProtocolExamples(prompt);
  const accept = JSON.parse(examples.get("accept") ?? "{}") as Record<string, unknown>;
  PLURAL_CONFIRMATION_KEYS.forEach((key) => {
    assert.equal(parseLoopPlusDecision(JSON.stringify({ ...accept, [key]: ["event-live-42"] })), null);
  });
  const dispatch = JSON.parse(examples.get("dispatch") ?? "{}") as Record<string, unknown>;
  assert.equal(parseLoopPlusDecision(JSON.stringify({ ...dispatch, status: "continue" })), null);
  const completed = JSON.parse(examples.get("completed") ?? "{}") as Record<string, unknown>;
  const withRounds = parseLoopPlusDecision(JSON.stringify({
    ...completed,
    roundSummaries: [{ round: 1, title: "ignored", summary: "not a gate" }],
    estimatedRemainingRounds: 4,
  }));
  assert.equal(withRounds?.status, "completed");
  assert.equal(withRounds?.estimatedRemainingRounds, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(withRounds, "roundSummaries"), false);
  const waiting = JSON.parse(extractProtocolExamples(buildLoopPlusMainModelPrompt(mainContext({
    view: view({ running: [execution("running", "running")] }),
  }))).get("wait") ?? "{}") as Record<string, unknown>;
  const optionalWait = parseLoopPlusDecision(JSON.stringify({ ...waiting, estimatedRemainingRounds: "2" }));
  assert.equal(optionalWait?.status, "wait");
  assert.equal(optionalWait?.estimatedRemainingRounds, 2);
});

test("main prompt shows the current item, queue, visible count, work in flight, and report paths", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    taskStoreFile: "TASK_RECORD_TOKEN",
    mainCommunicationFile: "MAIN_REPORT_TOKEN",
    rootPrompt: "ROOT_REQUEST_TOKEN",
    view: view({
      phase: "reviewing",
      currentReview: review("event-live-42", "sub-current"),
      reviewQueue: [review("event-queued-7", "sub-queued")],
      visibleReviewCount: 2,
      running: [execution("sub-running", "running")],
      pending: [execution("sub-pending", "pending")],
      blockers: ["running"],
      canComplete: false,
    }),
    supplementalRequirements: ["SUPPLEMENTAL_TOKEN"],
  }));
  assert.match(prompt, /Current review eventId: event-live-42/);
  assert.match(prompt, /current eventId=event-live-42 subtask=sub-current/);
  assert.match(prompt, /Review queue count: 1/);
  assert.match(prompt, /Visible review count including the current item: 2/);
  assert.match(prompt, /queued#1 eventId=event-queued-7 subtask=sub-queued/);
  assert.match(prompt, /Still running count: 1/);
  assert.match(prompt, /sub-running attempt=sub-running-attempt state=running/);
  assert.match(prompt, /Still pending count: 1/);
  assert.match(prompt, /sub-pending attempt=sub-pending-attempt state=pending/);
  assert.match(prompt, /1\. SUPPLEMENTAL_TOKEN/);
  assert.match(prompt, /Main communication report path \(communication file\): MAIN_REPORT_TOKEN/);
  assert.match(prompt, /Latest task record path \(record file\): TASK_RECORD_TOKEN/);
  assert.doesNotMatch(prompt, /^Record file:/m);
  assert.doesNotMatch(prompt, /^Main communication file:/m);
  assert.match(prompt, /Current attempt report path: communicationFile of subtask sub-current/);
  assert.match(prompt, /ROOT_REQUEST_TOKEN/);
  assert.doesNotMatch(prompt, /\/Users\//);
  assert.doesNotMatch(prompt, /example-review-event-id/);
});

test("omits a live event id when nothing is under review and still parses every example", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    kind: "initial",
    currentEventId: "   ",
    view: view({
      phase: "waiting",
      running: [execution("sub-running", "running")],
      visibleReviewCount: 0,
      blockers: ["running"],
    }),
  }));
  assert.match(prompt, /Current review eventId: \(none\)/);
  assert.match(prompt, /Current review item: \(none\)/);
  assert.match(prompt, /Review queue count: 0/);
  assert.match(prompt, /Visible review count including the current item: 0/);
  assert.match(prompt, /Current attempt report path: \(no current item\)/);
  assert.match(prompt, /There is no frozen acceptance event/);
  const examples = extractProtocolExamples(prompt);
  assert.deepEqual([...examples.keys()], ["dispatch", "wait", "steer", "blocked", "clarify"]);
  for (const status of examples.keys()) {
    assert.equal(parseExample(examples, status).reviewEventId, undefined);
  }
  assert.equal(parseExample(examples, "wait").status, "wait");
  assert.equal(parseExample(examples, "blocked").status, "blocked");
  const dispatch = parseExample(examples, "dispatch");
  assert.equal(dispatch.subtasks?.length, 4);
  assert.deepEqual(dispatch.subtasks?.map((subtask) => subtask.taskType), ["backend", "frontend", "backend", "general"]);
  assert.equal(new Set(dispatch.subtasks?.map((subtask) => subtask.conflictGroup)).size, 4);
  assert.match(prompt, /Keep planning, decomposition, repository reasoning, and ordinary read-only thinking in this main decision by default/);
  assert.match(prompt, /large enough to split into at least two independent analysis tracks/);
  assert.match(prompt, /dispatch at least two general subtasks together/);
  assert.match(prompt, /prefer one dispatch containing multiple independent coding subtasks/);
});

test("shows real concurrency capacity and encourages useful multi-task delivery in both modes", () => {
  for (const loopSubtaskMode of ["split", "fullstack"] as const) {
    const prompt = buildLoopPlusMainModelPrompt(mainContext({
      loopSubtaskMode,
      view: view({ running: [execution("busy", "running")] }),
    }));
    assert.match(prompt, /Scheduler concurrency limit: 6/);
    assert.match(prompt, /Available concurrency slots in this snapshot: 5/);
    assert.match(prompt, /Decision subtask limit: 6/);
    assert.match(prompt, /aim to fill the configured concurrency limit of 6 with necessary work/);
    assert.match(prompt, /Do not stop at three tasks when more necessary independent work can run/);
    assert.match(prompt, /Two roles do not mean a two-task limit/);
    assert.match(prompt, /never create tiny or artificial tasks just to fill capacity/);
    assert.match(prompt, /On dispatch and accept, look for ready independent work to refill free slots/);
    assert.match(prompt, /Do not duplicate running or pending tasks/);
    assert.match(prompt, /not actual review verdicts, a fixed task count, or a role quota/);
    assert.doesNotMatch(prompt, /Keep one coding subtask when the work shares files/);
    assert.doesNotMatch(prompt, /keep shared or dependent work together/);
  }
});

test("parallel examples obey single-decision and scheduler limits including a one-task cap", () => {
  for (const { subtaskMax, maxConcurrency, expectedCount } of [
    { subtaskMax: 1, maxConcurrency: 6, expectedCount: 1 },
    { subtaskMax: 2, maxConcurrency: 6, expectedCount: 2 },
    { subtaskMax: 3, maxConcurrency: 6, expectedCount: 3 },
    { subtaskMax: 6, maxConcurrency: 2, expectedCount: 2 },
    { subtaskMax: 6, maxConcurrency: 1, expectedCount: 1 },
    { subtaskMax: 20, maxConcurrency: 6, expectedCount: 4 },
  ]) {
    const prompt = buildLoopPlusMainModelPrompt(mainContext({ subtaskMax, maxConcurrency }));
    const examples = extractProtocolExamples(prompt);
    for (const [status, jsonText] of examples) {
      const parsed = parseLoopPlusDecision(jsonText, { subtaskMax });
      assert.equal(parsed?.status, status);
    }
    const dispatch = parseExample(examples, "dispatch");
    assert.equal(dispatch.subtasks?.length, expectedCount);
    if (Math.min(subtaskMax, maxConcurrency) < 3) {
      assert.doesNotMatch(prompt, /aim for 3 to/);
      assert.match(prompt, new RegExp(`Use up to ${expectedCount} useful independent subtasks`));
    }
  }
});

test("reports occupied reservations without counting blocked pending tasks as running slots", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    maxConcurrency: 2,
    view: view({
      running: [execution("one", "running"), execution("two", "running"), execution("three", "running")],
      pending: [execution("blocked", "pending")],
    }),
  }));
  assert.match(prompt, /Available concurrency slots in this snapshot: 0/);
  assert.match(prompt, /Still pending count: 1/);
  const backfill = buildLoopPlusMainModelPrompt(mainContext({
    maxConcurrency: 3,
    view: view({
      running: [execution("one", "running")],
      pending: [execution("blocked", "pending")],
    }),
  }));
  assert.match(backfill, /Available concurrency slots in this snapshot: 2/);
});

test("allows rare incidental edits without weakening known write-conflict protection", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext());
  assert.match(prompt, /Shared read-only context is not a write conflict/);
  assert.match(prompt, /Declare every known shared write path honestly/);
  assert.match(prompt, /Known overlapping writeFiles or conflictGroup remain serialized by the host/);
  assert.match(prompt, /serialize only that part and continue unrelated deliverables/);
  assert.match(prompt, /Rare small incidental cross-scope edits are acceptable/);
  assert.match(prompt, /Do not deliberately schedule competing edits to the same symbols or contract/);
  for (const taskType of ["backend", "frontend", "general"] as const) {
    const subtaskPrompt = buildLoopPlusSubtaskModelPrompt({
      subtask: { id: taskType, title: taskType, taskType, prompt: "TASK_TOKEN" },
      communicationFile: "REPORT_TOKEN",
    });
    if (taskType === "general") {
      assert.doesNotMatch(subtaskPrompt, /Reconcile small disjoint edits locally/);
      assert.match(subtaskPrompt, /This attempt is analysis only/);
    } else {
      assert.match(subtaskPrompt, /Re-read the latest file before writing/);
      assert.match(subtaskPrompt, /do not revert or overwrite their work/);
      assert.match(subtaskPrompt, /Reconcile small disjoint edits locally/);
      assert.match(subtaskPrompt, /report the dependency to the main model/);
    }
  }
});

test("every main mode and decision kind plans remaining-goal delivery alongside acceptance repairs", () => {
  for (const loopSubtaskMode of ["fullstack", "split"] as const) {
    for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
      const prompt = buildLoopPlusMainModelPrompt(mainContext({ kind, loopSubtaskMode }));
      assert.match(prompt, /Every accept is also a remaining-goal planning decision/);
      assert.match(prompt, /re-read all unfinished root and supplemental requirements/);
      assert.match(prompt, /dispatch ready independent deliverables alongside necessary repairs in the same accept/);
      assert.match(prompt, /A failed check or a repair in progress is not a global barrier/);
      assert.match(prompt, /Before dispatching only a repair or leaving usable slots idle, record the concrete reason/);
      assert.match(prompt, /Every accept\.subtasks id must appear exactly once across reviews\[\*\]\.subtaskIds and independentSubtaskIds/);
      assert.match(prompt, /Never attach independent work to a failed review just to satisfy linkage/);
      assert.match(prompt, /independentSubtaskIds do not inherit a failed event's session/);
      assert.match(prompt, /Maximum acceptance batch size: 4/);
      assert.match(prompt, /Review at most 4 subtasks per decision, exactly the frozen acceptance batch/);
      assert.match(prompt, /This review limit does not cap running subtasks or new dispatches/);
      assert.match(prompt, /do not wait for later review batches before launching safe independent work/);
      assert.match(prompt, /New dispatch is conditional on the final goal still needing that work/);
      assert.match(prompt, /If all requirements are satisfied, launch no new subtasks/);
      assert.match(prompt, /genuinely blocked pending tasks do not reserve idle slots/);
      assert.match(prompt, /accept without new subtasks and wait or continue the next review batch/);
      assert.doesNotMatch(prompt, /If a failed event cannot be repaired by a subtask, send blocked/);
    }
  }
});

test("single and batched accept examples combine a focused repair with independent deliveries within limits", () => {
  for (const eventIds of [["event-one"], ["event-one", "event-two"]]) {
    for (const capacity of [1, 2, 3, 6]) {
      const prompt = buildLoopPlusMainModelPrompt(mainContext({
        acceptanceEventIds: eventIds, subtaskMax: capacity, maxConcurrency: capacity,
        view: view({ currentReview: review(eventIds[0], "example-source-first"),
          reviewQueue: eventIds.slice(1).map((id) => review(id, "example-source-last")), visibleReviewCount: eventIds.length }),
      }));
      const json = extractProtocolExamples(prompt).get("accept");
      const decision = parseLoopPlusDecision(json, { subtaskMax: capacity, requireAcceptanceFeedback: true, requireProgressPercent: true });
      assert.ok(decision);
      assert.equal(decision.subtasks?.length, Math.min(2, capacity));
      const repairs = decision.reviews?.filter((item) => item.acceptance === "failed").flatMap((item) => item.subtaskIds ?? []);
      assert.deepEqual(repairs, [eventIds.length === 1 ? "example-source-first" : "example-source-last"]);
      assert.match(decision.subtasks![0].prompt, /Repair the failed check/);
      assert.deepEqual(decision.independentSubtaskIds ?? [], decision.subtasks!.slice(1).map((item) => item.id));
      assert.equal(new Set(decision.subtasks?.map((item) => item.conflictGroup)).size, decision.subtasks!.length);
      assert.equal(decision.acceptance?.passed, false);
      assert.match(prompt, /judge real events from evidence/);
    }
  }
});

test("frozen review linkage lists every batch item and keeps failed or stopped rules", () => {
  const batch = [
    review("event-pass", "sub-pass"),
    { ...review("event-fail-a", "sub-fail-a"), outcome: "failed" as const },
    review("event-mid", "sub-mid"),
    { ...review("event-fail-b", "sub-fail-b"), outcome: "stopped" as const },
  ];
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    acceptanceEventIds: batch.map((item) => item.eventId),
    currentEventId: batch[0].eventId,
    view: view({
      currentReview: batch[0],
      reviewQueue: batch.slice(1),
      visibleReviewCount: batch.length,
    }),
  }));
  const section = linkageSection(prompt);
  assert.match(section, /This prompt does not choose the verdict/);
  assert.match(section, /Do not infer a failed review's link from subtasks order/);
  assert.match(section, /that fill is not the verdict for this snapshot/);
  assert.match(section, /outcome is failed or stopped is an acceptance failure/);
  assert.deepEqual(frozenReviewItems(section), batch.map((item, reviewIndex) => ({
    reviewIndex,
    eventId: item.eventId,
    originalLogicalSubtaskId: item.subtaskId,
    outcome: item.outcome,
  })));
  for (const [batchIndex, item] of batch.entries()) {
    const repairLine = section.split("\n").find((line) => line.startsWith(`If reviews[${batchIndex}] acceptance is failed and this event needs repair:`));
    const noRepairLine = section.split("\n").find((line) => line.startsWith(`If reviews[${batchIndex}] acceptance is failed and this event needs no repair:`));
    assert.ok(repairLine && noRepairLine);
    assert.ok(repairLine.includes(JSON.stringify({
      reviewEventId: item.eventId,
      acceptance: "failed",
      reason: "<evidence-backed reason>",
      subtaskIds: [item.subtaskId],
    })));
    assert.match(repairLine, new RegExp(`exactly one subtasks entry whose id is ${escapeRegExp(JSON.stringify(item.subtaskId))}`));
    assert.match(repairLine, /only this original logical subtask id/);
    assert.equal(repairLine.includes("independentSubtaskIds"), false);
    assert.ok(noRepairLine.includes(JSON.stringify({
      reviewEventId: item.eventId,
      acceptance: "failed",
      reason: "<evidence-backed reason>",
      noRepairReason: "<non-empty evidence-backed reason that no repair is needed>",
    })));
    assert.match(noRepairLine, /Omit subtaskIds/);
    assert.equal(noRepairLine.includes('"subtaskIds"'), false);
  }
  assert.match(section, /Independent remaining-goal work is associated only through accept\.independentSubtaskIds/);
  assert.match(section, /appears exactly once across reviews\[\*\]\.subtaskIds and independentSubtaskIds/);
  assert.match(section, /Do not put a repair id in independentSubtaskIds/);
  assert.match(section, /Do not put an independent id in a failed review's subtaskIds/);
  assert.equal(parseLoopPlusDecision(extractProtocolExamples(prompt).get("accept"))?.status, "accept");
});

test("completed executions still offer mixed failed dispositions, and empty or late batches stay out", () => {
  const doneA = review('event-"a"', 'sub-"a"');
  const doneB = review("event-b\n}", "sub-b\\id");
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    acceptanceEventIds: [doneA.eventId, doneB.eventId],
    view: view({
      currentReview: doneA,
      reviewQueue: [doneB, { ...review("event-late\n}", "sub-late"), outcome: "failed" }],
      visibleReviewCount: 3,
    }),
  }));
  const section = linkageSection(prompt);
  assert.doesNotMatch(section, /outcome is failed or stopped is an acceptance failure/);
  assert.deepEqual(frozenReviewItems(section), [
    { reviewIndex: 0, eventId: doneA.eventId, originalLogicalSubtaskId: doneA.subtaskId, outcome: "completed" },
    { reviewIndex: 1, eventId: doneB.eventId, originalLogicalSubtaskId: doneB.subtaskId, outcome: "completed" },
  ]);
  assert.equal(section.includes("event-late"), false);
  assert.equal(section.includes("sub-late"), false);
  for (const [batchIndex, item] of [doneA, doneB].entries()) {
    assert.ok(section.includes(`If reviews[${batchIndex}] acceptance is failed and this event needs repair: ${JSON.stringify({
      reviewEventId: item.eventId,
      acceptance: "failed",
      reason: "<evidence-backed reason>",
      subtaskIds: [item.subtaskId],
    })}`));
    assert.ok(section.includes(`If reviews[${batchIndex}] acceptance is failed and this event needs no repair: ${JSON.stringify({
      reviewEventId: item.eventId,
      acceptance: "failed",
      reason: "<evidence-backed reason>",
      noRepairReason: "<non-empty evidence-backed reason that no repair is needed>",
    })}`));
    assert.ok(section.includes(`whose id is ${JSON.stringify(item.subtaskId)}`));
  }
  assert.match(section, /appears exactly once/);

  const empty = buildLoopPlusMainModelPrompt(mainContext({
    acceptanceEventIds: [],
    view: view({
      currentReview: { ...review("event-late", "sub-late"), outcome: "failed" },
      reviewQueue: [review("event-later", "sub-later")],
      visibleReviewCount: 2,
    }),
  }));
  assert.equal(empty.includes("Frozen review linkage from this snapshot, in frozen order."), false);
  assert.match(empty, /eventId=event-late subtask=sub-late/);
});

test("failed reviews without repair linkage stay rejected, including duplicate independent ids", () => {
  const reviewEventIds = ["event-pass", "event-fail-a", "event-mid", "event-fail-b"];
  const subtask = (id: string) => ({ id, title: id, prompt: `Repair or deliver ${id}`, taskType: "backend" as const });
  const passed = (reviewEventId: string) => ({ reviewEventId, acceptance: "passed" as const, reason: "证据通过" });
  const base = {
    status: "accept" as const,
    progressPercent: 74,
    reviewEventIds,
    acceptance: {
      passed: false,
      checks: [
        { name: "dispatched work", passed: true, detail: "已交付" },
        { name: "contracts", passed: true, detail: "契约保持" },
        { name: "tests", passed: false, detail: "失败项仍未关联返工" },
        { name: "artifacts", passed: true, detail: "无新产物" },
        { name: "unauthorized changes", passed: true, detail: "无无关改动" },
        { name: "omissions and regressions", passed: false, detail: "两处失败未处置" },
      ],
    },
  };
  const unlinked = {
    ...base,
    reviews: [
      passed("event-pass"),
      { reviewEventId: "event-fail-a", acceptance: "failed" as const, reason: "编译失败" },
      passed("event-mid"),
      { reviewEventId: "event-fail-b", acceptance: "failed" as const, reason: "终态缺失" },
    ],
    subtasks: [subtask("sub-fail-a"), subtask("sub-fail-b"), subtask("sub-independent")],
    independentSubtaskIds: ["sub-independent"],
  };
  assert.equal(parseLoopPlusDecision(JSON.stringify(unlinked), { requireAcceptanceFeedback: true, requireProgressPercent: true }), null);

  const eachRepair = parseLoopPlusDecision(JSON.stringify({
    ...base,
    reviews: [
      passed("event-pass"),
      { reviewEventId: "event-fail-a", acceptance: "failed", reason: "编译失败", subtaskIds: ["sub-fail-a"] },
      passed("event-mid"),
      { reviewEventId: "event-fail-b", acceptance: "failed", reason: "终态缺失", subtaskIds: ["sub-fail-b"] },
    ],
    subtasks: [subtask("sub-fail-a"), subtask("sub-fail-b"), subtask("sub-independent")],
    independentSubtaskIds: ["sub-independent"],
  }), { requireAcceptanceFeedback: true, requireProgressPercent: true });
  assert.deepEqual(eachRepair?.reviews?.map((item) => item.subtaskIds ?? item.noRepairReason), [
    undefined, ["sub-fail-a"], undefined, ["sub-fail-b"],
  ]);
  assert.deepEqual(eachRepair?.independentSubtaskIds, ["sub-independent"]);

  const noRepair = parseLoopPlusDecision(JSON.stringify({
    ...base,
    reviews: [
      passed("event-pass"),
      { reviewEventId: "event-fail-a", acceptance: "failed", reason: "编译失败", noRepairReason: "该失败已由后续独立交付覆盖" },
      passed("event-mid"),
      { reviewEventId: "event-fail-b", acceptance: "failed", reason: "终态缺失", subtaskIds: ["sub-fail-b"] },
    ],
    subtasks: [subtask("sub-fail-b"), subtask("sub-independent")],
    independentSubtaskIds: ["sub-independent"],
  }), { requireAcceptanceFeedback: true, requireProgressPercent: true });
  assert.equal(noRepair?.reviews?.[1].noRepairReason, "该失败已由后续独立交付覆盖");
  assert.equal(noRepair?.reviews?.[1].subtaskIds, undefined);
  assert.deepEqual(noRepair?.independentSubtaskIds, ["sub-independent"]);

  const duplicated = parseLoopPlusDecision(JSON.stringify({
    ...unlinked,
    reviews: [
      passed("event-pass"),
      { reviewEventId: "event-fail-a", acceptance: "failed", reason: "编译失败", subtaskIds: ["sub-fail-a"] },
      passed("event-mid"),
      { reviewEventId: "event-fail-b", acceptance: "failed", reason: "终态缺失", noRepairReason: "不再返工" },
    ],
    subtasks: [subtask("sub-fail-a"), subtask("sub-independent")],
    independentSubtaskIds: ["sub-fail-a", "sub-independent"],
  }), { requireAcceptanceFeedback: true, requireProgressPercent: true });
  assert.equal(duplicated, null);

  const bothFields = parseLoopPlusDecision(JSON.stringify({
    ...base,
    reviews: [
      passed("event-pass"),
      { reviewEventId: "event-fail-a", acceptance: "failed", reason: "编译失败", noRepairReason: "不返工", subtaskIds: ["sub-fail-a"] },
      passed("event-mid"),
      { reviewEventId: "event-fail-b", acceptance: "failed", reason: "终态缺失", subtaskIds: ["sub-fail-b"] },
    ],
    subtasks: [subtask("sub-fail-a"), subtask("sub-fail-b")],
  }), { requireAcceptanceFeedback: true, requireProgressPercent: true });
  assert.equal(bothFields, null);
});

test("a multi-event acceptance batch is confirmed in order and includes the user messages", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    acceptanceEventIds: ["event-live-42", "event-queued-7"],
    pendingUserMessages: ["cover the queued failure"],
    view: view({
      currentReview: review("event-live-42", "sub-current"),
      reviewQueue: [review("event-queued-7", "sub-queued")],
      visibleReviewCount: 2,
    }),
  }));
  assert.match(prompt, /Acceptance batch count: 2/);
  assert.match(prompt, /1\. event-live-42/);
  assert.match(prompt, /2\. event-queued-7/);
  assert.match(prompt, /1\. cover the queued failure/);
  assert.match(prompt, /read those messages in the same decision/);
  const examples = extractProtocolExamples(prompt);
  const accept = JSON.parse(examples.get("accept") ?? "{}") as Record<string, unknown>;
  assert.deepEqual(accept.reviewEventIds, ["event-live-42", "event-queued-7"]);
  assert.equal(Object.prototype.hasOwnProperty.call(accept, "reviewEventId"), false);
  const parsed = parseLoopPlusDecision(JSON.stringify(accept));
  assert.deepEqual(parsed?.reviewEventIds, ["event-live-42", "event-queued-7"]);
  assert.deepEqual(parsed?.reviews, [
    { reviewEventId: "event-live-42", acceptance: "passed", reason: "实现符合需求且验证证据通过" },
    { reviewEventId: "event-queued-7", acceptance: "failed", reason: "用例失败，需先修复断言", subtaskIds: ["sub-queued"] },
  ]);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    ...accept,
    reviewEventId: "event-live-42",
  })), null);
});

test("subtask prompt treats write scope as a suggestion and keeps the attempt report", () => {
  const prompt = buildLoopPlusSubtaskModelPrompt({
    subtask: {
      id: "sub-token",
      title: "title-token",
      prompt: "INSTRUCTION_TOKEN",
      writeFiles: ["src/authorized-scope.ts"],
      conflictGroup: "group-token",
    },
    communicationFile: "ATTEMPT_REPORT_TOKEN",
  });
  assert.match(prompt, /independent Loop\+ execution attempt/);
  assert.match(prompt, /Complete only this attempt and write its report/);
  assert.match(prompt, /Suggested write scope: src\/authorized-scope\.ts/);
  assert.match(prompt, /not a hard limit/);
  assert.doesNotMatch(prompt, /Edit files only inside/);
  assert.match(prompt, /Attempt report file: ATTEMPT_REPORT_TOKEN/);
  assert.match(prompt, /Do not modify scheduling state, active ids, the loopPlus snapshot, the task record/);
  assert.match(prompt, /If the subtask instructions include a UI design, implement that design/);
  assert.match(prompt, /INSTRUCTION_TOKEN/);
  assert.equal(prompt.includes("group-token"), false);
  assert.equal(prompt.includes("ROOT_REQUEST_TOKEN"), false);
  assert.equal(prompt.includes("TASK_RECORD_TOKEN"), false);
  assert.equal(prompt.includes("LOOP_PLUS_PROTOCOL_EXAMPLE"), false);
  assert.equal(prompt.toLowerCase().includes("round"), false);
  assert.equal(prompt.includes("roundSummaries"), false);
  assert.equal(prompt.includes("continue"), false);
  assert.doesNotMatch(prompt, /\/Users\//);
  assert.doesNotMatch(prompt, /sinitek_cli/);

  const emptyPaths = buildLoopPlusSubtaskModelPrompt({
    subtask: {
      title: "title-token",
      prompt: "INSTRUCTION_TOKEN",
    },
    communicationFile: "",
  });
  assert.match(emptyPaths, /Attempt report file: \n/);
  assert.equal(emptyPaths.includes("Task record file"), false);
  assert.match(emptyPaths, /Suggested write scope: \(not declared; edit the workspace files this attempt requires\)/);
  assert.doesNotMatch(emptyPaths, /\/Users\//);
  assert.equal(emptyPaths.toLowerCase().includes("round"), false);
});

test("asks the main task to judge a batch of new user messages before launching", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    kind: "user",
    pendingUserMessages: ["FIRST_USER_MESSAGE", "SECOND_USER_MESSAGE"],
    view: view({
      phase: "waiting",
      running: [execution("sub-running", "running")],
      blockers: ["running", "user_messages"],
      canComplete: false,
    }),
  }));
  assert.match(prompt, /Prompt kind: user/);
  assert.match(prompt, /1\. FIRST_USER_MESSAGE/);
  assert.match(prompt, /2\. SECOND_USER_MESSAGE/);
  assert.match(prompt, /judge the whole list together/);
  assert.match(prompt, /wait when live execution or ready pending work can advance, including after finishing a trivial supplemental request/);
  assert.match(prompt, /Do not dispatch a placeholder just to wait/);
});

test("hides generated Loop+ protocol prompts but not ordinary or mid-sentence text", () => {
  const mainPrompt = buildLoopPlusMainModelPrompt(mainContext());
  assert.match(mainPrompt, /Loop\+ subtask mode: split/);
  assert.match(mainPrompt, /Frontend coding uses the frontend sub-model/);
  const fullstackPrompt = buildLoopPlusMainModelPrompt(mainContext({
    loopSubtaskMode: "fullstack",
    routingSummary: "mode=fullstack coding=dsh / fullstack-model analysis=codex / main-model",
  }));
  assert.match(fullstackPrompt, /Loop\+ subtask mode: fullstack/);
  assert.match(fullstackPrompt, /Do not split coding into frontend and backend only to choose different models/);
  assert.match(fullstackPrompt, /One fullstack model is not a one-task limit/);
  assert.match(fullstackPrompt, /mode=fullstack coding=dsh \/ fullstack-model/);
  assert.match(mainPrompt, /When the task changes UI appearance, layout, or interaction/);
  const subtaskPrompt = buildLoopPlusSubtaskModelPrompt({
    subtask: {
      title: "title-token",
      prompt: "INSTRUCTION_TOKEN",
    },
    communicationFile: "attempt-report",
  });
  assert.equal(isHiddenLoopPlusProtocolPrompt(mainPrompt), true);
  assert.match(mainPrompt, /Any earlier task list in this thread is stale/);
  assert.match(mainPrompt, /do not expect the subtask to rediscover the decision/);
  assert.match(mainPrompt, /preserve the agreed contract/);
  assert.doesNotMatch(subtaskPrompt, /Any earlier task list in this thread is stale/);
  assert.equal(isHiddenLoopPlusProtocolPrompt(`\n${subtaskPrompt}`), true);
  assert.equal(isHiddenLoopPlusProtocolPrompt("fix the bubble"), false);
  assert.equal(isHiddenLoopPlusProtocolPrompt("请看 You are the Loop+ main reviewer."), false);
  assert.equal(isHiddenLoopPlusProtocolPrompt(""), false);
  assert.equal(isHiddenLoopPlusProtocolPrompt(null), false);
});


test("reviews three evidence pairs but submits six distinct checks", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    view: view({
      currentReview: review("event-live-42", "sub-current"),
      visibleReviewCount: 1,
    }),
  }));
  assert.match(prompt, /For each non-cancelled event, review these three pairs\. Read shared evidence once/);
  assert.match(prompt, /dispatched work \+ unauthorized changes: .*diff against all requested work.*out-of-scope edit/);
  assert.match(prompt, /contracts \+ omissions and regressions: .*affected callers.*omissions, regressions and edge cases/);
  assert.match(prompt, /tests \+ artifacts: .*actual test and startup results.*A passing test or build does not prove startup/);
  assert.match(prompt, /accept\.reviews is required/);
  assert.match(prompt, /Do not mark a successful event failed because another event fails or launches a subtask/);
  assert.match(prompt, /Return blocked, confirming nothing, only when no safe independent work or live dependency can advance the goal/);
  const completed = parseExample(extractProtocolExamples(prompt), "completed");
  assert.deepEqual(completed.acceptance?.checks.map((check) => check.name), LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES);
  assert.equal(completed.acceptance?.checks.every((check) => check.passed === true), true);
});

test("injects the confirmed acceptance plan into every main prompt kind without touching the fixed checklist", () => {
  const acceptancePlan = {
    id: "plan-hardening",
    name: "上线前加严",
    checks: ["security", "other"] as const,
    otherText: "确认审计日志不写入密钥",
    systemDefault: false,
  };
  const fixedChecklistNames = [
    "dispatched work",
    "contracts",
    "tests",
    "artifacts",
    "unauthorized changes",
    "omissions and regressions",
  ];
  for (const kind of ["initial", "review", "closeout", "continue", "user"] as const) {
    const prompt = buildLoopPlusMainModelPrompt(mainContext({
      kind,
      acceptancePlan: { ...acceptancePlan, checks: [...acceptancePlan.checks] },
    }));
    assert.match(prompt, /Additional acceptance reviews from the acceptance plan "上线前加严"/);
    assert.match(prompt, /Security review: defensive code review only/);
    assert.ok(prompt.indexOf("Security review:") < prompt.indexOf("User-supplied review content"));
    assert.match(prompt, /确认审计日志不写入密钥/);
    assert.doesNotMatch(prompt, /Maintainability review/);
    fixedChecklistNames.forEach((name) => {
      assert.match(prompt, new RegExp(name));
    });
    assert.match(prompt, /all six named checks, each with its own passed and brief evidence-backed detail/);
    assert.match(prompt, /Explain genuine non-applicability\. Mark applicable but unverified checks false/);
    assert.match(prompt, /Do not implement or repair that dispatched work yourself/);
  }
});

test("a system-default or missing acceptance plan adds no extra review section", () => {
  const withoutPlan = buildLoopPlusMainModelPrompt(mainContext({ kind: "review" }));
  assert.doesNotMatch(withoutPlan, /Additional acceptance reviews/);

  const systemPlan = buildLoopPlusMainModelPrompt(mainContext({
    kind: "review",
    acceptancePlan: {
      id: "system_default",
      name: "系统默认",
      checks: [],
      otherText: "",
      systemDefault: true,
    },
  }));
  assert.doesNotMatch(systemPlan, /Additional acceptance reviews/);
  assert.equal(systemPlan, withoutPlan);
});


test("dependency prompts expose latest attempts, success gates, repair semantics and valid JSON", () => {
  const dependencyBlocks = [{ subtaskId: "child", attemptId: "child-1", dependencyId: "source", dependencyAttemptId: "source-2", reason: "closed" as const }];
  const prompt = buildLoopPlusMainModelPrompt(mainContext({ view: view({ dependencyBlocks }) }));
  assert.match(prompt, /child attempt=child-1 dependsOn=source latestAttempt=source-2 reason=closed/);
  for (const clause of [/stable subtask ids/, /continueFromSubtaskId selects a session and never implies dependsOn/, /latest attempt/, /report acknowledgement is not required for execution admission/, /forward-reference/, /Unknown ids/, /cycles/, /already known logical ids/, /omission of dependsOn inherits/, /\[\] clears/, /same logical id/, /wait cannot make progress/, /no whole-batch barrier/]) {
    assert.match(prompt, clause);
  }
  const json = prompt.split("Dependency protocol example (prerequisite-id is an already known logical id): ")[1].split("\n")[0];
  const parsed = parseLoopPlusDecision(json);
  assert.deepEqual(parsed?.subtasks?.[0].dependsOn, ["prerequisite-id"]);
  const childPrompt = buildLoopPlusSubtaskModelPrompt({
    subtask: { id: "child", title: "child", prompt: "implement dependency", dependsOn: ["source"] }, communicationFile: "report.md",
  });
  assert.match(childPrompt, /dependsOn.*source/);
  assert.match(childPrompt, /latest attempt completes and passes acceptance/);
  assert.match(childPrompt, /Session continuation is separate from dependencies/);
});

for (const { name, task, acceptanceRequired } of [
  { name: "ordinary Loop+", task: {}, acceptanceRequired: false },
  { name: "department Loop+", task: { department: { role: "leader" } }, acceptanceRequired: true },
] as const) {
  test(`${name} main and subtask prompts describe the configured dependency admission gate`, () => {
    const scheduler = createLoopPlusScheduler({
      maxConcurrency: 2,
      requireAcceptedDependencies: requiresLoopPlusAcceptedDependencies(task),
    });
    const requireAcceptedDependencies = scheduler.requireAcceptedDependencies;
    assert.equal(requireAcceptedDependencies, acceptanceRequired);
    const mainPrompt = buildLoopPlusMainModelPrompt(mainContext({ requireAcceptedDependencies }));
    const subtaskPrompt = buildLoopPlusSubtaskModelPrompt({
      subtask: { id: "child", title: "child", prompt: "implement dependency", dependsOn: ["source"] },
      communicationFile: "report.md",
      requireAcceptedDependencies,
    });
    const executionGate = /latest attempt completes successfully \(outcome completed\) and is not closed\. Acceptance or report acknowledgement is not required for execution admission/;
    const acceptanceGate = /latest attempt completes and passes acceptance, or completes with requiresAcceptance=false and its report is acknowledged/;
    for (const prompt of [mainPrompt, subtaskPrompt]) {
      assert.match(prompt, acceptanceRequired ? acceptanceGate : executionGate);
      assert.doesNotMatch(prompt, acceptanceRequired ? executionGate : acceptanceGate);
    }
    assert.match(mainPrompt, /Review ordering is separate from execution admission/);
    assert.doesNotMatch(mainPrompt, /Cancelled prerequisites never release pending successors/);
    assert.match(subtaskPrompt, /Explicit prerequisite subtask ids \(dependsOn\): \["source"\]/);
    assert.match(subtaskPrompt, /Session continuation is separate from dependencies/);
  });
}

function helperContextFromPrompt(prompt: string): ReturnType<typeof buildLoopPlusDecisionHelperPromptContext> {
  const marker = "LOOP_PLUS_DECISION_HELPER_CONTEXT\n```json\n";
  const start = prompt.indexOf(marker);
  assert.ok(start >= 0, "missing decision helper context");
  const jsonStart = start + marker.length;
  const jsonEnd = prompt.indexOf("\n```", jsonStart);
  assert.ok(jsonEnd > jsonStart);
  return JSON.parse(prompt.slice(jsonStart, jsonEnd)) as ReturnType<typeof buildLoopPlusDecisionHelperPromptContext>;
}

function decisionHelperSection(prompt: string): string {
  const start = prompt.indexOf("Decision helper:");
  const end = prompt.indexOf("Valid protocol examples follow.");
  assert.ok(start >= 0 && end > start);
  return prompt.slice(start, end);
}

test("main and department-leader prompts keep the frozen helper context and exclude late events", () => {
  const reports = ["report-z-first", "report-a-second"];
  const frozenReviews = [
    review("event-z", "sub-z"),
    review("event-a", "sub-a"),
    review("event-c", "sub-c"),
    review("event-b", "sub-b"),
  ];
  const late = review("event-late", "sub-late");
  const acceptancePlan: LoopPlusAcceptancePlanSnapshot = {
    id: "plan-security",
    name: "安全审查",
    checks: ["security"],
    otherText: "",
    systemDefault: false,
  };
  const frozen = mainContext({
    acceptanceEventIds: frozenReviews.map((item) => item.eventId),
    reportEventIds: reports,
    allowDirectCompletion: false,
    acceptancePlan,
    view: view({
      currentReview: frozenReviews[0],
      reviewQueue: [...frozenReviews.slice(1), late],
      visibleReviewCount: frozenReviews.length + 1,
      reportQueue: [
        { eventId: reports[0], subtaskId: "report-z", attemptId: "r1", outcome: "completed", detail: "first" },
        { eventId: reports[1], subtaskId: "report-a", attemptId: "r2", outcome: "completed", detail: "second" },
        { eventId: "report-late", subtaskId: "report-late", attemptId: "r3", outcome: "completed", detail: "late" },
      ],
    }),
  });
  const prompt = buildLoopPlusMainModelPrompt(frozen);
  const embedded = helperContextFromPrompt(prompt);
  assert.deepEqual(embedded, buildLoopPlusDecisionHelperPromptContext(frozen));
  assert.equal(embedded.v, 1);
  assert.deepEqual(embedded.reviews, frozenReviews.map((item) => ({ eventId: item.eventId, subtaskId: item.subtaskId })));
  assert.equal(embedded.reviews.some((item) => item.eventId === late.eventId), false);
  assert.deepEqual(embedded.reportEventIds, reports);
  assert.equal(embedded.reportEventIds.includes("report-late"), false);
  assert.deepEqual(embedded.acceptancePlanKeys, ["security"]);
  assert.equal(embedded.allowDirectCompletion, false);
  assert.equal(embedded.requireAcceptanceFeedback, true);
  assert.equal(embedded.requireProgressPercent, true);
  assert.equal(embedded.subtaskMax, LOOP_PLUS_DECISION_SUBTASK_MAX);
  assert.ok(embedded.statuses.includes("accept"));
  assert.equal(embedded.statuses.includes("completed"), false);
  const section = decisionHelperSection(prompt);
  assert.match(section, /did not supply dist\/loopPlusDecisionHelper\.js/);
  assert.doesNotMatch(section, /<extension install directory>/);
  assert.doesNotMatch(section, /template --status argv:/);
  assert.match(section, /UTF-8 JSON/);
  assert.match(section, /Prompt refresh and protocol correction keep this frozen context/);
  assert.match(section, /Do not add late events/);
  assert.match(section, /stderr names the field to correct/);
  assert.match(section, /return that stdout unchanged/);
  assert.match(section, /cannot execute tools at all/);
  assert.match(section, /tool permission and capability this CLI already has/);
  assert.match(section, /Do not copy those JSON checks/);
  assert.doesNotMatch(section, /须为数组/);
  assert.match(section, /Department leaders reuse this same helper/);
  assert.match(section, /The host rechecks the latest runtime state and submits/);
  const leaderPrompt = buildLoopPlusMainModelPrompt({
    ...frozen,
    departmentEmployeeCapacity: {
      rootTaskId: "root-task",
      leaderTaskId: "leader-task",
      maxEmployees: 4,
    },
  });
  assert.deepEqual(helperContextFromPrompt(leaderPrompt), embedded);
  const refreshed = buildLoopPlusMainModelPrompt({
    ...frozen,
    view: view({
      ...frozen.view,
      reviewQueue: [...frozenReviews.slice(1), late, review("event-later", "sub-later")],
      visibleReviewCount: frozenReviews.length + 2,
    }),
  });
  const refreshedContext = helperContextFromPrompt(refreshed);
  assert.deepEqual(refreshedContext.reviews, embedded.reviews);
  assert.deepEqual(refreshedContext.reportEventIds, embedded.reportEventIds);
  assert.equal(refreshedContext.reviews.some((item) => item.eventId === "event-later"), false);
});

function labeledHelperArgv(prompt: string, label: string): string[] {
  const line = prompt.split("\n").find((item) => item.startsWith(label));
  assert.ok(line, label);
  const argv = JSON.parse(line.slice(label.length)) as unknown;
  assert.ok(Array.isArray(argv));
  assert.equal(argv.length, 5);
  return argv.map((item) => {
    assert.equal(typeof item, "string");
    return item;
  });
}

function directoryIfNamePreserved(parent: string, name: string): string | null {
  const target = path.join(parent, name);
  try {
    fs.mkdirSync(target);
  } catch {
    return null;
  }
  try {
    return fs.readdirSync(parent).includes(name) ? target : null;
  } catch {
    return null;
  }
}

function writeInstallMarker(installDir: string, marker: string): string {
  const script = path.join(installDir, "dist", "loopPlusDecisionHelper.js");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, marker);
  return script;
}

function distinctDirectories(left: string, right: string): boolean {
  try {
    return fs.realpathSync(left) !== fs.realpathSync(right);
  } catch {
    return false;
  }
}

test("main and leader prompts share the loaded extension helper across a spaced path, another cwd, and refresh", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lp-helper-path-"));
  const portable = directoryIfNamePreserved(root, "Ext Install");
  assert.ok(portable, "portable install directory");
  const portableScript = writeInstallMarker(portable, "portable-marker\n");
  const plainTwin = directoryIfNamePreserved(root, "Twin Install");
  const trailingTwin = plainTwin ? directoryIfNamePreserved(root, "Twin Install ") : null;
  const trailing = plainTwin && trailingTwin && distinctDirectories(plainTwin, trailingTwin) ? trailingTwin : null;
  const plainScript = plainTwin ? writeInstallMarker(plainTwin, "plain-marker\n") : null;
  const trailingScript = trailing ? writeInstallMarker(trailing, "trailing-marker\n") : null;
  const install = trailing ?? portable;
  const script = trailingScript ?? portableScript;
  const sibling = path.join(root, "sinitek.sinitek-cli-tools-9.9.9", "dist", "loopPlusDecisionHelper.js");
  const workspaceScript = path.join(root, "workspace", "dist", "loopPlusDecisionHelper.js");
  const work = path.join(root, "other work");
  for (const file of [sibling, workspaceScript]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not-the-loaded-extension");
  }
  fs.mkdirSync(work);
  const previous = process.cwd();
  const decoy = `${workspaceScript} and ${sibling}`;
  try {
    process.chdir(install);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath("."), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(path.join("dist", "loopPlusDecisionHelper.js")), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(install), script);
    process.chdir(work);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(install), script);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(portable), portableScript);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(""), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath("   "), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(null), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(undefined), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(` ${install}`), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(`\t${install}`), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(`${install}\0`), null);
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(`${install}\0extra`), null);
    assert.notEqual(resolveLoopPlusDecisionHelperScriptPath(script), script);
    const missingInstall = path.join(root, "Missing Ext");
    const missingScript = path.join(missingInstall, "dist", "loopPlusDecisionHelper.js");
    assert.equal(resolveLoopPlusDecisionHelperScriptPath(missingInstall), missingScript);
    assert.equal(fs.existsSync(missingScript), false);
    assert.equal(fs.existsSync(sibling), true);
    if (trailing && trailingScript && plainScript) {
      assert.equal(resolveLoopPlusDecisionHelperScriptPath(trailing), trailingScript);
      assert.equal(resolveLoopPlusDecisionHelperScriptPath(plainTwin), plainScript);
      assert.notEqual(trailingScript, plainScript);
      assert.equal(fs.readFileSync(trailingScript, "utf8"), "trailing-marker\n");
      assert.equal(fs.readFileSync(plainScript, "utf8"), "plain-marker\n");
      assert.equal(resolveLoopPlusDecisionHelperScriptPath(` ${trailing}`), null);
    }
    const quotedInstall = directoryIfNamePreserved(root, "Ext \"Quote\" Install");
    const quotedScript = quotedInstall ? writeInstallMarker(quotedInstall, "quoted-marker\n") : null;
    if (quotedInstall && quotedScript) {
      assert.equal(resolveLoopPlusDecisionHelperScriptPath(quotedInstall), quotedScript);
    }

    const frozen = mainContext({
      rootPrompt: `do not run ${decoy}`,
      taskStoreFile: workspaceScript,
      decisionHelperScriptPath: script,
      acceptanceEventIds: ["event-z"],
      reportEventIds: ["report-z-first"],
      view: view({ currentReview: review("event-z", "sub-z"), reviewQueue: [review("event-late", "sub-late")] }),
    });
    const mainPrompt = buildLoopPlusMainModelPrompt(frozen);
    const leaderPrompt = buildLoopPlusMainModelPrompt({
      ...frozen,
      departmentEmployeeCapacity: { rootTaskId: "root-task", leaderTaskId: "leader-task", maxEmployees: 4 },
    });
    const mainArgv = labeledHelperArgv(mainPrompt, "template --status argv: ");
    const leaderArgv = labeledHelperArgv(leaderPrompt, "template --status argv: ");
    assert.deepEqual(mainArgv, ["node", script, "template", "--status", "STATUS"]);
    assert.deepEqual(leaderArgv, mainArgv);
    assert.deepEqual(labeledHelperArgv(mainPrompt, "build --status argv: "), ["node", script, "build", "--status", "STATUS"]);
    assert.equal(fs.readFileSync(mainArgv[1], "utf8"), fs.readFileSync(script, "utf8"));
    assert.equal(fs.realpathSync(mainArgv[1]), fs.realpathSync(script));
    assert.equal(fs.realpathSync(leaderArgv[1]), fs.realpathSync(script));
    if (trailingScript && plainScript) {
      assert.equal(mainArgv[1], trailingScript);
      assert.notEqual(mainArgv[1], plainScript);
      assert.equal(fs.readFileSync(mainArgv[1], "utf8"), "trailing-marker\n");
    }
    for (const prompt of [mainPrompt, leaderPrompt]) {
      const section = decisionHelperSection(prompt);
      assert.doesNotMatch(section, /<extension install directory>/);
      assert.doesNotMatch(section, /<status>/);
      assert.equal(section.includes(workspaceScript), false);
      assert.equal(section.includes(sibling), false);
      if (plainScript) assert.equal(section.includes(plainScript), false);
      assert.match(section, /argv\[1\] is one parameter/);
      assert.match(section, /Do not change this CLI's tool permission or capability/);
      assert.ok(section.indexOf("template --status") < section.indexOf("build --status"));
    }
    if (quotedScript) {
      const quotedPrompt = buildLoopPlusMainModelPrompt({ ...frozen, decisionHelperScriptPath: quotedScript });
      assert.equal(labeledHelperArgv(quotedPrompt, "template --status argv: ")[1], quotedScript);
    }
    const refreshed = buildLoopPlusMainModelPrompt({
      ...frozen,
      rootPrompt: `refresh must ignore ${decoy}`,
      view: view({
        currentReview: review("event-z", "sub-z"),
        reviewQueue: [review("event-late", "sub-late"), review("event-later", "sub-later")],
      }),
    });
    assert.deepEqual(labeledHelperArgv(refreshed, "template --status argv: "), mainArgv);
    assert.deepEqual(helperContextFromPrompt(refreshed).reviews, helperContextFromPrompt(mainPrompt).reviews);
    assert.deepEqual(helperContextFromPrompt(refreshed).reportEventIds, ["report-z-first"]);
    assert.equal(helperContextFromPrompt(refreshed).reviews.some((item) => item.eventId === "event-later"), false);
    const unavailable = decisionHelperSection(buildLoopPlusMainModelPrompt({
      ...frozen,
      decisionHelperScriptPath: path.join("dist", "loopPlusDecisionHelper.js"),
    }));
    assert.match(unavailable, /did not supply/);
    assert.doesNotMatch(unavailable, /template --status argv:/);
    assert.equal(unavailable.includes(sibling), false);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the macOS helper entry accepts one mixed batch after a field correction and rejects a bad collaboration", () => {
  assert.equal(process.platform, "darwin");
  const entry = path.join(__dirname, "../../loopPlusDecisionHelper.js");
  assert.equal(fs.existsSync(entry), true);
  const reports = ["report-z-first", "report-a-second"];
  const frozenReviews = [
    review("event-z", "sub-z"),
    review("event-a", "sub-a"),
    review("event-c", "sub-c"),
    review("event-b", "sub-b"),
  ];
  const request = mainContext({
    acceptanceEventIds: frozenReviews.map((item) => item.eventId),
    reportEventIds: reports,
    allowDirectCompletion: false,
    acceptancePlan: {
      id: "plan-security",
      name: "安全审查",
      checks: ["security"],
      otherText: "",
      systemDefault: false,
    },
    view: view({
      currentReview: frozenReviews[0],
      reviewQueue: [...frozenReviews.slice(1), review("event-late", "sub-late")],
      visibleReviewCount: 5,
    }),
  });
  const helperContext = buildLoopPlusDecisionHelperPromptContext(request);
  assert.equal(helperContext.reviews.some((item) => item.eventId === "event-late"), false);
  const checks = LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES.map((name) => ({
    name,
    passed: name !== "tests",
    detail: "证据已核对",
  }));
  const fields = {
    progressPercent: 23,
    reportEventIds: reports,
    acceptance: { passed: false, checks },
    acceptancePlanResults: [{ key: "security", passed: true, reason: "未引入新的安全暴露" }],
    reviews: [
      { acceptance: "failed", reason: "定向测试失败", repair: { id: "wrong-id", title: "返工", prompt: "按失败断言修复", taskType: "backend" } },
      { acceptance: "failed", reason: "失败但无需再改", noRepairReason: "需求已撤回，保留失败结论" },
      { acceptance: "cancelled", reason: "该交付不再需要验收" },
      { acceptance: "passed", reason: "实现与契约一致" },
    ],
    independentSubtasks: [{ id: "sub-new", title: "独立派发", prompt: "完成剩余交付并记录结果", taskType: "backend" }],
    departmentCollaborations: [{ id: "collab-1", targetLeaderTaskId: "leader-other", body: "请配合字段" }],
  };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lp516-decision-helper-"));
  const invoke = (inputFields: unknown) => spawnSync(process.execPath, [entry, "build", "--status", "accept"], {
    input: JSON.stringify({ context: helperContext, fields: inputFields }),
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  try {
    const rejected = invoke(fields);
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.equal(rejected.stdout, "");
    assert.match(rejected.stderr, /fields\.reviews\[0\]\.repair\.id/);
    assert.match(rejected.stderr, /sub-z/);
    const corrected = {
      ...fields,
      reviews: fields.reviews.map((item, index) => index === 0
        ? { ...item, repair: { ...item.repair, id: "sub-z" } }
        : item),
    };
    const accepted = invoke(corrected);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stderr, "");
    assert.equal(accepted.stdout.trim().split("\n").length, 1);
    const options = {
      subtaskMax: helperContext.subtaskMax,
      acceptancePlanKeys: helperContext.acceptancePlanKeys,
      allowDirectCompletion: helperContext.allowDirectCompletion,
      requireAcceptanceFeedback: helperContext.requireAcceptanceFeedback,
      requireProgressPercent: helperContext.requireProgressPercent,
    };
    const decision = JSON.parse(accepted.stdout) as LoopPlusDecision;
    const again = parseLoopPlusDecisionForFrozenInput(accepted.stdout, options);
    assert.equal(again.rejectionReason, null);
    assert.deepEqual(again.decision, decision);
    assert.deepEqual(decision.reviewEventIds, helperContext.reviews.map((item) => item.eventId));
    assert.equal(decision.reviewEventIds?.includes("event-late"), false);
    assert.deepEqual(decision.reportEventIds, reports);
    assert.deepEqual(decision.reviews?.map((item) => item.acceptance), ["failed", "failed", "cancelled", "passed"]);
    assert.deepEqual(decision.departmentCollaborations, fields.departmentCollaborations);
    const badCollaboration = invoke({
      ...corrected,
      departmentCollaborations: [{ id: "", targetLeaderTaskId: "leader-other", body: "缺 id" }],
    });
    assert.equal(badCollaboration.status, 1, badCollaboration.stderr);
    assert.equal(badCollaboration.stdout, "");
    assert.match(badCollaboration.stderr, /fields\.departmentCollaborations/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
