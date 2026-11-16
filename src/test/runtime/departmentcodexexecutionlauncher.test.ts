import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fork, execFile } from "child_process";
import { randomUUID } from "crypto";
import { setImmediate as immediate } from "timers/promises";
import { createDepartmentCodexExecutionLauncher } from "../../runtime/departmentcodexexecutionlauncher";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { DepartmentExecutionReceiptStore } from "../../runtime/departmentexecutionreceiptstore";
import { fixturePreparation, waitFile, waitCondition, mark } from "./fixtures/departmentcodexownerworker";

assert.throws(() => require.resolve("vscode"), { code: "MODULE_NOT_FOUND" });
const worker = path.join(__dirname, "fixtures", "departmentcodexownerworker.js");
const selection: DepartmentExecutionSelection = { version: 1, cli: "codex", role: "employee", configId: "fixture-config",
  revision: "fixture-v1", model: null, thinkingMode: "medium", openCodeVariant: null };
function identity(bound = false): DepartmentExecutionIdentity {
  return { version: 1, workspace: "fixture-workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    role: "employee", subtaskId: "subtask", attemptId: "attempt", generation: 1, cli: "codex",
    ...fingerprintDepartmentExecutionSelection(selection), session: bound ? { state: "bound", id: "native" } : { state: "unbound" },
    ownerId: "codex-fixture-owner", executionId: randomUUID() };
}
const terminal = { method: "turn/completed", params: { threadId: "native", turn: { id: "turn", status: "completed" } } };
function fixture(t: test.TestContext, bound = false, bad = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-codex-launcher-"));
  const value = identity(bound), input = fixturePreparation(directory, value, selection, { bad });
  let serial = 0;
  const file = (name: string): string => path.join(directory, name);
  const wire = (): any[] => fs.existsSync(file("wire.jsonl"))
    ? fs.readFileSync(file("wire.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  const control = async (data: Record<string, unknown>) => {
    const name = `control-${++serial}.json`, tmp = file(name + ".tmp");
    fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file(name));
    if (!data.exit) await waitFile(file(name + ".ack"));
  };
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, value, ...input, file, wire, control,
    wait: (name: string) => waitFile(file(name)), mark: (name: string) => mark(directory, name),
    count: (method: string) => wire().filter((m) => m.method === method).length };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function finish(f: ReturnType<typeof fixture>, handle: Awaited<ReturnType<ReturnType<typeof createDepartmentCodexExecutionLauncher>["launch"]>>) {
  await f.control({ response: "turn", messages: [terminal] });
  await f.wait("stdin-eof"); await f.control({ close: true }); return handle.completion;
}

for (const mode of ["identity", "fingerprint", "role", "cli", "extra-auth", "extra-body", "null-config", "intent", "runner-hidden", "prompt"] as const) {
  test(`trusted preparation rejects ${mode} without native spawn or resolver retry`, async (t) => {
    const f = fixture(t); let calls = 0;
    if (mode === "identity") f.prepared.identity.generation++;
    if (mode === "fingerprint") f.prepared.selection.revision = "changed";
    if (mode === "role") f.prepared.selection.role = "leader";
    if (mode === "cli") f.prepared.selection.cli = "claude";
    if (mode === "extra-auth") Object.assign(f.prepared.selection, { auth: { token: "fixture-only" } });
    if (mode === "extra-body") Object.assign(f.prepared, { configBody: "fixture-auth-body" });
    if (mode === "null-config") f.prepared.selection.configId = null;
    if (mode === "intent") f.prepared.session = { intent: "resume", threadId: "native" };
    if (mode === "runner-hidden") f.prepared.resources.runner = { owned: false };
    if (mode === "prompt") f.prepared.prompt = " ";
    const launcher = createDepartmentCodexExecutionLauncher(() => { calls++; return f.prepared; });
    assert.throws(() => launcher.requirements(f.value)); assert.throws(() => launcher.requirements(f.value));
    await assert.rejects(launcher.launch(f.value, async () => {}));
    assert.equal(calls, 1); assert.equal(f.wire().length, 0);
  });
}

test("launch requires reserved description; cache saturation and rejected entries never evict unknown executions", async (t) => {
  const f = fixture(t); let calls = 0;
  const launcher = createDepartmentCodexExecutionLauncher(() => { calls++; return null; });
  await assert.rejects(launcher.launch(f.value, async () => {})); assert.equal(calls, 0);
  for (let index = 0; index < 256; index++) assert.throws(() => launcher.requirements({ ...f.value, executionId: `execution-${index}` }));
  assert.throws(() => launcher.requirements(f.value), /capacity/); assert.equal(calls, 256);
  assert.throws(() => launcher.requirements({ ...f.value, executionId: "execution-0" }), /rejected/);
  assert.equal(calls, 256); assert.equal(f.wire().length, 0);
});

