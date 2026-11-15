import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fork } from "child_process";
import { once } from "events";
import { leaderFixture } from "./fixtures/departmentleadercodexhost";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { isLeaderCodexPreparation, LEADER_INVOCATION_LIMIT } from "../../runtime/departmentleadercodexcontract";
const tick = () => new Promise<void>((r) => setImmediate(r));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 8000;
  while (!await check()) { if (Date.now() > deadline) throw new Error("fixture-gate-timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function setup(t: test.TestContext, bound = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-native-"));
  const h = await leaderFixture(directory, { bound });
  t.after(async () => {
    // Test teardown only; SIGTERM/removal is not native cleanup or capacity evidence.
    const pids = new Set<number>();
    try { for (const l of JSON.parse(fs.readFileSync(h.file("configuration/selection.json"), "utf8")).leases) pids.add(l.pid); } catch {}
    try { for (const l of fs.readFileSync(h.file("native-pids"), "utf8").trim().split("\n")) pids.add(Number(l)); } catch {}
    for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await new Promise((r) => setTimeout(r, 20)); fs.rmSync(directory, { recursive: true, force: true });
  }); return h;
}
const first = { invocationId: "main-1", prompt: "trusted first main invocation" };
const second = { invocationId: "main-2", prompt: "trusted second main invocation" };

for (const resume of [false, true]) test(`leader ${resume ? "precise resume" : "new"} holds one identity/thread through two immutable invocations`, { timeout: 15000 }, async (t) => {
  const h = await setup(t, resume); let persisted = 0;
  const originalPersist = h.host.persistSession;
  h.host.persistSession = async (s) => { assert.equal(h.count("turn/start"), 0); assert.equal(h.admission.entries()[0].executionId, null); persisted++; await originalPersist(s); };
  const bind = h.store.bindLeaderExecution.bind(h.store);
  h.store.bindLeaderExecution = (...args) => { assert.equal(h.count("turn/start"), 0); assert.ok(h.host.readSession()); return bind(...args); };
  const p = h.port(); const a = await p.invoke(first);
  assert.equal((await a.completion).turnTerminal.status, "confirmed");
  assert.equal(p.invoke(first), p.invoke(first)); assert.equal(await p.invoke(first), a);
  assert.equal(await p.invoke({ prompt: first.prompt, invocationId: first.invocationId }), a);
  await assert.rejects(p.invoke({ ...first, prompt: "changed prompt" }), /conflict/);
  const b = await p.invoke(second); assert.equal((await b.completion).streams.status, "confirmed");
  assert.deepEqual(a.identity, b.identity); assert.equal(persisted, 1); assert.equal(h.builders, 1);
  assert.equal(h.count("thread/start"), resume ? 0 : 1); assert.equal(h.count("thread/resume"), resume ? 2 : 1);
  assert.equal(h.count("turn/start"), 2);
  assert.ok(h.wire().filter((m) => m.method === "thread/resume").every((m) => m.params.threadId === "native"));
  const cleanup = await p.closeAdmissionsAndDrain();
  assert.equal(cleanup.runner.status, "confirmed"); assert.equal(cleanup.tab.status, "unobservable");
  assert.equal(cleanup.executionRoot.status, "confirmed"); assert.equal(cleanup.temp.status, "confirmed");
  await assert.rejects(p.invoke({ invocationId: "main-3", prompt: "late" }), /revoked|unavailable/);
  const observed = await new DepartmentExecutionOwnerClient(h.file("owner")).observeExecution(a.identity);
  assert.notEqual(observed.status, "cleaned");
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value); assert.deepEqual(read.value.capacity.leaders, ["module"]);
});

test("leader missing producer/preabort reject before builder and native preparation", async (t) => {
  const h = await setup(t); h.host.producer = null;
  await assert.rejects(h.port().invoke(first), /unavailable/);
  assert.equal(h.builders, 0); assert.equal(h.count("thread/start"), 0);
  const h2 = await setup(t); const abort = new AbortController(); abort.abort();
  await assert.rejects(h2.port().invoke(first, abort.signal), /cancelled/); assert.equal(h2.builders, 0);
});

test("leader failed builder retains preregistered null responsibility", async (t) => {
  const h = await setup(t); h.host.build = async () => { assert.equal(h.admission.entries()[0].executionId, null); throw new Error("fixture-builder-failure"); };
  await assert.rejects(h.port().invoke(first), /builder-failure/); assert.equal(h.admission.entries().length, 1);
  assert.equal(h.admission.entries()[0].executionId, null); assert.equal(h.count("turn/start"), 0);
});

