import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { productionWiring, gate, until } from "./fixtures/departmentproductionwiringfixture";
import * as runtimeState from "../../extensionHost/departmentruntimestate";
import { loopPlusAcceptanceChecksFixture } from "../loopPlusAcceptFixture";

// Isolate actual production repositories and free native CLI workers from user
// configuration. Timing assertions use gates/counts, never elapsed time or GC.
function scenario(name: string, run: (t: test.TestContext) => Promise<void>) {
  if (process.env.R234_SCENARIO) {
    if (process.env.R234_SCENARIO === name) test(name, { timeout: 30000 }, run);
    return;
  }
  test(name, { timeout: 40000 }, async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "r234-user-"));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), R234_SCENARIO: name };
      delete env.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, ["--test", __filename], { env }); let output = "";
      child.stdout.on("data", (v) => output += v); child.stderr.on("data", (v) => output += v);
      assert.equal(await new Promise((r, j) => { child.once("error", j); child.once("close", r); }), 0, output);
      for (const count of output.match(/\{[^\n]*"reads"[^\n]*\}/g) ?? []) t.diagnostic(count);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}
function completed() { return { status: "completed", progressPercent: 100, answerConclusion: "受控要求已完成", finalSummary: "受控原生执行结束",
  acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "module", passed: true }] }; }

for (const [employees, history] of [[0, 0], [0, 128], [3, 128]]) scenario(`production observation phase bounded scans: ${employees + 1} bindings and ${history} historical bindings`, async (t) => {
    const h = await productionWiring(t, "codex", true, false);
    const consumed = gate(), releaseConsumers = gate(); let consumers = 0;
    if (employees) {
      h.beforeEmployeeConsumerFinish(async () => { if (++consumers === employees) consumed.resolve(); await releaseConsumers.promise; });
      h.answer(1, { status: "dispatch", subtasks: Array.from({ length: employees }, (_, n) => ({ id: "employee-" + n, title: "employee-" + n,
        taskType: "general", writeFiles: [], prompt: "Implement this complete isolated employee requirement and verify the changed source with meaningful tests; report actual results." })) });
      h.answer(2, { status: "wait", finalSummary: "等待原生消费者" });
    } else h.answer(1, completed());
    const started = await h.start(); assert.ok(started.ok);
    if (employees) {
      await consumed.promise;
      h.fixture.adapter.host().submitUserMessage(started.taskId, "核对目前真实进展");
      await until(() => h.mainCalls === 2 && fs.existsSync(h.file("eof-2")));
      const closing = h.producer.close(started.taskId);
      releaseConsumers.resolve(); assert.equal((await closing).ok, true);
    }
    await started.done;
    const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
    assert.equal(saved.value.executionBindings!.length, employees + 1);
    // Append unrelated valid completed history; no deletion or replacement of
    // existing bindings/sets. The production reader must still validate it all.
    for (let n = 0; n < history; n++) {
      const binding = structuredClone(saved.value.executionBindings![0]);
      binding.identity.leaderTaskId = "history-" + n; binding.identity.moduleId = "history-module-" + n;
      binding.identity.executionId = "historical-execution-" + n;
      saved.value.runtime.leaders.push({ taskId: binding.identity.leaderTaskId, leaderSubtaskId: binding.identity.moduleId, generation: 1, status: "completed" });
      saved.value.executionBindings!.push(binding);
    }
    assert.equal(h.store.write(saved.value).ok, true);
    const file = h.file("runtime/" + Buffer.from("root").toString("hex") + ".json");
    const read = fs.readFileSync, validate = runtimeState.isDepartmentExecutionBinding;
    let reads = 0, validations = 0;
    t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === file) reads++;
      return Reflect.apply(read, fs, args);
    });
    t.mock.method(runtimeState, "isDepartmentExecutionBinding", (value: unknown) => { validations++; return validate(value); });
    const observed = h.groupCleanup.observe(h.read(started.taskId)!, 1); assert.ok(observed); await observed.done;
    t.diagnostic(JSON.stringify({ bindings: employees + 1, history, reads, validations }));
    assert.ok(reads <= 30, `phase reads, independent of bindings: ${reads}`);
    assert.ok(validations <= reads * (employees + history + 1) + 4, `one linear validation per cold read: ${validations}`);
    assert.deepEqual(h.groupCleanup.observationState(), { generations: 0, subscribers: 0 });
    assert.equal(h.store.read("root", "workspace").ok, true);
    t.mock.restoreAll();
});

