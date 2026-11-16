import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { createDepartmentFullEhHostTestEntry, inspectDepartmentFullEhTaskStore, installDepartmentFullEhReceiptObserver } from "./fixtures/departmentfullehproductionhost";
import type { DepartmentExecutionIdentity, CleanupRequirements } from "../../runtime/departmentexecutionidentity";
import type { DepartmentExecutionReceipt } from "../../runtime/departmentexecutionreceiptstore";

test("public-entry EH fixture checks empty startup and emits an isolated host test entry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "department-full-eh-fixture-"));
  try {
    const home = path.join(root, "home");
    fs.mkdirSync(path.join(home, ".sinitek_cli"), { recursive: true });
    assert.deepEqual(inspectDepartmentFullEhTaskStore(home), { empty: true, files: [] });
    fs.mkdirSync(path.join(home, ".sinitek_cli", "department-tasks-v1"));
    fs.writeFileSync(path.join(home, ".sinitek_cli", "department-tasks-v1", "root.json"), "{}", { flag: "wx" });
    assert.deepEqual(inspectDepartmentFullEhTaskStore(home), { empty: false, files: ["root.json"] });
    const entry = createDepartmentFullEhHostTestEntry({ root, timeoutMs: 90000 });
    assert.match(entry, /sinitek-cli-tools\.openPanel/);
    assert.match(entry, /departmentEnabled/);
    assert.match(entry, /departmentEnabledAtStartup/);
    assert.match(entry, /must start disabled/);
    assert.match(entry, /original Owner protocol observer reported a diagnostic/);
    assert.doesNotMatch(entry, /departmentEnabled: true/);
    assert.match(entry, /department task store was not empty/);
    assert.match(entry, /120000/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("EH receipt observer preserves the original Promise, rejection and caller policy", async () => {
  // Transport evidence comes from EH; this unit test checks that its passive
  // recorder cannot replace the production method's fulfillment or rejection.
  const identity = { executionId: "observer-unit-test" } as DepartmentExecutionIdentity;
  const policy = { streams: true } as CleanupRequirements;
  const receipt = { identity } as DepartmentExecutionReceipt;
  const fulfilled = Promise.resolve(receipt), rejected = Promise.reject(new Error("still unknown"));
  const observations: unknown[] = [], errors: unknown[] = [];
  const signal = new AbortController().signal;
  let pending = fulfilled;
  class Client {
    waitForCleanup(i: DepartmentExecutionIdentity, p: CleanupRequirements, s?: AbortSignal) {
      assert.equal(i, identity); assert.equal(p, policy); assert.equal(s, signal); return pending;
    }
  }
  const original = Client.prototype.waitForCleanup;
  const restore = installDepartmentFullEhReceiptObserver(Client, (value) => observations.push(value), (error) => errors.push(error));
  try {
    assert.equal(new Client().waitForCleanup(identity, policy, signal), fulfilled);
    await fulfilled;
    assert.deepEqual(observations, [{ source: "original-client-waitForCleanup-return", identity, requirements: policy, receipt }]);
    pending = rejected;
    assert.equal(new Client().waitForCleanup(identity, policy, signal), rejected);
    await assert.rejects(rejected, /still unknown/);
    assert.equal(observations.length, 1); assert.deepEqual(errors, []);
  } finally { restore(); }
  assert.equal(Client.prototype.waitForCleanup, original);
});

test("passive EH IPC observer preserves actual child messages/send callbacks and excludes private payloads", { timeout: 5000 }, async (t) => {
  const cp: typeof import("node:child_process") = require("node:child_process");
  const { installDepartmentFullEhProtocolObserver } = await import("./fixtures/departmentfullehproductionhost");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "department-eh-protocol-observer-"));
  const worker = path.join(root, "departmentprocessownerworker.js");
  fs.writeFileSync(worker, `process.on('message', value => { process.send({ type: 'granted', identity: value.identity, token: 'must-not-record', prompt: 'private-payload', session: { threadId: 'thread-safe-id', connectionId: 7, token: 'session-token-must-not-record' } }, () => process.disconnect()); });`);
  const events: Record<string, unknown>[] = [], original = cp.fork;
  const restore = installDepartmentFullEhProtocolObserver(cp, event => events.push(event));
  try {
    const child = cp.fork(worker, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
    const response = new Promise<unknown>(resolve => child.once("message", resolve));
    const closed = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => code === 0 && !signal ? resolve() : reject(new Error("child did not close naturally")));
    });
    const identity = { ownerId: "observer-only-unit-owner" };
    await new Promise<void>((resolve, reject) => child.send({ operation: "grant", identity, token: "must-not-record", selection: { cli: "opencode", model: "isolated/native-drain" },
      launch: { args: ["run", "--model", "isolated/native-drain", "--session", "ses_example", "private-payload"],
        envOverrides: { SECRET: "must-not-record" }, overlay: { primaryModel: "isolated/native-drain", configContent: "must-not-record" } } }, error => error ? reject(error) : resolve()));
    assert.deepEqual(await response, { type: "granted", identity, token: "must-not-record", prompt: "private-payload",
      session: { threadId: "thread-safe-id", connectionId: 7, token: "session-token-must-not-record" } });
    await closed;
    assert.deepEqual(events.map(event => event.event), ["owner-fork", "sent", "received", "owner-close"]);
    assert.deepEqual(events[1].selection, { cli: "opencode", model: "isolated/native-drain" });
    assert.deepEqual(events[1].launchEvidence, { cwd: undefined, sessionId: undefined, modelArgs: ["isolated/native-drain"], sessionArgs: ["ses_example"], overlayModel: "isolated/native-drain" });
    assert.equal(events[1].operation, "grant"); assert.equal(events[2].type, "granted");
    assert.deepEqual(events[2].session, { threadId: "thread-safe-id", connectionId: 7 });
    assert.doesNotMatch(JSON.stringify(events), /must-not-record|private-payload|session-token-must-not-record|"token"|"prompt"/);
  } finally { restore(); fs.rmSync(root, { recursive: true, force: true }); }
  assert.equal(cp.fork, original);
});

