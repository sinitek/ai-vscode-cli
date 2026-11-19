import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TestContext } from "node:test";
import type { ChildProcess } from "child_process";
import { getEventListeners } from "events";
import type { CodexInteractiveRunner, CodexStreamHandlers } from "../../interactive/codexRunner";
import type { CodexAppServerConnection } from "../../interactive/codexAppServerPool";

installVscodeMock();
test.beforeEach((t) => {
  assert.ok("mock" in t);
  t.mock.method(require("../../interactive/codexAppServerCapabilitiesCore"), "resolveCodexThreadUnloadCapability",
    async () => ({ supported: true, reason: "supported" }));
});

test("execution evidence retains exact late native terminal after final-answer fallback", { timeout: 10000 }, async (t) => {
  const crossSpawn = require("cross-spawn") as { spawn: (...args: unknown[]) => unknown };
  const originalSpawn = crossSpawn.spawn;
  const serverSource = `const readline=require("readline");
const send=m=>process.stdout.write(JSON.stringify(m)+"\\n");
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on("line",line=>{
  const m=JSON.parse(line); if(m.method==="initialize"){send({jsonrpc:"2.0",id:m.id,result:{}});return;}
  if(m.method==="thread/start"){send({jsonrpc:"2.0",id:m.id,result:{thread:{id:"evidence-thread"}}});return;}
  if(m.method==="turn/start"){
    send({jsonrpc:"2.0",method:"turn/started",params:{threadId:"evidence-thread",turn:{id:"evidence-turn"}}});
    send({jsonrpc:"2.0",id:m.id,result:{turn:{id:"evidence-turn",status:"inProgress"}}});
    send({jsonrpc:"2.0",method:"item/completed",params:{threadId:"evidence-thread",turnId:"evidence-turn",item:{id:"answer",type:"agent_message",phase:"final_answer",text:"answer"}}});
    setTimeout(()=>send({jsonrpc:"2.0",method:"turn/completed",params:{threadId:"evidence-thread",turn:{id:"wrong-turn",status:"completed"}}}),1050);
    setTimeout(()=>send({jsonrpc:"2.0",method:"turn/completed",params:{threadId:"evidence-thread",turn:{id:"evidence-turn",status:"completed"}}}),1150);
    return;
  }
  if(m.method==="turn/interrupt"){send({jsonrpc:"2.0",id:m.id,result:{}});return;}
  if(m.method==="thread/unsubscribe"){send({jsonrpc:"2.0",id:m.id,result:{status:"notLoaded"}});}
});`;
  crossSpawn.spawn = (...args: unknown[]) => originalSpawn(process.execPath, ["-e", serverSource], ...args.slice(2));
  try {
    const { CodexInteractiveRunner } = require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
    const runner = new CodexInteractiveRunner({ command: process.execPath, args: [], thinkingMode: "medium",
      interactiveMode: "coding", threadId: null });
    const visible: string[] = [];
    const observation = runner.createExecutionObservation();
    try {
      await runner.runStreamed("fixed fixture", {
        onAssistantDelta: (chunk) => visible.push(chunk), onTrace: () => undefined,
        onTaskListUpdate: () => undefined, onThreadId: () => undefined,
      }, observation);
      assert.deepEqual(visible, ["answer"]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      let cleanupSettled = false;
      const cleanupPromise = observation.cleanup().then((result) => { cleanupSettled = true; return result; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(cleanupSettled, false, "wrong turn cannot settle this execution observation");
      assert.deepEqual(await observation.turnTerminal,
      { status: "confirmed", evidence: "native-turn-completed:completed" });
      const cleanup = await cleanupPromise;
      assert.equal(cleanup.business.status, "confirmed");
      assert.deepEqual(cleanup.turnTerminal, { status: "confirmed", evidence: "native-turn-completed:completed" });
      assert.equal(cleanup.executionDrain.status, "unobservable");
      assert.equal(cleanup.runner.status, "confirmed");
      assert.equal(cleanup.streams.status, "unobservable");
      assert.deepEqual(visible, ["answer"], "late native terminal is evidence only and emits no visible output");
      await assert.rejects(runner.runStreamed("after cleanup", {
        onAssistantDelta: () => undefined, onTrace: () => undefined,
        onTaskListUpdate: () => undefined, onThreadId: () => undefined,
      }), /sealed for execution cleanup/u);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("execution observation rejects a token invalidated by abort generation", async () => {
  const { CodexInteractiveRunner } = require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
  const runner = new CodexInteractiveRunner({ command: process.execPath, args: [], thinkingMode: "medium",
    interactiveMode: "coding", threadId: null });
  const observation = runner.createExecutionObservation();
  try {
    runner.stopAndRebuild();
    await assert.rejects(runner.runStreamed("stale token", {
      onAssistantDelta: () => undefined, onTrace: () => undefined,
      onTaskListUpdate: () => undefined, onThreadId: () => undefined,
    }, observation), /Invalid or already-used/u);
    const result = await observation.cleanup();
    assert.equal(result.business.status, "unobservable");
    assert.equal(result.turnTerminal.status, "unobservable");
  } finally {
    runner.dispose();
  }
});

// Every transition is released through the real connection's ordered RPC wire.
// No model, wall-clock completion heuristic or user session is involved.
const GATED_OBSERVATION_SERVER = `
const starts=new Map();const previousStarts=new Map();let serial=0;let unloadUnsupported=false;
const send=m=>process.stdout.write(JSON.stringify(m)+"\\n");
require("readline").createInterface({input:process.stdin}).on("line",line=>{
 const m=JSON.parse(line);if(!m.method)return;
 if(m.method==="initialize")send({id:m.id,result:{}});
 else if(m.method==="thread/start"||m.method==="thread/resume")send({id:m.id,result:{thread:{id:m.params.threadId||"primary"}}});
 else if(m.method==="turn/start"){
   previousStarts.set(m.params.threadId,starts.get(m.params.threadId));starts.set(m.params.threadId,m.id);serial++;
   process.stderr.write(JSON.stringify({fixture:"start",threadId:m.params.threadId,serial})+"\\n");
 } else if(m.method==="fixture/control"){
   const p=m.params;
   if(p.unloadUnsupported)unloadUnsupported=true;
   if(p.replayPrevious)send({id:previousStarts.get(p.threadId||"primary"),result:{turn:{id:p.replayPrevious}}});
   for(const n of p.before||[])send(n);
   if(p.respond){const id=starts.get(p.threadId||"primary");send(p.reject?{id,error:{code:-1,message:"fixture rejection"}}:{id,result:{turn:{id:p.respond,status:"inProgress"}}});}
   for(const n of p.after||[])send(n);
   if(p.breakJson){process.stdout.write("not-json\\n");return;}
   if(p.close){process.stdout.end();process.stderr.end();process.stdin.destroy();return;}
   send({id:m.id,result:{serial,pid:process.pid}});
 } else if(m.method==="thread/unsubscribe")send(unloadUnsupported?{id:m.id,error:{code:-32601,message:"fixture unsupported"}}:{id:m.id,result:{status:"notLoaded"}});
 else if(m.id!==undefined)send({id:m.id,result:{}});
});`;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function notification(method: string, turnId: string, threadId = "primary", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { method, params: { threadId, turnId, turn: { id: turnId, status: "completed" }, ...extra } };
}

function gatedObservationFixture(t: TestContext): {
  runner: CodexInteractiveRunner;
  peer: () => CodexInteractiveRunner;
  start: (count?: number) => Promise<void>;
  control: (params: Record<string, unknown>, runner?: CodexInteractiveRunner) => Promise<{ serial: number; pid: number }>;
  handlers: CodexStreamHandlers;
  visible: string[];
  dispose: () => Promise<void>;
} {
  const crossSpawn = require("cross-spawn") as { spawn: (...args: unknown[]) => ChildProcess };
  const original = crossSpawn.spawn;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-observation-race-"));
  const children: ChildProcess[] = [];
  const startWaiters = new Map<number, ReturnType<typeof deferred<void>>>();
  let starts = 0;
  t.mock.method(crossSpawn, "spawn", (...args: unknown[]) => {
    const child = original(process.execPath, ["-e", GATED_OBSERVATION_SERVER], ...args.slice(2));
    children.push(child);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
      const lines = stderr.split("\n"); stderr = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        const event = JSON.parse(line) as { fixture?: string };
        if (event.fixture === "start") {
          starts++;
          for (const [count, waiter] of startWaiters) if (starts >= count) { waiter.resolve(); startWaiters.delete(count); }
        }
      }
    });
    return child;
  });
  const { CodexInteractiveRunner } = require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
  const options = { command: process.execPath, args: [], cwd: root, thinkingMode: "medium" as const,
    interactiveMode: "coding" as const, threadId: "primary", env: { PATH: process.env.PATH,
      HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, ".codex") } };
  const runner = new CodexInteractiveRunner(options);
  const runners = [runner];
  const visible: string[] = [];
  return {
    runner, visible,
    handlers: { onAssistantDelta: (chunk) => { visible.push(chunk); }, onTrace: () => {},
      onTaskListUpdate: () => {}, onThreadId: () => {} },
    peer: () => { const peer = new CodexInteractiveRunner({ ...options, threadId: "peer" }); runners.push(peer); return peer; },
    start: (count = 1) => {
      if (starts >= count) return Promise.resolve();
      const waiter = startWaiters.get(count) ?? deferred<void>(); startWaiters.set(count, waiter); return waiter.promise;
    },
    control: (params, target = runner) => {
      const connection = (target as unknown as { connection: CodexAppServerConnection }).connection;
      return connection.request("fixed-fixture-control", "fixture/control", params);
    },
    dispose: async () => {
      const closed = children.map((child) => child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve() : new Promise<void>((resolve) => child.once("close", () => resolve())));
      for (const current of runners) current.dispose();
      await Promise.all(closed);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("handle reconciles terminal before a late start response after business settlement", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  let completedCallbacks = 0;
  try {
    const run = f.runner.runStreamed("fixture", { ...f.handlers, onTurnCompleted: () => { completedCallbacks++; } }, observation);
    await f.start();
    await f.control({ before: [notification("turn/completed", "real")] });
    await run;
    let terminalSettled = false;
    void observation.turnTerminal.then(() => { terminalSettled = true; });
    await f.control({});
    assert.equal(terminalSettled, false, "native identity is still unbound");
    await f.control({ respond: "real" });
    assert.deepEqual(await observation.turnTerminal, { status: "confirmed", evidence: "native-turn-completed:completed" });
    assert.equal(completedCallbacks, 1, "late response does not re-enter visible callbacks");
    const cleanup = observation.cleanup();
    assert.equal(observation.cleanup(), cleanup);
    assert.equal((await cleanup).executionDrain.status, "unobservable");
  } finally { await f.dispose(); }
});

test("handle retains start response after final-answer fallback and ignores ordinary turn IDs", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixture", f.handlers, observation);
    await f.start();
    await f.control({ before: [notification("item/completed", "real", "primary", {
      item: { id: "answer", type: "agent_message", phase: "final_answer", text: "fixed answer" },
    })] });
    await run;
    await f.control({ respond: "real", after: [notification("item/agentMessage/delta", "wrong", "primary", { delta: "late wrong" }),
      notification("turn/completed", "wrong"), notification("turn/completed", "real", "child"),
      notification("turn/completed", "real")] });
    assert.equal((await observation.turnTerminal).status, "confirmed");
    assert.deepEqual(f.visible, ["fixed answer"]);
    assert.equal((await observation.cleanup()).runner.status, "confirmed");
  } finally { await f.dispose(); }
});

test("conflicting native start identity stays unobservable while streamed business compatibility remains", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixture", f.handlers, observation);
    await f.start();
    await f.control({ before: [notification("turn/started", "streamed"),
      notification("item/agentMessage/delta", "streamed", "primary", { delta: "answer" })], respond: "response",
      after: [notification("turn/completed", "streamed")] });
    await run;
    assert.equal((await observation.turnTerminal).status, "unobservable");
    await assert.rejects(f.runner.runStreamed("blocked", f.handlers), /reuse blocked/u);
    assert.deepEqual(f.visible, ["answer"]);
  } finally { await f.dispose(); }
});

test("a repeated old response and old terminal cannot bind the retry execution", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const first = f.runner.createExecutionObservation();
  try {
    const firstRun = f.runner.runStreamed("first", f.handlers, first);
    await f.start();
    await f.control({ respond: "first", after: [notification("turn/completed", "first")] });
    await firstRun;
    assert.equal((await first.turnTerminal).status, "confirmed");
    const second = f.runner.createExecutionObservation();
    const secondRun = f.runner.runStreamed("retry", f.handlers, second);
    await f.start(2);
    let settled = false;
    void second.turnTerminal.then(() => { settled = true; });
    await f.control({ replayPrevious: "first", before: [notification("turn/started", "first"), notification("turn/completed", "first")] });
    assert.equal(settled, false);
    await f.control({ respond: "second", after: [notification("turn/completed", "second")] });
    await secondRun;
    assert.equal((await second.turnTerminal).status, "confirmed");
  } finally { await f.dispose(); }
});