// Unconfirmed, refused and persistence-failed proofs are durable logError events.
// Confirmed, started and retained outcomes stay on logEssential. Neither channel is capacity authority.
const SYNTHETIC_MARKER = "SYNTHETIC_SENSITIVE";
type LifecycleEvent = { event: string; data: any };
type SensitiveWatch = { seen: boolean };

/** Marker presence only. Payloads are not stored and nothing is written to disk. */
function mentionsSynthetic(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (typeof value === "string") return value.includes(SYNTHETIC_MARKER);
  if (value instanceof Error) {
    if (seen.has(value)) return false;
    seen.add(value);
    return mentionsSynthetic(value.message, seen) || mentionsSynthetic(value.name, seen)
      || mentionsSynthetic((value as { code?: unknown }).code, seen)
      || mentionsSynthetic((value as { cause?: unknown }).cause, seen);
  }
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => mentionsSynthetic(item, seen));
  for (const key of Object.keys(value)) {
    if (key.includes(SYNTHETIC_MARKER) || mentionsSynthetic((value as Record<string, unknown>)[key], seen)) return true;
  }
  return false;
}

function isStructuredLifecycle(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === "object" && "stage" in data && "result" in data;
}

/** Business counts use the structured subset. Every logger argument is still scanned. */
function recordLifecycle(events: LifecycleEvent[], event: string, data: unknown, watch?: SensitiveWatch): Promise<void> {
  if (watch && !watch.seen && mentionsSynthetic([event, data])) watch.seen = true;
  if (isStructuredLifecycle(data)) events.push({ event, data });
  return Promise.resolve();
}

if (!process.env.R234_SCENARIO) test("synthetic marker check sees field-less lifecycle logs", () => {
  const samples: unknown[] = [
    `${SYNTHETIC_MARKER}_TEXT`,
    new Error(`${SYNTHETIC_MARKER}_ERROR`),
    { error: `${SYNTHETIC_MARKER}_CLOSURE` },
    { nested: { note: `${SYNTHETIC_MARKER}_NESTED` } },
  ];
  for (const data of samples) {
    const events: LifecycleEvent[] = [];
    const watch: SensitiveWatch = { seen: false };
    recordLifecycle(events, "department-leader-cleanup", data, watch);
    assert.equal(watch.seen, true);
    assert.equal(events.length, 0);
  }
  const named: LifecycleEvent[] = [];
  const namedWatch: SensitiveWatch = { seen: false };
  recordLifecycle(named, `${SYNTHETIC_MARKER}_EVENT`, undefined, namedWatch);
  assert.equal(namedWatch.seen, true);
  assert.equal(named.length, 0);
  const clean: LifecycleEvent[] = [];
  const cleanWatch: SensitiveWatch = { seen: false };
  recordLifecycle(clean, "department-leader-capacity", { stage: "capacity-release", result: "released", reason: "none" }, cleanWatch);
  assert.equal(cleanWatch.seen, false);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].data.result, "released");
});