for (const bound of [false, true]) test(`${bound ? "resume" : "new"} raw session waits for both persistence confirmations and launches once from snapshot`, { timeout: 10000 }, async (t) => {
  const f = fixture(t, bound), persisted = deferred<any>(), owner = deferred<void>(), entered = deferred<any>(), ownerEntered = deferred<void>();
  let resolves = 0, releases = 0;
  f.prepared.confirmSession = (session) => { entered.resolve(session); return persisted.promise; };
  f.prepared.resources.runner = { owned: true, release: () => { releases++; return { status: "confirmed", evidence: "fixture-session-released" }; } };
  const launcher = createDepartmentCodexExecutionLauncher(() => { resolves++; return f.prepared; });
  const requirements = launcher.requirements(f.value);
  assert.deepEqual(requirements, { processTerminal: true, turnTerminal: true, streams: true, runner: true, executionRoot: false, links: false, temp: false, tab: false });
  f.prepared.prompt = "mutated"; f.prepared.runner.command = "invalid-after-snapshot";
  Object.assign(f.prepared.runtime, { macTaskShell: "zsh" }); f.prepared.confirmSession = async () => { throw new Error("changed"); };
  const bind = async (thread: string) => { assert.equal(thread, "native"); ownerEntered.resolve(); await owner.promise; };
  const one = launcher.launch(f.value, bind), two = launcher.launch(structuredClone(f.value), async () => { throw new Error("second-bind"); });
  assert.equal(one, two); const handle = await one; assert.equal(handle.kind, "both");
  const session = await entered.promise; assert.ok(Object.isFrozen(session)); assert.ok(Object.isFrozen(session.token));
  assert.equal(f.count("turn/start"), 0); assert.equal(f.count(bound ? "thread/resume" : "thread/start"), 1);
  persisted.resolve(session); await ownerEntered.promise; assert.equal(f.count("turn/start"), 0);
  owner.resolve(); await f.wait("task-started"); assert.equal(f.count("turn/start"), 1);
  assert.equal(f.wire().find((m) => m.method === "turn/start").params.input[0].text, "trusted fixture task");
  await assert.rejects(launcher.launch({ ...f.value, generation: 2 }, bind));
  const facts = await finish(f, handle); assert.equal(facts.processTerminal.status, "confirmed"); assert.equal(facts.turnTerminal.status, "confirmed"); assert.equal(facts.streams.status, "confirmed");
  assert.equal(releases, 0, "completion independent of resource cleanup");
  const cleanup = handle.cleanup(); assert.equal(cleanup, handle.cleanup()); assert.equal((await cleanup).runner.status, "confirmed");
  assert.equal(releases, 1); assert.equal(resolves, 1); assert.equal(f.count("turn/start"), 1);
});

for (const mode of ["persist-reject", "persist-conflict", "owner-reject", "cancel-binding", "resume-conflict", "pre-cancel"] as const) {
  test(`${mode} retains handle and sends zero tasks`, { timeout: 10000 }, async (t) => {
    const f = fixture(t, mode === "resume-conflict", mode === "resume-conflict");
    const entered = deferred<any>(), release = deferred<any>(); let ownerCalls = 0;
    f.prepared.confirmSession = async (session) => {
      entered.resolve(session);
      if (mode === "persist-reject") throw new Error("fixture-refused");
      if (mode === "persist-conflict") return { ...session };
      if (mode === "cancel-binding") return release.promise;
      return session;
    };
    if (mode === "pre-cancel") f.signal.abort();
    const launcher = createDepartmentCodexExecutionLauncher(() => f.prepared); launcher.requirements(f.value);
    const handle = await launcher.launch(f.value, async () => { ownerCalls++; if (mode === "owner-reject") throw new Error("fixture-owner-write-failed"); });
    if (mode === "cancel-binding") { const session = await entered.promise; f.signal.abort(); release.resolve(session); }
    if (mode !== "pre-cancel") { await f.wait("stdin-eof"); await f.control({ close: true }); }
    const facts = await handle.completion; assert.notEqual(facts.turnTerminal.status, "confirmed");
    assert.equal(f.count("turn/start"), 0); assert.equal(ownerCalls, mode === "owner-reject" ? 1 : 0);
    assert.equal(handle.cleanup(), handle.cleanup()); await handle.cleanup();
    assert.equal(await launcher.launch(f.value, async () => {}), handle);
  });
}

