"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { driveSuccessiveContinuation, nativeSessions } = require("./department_successive_continuation_ui");

// Compile only the two production contracts into physical, test-owned files.
// Never load a possibly stale shared dist or duplicate its validation schema.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const artifact = fs.mkdtempSync(path.join(os.tmpdir(), "successive-binding-contract-"));
test.after(() => fs.rmSync(artifact, { recursive: true, force: true }));
for (const file of ["runtime/departmentexecutionidentity", "extensionHost/departmentruntimestate"]) {
  const source = fs.readFileSync(path.join(__dirname, "../../src", file + ".ts"), "utf8");
  const output = path.join(artifact, file + ".js");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText);
}
const { isDepartmentExecutionBinding: isExecutionBinding } = require(path.join(artifact, "extensionHost/departmentruntimestate"));
const { isDepartmentExecutionIdentity, fingerprintDepartmentExecutionSelection } = require(path.join(artifact, "runtime/departmentexecutionidentity"));

function binding(role, { generation, subtaskId, attemptId, ownerId, executionId, sessionId, selection }) {
  const chosen = structuredClone(selection ?? { version: 1, role, cli: "opencode", configId: "opencode-local",
    revision: "revision-1", model: "loopback/model", thinkingMode: "off", openCodeVariant: null });
  const value = { identity: {
    version: 1, workspace: "workspace-ui", moduleId: "module-1", role, rootTaskId: "root-ui", leaderTaskId: "leader-ui",
    ...(subtaskId ? { subtaskId, attemptId } : {}), generation, cli: "opencode", ownerId, executionId,
    ...fingerprintDepartmentExecutionSelection(chosen), session: { state: "bound", id: sessionId },
  }, selection: chosen, requirements: { processTerminal: true, turnTerminal: false, streams: true, runner: true,
    executionRoot: true, links: true, temp: true, tab: true } };
  assert.equal(isDepartmentExecutionIdentity(value.identity), true, "fixture identity must satisfy the actual production validator");
  assert.equal(isExecutionBinding(value), true, "fixture binding must satisfy the actual production validator");
  return value;
}