test("leader notification ACK excludes oversized async handler return values", { timeout: 15000 }, async (t) => {
  const h = await setup(t); let deltaCallback = 0;
  h.host.handlers.onAssistantDelta = (() => { deltaCallback++; return deltaCallback === 1 ? Promise.resolve("x".repeat(70 * 1024)) : undefined; }) as never;
  const p = h.port(), launch = await p.invoke(first);
  assert.equal((await launch.completion).turnTerminal.status, "confirmed");
  assert.equal(deltaCallback, 1);
  const next = await p.invoke(second); assert.equal((await next.completion).turnTerminal.status, "confirmed");
  assert.equal(deltaCallback, 2, "synchronous void callback also completed through the ACK gate");
  assert.equal(h.count("turn/start"), 2);
  assert.deepEqual(h.host.readSession(), { cli: "codex", sessionId: "native", configId: "profile" });
  const read = h.store.readLeaderExecutionSet(h.admission.scope); assert.ok(read.ok && read.value);
  assert.deepEqual(read.value.bindings[0].identity.session, { state: "bound", id: "native" });
  await p.closeAdmissionsAndDrain();
});

for (const kind of ["persist-failure", "bind-failure", "readback-conflict", "revoke-after-owner-bind", "cancel-after-owner-bind", "close-after-owner-bind", "cancel-persistence", "close-persistence"] as const)
  test(`leader ${kind} never grants or sends a task and retains responsibility`, { timeout: 15000 }, async (t) => {
    const h = await setup(t), abort = new AbortController(), entered = deferred(), release = deferred();
    const persist = h.host.persistSession;
    h.host.persistSession = async (s) => {
      assert.equal(h.count("turn/start"), 0); entered.resolve();
      if (kind === "persist-failure") throw new Error("fixture-persist-failure");
      if (kind === "cancel-persistence" || kind === "close-persistence") await release.promise;
      await persist(s);
      if (kind === "readback-conflict") fs.writeFileSync(h.file("session"), JSON.stringify({ cli: "codex", sessionId: "wrong", configId: "profile" }));
    };
    const originalBind = h.store.bindLeaderExecution.bind(h.store);
    h.store.bindLeaderExecution = (...args) => {
      if (kind === "bind-failure") return { ok: false, error: "fixture-binding-failed" };
      return originalBind(...args);
    };
    let p: ReturnType<typeof h.port>;
    const authority = h.host.assertCurrent;
    h.host.assertCurrent = () => {
      authority();
      if (["revoke-after-owner-bind", "cancel-after-owner-bind", "close-after-owner-bind"].includes(kind)) {
        const native = new (require("../../runtime/departmentexecutionreceiptstore").DepartmentExecutionReceiptStore)(h.file("owner"));
        const read = native.read(h.identity.executionId);
        if (read.kind === "ok" && read.value.identity.session.state === "bound") {
          if (kind === "cancel-after-owner-bind") abort.abort();
          else if (kind === "close-after-owner-bind") void p.closeAdmissionsAndDrain().catch(() => undefined);
          else throw new Error("fixture-final-authority-revoked");
        }
      }
    };
    p = h.port(); const run = p.invoke(first, abort.signal); const rejected = assert.rejects(run);
    await entered.promise;
    if (kind === "cancel-persistence") abort.abort();
    if (kind === "close-persistence") void p.closeAdmissionsAndDrain().catch(() => undefined);
    await rejected;
    if (kind === "cancel-persistence" || kind === "close-persistence") {
      assert.equal(h.active, 1, "original async persistence remains an admission responsibility"); release.resolve();
    }
    await until(() => h.active === 0); await tick();
    assert.equal(h.count("turn/start"), 0); assert.equal(h.admission.entries().length, 1);
  });

test("leader cancellation during raw native preparation cannot revive late response", { timeout: 15000 }, async (t) => {
  const h = await setup(t); h.flag("hold-native"); const abort = new AbortController(), p = h.port();
  const run = p.invoke(first, abort.signal), rejected = assert.rejects(run);
  await until(() => h.count("thread/start") === 1); abort.abort(); await rejected;
  h.removeFlag("hold-native"); await until(() => fs.existsSync(h.file("eof-0")));
  assert.equal(h.count("turn/start"), 0); assert.equal(h.admission.entries()[0].executionId, null);
});

test("leader invocation is serial and does not admit a second prompt while native terminal is missing", { timeout: 15000 }, async (t) => {
  const h = await setup(t); h.flag("hold-terminal"); const p = h.port(), a = await p.invoke(first);
  await until(() => h.count("turn/start") === 1);
  let complete = false; void a.completion.then(() => { complete = true; });
  await assert.rejects(p.invoke(second), /busy/);
  let drained = false; const close = p.closeAdmissionsAndDrain().then((c) => { drained = true; return c; });
  await tick(); assert.equal(complete, false); assert.equal(drained, false); assert.equal(h.count("turn/start"), 1);
  h.removeFlag("hold-terminal"); await a.completion; await close;
});

for (const kind of ["consumer", "pipe"] as const) test(`leader held ${kind} prevents next invocation and sealed drain`, { timeout: 15000 }, async (t) => {
  const h = await setup(t), entered = deferred(), release = deferred();
  if (kind === "consumer") h.host.handlers.onAssistantDelta = async () => { entered.resolve(); await release.promise; };
  else h.flag("hold-pipe");
  const p = h.port(), a = await p.invoke(first);
  if (kind === "consumer") await entered.promise; else await until(() => fs.existsSync(h.file("eof-1")));
  let done = false; const close = p.closeAdmissionsAndDrain().then((c) => { done = true; return c; });
  await tick(); assert.equal(done, false); await assert.rejects(p.invoke(second));
  if (kind === "consumer") release.resolve(); else h.removeFlag("hold-pipe");
  assert.equal((await a.completion).streams.status, "confirmed"); await close;
});

