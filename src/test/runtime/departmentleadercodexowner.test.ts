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
import { bindDepartmentExecutionTab, createDepartmentExecutionResources } from "../../extensionHost/departmentexecutionresources";
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
    try { for (const l of fs.readFileSync(h.file("native-pids"), "utf8").trim().split("\n")) pids.add(Number(l)); } catch {}
    for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await new Promise((r) => setTimeout(r, 20)); fs.rmSync(directory, { recursive: true, force: true });
  }); return h;
}
const first = { invocationId: "main-1", prompt: "trusted first main invocation" };
const second = { invocationId: "main-2", prompt: "trusted second main invocation" };

test("leader native notification burst drains ACKs without overflowing the callback window", { timeout: 15000 }, async (t) => {
  const h = await setup(t), stages: unknown[] = []; let deltas = 0;
  h.flag("burst");
  h.host.logError = (message, data) => { if (message === "department-leader-native-failed") stages.push(data); };
  h.host.handlers.onAssistantDelta = async () => { deltas++; await new Promise<void>((resolve) => setTimeout(resolve, 10)); };
  let tab: { id: string; cli: string; sessionId: null } | null = { id: "owned-tab", cli: "codex", sessionId: null };
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: () => tab,
    isActive: () => false, owns: () => true, close: async () => { tab = null; } });
  resources.recordCreated(tab.id); const consumer = resources.beginConsumer(tab.id);
  h.host.tab = bindDepartmentExecutionTab(consumer.target, h.identity);
  let originalReceipt!: () => ReturnType<DepartmentExecutionOwnerClient["waitForCleanup"]>;
  h.host.retainOriginalClient = (binding, client) => { originalReceipt = () => client.waitForCleanup(binding.identity, binding.requirements); };
  const p = h.port(), launch = await p.invoke(first);
  assert.equal((await launch.completion).streams.status, "confirmed", JSON.stringify(stages));
  assert.equal(deltas, 40); assert.deepEqual(stages, []);
  assert.equal(h.count("turn/start"), 1);
  consumer.finish();
  const cleanup = await p.closeAdmissionsAndDrain();
  assert.equal(cleanup.runner.status, "confirmed"); assert.equal(cleanup.tab.status, "confirmed");
  assert.deepEqual((await originalReceipt()).identity, launch.identity);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.deepEqual(saved.value.capacity.leaders, ["module"], "receipt alone does not release organizational capacity");
});

for (const ledgerAvailable of [true, false]) test(`leader observes the original receipt with an unavailable task session only if the ledger is available (${ledgerAvailable})`, { timeout: 15000 }, async (t) => {
  const h = await setup(t);
  const ownedTab = { id: "tab", cli: "codex", sessionId: "local" };
  let tab: typeof ownedTab | null = ownedTab;
  const resources = createDepartmentExecutionResources({
    workspace: () => "workspace", readTab: () => tab, isActive: () => false,
    owns: (identity) => h.admission.entries().some((entry) => entry.executionId === identity.executionId),
    async close() { tab = null; },
  });
  resources.recordCreated(ownedTab.id);
  const consumer = resources.beginConsumer(ownedTab.id);
  h.host.tab = bindDepartmentExecutionTab(consumer.target, h.identity);
  const readSession = h.host.readSession;
  h.host.readSession = () => tab ? readSession() : null;
  const readLedger = h.store.readLeaderExecutionSet.bind(h.store);
  h.store.readLeaderExecutionSet = (scope) => tab || ledgerAvailable ? readLedger(scope) : { ok: true, value: null };
  let original: { client: DepartmentExecutionOwnerClient; binding: Parameters<NonNullable<typeof h.host.retainOriginalClient>>[0] } | undefined;
  h.host.retainOriginalClient = (binding, client) => { original = { binding, client }; };
  const port = h.port();
  const launch = await port.invoke(first);
  assert.equal((await launch.completion).streams.status, "confirmed");
  consumer.finish();
  if (!ledgerAvailable) {
    await assert.rejects(port.closeAdmissionsAndDrain(), /leader-owner-channel-or-delivery-unknown/);
    await assert.rejects(port.invoke(second));
    assert.equal(h.count("turn/start"), 1);
    return;
  }
  assert.equal((await port.closeAdmissionsAndDrain()).tab.status, "confirmed");
  assert.ok(original);
  const receipt = await original.client.waitForCleanup(original.binding.identity, original.binding.requirements);
  assert.deepEqual(receipt.identity, launch.identity);
  const saved = h.store.read("root", "workspace");
  assert.ok(saved.ok && saved.value);
  assert.deepEqual(saved.value.capacity.leaders, ["module"]);
});