function harness({ cleanupComplete = true, wrongTarget = null, delayedBinding = false, ownerDrift = false, sessionDrift = false, hangStop = false, onLeaderBinding, onEmployeeBinding,
  delayedTaskSession = false, delayedLeaderSession = false, incompleteBinding = false, unrelatedHistory = false, hangClose = false, delayedStopFence = false } = {}) {
  const rootId = "root-ui", leaderId = "leader-ui", plan = { id: "plan-ui" };
  const routes = { director: { cli: "opencode", configId: "opencode-local", model: "loopback/model", thinkingMode: "off" },
    leader: { cli: "opencode", configId: "opencode-local", model: "loopback/model", thinkingMode: "off" }, employee: { cli: "opencode", configId: "opencode-local", model: "loopback/model", thinkingMode: "off" } };
  const root = { id: rootId, status: "running", cli: "opencode", workspaceKey: "workspace-ui", sessionId: "ses_root", loopPlusAcceptancePlan: plan,
    department: { version: 1, role: "director", parentTaskId: null, leaderSubtaskId: null, rootTaskId: rootId, routes } };
  const held = [1, 2].map((number) => ({ leaderTaskId: leaderId, subtaskId: `subtask-${number === 1 ? "a" : "b"}`,
    attemptId: `attempt-${number}`, reportFile: `/r/subtask-${number === 1 ? "a" : "b"}.md` }));
  const taskFor = (number, status = number === 1 ? "running" : "pending") => ({
    id: held[number - 1].subtaskId, status, communicationFile: held[number - 1].reportFile,
    ...(number === 2 ? { continueFromSubtaskId: held[0].subtaskId } : {}),
    ...(number === 1 ? { executionSession: { cli: "opencode", sessionId: "ses_employee", configId: "opencode-local" } } : {}),
  });
  const firstEvent = { eventId: "event-stop-1", subtaskId: held[0].subtaskId, attemptId: held[0].attemptId,
    outcome: "stopped", detail: "public stop requested" };
  const leader = { id: leaderId, status: "running", cli: "opencode", workspaceKey: "workspace-ui", sessionId: "local_leader",
    executionSession: { cli: "opencode", sessionId: "ses_leader", configId: "opencode-local" }, schedulingMode: "event_driven",
    loopPlusAcceptancePlan: structuredClone(plan), department: { version: 1, role: "leader", parentTaskId: rootId, leaderSubtaskId: "module-1", rootTaskId: rootId, routes: structuredClone(routes) },
    subTasks: [taskFor(1)], loopPlus: { parentStopped: false, running: [{ subtaskId: held[0].subtaskId, attemptId: held[0].attemptId }],
      reviewQueue: [], seenAttempts: [{ subtaskId: held[0].subtaskId, attemptId: held[0].attemptId, disposition: "open" }], currentReview: null } };
  const tasks = [root, leader];
  const bindings = [binding("leader", { generation: 1, ownerId: "owner-leader-1", executionId: "exec-leader-1", sessionId: "ses_leader" }),
    binding("employee", { generation: 1, subtaskId: held[0].subtaskId, attemptId: held[0].attemptId,
      ownerId: "owner-employee-1", executionId: "exec-employee-1", sessionId: "ses_employee", configId: "opencode-local" })];
  const runtime = { executionBindings: bindings, leaderExecutionSets: [{ scope: { rootTaskId: rootId, leaderTaskId: leaderId, generation: 1 } }], capacity: { used: 2 } };
  const state = { round: 1, generation: 1, openClicks: 0, closeCount: 0, releaseCount: 0, continueCount: 0,
    reviewCount: 0, employeeBReady: false, panelRequests: 0, runtimeReads: 0, cleanupReads: 0, ownerDriftApplied: false };
  const report = {};

  const createWebviewAdapter = async (_browser, purpose) => {
    const extensionId = wrongTarget === "extension" ? "other.extension" : "sinitek.sinitek-cli-tools";
    const actualPurpose = wrongTarget === "purpose" && purpose === "webviewView" ? "webviewPanel" : purpose;
    if (purpose === "webviewPanel") state.panelRequests++;
    const target = { url: `vscode-webview://host/index.html?extensionId=${extensionId}&purpose=${actualPurpose}` };
    const makeLocator = (selector) => ({
      count: async () => selector === "#panelSubtitle" ? 1 : 1,
      getAttribute: async () => wrongTarget === "root" ? "产研部 · 总监 · other-root" : `产研部 · 总监 · ${rootId}`,
      innerText: async () => `产研部总监 ${rootId}`,
      isVisible: async () => selector === "#openCurrentLoopGroupChat" || selector.includes("stopTask") || selector.includes("continueTask")
        || selector === "#continueDialogInput" || selector === "#continueDialogConfirm",
      isEnabled: async () => true,
      click: async () => {
        if (selector === "#openCurrentLoopGroupChat") { state.openClicks++; return; }
        if (selector.includes("stopTask")) {
          if (hangStop) return new Promise(() => {});
          root.status = "stopped"; leader.status = "paused"; leader.loopPlus.parentStopped = true;
          leader.loopPlus.running = [];
          Object.assign(leader.subTasks.find((item) => item.id === held[state.round - 1].subtaskId), { status: "blocked", summary: "stopped" });
          leader.loopPlus.reviewQueue = [firstEventFor(state.round)];
          const seen = leader.loopPlus.seenAttempts.find((item) => item.subtaskId === held[state.round - 1].subtaskId);
          Object.assign(seen, { disposition: "finished", outcome: "stopped" });
        }
        if (selector === "#continueDialogConfirm") {
          root.status = "running"; leader.status = "running"; leader.loopPlus.parentStopped = false;
          state.generation += 2;
          runtime.leaderExecutionSets.push({ scope: { rootTaskId: rootId, leaderTaskId: leaderId, generation: state.generation } });
          if (!delayedBinding) addLeaderBinding(state.generation);
          state.round++;
        }
      },
      fill: async () => {},
    });
    return {
      target,
      locator: makeLocator,
      close: async () => { state.closeCount++; if (hangClose) return new Promise(() => {}); },
    };
  };
  function firstEventFor(round) {
    return round === 1 ? firstEvent : { eventId: "event-stop-2", subtaskId: held[1].subtaskId,
      attemptId: held[1].attemptId, outcome: "stopped", detail: "public stop requested" };
  }
  function addLeaderBinding(generation) {
    const previous = bindings.filter(({ identity }) => identity.role === "leader").at(-1);
    const next = binding("leader", { generation, ownerId: `owner-leader-${generation}`, executionId: `exec-leader-${generation}`,
      sessionId: "ses_leader", selection: previous.selection });
    onLeaderBinding?.(next, generation);
    bindings.push(next);
    if (delayedLeaderSession) {
      state.pendingLeaderSession = { session: leader.executionSession, reads: 0 };
      delete leader.executionSession;
    }
    if (incompleteBinding) { state.incomplete = { binding: next, selection: next.selection, requirements: next.requirements, reads: 0 };
      delete next.selection; delete next.requirements; }
  }
  function addEmployee(number) {
    const subtaskId = number === 2 ? held[1].subtaskId : "subtask-c";
    let employee = leader.subTasks.find((item) => item.id === subtaskId);
    assert.ok(employee, "employee cannot run before review dispatch");
    employee.status = "running";
    const session = { cli: "opencode", sessionId: "ses_employee", configId: "opencode-local" };
    if (delayedTaskSession) state.pendingSession = { employee, session, reads: 0 };
    else employee.executionSession = session;
    const attemptId = number === 2 ? held[1].attemptId : "attempt-3";
    leader.loopPlus.running = [{ subtaskId, attemptId }];
    leader.loopPlus.seenAttempts.push({ subtaskId, attemptId, disposition: "open" });
    const previous = bindings.find(({ identity }) => identity.role === "employee" && identity.subtaskId === held[0].subtaskId);
    const next = binding("employee", { generation: state.generation, subtaskId, attemptId,
      ownerId: `owner-employee-${number}`, executionId: `exec-employee-${number}`, sessionId: "ses_employee", selection: previous.selection });
    onEmployeeBinding?.(next, employee, number);
    bindings.push(next);
  }
  function scenarioReview(round) {
    state.reviewCount++;
    const event = leader.loopPlus.reviewQueue[0];
    assert.ok(event && event.outcome === "stopped", "review did not consume the persisted stopped event");
    leader.loopPlus.currentReview = structuredClone(event);
    const seen = leader.loopPlus.seenAttempts.find((item) => item.subtaskId === event.subtaskId && item.attemptId === event.attemptId);
    Object.assign(seen, { disposition: "reviewed", acceptance: "failed" });
    leader.loopPlus.reviewQueue = []; leader.loopPlus.currentReview = null;
    const nextId = round === 1 ? held[1].subtaskId : "subtask-c";
    const next = { id: nextId, status: "pending", continueFromSubtaskId: event.subtaskId,
      communicationFile: `/r/${nextId}.md` };
    if (!leader.subTasks.some((item) => item.id === next.id)) leader.subTasks.push(next);
    if (round === 1) state.employeeBReady = true;
    state.pendingEmployee = round + 1;
    return { eventId: event.eventId, subtaskId: event.subtaskId, attemptId: event.attemptId,
      outcome: "stopped", acceptance: "failed", subtaskIds: [nextId] };
  }
  const scenario = {
    history: [{ stage: "employee-result" }],
    snapshot: () => ({ rootId, continuation: { rounds: [1, 2].map((number) => ({ held: number === 1 || state.employeeBReady ? held[number - 1] : null,
      nextSubtaskId: number === 1 ? held[1].subtaskId : "subtask-c" })) } }),
    waitForHeldEmployee: async (round) => { if (round === 2) assert.equal(state.employeeBReady, true, "B cannot start before A's review acceptance"); return held[round - 1]; },
    releaseEmployee: (round) => { state.releaseCount++; return round === 1 || round === 2; },
    beginContinue: (cleanup, round, pending) => {
      assert.equal(cleanup.complete, true); assert.equal(pending.eventId, firstEventFor(round).eventId);
      assert.equal(leader.loopPlus.currentReview, null, "stop mock reviewed the event before continue");
      assert.equal(leader.subTasks.some((item) => item.id === (round === 1 ? held[1].subtaskId : "subtask-c")), false,
        "stop mock dispatched a successor before continue");
      return `continue-${round}`;
    },
    confirmContinue: (round) => { assert.equal(round, state.continueCount + 1); state.continueCount++; },
    waitForStoppedReview: async (round) => scenarioReview(round),
    releaseAll: () => { state.releaseCount += 10; },
  };
  const browser = { contexts: () => [{ pages: () => [{ frames: () => [] }] }], close: async () => { state.browserClosed = true; } };
  const inspectCleanup = async () => {
    state.cleanupReads++;
    if (ownerDrift && !state.ownerDriftApplied) {
      state.ownerDriftApplied = true;
      bindings[0].identity.session.id = "ses_drifted";
    }
    if (sessionDrift && !state.ownerDriftApplied) {
      state.ownerDriftApplied = true;
      root.sessionId = "ses_drifted";
    }
    return cleanupComplete ? { complete: true, rootId, saved: { executionBindings: structuredClone(bindings),
      runtime: { leaders: [{ taskId: leaderId, status: "paused", generation: delayedStopFence && state.cleanupReads % 2 === 1 ? state.generation : state.generation + 1 }], capacity: { used: 0 } }, capacity: { used: 0 } } } : { complete: false, rootId };
  };
  const h = { browser, scenario, isExecutionBinding, readTasks: () => tasks, readRuntime: () => {
    state.runtimeReads++;
    if (state.incomplete && ++state.incomplete.reads > 2) {
      Object.assign(state.incomplete.binding, { selection: state.incomplete.selection, requirements: state.incomplete.requirements });
      state.incomplete = null; state.completedPartialBinding = true;
    }
    if (state.pendingLeaderSession && ++state.pendingLeaderSession.reads > 2) {
      leader.executionSession = state.pendingLeaderSession.session;
      state.pendingLeaderSession = null; state.completedLeaderSession = true;
    }
    if (state.pendingEmployee) { addEmployee(state.pendingEmployee); state.pendingEmployee = null; }
    if (state.pendingSession && ++state.pendingSession.reads > 2) {
      state.pendingSession.employee.executionSession = state.pendingSession.session;
      state.pendingSession = null; state.completedTaskSession = true;
    }
    if (unrelatedHistory && state.generation > 1 && !state.addedHistory) {
      const other = binding("leader", { generation: 1, ownerId: "owner-other", executionId: "exec-other", sessionId: "ses_other" });
      other.identity.leaderTaskId = "other-leader"; other.identity.moduleId = "other-module";
      bindings.push(other); state.addedHistory = true;
    }
    if (delayedBinding && state.generation > 1 && !bindings.some(({ identity }) => identity.role === "leader" && identity.generation === state.generation))
      if ((state.bindingWaits = (state.bindingWaits ?? 0) + 1) % 3 === 0) addLeaderBinding(state.generation);
    return structuredClone(runtime);
  }, inspectCleanup, healthy() {}, report, createWebviewAdapter };
  return { ...h, root, leader, runtime, bindings, state };
}