test("terminal reconciliation overflow remains blocked even when a response later arrives", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixture", f.handlers, observation);
    await f.start();
    await f.control({ before: Array.from({ length: 9 }, (_, i) => notification("turn/completed", `candidate-${i}`)) });
    await run;
    assert.equal((await observation.turnTerminal).status, "unobservable");
    await f.control({ respond: "candidate-0", after: [notification("turn/completed", "candidate-0")] });
    await assert.rejects(f.runner.runStreamed("blocked", f.handlers), /reuse blocked/u);
  } finally { await f.dispose(); }
});

test("abort cancels blocked queue without manufacturing terminal and history capacity never evicts it", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixture", f.handlers, observation);
    const rejectedRun = assert.rejects(run, /abort|cancel|停止|取消/iu);
    await f.start();
    await f.control({ respond: "real" });
    for (let i = 0; i < 15; i++) f.runner.createExecutionObservation();
    assert.throws(() => f.runner.createExecutionObservation(), /capacity exceeded/u);
    const queued = f.runner.runStreamed("queued", f.handlers);
    const rejectedQueue = assert.rejects(queued, /abort|cancel|停止|取消/iu);
    const cancelledSignal = (f.runner as unknown as { operationCancellation: AbortController }).operationCancellation.signal;
    f.runner.stopAndRebuild();
    await Promise.all([rejectedRun, rejectedQueue]);
    const internal = f.runner as unknown as { observationWaiters: Set<unknown> };
    assert.equal(internal.observationWaiters.size, 0);
    assert.equal(getEventListeners(cancelledSignal, "abort").length, 0);
    let terminalSettled = false;
    void observation.turnTerminal.then(() => { terminalSettled = true; });
    await f.control({});
    assert.equal(terminalSettled, false);
    const blocked = f.runner.runStreamed("still blocked", f.handlers);
    const rejectedBlocked = assert.rejects(blocked, /abort|cancel|停止|取消/iu);
    await f.control({});
    assert.equal(internal.observationWaiters.size, 1, "the queue is waiting for native evidence, not business completion");
    f.runner.stopAndRebuild();
    await rejectedBlocked;
    assert.equal(internal.observationWaiters.size, 0);
    await f.control({ after: [notification("turn/completed", "real", "primary", { turn: { id: "real", status: "interrupted" } })] });
    assert.deepEqual(await observation.turnTerminal, { status: "confirmed", evidence: "native-turn-completed:interrupted" });
  } finally { await f.dispose(); }
});