test("cancellation while Owner bind is pending prevents task but retains the original persistence responsibility", { timeout: 10000 }, async (t) => {
  const f = fixture(t), entered = deferred<void>(), owner = deferred<void>();
  const launcher = createDepartmentCodexExecutionLauncher(() => f.prepared); launcher.requirements(f.value);
  const handle = await launcher.launch(f.value, async () => { entered.resolve(); await owner.promise; });
  await entered.promise; f.signal.abort();
  await f.wait("stdin-eof"); await f.control({ close: true });
  let completed = false; void handle.completion.then(() => { completed = true; }); await immediate();
  assert.equal(completed, false); assert.equal(f.count("turn/start"), 0);
  owner.resolve(); assert.notEqual((await handle.completion).turnTerminal.status, "confirmed"); await handle.cleanup();
});

for (const fallback of [false, true]) test(`${fallback ? "final-answer fallback" : "terminal before start response"} cannot bypass independent terminal/response reconciliation`, { timeout: 10000 }, async (t) => {
  const f = fixture(t), business = deferred<void>(), visible = deferred<void>(); const output: string[] = [];
  f.prepared.handlers.onAssistantDelta = (chunk) => { output.push(chunk); visible.resolve(); };
  f.prepared.runtime = { ...f.prepared.runtime, logInfo: (message) => { if (message === "codex-final-answer-completion-fallback") business.resolve(); } };
  // This callback is the original runner's business terminal, not native observation proof.
  f.prepared.handlers.onTurnCompleted = () => { business.resolve(); };
  const launcher = createDepartmentCodexExecutionLauncher(() => f.prepared); launcher.requirements(f.value);
  const handle = await launcher.launch(f.value, async () => {}); await f.wait("task-started");
  let completed = false; void handle.completion.then(() => { completed = true; });
  if (fallback) {
    await f.control({ messages: [{ method: "item/completed", params: { threadId: "native", turnId: "turn",
      item: { id: "answer", type: "agent_message", phase: "final_answer", text: "fixed answer" } } }] });
    // The existing 1 s fallback is a business contract, never a cleanup success timer.
    // Observe the callback and the subsequent real turn notification to retain ordering.
    await visible.promise; await business.promise;
    assert.deepEqual(output, ["fixed answer"]);
  }
  await f.control({ messages: [terminal] }); await business.promise; await immediate();
  assert.equal(completed, false); assert.equal(fs.existsSync(f.file("stdin-eof")), false);
  await f.control({ response: "turn" }); await f.wait("stdin-eof");
  assert.equal(completed, false); await f.control({ close: true });
  const facts = await handle.completion; assert.equal(facts.turnTerminal.status, "confirmed"); assert.equal(facts.streams.status, "confirmed");
  assert.deepEqual(output, fallback ? ["fixed answer"] : []); await handle.cleanup();
});

for (const mode of ["missing", "throws", "invalid", "not-applicable"] as const) test(`required native resource ${mode} cannot become cleaned`, { timeout: 10000 }, async (t) => {
  const f = fixture(t); let calls = 0;
  f.prepared.resources.runner = { owned: true, release: mode === "missing" ? undefined : () => {
    calls++; if (mode === "throws") throw new Error("release failed");
    return mode === "invalid" ? { status: "confirmed", evidence: "invalid text" } : { status: "not-applicable", reason: "fixture" };
  } };
  const launcher = createDepartmentCodexExecutionLauncher(() => f.prepared); launcher.requirements(f.value);
  const handle = await launcher.launch(f.value, async () => {}); await f.wait("task-started"); await finish(f, handle);
  assert.notEqual((await handle.cleanup()).runner.status, "confirmed"); await handle.cleanup(); assert.equal(calls, mode === "missing" ? 0 : 1);
});

async function startOwner(t: test.TestContext, option = "") {
  const f = fixture(t); fs.writeFileSync(f.file("trusted-input"), JSON.stringify({ identity: f.value, selection }));
  const child = fork(worker, ["owner", f.directory, option], { stdio: ["ignore", "ignore", "pipe", "ipc"], detached: process.platform !== "win32",
    env: { ...process.env, HOME: f.directory, USERPROFILE: f.directory, CODEX_HOME: f.file(".codex") } });
  let stderr = ""; child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform !== "win32") { try { process.kill(-child.pid!, "SIGKILL"); } catch {} } else child.kill();
    }
    await exited; assert.equal(stderr, "");
  });
  await new Promise<void>((resolve, reject) => { child.once("message", () => resolve()); child.once("error", reject); });
  const store = new DepartmentExecutionReceiptStore(f.directory), client = new DepartmentExecutionOwnerClient(f.directory);
  const finalized = () => waitCondition(f.directory, () => {
    const read = store.read(f.value.executionId); return read.kind === "ok" && ["cleaned", "cleanup-failed"].includes(read.value.state);
  });
  const close = async () => { child.send({ shutdown: true }); await exited; assert.equal(child.exitCode, 0); };
  return { ...f, child, client, store, finalized, close };
}

