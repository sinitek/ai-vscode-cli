"use strict";

const assert = require("node:assert/strict");
const { isStoppedTaskRecord } = require("./department_successive_continuation_eh_scenario");

const EXTENSION_ID = "sinitek.sinitek-cli-tools";

function createSharedWebviewAdapter(browser, purpose, timeoutMs, options) {
  return require("../verify_department_full_eh_integration").createDepartmentWebviewAdapter(browser, purpose, timeoutMs, options);
}

function rootTask(readTasks, rootId) {
  const matches = readTasks().filter((task) => task.id === rootId && task.department?.role === "director");
  assert.equal(matches.length, 1, "the active root must be one persisted director task");
  assert.equal(matches[0].department.rootTaskId, rootId);
  return matches[0];
}

function leaderTask(readTasks, leaderTaskId, rootId) {
  const matches = readTasks().filter((task) => task.id === leaderTaskId && task.department?.role === "leader");
  assert.equal(matches.length, 1, "the active leader must be one persisted leader task");
  assert.equal(matches[0].department.rootTaskId, rootId);
  return matches[0];
}

// The default runs against the built product. Tests inject the same production
// validator compiled from current source into an isolated temporary artifact.
function isProductionBinding(value) {
  return require("../../dist/extensionHost/departmentruntimestate").isDepartmentExecutionBinding(value);
}

function scopedBindings(runtime, scope) {
  assert.ok(Array.isArray(runtime?.executionBindings), "runtime has no persisted execution bindings");
  return runtime.executionBindings.filter(({ identity }) => !scope || identity?.rootTaskId === scope.rootId
    && identity.leaderTaskId === scope.leaderId);
}

function nativeSessions(runtime, scope, isExecutionBinding = isProductionBinding) {
  const bindings = scopedBindings(runtime, scope);
  assert.ok(bindings.length > 0, "runtime has no persisted execution bindings for the target leader");
  const owners = new Set(), executions = new Set();
  for (const binding of bindings) {
    assert.ok(isExecutionBinding(binding), "invalid production execution binding or selection fingerprint");
    assert.ok(!owners.has(binding.identity.ownerId), "duplicate target Owner binding");
    assert.ok(!executions.has(binding.identity.executionId), "duplicate target execution binding");
    owners.add(binding.identity.ownerId);
    executions.add(binding.identity.executionId);
  }
  return [...new Set(bindings.map(({ identity }) => identity.session.id))].sort();
}

function assertTaskSession(task, binding) {
  assert.notEqual(task.executionSessionInvalid, true, "task has an invalid native execution session");
  assert.deepEqual(task.executionSession, { cli: binding.identity.cli, sessionId: binding.identity.session.id,
    configId: binding.selection.configId }, "task native session differs from its exact Owner binding");
}

function assertBindingScope(binding, root, leader) {
  const { identity, selection } = binding;
  assert.equal(identity.workspace, root.workspaceKey, "binding workspace changed");
  assert.equal(identity.rootTaskId, root.id, "binding root changed");
  assert.equal(identity.leaderTaskId, leader.id, "binding leader changed");
  assert.equal(identity.moduleId, leader.department.leaderSubtaskId, "binding module changed");
  const route = root.department.routes[identity.role];
  assert.equal(selection.cli, route.cli, "binding CLI differs from fixed role route");
  for (const key of ["configId", "model", "thinkingMode", "openCodeVariant"])
    assert.equal(selection[key], route[key] ?? null, `binding ${key} differs from fixed role route`);
}

function assertSuccessorBinding(previous, successor) {
  for (const key of ["version", "workspace", "rootTaskId", "moduleId", "leaderTaskId", "role", "cli", "configFingerprint", "profileFingerprint"])
    assert.equal(successor.identity[key], previous.identity[key], `continuation changed ${key}`);
  assert.deepEqual(successor.selection, previous.selection, "continuation changed top-level selection");
  assert.deepEqual(successor.requirements, previous.requirements, "continuation changed top-level cleanup requirements");
  assert.deepEqual(successor.identity.session, previous.identity.session, "continuation changed native session");
  assert.notEqual(successor.identity.ownerId, previous.identity.ownerId, "continuation reused previous Owner");
  assert.notEqual(successor.identity.executionId, previous.identity.executionId, "continuation reused previous execution");
}

