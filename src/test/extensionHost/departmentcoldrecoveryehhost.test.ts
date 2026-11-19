import test = require("node:test");
import assert = require("node:assert/strict");
import { delayColdOriginalCleanup, createDepartmentColdRecoveryFirstEntry, createDepartmentColdRecoverySecondEntry } from "./fixtures/departmentcoldrecoveryehhost";

function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
test("cold EH consumption barrier waits original success, preserves receiver and keeps original rejection", async () => {
  const original = gate(), release = gate(); let recorded = 0, calls = 0;
  const group = { value: 7, observe(task: { id: string }, generation: number) {
    assert.equal(this, group); assert.equal(task.id, "original"); assert.equal(generation, 3); calls++; return { done: original.promise };
  } };
  delayColdOriginalCleanup(group, () => { recorded++; }, release.promise);
  const result = group.observe({ id: "original" }, 3); let consumed = false;
  void result.done.then(() => { consumed = true; });
  await Promise.resolve(); assert.equal(recorded, 0); assert.equal(consumed, false);
  original.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(recorded, 1); assert.equal(consumed, false); assert.equal(calls, 1);
  release.resolve(); await result.done; assert.equal(consumed, true);
  const error = new Error("original-required-resource-unconfirmed");
  const failed = { observe() { return { done: Promise.reject(error) }; } };
  delayColdOriginalCleanup(failed, () => assert.fail("failure is not cleanup"), Promise.resolve());
  await assert.rejects(failed.observe().done, e => e === error);
  const missing = { observe() { return null; } }; delayColdOriginalCleanup(missing, () => assert.fail(), release.promise);
  assert.equal(missing.observe(), null);
});

test("cold EH entries compile and install public API observer before production activation", () => {
  const first = createDepartmentColdRecoveryFirstEntry({ root: "/owned", timeoutMs: 1000 });
  const second = createDepartmentColdRecoverySecondEntry({ root: "/owned", home: "/owned/home", rootTaskId: "root-original", deadline: 1000 });
  for (const entry of [first, second]) {
    new Function("require", "exports", entry);
    assert.ok(entry.indexOf("installColdPublicControlObserver") < entry.indexOf("await extension.activate()"));
    assert.ok(!entry.includes("producerProof"));
    assert.ok(entry.includes("createRequire(path.join(extension.extensionPath, 'package.json'))('vscode')"));
    assert.ok(!entry.includes("require.resolve('vscode'"));
  }
  assert.ok(!second.includes("createTask(")); assert.ok(!second.includes("recoverRoot("));
});