test("public adapter follows two durable stop-continue-review cycles using exact OpenCode Owner bindings", async () => {
  const h = harness();
  const evidence = await driveSuccessiveContinuation({ ...h, timeoutMs: 8000 });
  assert.equal(evidence.result, "two-stops-and-continues-observed");
  assert.equal(evidence.rounds.length, 2);
  assert.deepEqual(evidence.rounds.map((round) => round.pendingEvent.outcome), ["stopped", "stopped"]);
  assert.deepEqual(evidence.rounds.map((round) => round.stoppedReview.acceptance), ["failed", "failed"]);
  assert.equal(h.state.continueCount, 2);
  assert.equal(h.state.reviewCount, 2);
  assert.ok(h.state.openClicks >= 2, "adapter did not use the public webviewView opener");
  assert.ok(h.state.closeCount >= 4, "adapter did not close its own webview sessions");
  assert.equal(h.state.browserClosed, undefined, "adapter closed the caller-owned browser");
  assert.equal(h.root.loopPlusAcceptancePlan.id, "plan-ui");
  assert.equal(h.leader.sessionId, "local_leader");
  assert.equal(h.root.sessionId, "ses_root");
  assert.deepEqual(evidence.rounds.map(({ successorBinding: b }) => b.identity.subtaskId), ["subtask-b", "subtask-c"]);
  assert.ok(h.bindings.every(isExecutionBinding));
  assert.equal(h.report.successiveContinuation.rounds.length, 2);
});

