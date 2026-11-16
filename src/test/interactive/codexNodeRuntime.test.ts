import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getEventListeners } from "events";
import type { CodexInteractiveRunner, CodexStreamHandlers } from "../../interactive/codexRunnerCore";
import type { CodexAppServerConnection, CodexAppServerListener, CodexAppServerNotificationSource } from "../../interactive/codexAppServerPoolCore";
import type { CodexRuntimePorts } from "../../interactive/codexRuntimePorts";

// This file deliberately never installs vscodeMock or replaces Module._load.
assert.throws(() => require.resolve("vscode"), { code: "MODULE_NOT_FOUND" });
const { CodexInteractiveRunner: Runner } = require("../../interactive/codexRunnerCore") as typeof import("../../interactive/codexRunnerCore");
const execute = promisify(execFile);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// An executable fixture, not a spawn replacement. --version uses the real isolated
// probe; app-server requests and controls travel on the real ordered NDJSON pipe.
const SERVER = String.raw`
const fs=require("fs");
if(process.argv.includes("--version")){
 fs.appendFileSync(PROBE_RECORD,JSON.stringify({env:process.env,cwd:process.cwd(),args:process.argv.slice(2)})+"\n");
 console.log("codex-cli 0.167.0");
}else{
 const starts=new Map();const waiting=[];let serial=0;
 const send=m=>process.stdout.write(JSON.stringify(m)+"\n");
 require("readline").createInterface({input:process.stdin}).on("line",line=>{
  const m=JSON.parse(line);if(!m.method)return;
  if(m.method==="initialize")send({id:m.id,result:{}});
  else if(m.method==="thread/start"||m.method==="thread/resume")send({id:m.id,result:{thread:{id:m.params.threadId||"primary"}}});
  else if(m.method==="turn/start"){
   starts.set(m.params.threadId,m.id);serial++;
   send({method:"fixture/started",params:{threadId:m.params.threadId}});
   for(const w of waiting.splice(0))send({id:w.id,result:{serial}});
  }else if(m.method==="fixture/waitStart"){
   if(serial>=m.params.count)send({id:m.id,result:{serial}});else waiting.push(m);
  }else if(m.method==="fixture/control"){
   const p=m.params;
   for(const n of p.before||[])send(n);
   if(p.respond)send({id:starts.get(p.threadId||"primary"),result:{turn:{id:p.respond,status:"inProgress"}}});
   for(const n of p.after||[])send(n);
   send({id:m.id,result:{serial,pid:process.pid,cwd:process.cwd(),env:process.env,args:process.argv.slice(2)}});
  }else if(m.id!==undefined)send({id:m.id,result:m.method==="thread/unsubscribe"?{status:"notLoaded"}:{}});
 });
}`;

