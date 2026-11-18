import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";
import { productionWiring, until, gate } from "../extensionHost/fixtures/departmentproductionwiringfixture";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { DepartmentExecutionReceiptStore } from "../../runtime/departmentexecutionreceiptstore";
import type { DepartmentExecutionIdentity } from "../../runtime/departmentexecutionidentity";

function isolated(name: string, run: (t: test.TestContext) => Promise<void>) {
  if (process.env.DEPARTMENT_RESOURCE_SCENARIO) {
    if (process.env.DEPARTMENT_RESOURCE_SCENARIO === name) test(name, { timeout: 22000 }, run);
    return;
  }
  test(name, { timeout: 28000 }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-resource-user-"));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), DEPARTMENT_RESOURCE_SCENARIO: name };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ["--test-reporter=tap", "--test", __filename], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (v) => { output += v; }); child.stderr.on("data", (v) => { output += v; });
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
      assert.equal(code, 0, output); assert.match(output, /# pass 1\b/, output);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}
const dispatch = { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
  prompt: "Implement the complete isolated employee source requirement and verify all meaningful behavior, reporting actual evidence." }] };
const wait = { status: "wait", finalSummary: "等待员工原生资源释放" };
type Harness = Awaited<ReturnType<typeof productionWiring>>;
function bindings(h: Harness) { const r = h.store.read("root", "workspace"); assert.ok(r.ok && r.value); return r.value.executionBindings ?? []; }
function client(h: Harness, i: DepartmentExecutionIdentity) { return new DepartmentExecutionOwnerClient(h.file("owners/" + i.ownerId)); }
async function failedCleanup(h: Harness, i: DepartmentExecutionIdentity) {
  const store = new DepartmentExecutionReceiptStore(h.file("owners/" + i.ownerId));
  await until(() => { const r = store.read(i.executionId, i); return r.kind === "ok" && r.value.state === "cleanup-failed"; });
  const r = store.read(i.executionId, i); assert.ok(r.kind === "ok" && !r.value.receipt);
}
async function employeeStarted(h: Harness) {
  await until(() => h.wire(h.file("employee")).some((m) => m.method === "turn/start"));
  return bindings(h).find((b) => b.identity.role === "employee")!;
}
async function cleaned(h: Harness, i: DepartmentExecutionIdentity) {
  // A released Owner removes its socket. Read the original Owner's durable
  // receipt, rather than racing a second public observe against its exit.
  const store = new DepartmentExecutionReceiptStore(h.file("owners/" + i.ownerId));
  await until(() => { const r = store.read(i.executionId, i); return r.kind === "ok" && r.value.state === "cleaned"; });
  const r = store.read(i.executionId, i); assert.ok(r.kind === "ok" && r.value.receipt);
  assert.ok(Object.values(r.value.receipt.requirements).every(Boolean));
  assert.ok(Object.values(r.value.receipt.cleanup).every((v) => v.status === "confirmed"));
  assert.deepEqual(r.value.receipt.identity, i);
  return r.value.receipt;
}

isolated("production Codex employee and two-round leader release original resources with complete original Owner receipts", async (t) => {
  const h = await productionWiring(t, "codex", true), entered = gate(), release = gate();
  // Keep the real employee consumer pending so the scheduler has no open
  // acceptance batch. A user wake can then legally request the second wait.
  h.beforeEmployeeConsumerFinish(async () => { entered.resolve(); await release.promise; });
  h.answer(1, dispatch); h.answer(2, wait);
  const started = await h.start(); assert.ok(started.ok);
  const employee = await employeeStarted(h); await entered.promise;
  assert.equal(h.closedTabs.length, 0);
  assert.equal(h.fixture.adapter.host().submitUserMessage(started.taskId, "补充要求：保持原组长身份等待员工消费完成"), true);
  await until(() => h.wire().filter((m) => m.method === "turn/start").length === 2);
  await until(() => h.fixture.getMessages("leader-tab").some((m) => m.content === JSON.stringify(wait)));
  const leader = bindings(h).find((b) => b.identity.role === "leader")!;
  const closing = h.producer.close(started.taskId);
  release.resolve();
  assert.deepEqual(await closing, { ok: true });
  await cleaned(h, employee.identity); await cleaned(h, leader.identity);
  assert.equal(h.wire().filter((m) => m.method === "thread/start").length, 1);
  assert.equal(h.wire().filter((m) => m.method === "thread/resume").length, 1);
  assert.equal(h.wire(h.file("employee")).filter((m) => m.method === "turn/start").length, 1);
  assert.deepEqual(h.closedTabs.slice().sort(), ["leader-tab", h.fixture.createdSubtaskTargets[0].tabId].sort());
  // Complete Codex receipts do not consume whole-group capacity or erase history.
  assert.equal(h.read(started.taskId)?.executionSession?.sessionId, "native");
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.equal(saved.value.capacity.leaders.length, 1);
  // Existing employee receipt consumer may return its own lease. No new
  // whole-group/leader capacity consumer is installed by this change.
  assert.equal(saved.value.capacity.employees.length, 0);
});

for (const hold of ["callback", "local-consumer", "pipe"] as const) isolated(`production ${hold} responsibility prevents early tab release and receipt`, async (t) => {
  const h = await productionWiring(t, "codex", true), entered = gate(), release = gate();
  if (hold === "callback") h.onEmployeeOutput(async () => { entered.resolve(); await release.promise; });
  if (hold === "local-consumer") h.beforeEmployeeConsumerFinish(async () => { entered.resolve(); await release.promise; });
  if (hold === "pipe") fs.writeFileSync(h.file("employee/hold-pipe"), "held");
  h.answer(1, dispatch); const started = await h.start(); assert.ok(started.ok);
  const employee = await employeeStarted(h);
  if (hold === "pipe") await until(() => fs.existsSync(h.file("employee/eof-1"))); else await entered.promise;
  assert.notEqual((await client(h, employee.identity).observeExecution(employee.identity)).status, "cleaned");
  assert.equal(h.closedTabs.length, 0);
  if (hold === "pipe") fs.rmSync(h.file("employee/hold-pipe")); else release.resolve();
  await cleaned(h, employee.identity); assert.equal(h.closedTabs.length, 1);
});

for (const failure of ["close-failed", "successor-tab", "successor-generation", "consumer-rejected"] as const) isolated(`production ${failure} retains unknown cleanup and capacity`, async (t) => {
  const h = await productionWiring(t, "codex", true), entered = gate(), release = gate();
  h.beforeEmployeeConsumerFinish(async () => { entered.resolve(); await release.promise; if (failure === "consumer-rejected") throw new Error("controlled-local-consumer-rejected"); });
  h.answer(1, dispatch); const started = await h.start(); assert.ok(started.ok);
  const employee = await employeeStarted(h); await entered.promise;
  const tabId = h.fixture.createdSubtaskTargets[0].tabId;
  if (failure === "close-failed") h.failTabClose(true);
  if (failure === "successor-tab") h.tabs.set(tabId, { ...h.tabs.get(tabId)! });
  if (failure === "successor-generation") {
    const r = h.store.read("root", "workspace"); assert.ok(r.ok && r.value);
    r.value.runtime.leaders[0].generation!++; assert.equal(h.store.write(r.value).ok, true);
  }
  release.resolve();
  await failedCleanup(h, employee.identity);
  assert.ok(h.tabs.has(tabId)); assert.equal(h.closedTabs.length, 0);
  const r = h.store.read("root", "workspace"); assert.ok(r.ok && r.value); assert.equal(r.value.capacity.employees.length, 1);
});

isolated("private host disconnect after grant never produces resource success or replays a prompt", async (t) => {
  const cp = require("child_process") as typeof import("child_process"), original = cp.fork;
  const workers: ChildProcess[] = [];
  t.mock.method(cp, "fork", (...args: Parameters<typeof original>) => { const child = original(...args); workers.push(child); return child; });
  const h = await productionWiring(t, "codex", true);
  fs.writeFileSync(h.file("employee/hold-terminal"), "held");
  h.answer(1, dispatch); const started = await h.start(); assert.ok(started.ok);
  const employee = await employeeStarted(h), worker = workers.find((c) => c.spawnargs.some((a) => /departmentcodexownerworker\.js$/.test(a)))!;
  assert.ok(worker?.connected); worker.disconnect();
  fs.rmSync(h.file("employee/hold-terminal"));
  await until(() => fs.existsSync(h.file("employee/eof-1")));
  await failedCleanup(h, employee.identity);
  assert.equal(h.closedTabs.includes(h.fixture.createdSubtaskTargets[0].tabId), false); assert.equal(h.wire(h.file("employee")).filter((m) => m.method === "turn/start").length, 1);
  const r = h.store.read("root", "workspace"); assert.ok(r.ok && r.value); assert.equal(r.value.capacity.employees.length, 1);
});

for (const invalid of ["wrong-resource-identity", "wrong-ack-sequence", "not-applicable-ack"] as const) isolated(`private ${invalid} cannot form a successful original receipt`, async (t) => {
  const cp = require("child_process") as typeof import("child_process"), original = cp.fork;
  let changed = false;
  t.mock.method(cp, "fork", (...args: Parameters<typeof original>) => {
    const child = original(...args);
    if (!child.spawnargs.some((a) => /departmentcodexownerworker\.js$/.test(a))) return child;
    const emit = child.emit.bind(child), send = child.send.bind(child); let releaseSequence = -1;
    child.emit = ((event: string, ...values: any[]) => {
      if (event === "message" && values[0]?.type === "release-tab") {
        releaseSequence = values[0].sequence;
        if (invalid === "wrong-resource-identity") { values[0].resourceIdentity.generation++; changed = true; }
      }
      return Reflect.apply(emit, child, [event, ...values]);
    }) as typeof child.emit;
    child.send = ((...values: any[]) => {
      const message = values[0];
      if (message?.operation === "ack" && message.sequence === releaseSequence) {
        if (invalid === "wrong-ack-sequence") { message.sequence++; changed = true; }
        if (invalid === "not-applicable-ack") { message.result = { status: "not-applicable", reason: "forged" }; changed = true; }
      }
      return Reflect.apply(send, child, values);
    }) as typeof child.send;
    return child;
  });
  const h = await productionWiring(t, "codex", true); h.answer(1, dispatch);
  const started = await h.start(); assert.ok(started.ok); const employee = await employeeStarted(h);
  await failedCleanup(h, employee.identity); assert.equal(changed, true);
  assert.equal(h.wire(h.file("employee")).filter((m) => m.method === "turn/start").length, 1);
  const r = h.store.read("root", "workspace"); assert.ok(r.ok && r.value); assert.equal(r.value.capacity.employees.length, 1);
});