test("webview target lookup works when ordinary page.frames omits OOPIF targets", async () => {
  const h = harness({ delayedBinding: true });
  await driveSuccessiveContinuation({ ...h, timeoutMs: 8000 });
  assert.ok(h.state.runtimeReads >= 4, "adapter did not wait for delayed generation binding persistence");
});

test("adapter rejects foreign extension, wrong purpose and wrong root targets", async (t) => {
  for (const wrongTarget of ["extension", "purpose", "root"]) {
    await t.test(wrongTarget, async () => {
      const h = harness({ wrongTarget });
      await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 2500 }), /target belongs to another extension|wrong webview purpose|targets another department root/);
      assert.ok(h.state.releaseCount >= 10);
      assert.equal(h.state.browserClosed, undefined);
    });
  }
});

test("adapter refuses continue when owner cleanup has not returned capacity", async () => {
  const h = harness({ cleanupComplete: false });
  await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 2600 }), /timed out: round 1 original Owner drain and capacity return/);
  assert.equal(h.state.continueCount, 0);
  assert.ok(h.state.releaseCount >= 10);
});

test("historical binding mutation is rejected and adapter releases owned sessions", async () => {
  const h = harness({ ownerDrift: true });
  await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 4000 }), /stop cleanup changed original Owner bindings/);
  assert.ok(h.state.releaseCount >= 10);
  assert.equal(h.state.browserClosed, undefined);
});