scenario("cancelled observers detach synchronously while one original close owns pending preparation", async (t) => {
  const events: { event: string; data: any }[] = [];
  const logger = require("../../logger") as typeof import("../../logger");
  t.mock.method(logger, "logEssential", (event: string, data: unknown) => recordLifecycle(events, event, data));
  t.mock.method(logger, "logError", (event: string, data: unknown) => recordLifecycle(events, event, data));
  const h = await productionWiring(t, "codex", true, false), entered = gate(), release = gate();
  h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  const started = await h.start(); assert.ok(started.ok); await entered.promise;
  const close = h.producer.close.bind(h.producer);
  const drain = h.producer.producer.closeAdmissionsAndDrain.bind(h.producer.producer);
  let sharedDrain: Promise<unknown> | undefined;
  const drainGenerations: number[] = [];
  t.mock.method(h.producer.producer, "closeAdmissionsAndDrain", (scope: Parameters<typeof drain>[0]) => {
    const result = drain(scope);
    if (scope.leaderTaskId !== started.taskId || scope.generation !== 1) throw new Error("generation-close-scope-diverged");
    if (sharedDrain && result !== sharedDrain) throw new Error("generation-close-operation-diverged");
    sharedDrain ??= result;
    drainGenerations.push(scope.generation);
    return result;
  });
  // producer.close counts both the generation's shared cleanup and the adapter
  // fence. Observer reuse is the cleanup stack plus one drain promise.
  const closeSources: Array<"shared-cleanup" | "adapter-fence" | "other"> = [];
  t.mock.method(h.producer, "close", (id: string) => {
    if (id !== started.taskId) throw new Error("producer-close-task-diverged");
    const stack = new Error("producer.close").stack ?? "";
    closeSources.push(/[/\\]departmentproductioncleanup\.(?:js|ts)/.test(stack) ? "shared-cleanup"
      : stack.includes("closeDepartmentCoordinator") ? "adapter-fence" : "other");
    return close(id);
  });
  const task = h.read(started.taskId)!;
  for (let n = 0; n < 3; n++) {
    const abort = new AbortController(), observed = h.groupCleanup.observe(task, 1, abort.signal); assert.ok(observed);
    assert.deepEqual(h.groupCleanup.observationState(), { generations: 1, subscribers: 1 });
    abort.abort();
    assert.deepEqual(h.groupCleanup.observationState(), { generations: 1, subscribers: 0 });
    await assert.rejects(observed.done, /cancelled/);
  }
  assert.deepEqual(closeSources.filter((source) => source === "shared-cleanup"), ["shared-cleanup"],
    "the first observation owns the generation close before reobserve");
  assert.equal(closeSources.includes("other"), false);
  assert.deepEqual([...new Set(drainGenerations)], [1]);
  const waiters = Array.from({ length: 128 }, () => {
    const abort = new AbortController(), observed = h.groupCleanup.observe(task, 1, abort.signal); assert.ok(observed);
    return { abort, observed };
  });
  assert.equal(h.groupCleanup.observe(task, 1), null);
  assert.deepEqual(h.groupCleanup.observationState(), { generations: 1, subscribers: 128 });
  for (const w of waiters) { w.abort.abort(); await assert.rejects(w.observed.done, /cancelled/); }
  assert.deepEqual(closeSources.filter((source) => source === "shared-cleanup"), ["shared-cleanup"],
    "cancelled observers reuse this generation's original close");
  assert.deepEqual(closeSources.filter((source) => source === "adapter-fence"), ["adapter-fence"],
    "the other producer.close is the adapter fence for the same task");
  assert.equal(closeSources.includes("other"), false);
  assert.deepEqual(drainGenerations, [1, 1], "adapter fence joins the same generation close");
  assert.ok(sharedDrain);
  assert.deepEqual(h.groupCleanup.observationState(), { generations: 1, subscribers: 0 });
  assert.equal(events.filter((e) => e.event === "department-leader-cleanup" && e.data.stage === "producer-close" && e.data.result === "started").length, 1,
    "abort, subscriptions and overflow cannot repeat shared cleanup diagnostics");
  assert.equal(h.entries()[0].executionId, null);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
  const final = h.groupCleanup.observe(task, 1); assert.ok(final);
  const rejected = assert.rejects(final.done, /sealed|fence|cancel|unobservable|failed|unknown/);
  release.resolve(); await rejected; await started.done;
  assert.deepEqual(h.groupCleanup.observationState(), { generations: 0, subscribers: 0 });
  assert.equal(events.filter((e) => e.event === "department-leader-cleanup" && e.data.stage === "producer-close" && e.data.result !== "started").length, 1);
  assert.equal(events.filter((e) => e.data.result === "released").length, 0);
  for (const e of events.filter((e) => e.event === "department-leader-cleanup")) {
    assert.equal(e.data.rootTaskId, "root"); assert.equal(e.data.leaderTaskId, started.taskId); assert.equal(e.data.generation, 1);
  }
  assert.equal(h.wire().filter((m) => m.method === "turn/start").length, 0);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
});

