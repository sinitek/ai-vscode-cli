import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { setImmediate as immediate } from "timers/promises";
import { getEventListeners } from "events";
import { CodexOwnedExecution, type CodexOwnedExecutionOptions, type CodexOwnedSession } from "../../interactive/codexOwnedExecution";
import { CodexInteractiveRunner } from "../../interactive/codexRunnerCore";
import type { CodexAppServerConnection } from "../../interactive/codexAppServerPoolCore";

// Actual ordinary Node dependency loading, no vscode mock or loader interception.
assert.throws(() => require.resolve("vscode"), { code: "MODULE_NOT_FOUND" });
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const SERVER = String.raw`
const fs=require('fs'),path=require('path');
if(process.argv.includes('--version')){console.log('codex-cli 0.167.0');return;}
const record=m=>fs.appendFileSync(path.join(ROOT,'wire.jsonl'),JSON.stringify(m)+'\n');
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
let turnRequest, threadRequest;const seen=new Set();
const terminal=()=>({method:'turn/completed',params:{threadId:'native',turn:{id:'turn',status:'completed'}}});
function controls(){for(const name of fs.readdirSync(ROOT)){
 if(!/^control-.*\.json$/.test(name)||seen.has(name))continue;seen.add(name);
 const c=JSON.parse(fs.readFileSync(path.join(ROOT,name),'utf8'));
 for(const m of c.messages||[])send(m);
 if(c.respond)send({id:turnRequest,result:{turn:{id:c.respond}}});
 if(c.thread)send({id:threadRequest,result:{thread:{id:c.thread}}});
 if(Object.hasOwn(c,'threadResult'))send({id:threadRequest,result:c.threadResult});
 if(c.exit){process.stdin.destroy();watcher.close();process.exit(0);}
 if(c.release){send({method:'fixture/tail',params:{threadId:'native'}});watcher.close();process.stdout.end();process.stderr.end();}
 fs.writeFileSync(path.join(ROOT,name+'.ack'),'ok');
}}
const watcher=fs.watch(ROOT,controls);
require('readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);record(m);if(!m.method)return;
 if(m.method==='initialize'){
  if(EARLY_PHASE==='before')send({method:'thread/started',params:{thread:{id:EARLY_THREAD}}});
  send({id:m.id,result:{}});
 }else if(m.method==='initialized'){
  if(EARLY_PHASE==='after')send({method:'thread/started',params:{thread:{id:EARLY_THREAD}}});
 }
 else if(m.method==='thread/start'||m.method==='thread/resume'){
  threadRequest=m.id;if(!HOLD_THREAD)send({id:m.id,result:{thread:{id:BAD_THREAD?'wrong':'native'}}});
 }else if(m.method==='turn/start'){
  turnRequest=m.id;send({method:'fixture/started',params:{threadId:m.params.threadId}});
 }else if(m.id!==undefined)send({id:m.id,result:m.method==='thread/unsubscribe'?{status:'notLoaded'}:{}});
});
process.stdin.on('end',()=>{
 record({eof:true});fs.writeFileSync(path.join(ROOT,'stdin-eof'),'ok');
 if(HOLD_EXIT){
  const source="const fs=require('fs'),p="+JSON.stringify(ROOT)+";const w=fs.watch(p,()=>{if(fs.existsSync(p+'/release-pipe')){process.stdout.write(JSON.stringify({method:'fixture/tail',params:{threadId:'native'}})+'\\n');w.close();}});fs.writeFileSync(p+'/pipe-ready','ok');";
  require('child_process').spawn(process.execPath,['-e',source],{stdio:['ignore',process.stdout,process.stderr]});
  watcher.close();process.exit(0);
 }
});
controls();
`;
function waitFile(file: string): Promise<void> {
  if (fs.existsSync(file)) return Promise.resolve();
  return new Promise((resolve) => {
    const watcher = fs.watch(path.dirname(file), () => {
      if (fs.existsSync(file)) { watcher.close(); resolve(); }
    });
    if (fs.existsSync(file)) { watcher.close(); resolve(); }
  });
}
function fixture(settings: { holdThread?: boolean; badThread?: boolean; holdExit?: boolean;
  earlyPhase?: "before" | "after"; earlyThread?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-owned-"));
  const source = `const ROOT=${JSON.stringify(root)},HOLD_THREAD=${!!settings.holdThread},BAD_THREAD=${!!settings.badThread},HOLD_EXIT=${!!settings.holdExit},EARLY_PHASE=${JSON.stringify(settings.earlyPhase)},EARLY_THREAD=${JSON.stringify(settings.earlyThread)};\n${SERVER}`;
  const command = path.join(root, process.platform === "win32" ? "fixture.cmd" : "fixture");
  const script = path.join(root, "fixture.cjs");
  fs.writeFileSync(script, source);
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/usr/bin/env node\n${source}`);
  fs.chmodSync(command, 0o755);
  const signal = new AbortController();
  const started = deferred();
  const tail = deferred();
  const visible: string[] = [];
  const sources: unknown[] = [];
  let serial = 0;
  const options: CodexOwnedExecutionOptions = {
    runner: { command, args: [], cwd: root, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      PATHEXT: process.env.PATHEXT, HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, ".codex") },
      threadId: null, thinkingMode: "medium", interactiveMode: "coding" },
    runtime: { macTaskShell: "bash", logInfo: () => {}, logError: () => {} },
    prompt: "one fixed task", signal: signal.signal, bindSession: async (session) => session,
    handlers: {
      onAssistantDelta: (chunk) => { visible.push(chunk); }, onTrace: () => {}, onThreadId: () => {}, onTaskListUpdate: () => {},
      onNotification: (message, source) => {
        sources.push(source);
        if (message.method === "fixture/started") started.resolve();
        if (message.method === "fixture/tail") tail.resolve();
      },
    },
  };
  const wire = (): Record<string, any>[] => fs.existsSync(path.join(root, "wire.jsonl"))
    ? fs.readFileSync(path.join(root, "wire.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { root, options, signal, started, tail, visible, sources, wire,
    count: (method: string) => wire().filter((m) => m.method === method).length,
    control: async (value: Record<string, unknown>) => {
      const file = path.join(root, `control-${++serial}.json`);
      const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file);
      if (!value.exit) await waitFile(file + ".ack");
    },
    waitMethod: async (method: string) => {
      if (wire().some((m) => m.method === method)) return;
      await new Promise<void>((resolve) => {
        const check = () => { if (wire().some((m) => m.method === method)) { watcher.close(); resolve(); } };
        const watcher = fs.watch(root, check); check();
      });
    },
    eof: () => waitFile(path.join(root, "stdin-eof")),
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
const terminal = { method: "turn/completed", params: { threadId: "native", turn: { id: "turn", status: "completed" } } };
function connection(execution: CodexOwnedExecution): CodexAppServerConnection {
  return (execution as unknown as { runner: { ownedConnection: CodexAppServerConnection } }).runner.ownedConnection;
}
async function complete(f: ReturnType<typeof fixture>, owned: CodexOwnedExecution) {
  await f.control({ messages: [terminal], respond: "turn" });
  await owned.execute();
  const cleanup = owned.cleanup();
  await f.eof();
  await assert.rejects(connection(owned).request("unrelated", "turn/start", {}), /sealed/);
  await assert.rejects(connection(owned).withThread("unrelated", "native", async () => {}), /sealed/);
  await f.control({ release: true });
  return cleanup;
}

test("owned native preparation, exact binding latch and single-use promises precede the only task", { timeout: 10000 }, async () => {
  const f = fixture(); const bind = deferred<CodexOwnedSession>(); const binding = deferred<CodexOwnedSession>();
  const owned = new CodexOwnedExecution({ ...f.options, bindSession: (s) => { binding.resolve(s); return bind.promise; } });
  const prepared = owned.prepare(); assert.equal(owned.prepare(), prepared);
  const session = await prepared;
  assert.equal(session.threadId, "native"); assert.ok(Object.isFrozen(session)); assert.ok(Object.isFrozen(session.token));
  assert.deepEqual(f.wire().filter((m) => m.method).map((m) => m.method), ["initialize", "initialized", "thread/start"]);
  const run = owned.execute(); assert.equal(owned.execute(), run);
  assert.equal(await binding.promise, session); assert.equal(f.count("turn/start"), 0);
  assert.throws(() => connection(owned).retain({ id: "peer" } as never), /专属|retain/);
  bind.resolve(session); await f.started.promise;
  assert.equal(f.count("turn/start"), 1);
  assert.equal(f.wire().find((m) => m.method === "turn/start")!.params.threadId, "native");
  const result = await complete(f, owned);
  assert.equal(owned.cleanup(), owned.cleanup());
  assert.equal(result.turnTerminal.status, "confirmed"); assert.equal(result.processTerminal.status, "confirmed");
  assert.equal(result.streams.status, "confirmed"); assert.equal(result.executionDrain.status, "confirmed", JSON.stringify(result));
  assert.equal(result.runner.status, "confirmed"); await f.tail.promise;
  assert.ok(f.sources.every((s: any) => s.connectionId === session.connectionId && s.listener.id === session.token.runnerId && !s.buffered));
  assert.equal(f.count("thread/start"), 1); assert.equal(f.count("turn/start"), 1);
  assert.equal(getEventListeners(f.signal.signal, "abort").length, 0); f.remove();
});

for (const mismatch of [false, true]) test(`owned binding ${mismatch ? "identity mismatch" : "rejection"} sends zero tasks`, { timeout: 10000 }, async () => {
  const f = fixture(); const owned = new CodexOwnedExecution({ ...f.options,
    bindSession: async (s) => { if (!mismatch) throw new Error("persist failed"); return { ...s, threadId: "other" }; },
  });
  await assert.rejects(owned.execute(), /binding/);
  const cleanup = owned.cleanup(); await f.eof(); assert.equal(f.count("turn/start"), 0);
  await f.control({ release: true }); const result = await cleanup;
  assert.equal(result.turnTerminal.status, "not-applicable");
  if (!mismatch) assert.equal(result.executionDrain.status, "failed"); f.remove();
});

test("owned cancellation during binding wakes execute but retains original binding responsibility", { timeout: 10000 }, async () => {
  const f = fixture(); const bind = deferred<CodexOwnedSession>(); const entered = deferred<CodexOwnedSession>();
  const owned = new CodexOwnedExecution({ ...f.options, bindSession: (s) => { entered.resolve(s); return bind.promise; } });
  const rejected = assert.rejects(owned.execute(), { name: "AbortError" }); const session = await entered.promise;
  f.signal.abort(); await rejected; let done = false;
  const cleanup = owned.cleanup().then((r) => { done = true; return r; });
  await f.eof(); await f.control({ release: true }); await connection(owned).observeProcessTermination(); await immediate();
  assert.equal(done, false); assert.equal(f.count("turn/start"), 0);
  bind.resolve(session); assert.equal((await cleanup).turnTerminal.status, "not-applicable"); f.remove();
});

test("owned terminal before original start response does not seal or lose the late response", { timeout: 10000 }, async () => {
  const f = fixture(); const owned = new CodexOwnedExecution(f.options); const run = owned.execute(); await f.started.promise;
  await f.control({ messages: [terminal] }); await run;
  let cleaned = false; const cleanup = owned.cleanup().then((r) => { cleaned = true; return r; });
  await immediate(); assert.equal(fs.existsSync(path.join(f.root, "stdin-eof")), false); assert.equal(cleaned, false);
  await f.control({ respond: "turn" }); assert.equal((await owned.observation.turnTerminal).status, "confirmed");
  await f.eof(); await f.control({ release: true }); assert.equal((await cleanup).executionDrain.status, "confirmed"); f.remove();
});

test("owned final-answer fallback cannot close before real terminal and response", { timeout: 10000 }, async () => {
  const f = fixture(); const owned = new CodexOwnedExecution(f.options); const run = owned.execute(); await f.started.promise;
  await f.control({ messages: [{ method: "item/completed", params: { threadId: "native", turnId: "turn",
    item: { id: "answer", type: "agent_message", phase: "final_answer", text: "fixed answer" } } }] });
  await run; const cleanup = owned.cleanup(); await immediate();
  assert.equal(fs.existsSync(path.join(f.root, "stdin-eof")), false); assert.deepEqual(f.visible, ["fixed answer"]);
  await f.control({ messages: [terminal], respond: "turn" }); await f.eof(); await f.control({ release: true });
  assert.equal((await cleanup).executionDrain.status, "confirmed"); assert.deepEqual(f.visible, ["fixed answer"]); f.remove();
});

test("owned async callback and cancelled original server handler remain drain responsibilities", { timeout: 10000 }, async () => {
  const f = fixture(); const callback = deferred(); const handler = deferred(); const entered = deferred(); const delta = deferred();
  const owned = new CodexOwnedExecution({ ...f.options, handlers: { ...f.options.handlers,
    onAssistantDelta: () => { delta.resolve(); return callback.promise; },
    onRequest: async () => { entered.resolve(); await handler.promise; return { result: {} }; },
  } });
  const run = owned.execute(); await f.started.promise;
  await f.control({ respond: "turn", messages: [
    { id: "approval", method: "item/commandExecution/requestApproval", params: { threadId: "native", turnId: "turn" } },
    { method: "item/agentMessage/delta", params: { threadId: "native", turnId: "turn", itemId: "a", delta: "hello" } },
  ] }); await entered.promise; await delta.promise;
  await f.control({ messages: [terminal] }); await run;
  let done = false; const cleanup = owned.cleanup().then((r) => { done = true; return r; }); await immediate();
  assert.equal(fs.existsSync(path.join(f.root, "stdin-eof")), false, "cancel reply cannot erase original handler");
  handler.resolve(); await f.eof(); await f.control({ release: true }); await connection(owned).observeProcessTermination(); await immediate();
  assert.equal(done, false, "callback promise remains after process close");
  callback.resolve(); assert.equal((await cleanup).executionDrain.status, "confirmed");
  assert.ok(f.wire().some((m) => m.id === "approval" && (m.result || m.error))); f.remove();
});

test("owned real child exit before inherited pipe close waits and consumes the actual tail", { timeout: 10000 }, async () => {
  const f = fixture({ holdExit: true }); const owned = new CodexOwnedExecution(f.options);
  const run = owned.execute(); await f.started.promise; await f.control({ messages: [terminal], respond: "turn" }); await run;
  const child = (connection(owned) as unknown as { child: import("child_process").ChildProcess }).child;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let done = false; const cleanup = owned.cleanup().then((r) => { done = true; return r; });
  await exited; await waitFile(path.join(f.root, "pipe-ready")); assert.equal(done, false); assert.equal(child.exitCode, 0);
  fs.writeFileSync(path.join(f.root, "release-pipe"), "ok"); await f.tail.promise;
  const result = await cleanup; assert.equal(result.streams.status, "confirmed"); assert.equal(result.executionDrain.status, "confirmed"); f.remove();
});

for (const error of [false, true]) test(`owned ${error ? "stream error" : "early stdout destroy"} never upgrades drain`, { timeout: 10000 }, async () => {
  const f = fixture(); const owned = new CodexOwnedExecution(f.options); const run = owned.execute(); await f.started.promise;
  await f.control({ messages: [terminal], respond: "turn" }); await run;
  const child = (connection(owned) as unknown as { child: import("child_process").ChildProcess }).child;
  child.stdout!.destroy(error ? new Error("controlled-stream-error") : undefined);
  const cleanup = owned.cleanup();
  // Destruction is not EOF evidence. End the fixture through its own control.
  await f.control({ exit: true }); const result = await cleanup;
  assert.notEqual(result.streams.status, "confirmed"); assert.notEqual(result.executionDrain.status, "confirmed"); f.remove();
});

test("owned pre-abort and invalid native resume identity never dispatch tasks", { timeout: 10000 }, async () => {
  const f = fixture({ badThread: true });
  const owned = new CodexOwnedExecution({ ...f.options, runner: { ...f.options.runner, threadId: "expected" } });
  await assert.rejects(owned.execute(), /identity/); const cleanup = owned.cleanup(); await f.eof();
  assert.equal(f.count("turn/start"), 0); await f.control({ release: true }); await cleanup;
  const signal = new AbortController(); signal.abort();
  const aborted = new CodexOwnedExecution({ ...f.options, signal: signal.signal });
  await assert.rejects(aborted.execute(), { name: "AbortError" });
  assert.equal((await aborted.cleanup()).processTerminal.status, "unobservable"); f.remove();
});

test("owned seal does not close ordinary shared peers or upgrade their observation", { timeout: 10000 }, async () => {
  const f = fixture(); const shared = new CodexInteractiveRunner(f.options.runner, f.options.runtime);
  const sharedObservation = shared.createExecutionObservation();
  const peerStarted = deferred();
  const sharedRun = shared.runStreamed("peer", { ...f.options.handlers,
    onEvent: (event: any) => { if (event.method === "fixture/started") peerStarted.resolve(); },
  }, sharedObservation);
  // Same executable but distinct process/control directory would cross control files.
  // Use thread notification source as the wire latch, then only address the shared
  // process via its existing transport for this regression.
  const internal = shared as unknown as { listener: { handleNotification: (...args: any[]) => void }; connection: CodexAppServerConnection };
  const old = internal.listener.handleNotification;
  internal.listener.handleNotification = (...args) => { if (args[0].method === "fixture/started") peerStarted.resolve(); old(...args); };
  await peerStarted.promise;
  const connectionBefore = internal.connection;
  // Independent owned lifecycle with its own fixture; the ordinary shared reader stays alive.
  const ownFixture = fixture(); const owned = new CodexOwnedExecution(ownFixture.options);
  const run = owned.execute(); await ownFixture.started.promise; await complete(ownFixture, owned); await run;
  assert.equal(connectionBefore.isAlive(), true);
  await f.control({ messages: [terminal], respond: "turn" }); await sharedRun;
  const result = await sharedObservation.cleanup();
  assert.equal(result.executionDrain.status, "unobservable"); assert.equal(result.streams.status, "unobservable");
  shared.dispose(); await connectionBefore.observeProcessTermination(); f.remove(); ownFixture.remove();
});

test("owned abort during native preparation wakes waiting caller without sending a task", { timeout: 10000 }, async () => {
  const f = fixture({ holdThread: true }); const owned = new CodexOwnedExecution(f.options);
  const prep = owned.prepare(); const rejected = assert.rejects(prep, { name: "AbortError" });
  // A real native request is the gate; response is deliberately held.
  const record = path.join(f.root, "wire.jsonl");
  await waitFile(record);
  if (!f.count("thread/start")) await new Promise<void>((resolve) => {
    const watcher = fs.watch(f.root, () => { if (f.count("thread/start")) { watcher.close(); resolve(); } });
    if (f.count("thread/start")) { watcher.close(); resolve(); }
  });
  f.signal.abort(); await rejected;
  const cleanup = owned.cleanup(); await f.eof(); assert.equal(f.count("turn/start"), 0);
  await f.control({ thread: "native", release: true });
  const result = await cleanup; assert.equal(result.turnTerminal.status, "not-applicable"); f.remove();
});

test("owned cancel while cleanup waits for native terminal closes only its source and preserves missing terminal", { timeout: 10000 }, async () => {
  const f = fixture(); const owned = new CodexOwnedExecution(f.options); const run = owned.execute();
  const rejected = assert.rejects(run, { name: "AbortError" }); await f.started.promise;
  // Cleanup has sealed admission but must remain cancellable.
  const cleanup = owned.cleanup(); f.signal.abort(); await rejected;
  await f.eof(); await f.control({ respond: "turn", release: true });
  const result = await cleanup; assert.equal(result.turnTerminal.status, "unobservable");
  assert.equal(result.executionDrain.status, "confirmed", "transport drain is separate from missing turn terminal");
  assert.equal(f.count("turn/start"), 1); f.remove();
});

test("owned rejected callback is consumed and reported failed after otherwise natural source drain", { timeout: 10000 }, async () => {
  const f = fixture(); const owned = new CodexOwnedExecution({ ...f.options, handlers: { ...f.options.handlers,
    onAssistantDelta: async () => { throw new Error("callback rejected"); },
  } });
  const run = owned.execute(); await f.started.promise;
  await f.control({ messages: [{ method: "item/agentMessage/delta", params: {
    threadId: "native", turnId: "turn", itemId: "a", delta: "hello",
  } }], respond: "turn" });
  const result = await complete(f, owned); await run;
  assert.equal(result.streams.status, "confirmed"); assert.equal(result.executionDrain.status, "failed"); f.remove();
});

test("owned prepared session refuses forced handoff by another connection during binding", { timeout: 10000 }, async () => {
  const f = fixture(); const owned = new CodexOwnedExecution(f.options); await owned.prepare();
  const peer = new CodexInteractiveRunner({ ...f.options.runner, threadId: "native" }, f.options.runtime);
  await assert.rejects(peer.runStreamed("must not send", f.options.handlers), /专属执行|交接/);
  const peerConnection = (peer as unknown as { connection: CodexAppServerConnection }).connection;
  peer.dispose(); await peerConnection.observeProcessTermination();
  assert.equal(connection(owned).isAlive(), true); assert.equal(f.count("turn/start"), 0);
  assert.equal(f.count("thread/resume"), 0);
  const cleanup = owned.cleanup(); await f.eof(); await f.control({ release: true });
  assert.equal((await cleanup).executionDrain.status, "confirmed"); f.remove();
});

test("owned callback admission stays bounded and overflow can never become successful drain", { timeout: 10000 }, async () => {
  const f = fixture(); const gate = deferred(); let callbacks = 0;
  const owned = new CodexOwnedExecution({ ...f.options, handlers: { ...f.options.handlers,
    onAssistantDelta: () => { callbacks++; return gate.promise; },
  } });
  const run = owned.execute(); await f.started.promise;
  await f.control({ respond: "turn", messages: Array.from({ length: 70 }, (_, i) => ({
    method: "item/agentMessage/delta", params: { threadId: "native", turnId: "turn", itemId: String(i), delta: "x" },
  })) });
  // A terminal is an actual reader ordering barrier after every delta above.
  await f.control({ messages: [terminal] }); await run;
  assert.ok(callbacks > 0 && callbacks <= 64);
  gate.resolve(); const cleanup = owned.cleanup(); await f.eof(); await f.control({ release: true });
  assert.equal((await cleanup).executionDrain.status, "failed"); f.remove();
});


for (const phase of ["before", "after"] as const) {
  for (const resume of [false, true]) test(`owned ${phase}-readiness notification cannot replace raw ${resume ? "resume" : "start"} credential`,
    { timeout: 10000 }, async () => {
      const f = fixture({ holdThread: true, earlyPhase: phase, earlyThread: resume ? "native" : "decoy" });
      const seen = deferred();
      const owned = new CodexOwnedExecution({ ...f.options,
        runner: { ...f.options.runner, threadId: resume ? "native" : null },
        handlers: { ...f.options.handlers, onNotification: (m, source) => {
          f.options.handlers.onNotification?.(m, source);
          if (m.method === "thread/started") seen.resolve();
        } },
      });
      let prepared = false; const prep = owned.prepare().then((s) => { prepared = true; return s; });
      await seen.promise; await f.waitMethod(resume ? "thread/resume" : "thread/start");
      await immediate(); assert.equal(prepared, false, "loaded notification is not a response credential");
      assert.equal(f.count("turn/start"), 0);
      const raw = f.wire().find((m) => m.method === (resume ? "thread/resume" : "thread/start"))!;
      if (resume) assert.equal(raw.params.threadId, "native");
      else assert.equal(f.count("thread/resume"), 0, "decoy cannot turn a new request into resume");
      assert.equal(f.sources.length, 1, "notification was consumed, not dropped");
      await f.control({ thread: "native" }); assert.equal((await prep).threadId, "native");
      const run = owned.execute(); await f.started.promise;
      assert.equal((await complete(f, owned)).executionDrain.status, "confirmed"); await run;
      assert.equal(f.count(resume ? "thread/resume" : "thread/start"), 1, "execute reuses raw credential"); f.remove();
    });

  for (const conflict of [false, true]) test(`owned ${phase}-readiness notification cannot hide ${conflict ? "conflicting resume" : "missing start"} response`,
    { timeout: 10000 }, async () => {
      const f = fixture({ holdThread: true, earlyPhase: phase, earlyThread: "native" });
      const owned = new CodexOwnedExecution({ ...f.options, runner: { ...f.options.runner, threadId: conflict ? "native" : null } });
      const run = owned.execute(); const rejected = assert.rejects(run, /identity/);
      await f.waitMethod(conflict ? "thread/resume" : "thread/start");
      await f.control({ threadResult: conflict ? { thread: { id: "conflict" } } : {} }); await rejected;
      const cleanup = owned.cleanup(); await f.eof(); assert.equal(f.count("turn/start"), 0);
      await f.control({ release: true }); assert.equal((await cleanup).turnTerminal.status, "not-applicable"); f.remove();
    });
}

test("owned notification during cancelled preparation cannot revive a late raw credential", { timeout: 10000 }, async () => {
  const f = fixture({ holdThread: true, earlyPhase: "before", earlyThread: "native" });
  const owned = new CodexOwnedExecution(f.options); const run = owned.execute();
  const rejected = assert.rejects(run, { name: "AbortError" }); await f.waitMethod("thread/start");
  f.signal.abort(); await rejected;
  const cleanup = owned.cleanup(); await f.eof(); await f.control({ thread: "native", release: true });
  assert.equal((await cleanup).turnTerminal.status, "not-applicable"); assert.equal(f.count("turn/start"), 0);
  assert.equal((owned as any).runner.ownedThreadCredential, undefined); f.remove();
});

test("owned truncated unclaimed notifications stay unobservable after claim and natural EOF", { timeout: 10000 }, async () => {
  const f = fixture(); const binding = deferred<CodexOwnedSession>(); const bound = deferred<CodexOwnedSession>();
  const barrier = deferred(); const received: number[] = [];
  const owned = new CodexOwnedExecution({ ...f.options,
    bindSession: (s) => { bound.resolve(s); return binding.promise; },
    handlers: { ...f.options.handlers, onNotification: (m, source) => {
      f.options.handlers.onNotification?.(m, source);
      if (m.method === "fixture/buffered") { assert.equal(source.buffered, true); received.push((m.params as any).index); }
      if (m.method === "fixture/barrier") barrier.resolve();
    } },
  });
  const run = owned.execute(); await bound.promise;
  await f.control({ messages: [ ...Array.from({ length: 45 }, (_, index) => ({
    method: "fixture/buffered", params: { threadId: "unclaimed", index },
  })), { method: "fixture/barrier" } ] }); await barrier.promise;
  const conn = connection(owned);
  const internal = conn as any; assert.equal(internal.buffered.get("unclaimed").length, 40);
  assert.equal(internal.ownedTransportFailure, "owned-unrouted-messages-truncated");
  conn.claimThread("unclaimed", owned.observation.token.runnerId);
  assert.deepEqual(received, Array.from({ length: 40 }, (_, i) => i + 5)); assert.equal(internal.buffered.size, 0);
  binding.resolve(await bound.promise); await f.started.promise;
  const result = await complete(f, owned); await run;
  assert.equal(result.streams.status, "confirmed"); assert.equal(result.turnTerminal.status, "confirmed");
  assert.deepEqual(result.executionDrain, { status: "unobservable", reason: "owned-unrouted-messages-truncated" }); f.remove();
});

test("shared repeated cancelled handlers retain no owned drain tasks and still accept later requests", { timeout: 10000 }, async () => {
  const f = fixture(); const pending: ReturnType<typeof deferred<{ result: {} }>>[] = [];
  let waveEntered = deferred();
  const shared = new CodexInteractiveRunner(f.options.runner, f.options.runtime);
  const run = shared.runStreamed("shared task", { ...f.options.handlers,
    onRequest: () => {
      const gate = deferred<{ result: {} }>(); pending.push(gate);
      if (pending.length % 24 === 0) waveEntered.resolve();
      return gate.promise;
    },
  });
  await f.waitMethod("turn/start");
  const conn = (shared as any).connection as CodexAppServerConnection; const internal = conn as any;
  const owner = (shared as any).listenerId as string;
  for (let wave = 0; wave < 3; wave++) {
    waveEntered = deferred();
    await f.control({ messages: Array.from({ length: 24 }, (_, i) => ({
      id: `approval-${wave}-${i}`, method: "item/commandExecution/requestApproval",
      params: { threadId: "native", turnId: "turn" },
    })) }); await waveEntered.promise;
    conn.cancelServerRequests(owner); await conn.request(owner, "fixture/barrier", {});
    assert.equal(internal.inbound.size, 0); assert.equal(internal.handlerTasks.size, 0);
    assert.equal(internal.handlingOwners.get(owner), (wave + 1) * 24, "original release gate remains");
    assert.equal(conn.isAlive(), true);
  }
  assert.equal(f.wire().filter((m) => typeof m.id === "string" && m.id.startsWith("approval-")).length, 72);
  for (const gate of pending) gate.resolve({ result: {} });
  await immediate(); assert.equal(internal.handlingOwners.size, 0);
  await f.control({ messages: [terminal], respond: "turn" }); await run;
  assert.equal(internal.handlerTasks.size, 0);
  shared.dispose(); await conn.observeProcessTermination(); f.remove();
});