test("leader notification pacing leaves interactive requests outside the ACK barrier", { timeout: 15000 }, async (t) => {
  const h = await setup(t), delta = deferred(); let requests = 0;
  h.flag("request");
  h.host.handlers.onRequest = async () => { requests++; await delta.promise; return { result: {} }; };
  h.host.handlers.onAssistantDelta = () => delta.resolve();
  const p = h.port(), launch = await p.invoke(first);
  assert.equal((await launch.completion).streams.status, "confirmed"); assert.equal(requests, 1);
  assert.equal(h.count("turn/start"), 1); await p.closeAdmissionsAndDrain();
});

test("leader callback above the logical limit fails closed with a redacted worker stage in the application log", { timeout: 15000 }, async (t) => {
  const h = await setup(t), logs: unknown[] = [];
  h.flag("oversized-notification");
  h.host.logError = (message, data) => { if (message === "department-leader-native-failed") logs.push(data); };
  const p = h.port(), launch = await p.invoke(first);
  await assert.rejects(launch.completion, /channel-or-delivery-unknown/);
  assert.deepEqual(logs, [{ stage: "worker-callback-size-limit", phase: "granted",
    rootTaskId: h.identity.rootTaskId, leaderTaskId: h.identity.leaderTaskId,
    executionId: h.identity.executionId, generation: h.identity.generation }]);
  assert.equal(JSON.stringify(logs).includes("sensitive-native-data"), false);
  await assert.rejects(p.invoke(second)); assert.equal(h.count("turn/start"), 1);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.deepEqual(saved.value.capacity.leaders, ["module"]);
});

test("leader delivers compatible 51 KiB and raw UTF-8 large tool results intact before exact terminal and original cleanup", { timeout: 15000 }, async (t) => {
  const h = await setup(t), stages: unknown[] = [], seen: string[] = [], gate = deferred(), entered = deferred();
  h.flag("large-tool-output");
  h.host.logError = (message, data) => { if (message === "department-leader-native-failed") stages.push(data); };
  const expected = new Map([["compat", "c".repeat(51 * 1024)], ["utf8", '工具🌛\\\"\n'.repeat(8192)]]);
  h.host.handlers.onNotification = async (raw) => {
    const message = raw as any;
    if (message.method !== "item/completed") return;
    const item = message.params.item;
    assert.equal(item.aggregatedOutput, expected.get(item.id));
    assert.equal(Buffer.byteLength(JSON.stringify(message), "utf8") > 64 * 1024, item.id === "utf8",
      "compat starts below a frame while the raw multilingual event already exceeds it");
    seen.push(`native-${item.id}`);
    if (item.id === "compat") { entered.resolve(); await gate.promise; }
  };
  h.host.handlers.onEvent = (raw) => {
    const event = raw as any;
    if (event.type !== "item.completed" || !expected.has(event.item?.id)) return;
    assert.equal(event.item.aggregatedOutput, expected.get(event.item.id));
    assert.equal(event.item.aggregated_output, expected.get(event.item.id));
    assert.ok(Buffer.byteLength(JSON.stringify(event), "utf8") > 64 * 1024);
    seen.push(`forwarded-${event.item.id}`);
  };
  h.host.handlers.onAssistantDelta = (text) => { if (text.startsWith("short-after-")) seen.push(text); };
  let tab: { id: string; cli: string; sessionId: null } | null = { id: "large-output-tab", cli: "codex", sessionId: null };
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: () => tab,
    isActive: () => false, owns: () => true, close: async () => { tab = null; } });
  resources.recordCreated(tab.id); const consumer = resources.beginConsumer(tab.id);
  h.host.tab = bindDepartmentExecutionTab(consumer.target, h.identity);
  let originalReceipt!: () => ReturnType<DepartmentExecutionOwnerClient["waitForCleanup"]>;
  h.host.retainOriginalClient = (binding, client) => { originalReceipt = () => client.waitForCleanup(binding.identity, binding.requirements); };
  const p = h.port(), launch = await p.invoke(first);
  await entered.promise;
  let settled = false; void launch.completion.then(() => { settled = true; });
  await tick(); assert.equal(settled, false); assert.equal(seen.includes("short-after-compat"), false);
  gate.resolve();
  const terminal = await launch.completion;
  assert.ok(Object.values(terminal).every((fact) => fact.status === "confirmed"));
  assert.deepEqual(seen, ["native-compat", "forwarded-compat", "short-after-compat", "native-utf8", "forwarded-utf8", "short-after-utf8"]);
  assert.deepEqual(stages, []); assert.equal(h.count("turn/start"), 1);
  assert.equal(await p.invoke(first), launch, "no duplicate grant/turn for identical invocation");
  consumer.finish();
  const cleanup = await p.closeAdmissionsAndDrain();
  assert.ok(Object.values(cleanup).every((fact) => fact.status === "confirmed"));
  const receipt = await originalReceipt();
  assert.deepEqual(receipt.identity, launch.identity);
  assert.ok(Object.values(receipt.cleanup).every((fact) => fact.status === "confirmed"));
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.deepEqual(saved.value.capacity.leaders, ["module"]);
});