for (const change of ["generation", "closure"] as const) scenario(`batch observation rejects ${change} mutation before aggregation`, async (t) => {
  const h = await productionWiring(t, "codex", true, false); h.answer(1, completed());
  const started = await h.start(); assert.ok(started.ok); await started.done;
  const observed = h.groupCleanup.observe(h.read(started.taskId)!, 1); assert.ok(observed);
  const rejected = assert.rejects(observed.done, change === "generation"
    ? /leader-execution-producer-closure-invalid/
    : /leader-execution-closure-immutable/);
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
  if (change === "generation") { read.value.runtime.leaders[0].generation = (read.value.runtime.leaders[0].generation ?? 1) + 1; assert.equal(h.store.write(read.value).ok, true); }
  if (change === "closure") {
    // External writer bypass, deliberately outside immutable store APIs: only
    // the final cold complete-set comparison can detect this valid replacement.
    read.value.leaderExecutionSets![0].closure!.admissionFence = "external-replacement";
    fs.writeFileSync(h.file("runtime/" + Buffer.from("root").toString("hex") + ".json"), JSON.stringify(read.value));
  }
  await rejected;
  assert.deepEqual(h.groupCleanup.observationState(), { generations: 0, subscribers: 0 });
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
});

scenario("pending native consumer keeps shared responsibility after every observer cancels", async (t) => {
  const h = await productionWiring(t, "codex", true, false), entered = gate(), release = gate();
  h.onEmployeeOutput(async () => { entered.resolve(); await release.promise; });
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
    prompt: "Implement the complete isolated employee requirement with meaningful source checks and report real changed paths and results." }] });
  h.answer(2, completed());
  const started = await h.start(); assert.ok(started.ok); await entered.promise;
  const abort = new AbortController(), observer = h.groupCleanup.observe(h.read(started.taskId)!, 1, abort.signal); assert.ok(observer);
  abort.abort(); await assert.rejects(observer.done, /cancelled/);
  assert.deepEqual(h.groupCleanup.observationState(), { generations: 1, subscribers: 0 });
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
  const remaining = h.groupCleanup.observe(h.read(started.taskId)!, 1); assert.ok(remaining);
  release.resolve(); await remaining.done; await started.done;
  assert.deepEqual(h.groupCleanup.observationState(), { generations: 0, subscribers: 0 });
  assert.equal(h.wire(h.file("employee")).filter((m) => m.method === "turn/start").length, 1);
});

