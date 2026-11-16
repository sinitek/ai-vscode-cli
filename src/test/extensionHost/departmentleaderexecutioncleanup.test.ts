import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { fork } from "node:child_process";
import { DepartmentLeaderExecutionCleanup } from "../../extensionHost/departmentleaderexecutioncleanup";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { departmentExecutionOwnerEndpoint } from "../../runtime/departmentexecutionowner";
import { DepartmentExecutionReceiptStore } from "../../runtime/departmentexecutionreceiptstore";
import { CLEANUP_PARTS, type CleanupRequirements, type CleanupResult, type DepartmentExecutionCleanup,
  type DepartmentExecutionIdentity } from "../../runtime/departmentexecutionidentity";
import { deferred, ledgerSetup } from "./fixtures/departmentleaderexecutionfixture";

const FIXTURE_REQUIREMENTS: CleanupRequirements = { processTerminal: true, turnTerminal: false, streams: true,
  runner: true, executionRoot: true, links: true, temp: true, tab: true };

async function sealed(t: import("node:test").TestContext, close = true) {
  const f = ledgerSetup(t); assert.equal(f.ledger.open(f.scope).ok, true);
  const bindings = [f.binding("leader"), f.binding("employee", 1), f.binding("employee", 2)];
  for (const b of bindings) await f.add(b);
  if (close) assert.deepEqual(await f.ledger.close(f.scope), { ok: true });
  return { ...f, bindings, cleanup: new DepartmentLeaderExecutionCleanup(f.store, f.owners, async () => true) };
}

test("legacy, open, empty, missing coordinator, unbound responsibility and wrong scope stay unobservable", async (t) => {
  const f = ledgerSetup(t), cleanup = new DepartmentLeaderExecutionCleanup(f.store, f.owners, async () => true);
  assert.equal(cleanup.observe(f.scope), null);
  f.ledger.open(f.scope); assert.equal(cleanup.observe(f.scope), null);
  await f.add(f.binding("employee")); assert.equal(cleanup.observe(f.scope), null);
  await f.ledger.admit(f.scope, f.responsibility(f.binding("leader")), async () => undefined);
  assert.equal((await f.ledger.close(f.scope)).ok, true);
  assert.equal(cleanup.observe(f.scope), null, "closed with missing native binding cannot aggregate");
  for (const change of [{ rootTaskId: "other" }, { workspace: "other" }, { leaderTaskId: "other" }, { moduleId: "other" }, { generation: 2 }]) {
    assert.equal(cleanup.observe({ ...f.scope, ...change }), null);
  }
  assert.equal(fs.existsSync(f.owners), false);
});

test("selection verifier rejection never contacts Owner or yields cleanup", async (t) => {
  const f = await sealed(t); let requests = 0;
  t.mock.method(DepartmentExecutionOwnerClient.prototype, "waitForCleanup", async () => { requests++; throw new Error("must-not-call"); });
  const observation = new DepartmentLeaderExecutionCleanup(f.store, f.owners, async () => false).observe(f.scope);
  assert.ok(observation); await assert.rejects(observation.done, /selection-conflict/); assert.equal(requests, 0);
});

for (const mutation of ["generation", "set", "closure", "corrupt", "missing"] as const) test(`post-wait re-read rejects ${mutation} changes`, async (t) => {
  const f = await sealed(t), entered = deferred(), proceed = deferred(); let count = 0, active = 0, maximum = 0;
  t.mock.method(DepartmentExecutionOwnerClient.prototype, "waitForCleanup", async (identity: DepartmentExecutionIdentity, requirements: CleanupRequirements) => {
    const expected = f.bindings[count]; assert.deepEqual(identity, expected.identity); assert.deepEqual(requirements, expected.requirements);
    active++; maximum = Math.max(maximum, active); count++;
    if (count === 3) { entered.resolve(); await proceed.promise; }
    active--; return {} as never;
  });
  const observation = f.cleanup.observe(f.scope); assert.ok(observation);
  const rejected = assert.rejects(observation.done, /generation-or-set-changed/);
  await entered.promise;
  const changed = f.read();
  if (mutation === "generation") { changed.runtime.leaders[0].generation = 2; assert.equal(f.store.write(changed).ok, true); }
  // External corruption is deliberately outside the single-writer API: the
  // final cold-read must still detect it rather than use cached success.
  if (mutation === "set") { changed.leaderExecutionSets![0].entries.pop(); changed.executionBindings!.pop(); fs.writeFileSync(f.file, JSON.stringify(changed)); }
  if (mutation === "closure") { changed.leaderExecutionSets![0].closure!.admissionFence = "external-replacement"; fs.writeFileSync(f.file, JSON.stringify(changed)); }
  if (mutation === "corrupt") fs.writeFileSync(f.file, "{bad");
  if (mutation === "missing") fs.unlinkSync(f.file);
  proceed.resolve(); await rejected; assert.equal(count, 3); assert.equal(maximum, 1);
});