test("leader preserves long multilingual Loop+ prompts across private IPC and native new/resume calls", { timeout: 15000 }, async (t) => {
  const h = await setup(t), p = h.port();
  const prompt = '组长复核🌛\n"路径\\与转义"\n'.repeat(6000);
  assert.ok(Buffer.byteLength(JSON.stringify(prompt), "utf8") > 64 * 1024);
  for (const invocationId of ["long-first", "long-resume"]) {
    const invocation = { invocationId, prompt: `${prompt}${invocationId}` };
    const launch = await p.invoke(invocation);
    assert.equal((await launch.completion).turnTerminal.status, "confirmed");
    assert.equal(await p.invoke(invocation), launch, "duplicates retain the same launch without sending again");
    await assert.rejects(p.invoke({ ...invocation, prompt: `${invocation.prompt} changed` }), /conflict/);
  }
  const turns = h.wire().filter((m) => m.method === "turn/start");
  assert.equal(turns.length, 2);
  for (const [index, suffix] of ["long-first", "long-resume"].entries()) {
    assert.ok(turns[index].params.input.some((item: { text?: string }) => item.text === `${prompt}${suffix}`), "native prompt is complete");
  }
  assert.equal(h.count("thread/start"), 1);
  assert.equal(h.count("thread/resume"), 1);
  assert.equal((await p.closeAdmissionsAndDrain()).runner.status, "confirmed");
});

