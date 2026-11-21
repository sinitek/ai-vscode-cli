import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import vm = require("node:vm");
import { observeAllocationMethod, createDepartmentEmployeeAllocationEhHostEntry } from "./fixtures/departmentemployeeallocationehhost";
import { DepartmentRuntimeStore } from "../../extensionHost/departmentruntimestore";
import { createDepartmentEmployeeAllocationHost } from "../../extensionHost/departmentemployeeallocationhost";
import { createDepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import { DepartmentCapacityPool } from "../../departmentcapacity";
import { buildLoopPlusMainModelPrompt } from "../../extensionHost/loopPlusPromptBuilders";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { departmentRecords } from "../loop/departmentGroupChatHost.fixture";

test("allocation passive observer preserves sync denial, Promise identity and thrown errors even when recording fails", async () => {
  const promise = Promise.resolve(false), failure = Error("original failure"), diagnostics: unknown[] = [];
  let result: unknown = false, calls = 0;
  const target = { method(this: unknown, ...args: unknown[]) { assert.equal(this, target); assert.deepEqual(args, ["request"]); calls++; if (result === failure) throw failure; return result; } };
  const original = target.method;
  const restore = observeAllocationMethod(target, "method", () => { throw Error("recorder failed"); }, error => diagnostics.push(error));
  try {
    assert.equal(target.method("request"), false);
    result = promise; assert.equal(target.method("request"), promise); await promise;
    result = failure; assert.throws(() => target.method("request"), error => error === failure);
    assert.equal(calls, 3); assert.equal(diagnostics.length, 2);
  } finally { restore(); }
  assert.equal(target.method, original);
});

test("allocation generated EH entry is valid JavaScript and reuses public-entry and original Owner observations", () => {
  const entry = createDepartmentEmployeeAllocationEhHostEntry({ root: "/isolated/allocation", timeoutMs: 90000 });
  new vm.Script(entry);
  assert.match(entry, /allocationBaseRun/); assert.match(entry, /onDidReceiveMessage/); assert.match(entry, /webview-settled/);
  assert.match(entry, /original-owner-observations/); assert.match(entry, /department task store was not empty/);
  assert.doesNotMatch(entry, /saveEmployeeLimit\(/);
});

for (const limits of [{ maxLeaders: 4, maxEmployees: 20 }, { maxLeaders: 2, maxEmployees: 6 }]) test(`${limits.maxLeaders}/${limits.maxEmployees} real allocation store and production reader nested snapshot feed reviewed prompt across save, refusal and restore`, async t => {
  const data = departmentRecords(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "allocation-prompt-composition-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const defaultLimit = Math.ceil(limits.maxEmployees / limits.maxLeaders);
  for (const task of data.records.values()) task.department!.limits = limits;
  const store = new DepartmentRuntimeStore(dir), capacity = new DepartmentCapacityPool(limits);
  const runtime = createDepartmentRuntimeSnapshot(data.root.id);
  runtime.leaders.push({ taskId: data.leader.id, leaderSubtaskId: "module-A", status: "running", generation: 1 });
  const lease = await capacity.acquireLeader(data.root.id, "module-A"); assert.ok(lease); t.after(() => lease.release());
  assert.equal(store.write({ version: 1, rootTaskId: data.root.id, workspaceKey: data.root.workspaceKey, runtime,
    capacity: capacity.snapshot(data.root.id)[0] }).ok, true);
  assert.equal(store.synchronizeEmployeeAllocation(data.root.id, data.root.workspaceKey).ok, true);
  const host = createDepartmentEmployeeAllocationHost({ store, capacity, workspaceKey: () => data.root.workspaceKey,
    readTask: id => data.records.get(id) ?? null, runtimeSnapshot: () => runtime, current: () => true });
  const prompt = () => {
    const snapshot = host.readEmployeeCapacity(data.root.id, data.leader.id); assert.ok(snapshot?.leaderAllocation);
    const value = buildLoopPlusMainModelPrompt({ taskId: data.leader.id, rootPrompt: "composition", taskStoreFile: "/fixture/tasks.json",
      mainCommunicationFile: "/fixture/main.md", kind: "initial", view: createLoopPlusScheduler({ maxConcurrency: 4 }).wait().view,
      currentEventId: null, supplementalRequirements: [], maxConcurrency: 4,
      departmentEmployeeCapacity: { rootTaskId: data.root.id, leaderTaskId: data.leader.id, maxEmployees: limits.maxEmployees, snapshot } });
    assert.ok(value.includes(`Regular employee total: ${limits.maxEmployees}`)); assert.doesNotMatch(value, /allocation: unknown/);
    return { snapshot, value };
  };
  assert.match(prompt().value, /Applied group limit: not yet applied/);
  host.applyEmployeeAllocation(data.root.id, data.leader.id);
  const employee = await capacity.trackEmployee(data.root.id, data.leader.id, "live"); assert.ok(employee);
  t.after(() => employee.release());
  const current = prompt(); assert.equal(current.snapshot.leaderAllocation!.desiredLimit, defaultLimit);
  const saved = host.updateDepartmentEmployeeLimit(data.root, { requestId: "zero", leaderTaskId: data.leader.id, employeeLimit: 0, expectedRevision: current.snapshot.leaderAllocation!.revision }); assert.ok(saved.ok);
  const pending = prompt(); assert.match(pending.value, /Desired regular employee limit for this group: 0/);
  assert.ok(pending.value.includes(`Applied group limit: ${defaultLimit}`)); assert.match(pending.value, /pending: yes/);
  host.applyEmployeeAllocation(data.root.id, data.leader.id);
  const additional = await capacity.trackEmployee(data.root.id, data.leader.id, "additional"); assert.ok(additional);
  t.after(() => additional.release());
  const applied = prompt(); assert.match(applied.value, /Applied group limit: 0/); assert.match(applied.value, /pending: no/);
  assert.equal(applied.snapshot.activeEmployees, 2); assert.equal(applied.snapshot.availableEmployees, limits.maxEmployees - 2);
  assert.match(applied.value, /Department capacity figures are advisory/);
  assert.ok(host.updateDepartmentEmployeeLimit(data.root, { requestId: "default", leaderTaskId: data.leader.id, employeeLimit: null,
    expectedRevision: applied.snapshot.leaderAllocation!.revision }).ok);
  assert.match(prompt().value, /pending: yes/); host.applyEmployeeAllocation(data.root.id, data.leader.id);
  const restored = prompt(); assert.ok(restored.value.includes(`Applied group limit: ${defaultLimit}`)); assert.match(restored.value, /pending: no/);
  assert.equal(restored.snapshot.activeEmployees, 2, "reference updates retain existing live leases");
});

test("allocation EH wrapper observes the actual product panel instance without replacing message handlers", async () => {
  const callbacks: ((message: unknown) => void)[] = [], recorded: { event: string; message?: unknown }[] = [];
  let disposed = 0, forwarded = 0;
  class Panel {
    panel = { webview: { onDidReceiveMessage(callback: (message: unknown) => void) { callbacks.push(callback); return { dispose() { disposed++; } }; } } };
    show() { /* The original product show installs its real webview. */ }
    post(message: unknown) { forwarded++; return message; }
  }
  class Provider {
    resolveWebviewView(_view: unknown) { forwarded++; }
    postMessage(message: unknown) { forwarded++; return message; }
    postState(state: unknown) { forwarded++; return state; }
  }
  const allocationModule = { createDepartmentEmployeeAllocationHost: () => ({ readEmployeeCapacity: () => ({ leaderAllocation: { desiredLimit: 3 } }) }) };
  const request = { type: "loopGroupChatChat:updateDepartmentEmployeeLimit", requestId: "real-request" };
  const settled = { type: "loopGroupChatChat:departmentEmployeeLimitSettled", requestId: "real-request" };
  const run = async () => {
    const panel = new Panel(); panel.show(); panel.show(); assert.equal(callbacks.length, 1);
    callbacks[0](request); assert.equal(panel.post(settled), settled);
    const provider = new Provider();
    const webview = { onDidReceiveMessage(callback: (message: unknown) => void) { callbacks.push(callback); return { dispose() { disposed++; } }; } };
    provider.resolveWebviewView({ webview }); provider.resolveWebviewView({ webview });
    callbacks[1]({ type: "updateSetting", key: "workspaceDepartmentMaxEmployees" });
    const reply = { type: "workspaceDepartmentCapacitySaved", ok: true };
    assert.equal(provider.postMessage(reply), reply);
    const state = { workspaceDepartmentMaxEmployees: 6 }; assert.equal(provider.postState(state), state);
    const host = allocationModule.createDepartmentEmployeeAllocationHost();
    assert.equal(host.readEmployeeCapacity().leaderAllocation.desiredLimit, 3);
  };
  const module = { run };
  const entry = createDepartmentEmployeeAllocationEhHostEntry({ root: "/isolated", timeoutMs: 1 });
  new vm.Script(entry.slice(entry.indexOf("const allocationBaseRun"))).runInNewContext({
    exports: module, fs: { appendFileSync(_file: string, line: string) { recorded.push(JSON.parse(line)); }, existsSync: () => false }, path,
    vscode: { extensions: { getExtension: () => ({ extensionPath: "/fixture" }) } },
    require: (file: string) => file === "node:child_process" ? { fork() { throw Error("no worker expected"); } } : file.endsWith("departmentemployeeallocationhost.js") ? allocationModule : file.endsWith("viewProvider.js") ? { CliBridgeViewProvider: Provider } : { LoopGroupChatPanel: Panel },
    process: { env: { HOME: "/isolated/home" } }, Date, WeakSet, Reflect,
  });
  await module.run();
  assert.deepEqual(recorded.map(r => r.event), ["webview-request", "webview-settled", "settings-request", "settings-saved", "settings-state", "capacity-reader"]);
  assert.deepEqual(recorded.slice(0, 2).map(r => r.message), [request, settled]); assert.equal(disposed, 2); assert.equal(forwarded, 5);
});

test("allocation worker exit observer retains actual unrefed child evidence without ref, kill or protocol changes", async () => {
  const cp: typeof import("node:child_process") = require("node:child_process");
  const { observeAllocationWorkerExits } = await import("./fixtures/departmentemployeeallocationehhost");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allocation-worker-exit-"));
  const file = path.join(dir, "departmentcodexownerworker.js"); fs.writeFileSync(file, "setImmediate(() => process.disconnect());");
  const recorded: Record<string, unknown>[] = [], diagnostics: unknown[] = [];
  const restore = observeAllocationWorkerExits(cp, event => recorded.push(event), error => diagnostics.push(error));
  try {
    const child = cp.fork(file, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] }); child.unref();
    const end = Date.now() + 5000;
    while (Date.now() < end && !recorded.some(e => e.event === "worker-close")) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(recorded.map(e => e.event), ["worker-observed", "worker-exit", "worker-close"]);
    for (const event of recorded.filter(e => e.event !== "worker-observed")) {
      assert.equal(event.pid, child.pid); assert.equal(event.code, 0); assert.equal(event.signal, null);
    }
    assert.deepEqual(diagnostics, []);
  } finally { restore(); fs.rmSync(dir, { recursive: true, force: true }); }
});