test("leader callback rejection preserves unknown and refuses later invocation", { timeout: 15000 }, async (t) => {
  const h = await setup(t), diagnostics: string[] = [], originalError = console.error;
  console.error = (message?: unknown) => { diagnostics.push(String(message)); };
  t.after(() => { console.error = originalError; });
  h.host.handlers.onAssistantDelta = async () => { throw new Error("fixture-consumer-failure"); };
  const p = h.port(), a = await p.invoke(first); await assert.rejects(a.completion, /channel-or-delivery-unknown/);
  await assert.rejects(p.invoke(second)); assert.equal(h.count("turn/start"), 1);
  assert.deepEqual(diagnostics, ["[department-leader-native] stage=callback-consumer-rejected"]);
});

test("leader granted round survives seal and post-grant caller abort", { timeout: 15000 }, async (t) => {
  const h = await setup(t); h.flag("hold-terminal"); const abort = new AbortController(), p = h.port();
  const a = await p.invoke(first, abort.signal); abort.abort(); const close = p.closeAdmissionsAndDrain();
  await until(() => h.count("turn/start") === 1); h.removeFlag("hold-terminal");
  assert.equal((await a.completion).turnTerminal.status, "confirmed"); await close;
  assert.equal(h.count("turn/start"), 1);
});

test("leader original granted Owner and config lease survive startup host exit", { timeout: 15000 }, async (t) => {
  const h = await setup(t); h.flag("hold-terminal");
  const child = fork(path.join(__dirname, "fixtures", "departmentleadercodexhost.js"), [h.directory], { stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [] });
  let stderr = ""; child.stderr!.on("data", (v) => { stderr += String(v); });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const [code] = await once(child, "exit"); assert.equal(code, 0, stderr);
  const read = h.store.readLeaderExecutionSet(h.admission.scope); assert.ok(read.ok && read.value); const binding = read.value.bindings[0]; assert.ok(binding);
  const observed = await new DepartmentExecutionOwnerClient(h.file("owner")).observeExecution(binding.identity);
  assert.equal(observed.status, "live");
  const recovered = h.port();
  assert.equal((await recovered.observe()).status, "live");
  await assert.rejects(recovered.invoke(second), /observation-only/);
  assert.equal(h.builders, 0);
  const state = JSON.parse(fs.readFileSync(h.file("configuration/selection.json"), "utf8"));
  assert.equal(state.leases.length, 1); process.kill(state.leases[0].pid, 0);
  assert.equal(h.count("turn/start"), 1); h.removeFlag("hold-terminal");
  await until(() => fs.existsSync(h.file("eof-1")));
  await until(async () => (await new DepartmentExecutionOwnerClient(h.file("owner")).observeExecution(binding.identity)).status !== "live");
  assert.notEqual((await new DepartmentExecutionOwnerClient(h.file("owner")).observeExecution(binding.identity)).status, "cleaned");
});

test("leader strict private preparation rejects employee, non-Codex, extra module and route mismatch", async (t) => {
  const h = await setup(t); const input = { ...h.description, version: 1, token: "a".repeat(64), identity: h.identity, selection: h.selection, ownerDirectory: h.file("owner") };
  assert.equal(isLeaderCodexPreparation(input), true);
  for (const v of [{ ...input, module: "/arbitrary" }, { ...input, identity: { ...h.identity, role: "employee" } },
    { ...input, selection: { ...h.selection, model: "other" } }, { ...input, identity: { ...h.identity, cli: "opencode" } }]) assert.equal(isLeaderCodexPreparation(v), false);
  assert.equal(LEADER_INVOCATION_LIMIT, 128);
});

for (const violation of ["token", "sequence", "identity", "extra-field", "premature-grant"] as const)
  test(`leader fixed private worker rejects ${violation} without dispatch`, { timeout: 10000 }, async (t) => {
    const h = await setup(t);
    const input = { ...h.description, version: 1, token: "b".repeat(64), identity: h.identity, selection: h.selection, ownerDirectory: h.file("owner") };
    const child = fork(path.join(__dirname, "..", "..", "runtime", "departmentleadercodexownerworker.js"), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const ready = once(child, "message"); child.send(input); const [event] = await ready; assert.equal(event.type, "ready");
    const bad: Record<string, unknown> = { version: 1, token: input.token, identity: h.identity, sequence: 1,
      operation: "invoke", invocation: first };
    if (violation === "token") bad.token = "c".repeat(64);
    if (violation === "sequence") bad.sequence = 2;
    if (violation === "identity") bad.identity = { ...h.identity, generation: 2 };
    if (violation === "extra-field") bad.module = "/arbitrary";
    if (violation === "premature-grant") { bad.operation = "grant"; delete bad.invocation; bad.invocationId = first.invocationId; }
    const disconnected = once(child, "disconnect"); child.send(bad); await disconnected;
    assert.equal(h.count("turn/start"), 0); assert.equal(h.count("thread/start"), 0);
  });