for (const resume of [false, true]) test(`leader ${resume ? "precise resume" : "new"} holds one identity/thread through two immutable invocations`, { timeout: 15000 }, async (t) => {
  const h = await setup(t, resume); let persisted = 0;
  const originalPersist = h.host.persistSession;
  h.host.persistSession = async (s) => { assert.equal(h.count("turn/start"), 0); assert.equal(h.admission.entries()[0].executionId, null); persisted++; await originalPersist(s); };
  const bind = h.store.bindLeaderExecution.bind(h.store);
  let binds = 0;
  h.store.bindLeaderExecution = (...args) => {
    assert.equal(h.count("turn/start"), binds, "each immutable round rebinds before its own native grant");
    assert.ok(h.host.readSession()); binds++; return bind(...args);
  };
  const p = h.port(); const a = await p.invoke(first);
  assert.equal((await a.completion).turnTerminal.status, "confirmed");
  assert.equal(p.invoke(first), p.invoke(first)); assert.equal(await p.invoke(first), a);
  assert.equal(await p.invoke({ prompt: first.prompt, invocationId: first.invocationId }), a);
  await assert.rejects(p.invoke({ ...first, prompt: "changed prompt" }), /conflict/);
  const b = await p.invoke(second); assert.equal((await b.completion).streams.status, "confirmed");
  assert.deepEqual(a.identity, b.identity); assert.equal(persisted, 1); assert.equal(h.builders, 1);
  assert.equal(h.count("thread/start"), resume ? 0 : 1); assert.equal(h.count("thread/resume"), resume ? 2 : 1);
  assert.equal(h.count("turn/start"), 2); assert.equal(binds, 2);
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
    const logs: unknown[] = [];
    h.host.logError = (event, data) => { if (event === "department-leader-native-failed") logs.push(data); };
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
    const step = kind === "persist-failure" ? "persist-task-session" : kind === "bind-failure" ? "bind-execution"
      : kind === "readback-conflict" ? "verify-task-session" : undefined;
    if (step) assert.deepEqual(logs, [{ stage: "session-persistence-or-binding-failed", sessionBindingStep: step, phase: "persisting",
      rootTaskId: h.identity.rootTaskId, leaderTaskId: h.identity.leaderTaskId, executionId: h.identity.executionId, generation: h.identity.generation }]);
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

for (const { name, error, reason } of [
  { name: "未知异常脱敏", error: "fixture-sensitive-consumer-detail", reason: "unknown" },
  { name: "代次冲突分类", error: "department-leader-generation-changed", reason: "department-leader-generation-changed" },
  { name: "消费者缺失分类", error: "department-leader-consumer-missing", reason: "department-leader-consumer-missing" },
  { name: "来源不可观察分类", error: "department-producer-observation-scope-unavailable", reason: "department-producer-observation-scope-unavailable" },
]) test(`leader callback rejection logs safe context for ${name} and refuses later invocation`, { timeout: 15000 }, async (t) => {
  const h = await setup(t), diagnostics: string[] = [], applicationLogs: Array<{ message: string; data: unknown }> = [], originalError = console.error;
  console.error = (message?: unknown) => { diagnostics.push(String(message)); };
  t.after(() => { console.error = originalError; });
  h.host.logError = (message, data) => {
    applicationLogs.push({ message, data });
    return Promise.reject(new Error("fixture-diagnostic-consumer-rejected"));
  };
  h.host.handlers.onAssistantDelta = async () => { throw new Error(error); };
  const p = h.port(), a = await p.invoke(first); await assert.rejects(a.completion, /channel-or-delivery-unknown/);
  await assert.rejects(p.invoke(second)); assert.equal(h.count("turn/start"), 1);
  assert.deepEqual(diagnostics, []);
  assert.equal(applicationLogs.length, 1);
  const { callbackSequence } = applicationLogs[0].data as { callbackSequence: number };
  assert.ok(Number.isSafeInteger(callbackSequence) && callbackSequence > 0, "the rejected callback is identified by a positive sequence");
  assert.deepEqual(applicationLogs, [{ message: "department-leader-native-failed", data: {
    stage: "callback-consumer-rejected", callbackName: "onAssistantDelta", callbackSequence, callbackRejectionReason: reason,
    phase: "granted", rootTaskId: h.identity.rootTaskId,
    leaderTaskId: h.identity.leaderTaskId, executionId: h.identity.executionId, generation: h.identity.generation,
  } }]);
});

test("leader granted round survives seal and post-grant caller abort", { timeout: 15000 }, async (t) => {
  const h = await setup(t); h.flag("hold-terminal"); const abort = new AbortController(), p = h.port();
  const a = await p.invoke(first, abort.signal); abort.abort(); const close = p.closeAdmissionsAndDrain();
  await until(() => h.count("turn/start") === 1); h.removeFlag("hold-terminal");
  assert.equal((await a.completion).turnTerminal.status, "confirmed"); await close;
  assert.equal(h.count("turn/start"), 1);
});

test("leader original granted Owner survives startup host exit", { timeout: 15000 }, async (t) => {
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

test("leader worker still rejects callback window overflow without treating it as cleanup", { timeout: 10000 }, async (t) => {
  const h = await setup(t); h.flag("request-burst"); h.flag("hold-terminal");
  const input = { ...h.description, version: 1, token: "d".repeat(64), identity: h.identity,
    selection: h.selection, ownerDirectory: h.file("owner") };
  const child = fork(path.join(__dirname, "..", "..", "runtime", "departmentleadercodexownerworker.js"), [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let sequence = 0, granted = false, held = 0, failure: any;
  const send = (operation: string, extra = {}) => child.send({ version: 1, token: input.token,
    identity: h.identity, sequence: ++sequence, operation, ...extra });
  child.on("message", (v: any) => {
    if (v.type === "ready") send("invoke", { invocation: first });
    if (v.type === "session") send("persisted", { invocationId: first.invocationId });
    if (v.type === "owner-bound") send("grant", { invocationId: first.invocationId });
    if (v.type === "granted") granted = true;
    if (v.type === "callback") {
      if (granted) held++;
      else send("ack", { callbackSequence: v.sequence, ok: true, result: null });
    }
    if (v.type === "failure") failure = v;
  });
  const disconnected = once(child, "disconnect"); child.send(input); await disconnected;
  assert.equal(failure?.stage, "callback-capacity"); assert.equal(held, 32);
  assert.equal(failure.token, input.token); assert.deepEqual(failure.identity, h.identity);
  assert.equal(h.count("turn/start"), 1);
  const observed = await new DepartmentExecutionOwnerClient(h.file("owner")).observeExecution(h.identity);
  assert.notEqual(observed.status, "cleaned");
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