test("root task session drift across the public stop boundary is rejected", async () => {
  const h = harness({ sessionDrift: true });
  await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 4000 }), /public continue replaced root session/);
  assert.ok(h.state.releaseCount >= 10);
});

test("an unresponsive public stop is bounded and releases response latches", async () => {
  const h = harness({ hangStop: true });
  await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 1200 }), /timed out: round 1 public stop click/);
  assert.ok(h.state.releaseCount >= 10);
  assert.ok(h.state.closeCount >= 1);
});

test("adapter validation failure releases scenario latches before returning", async () => {
  const h = harness();
  await assert.rejects(driveSuccessiveContinuation({ scenario: h.scenario }), /missing successive UI adapter input: browser/);
  assert.ok(h.state.releaseCount >= 10);
});

test("binding fixture uses the production top-level schema and rejects the former identity payload", () => {
  const h = harness();
  for (const value of h.bindings) {
    assert.equal(isExecutionBinding(value), true);
    assert.equal(isDepartmentExecutionIdentity(value.identity), true);
    assert.equal(Object.hasOwn(value.identity, "configId"), false);
    assert.equal(Object.hasOwn(value.identity, "selection"), false);
    assert.equal(Object.hasOwn(value.identity, "requirements"), false);
  }
  assert.deepEqual(nativeSessions(h.runtime, { rootId: h.root.id, leaderId: h.leader.id }, isExecutionBinding), ["ses_employee", "ses_leader"]);
  const old = structuredClone(h.bindings[0]);
  old.identity.selection = old.selection; old.identity.requirements = old.requirements;
  old.identity.configId = old.selection.configId; delete old.selection; delete old.requirements;
  assert.equal(isExecutionBinding(old), false);
  assert.throws(() => nativeSessions({ executionBindings: [old] }, undefined, isExecutionBinding), /invalid production execution binding/);
});