test("an aborted operation still reconciles its original late response without binding a newer generation", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixture", f.handlers, observation);
    const rejected = assert.rejects(run, /abort|cancel|停止|取消/iu);
    await f.start();
    f.runner.stopAndRebuild();
    await rejected;
    const newer = f.runner.createExecutionObservation();
    let oldSettled = false;
    let newerSettled = false;
    void observation.turnTerminal.then(() => { oldSettled = true; });
    void newer.turnTerminal.then(() => { newerSettled = true; });
    await f.control({ before: [notification("turn/completed", "aborted", "primary", {
      turn: { id: "aborted", status: "interrupted" },
    })] });
    assert.equal(oldSettled, false, "terminal awaits the original request's trusted response");
    await f.control({ respond: "aborted" });
    assert.deepEqual(await observation.turnTerminal, { status: "confirmed", evidence: "native-turn-completed:interrupted" });
    assert.equal(newerSettled, false, "old facts do not settle the new generation");
    assert.deepEqual(f.visible, []);
  } finally { await f.dispose(); }
});

for (const closeMode of ["reject", "close", "breakJson"] as const) {
  test(`handle ${closeMode} never invents terminal or reopens admission`, { timeout: 10000 }, async (t) => {
    const f = gatedObservationFixture(t);
    const observation = f.runner.createExecutionObservation();
    try {
      const run = f.runner.runStreamed("fixture", f.handlers, observation);
      const rejected = assert.rejects(run);
      await f.start();
      if (closeMode === "reject") await f.control({ respond: "real", reject: true });
      else await assert.rejects(f.control({ [closeMode]: true }));
      await rejected;
      assert.equal((await observation.turnTerminal).status, "unobservable");
      await assert.rejects(f.runner.runStreamed("blocked", f.handlers), /reuse blocked/u);
    } finally { await f.dispose(); }
  });
}