// Absence/partial persistence is waitable; a complete but invalid record is a
// contract error, never evidence of a new generation.
function completeBinding(binding, isExecutionBinding) {
  if (!binding?.identity || !binding.selection || !binding.requirements || !binding.identity.ownerId
    || !binding.identity.executionId || binding.identity.session?.state !== "bound") return false;
  assert.ok(isExecutionBinding(binding), "invalid production execution binding or selection fingerprint");
  return true;
}

function pendingStoppedEvent(leader, held) {
  const snapshot = leader.loopPlus;
  assert.ok(snapshot?.parentStopped, "persisted Loop+ scheduler is not stopped");
  const queue = snapshot.reviewQueue?.filter((item) => item.subtaskId === held.subtaskId && item.attemptId === held.attemptId
    && item.outcome === "stopped") ?? [];
  assert.equal(queue.length, 1, "stopped event is not uniquely present in the persisted review queue");
  const seen = snapshot.seenAttempts?.filter((item) => item.subtaskId === held.subtaskId && item.attemptId === held.attemptId) ?? [];
  assert.equal(seen.length, 1, "stopped event has no unique persisted seen attempt");
  assert.equal(seen[0].outcome, "stopped");
  assert.equal(seen[0].disposition, "finished", "stopped event is already reviewed or is not pending");
  assert.equal(typeof queue[0].detail, "string", "persisted stopped event has no production detail");
  return structuredClone(queue[0]);
}

function assertWebviewTarget(adapter, purpose, rootId) {
  const url = new URL(adapter.target?.url ?? "");
  assert.equal(url.protocol, "vscode-webview:", "target is not a VS Code webview");
  assert.equal(url.searchParams.get("extensionId"), EXTENSION_ID, "target belongs to another extension");
  if (purpose === "webviewPanel" && url.searchParams.get("purpose") === null) {
    assert.equal(adapter.target.verifiedPurpose, purpose, "target has no verified public panel purpose");
    assert.equal(adapter.target.verifiedRootId, rootId, "target panel proof belongs to another root");
  } else assert.equal(url.searchParams.get("purpose"), purpose, "target has the wrong webview purpose");
}

function generationIds(runtime, leaderId) {
  return (runtime?.leaderExecutionSets || []).filter((set) => set.scope?.leaderTaskId === leaderId).map((set) => set.scope.generation).sort((a, b) => a - b);
}

function leaderExecutionIds(runtime, leaderId) {
  const ids = (runtime?.executionBindings || []).filter(({ identity }) => identity?.role === "leader" && identity.leaderTaskId === leaderId)
    .map(({ identity }) => identity.executionId).filter((value) => typeof value === "string" && value.length > 0);
  assert.ok(ids.length > 0, "runtime has no persisted leader execution identity");
  return [...new Set(ids)].sort();
}

function sameStableIdentity(before, after, rootId, leaderId, isExecutionBinding) {
  const root = rootTask(() => [after.rootTask], rootId);
  const leader = leaderTask(() => [after.leaderTask], leaderId, rootId);
  assert.equal(root.cli, before.rootTask.cli, "public continue changed root CLI");
  assert.equal(root.workspaceKey, before.rootTask.workspaceKey, "public continue changed root workspace");
  assert.equal(root.sessionId, before.rootSessionId, "public continue replaced root session");
  assert.deepEqual(root.executionSession, before.rootTask.executionSession, "public continue changed root native execution session");
  assert.deepEqual(root.loopPlusAcceptancePlan, before.acceptancePlan, "public continue changed root acceptance plan");
  assert.equal(leader.sessionId, before.leaderSessionId, "public continue replaced original leader task session");
  assert.deepEqual(leader.executionSession, before.leaderTask.executionSession, "public continue changed leader native execution session");
  assert.deepEqual(leader.department, before.leaderDepartment, "public continue changed original leader routing identity");
  assert.deepEqual(root.department.routes, before.routes, "public continue changed root role routes");
  const scope = { rootId, leaderId };
  nativeSessions(after.runtime, scope, isExecutionBinding);
  const afterByOwner = new Map(scopedBindings(after.runtime, scope).map((binding) => [binding.identity.ownerId, binding]));
  for (const binding of scopedBindings(before.runtime, scope)) {
    assert.deepEqual(afterByOwner.get(binding.identity.ownerId), binding, "public continue mutated a historical Owner binding");
  }
}

