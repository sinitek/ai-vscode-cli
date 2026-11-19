import test = require("node:test");
import assert = require("node:assert/strict");
import type { LoopPlusAttemptRequest } from "../../extensionHost/loopPlusOrchestration";
import type { LoopPlusAttemptExecutionLease } from "../../extensionHost/loopPlusRuntimeAdapter";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createLoopPlusRuntimeFixture } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const { withLoopSubtaskSession } = require("../../loopSubtaskSession") as typeof import("../../loopSubtaskSession");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function request(id = "A"): LoopPlusAttemptRequest {
  return {
    taskId: "admission-task", subtaskId: id, attemptId: `${id}-1`, title: id,
    prompt: `Complete ${id}`, modelPrompt: "model", writeFiles: [], round: 1, targetCli: "codex",
  };
}

test("admission wait creates no tab/root/CLI, owns no session lock and does not block main events", async (t) => {
  const pending = new Map<string, ReturnType<typeof deferred<LoopPlusAttemptExecutionLease | null>>>();
  const signals: AbortSignal[] = [];
  const fixture = createLoopPlusRuntimeFixture({
    acquireAttemptExecution: (input, signal) => {
      const grant = deferred<LoopPlusAttemptExecutionLease | null>();
      pending.set(input.subtaskId, grant);
      signals.push(signal);
      return grant.promise;
    },
  });
  t.after(() => fixture.dispose());
  const a = fixture.adapter.startAttempt(request("A"));
  const b = fixture.adapter.startAttempt(request("B"));
  assert.equal(pending.size, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.deepEqual(fixture.createdSubtaskTargets, []);
  assert.deepEqual(fixture.rootsCreated, []);
  assert.deepEqual(fixture.attemptCalls, []);
  // An admission waiter must not own even the source-subtask lock.
  assert.equal(await withLoopSubtaskSession("codex", null, async () => "free", {
    taskId: request().taskId, subtaskId: "A",
  }), "free");
  fixture.queueMain((input, tabId) => fixture.publish(input, tabId, { status: "end", content: "reviewed" }));
  assert.equal(await fixture.adapter.runMain({
    taskId: request().taskId, kind: "review", prompt: "review", modelPrompt: "review",
    reviewEventId: "event", target: fixture.target,
  }).promise, "reviewed");
  assert.equal(pending.size, 2);
  a.abort();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.equal((await a.promise).outcome, "stopped");
  let released = 0;
  pending.get("A")!.resolve({ release: () => { released += 1; } });
  pending.get("B")!.resolve(null);
  assert.equal((await b.promise).outcome, "stopped");
  assert.equal(released, 1);
  assert.deepEqual(fixture.rootsCreated, []);
  assert.deepEqual(fixture.cancelledTabs, []);
});

for (const role of ["backend", "frontend", "general"] as const) {
  test(`${role} passes the original request to admission and releases after successful root cleanup`, async (t) => {
    const events: string[] = [];
    const input = { ...request(), execution: { role, configId: "profile", model: "worker", thinkingMode: "high" as const } };
    const fixture = createLoopPlusRuntimeFixture({
      acquireAttemptExecution: async (received, signal) => {
        assert.equal(received, input);
        assert.equal(signal.aborted, false);
        events.push("acquire");
        return { release: () => { events.push("release"); } };
      },
      executionRootFactory: () => {
        events.push("root");
        return { cwd: "isolated", dispose: () => { events.push("dispose"); } };
      },
    });
    t.after(() => fixture.dispose());
    fixture.setAttemptAction((prompt, tabId) => {
      events.push("CLI");
      fixture.publish(prompt, tabId, { status: "end", content: "done" });
    });
    const handle = fixture.adapter.startAttempt(input);
    assert.deepEqual(await handle.promise, { outcome: "completed", detail: "done" });
    assert.deepEqual(events, ["acquire", "root", "CLI", "dispose", "release"]);
    assert.equal(fixture.closedSubtaskTabs.length, 0, "ordinary tabs wait for report/compaction acknowledgement");
    await handle.onCompleted?.();
    assert.equal(fixture.closedSubtaskTabs.length, 1);
    handle.abort({ closeTab: true });
    assert.deepEqual(fixture.cancelledTabs, []);
    assert.deepEqual(events, ["acquire", "root", "CLI", "dispose", "release"]);
  });
}

for (const admission of ["null", "throw", "reject"] as const) {
  test(`admission ${admission} is observable without execution resources`, async (t) => {
    const fixture = createLoopPlusRuntimeFixture({
      acquireAttemptExecution: () => {
        if (admission === "throw") { throw new Error("admission failed"); }
        return admission === "reject" ? Promise.reject(new Error("admission failed")) : Promise.resolve(null);
      },
    });
    t.after(() => fixture.dispose());
    const result = await fixture.adapter.startAttempt(request()).promise;
    assert.equal(result.outcome, admission === "null" ? "stopped" : "failed");
    if (admission !== "null") { assert.match(result.detail!, /admission failed/); }
    assert.deepEqual(fixture.createdSubtaskTargets, []);
    assert.deepEqual(fixture.rootsCreated, []);
    assert.deepEqual(fixture.attemptCalls, []);
  });
}

test("root creation failure releases once and preserves the failure", async (t) => {
  let released = 0;
  const fixture = createLoopPlusRuntimeFixture({
    acquireAttemptExecution: async () => ({ release: () => { released += 1; } }),
  });
  t.after(() => fixture.dispose());
  fixture.setRootFailure("root creation failed");
  const handle = fixture.adapter.startAttempt(request());
  assert.deepEqual(await handle.promise, { outcome: "failed", detail: "root creation failed" });
  handle.abort({ closeTab: true });
  assert.equal(released, 1);
  assert.deepEqual(fixture.attemptCalls, []);
  assert.deepEqual(fixture.cancelledTabs, []);
});

for (const releaseFails of [false, true]) {
  test(`CLI failure and root cleanup precede lease release (release fails=${releaseFails})`, async (t) => {
    let released = 0;
    const fixture = createLoopPlusRuntimeFixture({
      acquireAttemptExecution: async () => ({ release: () => {
        assert.deepEqual(fixture.rootsDisposed, [1]);
        released += 1;
        if (releaseFails) { throw new Error("lease failed"); }
      } }),
    });
    t.after(() => fixture.dispose());
    fixture.setAttemptAction(() => { throw new Error("CLI failed"); });
    const result = await fixture.adapter.startAttempt(request()).promise;
    assert.equal(result.outcome, "failed");
    assert.match(result.detail!, /CLI failed/);
    if (releaseFails) { assert.match(result.detail!, /lease failed/); }
    assert.equal(released, 1);
    assert.deepEqual(fixture.closedSubtaskTabs, []);
  });
}

test("directory cleanup and lease errors remain visible alongside the CLI error", async (t) => {
  const events: string[] = [];
  const fixture = createLoopPlusRuntimeFixture({
    acquireAttemptExecution: async () => ({ release: () => {
      events.push("release");
      throw new Error("lease failed");
    } }),
    executionRootFactory: () => ({ cwd: "isolated", dispose: () => {
      events.push("dispose");
      throw new Error("cleanup failed");
    } }),
  });
  t.after(() => fixture.dispose());
  fixture.setAttemptAction(() => { throw new Error("CLI failed"); });
  const result = await fixture.adapter.startAttempt(request()).promise;
  assert.equal(result.outcome, "failed");
  for (const error of ["CLI failed", "cleanup failed", "lease failed"]) { assert.ok(result.detail!.includes(error)); }
  assert.deepEqual(events, ["dispose", "release"]);
});

test("abort and explicit tab close keep a running lease until the CLI promise settles", async (t) => {
  const started = deferred<void>();
  const finish = deferred<void>();
  let released = 0;
  const fixture = createLoopPlusRuntimeFixture({
    acquireAttemptExecution: async () => ({ release: () => {
      assert.deepEqual(fixture.rootsDisposed, [1]);
      released += 1;
    } }),
  });
  t.after(() => fixture.dispose());
  fixture.setAttemptAction(async () => { started.resolve(); await finish.promise; });
  fixture.setCancelInvocation(() => undefined);
  const handle = fixture.adapter.startAttempt(request());
  await started.promise;
  handle.abort();
  handle.abort({ closeTab: true });
  assert.equal(released, 0);
  assert.deepEqual(fixture.rootsDisposed, []);
  assert.deepEqual(fixture.closedSubtaskTabs, []);
  assert.equal(fixture.cancelledTabs.length, 1);
  finish.resolve();
  assert.equal((await handle.promise).outcome, "stopped");
  handle.abort({ closeTab: true });
  assert.equal(released, 1);
  assert.equal(fixture.closedSubtaskTabs.length, 1);
});

for (const injected of [false, true]) {
  test(`cancelled session waiter cannot start or cancel the owning invocation (hook=${injected})`, async (t) => {
    const entered = deferred<void>();
    const unlock = deferred<void>();
    const owner = withLoopSubtaskSession("codex", null, async () => {
      entered.resolve();
      await unlock.promise;
    }, { taskId: request().taskId, subtaskId: "shared" });
    await entered.promise;
    let released = 0;
    const targetCreated = deferred<void>();
    const fixture = createLoopPlusRuntimeFixture({
      acquireAttemptExecution: injected ? async () => ({ release: () => { released += 1; } }) : undefined,
      onSubtaskTargetCreated: () => { targetCreated.resolve(); },
    });
    t.after(() => fixture.dispose());
    const handle = fixture.adapter.startAttempt(request("shared"));
    await targetCreated.promise;
    handle.abort({ closeTab: true });
    assert.deepEqual(fixture.rootsCreated, []);
    assert.deepEqual(fixture.cancelledTabs, []);
    unlock.resolve();
    await owner;
    assert.equal((await handle.promise).outcome, "stopped");
    assert.deepEqual(fixture.attemptCalls, []);
    assert.deepEqual(fixture.rootsCreated, []);
    assert.equal(released, injected ? 1 : 0);
  });

  test(`cancel during runPrompt preparation prevents CLI startup (hook=${injected})`, async (t) => {
    const preparing = deferred<void>();
    const prepare = deferred<void>();
    let released = 0;
    const fixture = createLoopPlusRuntimeFixture({
      acquireAttemptExecution: injected ? async () => ({ release: () => { released += 1; } }) : undefined,
      beforePromptStart: async () => { preparing.resolve(); await prepare.promise; },
    });
    t.after(() => fixture.dispose());
    const handle = fixture.adapter.startAttempt(request());
    await preparing.promise;
    handle.abort();
    assert.deepEqual(fixture.cancelledTabs, []);
    assert.deepEqual(fixture.rootsDisposed, []);
    assert.equal(released, 0);
    prepare.resolve();
    assert.equal((await handle.promise).outcome, "stopped");
    assert.deepEqual(fixture.attemptCalls, []);
    assert.deepEqual(fixture.rootsDisposed, [1]);
    assert.equal(released, injected ? 1 : 0);
  });
}

for (const timing of ["after-abort", "before-abort", "before-resume"] as const) {
  test(`cancel/grant race releases exactly once without late startup (${timing})`, async (t) => {
    const grant = deferred<LoopPlusAttemptExecutionLease | null>();
    const released = deferred<void>();
    let releases = 0;
    const fixture = createLoopPlusRuntimeFixture({ acquireAttemptExecution: () => grant.promise });
    t.after(() => fixture.dispose());
    const handle = fixture.adapter.startAttempt(request());
    const lease = { release: () => { releases += 1; released.resolve(); } };
    if (timing !== "after-abort") { grant.resolve(lease); }
    if (timing === "before-resume") { await Promise.resolve(); }
    handle.abort({ closeTab: true });
    assert.equal((await handle.promise).outcome, "stopped");
    if (timing === "after-abort") { grant.resolve(lease); }
    await released.promise;
    assert.equal(releases, 1);
    assert.deepEqual(fixture.createdSubtaskTargets, []);
    assert.deepEqual(fixture.rootsCreated, []);
    assert.deepEqual(fixture.attemptCalls, []);
  });
}

test("AbortSignal wakes a cooperating admission hook without starting execution", async (t) => {
  const observed = deferred<void>();
  const fixture = createLoopPlusRuntimeFixture({
    acquireAttemptExecution: (_input, signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { observed.resolve(); resolve(null); }, { once: true });
    }),
  });
  t.after(() => fixture.dispose());
  const handle = fixture.adapter.startAttempt(request());
  handle.abort();
  await observed.promise;
  assert.equal((await handle.promise).outcome, "stopped");
  assert.deepEqual(fixture.attemptCalls, []);
  assert.deepEqual(fixture.createdSubtaskTargets, []);
});

