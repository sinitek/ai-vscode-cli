import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import { DepartmentLeaderExecutionLedger } from "../../extensionHost/departmentleaderexecutionledger";
import { DepartmentRuntimeStore } from "../../extensionHost/departmentruntimestore";
import * as runtimeState from "../../extensionHost/departmentruntimestate";
import { deferred, ledgerSetup } from "./fixtures/departmentleaderexecutionfixture";

test("exact generation set durably includes coordinator and every employee before preparation/start", async (t) => {
  const f = ledgerSetup(t);
  assert.deepEqual(f.ledger.open(f.scope), { ok: true });
  const bindings = [f.binding("leader"), f.binding("employee", 1), f.binding("employee", 2)];
  for (const binding of bindings) await f.ledger.admit(f.scope, f.responsibility(binding), async (bind) => {
    const preparing = new DepartmentRuntimeStore(f.storeDirectory).readLeaderExecutionSet(f.scope);
    assert.ok(preparing.ok && preparing.value);
    assert.equal(preparing.value.set.entries.slice(-1)[0]?.executionId, null, "responsibility is durable before preparation");
    assert.deepEqual(bind(binding), { ok: true });
    const ready = f.read();
    assert.deepEqual(ready.executionBindings?.slice(-1)[0], binding, "binding is durable before start grant");
  });
  assert.deepEqual(await f.ledger.close(f.scope), { ok: true });
  const saved = f.read();
  assert.equal(saved.leaderExecutionSets?.[0].state, "closed");
  assert.equal(saved.leaderExecutionSets?.[0].entries.length, 3);
  assert.deepEqual(saved.executionBindings, bindings);
  assert.deepEqual(saved.capacity, f.value.capacity);
  assert.deepEqual(f.store.readLeaderExecutionSet({ ...f.scope, generation: 2 }), { ok: true, value: null });
});

test("missing producer, empty sets and employee-only sets cannot supply closure", async (t) => {
  const f = ledgerSetup(t), absent = new DepartmentLeaderExecutionLedger(f.store, null);
  assert.equal(absent.open(f.scope).ok, false);
  assert.equal((await absent.close(f.scope)).ok, false);
  await assert.rejects(absent.admit(f.scope, f.responsibility(f.binding("leader")), async () => undefined), /unavailable/);
  assert.equal(f.ledger.open(f.scope).ok, true);
  assert.equal((await f.ledger.close(f.scope)).ok, false);
  // A separate controlled fixture producer is required after its fence closes.
  assert.equal(f.store.registerLeaderExecution(f.scope, f.producer.producerId, f.responsibility(f.binding("employee"))).ok, true);
  assert.equal(f.store.closeLeaderExecutionSet(f.scope, { version: 1, scope: f.scope, producerId: f.producer.producerId, admissionFence: "fence" }).ok, false);
  assert.equal(f.read().leaderExecutionSets?.[0].state, "open");
});

test("producer fences late admission and drains in-flight preparation before immutable closure", async (t) => {
  const f = ledgerSetup(t), preparing = deferred(), finish = deferred();
  assert.equal(f.ledger.open(f.scope).ok, true);
  const b = f.binding("leader");
  const inFlight = f.ledger.admit(f.scope, f.responsibility(b), async (bind) => {
    preparing.resolve(); await finish.promise;
    assert.equal(bind(b).ok, true, "already admitted preparation can finish binding before closure");
  });
  await preparing.promise;
  let closed = false;
  const closing = f.ledger.close(f.scope).then((result) => { closed = true; return result; });
  await assert.rejects(f.add(f.binding("employee")), /fenced/);
  assert.equal(closed, false);
  assert.equal(f.read().leaderExecutionSets?.[0].state, "open");
  finish.resolve(); await inFlight;
  assert.deepEqual(await closing, { ok: true });
  assert.equal(f.store.registerLeaderExecution(f.scope, f.producer.producerId, f.responsibility(f.binding("employee"))).ok, false);
  assert.equal(f.store.bindLeaderExecution(f.scope, f.producer.producerId, b.identity.executionId, b).ok, false);
  assert.equal(f.ledger.open(f.scope).ok, false);
  assert.equal(f.store.closeLeaderExecutionSet(f.scope, { version: 1, scope: f.scope, producerId: f.producer.producerId, admissionFence: "replacement" }).ok, false);
  assert.deepEqual(await f.ledger.close(f.scope), { ok: true }, "same native fence is idempotent");
});