test("adapter waits for full top-level bindings and authoritative leader and employee task sessions", async () => {
  const h = harness({ delayedBinding: true, incompleteBinding: true, delayedTaskSession: true, delayedLeaderSession: true });
  const evidence = await driveSuccessiveContinuation({ ...h, timeoutMs: 8000 });
  assert.equal(evidence.result, "two-stops-and-continues-observed");
  assert.equal(h.state.completedPartialBinding, true);
  assert.equal(h.state.completedTaskSession, true);
  assert.equal(h.state.completedLeaderSession, true);
  assert.ok(h.state.bindingWaits >= 6);
  for (const round of evidence.rounds) assert.equal(isExecutionBinding(round.successorBinding), true);
});

test("adapter preserves target history while allowing new bindings with different native sessions outside that leader", async () => {
  const h = harness({ unrelatedHistory: true });
  const before = structuredClone(h.bindings);
  await driveSuccessiveContinuation({ ...h, timeoutMs: 6000 });
  assert.equal(h.state.addedHistory, true);
  for (const original of before) assert.deepEqual(h.bindings.find((b) => b.identity.ownerId === original.identity.ownerId), original);
  assert.ok(h.bindings.some((b) => b.identity.session.id === "ses_other"));
});

test("leader and employee successors reject top-level selection, policy and fingerprint drift", async (t) => {
  const changes = [
    ["configId", (b) => { b.selection.configId = "other-profile"; }],
    ["revision", (b) => { b.selection.revision = "revision-2"; }],
    ["model", (b) => { b.selection.model = "loopback/other"; }],
    ["thinkingMode", (b) => { b.selection.thinkingMode = "high"; }],
    ["variant", (b) => { b.selection.openCodeVariant = "other"; }],
    ["requirements", (b) => { b.requirements.temp = false; }],
    ["fingerprint", (b) => { b.identity.profileFingerprint = "0".repeat(64); }],
  ];
  await Promise.all(["leader", "employee"].flatMap((role) => changes.map(([name, change]) => t.test(`${role} ${name}`, async () => {
    const mutate = (b) => {
      change(b);
      if (name !== "fingerprint") {
        Object.assign(b.identity, fingerprintDepartmentExecutionSelection(b.selection));
        assert.equal(isExecutionBinding(b), true, "drift must be rejected even when the new record is individually valid");
      }
    };
    const h = harness(role === "leader" ? { onLeaderBinding: mutate } : { onEmployeeBinding: mutate });
    await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 5000 }), /continuation changed|differs from fixed role route|invalid production execution binding/);
    assert.equal(h.state.continueCount, 1);
    assert.ok(h.state.releaseCount >= 10);
    assert.equal(h.state.browserClosed, undefined);
  }))));
});

test("successor C is checked against B and cannot reuse an Owner or change its native session", async (t) => {
  for (const change of ["owner", "session"]) await t.test(change, async () => {
    const h = harness({ onEmployeeBinding: (b, _task, number) => {
      if (number !== 3) return;
      if (change === "owner") b.identity.ownerId = "owner-employee-2";
      else b.identity.session.id = "ses_foreign";
    } });
    await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 6000 }), /continuation reused previous Owner|continuation changed native session/);
    assert.equal(h.state.continueCount, 2);
    assert.equal(h.report.successiveContinuation.result, "failed");
    assert.ok(h.state.releaseCount >= 10);
  });
});

test("task native session must match the exact binding including top-level configId", async (t) => {
  for (const field of ["cli", "configId", "sessionId"]) await t.test(field, async () => {
    const h = harness({ onEmployeeBinding: (_b, task) => { task.executionSession[field] = field === "cli" ? "codex" : "other"; } });
    await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 5000 }), /task native session differs from its exact Owner binding/);
    assert.ok(h.state.releaseCount >= 10);
  });
});

test("missing authoritative root or leader session cannot pass by comparing undefined values", async (t) => {
  for (const target of ["root", "leader"]) await t.test(target, async () => {
    const h = harness();
    if (target === "root") delete h.root.sessionId;
    else delete h.leader.executionSession;
    await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 1500 }), /root has no authoritative native session|task native session differs from its exact Owner binding/);
    assert.equal(h.state.openClicks, 0);
    assert.ok(h.state.releaseCount >= 10);
  });
});