test("passive IPC observer skips early callback ACK readback and observes only durable grant boundaries", { timeout: 5000 }, async (t) => {
  const cp: typeof import("node:child_process") = require("node:child_process");
  const { installDepartmentFullEhProtocolObserver } = await import("./fixtures/departmentfullehproductionhost");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "department-eh-grant-observer-"));
  const worker = path.join(root, "departmentleadercodexownerworker.js");
  fs.writeFileSync(worker, `let count = 0; process.on('message', value => {
    process.send({ accepted: ++count, operation: value.operation }, () => { if (count === 5) process.disconnect(); });
    if (count === 1) process.send({ type: 'grant-request', requestSequence: 2 });
  });`);
  const identity = { ownerId: "observer-grant-owner", executionId: "observer-grant-execution" };
  const binding = { identity, selection: { cli: "codex", role: "leader", configId: "codex-local" }, requirements: { streams: true } };
  const events: Record<string, unknown>[] = [], failures: { stage: string }[] = [];
  let persistedBindings: { identity: typeof identity }[] | undefined;
  const original = cp.fork;
  const restore = installDepartmentFullEhProtocolObserver(cp, event => events.push(event), diagnostic => failures.push(diagnostic), message => {
    const value = message as { identity: typeof identity };
    return { runtimeOk: true, bindings: (persistedBindings ?? []).filter(entry => entry.identity.executionId === value.identity.executionId) };
  });
  const child = cp.fork(worker, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => { restore(); if (child.exitCode === null && child.signalCode === null) child.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  const grantRequested = new Promise<void>(resolve => child.on("message", value => {
    if ((value as Record<string, unknown>).type === "grant-request") resolve();
  }));
  const replies: Record<string, unknown>[] = [];
  const replyWaiters: { count: number; resolve: (value: Record<string, unknown>) => void }[] = [];
  child.on("message", value => {
    const reply = value as Record<string, unknown>;
    if (reply.accepted === undefined) return;
    replies.push(reply);
    for (const waiter of [...replyWaiters]) if (replies.length >= waiter.count) {
      replyWaiters.splice(replyWaiters.indexOf(waiter), 1);
      waiter.resolve(reply);
    }
  });
  const waitForReply = (count: number): Promise<Record<string, unknown>> => replies.length >= count
    ? Promise.resolve(replies[count - 1]) : new Promise(resolve => replyWaiters.push({ count, resolve }));
  const send = (value: Record<string, unknown>): Promise<void> => new Promise((resolve, reject) => {
    child.send(value, error => error ? reject(error) : resolve());
  });
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 && !signal ? resolve() : reject(new Error("observer worker did not close naturally")));
  });
  try {
    const firstReply = waitForReply(1);
    await send({ operation: "ack", callbackSequence: 1, ok: true, identity, result: null });
    assert.deepEqual(await firstReply, { accepted: 1, operation: "ack" });
    await grantRequested;
    assert.equal((events.find(event => event.event === "sent" && event.callbackSequence === 1) as any)?.preGrantReadback, undefined);

    const secondReply = waitForReply(2);
    await send({ operation: "grant", identity });
    assert.deepEqual(await secondReply, { accepted: 2, operation: "grant" });
    assert.deepEqual((events.find(event => event.event === "sent" && event.operation === "grant") as any)?.preGrantReadback,
      { runtimeOk: true, bindings: [] }, "observer must not invent a binding that is not persisted");

    persistedBindings = [structuredClone(binding)];
    const thirdReply = waitForReply(3);
    await send({ operation: "ack", requestSequence: 2, ok: true, identity, result: null });
    assert.deepEqual(await thirdReply, { accepted: 3, operation: "ack" });
    const fourthReply = waitForReply(4);
    await send({ operation: "ack", requestSequence: 3, ok: true, identity, result: null });
    assert.deepEqual(await fourthReply, { accepted: 4, operation: "ack" });
    assert.equal(events.find(event => event.event === "sent" && event.requestSequence === 3)?.preGrantReadback, undefined,
      "ordinary request ACK without an original grant-request is not an authorization");
    const fifthReply = waitForReply(5);
    await send({ operation: "launch", identity });
    assert.deepEqual(await fifthReply, { accepted: 5, operation: "launch" });
    await closed;
    assert.equal(replies.length, 5);
    const grants = events.filter(event => event.event === "sent" && (event.requestSequence === 2 || event.operation === "launch"));
    assert.equal(grants.length, 2);
    for (const grant of grants) assert.deepEqual(grant.preGrantReadback, { runtimeOk: true, bindings: [binding] });
    assert.deepEqual(failures, []);
  } finally {
    if (child.connected) child.disconnect();
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(cp.fork, original);
});