test("concurrent registration is idempotent, exact-attempt replacements fail, and later attempts remain distinct", async (t) => {
  const f = ledgerSetup(t); assert.equal(f.ledger.open(f.scope).ok, true);
  const b = f.binding("leader"), r = f.responsibility(b);
  await Promise.all([f.add(b), f.add(structuredClone(b))]);
  assert.equal(f.read().leaderExecutionSets?.[0].entries.length, 1);
  const changed = structuredClone(r); changed.requirements.tab = false;
  await assert.rejects(f.ledger.admit(f.scope, changed, async () => undefined), /conflict/);
  const newId = { ...r, registrationId: "different-registration" };
  await assert.rejects(f.ledger.admit(f.scope, newId, async () => undefined), /target-conflict/);
  await f.ledger.admit(f.scope, r, async (bind) => {
    const replacement = structuredClone(b); replacement.identity.ownerId = "different-owner";
    assert.equal(bind(replacement).ok, false);
    replacement.identity = { ...b.identity, executionId: "replacement" };
    assert.equal(bind(replacement).ok, false);
    assert.equal(bind({ ...b, requirements: { ...b.requirements, tab: false } }).ok, false);
  });
  const first = f.binding("employee", 1); await f.add(first);
  const later = f.binding("employee", 2);
  assert.equal(later.identity.role, "employee");
  if (later.identity.role === "employee" && first.identity.role === "employee") {
    later.identity.subtaskId = first.identity.subtaskId;
    assert.notEqual(later.identity.attemptId, first.identity.attemptId);
  }
  await f.add(later);
  const saved = f.read();
  assert.deepEqual(saved.executionBindings?.slice(-2), [first, later], "both attempts keep independent immutable execution identities");
  assert.deepEqual(saved.leaderExecutionSets?.[0].entries.slice(-2).map((entry) => entry.executionId), [first.identity.executionId, later.identity.executionId]);
  const replacement = structuredClone(later); replacement.identity.executionId = "replacement-execution";
  await f.ledger.admit(f.scope, f.responsibility(later), async (bind) => assert.equal(bind(replacement).ok, false));
  assert.deepEqual(f.read().executionBindings?.slice(-2), [first, later], "same attempt replacement cannot overwrite either history entry");
  assert.deepEqual(await f.ledger.close(f.scope), { ok: true });
});

test("failed and unbound preparation remain durable, escaped admission cannot bind later", async (t) => {
  const f = ledgerSetup(t); f.ledger.open(f.scope);
  const b = f.binding("leader"); let escaped!: (binding: typeof b) => { ok: boolean };
  await assert.rejects(f.ledger.admit(f.scope, f.responsibility(b), async (bind) => {
    escaped = bind;
    const unbound = structuredClone(b); unbound.identity.session = { state: "unbound" };
    assert.equal(bind(unbound).ok, false);
    throw new Error("native-prepare-failed");
  }), /native-prepare-failed/);
  assert.equal(escaped(b).ok, false);
  assert.equal(f.read().leaderExecutionSets?.[0].entries[0].executionId, null);
  assert.equal((await f.ledger.close(f.scope)).ok, true, "sealed but uncovered is distinct from complete cleanup");
});

test("stale controller writes retain sets; explicit deletion, reopening, edited identity and forged closure fail", async (t) => {
  const f = ledgerSetup(t); f.ledger.open(f.scope); await f.add(f.binding("leader")); await f.ledger.close(f.scope);
  assert.equal(f.store.write(f.value).ok, true);
  const base = f.read(), bytes = fs.readFileSync(f.file);
  for (const mutate of [
    (v: typeof base) => { v.leaderExecutionSets = []; },
    (v: typeof base) => { v.leaderExecutionSets![0].state = "open"; v.leaderExecutionSets![0].closure = null; },
    (v: typeof base) => { v.leaderExecutionSets![0].producerId = "changed"; },
    (v: typeof base) => { v.leaderExecutionSets![0].entries[0].executionId = null; },
    (v: typeof base) => { v.executionBindings![0].identity.ownerId = "changed"; },
    (v: typeof base) => { v.leaderExecutionSets![0].closure!.admissionFence = "forged"; },
  ]) { const changed = structuredClone(base); mutate(changed); assert.equal(f.store.write(changed).ok, false); assert.deepEqual(fs.readFileSync(f.file), bytes); }
});

test("legacy, incomplete old and corrupt records are never rebuilt as empty complete sets", async (t) => {
  const f = ledgerSetup(t);
  assert.deepEqual(f.store.readLeaderExecutionSet(f.scope), { ok: true, value: null });
  assert.equal(f.store.bindExecution("root", "workspace", f.binding("leader")).ok, true);
  assert.equal(f.ledger.open(f.scope).ok, false, "existing untracked execution cannot be adopted");
  const saved = f.read();
  for (const corrupt of ["{broken", JSON.stringify({ ...saved, leaderExecutionSets: [{ version: 1, scope: f.scope, state: "closed", entries: [] }] })]) {
    fs.writeFileSync(f.file, corrupt);
    assert.equal(f.store.readLeaderExecutionSet(f.scope).ok, false);
    assert.equal(f.store.write(f.value).ok, false);
    assert.equal(f.ledger.open(f.scope).ok, false);
    assert.equal(fs.readFileSync(f.file, "utf8"), corrupt);
  }
});