function clientStart(directory: string): Promise<any> {
  return new Promise((resolve, reject) => execFile(process.execPath, [worker, "client-start", directory], {
    env: { ...process.env, HOME: directory, USERPROFILE: directory, CODEX_HOME: path.join(directory, ".codex") },
  }, (error, stdout, stderr) => error ? reject(error) : stderr ? reject(new Error(stderr)) : resolve(JSON.parse(stdout))));
}

test("independent Owner survives start host exit; terminal, original handler, callback and inherited tail each block receipt", { timeout: 15000 }, async (t) => {
  const f = await startOwner(t, "pipe");
  const started = await clientStart(f.directory); assert.equal(started.status, "live"); // this client process has exited
  await f.wait("binding-session"); assert.equal(f.count("turn/start"), 0);
  f.mark("release-binding"); await f.wait("task-started");
  const bound = { ...f.value, session: { state: "bound" as const, id: "native" } };
  assert.equal((await f.client.startExecution(f.value)).status, "live"); assert.equal(f.count("turn/start"), 1);
  await f.control({ response: "turn", messages: [
    { method: "fixture/callback", params: { threadId: "native" } },
    { id: "approval", method: "item/commandExecution/requestApproval", params: { threadId: "native", turnId: "turn" } },
  ] });
  await f.wait("callback-entered"); await f.wait("handler-entered");
  assert.equal((await f.client.observeExecution(bound)).status, "live"); assert.equal(fs.existsSync(f.file("releases")), false);
  await f.control({ messages: [terminal] }); await immediate();
  assert.equal(fs.existsSync(f.file("stdin-eof")), false, "original handler blocks producer close");
  f.mark("release-handler"); await f.wait("pipe-ready"); await f.wait("parent-exiting");
  assert.equal((await f.client.observeExecution(bound)).status, "live", "process exit cannot close inherited tail");
  assert.equal(fs.existsSync(f.file("releases")), false);
  f.mark("release-pipe"); await f.wait("tail-consumed");
  assert.equal((await f.client.observeExecution(bound)).status, "live", "callback responsibility remains after tail EOF");
  f.mark("release-callback"); await f.finalized();
  const observed = await f.client.observeExecution(bound); assert.equal(observed.status, "cleaned");
  if (observed.status === "cleaned") {
    assert.equal(observed.receipt.cleanup.turnTerminal.status, "confirmed"); assert.equal(observed.receipt.cleanup.streams.status, "confirmed");
    assert.equal(observed.receipt.requirements.runner, true); assert.equal(observed.receipt.requirements.turnTerminal, true);
  }
  assert.equal((await f.client.startExecution(f.value)).status, "cleaned"); assert.equal(f.count("turn/start"), 1);
  assert.equal(fs.readFileSync(f.file("resolutions"), "utf8"), "resolve\n");
  assert.deepEqual(fs.readFileSync(f.file("releases"), "utf8").trim().split("\n"), ["runner", "executionRoot", "links", "temp", "tab"]);
  await f.close();
});

for (const mode of ["reject-binding", "missing-terminal", "truncated", "fail-resource", "missing-resource", "callback-failure"] as const) {
  test(`Owner ${mode} cannot publish complete receipt`, { timeout: 10000 }, async (t) => {
    const f = await startOwner(t, mode); assert.equal((await f.client.startExecution(f.value)).status, "live");
    await f.wait("binding-session");
    if (mode === "truncated") {
      await f.control({ messages: Array.from({ length: 45 }, (_, i) => ({ method: "fixture/unowned", params: { threadId: "other", n: i } })) });
    }
    f.mark("release-binding");
    if (mode !== "reject-binding") {
      await f.wait("task-started");
      if (mode === "missing-terminal") {
        await f.control({ response: "turn" }); await f.control({ exit: true });
      } else {
        if (mode === "truncated") await f.control({ messages: [{ method: "thread/started", params: { thread: { id: "other" } } }] });
        await f.control({ response: "turn", messages: mode === "callback-failure"
          ? [{ method: "fixture/fail", params: { threadId: "native" } }, terminal] : [terminal] });
      }
    }
    if (mode !== "missing-terminal") { await f.wait("stdin-eof"); await f.control({ close: true }); }
    await f.finalized(); const result = await f.client.observeExecution(f.value); assert.equal(result.status, "unknown");
    const read = f.store.read(f.value.executionId); assert.equal(read.kind, "ok");
    if (read.kind === "ok") { assert.equal(read.value.state, "cleanup-failed"); assert.equal(read.value.receipt, undefined); }
    assert.equal(f.count("turn/start"), mode === "reject-binding" ? 0 : 1);
    await f.close();
  });
}