for (const mode of ["normal", "evidence-rejected", "persistence", "closure-persistence", "throw", "reject"] as const) {
  scenario(`production diagnostic outcome and original receipt gates: ${mode}`, async (t) => {
    const logger = require("../../logger") as typeof import("../../logger");
    const events: LifecycleEvent[] = [];
    const sensitive: SensitiveWatch = { seen: false };
    t.mock.method(logger, "logError", (event: string, data: unknown) => recordLifecycle(events, event, data, sensitive));
    t.mock.method(logger, "logEssential", (event: string, data: unknown) => {
      const recorded = recordLifecycle(events, event, data, sensitive);
      if (mode === "throw") throw new Error(`${SYNTHETIC_MARKER}_LOG_ERROR`);
      return mode === "reject" ? Promise.reject(new Error(`${SYNTHETIC_MARKER}_LOG_ERROR`)) : recorded;
    });
    const h = await productionWiring(t, "codex", true, true);
    if (mode === "evidence-rejected") {
      const read = h.producer.observationSnapshot.bind(h.producer);
      t.mock.method(h.producer, "observationSnapshot", (...args: Parameters<typeof read>) => {
        const snapshot = read(...args);
        return { ...snapshot, task: { ...snapshot.task, executionSession: undefined } };
      });
    }
    if (mode === "persistence") {
      const write = h.store.write.bind(h.store);
      t.mock.method(h.store, "write", (value: Parameters<typeof write>[0]) => value.capacity.leaders.length === 0 && value.runtime.leaders.length > 0
        ? { ok: false, error: "SYNTHETIC_SENSITIVE_PERSIST_ERROR" } : write(value));
    }
    if (mode === "closure-persistence") t.mock.method(h.store, "closeLeaderExecutionSet", () => ({ ok: false, error: "SYNTHETIC_SENSITIVE_CLOSURE_ERROR" }));
    h.answer(1, completed()); const started = await h.start(); assert.ok(started.ok); await started.done;
    const retained = mode === "persistence" || mode === "closure-persistence" || mode === "evidence-rejected";
    assert.equal(h.composition.readCapacity("root")!.leaders.length, retained ? 1 : 0);
    const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
    assert.equal(saved.value.capacity.leaders.length, retained ? 1 : 0);
    assert.equal(saved.value.leaderExecutionSets![0].state, mode === "closure-persistence" ? "open" : "closed");
    // Read-only test audit of the original Owner's receipt. It is never injected
    // into production aggregation or used to authorize capacity release.
    const { DepartmentExecutionReceiptStore } = require("../../runtime/departmentexecutionreceiptstore") as typeof import("../../runtime/departmentexecutionreceiptstore");
    const { cleanupComplete } = require("../../runtime/departmentexecutionidentity") as typeof import("../../runtime/departmentexecutionidentity");
    const binding = saved.value.executionBindings![0];
    const receipt = new DepartmentExecutionReceiptStore(h.file("owners/" + binding.identity.ownerId)).read(binding.identity.executionId, binding.identity);
    assert.equal(receipt.kind, "ok");
    if (receipt.kind === "ok") {
      assert.equal(receipt.value.state, "cleaned"); assert.ok(receipt.value.receipt);
      assert.equal(cleanupComplete(receipt.value.receipt!.cleanup, binding.requirements), true);
    }
    assert.equal(events.filter((e) => e.event === "department-leader-capacity" && e.data.result === "released").length, retained ? 0 : 1);
    const owner = events.filter((e) => e.event === "department-leader-cleanup" && e.data.stage === "owner-receipts" && e.data.result !== "started");
    assert.equal(owner.length, mode === "closure-persistence" ? 0 : 1);
    if (owner.length) assert.equal(owner[0].data.result, mode === "evidence-rejected" ? "unconfirmed" : "confirmed");
    if (mode === "evidence-rejected") assert.equal(owner[0].data.reason, "evidence-rejected");
    if (mode === "persistence" || mode === "closure-persistence") assert.ok(events.some((e) => e.data.reason === "persistence-failed"));
    if (mode === "closure-persistence") assert.equal(events.filter((e) => e.event === "department-lifecycle-persistence-failed"
      && e.data.stage === "producer-close").length, 1, "original ledger instances share diagnostic suppression");
    assert.equal(sensitive.seen, false);
  });
}

scenario("actual stop and late original receipt retain generation with one stop summary", async (t) => {
  const logger = require("../../logger") as typeof import("../../logger");
  const events: { event: string; data: any }[] = [];
  t.mock.method(logger, "logEssential", (event: string, data: unknown) => { events.push({ event, data }); return Promise.resolve(); });
  const h = await productionWiring(t, "codex", true, true);
  h.answer(1, completed()); fs.writeFileSync(h.file("hold-pipe"), "held");
  const started = await h.start(); assert.ok(started.ok); await until(() => fs.existsSync(h.file("eof-1")));
  const stop1 = h.composition.host.stopRoot("root"), stop2 = h.composition.host.stopRoot("root");
  await new Promise((r) => setImmediate(r));
  assert.equal(events.filter((e) => e.data.result === "released").length, 0);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
  fs.rmSync(h.file("hold-pipe")); assert.equal(await stop1, true); assert.equal(await stop2, true); await started.done;
  const summaries = events.filter((e) => e.event === "department-root-stop-settled"); assert.equal(summaries.length, 1);
  assert.equal(summaries[0].data.confirmed, 1); assert.equal(summaries[0].data.unconfirmed, 0); assert.equal(summaries[0].data.retained, 0);
  const release = events.filter((e) => e.data.result === "released"); assert.equal(release.length, 1);
  for (const e of events.filter((e) => e.data.leaderTaskId)) assert.equal(e.data.generation, 1);
});