test("successful CLI with failed lease release reports failure once", async (t) => {
  let releases = 0;
  const fixture = createLoopPlusRuntimeFixture({
    acquireAttemptExecution: async () => ({ release: () => { releases += 1; throw new Error("release failed"); } }),
  });
  t.after(() => fixture.dispose());
  fixture.setAttemptAction((input, tabId) => fixture.publish(input, tabId, { status: "end", content: "done" }));
  const result = await fixture.adapter.startAttempt(request()).promise;
  assert.equal(result.outcome, "failed");
  assert.match(result.detail!, /release failed/);
  assert.equal(releases, 1);
  assert.deepEqual(fixture.rootsDisposed, [1]);
});

test("late grant release failure is logged after cancellation has settled", async (t) => {
  const grant = deferred<LoopPlusAttemptExecutionLease | null>();
  const released = deferred<void>();
  const fixture = createLoopPlusRuntimeFixture({ acquireAttemptExecution: () => grant.promise });
  t.after(() => fixture.dispose());
  const handle = fixture.adapter.startAttempt(request());
  handle.abort();
  assert.equal((await handle.promise).outcome, "stopped");
  grant.resolve({ release: () => { released.resolve(); throw new Error("late release failed"); } });
  await released.promise;
  assert.ok(fixture.logs.some((entry) => entry.event === "loop-attempt-late-lease-release-failed"
    && JSON.stringify(entry.detail).includes("late release failed")));
});