for (const phase of ["open", "register", "bind", "close"] as const) test(`atomic ${phase} failure retains original history and never grants start`, async (t) => {
  const f = ledgerSetup(t), b = f.binding("leader"), r = f.responsibility(b);
  if (phase !== "open") assert.equal(f.ledger.open(f.scope).ok, true);
  if (phase === "bind" || phase === "close") assert.equal(f.store.registerLeaderExecution(f.scope, f.producer.producerId, r).ok, true);
  if (phase === "close") assert.equal(f.store.bindLeaderExecution(f.scope, f.producer.producerId, r.registrationId, b).ok, true);
  const bytes = fs.readFileSync(f.file);
  t.mock.method(fs, "renameSync", () => { throw new Error("fixture-commit-failure"); });
  const operation = phase === "open" ? f.ledger.open(f.scope) : phase === "register" ? f.store.registerLeaderExecution(f.scope, f.producer.producerId, r)
    : phase === "bind" ? f.store.bindLeaderExecution(f.scope, f.producer.producerId, r.registrationId, b) : await f.ledger.close(f.scope);
  assert.ok(!operation.ok && /fixture-commit-failure/.test(operation.error));
  assert.deepEqual(fs.readFileSync(f.file), bytes);
  assert.equal(fs.readdirSync(f.storeDirectory).length, 1);
});

test("set operations reuse a single cold validation pass and never scan receipt directories", async (t) => {
  const f = ledgerSetup(t); f.ledger.open(f.scope); await f.add(f.binding("leader"));
  let reads = 0, validations = 0;
  const readFile = fs.readFileSync, validate = runtimeState.isDepartmentExecutionBinding;
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => { if (args[0] === f.file) reads++; return Reflect.apply(readFile, fs, args); });
  t.mock.method(runtimeState, "isDepartmentExecutionBinding", (v: unknown) => { validations++; return validate(v); });
  t.mock.method(fs, "readdirSync", () => { throw new Error("no-directory-scan"); });
  const b = f.binding("employee");
  assert.equal(f.store.registerLeaderExecution(f.scope, f.producer.producerId, f.responsibility(b)).ok, true);
  assert.equal(reads, 1); assert.equal(validations, 1);
  reads = validations = 0;
  assert.equal(f.store.bindLeaderExecution(f.scope, f.producer.producerId, b.identity.executionId, b).ok, true);
  assert.equal(reads, 1); assert.equal(validations, 2, "one history binding plus the new binding");
});

test("revoked capabilities and closure from a different exact scope cannot seal or authorize work", async (t) => {
  const f = ledgerSetup(t); f.ledger.open(f.scope); await f.add(f.binding("leader"));
  const before = fs.readFileSync(f.file);
  t.mock.method(f.producer, "closeAdmissionsAndDrain", async () => ({ version: 1 as const, scope: { ...f.scope, generation: 2 },
    producerId: f.producer.producerId, admissionFence: "wrong-generation-fence" }));
  assert.equal((await f.ledger.close(f.scope)).ok, false);
  assert.deepEqual(fs.readFileSync(f.file), before);
  f.producer.current = false;
  await assert.rejects(f.add(f.binding("employee")), /producer-unavailable/);
  assert.equal((await f.ledger.close(f.scope)).ok, false);
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test("failed registration never enters native preparation and old binding API cannot bypass tracked scope", async (t) => {
  const f = ledgerSetup(t); f.ledger.open(f.scope);
  let prepared = false;
  t.mock.method(fs, "renameSync", () => { throw new Error("fixture-registration-commit-failure"); });
  await assert.rejects(f.ledger.admit(f.scope, f.responsibility(f.binding("leader")), async () => { prepared = true; }), /commit-failure/);
  assert.equal(prepared, false);
  t.mock.restoreAll();
  assert.equal(f.read().leaderExecutionSets?.[0].entries.length, 0);
  const b = f.binding("employee");
  assert.equal(f.store.bindExecution(f.scope.rootTaskId, f.scope.workspace, b).ok, false);
  assert.equal(f.read().executionBindings, undefined);
  await f.add(b);
  assert.equal(f.store.bindExecution(f.scope.rootTaskId, f.scope.workspace, b).ok, true, "existing binding duplicates retain their legacy idempotency");
});