test("observer recorder failure is diagnostic and cannot suppress or duplicate the original send", { timeout: 5000 }, async (t) => {
  const cp: typeof import("node:child_process") = require("node:child_process");
  const { installDepartmentFullEhProtocolObserver } = await import("./fixtures/departmentfullehproductionhost");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "department-eh-observer-failure-"));
  const worker = path.join(root, "departmentprocessownerworker.js");
  fs.writeFileSync(worker, `process.on('message', value => { process.send({ accepted: value.sequence }, () => process.disconnect()); });`);
  const failures: { stage: string }[] = [], original = cp.fork;
  const restore = installDepartmentFullEhProtocolObserver(cp, event => {
    if (event.event === "sent") throw new Error("private callback result must not leak");
  }, diagnostic => {
    failures.push(diagnostic);
    fs.appendFileSync(path.join(root, "original-owner-observation-errors.ndjson"), JSON.stringify(diagnostic) + "\n", { mode: 0o600 });
  });
  const child = cp.fork(worker, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => { restore(); if (child.exitCode === null && child.signalCode === null) child.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  const received = new Promise<unknown>((resolve, reject) => {
    child.once("error", reject);
    child.once("message", resolve);
  });
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 && !signal ? resolve() : reject(new Error("observer worker did not close naturally")));
  });
  let callbacks = 0;
  try {
    const result = child.send({ operation: "ack", callbackSequence: 1, ok: true, sequence: 7 }, error => {
      callbacks++;
      if (error) throw error;
    });
    assert.equal(typeof result, "boolean");
    assert.deepEqual(await received, { accepted: 7 });
    await closed;
    assert.equal(callbacks, 1);
    assert.deepEqual(failures, [{ stage: "protocol-observation-record-failed" }]);
    assert.deepEqual(fs.readFileSync(path.join(root, "original-owner-observation-errors.ndjson"), "utf8").trim().split("\n").map(line => JSON.parse(line)), failures);
    assert.doesNotMatch(JSON.stringify(failures), /private callback result/);
  } finally {
    if (child.connected) child.disconnect();
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(cp.fork, original);
});

test("passive observer isolates readback and received-field failures while preserving fork/send receiver and arguments", async () => {
  const { installDepartmentFullEhProtocolObserver } = await import("./fixtures/departmentfullehproductionhost");
  const child = new EventEmitter() as import("node:child_process").ChildProcess;
  const sends: unknown[][] = [], diagnostics: { stage: string }[] = [];
  child.send = function (this: typeof child, ...values: unknown[]) {
    assert.equal(this, child);
    sends.push(values);
    (values[values.length - 1] as (error: Error | null) => void)(null);
    return false;
  } as typeof child.send;
  const fake = { fork(this: unknown, ...values: unknown[]) {
    assert.equal(this, fake);
    assert.deepEqual(values, ["departmentleaderprocessownerworker.js", ["--owned"], { silent: true }]);
    return child;
  } } as unknown as typeof import("node:child_process");
  const events: Record<string, unknown>[] = [];
  const restore = installDepartmentFullEhProtocolObserver(fake, event => events.push(event), value => diagnostics.push(value), () => {
    throw new Error("private readback failure");
  });
  try {
    assert.equal(fake.fork("departmentleaderprocessownerworker.js", ["--owned"], { silent: true }), child);
    let consumed = 0;
    child.on("message", () => consumed++);
    child.emit("message", { type: "callback", identity: () => undefined }); // structuredClone fails only in the observer.
    assert.equal(consumed, 1);
    const message = { operation: "launch", identity: { executionId: "original" } };
    const handle = undefined, options = { keepOpen: false };
    let callbacks = 0;
    const callback = (error: Error | null) => { assert.equal(error, null); callbacks++; };
    assert.equal(child.send(message, handle, options, callback), false);
    assert.equal(sends.length, 1);
    for (const [index, value] of [message, handle, options, callback].entries()) assert.equal(sends[0][index], value);
    assert.equal(callbacks, 1);
    assert.deepEqual(events.find(event => event.event === "sent")?.preGrantReadback, { runtimeOk: false });
    assert.deepEqual(diagnostics, [{ stage: "protocol-observation-failed" }, { stage: "protocol-pregrant-readback-failed" }]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private readback/);
  } finally { restore(); }
});