type InternalRunner = {
  connection: CodexAppServerConnection;
  listener: CodexAppServerListener;
  runtime: CodexRuntimePorts;
  operationCancellation: AbortController;
  observationWaiters: Set<unknown>;
};
function internal(runner: CodexInteractiveRunner): InternalRunner { return runner as unknown as InternalRunner; }
function notification(method: string, turnId: string, threadId = "primary", extra: Record<string, unknown> = {}) {
  return { method, params: { threadId, turnId, turn: { id: turnId, status: "completed" }, ...extra } };
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex node runtime "));
  const script = path.join(root, "fixture.cjs");
  const probeRecord = path.join(root, "probe.jsonl");
  const source = `const PROBE_RECORD=${JSON.stringify(probeRecord)};\n${SERVER}`;
  fs.writeFileSync(script, source);
  const command = path.join(root, process.platform === "win32" ? "fixture.cmd" : "fixture");
  fs.writeFileSync(command, process.platform === "win32"
    ? `@"${process.execPath}" "${script}" %*\r\n`
    : `#!/usr/bin/env node\n${source}`);
  fs.chmodSync(command, 0o755);
  const logs: string[] = [];
  const runtime: { -readonly [K in keyof CodexRuntimePorts]: CodexRuntimePorts[K] } = {
    macTaskShell: "bash", logInfo: (message) => { logs.push(message); }, logError: (message) => { logs.push(message); },
  };
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT,
    HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, ".codex"), PWD: root,
    OPENAI_API_KEY: "fixture-sentinel", npm_config_prefix: "fixture-removed" };
  const options = { command, args: [], cwd: root, thinkingMode: "medium" as const,
    interactiveMode: "coding" as const, threadId: "primary", env };
  const runners: CodexInteractiveRunner[] = [];
  const started = new Map<CodexInteractiveRunner, ReturnType<typeof deferred<void>>>();
  const visible: string[] = [];
  const make = (threadId = "primary") => {
    const runner = new Runner({ ...options, threadId }, runtime);
    const gate = deferred<void>(); started.set(runner, gate);
    const listener = internal(runner).listener;
    const dispatch = listener.handleNotification;
    listener.handleNotification = (message, source) => {
      if (message.method === "fixture/started") gate.resolve();
      dispatch(message, source);
    };
    runners.push(runner); return runner;
  };
  const runner = make();
  const sources: CodexAppServerNotificationSource[] = [];
  const listener = internal(runner).listener;
  const handle = listener.handleNotification;
  listener.handleNotification = (message, source) => { sources.push(source); handle(message, source); };
  const handlers: CodexStreamHandlers = {
    onAssistantDelta: (chunk) => { visible.push(chunk); }, onTrace: () => {}, onTaskListUpdate: () => {},
    onThreadId: () => {},
  };
  type State = { pid: number; serial: number; cwd: string; env: NodeJS.ProcessEnv; args: string[] };
  return { root, command, runtime, runner, make, handlers, logs, visible, sources,
    start: async () => { await started.get(runner)!.promise; await internal(runner).connection.request("fixture", "fixture/waitStart", { count: 1 }); },
    waitStart: async (target: CodexInteractiveRunner, count: number) => {
      await started.get(target)!.promise;
      return internal(target).connection.request("fixture", "fixture/waitStart", { count });
    },
    control: (params: Record<string, unknown>, target = runner) => internal(target).connection.request<State>("fixture", "fixture/control", params),
    probes: () => fs.readFileSync(probeRecord, "utf8").trim().split("\n").map((s) => JSON.parse(s) as State),
    close: async () => {
      const connections = new Set(runners.map((r) => internal(r).connection).filter(Boolean));
      for (const r of runners) r.dispose();
      await Promise.all([...connections].map((c) => c.observeProcessTermination()));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("fresh ordinary Node loads the full core graph with no vscode module or host configuration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-node-load-"));
  try {
    const source = String.raw`
const assert=require("assert/strict"),path=require("path");
assert.throws(()=>require.resolve("vscode"),{code:"MODULE_NOT_FOUND"});
const entries=["codexRunnerCore","codexAppServerPoolCore","codexRunnerProcessCore","codexAppServerCapabilitiesCore"];
const seen=new Set();function walk(m){if(seen.has(m.filename))return;seen.add(m.filename);m.children.forEach(walk);}
for(const name of entries){const id=require.resolve(path.join(process.argv[1],name));require(id);walk(require.cache[id]);}
const forbidden=/[/\\](?:vscodeMock|logger|toolSettings|historyRetention|commandRunner|config|codexRuntimeHost)\.js$/;
assert.deepEqual([...seen].filter(f=>forbidden.test(f)),[]);
console.log(JSON.stringify({loaded:seen.size,entries}));`;
    const result = await execute(process.execPath, ["-e", source, path.resolve(__dirname, "../../interactive")], {
      cwd: root, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, USERPROFILE: root },
    });
    const evidence = JSON.parse(result.stdout) as { loaded: number; entries: string[] };
    assert.ok(evidence.loaded > 20, "checks the actual transitive runtime graph");
    assert.equal(evidence.entries.length, 4);
    assert.equal(result.stderr, "");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Node core requires explicit ports and snapshots shell and logging before launch/probe", { timeout: 10000 }, async () => {
  const f = fixture();
  try {
    assert.throws(() => new Runner({ command: f.command, args: [], thinkingMode: "medium", interactiveMode: "coding", threadId: null }, undefined as never), /Explicit Codex/u);
    const snapshot = internal(f.runner).runtime;
    assert.ok(Object.isFrozen(snapshot));
    f.runtime.macTaskShell = "zsh";
    f.runtime.logInfo = () => { assert.fail("mutable caller port was reread"); };
    assert.equal(snapshot.macTaskShell, "bash");
    const run = f.runner.runStreamed("fixed", f.handlers);
    await f.start();
    const state = await f.control({ respond: "real", after: [notification("turn/completed", "real")] });
    await run;
    assert.equal(fs.realpathSync(state.cwd), fs.realpathSync(f.root));
    assert.equal(state.env.PWD, f.root);
    assert.equal(state.env.OPENAI_API_KEY, "fixture-sentinel", "base runtime env remains explicit");
    assert.equal(state.env.npm_config_prefix, undefined);
    assert.equal(state.env.CODEX_HOME, path.join(f.root, ".codex"));
    assert.ok(state.args.includes("thread_unload_delay_secs=0"));
    const probe = f.probes()[0];
    assert.notEqual(probe.cwd, f.root);
    assert.equal(path.join(fs.realpathSync(path.dirname(probe.env.HOME!)), path.basename(probe.env.HOME!)), probe.cwd);
    assert.equal(probe.env.CODEX_HOME, probe.env.HOME);
    assert.equal(probe.env.OPENAI_API_KEY, undefined);
    assert.equal(probe.env.PWD, undefined);
    assert.deepEqual(probe.args, ["--version"]);
    assert.equal(fs.existsSync(probe.cwd), false, "probe cleanup waited for real close");
    assert.ok(f.logs.includes("codex-app-server-started"));
    const processCore = require("../../interactive/codexRunnerProcessCore") as typeof import("../../interactive/codexRunnerProcessCore");
    if (process.platform === "darwin") {
      const resolved = processCore.resolveSpawnCommand("absent-codex-'quoted'-node-fixture", ["space arg"], snapshot);
      assert.equal(resolved.command, "/bin/bash");
      assert.equal(resolved.usesShell, true);
      assert.ok(resolved.args[1].includes("'\"'\"'"));
    }
  } finally { await f.close(); }
});