async function driveSuccessiveContinuation({ browser, scenario, readTasks, readRuntime, inspectCleanup, healthy, report,
  timeoutMs = 120000, actionDeadline, cleanupDeadline, createWebviewAdapter = createSharedWebviewAdapter, isExecutionBinding = isProductionBinding }) {
  const latchOwner = scenario;
  try {
    for (const [name, value] of Object.entries({ browser, scenario, readTasks, readRuntime, inspectCleanup, healthy, report, createWebviewAdapter, isExecutionBinding })) {
      if (value === undefined || value === null) throw new Error(`missing successive UI adapter input: ${name}`);
    }
    assert.equal(typeof readTasks, "function"); assert.equal(typeof readRuntime, "function");
    assert.equal(typeof inspectCleanup, "function"); assert.equal(typeof healthy, "function"); assert.equal(typeof createWebviewAdapter, "function"); assert.equal(typeof isExecutionBinding, "function");
    assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, "invalid successive UI adapter timeout");
  } catch (error) {
    latchOwner?.releaseAll?.();
    throw error;
  }
  const deadline = actionDeadline ?? Date.now() + timeoutMs;
  cleanupDeadline ??= deadline;
  const cleanupDiagnostics = report.successiveCdpCleanup ??= [];
  let businessFailure;
  const evidence = report.successiveContinuation || (report.successiveContinuation = { rounds: [], result: "running" });
  const remaining = () => Math.max(0, deadline - Date.now());
  const withinDeadline = async (label, operation) => {
    const ms = remaining();
    assert.ok(ms > 0, `successive continuation timed out: ${label}`);
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`successive continuation timed out: ${label}`)), ms);
      })]);
    } finally { clearTimeout(timer); }
  };
  const ownedAdapters = new Set();
  const closeAdapter = async (adapter) => {
    if (!ownedAdapters.delete(adapter)) return;
    // Start disposal even at the deadline, but never wait beyond that deadline.
    let timer;
    try {
      const result = await Promise.race([Promise.resolve().then(() => adapter.close()), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("successive continuation timed out: owned adapter cleanup")), Math.max(0, cleanupDeadline - Date.now()));
      })]);
      if (Array.isArray(result) && result.length) {
        for (const item of result) if (!cleanupDiagnostics.includes(item)) cleanupDiagnostics.push(item);
        throw new Error("successive CDP adapter cleanup unconfirmed");
      }
    } catch (error) {
      cleanupDiagnostics.push({ operation: "owned adapter cleanup", status: "unconfirmed", error: String(error) });
      throw error;
    } finally { clearTimeout(timer); }
  };
  const openAdapter = (purpose, label) => withinDeadline(label, async () => {
    const adapter = await createWebviewAdapter(browser, purpose, remaining(), { deadline, cleanupDeadline, rootId: activeRoot });
    ownedAdapters.add(adapter);
    if (!remaining()) {
      await closeAdapter(adapter).catch(() => undefined);
      throw new Error(`successive continuation timed out: ${label}`);
    }
    return adapter;
  });
  const wait = async (label, check) => {
    while (remaining() > 0) {
      await withinDeadline(`${label} health check`, healthy);
      const value = await withinDeadline(label, check);
      if (value) return value;
      await withinDeadline(`${label} polling`, () => new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining()))));
    }
    throw new Error(`successive continuation timed out: ${label}`);
  };
  const stableSnapshot = (rootId, leaderId) => {
    const root = rootTask(readTasks, rootId), leader = leaderTask(readTasks, leaderId, rootId), runtime = readRuntime(rootId);
    assert.equal(root.cli, "opencode", "root has no authoritative OpenCode CLI");
    assert.ok(typeof root.sessionId === "string" && /^ses_[A-Za-z0-9]+$/.test(root.sessionId), "root has no authoritative native session");
    assert.ok(typeof root.workspaceKey === "string" && root.workspaceKey.length > 0, "root has no authoritative workspace");
    assert.ok(typeof leader.sessionId === "string" && leader.sessionId.length > 0, "leader has no authoritative task session");
    assert.equal(leader.cli, "opencode", "leader has no authoritative OpenCode CLI");
    assert.equal(leader.workspaceKey, root.workspaceKey, "leader workspace differs from root");
    assert.equal(leader.department.parentTaskId, rootId, "leader has no authoritative parent root");
    return { rootSessionId: root.sessionId, leaderSessionId: leader.sessionId,
      acceptancePlan: structuredClone(root.loopPlusAcceptancePlan), leaderDepartment: structuredClone(leader.department),
      nativeSessions: nativeSessions(runtime, { rootId, leaderId }, isExecutionBinding), routes: structuredClone(root.department.routes), runtime,
      rootTask: structuredClone(root), leaderTask: structuredClone(leader),
      generations: generationIds(runtime, leaderId), leaderExecutionIds: leaderExecutionIds(runtime, leaderId) };
  };
  let activeRoot;
  let panelAdapter;
  try {
    for (const roundNumber of [1, 2]) {
      const held = typeof scenario.waitForHeldEmployee === "function"
        ? await withinDeadline(`round ${roundNumber} held employee`, () => scenario.waitForHeldEmployee(roundNumber))
        : await wait(`round ${roundNumber} held employee`, () => scenario.snapshot()?.continuation?.rounds?.[roundNumber - 1]?.held);
      if (!activeRoot) activeRoot = scenario.snapshot().rootId;
      assert.ok(activeRoot && held.leaderTaskId, "held employee lacks a persisted root or leader");
      const original = stableSnapshot(activeRoot, held.leaderTaskId);
      const scope = { rootId: activeRoot, leaderId: held.leaderTaskId };
      const allBindings = scopedBindings(original.runtime, scope);
      const leaderBindings = allBindings.filter(({ identity }) => identity.role === "leader"
        && identity.generation === Math.max(...original.generations));
      assert.equal(leaderBindings.length, 1, "active generation has no exact leader binding");
      assertBindingScope(leaderBindings[0], original.rootTask, original.leaderTask);
      assertTaskSession(original.leaderTask, leaderBindings[0]);
      assert.ok(allBindings.some(({ identity }) => identity?.role === "leader")
        && allBindings.some(({ identity }) => identity?.role === "employee"), "public stop requires persisted leader and employee bindings");
      const active = leaderTask(readTasks, held.leaderTaskId, activeRoot);
      assert.equal(active.status, "running", "stop target leader is not running");
      assert.equal(rootTask(readTasks, activeRoot).status, "running", "stop target root is not running");
      assert.equal(active.subTasks.filter((subtask) => subtask.id === held.subtaskId && subtask.communicationFile === held.reportFile).length, 1,
        "held employee does not match one persisted root child and report path");
      const employee = active.subTasks.find((subtask) => subtask.id === held.subtaskId && subtask.communicationFile === held.reportFile);
      const employeeBindings = allBindings.filter(({ identity }) => identity.role === "employee"
        && identity.subtaskId === held.subtaskId && identity.attemptId === held.attemptId);
      assert.equal(employeeBindings.length, 1, "held employee does not have one exact persisted Owner binding");
      assertBindingScope(employeeBindings[0], original.rootTask, original.leaderTask);
      assertTaskSession(employee, employeeBindings[0]);
      if (roundNumber > 1) {
        const priorRound = evidence.rounds[roundNumber - 2];
        assert.equal(employee.continueFromSubtaskId, priorRound.held.subtaskId, "employee does not continue its exact direct source");
        assertSuccessorBinding(priorRound.beforeStop.employeeBinding, employeeBindings[0]);
        assert.deepEqual(employeeBindings[0], priorRound.successorBinding, "successor binding changed before the next public stop");
      }
      assert.deepEqual(active.loopPlusAcceptancePlan, original.acceptancePlan, "leader does not share the root acceptance plan");

      const view = await openAdapter("webviewView", `round ${roundNumber} production webviewView`);
      try {
        assertWebviewTarget(view, "webviewView");
        const open = view.locator("#openCurrentLoopGroupChat");
        assert.equal(await withinDeadline(`round ${roundNumber} group chat opener visibility`, () => open.isVisible().catch(() => false)), true,
          "public group chat opener is not visible in the extension webviewView");
        assert.equal(await withinDeadline(`round ${roundNumber} group chat opener enabled`, () => open.isEnabled().catch(() => false)), true,
          "public group chat opener is disabled");
        await withinDeadline(`round ${roundNumber} public group chat open`, () => open.click());
      } catch (error) { businessFailure = error; throw error; }
      finally {
        try { await closeAdapter(view); }
        catch (error) { if (!businessFailure) throw error; }
      }
      panelAdapter = await wait(`round ${roundNumber} public group chat panel`, async () => {
        const target = await openAdapter("webviewPanel", `round ${roundNumber} webviewPanel target`);
        try {
          assertWebviewTarget(target, "webviewPanel", activeRoot);
          const subtitle = await target.locator("#panelSubtitle").getAttribute("title").catch(() => "");
          const body = await target.locator("body").innerText().catch(() => "");
          if (subtitle?.endsWith(` · ${activeRoot}`) && body.includes("产研部 · 总监") && body.includes(activeRoot)) return target;
          assert.ok(!subtitle?.includes("产研部") || subtitle.endsWith(` · ${activeRoot}`), "public panel targets another department root");
          await closeAdapter(target);
          return null;
        } catch (error) {
          await closeAdapter(target).catch(() => undefined);
          throw error;
        }
      });
      let group = panelAdapter;
      const stop = group.locator('#panelActions [data-action="stopTask"]');
      await wait(`round ${roundNumber} stop enabled`, async () => await stop.isVisible().catch(() => false) && await stop.isEnabled().catch(() => false));
      await withinDeadline(`round ${roundNumber} public stop click`, () => stop.click());
      const roundEvidence = { round: roundNumber, held, beforeStop: { rootTask: original.rootTask, leaderTask: original.leaderTask,
        executionBindings: structuredClone(allBindings), nativeSessions: original.nativeSessions,
        employeeBinding: structuredClone(employeeBindings[0]),
        capacity: structuredClone(original.runtime.capacity || original.runtime.employeeCapacity || null), requestCount: scenario.history.length } };
      evidence.rounds.push(roundEvidence);
      await wait(`round ${roundNumber} persisted root stop`, () => rootTask(readTasks, activeRoot).status === "stopped");
      assert.equal(await withinDeadline(`round ${roundNumber} response latch release`, () => scenario.releaseEmployee(roundNumber)), true,
        "public stop did not release this round's held employee response");

      roundEvidence.pendingEvent = await wait(`round ${roundNumber} exact durable stopped event`, () => {
        const persistedLeader = leaderTask(readTasks, held.leaderTaskId, activeRoot);
        const source = persistedLeader.subTasks.find((subtask) => subtask.id === held.subtaskId);
        if (!isStoppedTaskRecord(source)) return null;
        try { return pendingStoppedEvent(persistedLeader, held); } catch { return null; }
      });
      roundEvidence.afterStopCleanup = await wait(`round ${roundNumber} original Owner drain and capacity return`, async () => {
        const cleanup = await inspectCleanup(activeRoot, "stopped");
        if (!cleanup?.complete) return null;
        const member = cleanup.saved.runtime.leaders.find(item => item.taskId === held.leaderTaskId);
        // stopRoot can finish original cleanup before persisting its revocation
        // generation. Freeze the no-revival baseline only after that barrier.
        return member?.status === "paused" && member.generation === Math.max(...original.generations) + 1 ? cleanup : null;
      });
      roundEvidence.cleanupObservedAt = Date.now();
      roundEvidence.capacityAfterStop = structuredClone(roundEvidence.afterStopCleanup.capacity
        ?? roundEvidence.afterStopCleanup.saved.runtime.capacity
        ?? roundEvidence.afterStopCleanup.saved.runtime.employeeCapacity
        ?? null);
      assert.deepEqual(scopedBindings(roundEvidence.afterStopCleanup.saved, scope), allBindings, "stop cleanup changed original Owner bindings");
      assert.equal(rootTask(readTasks, activeRoot).status, "stopped");
      const stoppedRuntime = readRuntime(activeRoot);
      const stoppedRequests = scenario.history.length;
      await withinDeadline(`round ${roundNumber} no automatic revival interval`, () => new Promise((resolve) => setTimeout(resolve, Math.min(1000, remaining()))));
      await withinDeadline(`round ${roundNumber} post-stop health`, healthy);
      assert.equal(rootTask(readTasks, activeRoot).status, "stopped", "stopped root revived without public continue");
      assert.deepEqual(readRuntime(activeRoot), stoppedRuntime, "stopped runtime changed without public continue");
      assert.equal(scenario.history.length, stoppedRequests, "stopped organization issued another provider request before continue");
      roundEvidence.noAutomaticRevival = { requestCount: stoppedRequests, stable: true };

      const stable = stableSnapshot(activeRoot, held.leaderTaskId);
      sameStableIdentity(original, { rootTask: rootTask(readTasks, activeRoot),
        leaderTask: leaderTask(readTasks, held.leaderTaskId, activeRoot), runtime: stable.runtime }, activeRoot, held.leaderTaskId, isExecutionBinding);
      const prompt = scenario.beginContinue(roundEvidence.afterStopCleanup, roundNumber, roundEvidence.pendingEvent);
      roundEvidence.prompt = prompt;
      group = panelAdapter;
      const subtitle = await group.locator("#panelSubtitle").getAttribute("title");
      assert.ok(subtitle?.endsWith(` · ${activeRoot}`), "continue panel belongs to another root");
      const continueButton = group.locator('#panelActions [data-action="continueTask"]');
      await wait(`round ${roundNumber} public continue enabled`, async () => await continueButton.isVisible().catch(() => false) && await continueButton.isEnabled().catch(() => false));
      await withinDeadline(`round ${roundNumber} public continue click`, () => continueButton.click());
      const input = group.locator("#continueDialogInput");
      await wait(`round ${roundNumber} continue dialog`, async () => await input.isVisible().catch(() => false));
      await withinDeadline(`round ${roundNumber} fill continue request`, () => input.fill(prompt));
      await withinDeadline(`round ${roundNumber} confirm continue`, () => group.locator("#continueDialogConfirm").click());
      scenario.confirmContinue(roundNumber);
      let nextRuntime = await wait(`round ${roundNumber} new owner generation`, () => {
        const runtime = readRuntime(activeRoot), currentGenerations = generationIds(runtime, held.leaderTaskId);
        const added = currentGenerations.filter((generation) => !stable.generations.includes(generation));
        assert.ok(added.length <= 1, "public continue created multiple leader generations");
        if (added.length !== 1) return null;
        const ownerBindings = runtime.executionBindings.filter(({ identity }) => identity?.role === "leader"
          && identity.leaderTaskId === held.leaderTaskId && identity.generation === added[0]);
        assert.ok(ownerBindings.length <= 1, "new generation has duplicate leader bindings");
        if (!completeBinding(ownerBindings[0], isExecutionBinding)) return null;
        const previous = leaderBindings[0];
        assertSuccessorBinding(previous, ownerBindings[0]);
        const currentLeader = leaderTask(readTasks, held.leaderTaskId, activeRoot);
        if (!currentLeader.executionSession) return null;
        assertTaskSession(currentLeader, ownerBindings[0]);
        assertBindingScope(ownerBindings[0], rootTask(readTasks, activeRoot), currentLeader);
        return runtime;
      });
      let after = { rootTask: rootTask(readTasks, activeRoot), leaderTask: leaderTask(readTasks, held.leaderTaskId, activeRoot), runtime: nextRuntime };
      sameStableIdentity(original, after, activeRoot, held.leaderTaskId, isExecutionBinding);
      sameStableIdentity(stable, after, activeRoot, held.leaderTaskId, isExecutionBinding);
      const stoppedReview = await withinDeadline(`round ${roundNumber} post-continue stopped event review`, () => scenario.waitForStoppedReview(roundNumber));
      assert.deepEqual([stoppedReview.eventId, stoppedReview.subtaskId, stoppedReview.attemptId, stoppedReview.outcome, stoppedReview.acceptance],
        [roundEvidence.pendingEvent.eventId, held.subtaskId, held.attemptId, "stopped", "failed"]);
      const acceptedState = await wait(`round ${roundNumber} persisted failed review and exact successor`, () => {
        const persistedLeader = leaderTask(readTasks, held.leaderTaskId, activeRoot);
        const seen = persistedLeader.loopPlus?.seenAttempts?.filter((item) => item.subtaskId === held.subtaskId && item.attemptId === held.attemptId) ?? [];
        const successor = persistedLeader.subTasks.find((subtask) => subtask.id === stoppedReview.subtaskIds?.[0]);
        return seen.length === 1 && seen[0].disposition === "reviewed" && seen[0].acceptance === "failed"
          && successor?.continueFromSubtaskId === held.subtaskId ? { leader: persistedLeader, successor } : null;
      });
      roundEvidence.successorBinding = structuredClone(await wait(`round ${roundNumber} complete successor binding and task session`, () => {
        const currentLeader = leaderTask(readTasks, held.leaderTaskId, activeRoot);
        const successor = currentLeader.subTasks.find((subtask) => subtask.id === acceptedState.successor.id);
        assert.equal(successor?.continueFromSubtaskId, held.subtaskId, "successor source changed after review");
        const runtime = readRuntime(activeRoot);
        const candidates = scopedBindings(runtime, scope).filter(({ identity }) => identity.role === "employee"
          && identity.subtaskId === successor.id);
        assert.ok(candidates.length <= 1, "successor has ambiguous employee bindings");
        if (!completeBinding(candidates[0], isExecutionBinding) || !successor.executionSession) return null;
        const binding = candidates[0];
        const attempts = currentLeader.loopPlus.seenAttempts.filter((item) => item.subtaskId === successor.id
          && item.attemptId === binding.identity.attemptId);
        assert.equal(attempts.length, 1, "successor binding has no exact persisted attempt");
        assert.equal(binding.identity.generation, Math.max(...generationIds(nextRuntime, held.leaderTaskId)), "successor has the wrong generation");
        assertBindingScope(binding, rootTask(readTasks, activeRoot), currentLeader);
        assertSuccessorBinding(employeeBindings[0], binding);
        assert.ok(allBindings.every(({ identity }) => identity.ownerId !== binding.identity.ownerId
          && identity.executionId !== binding.identity.executionId), "successor reused a historical Owner or execution");
        assertTaskSession(successor, binding);
        return binding;
      }));
      // Review/employee preparation can add bindings after leader adoption.
      // Keep the complete final read, and recheck immutable history at that boundary.
      nextRuntime = readRuntime(activeRoot);
      after = { rootTask: rootTask(readTasks, activeRoot), leaderTask: leaderTask(readTasks, held.leaderTaskId, activeRoot), runtime: nextRuntime };
      sameStableIdentity(original, after, activeRoot, held.leaderTaskId, isExecutionBinding);
      roundEvidence.stoppedReview = structuredClone(stoppedReview);
      roundEvidence.persistedSuccessor = structuredClone(acceptedState.successor);
      const currentExecutionIds = leaderExecutionIds(nextRuntime, held.leaderTaskId);
      const newExecutionIds = currentExecutionIds.filter((id) => !stable.leaderExecutionIds.includes(id));
      assert.ok(newExecutionIds.length > 0, "public continuation did not create a distinct successor leader execution Owner");
      assert.equal(after.rootTask.status, "running", "continued root did not resume");
      assert.equal(after.leaderTask.id, stable.leaderTask.id, "public continuation replaced original leader task");
      roundEvidence.afterContinue = { rootTask: structuredClone(after.rootTask), leaderTask: structuredClone(after.leaderTask),
        runtime: structuredClone(nextRuntime), nativeSessions: nativeSessions(nextRuntime, scope, isExecutionBinding), generations: generationIds(nextRuntime, held.leaderTaskId),
        leaderExecutionIds: currentExecutionIds, successorExecutionIds: newExecutionIds,
        executionBindings: structuredClone(nextRuntime.executionBindings),
        capacity: structuredClone(nextRuntime.capacity || nextRuntime.employeeCapacity || null),
        requestCount: scenario.history.length };
      await closeAdapter(panelAdapter);
      panelAdapter = null;
    }
    evidence.result = "two-stops-and-continues-observed";
    evidence.completedAt = new Date().toISOString();
    return evidence;
  } catch (error) {
    businessFailure = error;
    evidence.result = "failed";
    evidence.failure = { message: error.message, phase: evidence.rounds.length ? `round-${evidence.rounds.length}` : "round-1" };
    throw error;
  } finally {
    latchOwner?.releaseAll?.();
    await Promise.allSettled([...ownedAdapters].map(closeAdapter));
    if (cleanupDiagnostics.length) {
      evidence.result = "failed";
      if (businessFailure) businessFailure.cleanupDiagnostics = cleanupDiagnostics;
      else throw new Error(`successive CDP cleanup unconfirmed: ${JSON.stringify(cleanupDiagnostics)}`);
    }
  }
}

module.exports = { driveSuccessiveContinuation, pendingStoppedEvent, nativeSessions };