test("a permanently incomplete generation never reaches review or grants success", async () => {
  const h = harness({ onLeaderBinding: (b) => { delete b.selection; } });
  await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 1500 }), /timed out: round 1 new owner generation/);
  assert.equal(h.state.continueCount, 1);
  assert.equal(h.state.reviewCount, 0);
  assert.equal(h.report.successiveContinuation.result, "failed");
  assert.ok(h.state.releaseCount >= 10);
});

test("owned adapter cleanup shares the absolute deadline and never closes caller browser", async () => {
  const h = harness({ hangClose: true });
  await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 1000 }), /timed out: owned adapter cleanup/);
  assert.ok(h.state.releaseCount >= 10);
  assert.equal(h.state.browserClosed, undefined);
});

test("final successor persistence cannot mutate original history or reuse an older execution", async (t) => {
  for (const change of ["history", "older-execution"]) await t.test(change, async () => {
    let h;
    h = harness({ onEmployeeBinding: (b, _task, number) => {
      if (number !== 3) return;
      if (change === "history") h.bindings[0].requirements.temp = false;
      else b.identity.executionId = "exec-employee-1";
    } });
    await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 6000 }), /mutated a historical Owner binding|reused a historical Owner or execution/);
    assert.equal(h.state.continueCount, 2);
    assert.ok(h.state.releaseCount >= 10);
  });
});

test('successive adapter accepts only shared DOM-proven untyped panels and forwards one root/deadline', async () => {
  const h=harness(), create=h.createWebviewAdapter;
  h.createWebviewAdapter=async(browser,purpose,ms,options)=>{
    assert.equal(options.rootId,h.root.id);assert.equal(options.cleanupDeadline,options.deadline);
    const adapter=await create(browser,purpose,ms,options);
    if(purpose==='webviewPanel'){
      const url=new URL(adapter.target.url);url.searchParams.delete('purpose');
      adapter.target={...adapter.target,url:url.href,verifiedPurpose:purpose,verifiedRootId:h.root.id};
    }
    return adapter;
  };
  assert.equal((await driveSuccessiveContinuation({...h,timeoutMs:8000})).result,'two-stops-and-continues-observed');
});

 test("adapter waits for the persisted stop revocation generation before freezing no-revival evidence", async () => {
  const h=harness({delayedStopFence:true});
  const result=await driveSuccessiveContinuation({...h,timeoutMs:8000});
  assert.equal(result.result,"two-stops-and-continues-observed");
  assert.equal(h.state.cleanupReads,4);
  assert.deepEqual(result.rounds.map(r=>r.afterStopCleanup.saved.runtime.leaders[0].generation),[2,4]);
});

test('cleanup diagnostics returned by owned adapter reject otherwise successful public flow', async () => {
  const h = harness(), factory = h.createWebviewAdapter;
  h.createWebviewAdapter = async (...args) => {
    const adapter = await factory(...args);
    adapter.close = async () => [{ operation: 'target detach', status: 'unconfirmed' }];
    return adapter;
  };
  await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 2000 }), /cleanup unconfirmed/);
  assert.equal(h.report.successiveContinuation.result, 'failed');
  assert.equal(h.state.continueCount, 0);
  assert.equal(h.state.browserClosed, undefined);
  assert.ok(h.state.releaseCount >= 10);
});

test('public validation error survives rejected cleanup in finally', async () => {
  const h = harness({ wrongTarget: 'extension' }), factory = h.createWebviewAdapter;
  h.createWebviewAdapter = async (...args) => {
    const adapter = await factory(...args);
    adapter.close = async () => { throw Error('secondary detach error'); };
    return adapter;
  };
  await assert.rejects(driveSuccessiveContinuation({ ...h, timeoutMs: 2000 }), error => {
    assert.match(error.message, /extension/);
    assert.ok(error.cleanupDiagnostics.some(d => d.error.includes('secondary detach error')));
    return true;
  });
  assert.equal(h.state.browserClosed, undefined);
  assert.ok(h.state.releaseCount >= 10);
});