test("preparation failure keeps directory cleanup and lease release errors visible", async (t) => {
  let releases = 0;
  const fixture = createLoopPlusRuntimeFixture({
    acquireAttemptExecution: async () => ({ release: () => { releases += 1; throw new Error("lease failed"); } }),
    resolveThinkingMode: () => { throw new Error("preparation failed"); },
    executionRootFactory: () => ({ cwd: "isolated", dispose: () => { throw new Error("cleanup failed"); } }),
  });
  t.after(() => fixture.dispose());
  const result = await fixture.adapter.startAttempt(request()).promise;
  assert.equal(result.outcome, "failed");
  for (const error of ["preparation failed", "cleanup failed", "lease failed"]) { assert.ok(result.detail!.includes(error)); }
  assert.equal(releases, 1);
  assert.deepEqual(fixture.attemptCalls, []);
});

test("settled attempt cannot cancel another invocation reusing the same tab", async (t) => {
  const fixture = createLoopPlusRuntimeFixture();
  t.after(() => fixture.dispose());
  fixture.setSubtaskTab("shared-tab");
  fixture.setAttemptAction((input, tabId) => fixture.publish(input, tabId, { status: "stopped" }));
  const old = fixture.adapter.startAttempt(request("old"));
  assert.equal((await old.promise).outcome, "stopped");
  const started = deferred<void>();
  const finish = deferred<void>();
  fixture.setAttemptAction(async () => { started.resolve(); await finish.promise; });
  const current = fixture.adapter.startAttempt(request("new"));
  await started.promise;
  old.abort();
  assert.deepEqual(fixture.cancelledTabs, []);
  finish.resolve();
  await current.promise;
});