test("dispose invalidates registered and blocked handles and removes waiting listeners", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixture", f.handlers, observation);
    const rejected = assert.rejects(run);
    await f.start();
    await f.control({ respond: "real" });
    const stale = f.runner.createExecutionObservation();
    const queued = f.runner.runStreamed("queued", f.handlers);
    const rejectedQueued = assert.rejects(queued);
    f.runner.dispose();
    await Promise.all([rejected, rejectedQueued]);
    assert.equal((await observation.turnTerminal).status, "unobservable");
    await assert.rejects(f.runner.runStreamed("stale", f.handlers, stale), /Invalid or already-used/u);
    assert.equal((f.runner as unknown as { observationWaiters: Set<unknown> }).observationWaiters.size, 0);
  } finally { await f.dispose(); }
});

test("unfinished async request blocks handle release while a shared peer continues", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  const handling = deferred<null>();
  const entered = deferred<void>();
  try {
    const run = f.runner.runStreamed("fixture", { ...f.handlers, onRequest: async () => {
      entered.resolve(); return handling.promise;
    } }, observation);
    await f.start();
    await f.control({ respond: "real", after: [{ id: "approval", method: "item/commandExecution/requestApproval",
      params: { threadId: "primary", turnId: "real", command: "fixed" } }] });
    await entered.promise;
    const peer = f.peer();
    const peerRun = peer.runStreamed("peer", f.handlers);
    await f.start(2);
    const before = await f.control({}, peer);
    let terminalSettled = false;
    void observation.turnTerminal.then(() => { terminalSettled = true; });
    await f.control({ threadId: "peer", respond: "peer-real", after: [notification("turn/completed", "real", "peer")] }, peer);
    assert.equal(terminalSettled, false, "another listener's terminal cannot become primary evidence");
    await f.control({ after: [notification("turn/completed", "real")] });
    await run;
    const cleanup = await observation.cleanup();
    assert.equal(cleanup.runner.status, "unobservable");
    assert.equal(cleanup.executionDrain.status, "unobservable");
    assert.deepEqual(await f.control({}, peer), before);
    handling.resolve(null);
    await f.control({ after: [notification("turn/completed", "peer-real", "peer")] }, peer);
    await peerRun;
  } finally { handling.resolve(null); await f.dispose(); }
});

test("a pending async output callback never becomes execution drain proof", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  const callback = deferred<void>();
  const entered = deferred<void>();
  try {
    const run = f.runner.runStreamed("fixture", { ...f.handlers, onAssistantDelta: async () => {
      entered.resolve(); await callback.promise;
    } }, observation);
    await f.start();
    await f.control({ respond: "real", after: [notification("item/agentMessage/delta", "real", "primary", { delta: "fixed" }),
      notification("turn/completed", "real")] });
    await entered.promise;
    await run;
    assert.equal((await observation.cleanup()).executionDrain.status, "unobservable");
  } finally { callback.resolve(); await f.dispose(); }
});

test("unsupported native unload cannot become successful handle release", { timeout: 10000 }, async (t) => {
  const f = gatedObservationFixture(t);
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixture", f.handlers, observation);
    await f.start();
    await f.control({ unloadUnsupported: true, respond: "real", after: [notification("turn/completed", "real")] });
    await run;
    const cleanup = await observation.cleanup();
    assert.equal(cleanup.turnTerminal.status, "confirmed");
    assert.equal(cleanup.runner.status, "unobservable");
    assert.equal(cleanup.streams.status, "unobservable");
  } finally { await f.dispose(); }
});
