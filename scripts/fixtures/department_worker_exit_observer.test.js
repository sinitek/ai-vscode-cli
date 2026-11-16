"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { startColdWorkerExitObserver, requireColdWorkerExits } = require("./department_worker_exit_observer");
const delay = ms => new Promise(r => setTimeout(r, ms));

test("kernel observer captures actual grandchild exit status after original parent exits without signaling or IPC interception", { skip: process.platform !== "darwin", timeout: 8000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cold-exit-test-"));
  const observer = startColdWorkerExitObserver(root, Date.now() + 6500);
  const parent = cp.spawn(process.execPath, ["-e", `const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e',"setTimeout(()=>process.exit(7),1800)"],{detached:true,stdio:'ignore'});process.stdout.write(String(child.pid)+'\\n');child.unref();`], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise(resolve => parent.once("close", (code, signal) => resolve({ code, signal })));
  try {
    const pid = await new Promise(resolve => parent.stdout.once("data", b => resolve(Number(b.toString().trim()))));
    fs.appendFileSync(path.join(root, "cold-worker-registrations.ndjson"), JSON.stringify({ event: "worker-initialized", pid,
      worker: "departmentgenerationauthorityworker.js", identity: { rootTaskId: "root", leaderTaskId: "leader", generation: 1 }, producerId: "original" }) + "\n");
    assert.deepEqual(await closed, { code: 0, signal: null });
    const deadline = Date.now() + 4500;
    while (!observer.snapshot().events.some(e => e.event === "kernel-worker-exit") && Date.now() < deadline) await delay(15);
    const state = observer.snapshot(), exit = state.events.find(e => e.event === "kernel-worker-exit");
    assert.deepEqual(state.errors, []); assert.ok(exit);
    assert.equal(exit.pid, pid); assert.equal(exit.code, 7); assert.equal(exit.signal, null);
    assert.ok(state.events.some(e => e.event === "exit-watch-ready" && e.pid === pid));
  } finally { await observer.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("worker exit gate requires exact original producer and successor Owner actual zero exit with null signal", () => {
  const scope = { rootTaskId: "root", workspace: "workspace", leaderTaskId: "leader", moduleId: "module", generation: 1 };
  const original = { scope, producerId: "original" }, successor = { scope: { ...scope, generation: 3 }, producerId: "successor" };
  const binding = { identity: { ...successor.scope, cli: "codex", role: "leader", ownerId: "owner", executionId: "execution" } };
  const events = [{ event: "kernel-worker-exit", worker: "departmentgenerationauthorityworker.js", identity: scope, producerId: "original", pid: 1, code: 0, signal: null },
    { event: "kernel-worker-exit", worker: "departmentgenerationauthorityworker.js", identity: successor.scope, producerId: "successor", pid: 2, code: 0, signal: null },
    { event: "kernel-worker-exit", worker: "departmentleadercodexownerworker.js", identity: binding.identity, pid: 3, code: 0, signal: null }];
  assert.equal(requireColdWorkerExits({ events, errors: [] }, original, successor, binding).length, 3);
  for (const mutate of [e => e.pop(), e => { e[0].producerId = "foreign"; }, e => { e[2].identity.ownerId = "replacement"; },
    e => { e[0].code = null; }, e => { e[2].signal = 9; }, e => { e[0].event = "endpoint-missing"; }, e => { e.push(e[2]); }]) {
    const changed = structuredClone(events); mutate(changed);
    assert.throws(() => requireColdWorkerExits({ events: changed, errors: [] }, original, successor, binding), /exit unconfirmed/);
  }
  assert.throws(() => requireColdWorkerExits({ events, errors: ["observer-failed"] }, original, successor, binding), /observer failed/);
});
