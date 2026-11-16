import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { setImmediate as immediate } from "timers/promises";
import { getEventListeners, setMaxListeners } from "events";
import { CodexOwnedExecution, type CodexOwnedExecutionOptions, type CodexOwnedSession } from "../../interactive/codexOwnedExecution";
import { CodexInteractiveRunner } from "../../interactive/codexRunnerCore";
import type { CodexAppServerConnection } from "../../interactive/codexAppServerPoolCore";

// Actual ordinary Node dependency loading, no vscode mock or loader interception.
assert.throws(() => require.resolve("vscode"), { code: "MODULE_NOT_FOUND" });
// Every fixture gate settles on failure/timeout too, including original callback
// promises which the production drain deliberately continues to own.
function deferred<T = void>(signal: AbortSignal) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done, reject) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { finish(); reject(new Error("fixture gate cancelled")); };
    const timer = setTimeout(() => { finish(); reject(new Error("fixture gate timed out")); }, 3000);
    resolve = (value) => { finish(); done(value); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  void promise.catch(() => undefined);
  return { promise, resolve };
}
function waitUntil(check: () => boolean, signal: AbortSignal, label: string, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearInterval(poll); clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new Error(`fixture wait cancelled: ${label}`));
    const inspect = () => { try { if (check()) finish(); } catch (error) { finish(error as Error); } };
    const poll = setInterval(inspect, 10);
    const timer = setTimeout(() => finish(new Error(`fixture wait timed out: ${label}`)), timeout);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else inspect();
  });
}
const SERVER = String.raw`
const fs=require('fs'),path=require('path');
const kind=process.argv.includes('--version')?'version':'app-server';
fs.writeFileSync(path.join(ROOT,'server-'+process.pid+'.json'),JSON.stringify({pid:process.pid,ppid:process.ppid,kind}));
process.on('exit',code=>fs.writeFileSync(path.join(ROOT,'exit-'+process.pid),String(code)));
if(kind==='version'){console.log('codex-cli 0.167.0');return;}
const record=m=>fs.appendFileSync(path.join(ROOT,'wire.jsonl'),JSON.stringify(m)+'\n');
const send=m=>{fs.appendFileSync(path.join(ROOT,'sent.jsonl'),JSON.stringify(m)+'\n');process.stdout.write(JSON.stringify(m)+'\n');};
let turnRequest, threadRequest;const seen=new Set();
const terminal=()=>({method:'turn/completed',params:{threadId:'native',turn:{id:'turn',status:'completed'}}});
function controls(){for(const name of fs.readdirSync(ROOT)){
 if(!/^control-.*\.json$/.test(name)||seen.has(name))continue;seen.add(name);
 const c=JSON.parse(fs.readFileSync(path.join(ROOT,name),'utf8'));
 for(const m of c.messages||[])send(m);
 if(c.respond)send({id:turnRequest,result:{turn:{id:c.respond}}});
 if(c.thread)send({id:threadRequest,result:{thread:{id:c.thread}}});
 if(Object.hasOwn(c,'threadResult'))send({id:threadRequest,result:c.threadResult});
 if(c.exit){process.stdin.destroy();clearInterval(poll);process.exit(0);}
 if(c.release){send({method:'fixture/tail',params:{threadId:'native'}});clearInterval(poll);process.stdout.end();process.stderr.end();}
 fs.writeFileSync(path.join(ROOT,name+'.ack'),'ok');
}}
// Filesystem events can coalesce; protocol controls must not depend on one event.
const poll=setInterval(controls,10);
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
  const source="const fs=require('fs'),p="+JSON.stringify(ROOT)+";process.on('exit',code=>fs.writeFileSync(p+'/exit-'+process.pid,String(code)));fs.writeFileSync(p+'/pipe-pid',String(process.pid));const deadline=setTimeout(()=>process.exit(2),3000);const w=setInterval(()=>{if(fs.existsSync(p+'/release-pipe')){process.stdout.write(JSON.stringify({method:'fixture/tail',params:{threadId:'native'}})+'\\n');clearInterval(w);clearTimeout(deadline);}},10);fs.writeFileSync(p+'/pipe-ready','ok');";
  require('child_process').spawn(process.execPath,['-e',source],{stdio:['ignore',process.stdout,process.stderr]});
  clearInterval(poll);process.exit(0);
 }
});
controls();
`;
function fixture(t: test.TestContext, settings: { holdThread?: boolean; badThread?: boolean; holdExit?: boolean;
  earlyPhase?: "before" | "after"; earlyThread?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-owned-"));
  const source = `const ROOT=${JSON.stringify(root)},HOLD_THREAD=${!!settings.holdThread},BAD_THREAD=${!!settings.badThread},HOLD_EXIT=${!!settings.holdExit},EARLY_PHASE=${JSON.stringify(settings.earlyPhase)},EARLY_THREAD=${JSON.stringify(settings.earlyThread)};\n${SERVER}`;
  const command = path.join(root, process.platform === "win32" ? "fixture.cmd" : "fixture");
  const script = path.join(root, "fixture.cjs");
  fs.writeFileSync(script, source);
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/usr/bin/env node\n${source}`);
  fs.chmodSync(command, 0o755);
  const signal = new AbortController();
  const lifetime = new AbortController();
  // The repeated-handler case deliberately retains 72 original callback gates.
  setMaxListeners(128, lifetime.signal);
  const gate = <T = void>() => deferred<T>(lifetime.signal);
  const started = gate();
  const tail = gate();
  const visible: string[] = [];
  const sources: unknown[] = [];
  const notifications: { message: Readonly<Record<string, unknown>>; source: any }[] = [];
  const executions: CodexOwnedExecution[] = [];
  const runners: CodexInteractiveRunner[] = [];
  const knownConnections = new Set<CodexAppServerConnection>();
  const rememberConnections = () => {
    for (const c of [...executions.map(connection), ...runners.map((r) => (r as any).connection)]) {
      if (c) knownConnections.add(c);
    }
  };
  const promises = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T> => {
    promises.add(promise);
    void promise.then(() => promises.delete(promise), () => promises.delete(promise));
    return promise;
  };
  const waitFile = (file: string) => waitUntil(() => fs.existsSync(file), lifetime.signal, path.basename(file));
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
        notifications.push({ message, source });
        if (message.method === "fixture/started") started.resolve();
        if (message.method === "fixture/tail") tail.resolve();
      },
    },
  };
  // Ignore only an unfinished last append, never a malformed complete record.
  const records = (name: string): Record<string, any>[] => fs.existsSync(path.join(root, name))
    ? fs.readFileSync(path.join(root, name), "utf8").split("\n").slice(0, -1).map((line) => JSON.parse(line)) : [];
  const wire = () => { rememberConnections(); return records("wire.jsonl"); };
  const writeControl = (value: Record<string, unknown>) => {
    const file = path.join(root, `control-${String(++serial).padStart(4, "0")}.json`);
    const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file);
    return file;
  };
  const cancel = () => { signal.abort(); lifetime.abort(); };
  t.signal.addEventListener("abort", cancel, { once: true });
  t.after(async () => {
    t.signal.removeEventListener("abort", cancel);
    cancel();
    rememberConnections();
    for (const owned of executions) { owned.cancel(); track(owned.cleanup()); }
    const children = [...new Set([...knownConnections].map((c) => (c as any).child as import("child_process").ChildProcess))].filter(Boolean);
    // Always release the precise inherited-pipe helper, even after an assertion.
    fs.writeFileSync(path.join(root, "release-pipe"), "ok");
    const protocolExit = children.filter((child) => child.exitCode === null && child.signalCode === null).map((child) => child.pid);
    if (protocolExit.length) writeControl({ exit: true });
    const rescue = new AbortController();
    const forced: number[] = [];
    for (const child of children) {
      try {
        await waitUntil(() => child.exitCode !== null || child.signalCode !== null, rescue.signal, "fixture child exit", 1000);
      } catch {
        // Only a ChildProcess obtained from this fixture's exact connection;
        // never enumerate/kill other tests' processes or process groups.
        assert.ok(child.spawnargs.some((arg) => arg === command || arg === script));
        forced.push(child.pid!); child.kill("SIGTERM");
        await waitUntil(() => child.exitCode !== null || child.signalCode !== null, rescue.signal, "forced fixture exit", 1000);
      }
    }
    for (const runner of runners) runner.dispose();
    await waitUntil(() => promises.size === 0, rescue.signal, "fixture promises settled", 1000);
    const servers = fs.readdirSync(root).filter((name) => /^server-\d+\.json$/.test(name));
    const pids = servers.map((name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8")).pid as number);
    if (fs.existsSync(path.join(root, "pipe-pid"))) pids.push(Number(fs.readFileSync(path.join(root, "pipe-pid"), "utf8")));
    await waitUntil(() => pids.every((pid) => children.some((child) => child.pid === pid && (child.exitCode !== null || child.signalCode !== null))
      || fs.existsSync(path.join(root, `exit-${pid}`))), rescue.signal, "fixture exit records", 1000);
    t.diagnostic(JSON.stringify({ fixture: root, exits: pids.map((pid) => {
      const child = children.find((c) => c.pid === pid);
      const identityFile = path.join(root, `server-${pid}.json`);
      const kind = fs.existsSync(identityFile) ? JSON.parse(fs.readFileSync(identityFile, "utf8")).kind : "pipe-helper";
      return { pid, kind, code: child?.exitCode ?? (fs.existsSync(path.join(root, `exit-${pid}`))
        ? Number(fs.readFileSync(path.join(root, `exit-${pid}`), "utf8")) : null), signal: child?.signalCode ?? null };
    }), protocolExit, forced }));
    assert.deepEqual(forced, [], "forced reclamation is not natural cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, options, signal, started, tail, visible, sources, notifications, wire, gate, track,
    owned: (input: CodexOwnedExecutionOptions) => { const owned = new CodexOwnedExecution(input); executions.push(owned); return owned; },
    runner: (input: ConstructorParameters<typeof CodexInteractiveRunner>[0]) => {
      const runner = new CodexInteractiveRunner(input, options.runtime); runners.push(runner);
      const dispose = runner.dispose.bind(runner);
      runner.dispose = () => { rememberConnections(); dispose(); };
      const run = runner.runStreamed.bind(runner);
      runner.runStreamed = (...args) => track(run(...args));
      return runner;
    },
    sent: () => records("sent.jsonl"),
    count: (method: string) => wire().filter((m) => m.method === method).length,
    control: async (value: Record<string, unknown>) => {
      const file = writeControl(value);
      if (!value.exit) await waitFile(file + ".ack");
    },
    waitMethod: (method: string) => waitUntil(() => wire().some((m) => m.method === method), lifetime.signal, method),
    barrier: async () => {
      const id = `fixture-barrier-${++serial}`;
      writeControl({ messages: [{ id, method: "fixture/barrier" }] });
      // The real reader must consume this request and send its rejection. A
      // fake send log or filesystem ack alone is not receipt evidence.
      await waitUntil(() => wire().some((m) => m.id === id && m.error), lifetime.signal, id);
    },
    waitFile,
    waitCondition: (check: () => boolean, label: string) => waitUntil(check, lifetime.signal, label),
    eof: () => waitFile(path.join(root, "stdin-eof")),
  };
}
const terminal = { method: "turn/completed", params: { threadId: "native", turn: { id: "turn", status: "completed" } } };
function connection(execution: CodexOwnedExecution): CodexAppServerConnection {
  return (execution as unknown as { runner: { ownedConnection: CodexAppServerConnection } }).runner.ownedConnection;
}
async function complete(f: ReturnType<typeof fixture>, owned: CodexOwnedExecution) {
  await f.control({ messages: [terminal], respond: "turn" });
  await owned.execute();
  const cleanup = f.track(owned.cleanup());
  await f.eof();
  await assert.rejects(connection(owned).request("unrelated", "turn/start", {}), /sealed/);
  await assert.rejects(connection(owned).withThread("unrelated", "native", async () => {}), /sealed/);
  await f.control({ release: true });
  return cleanup;
}

test("owned native preparation, exact binding latch and single-use promises precede the only task", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const bind = f.gate<CodexOwnedSession>(); const binding = f.gate<CodexOwnedSession>();
  const owned = f.owned({ ...f.options, bindSession: (s) => { binding.resolve(s); return bind.promise; } });
  const prepared = f.track(owned.prepare()); assert.equal(owned.prepare(), prepared);
  const session = await prepared;
  assert.equal(session.threadId, "native"); assert.ok(Object.isFrozen(session)); assert.ok(Object.isFrozen(session.token));
  assert.deepEqual(f.wire().filter((m) => m.method).map((m) => m.method), ["initialize", "initialized", "thread/start"]);
  const run = f.track(owned.execute()); assert.equal(owned.execute(), run);
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
  assert.equal(getEventListeners(f.signal.signal, "abort").length, 0);
});

for (const mismatch of [false, true]) test(`owned binding ${mismatch ? "identity mismatch" : "rejection"} sends zero tasks`, { timeout: 10000 }, async (t) => {
  const f = fixture(t); const owned = f.owned({ ...f.options,
    bindSession: async (s) => { if (!mismatch) throw new Error("persist failed"); return { ...s, threadId: "other" }; },
  });
  await assert.rejects(owned.execute(), /binding/);
  const cleanup = f.track(owned.cleanup()); await f.eof(); assert.equal(f.count("turn/start"), 0);
  await f.control({ release: true }); const result = await cleanup;
  assert.equal(result.turnTerminal.status, "not-applicable");
  if (!mismatch) assert.equal(result.executionDrain.status, "failed");
});

test("owned cancellation during binding wakes execute but retains original binding responsibility", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const bind = f.gate<CodexOwnedSession>(); const entered = f.gate<CodexOwnedSession>();
  const owned = f.owned({ ...f.options, bindSession: (s) => { entered.resolve(s); return bind.promise; } });
  const rejected = assert.rejects(owned.execute(), { name: "AbortError" }); const session = await entered.promise;
  f.signal.abort(); await rejected; let done = false;
  const cleanup = f.track(owned.cleanup()).then((r) => { done = true; return r; });
  await f.eof(); await f.control({ release: true }); await connection(owned).observeProcessTermination(); await immediate();
  assert.equal(done, false); assert.equal(f.count("turn/start"), 0);
  bind.resolve(session); assert.equal((await cleanup).turnTerminal.status, "not-applicable");
});

test("owned terminal before original start response does not seal or lose the late response", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const owned = f.owned(f.options); const run = f.track(owned.execute()); await f.started.promise;
  await f.control({ messages: [terminal] }); await run;
  let cleaned = false; const cleanup = f.track(owned.cleanup()).then((r) => { cleaned = true; return r; });
  await immediate(); assert.equal(fs.existsSync(path.join(f.root, "stdin-eof")), false); assert.equal(cleaned, false);
  await f.control({ respond: "turn" }); assert.equal((await owned.observation.turnTerminal).status, "confirmed");
  await f.eof(); await f.control({ release: true }); assert.equal((await cleanup).executionDrain.status, "confirmed");
});

test("owned final-answer fallback cannot close before real terminal and response", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const owned = f.owned(f.options); const run = f.track(owned.execute()); await f.started.promise;
  await f.control({ messages: [{ method: "item/completed", params: { threadId: "native", turnId: "turn",
    item: { id: "answer", type: "agent_message", phase: "final_answer", text: "fixed answer" } } }] });
  await run; const cleanup = f.track(owned.cleanup()); await immediate();
  assert.equal(fs.existsSync(path.join(f.root, "stdin-eof")), false); assert.deepEqual(f.visible, ["fixed answer"]);
  await f.control({ messages: [terminal], respond: "turn" }); await f.eof(); await f.control({ release: true });
  assert.equal((await cleanup).executionDrain.status, "confirmed"); assert.deepEqual(f.visible, ["fixed answer"]);
});

test("owned async callback and cancelled original server handler remain drain responsibilities", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const callback = f.gate(); const handler = f.gate(); const entered = f.gate(); const delta = f.gate();
  const owned = f.owned({ ...f.options, handlers: { ...f.options.handlers,
    onAssistantDelta: () => { delta.resolve(); return callback.promise; },
    onRequest: async () => { entered.resolve(); await handler.promise; return { result: {} }; },
  } });
  const run = f.track(owned.execute()); await f.started.promise;
  await f.control({ respond: "turn", messages: [
    { id: "approval", method: "item/commandExecution/requestApproval", params: { threadId: "native", turnId: "turn" } },
    { method: "item/agentMessage/delta", params: { threadId: "native", turnId: "turn", itemId: "a", delta: "hello" } },
  ] }); await entered.promise; await delta.promise;
  await f.control({ messages: [terminal] }); await run;
  let done = false; const cleanup = f.track(owned.cleanup()).then((r) => { done = true; return r; }); await immediate();
  assert.equal(fs.existsSync(path.join(f.root, "stdin-eof")), false, "cancel reply cannot erase original handler");
  handler.resolve(); await f.eof(); await f.control({ release: true }); await connection(owned).observeProcessTermination(); await immediate();
  assert.equal(done, false, "callback promise remains after process close");
  callback.resolve(); assert.equal((await cleanup).executionDrain.status, "confirmed");
  assert.ok(f.wire().some((m) => m.id === "approval" && (m.result || m.error)));
});

test("owned real child exit before inherited pipe close waits and consumes the actual tail", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { holdExit: true }); const owned = f.owned(f.options);
  const run = f.track(owned.execute()); await f.started.promise; await f.control({ messages: [terminal], respond: "turn" }); await run;
  const child = (connection(owned) as unknown as { child: import("child_process").ChildProcess }).child;
  let done = false; const cleanup = f.track(owned.cleanup()).then((r) => { done = true; return r; });
  await f.waitCondition(() => child.exitCode !== null, "real child exit");
  await f.waitFile(path.join(f.root, "pipe-ready")); assert.equal(done, false); assert.equal(child.exitCode, 0);
  fs.writeFileSync(path.join(f.root, "release-pipe"), "ok"); await f.tail.promise;
  const result = await cleanup; assert.equal(result.streams.status, "confirmed"); assert.equal(result.executionDrain.status, "confirmed");
});

for (const error of [false, true]) test(`owned ${error ? "stream error" : "early stdout destroy"} never upgrades drain`, { timeout: 10000 }, async (t) => {
  const f = fixture(t); const owned = f.owned(f.options); const run = f.track(owned.execute()); await f.started.promise;
  await f.control({ messages: [terminal], respond: "turn" }); await run;
  const child = (connection(owned) as unknown as { child: import("child_process").ChildProcess }).child;
  child.stdout!.destroy(error ? new Error("controlled-stream-error") : undefined);
  const cleanup = f.track(owned.cleanup());
  // Destruction is not EOF evidence. End the fixture through its own control.
  await f.control({ exit: true }); const result = await cleanup;
  assert.notEqual(result.streams.status, "confirmed"); assert.notEqual(result.executionDrain.status, "confirmed");
});

test("owned pre-abort and invalid native resume identity never dispatch tasks", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { badThread: true });
  const owned = f.owned({ ...f.options, runner: { ...f.options.runner, threadId: "expected" } });
  await assert.rejects(owned.execute(), /identity/); const cleanup = f.track(owned.cleanup()); await f.eof();
  assert.equal(f.count("turn/start"), 0); await f.control({ release: true }); await cleanup;
  const signal = new AbortController(); signal.abort();
  const aborted = f.owned({ ...f.options, signal: signal.signal });
  await assert.rejects(aborted.execute(), { name: "AbortError" });
  assert.equal((await aborted.cleanup()).processTerminal.status, "unobservable");
});

test("owned seal does not close ordinary shared peers or upgrade their observation", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const shared = f.runner(f.options.runner);
  const sharedObservation = shared.createExecutionObservation();
  const sharedRun = shared.runStreamed("peer", f.options.handlers, sharedObservation);
  await f.waitMethod("turn/start");
  const internal = shared as unknown as { connection: CodexAppServerConnection };
  const connectionBefore = internal.connection;
  // Independent owned lifecycle with its own fixture; the ordinary shared reader stays alive.
  const ownFixture = fixture(t); const owned = ownFixture.owned(ownFixture.options);
  const run = ownFixture.track(owned.execute()); await ownFixture.started.promise; await complete(ownFixture, owned); await run;
  assert.equal(connectionBefore.isAlive(), true);
  await f.control({ messages: [terminal], respond: "turn" }); await sharedRun;
  const result = await sharedObservation.cleanup();
  assert.equal(result.executionDrain.status, "unobservable"); assert.equal(result.streams.status, "unobservable");
  shared.dispose(); await connectionBefore.observeProcessTermination();
});

test("owned abort during native preparation wakes waiting caller without sending a task", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { holdThread: true }); const owned = f.owned(f.options);
  const prep = f.track(owned.prepare()); const rejected = assert.rejects(prep, { name: "AbortError" });
  // A real native request is the gate; response is deliberately held.
  await f.waitMethod("thread/start");
  f.signal.abort(); await rejected;
  const cleanup = f.track(owned.cleanup()); await f.eof(); assert.equal(f.count("turn/start"), 0);
  await f.control({ thread: "native", release: true });
  const result = await cleanup; assert.equal(result.turnTerminal.status, "not-applicable");
});

test("owned cancel while cleanup waits for native terminal closes only its source and preserves missing terminal", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const owned = f.owned(f.options); const run = f.track(owned.execute());
  const rejected = assert.rejects(run, { name: "AbortError" }); await f.started.promise;
  // Cleanup has sealed admission but must remain cancellable.
  const cleanup = f.track(owned.cleanup()); f.signal.abort(); await rejected;
  await f.eof(); await f.control({ respond: "turn", release: true });
  const result = await cleanup; assert.equal(result.turnTerminal.status, "unobservable");
  assert.equal(result.executionDrain.status, "confirmed", "transport drain is separate from missing turn terminal");
  assert.equal(f.count("turn/start"), 1);
});

test("owned rejected callback is consumed and reported failed after otherwise natural source drain", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const owned = f.owned({ ...f.options, handlers: { ...f.options.handlers,
    onAssistantDelta: async () => { throw new Error("callback rejected"); },
  } });
  const run = f.track(owned.execute()); await f.started.promise;
  await f.control({ messages: [{ method: "item/agentMessage/delta", params: {
    threadId: "native", turnId: "turn", itemId: "a", delta: "hello",
  } }], respond: "turn" });
  const result = await complete(f, owned); await run;
  assert.equal(result.streams.status, "confirmed"); assert.equal(result.executionDrain.status, "failed");
});

test("owned prepared session refuses forced handoff by another connection during binding", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const owned = f.owned(f.options); await owned.prepare();
  const peer = f.runner({ ...f.options.runner, threadId: "native" });
  await assert.rejects(peer.runStreamed("must not send", f.options.handlers), /专属执行|交接/);
  const peerConnection = (peer as unknown as { connection: CodexAppServerConnection }).connection;
  peer.dispose(); await peerConnection.observeProcessTermination();
  assert.equal(connection(owned).isAlive(), true); assert.equal(f.count("turn/start"), 0);
  assert.equal(f.count("thread/resume"), 0);
  const cleanup = f.track(owned.cleanup()); await f.eof(); await f.control({ release: true });
  assert.equal((await cleanup).executionDrain.status, "confirmed");
});

test("owned callback admission stays bounded and overflow can never become successful drain", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const gate = f.gate(); let callbacks = 0;
  const owned = f.owned({ ...f.options, handlers: { ...f.options.handlers,
    onAssistantDelta: () => { callbacks++; return gate.promise; },
  } });
  const run = f.track(owned.execute()); await f.started.promise;
  await f.control({ respond: "turn", messages: Array.from({ length: 70 }, (_, i) => ({
    method: "item/agentMessage/delta", params: { threadId: "native", turnId: "turn", itemId: String(i), delta: "x" },
  })) });
  // A terminal is an actual reader ordering barrier after every delta above.
  await f.control({ messages: [terminal] }); await run;
  assert.ok(callbacks > 0 && callbacks <= 64);
  gate.resolve(); const cleanup = f.track(owned.cleanup()); await f.eof(); await f.control({ release: true });
  assert.equal((await cleanup).executionDrain.status, "failed");
});


for (const phase of ["before", "after"] as const) {
  for (const resume of [false, true]) test(`owned ${phase}-readiness notification cannot replace raw ${resume ? "resume" : "start"} credential`,
    { timeout: 10000 }, async (t) => {
      const f = fixture(t, { holdThread: true, earlyPhase: phase, earlyThread: resume ? "native" : "decoy" });
      const binding = f.gate<CodexOwnedSession>(); const bind = f.gate<CodexOwnedSession>();
      const owned = f.owned({ ...f.options,
        runner: { ...f.options.runner, threadId: resume ? "native" : null },
        bindSession: (session) => { binding.resolve(session); return bind.promise; },
      });
      let prepared = false; const prep = f.track(owned.prepare().then((s) => { prepared = true; return s; }));
      await f.waitMethod(resume ? "thread/resume" : "thread/start");
      await f.barrier();
      assert.deepEqual(f.wire().filter((m) => m.method).slice(0, 3).map((m) => m.method),
        ["initialize", "initialized", resume ? "thread/resume" : "thread/start"]);
      assert.equal(f.sent().filter((m) => m.method === "thread/started").length, 1, "fake actually sent the early notification");
      assert.equal(prepared, false, "loaded notification is not a response credential");
      assert.equal(f.count("turn/start"), 0);
      const raw = f.wire().find((m) => m.method === (resume ? "thread/resume" : "thread/start"))!;
      if (resume) assert.equal(raw.params.threadId, "native");
      else assert.equal(f.count("thread/resume"), 0, "decoy cannot turn a new request into resume");
      assert.equal(f.notifications.length, 0, "unknown explicit thread cannot reach the sole listener");
      const transport = connection(owned) as any;
      assert.equal(transport.threadOwners.has(resume ? "native" : "decoy"), false);
      assert.equal(transport.buffered.get(resume ? "native" : "decoy").length, 1);
      if (!resume) {
        await f.control({ messages: [{ method: "thread/started", params: { thread: { id: "native" } } }] });
        await f.barrier();
        assert.equal(f.notifications.length, 0, "matching native notification still needs the raw response");
      }
      await f.control({ thread: "native" }); const session = await prep;
      assert.equal(session.threadId, "native"); assert.equal(session.connectionId, connection(owned).id);
      const replay = f.notifications.filter(({ message }) => message.method === "thread/started");
      assert.equal(replay.length, 1); assert.equal((replay[0].message.params as any).thread.id, "native");
      assert.equal(replay[0].source.buffered, true); assert.equal(replay[0].source.ownedThread, true);
      assert.equal(replay[0].source.connectionId, session.connectionId);
      assert.equal(replay[0].source.listener.id, session.token.runnerId);
      if (!resume) {
        assert.equal(transport.threadOwners.has("decoy"), false);
        assert.equal(transport.buffered.get("decoy")[0].params.thread.id, "decoy", "decoy is never relabelled native");
      }
      const run = f.track(owned.execute());
      assert.equal(await binding.promise, session); assert.equal(f.count("turn/start"), 0);
      bind.resolve(session); await f.started.promise;
      assert.equal(f.count("turn/start"), 1);
      assert.equal(f.wire().find((m) => m.method === "turn/start")!.params.threadId, "native");
      const result = await complete(f, owned); await run;
      assert.equal(result.processTerminal.status, "confirmed"); assert.equal(result.streams.status, "confirmed");
      assert.equal(result.turnTerminal.status, "confirmed");
      if (resume) assert.equal(result.executionDrain.status, "confirmed");
      else assert.deepEqual(result.executionDrain, { status: "unobservable", reason: "owned-unrouted-messages-at-close" });
      assert.equal(f.count("turn/start"), 1);
      assert.equal(f.count(resume ? "thread/resume" : "thread/start"), 1, "execute reuses raw credential");
      assert.equal(f.count(resume ? "thread/start" : "thread/resume"), 0);
    });

  for (const conflict of [false, true]) test(`owned ${phase}-readiness notification cannot hide ${conflict ? "conflicting resume" : "missing start"} response`,
    { timeout: 10000 }, async (t) => {
      const f = fixture(t, { holdThread: true, earlyPhase: phase, earlyThread: "native" });
      const owned = f.owned({ ...f.options, runner: { ...f.options.runner, threadId: conflict ? "native" : null } });
      const run = f.track(owned.execute()); const rejected = assert.rejects(run, /identity/);
      await f.waitMethod(conflict ? "thread/resume" : "thread/start");
      await f.barrier();
      assert.equal(f.notifications.length, 0); assert.equal(f.count("turn/start"), 0);
      assert.equal((owned as any).runner.ownedThreadCredential, undefined);
      await f.control({ threadResult: conflict ? { thread: { id: "conflict" } } : {} }); await rejected;
      const cleanup = f.track(owned.cleanup()); await f.eof(); assert.equal(f.count("turn/start"), 0);
      await f.control({ release: true }); const result = await cleanup;
      assert.equal(result.turnTerminal.status, "not-applicable");
      assert.equal(result.processTerminal.status, "confirmed"); assert.equal(result.streams.status, "confirmed");
      assert.equal(result.executionDrain.status, "unobservable", "unclaimed native notification prevents successful drain");
      assert.equal((owned as any).runner.ownedThreadCredential, undefined);
    });
}

test("owned notification during cancelled preparation cannot revive a late raw credential", { timeout: 10000 }, async (t) => {
  const f = fixture(t, { holdThread: true, earlyPhase: "before", earlyThread: "native" });
  let bindings = 0;
  const owned = f.owned({ ...f.options, bindSession: async (session) => { bindings++; return session; } });
  const run = f.track(owned.execute());
  const rejected = assert.rejects(run, { name: "AbortError" }); await f.waitMethod("thread/start");
  await f.barrier(); assert.equal(f.notifications.length, 0); assert.equal(bindings, 0);
  assert.equal((owned as any).runner.ownedThreadCredential, undefined); assert.equal(f.count("turn/start"), 0);
  f.signal.abort(); await rejected;
  const cleanup = f.track(owned.cleanup()); await f.eof(); await f.control({ thread: "native", release: true });
  const result = await cleanup;
  assert.equal(result.turnTerminal.status, "not-applicable"); assert.equal(f.count("turn/start"), 0); assert.equal(bindings, 0);
  assert.equal(result.processTerminal.status, "confirmed"); assert.equal(result.streams.status, "confirmed");
  assert.equal(result.executionDrain.status, "confirmed", "late raw response was consumed through natural EOF");
  assert.ok(f.sent().some((m) => m.id === f.wire().find((r) => r.method === "thread/start")!.id && m.result?.thread?.id === "native"));
  assert.equal((owned as any).runner.ownedThreadCredential, undefined);
});

test("owned truncated unclaimed notifications stay unobservable after claim and natural EOF", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const binding = f.gate<CodexOwnedSession>(); const bound = f.gate<CodexOwnedSession>();
  const barrier = f.gate(); const received: number[] = [];
  const owned = f.owned({ ...f.options,
    bindSession: (s) => { bound.resolve(s); return binding.promise; },
    handlers: { ...f.options.handlers, onNotification: (m, source) => {
      f.options.handlers.onNotification?.(m, source);
      if (m.method === "fixture/buffered") { assert.equal(source.buffered, true); received.push((m.params as any).index); }
      if (m.method === "fixture/barrier") barrier.resolve();
    } },
  });
  const run = f.track(owned.execute()); await bound.promise;
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
  assert.deepEqual(result.executionDrain, { status: "unobservable", reason: "owned-unrouted-messages-truncated" });
});

test("shared repeated cancelled handlers retain no owned drain tasks and still accept later requests", { timeout: 10000 }, async (t) => {
  const f = fixture(t); const pending: ReturnType<typeof deferred<{ result: {} }>>[] = [];
  let waveEntered = f.gate();
  const shared = f.runner(f.options.runner);
  const run = shared.runStreamed("shared task", { ...f.options.handlers,
    onRequest: () => {
      const gate = f.gate<{ result: {} }>(); pending.push(gate);
      if (pending.length % 24 === 0) waveEntered.resolve();
      return gate.promise;
    },
  });
  await f.waitMethod("turn/start");
  const conn = (shared as any).connection as CodexAppServerConnection; const internal = conn as any;
  const owner = (shared as any).listenerId as string;
  for (let wave = 0; wave < 3; wave++) {
    waveEntered = f.gate();
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
  shared.dispose(); await conn.observeProcessTermination();
});