test("Department Owner finalization stays active despite an ordinary lost-invocation probe", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const ownerDone = deferred<void>();
  const issued = deferred<void>();
  let releases = 0;
  const fixture = createLoopPlusRuntimeFixture({
    ownsDepartmentAttemptResources: () => true,
    isInvocationActive: () => false,
    observeAttemptTermination: () => ({ done: ownerDone.promise }),
  });
  t.after(() => fixture.dispose());
  fixture.saveTask({ id: "admission-task", cli: "opencode", status: "running", subTasks: [],
    department: { role: "leader" } } as unknown as import("../../loopTaskStore").LoopTaskRecord);
  fixture.adapter.setDepartmentExecutionAdmission!(async () => ({ release() { releases++; } }));
  fixture.setAttemptAction((input, tabId) => {
    fixture.publish(input, tabId, { status: "end", content: "business result" });
    issued.resolve();
  });
  const attempt = fixture.adapter.startAttempt({ ...request(), targetCli: "opencode" });
  await issued.promise;
  await new Promise((resolve) => setImmediate(resolve));
  now += 10 * 60 * 1000;
  assert.equal(attempt.isActive?.(), true, "Owner cleanup still owns execution capacity");
  assert.equal(releases, 0);
  assert.deepEqual(fixture.closedSubtaskTabs, []);
  ownerDone.resolve();
  assert.equal((await attempt.promise).outcome, "completed");
  assert.equal(attempt.isActive?.(), false);
  assert.equal(releases, 1);
  assert.deepEqual(fixture.closedSubtaskTabs, [], "EH never duplicates Owner tab cleanup");
});

for (const fails of [false, true]) test(`department employees with Loop managed resources wait for original runner cleanup (failure=${fails})`, async t => {
  const terminal = deferred<void>(), issued = deferred<void>(); let releases = 0, quarantined = 0;
  const fixture = createLoopPlusRuntimeFixture({ ownsDepartmentAttemptResources: () => false,
    observeAttemptTermination: () => ({ done: terminal.promise }) });
  t.after(() => fixture.dispose());
  fixture.saveTask({ id: "admission-task", cli: "grok", status: "running", subTasks: [], department: { role: "leader" } } as unknown as import("../../loopTaskStore").LoopTaskRecord);
  fixture.adapter.setDepartmentExecutionAdmission!(async () => ({ release() { releases++; }, cleanupFailed() { quarantined++; } }));
  fixture.setAttemptAction((input, tabId) => { fixture.publish(input, tabId, { status: "end", content: "员工结果" }); issued.resolve(); });
  const attempt = fixture.adapter.startAttempt({ ...request(), targetCli: "grok" });
  await issued.promise; await new Promise<void>(r => setImmediate(r)); assert.equal(releases, 0);
  if (fails) terminal.reject(new Error("原 runner 清理失败")); else terminal.resolve();
  const result = await attempt.promise;
  assert.equal(result.outcome, fails ? "failed" : "completed");
  assert.equal(releases, fails ? 0 : 1); assert.equal(quarantined, fails ? 1 : 0);
});