for (const fault of ["missing", "failed", "identity", "policy", "conflict", "unknown"] as const) test(`one ${fault} receipt prevents serial aggregation success`, async (t) => {
  const f = await sealed(t), ownerDir = path.join(f.owners, "owner"); fs.mkdirSync(ownerDir, { recursive: true });
  const receiptStore = new DepartmentExecutionReceiptStore(path.join(f.directory, "receipt-fixture"));
  const receipts = f.bindings.map((binding) => {
    const cleanup = Object.fromEntries(CLEANUP_PARTS.map((part) => [part, binding.requirements[part]
      ? { status: "confirmed", evidence: "fixture-proof" } : { status: "not-applicable", reason: "fixture-na" }] satisfies [string, CleanupResult])) as DepartmentExecutionCleanup;
    return receiptStore.makeReceipt(binding.identity, 1, cleanup, binding.requirements);
  });
  const requests: string[] = [];
  const server = net.createServer((socket) => {
    let input = "";
    socket.on("data", (data) => {
      input += data.toString(); if (!input.endsWith("\n")) return;
      const request = JSON.parse(input); assert.equal(request.operation, "observe"); requests.push(request.identity.executionId);
      const index = f.bindings.findIndex((b) => b.identity.executionId === request.identity.executionId);
      const result: Record<string, unknown> = { status: "cleaned", identity: f.bindings[index].identity, receipt: structuredClone(receipts[index]) };
      if (index === 1) {
        const receipt = result.receipt as typeof receipts[number];
        if (fault === "missing") delete result.receipt;
        if (fault === "failed") receipt.cleanup.temp = { status: "failed", reason: "fixture-failure" };
        if (fault === "identity") receipt.identity.executionId = "other-execution";
        if (fault === "policy") { receipt.requirements.temp = false; receipt.cleanup.temp = { status: "not-applicable", reason: "fixture-na" }; }
        if (fault === "conflict" || fault === "unknown") { result.status = fault; delete result.receipt; result.reason = "fixture-unresolved"; }
      }
      socket.end(JSON.stringify({ version: 1, requestId: request.requestId, result }) + "\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(departmentExecutionOwnerEndpoint(ownerDir), resolve));
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  const observation = f.cleanup.observe(f.scope); assert.ok(observation);
  await assert.rejects(observation.done, /cleanup-observation/);
  assert.deepEqual(requests, ["leader-1", "employee-1"], "failure never skips forward to infer whole-set completion");
  assert.deepEqual(f.read().capacity, f.value.capacity);
});

type FixtureOwner = ReturnType<typeof createOwner>;

class FixtureStartupCleanupError extends Error {
  public constructor(public readonly startupError: Error, public readonly cleanupError: unknown) {
    super(`fixture-owner-startup-and-cleanup-failed: ${startupError.message}; ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
  }
}

function createOwner(f: Awaited<ReturnType<typeof sealed>>, ownerId: string, mode = "ok") {
  const ownerDir = path.join(f.owners, ownerId);
  const worker = path.join(__dirname, "..", "runtime", "fixtures", "departmentexecutionownerworker.js");
  const owner = fork(worker, ["owner", ownerDir, ownerId, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    owner.once("close", (code, signal) => resolve([code, signal]));
  });
  let ipcDisconnected = false;
  const disconnected = new Promise<void>((resolve) => owner.once("disconnect", () => { ipcDisconnected = true; resolve(); }));
  const started = new Set<string>(), waiters = new Map<string, ((error?: Error) => void)[]>();
  const payloadClosed = new Set<string>();
  const startupController = new AbortController();
  owner.on("message", (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const event = message as { payloadStarted?: unknown; payloadClosed?: unknown };
    if (typeof event.payloadStarted === "string") {
      started.add(event.payloadStarted);
      for (const finish of waiters.get(event.payloadStarted) ?? []) finish();
      waiters.delete(event.payloadStarted);
    }
    if (typeof event.payloadClosed === "string") payloadClosed.add(event.payloadClosed);
  });
  owner.on("error", () => undefined);
  void closed.then(() => {
    for (const callbacks of waiters.values()) for (const finish of callbacks) finish(new Error("fixture-owner-closed-before-payload-ready"));
    waiters.clear();
  });
  const fixture = { ownerDir, owner, closed, client: new DepartmentExecutionOwnerClient(ownerDir),
    ready: Promise.resolve(),
    cancelStartup: () => startupController.abort(),
    teardown: undefined as Promise<void> | undefined,
    send: (message: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
      if (!owner.connected) { reject(new Error("fixture-owner-ipc-disconnected")); return; }
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        owner.removeListener("close", onClose);
        owner.removeListener("disconnect", onDisconnect);
        if (error) reject(error); else resolve();
      };
      const onClose = (): void => finish(new Error("fixture-owner-closed-during-ipc-send"));
      const onDisconnect = (): void => finish(new Error("fixture-owner-ipc-disconnected-during-send"));
      owner.once("close", onClose); owner.once("disconnect", onDisconnect);
      try { owner.send(message, (error) => finish(error ?? undefined)); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    }),
    disconnected,
    isIpcDisconnected: () => ipcDisconnected,
    waitForLifecycleMessage: (key: "startupBlocked" | "startupError" | "payloadClosed" | "forcedPayloadsClosed" | "ipcDisconnecting" | "recoveryRejected", value?: string) => {
      if (key === "payloadClosed" && value && payloadClosed.has(value)) return Promise.resolve();
      if (owner.exitCode !== null || owner.signalCode !== null) return Promise.reject(new Error("fixture-owner-closed-before-" + key));
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error("fixture-owner-message-timeout:" + key)), 3_000);
        const onMessage = (message: unknown): void => {
          if (!message || typeof message !== "object") return;
          const event = message as Record<string, unknown>;
          if (event[key] !== true && (value === undefined || event[key] !== value)) return;
          finish();
        };
        const onClose = (): void => finish(new Error("fixture-owner-closed-before-" + key));
        const finish = (error?: Error): void => {
          clearTimeout(timer); owner.removeListener("message", onMessage); owner.removeListener("close", onClose);
          if (error) reject(error); else resolve();
        };
        owner.on("message", onMessage); owner.once("close", onClose);
      });
    },
    waitForPayload: (id: string) => started.has(id) ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout;
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        const callbacks = waiters.get(id) ?? [];
        waiters.set(id, callbacks.filter((callback) => callback !== finish));
        if (!waiters.get(id)?.length) waiters.delete(id);
        if (error) reject(error); else resolve();
      };
      timer = setTimeout(() => finish(new Error("fixture-payload-ready-timeout:" + id)), 3_000);
      waiters.set(id, [...(waiters.get(id) ?? []), finish]);
    }),
    release: (id: string) => fixture.send({ releaseExecution: true, executionId: id }),
    disconnect: () => fixture.send({ disconnectIpc: true }),
  };
  fixture.ready = waitForOwnerReady(owner, closed, startupController.signal);
  fixture.ready = fixture.ready.catch(async (startupError: unknown) => {
    try { await cleanupFixtureOwner(fixture); }
    catch (cleanupError) {
      throw new FixtureStartupCleanupError(startupError instanceof Error ? startupError : new Error(String(startupError)), cleanupError);
    }
    throw startupError;
  });
  return fixture;
}

function waitForOwnerReady(owner: ReturnType<typeof fork>, closed: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("fixture-owner-ready-timeout")), 1_000);
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); owner.removeListener("message", onMessage); owner.removeListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const onMessage = (message: unknown): void => {
      if (!message || typeof message !== "object") return;
      if ((message as { ready?: unknown }).ready === true) finish();
      else if (typeof (message as { startupError?: unknown }).startupError === "string") {
        finish(new Error("fixture-owner-startup-error:" + (message as { startupError: string }).startupError));
      }
    };
    const onError = (error: Error): void => finish(error);
    const onAbort = (): void => finish(new Error("fixture-owner-ready-cancelled"));
    owner.on("message", onMessage); owner.once("error", onError); signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void closed.then(() => finish(new Error("fixture-owner-closed-before-ready")));
  });
}

async function waitForClose(owner: FixtureOwner, timeoutMs: number): Promise<boolean> {
  if (owner.owner.exitCode !== null || owner.owner.signalCode !== null) { await owner.closed; return true; }
  let timer: NodeJS.Timeout | undefined;
  const ended = await Promise.race([owner.closed.then(() => true), new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  })]);
  if (timer) clearTimeout(timer);
  return ended;
}

async function cleanupFixtureOwner(owner: FixtureOwner, identity?: DepartmentExecutionIdentity): Promise<void> {
  if (owner.teardown) return owner.teardown;
  owner.teardown = (async () => {
    let forcedRecovery = Boolean(identity && owner.isIpcDisconnected());
    if (owner.owner.exitCode !== null || owner.owner.signalCode !== null) {
      await owner.closed;
      if (forcedRecovery) await assertForcedFixtureRecovery(owner, identity!);
      return;
    }
    let receiptConfirmed = false;
    if (identity) {
      try { await owner.release(identity.executionId); } catch { /* IPC may close while teardown is starting. */ }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 500);
      try {
        await owner.client.waitForCleanup(identity, FIXTURE_REQUIREMENTS, controller.signal);
        receiptConfirmed = true;
      } catch { /* Forced fixture recovery is not a cleanup receipt. */ }
      finally { clearTimeout(timer); }
    }
    if (owner.owner.connected) {
      try { await owner.send({ shutdown: true }); } catch { /* Shutdown can race with process exit. */ }
    }
    if (await waitForClose(owner, 750)) {
      if (forcedRecovery) await assertForcedFixtureRecovery(owner, identity!);
      return;
    }

    if (owner.owner.connected) {
      try {
        await owner.send({ forceFixtureRecovery: true });
        forcedRecovery = true;
        await owner.waitForLifecycleMessage("forcedPayloadsClosed");
        if (!await waitForClose(owner, 1_500)) throw new Error("fixture-owner-did-not-exit-after-forced-recovery");
      } catch { /* A disconnected IPC channel has no path to fixture-owned children. */ }
    }
    if (owner.owner.exitCode === null && owner.owner.signalCode === null) {
      owner.owner.kill();
      if (!await waitForClose(owner, 3_000)) throw new Error("fixture-owner-process-did-not-close-after-kill");
    }
    if (identity && (forcedRecovery || owner.isIpcDisconnected())) {
      assert.equal(receiptConfirmed, false, "forced fixture recovery cannot be treated as a real receipt");
      forcedRecovery = true;
      await assertForcedFixtureRecovery(owner, identity);
    }
  })();
  return owner.teardown;
}

async function assertForcedFixtureRecovery(owner: FixtureOwner, identity: DepartmentExecutionIdentity): Promise<void> {
  assert.equal(owner.owner.exitCode !== null || owner.owner.signalCode !== null, true,
    "fixture Owner must have reached an actual close event before forced recovery is verified");
  const lifecycleFile = path.join(owner.ownerDir, "fixture-payload-lifecycle.jsonl");
  const events = fs.existsSync(lifecycleFile)
    ? fs.readFileSync(lifecycleFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
  assert.ok(events.some((event) => event.event === "closed" && event.executionId === identity.executionId
    && event.ownerId === identity.ownerId), "the worker recorded this exact payload's actual close callback");
  const read = new DepartmentExecutionReceiptStore(owner.ownerDir).read(identity.executionId, identity);
  assert.ok(read.kind !== "ok" || read.value.state !== "cleaned" || !read.value.receipt,
    "forced fixture recovery leaves no successful cleaned receipt");
}

function fixtureEvents(owner: FixtureOwner): Record<string, unknown>[] {
  const lifecycleFile = path.join(owner.ownerDir, "fixture-payload-lifecycle.jsonl");
  return fs.existsSync(lifecycleFile)
    ? fs.readFileSync(lifecycleFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
}

async function startOwner(f: Awaited<ReturnType<typeof sealed>>, mode = "ok"): Promise<FixtureOwner> {
  const owner = createOwner(f, "owner", mode); await owner.ready; return owner;
}

function startOwnerForIdentity(f: Awaited<ReturnType<typeof sealed>>, identity: DepartmentExecutionIdentity, cleanupMode = "ok"): FixtureOwner {
  return createOwner(f, identity.ownerId, cleanupMode);
}

test("same subtask attempts aggregate independently: an older live Owner blocks until both receipts exist", { timeout: 20000 }, async (t) => {
  const base = ledgerSetup(t); assert.equal(base.ledger.open(base.scope).ok, true);
  const f = { ...base, bindings: [] as ReturnType<typeof base.binding>[],
    cleanup: new DepartmentLeaderExecutionCleanup(base.store, base.owners, async () => true) };
  const firstEmployee = f.binding("employee", 1), secondEmployee = f.binding("employee", 2);
  assert.equal(firstEmployee.identity.role, "employee"); assert.equal(secondEmployee.identity.role, "employee");
  if (firstEmployee.identity.role === "employee" && secondEmployee.identity.role === "employee") {
    secondEmployee.identity.subtaskId = firstEmployee.identity.subtaskId;
    firstEmployee.identity.ownerId = "owner-attempt-1";
    secondEmployee.identity.ownerId = "owner-attempt-2";
    f.value.capacity.employees = [firstEmployee, secondEmployee].map((binding) => {
      const identity = binding.identity;
      return JSON.stringify([identity.leaderTaskId, identity.role === "employee" ? identity.attemptId : null]);
    });
    assert.equal(f.store.write(f.value).ok, true, "fixture leases both real attempts before admission");
  }
  const bindings = [f.binding("leader"), firstEmployee, secondEmployee];
  f.bindings = bindings;
  bindings[0].identity.ownerId = "owner-coordinator";
  const owners: FixtureOwner[] = [];
  try {
    for (const binding of bindings) await f.ledger.admit(f.scope, f.responsibility(binding), async (bind) => {
      const result = bind(binding);
      assert.equal(result.ok, true, result.ok ? undefined : result.error);
    });
    const current = f.read();
    assert.deepEqual(current.leaderExecutionSets?.[0].entries.map((entry) => entry.executionId), bindings.map((b) => b.identity.executionId));
    assert.deepEqual(current.executionBindings, bindings);
    for (const binding of bindings) {
      const owner = startOwnerForIdentity(f, binding.identity, binding === firstEmployee ? "hold" : "ok"); owners.push(owner);
      await owner.ready;
      assert.equal((await owner.client.startExecution(binding.identity)).status, "live");
      if (binding === firstEmployee) await owner.waitForPayload(binding.identity.executionId);
    }
    // Let the coordinator and later attempt finish; retain the first attempt live.
    await owners[0].client.waitForCleanup(bindings[0].identity, bindings[0].requirements);
    await owners[2].client.waitForCleanup(bindings[2].identity, bindings[2].requirements);
    assert.equal((await f.ledger.close(f.scope)).ok, true);
    const reachedOldAttempt = deferred(); let settled = false;
    const cleanup = new DepartmentLeaderExecutionCleanup(f.store, f.owners, async (binding) => {
      if (binding.identity.executionId === firstEmployee.identity.executionId) reachedOldAttempt.resolve();
      return true;
    });
    const observation = cleanup.observe(f.scope); assert.ok(observation);
    void observation.done.then(() => { settled = true; }, () => undefined);
    await reachedOldAttempt.promise;
    assert.equal((await owners[1].client.observeExecution(firstEmployee.identity)).status, "live");
    assert.equal(settled, false, "the older attempt remains an independent required execution");
    owners[1].release(firstEmployee.identity.executionId);
    await owners[1].client.waitForCleanup(firstEmployee.identity, firstEmployee.requirements);
    await observation.done;
    assert.equal(settled, true);
    assert.deepEqual(f.read().executionBindings, bindings, "cold read retains both same-subtask attempts after aggregation");
  } finally {
    for (let index = 0; index < owners.length; index++) await cleanupFixtureOwner(owners[index], bindings[index]?.identity);
  }
});

test("fixture cleanup releases a held payload and confirms the created Owner process exits", { timeout: 10000 }, async (t) => {
  const f = await sealed(t), binding = f.bindings[1];
  const owner = startOwnerForIdentity(f, binding.identity, "hold"); await owner.ready;
  t.after(async () => cleanupFixtureOwner(owner, binding.identity));
  assert.equal((await owner.client.startExecution(binding.identity)).status, "live");
  await owner.waitForPayload(binding.identity.executionId);
  const rejected = new Promise<string>((resolve) => owner.owner.once("message", (message: unknown) => {
    if (message && typeof message === "object" && typeof (message as { shutdownRejected?: unknown }).shutdownRejected === "string") {
      resolve((message as { shutdownRejected: string }).shutdownRejected);
    }
  }));
  owner.owner.send({ shutdown: true });
  assert.match(await rejected, /live|execution|close/i);
  await cleanupFixtureOwner(owner, binding.identity);
  assert.ok(owner.owner.exitCode !== null || owner.owner.signalCode !== null);
  assert.equal((await owner.closed)[0], 0);
});

test("fixture teardown cancels a live-receipt wait and kills only its unresponsive Owner and payload", { timeout: 10000 }, async (t) => {
  const f = await sealed(t), binding = f.bindings[1];
  const owner = startOwnerForIdentity(f, binding.identity, "ignore-release");
  t.after(async () => cleanupFixtureOwner(owner, binding.identity));
  await owner.ready;
  assert.equal((await owner.client.startExecution(binding.identity)).status, "live");
  await owner.waitForPayload(binding.identity.executionId);
  const payloadClosed = owner.waitForLifecycleMessage("payloadClosed", binding.identity.executionId);
  await cleanupFixtureOwner(owner, binding.identity);
  const [code, signal] = await owner.closed;
  assert.ok(code !== null || signal !== null, "the test-owned Owner reached an actual close event");
  await payloadClosed;
  const receipt = new DepartmentExecutionReceiptStore(owner.ownerDir).read(binding.identity.executionId, binding.identity);
  assert.ok(receipt.kind !== "ok" || receipt.value.state !== "cleaned" || !receipt.value.receipt,
    "forced fixture recovery did not write a successful receipt");
  await assert.rejects(owner.client.waitForCleanup(binding.identity, binding.requirements), /unknown|unreachable|conflict/);
});

test("fixture IPC disconnect closes its live payload and Owner without a successful receipt", { timeout: 10000 }, async (t) => {
  const f = await sealed(t), binding = f.bindings[1], owner = startOwnerForIdentity(f, binding.identity, "ignore-release");
  t.after(async () => cleanupFixtureOwner(owner, binding.identity));
  await owner.ready;
  assert.equal((await owner.client.startExecution(binding.identity)).status, "live");
  await owner.waitForPayload(binding.identity.executionId);
  await owner.disconnect();
  await owner.disconnected;
  await assert.rejects(owner.send({ shutdown: true }), /disconnected|channel|closed/i);
  await cleanupFixtureOwner(owner, binding.identity);
  const [code, signal] = await owner.closed;
  assert.ok(code !== null || signal !== null, "the test-owned Owner process reached an actual close event");
  await assertForcedFixtureRecovery(owner, binding.identity);
  assert.ok(fixtureEvents(owner).some((event) => event.event === "ipcSendFailed" && event.operation === "payloadClosed"),
    "the send callback failure after IPC disconnect is recorded without blocking payload close");
  await assert.rejects(owner.client.waitForCleanup(binding.identity, binding.requirements), /unknown|unreachable|conflict/);
});

test("forced recovery rejection is observed after payload close and cannot become a successful receipt", { timeout: 10000 }, async (t) => {
  const f = await sealed(t), binding = f.bindings[1], owner = startOwnerForIdentity(f, binding.identity, "recovery-reject");
  t.after(async () => cleanupFixtureOwner(owner, binding.identity));
  await owner.ready;
  assert.equal((await owner.client.startExecution(binding.identity)).status, "live");
  await owner.waitForPayload(binding.identity.executionId);
  const recoveryRejected = owner.waitForLifecycleMessage("recoveryRejected", "fixture-injected-recovery-rejection");
  await owner.send({ forceFixtureRecovery: true });
  await recoveryRejected;
  const [code, signal] = await owner.closed;
  assert.ok(code !== null || signal !== null, "the recovery failure still settles the test-owned Owner process");
  await cleanupFixtureOwner(owner, binding.identity);
  assert.equal(code, 2, "an observed recovery failure cannot exit successfully");
  await assertForcedFixtureRecovery(owner, binding.identity);
  assert.ok(fixtureEvents(owner).some((event) => event.event === "recoveryFailed"
    && event.operation === "explicit" && event.error === "fixture-injected-recovery-rejection"));
  await assert.rejects(owner.client.waitForCleanup(binding.identity, binding.requirements), /unknown|unreachable|conflict/);
});

test("Owner readiness failure or silence is bounded and reclaims the forked fixture handle", { timeout: 10000 }, async (t) => {
  const f = await sealed(t);
  for (const mode of ["startup-error", "no-ready"] as const) {
    const owner = createOwner(f, "owner", mode);
    t.after(async () => cleanupFixtureOwner(owner));
    if (mode === "no-ready") await owner.waitForLifecycleMessage("startupBlocked");
    await assert.rejects(owner.ready, mode === "no-ready" ? /ready-timeout/ : /startup-error/);
    assert.ok(owner.owner.exitCode !== null || owner.owner.signalCode !== null,
      `${mode} readiness rejection waits until the created process is actually terminal`);
    const [code, signal] = await owner.closed;
    assert.ok(code !== null || signal !== null, `${mode} fixture process closed before helper returned a usable Owner`);
  }
  const cancelled = createOwner(f, "owner", "no-ready");
  t.after(async () => cleanupFixtureOwner(cancelled));
  await cancelled.waitForLifecycleMessage("startupBlocked");
  cancelled.cancelStartup();
  await assert.rejects(cancelled.ready, /ready-cancelled/);
  assert.ok(cancelled.owner.exitCode !== null || cancelled.owner.signalCode !== null,
    "caller cancellation rejects only after the created process is actually terminal");
  const [code, signal] = await cancelled.closed;
  assert.ok(code !== null || signal !== null, "caller cancellation also reclaims its forked fixture handle");
});

test("early startup IPC failure falls back to observable diagnostics when the Owner directory does not exist", { timeout: 10000 }, async (t) => {
  const f = await sealed(t), ownerId = "startup-error-ipc-unavailable";
  const ownerDir = path.join(f.owners, ownerId);
  const worker = path.join(__dirname, "..", "runtime", "fixtures", "departmentexecutionownerworker.js");
  const owner = fork(worker, ["owner", ownerDir, ownerId, "startup-error-ipc-unavailable"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const stderr: string[] = [];
  owner.stderr?.setEncoding("utf8");
  owner.stderr?.on("data", (chunk: string) => stderr.push(chunk));
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    owner.once("close", (code, signal) => resolve([code, signal]));
  });
  owner.on("error", () => undefined);
  t.after(async () => {
    if (owner.exitCode === null && owner.signalCode === null) {
      owner.kill();
      await closed;
    }
  });

  const [code, signal] = await closed;
  assert.ok(code !== null || signal !== null, "the test-owned worker reached its actual close event");
  assert.equal(code, 2, "startup failure remains a nonzero outcome after diagnostic fallback");
  assert.equal(fs.existsSync(ownerDir), false, "fallback does not create Owner/lifecycle evidence before server setup");
  const output = stderr.join("");
  assert.match(output, /fixture-diagnostic-fallback:/, "diagnostic persistence failure is reported through stderr");
  assert.match(output, /fixture-startup-failure/, "the original startup error remains observable");
  assert.match(output, /ERR_IPC_CHANNEL_CLOSED|Channel closed|IPC.*closed/i, "the failed startup notification send remains observable");
  assert.match(output, /ENOENT/, "the secondary lifecycle-record failure remains observable");
  assert.doesNotMatch(output, /UnhandledPromiseRejection|unhandledRejection/, "diagnostic handling settles without an unhandled rejection");
});

test("complete persisted set aggregates real independent Node Owner receipts for coordinator and all employees", { timeout: 15000 }, async (t) => {
  const f = await sealed(t, false), actual = await startOwner(f);
  try {
    for (const binding of f.bindings) await f.ledger.admit(f.scope, f.responsibility(binding), async (bind) => {
      assert.equal(bind(binding).ok, true);
      assert.equal((await actual.client.startExecution(binding.identity)).status, "live");
    });
    assert.equal((await f.ledger.close(f.scope)).ok, true);
    const observation = f.cleanup.observe(f.scope); assert.ok(observation); await observation.done;
    for (const binding of f.bindings) assert.equal((await actual.client.observeExecution(binding.identity)).status, "cleaned");
    assert.deepEqual(fs.readFileSync(path.join(actual.ownerDir, "spawn-count.txt"), "utf8").trim().split("\n"), f.bindings.map((b) => b.identity.executionId));
    assert.deepEqual(f.read().capacity, f.value.capacity, "library has no lease release authority");
    await cleanupFixtureOwner(actual); assert.equal((await actual.closed)[0], 0);
    const lost = f.cleanup.observe(f.scope); assert.ok(lost); await assert.rejects(lost.done, /owner-unreachable/);
  } finally { await cleanupFixtureOwner(actual, f.bindings[0].identity); }
});

test("one real live employee blocks whole set; cancellation only ends observation and Owner continues", { timeout: 15000 }, async (t) => {
  const f = await sealed(t, false), actual = await startOwner(f), controller = new AbortController(), employeeSelected = deferred();
  try {
    // Coordinator and the final employee have receipts, but the middle employee
    // is still a live independent execution when aggregation reaches it.
    const start = async (index: number): Promise<void> => f.ledger.admit(f.scope, f.responsibility(f.bindings[index]), async (bind) => {
      assert.equal(bind(f.bindings[index]).ok, true);
      assert.equal((await actual.client.startExecution(f.bindings[index].identity)).status, "live");
    });
    for (const index of [0, 2]) await start(index);
    await actual.client.waitForCleanup(f.bindings[0].identity, f.bindings[0].requirements);
    await actual.client.waitForCleanup(f.bindings[2].identity, f.bindings[2].requirements);
    await start(1);
    assert.equal((await f.ledger.close(f.scope)).ok, true);
    let resolved = false;
    const cleanup = new DepartmentLeaderExecutionCleanup(f.store, f.owners, async (b) => {
      if (b.identity.executionId === "employee-1") employeeSelected.resolve(); return true;
    });
    const observation = cleanup.observe(f.scope, controller.signal); assert.ok(observation);
    void observation.done.then(() => { resolved = true; }, () => undefined);
    const rejected = assert.rejects(observation.done, /cancelled/);
    await employeeSelected.promise;
    assert.equal((await actual.client.observeExecution(f.bindings[1].identity)).status, "live");
    assert.equal(resolved, false);
    controller.abort(); await rejected;
    assert.equal((await actual.client.observeExecution(f.bindings[1].identity)).status, "live", "cancellation did not stop execution");
    await actual.client.waitForCleanup(f.bindings[1].identity, f.bindings[1].requirements);
    const retry = f.cleanup.observe(f.scope); assert.ok(retry); await retry.done;
    assert.deepEqual(f.read().capacity, f.value.capacity);
    assert.equal(fs.readFileSync(path.join(actual.ownerDir, "spawn-count.txt"), "utf8").trim().split("\n").length, 3);
    await cleanupFixtureOwner(actual); assert.equal((await actual.closed)[0], 0);
  } finally { await cleanupFixtureOwner(actual, f.bindings[1].identity); }
});

test("pre-cancelled aggregate does not even verify selection or contact Owner", async (t) => {
  const f = await sealed(t), controller = new AbortController(); controller.abort();
  const observation = new DepartmentLeaderExecutionCleanup(f.store, f.owners, async () => { throw new Error("must-not-verify"); }).observe(f.scope, controller.signal);
  assert.ok(observation); await assert.rejects(observation.done, /cancelled/); assert.equal(fs.existsSync(f.owners), false);
});