import { publishColdObservation } from "./fixtures/departmentcoldrecoveryehhost";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
test("cold snapshots publish atomically to harness paths and leave no partial JSON", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cold-eh-publication-"));
  try {
    const file = path.join(directory, "observation.json");
    for (let index = 0; index < 10; index++) {
      publishColdObservation(file, { index, complete: false });
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { index, complete: false });
      assert.equal(fs.existsSync(file + ".pending"), false);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


import { observeColdNativePreparation } from "./fixtures/departmentcoldrecoveryehhost";
test("cold native observer preserves successful move Promise and failed preparation without private fields", async () => {
  let resolve!: (id: string) => void; const gate = { promise: new Promise<string>(r => { resolve = r; }), resolve: (id: string) => resolve(id) }, observations: unknown[] = [], errors: unknown[] = [];
  const input = { workspaceDirectory: "/new-root", retired: { identity: { executionId: "original" }, selection: { cli: "opencode" }, directory: "/old-root" },
    launch: { token: "must-not-record", command: "private-command" } };
  const module = { createDepartmentOpenCodeSession(value: unknown, signal: unknown) {
    assert.equal(this, module); assert.equal(value, input); assert.equal(signal, "signal"); return gate.promise;
  } };
  const original = module.createDepartmentOpenCodeSession;
  const restore = observeColdNativePreparation(module, value => observations.push(value), error => errors.push(error));
  try {
    assert.equal(module.createDepartmentOpenCodeSession(input, "signal"), gate.promise);
    assert.equal(observations.length, 0); gate.resolve("ses_original"); await gate.promise;
    assert.deepEqual(observations, [{ retired: input.retired, directory: "/new-root", sessionId: "ses_original" }]);
    assert.doesNotMatch(JSON.stringify(observations), /must-not-record|private-command|token/);
  } finally { restore(); }
  assert.equal(module.createDepartmentOpenCodeSession, original);
  const failure = Promise.reject(new Error("actual-move-readback-failed"));
  const rejected = { createDepartmentOpenCodeSession: () => failure };
  const reset = observeColdNativePreparation(rejected, () => assert.fail("failed preparation is not evidence"), error => errors.push(error));
  assert.equal(rejected.createDepartmentOpenCodeSession(), failure); await assert.rejects(failure, /readback-failed/); reset();
  assert.deepEqual(errors, []);
});

import { observeColdWorkerLifetimes } from "./fixtures/departmentcoldrecoveryehhost";
test("cold worker lifecycle observer preserves fork send result and records only initialized identity and real exit", { timeout: 6000 }, async () => {
  const cp = require("node:child_process") as typeof import("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cold-worker-observe-"));
  const worker = path.join(root, "departmentgenerationauthorityworker.js");
  fs.writeFileSync(worker, "process.once('message', value => process.send(value, () => process.disconnect()));");
  const events: Record<string, unknown>[] = [], errors: unknown[] = [];
  const original = cp.fork, restore = observeColdWorkerLifetimes(cp, e => events.push(e), e => errors.push(e));
  try {
    const child = cp.fork(worker, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const closed = new Promise<void>((resolve, reject) => child.once("exit", (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error("natural exit required"))));
    const input = { scope: { rootTaskId: "root", workspace: "workspace", leaderTaskId: "leader", moduleId: "module", generation: 1 },
      producerId: "original-producer", producerProof: "must-not-record", token: "must-not-record" };
    const response = new Promise(resolve => child.once("message", resolve));
    child.send(input);
    assert.deepEqual(await response, input); await closed;
    assert.equal(events[0].event, "worker-initialized"); assert.equal(events[0].pid, child.pid);
    assert.deepEqual(events[0].identity, input.scope); assert.equal(events[0].producerId, input.producerId);
    assert.deepEqual(events[1].event, "worker-exit"); assert.equal(events[1].code, 0); assert.equal(events[1].signal, null);
    assert.doesNotMatch(JSON.stringify(events), /producerProof|token|must-not-record/);
    assert.deepEqual(errors, []);
  } finally { restore(); assert.equal(cp.fork, original); fs.rmSync(root, { recursive: true, force: true }); }
});

test("cold worker observer diagnostic failure cannot replace original IPC or prevent natural exit", { timeout: 6000 }, async () => {
  const cp = require("node:child_process") as typeof import("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cold-worker-failure-"));
  const worker = path.join(root, "departmentleadercodexownerworker.js");
  fs.writeFileSync(worker, "process.once('message', value => process.send({accepted: value.identity.rootTaskId}, () => process.disconnect()));");
  let diagnostics = 0;
  const restore = observeColdWorkerLifetimes(cp, () => { throw new Error("observer-write-failed"); }, () => { diagnostics++; throw new Error("diagnostic-failed"); });
  try {
    const child = cp.fork(worker, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const closed = new Promise<void>((resolve, reject) => child.once("exit", (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error("actual child failed"))));
    const response = new Promise(resolve => child.once("message", resolve));
    // JSON IPC accepts this, while the diagnostic clone cannot clone a function.
    child.send({ identity: { rootTaskId: "actual-root", session: { callback() {} } } });
    assert.deepEqual(await response, { accepted: "actual-root" }); await closed;
    assert.ok(diagnostics >= 1);
  } finally { restore(); fs.rmSync(root, { recursive: true, force: true }); }
});