test("Node observation reconciles terminal before late response and preserves live shared peer", { timeout: 10000 }, async () => {
  const f = fixture();
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixed", f.handlers, observation);
    await f.start();
    const peer = f.make("peer");
    const peerRun = peer.runStreamed("peer", f.handlers);
    await f.waitStart(peer, 2);
    await f.control({ threadId: "peer", respond: "peer-real" }, peer);
    assert.equal(internal(peer).connection, internal(f.runner).connection, "one pool, no role context partition");
    let terminal = false;
    void observation.turnTerminal.then(() => { terminal = true; });
    await f.control({ before: [notification("turn/completed", "real", "peer"), notification("turn/completed", "real", "child")] });
    assert.equal(terminal, false);
    await f.control({ before: [notification("turn/completed", "real")] });
    await run;
    assert.equal(terminal, false, "identity still awaits original start response");
    await f.control({ respond: "real" });
    assert.equal((await observation.turnTerminal).status, "confirmed");
    assert.ok(f.sources.length > 0);
    for (const source of f.sources) {
      assert.ok(Object.isFrozen(source));
      assert.equal(source.connectionId, internal(f.runner).connection.id);
      assert.equal(source.listener, internal(f.runner).listener);
      assert.equal(source.buffered, false);
    }
    const primary = f.sources.filter((s) => s.ownedThread);
    assert.ok(primary.length > 0);
    assert.ok(primary.every((s, i) => !i || s.sequence > primary[i - 1].sequence));
    const before = await f.control({}, peer);
    const cleanupPromise = observation.cleanup();
    assert.equal(observation.cleanup(), cleanupPromise);
    const cleanup = await cleanupPromise;
    assert.equal(cleanup.business.status, "confirmed");
    assert.equal(cleanup.runner.status, "confirmed", JSON.stringify(cleanup));
    assert.equal(cleanup.executionDrain.status, "unobservable");
    assert.equal(cleanup.streams.status, "unobservable");
    assert.equal((await f.control({}, peer)).pid, before.pid);
    await f.control({ threadId: "peer", after: [notification("turn/completed", "peer-real", "peer")] }, peer);
    await peerRun;
    assert.deepEqual(f.visible, []);
  } finally { await f.close(); }
});

test("Node final-answer fallback keeps independent original response reconciliation", { timeout: 10000 }, async () => {
  const f = fixture();
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixed", f.handlers, observation);
    await f.start();
    await f.control({ before: [notification("item/completed", "real", "primary", {
      item: { id: "answer", type: "agent_message", phase: "final_answer", text: "fixed answer" },
    })] });
    await run;
    let terminal = false;
    void observation.turnTerminal.then(() => { terminal = true; });
    await f.control({ before: [notification("turn/completed", "wrong")] });
    assert.equal(terminal, false);
    await f.control({ respond: "real", after: [notification("turn/completed", "real")] });
    assert.equal((await observation.turnTerminal).status, "confirmed");
    assert.deepEqual(f.visible, ["fixed answer"]);
    assert.equal((await observation.cleanup()).executionDrain.status, "unobservable");
  } finally { await f.close(); }
});

test("Node cancellation wakes native-evidence queue without losing original late response", { timeout: 10000 }, async () => {
  const f = fixture();
  const observation = f.runner.createExecutionObservation();
  try {
    const run = f.runner.runStreamed("fixed", f.handlers, observation);
    const rejected = assert.rejects(run, { name: "AbortError" });
    await f.start();
    f.runner.stopAndRebuild();
    await rejected;
    const queued = f.runner.runStreamed("wait for native terminal", f.handlers);
    const rejectedQueue = assert.rejects(queued, { name: "AbortError" });
    await f.control({}); // actual wire barrier after queue entered the observation gate
    assert.equal(internal(f.runner).observationWaiters.size, 1);
    const signal = internal(f.runner).operationCancellation.signal;
    f.runner.stopAndRebuild();
    await rejectedQueue;
    assert.equal(getEventListeners(signal, "abort").length, 0);
    assert.equal(internal(f.runner).observationWaiters.size, 0);
    let terminal = false;
    void observation.turnTerminal.then(() => { terminal = true; });
    await f.control({ before: [notification("turn/completed", "real", "primary", { turn: { id: "real", status: "interrupted" } })] });
    assert.equal(terminal, false);
    await f.control({ respond: "real" });
    assert.deepEqual(await observation.turnTerminal, { status: "confirmed", evidence: "native-turn-completed:interrupted" });
    assert.equal((await observation.cleanup()).executionDrain.status, "unobservable");
    assert.deepEqual(f.visible, []);
  } finally { await f.close(); }
});
