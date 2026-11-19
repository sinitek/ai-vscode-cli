import { fixtureEmployeeAdmission } from "./fixtures/departmentemployeeadmission";
import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import { fork } from "child_process";
import { once } from "events";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { createDepartmentProcessPreparation, startDepartmentProcessInvocation } from "../../extensionHost/departmentprocesspreparation";
import { prepareDepartmentProcessOwner } from "../../extensionHost/departmentprocessbootstrap";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";
import { isDepartmentProcessPreparation } from "../../runtime/departmentprocesspreparationcontract";

import { setup, until, holdOwnerEvent } from "./fixtures/departmentprocesspreparationfixture";

for (const forged of [false, true]) test(`employee admission ${forged ? "forged" : "missing"} capability rejects before process builder`, async (t) => {
  const h = await setup(t);
  h.host.employeeAdmission = forged ? {} as NonNullable<typeof h.host.employeeAdmission> : null;
  h.host.prepareLaunch = async () => { assert.fail("builder must not run"); };
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", {}, h.expected), /admission-unavailable/);
  assert.equal(h.admission.entries().length, 0);
  assert.equal(fs.existsSync(path.join(h.directory, "export-ready")), false);
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
  assert.equal(read.value.capacity.employees.length, 1);
});

test("process responsibility precedes builder, survives unsupported failure and is stable per attempt", async (t) => {
  const h = await setup(t);
  h.host.prepareLaunch = async () => {
    const entries = h.admission.entries(); assert.equal(entries[entries.length - 1].executionId, null);
    throw new Error("controlled-unsupported-builder");
  };
  const first = createDepartmentProcessPreparation(h.host); first.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(first.run("leader", "subtask", {}, h.expected), /unsupported-builder/);
  const registration = h.admission.entries()[0].responsibility.registrationId;
  const duplicate = createDepartmentProcessPreparation(h.host); duplicate.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(duplicate.run("leader", "subtask", {}, h.expected), /unsupported-builder/);
  assert.equal(h.admission.entries().length, 1);
  assert.equal(h.admission.entries()[0].responsibility.registrationId, registration);
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "subtask", attemptId: "attempt-2" }]);
  h.leader.loopPlus = scheduler.snapshot();
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
  read.value.capacity.employees.push(JSON.stringify(["leader", "attempt-2"])); assert.equal(h.store.write(read.value).ok, true);
  const second = createDepartmentProcessPreparation(h.host); second.authorizeAttempt("leader", "subtask", "attempt-2");
  await assert.rejects(second.run("leader", "subtask", {}, h.expected), /unsupported-builder/);
  assert.deepEqual(h.admission.entries().map((e) => e.executionId), [null, null]);
  assert.notEqual(h.admission.entries()[1].responsibility.registrationId, registration);
  assert.equal(h.admission.active, 0);
});

test("process overlay policy is fixed before builder and mismatch retains null responsibility", async (t) => {
  const h = await setup(t);
  h.host.employeeAdmission = fixtureEmployeeAdmission(h.store, "workspace", "required").port;
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", {}, h.expected), /overlay-policy-conflict/);
  assert.equal(h.admission.entries()[0].responsibility.requirements.temp, true);
  assert.equal(h.admission.entries()[0].executionId, null);
  assert.equal(fs.existsSync(path.join(h.directory, "export-ready")), false);
});

test("process overlay requirement matches real worker and atomic binding before grant", { timeout: 15000 }, async (t) => {
  const h = await setup(t);
  h.host.employeeAdmission = fixtureEmployeeAdmission(h.store, "workspace", "required").port;
  const prepare = h.host.prepareLaunch;
  h.host.prepareLaunch = async (...args) => ({ ...await prepare(...args), overlay: {
    configContent: JSON.stringify({ provider: { fixture: { models: { model: {} } } } }), primaryModel: "fixture/model", smallModel: null,
  } });
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  const handle = await service.run("leader", "subtask", {}, h.expected);
  await until(() => fs.existsSync(path.join(h.directory, "tail-ready")));
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
  assert.equal(read.value.executionBindings![0].requirements.temp, true);
  assert.equal(h.admission.entries()[0].responsibility.requirements.temp, true);
  fs.writeFileSync(path.join(h.directory, "exit"), "open"); fs.writeFileSync(path.join(h.directory, "drain"), "open");
  assert.equal((await handle.lifecycle!).streams.status, "confirmed");
});

test("process freezes authority before asynchronous ledger admission rather than adopting mutated routes", async (t) => {
  const h = await setup(t), register = h.store.registerLeaderExecution.bind(h.store);
  t.mock.method(h.store, "registerLeaderExecution", (...args: Parameters<typeof register>) => {
    const result = register(...args); h.leader.department!.routes.employee.model = "changed/model"; return result;
  });
  h.host.prepareLaunch = async () => { assert.fail("changed authority must not enter builder"); };
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", {}, h.expected), /authority-changed/);
  assert.equal(h.admission.entries()[0].executionId, null);
  assert.equal(h.admission.entries()[0].responsibility.selection.model, "fixture/model");
});

for (const mode of ["unbound", "wrong-role", "wrong-module", "module-not-running", "missing-capacity", "config-id", "bind-failed", "session-write-failed", "native-session-conflict"] as const) {
  test(`production preparation rejects ${mode} with zero task spawn`, { timeout: 15000 }, async (t) => {
    const h = await setup(t);
    if (mode === "unbound") h.leader.subTasks[0].executionSession!.sessionId = "local-fixture";
    if (mode === "wrong-role") h.leader.department!.role = "employee";
    if (mode === "wrong-module") h.root.subTasks[0].id = "foreign-module";
    if (mode === "module-not-running") h.root.subTasks[0].status = "completed";
    if (mode === "missing-capacity") {
      const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
      state.value.capacity.employees = []; assert.equal(h.store.write(state.value).ok, true);
    }
    if (mode === "config-id") h.expected.configId = "other";
    if (mode === "bind-failed") t.mock.method(h.store, "bindLeaderExecution", () => ({ ok: false, error: "controlled-write-failure" }));
    if (mode === "session-write-failed") h.host.updateTask = () => null;
    if (mode === "native-session-conflict") {
      const prepare = h.host.prepareLaunch;
      h.host.prepareLaunch = async (...args) => {
        const value = await prepare(...args); value.launch.baseEnvironment!.DEPARTMENT_FIXTURE_BAD_SESSION = "yes"; return value;
      };
    }
    const service = createDepartmentProcessPreparation(h.host);
    service.authorizeAttempt("leader", "subtask", "attempt");
    await assert.rejects(async () => service.run("leader", "subtask", {}, h.expected));
    assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
    const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
    assert.equal(state.value.executionBindings?.length ?? 0, 0);
    assert.equal(state.value.capacity.employees.length, mode === "missing-capacity" ? 0 : 1);
  });
}

test("production coordinator durably binds before launch, routes session output, preserves single spawn and real close/drain", { timeout: 15000 }, async (t) => {
  const h = await setup(t), service = createDepartmentProcessPreparation(h.host);
  service.authorizeAttempt("leader", "subtask", "attempt");
  let output = "", stderr = "", exited = false;
  const prepare = h.host.prepareLaunch;
  h.host.prepareLaunch = async (...args) => {
    assert.equal(h.admission.active, 1);
    assert.equal(h.admission.entries()[0].executionId, null);
    assert.equal(fs.existsSync(path.join(h.directory, "export-ready")), false);
    return prepare(...args);
  };
  const bind = h.store.bindLeaderExecution.bind(h.store);
  t.mock.method(h.store, "bindLeaderExecution", (...args: Parameters<typeof bind>) => {
    assert.equal(h.admission.active, 1);
    assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
    const result = bind(...args);
    assert.equal(h.admission.entries()[0].executionId, args[3].identity.executionId);
    return result;
  });
  const observed = service.observe("leader", "attempt");
  const first = service.run("leader", "subtask", { onStdout: (chunk) => { output += chunk; }, onStderr: (chunk) => { stderr += chunk; }, onExit: () => { exited = true; } }, h.expected);
  assert.equal(service.run("leader", "subtask", {}, h.expected), first);
  const handle = await first;
  assert.equal(h.admission.active, 0);
  assert.equal(h.admission.entries()[0].executionId !== null, true);
  await until(() => fs.existsSync(path.join(h.directory, "tail-ready")) && output.includes("正确会话回答"));
  const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
  const binding = state.value.executionBindings![0];
  const client = new DepartmentExecutionOwnerClient(path.join(h.directory, "owners", binding.identity.ownerId));
  assert.equal((await client.startExecution(binding.identity)).status, "live");
  const actual = JSON.parse(fs.readFileSync(path.join(h.directory, "observed"), "utf8"));
  assert.deepEqual(actual.identity, binding.identity, "real child read the durable exact binding before prompt execution");
  assert.equal(actual.ownerPid, h.workers[0].pid);
  assert.equal((await h.config.change(async () => ({ configId: "other", profileDigest: null }))).configId, "other");
  assert.equal(fs.readFileSync(path.join(h.directory, "spawn-count"), "utf8"), "spawn\n");
  let terminal = false; void handle.lifecycle!.then(() => { terminal = true; });
  fs.writeFileSync(path.join(h.directory, "exit"), "open");
  // A real descendant still holds the pipes. No timer/exit callback becomes close evidence.
  assert.equal((await client.observeExecution(binding.identity)).status, "live");
  assert.equal(terminal, false); assert.equal(exited, false); assert.ok(fs.existsSync(actual.cwd));
  fs.writeFileSync(path.join(h.directory, "drain"), "open");
  const facts = await handle.lifecycle!;
  assert.equal(facts.processTerminal.status, "confirmed"); assert.equal(facts.streams.status, "confirmed");
  assert.ok(output.includes("tail-output")); assert.ok(stderr.includes("tail-error"));
  await assert.rejects(observed.done, /cleanup-observation-unknown/);
  assert.equal((await client.observeExecution(binding.identity)).status, "unknown", "missing native/session/tab release cannot mint a receipt");
  await until(() => !fs.existsSync(actual.cwd));
  assert.equal((await client.startExecution(binding.identity)).status, "unknown");
  assert.equal(fs.readFileSync(path.join(h.directory, "spawn-count"), "utf8"), "spawn\n");
  assert.equal(state.value.capacity.employees.length, 1);
});

test("production host process exits while the original independent Node Owner retains the bound child; new host observes only", { timeout: 15000 }, async (t) => {
  const h = await setup(t);
  for (const task of h.tasks.values()) fs.writeFileSync(path.join(h.directory, task.id + "-task"), JSON.stringify(task));
  const host = fork(path.join(__dirname, "fixtures", "departmentprocessproductionhost.js"), [h.directory], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const [code] = await once(host, "exit"); assert.equal(code, 0);
  await until(() => fs.existsSync(path.join(h.directory, "tail-ready")));
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
  const binding = read.value.executionBindings![0];
  const client = new DepartmentExecutionOwnerClient(path.join(h.directory, "owners", binding.identity.ownerId));
  assert.equal((await client.observeExecution(binding.identity)).status, "live");
  const { ownerPid } = JSON.parse(fs.readFileSync(path.join(h.directory, "observed"), "utf8"));
  assert.notEqual(ownerPid, host.pid); assert.equal(process.kill(ownerPid, 0), true);
  const original = JSON.stringify(binding);
  h.host.employeeAdmission = null;
  const recovered = createDepartmentProcessPreparation(h.host);
  await assert.rejects(recovered.run("leader", "subtask", {}, h.expected), /existing-binding-observe-only:live/);
  assert.equal(JSON.stringify(read.value.executionBindings![0]), original);
  fs.writeFileSync(path.join(h.directory, "exit"), "open");
  assert.equal((await client.observeExecution(binding.identity)).status, "live");
  fs.writeFileSync(path.join(h.directory, "drain"), "open");
  await until(async () => (await client.observeExecution(binding.identity)).status === "unknown");
  assert.equal(fs.readFileSync(path.join(h.directory, "spawn-count"), "utf8"), "spawn\n");
});

test("private preparation rejects extra fields and public start is fenced until EH commit", { timeout: 15000 }, async (t) => {
  const h = await setup(t);
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "employee", configId: "profile", revision: h.current.revision,
    model: "fixture/model", thinkingMode: null, openCodeVariant: null };
  const input = { ...await h.host.prepareLaunch(selection, "ses_fixture"), ownerDirectory: path.join(h.directory, "owners", "owner"), selection,
    identity: { version: 1 as const, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module", generation: 1,
      cli: "opencode" as const, role: "employee" as const, subtaskId: "subtask", attemptId: "attempt", ownerId: "owner", executionId: "execution",
      session: { state: "bound" as const, id: "ses_fixture" }, ...fingerprintDepartmentExecutionSelection(selection) } };
  const wire = { ...input, version: 1, token: "a".repeat(64) };
  assert.equal(isDepartmentProcessPreparation(wire), true);
  for (const extra of ["module", "authContent", "profileDigest", "requirements"]) assert.equal(isDepartmentProcessPreparation({ ...wire, [extra]: "forbidden" }), false);
  const owner = await prepareDepartmentProcessOwner(input);
  const client = new DepartmentExecutionOwnerClient(input.ownerDirectory);
  assert.equal((await client.startExecution(input.identity)).status, "unknown");
  assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
  owner.abandon();
  await until(() => !fs.existsSync(path.join(input.ownerDirectory, "owner.lock")));
  assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
});

test("recovered missing binding has no live admission and never creates replacement Owner", async (t) => {
  const h = await setup(t), service = createDepartmentProcessPreparation(h.host);
  await assert.rejects(service.run("leader", "subtask", {}, h.expected), /no-live-admission/);
  assert.equal(fs.existsSync(path.join(h.directory, "owners")), false);
  assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
});

test("unstarted invocation rejects its bounded observation instead of waiting forever", async (t) => {
  const h = await setup(t), service = createDepartmentProcessPreparation(h.host);
  const observed = service.observe("leader", "attempt", "subtask");
  service.rejectUnstarted("leader", "subtask");
  await assert.rejects(observed.done, /never-started/);
  for (let i = 0; i < 255; i++) service.observe("leader", `other-${i}`, `sub-${i}`);
  assert.throws(() => service.observe("leader", "overflow", "overflow"), /observation-capacity/);
});

for (const mode of ["duplicate-preparation", "wrong-commit-identity"] as const) test(`private worker rejects ${mode} without task spawn`, { timeout: 15000 }, async (t) => {
  const h = await setup(t);
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "employee", configId: "profile", revision: h.current.revision,
    model: "fixture/model", thinkingMode: null, openCodeVariant: null };
  const input = { ...await h.host.prepareLaunch(selection, "ses_fixture"), version: 1, token: "b".repeat(64), ownerDirectory: path.join(h.directory, "owners", "owner"), selection,
    identity: { version: 1 as const, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module", generation: 1,
      cli: "opencode" as const, role: "employee" as const, subtaskId: "subtask", attemptId: "attempt", ownerId: "owner", executionId: "execution",
      session: { state: "bound" as const, id: "ses_fixture" }, ...fingerprintDepartmentExecutionSelection(selection) } };
  const worker = fork(path.join(__dirname, "..", "..", "runtime", "departmentprocessownerworker.js"), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const ended = once(worker, "exit");
  const prepared = once(worker, "message");
  worker.send(input);
  if (mode === "duplicate-preparation") { void prepared.catch(() => undefined); worker.send(input); }
  else {
    let operation = 0;
    let [message] = await prepared;
    while (message.type === "preparation-check") {
      const next = once(worker, "message");
      worker.send({ version: 1, token: input.token, operation: "preparation-checked", sequence: ++operation, identity: input.identity });
      [message] = await next;
    }
    assert.equal(message.type, "prepared");
    worker.send({ version: 1, token: input.token, operation: "commit", sequence: ++operation, identity: { ...input.identity, executionId: "other" } });
  }
  const [code] = await ended; assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
});

test("process producer revocation after atomic bind prevents final grant and late ACK revival", { timeout: 15000 }, async (t) => {
  const h = await setup(t), event = holdOwnerEvent(t, "launch-request");
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  const run = service.run("leader", "subtask", {}, h.expected), rejected = assert.rejects(run);
  await event.ready;
  assert.equal(h.admission.active, 1); assert.notEqual(h.admission.entries()[0].executionId, null);
  h.admission.revoke(); event.release(); await rejected; await until(event.exited);
  event.release(); assert.equal(h.admission.active, 0);
  assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
});

test("process rejects worker requirements inconsistent with preregistered policy", { timeout: 15000 }, async (t) => {
  const h = await setup(t), cp = require("child_process") as typeof import("child_process"), original = cp.fork;
  t.mock.method(cp, "fork", (...args: Parameters<typeof cp.fork>) => {
    assert.equal(h.admission.entries()[0].executionId, null);
    const child = original(...args), emit = child.emit.bind(child);
    child.emit = ((event: string, ...values: any[]) => {
      if (event === "message" && values[0]?.type === "prepared") values[0].requirements.tab = false;
      return emit(event, ...values);
    }) as typeof child.emit; return child;
  });
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", {}, h.expected), /requirements-conflict/);
  assert.equal(h.admission.entries()[0].executionId, null);
  assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
});

for (const stage of ["builder", "prepared", "committed", "launch-request"] as const) {
  for (const revoke of ["authority", "caller"] as const) {
    test(`prelaunch ${stage}: ${revoke} revocation prevents task spawn and late ACK revival`, { timeout: 15000 }, async (t) => {
      const h = await setup(t), controller = new AbortController();
      const event = stage === "builder" ? undefined : holdOwnerEvent(t, stage);
      let open!: () => void, entered!: () => void;
      const ready = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { open = resolve; });
      const prepare = h.host.prepareLaunch;
      if (stage === "builder") h.host.prepareLaunch = async (...args) => { const input = await prepare(...args); entered(); await gate; return input; };
      const service = createDepartmentProcessPreparation(h.host);
      service.authorizeAttempt("leader", "subtask", "attempt");
      const originalTask = JSON.stringify(h.leader);
      const first = service.run("leader", "subtask", {}, h.expected, undefined, { signal: controller.signal });
      const rejected = assert.rejects(first);
      await (event?.ready ?? ready);
      assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
      if (revoke === "caller") { controller.abort(); assert.equal(JSON.stringify(h.tasks.get("leader")), originalTask); }
      else h.root.status = "stopped";
      if (event) event.release(); else open();
      await rejected;
      if (event) await until(event.exited);
      assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
      if (revoke === "caller") assert.equal(service.run("leader", "subtask", {}, h.expected, undefined, { signal: controller.signal }), first);
      else await assert.rejects(service.run("leader", "subtask", {}, h.expected));
      const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
      assert.equal(saved.value.executionBindings?.length ?? 0, ["committed", "launch-request"].includes(stage) ? 1 : 0);
      assert.equal(saved.value.capacity.employees.length, 1);
      assert.equal(h.admission.entries().length, 1);
      assert.equal(h.admission.entries()[0].executionId === null, !["committed", "launch-request"].includes(stage));
      if (event && revoke === "caller") event.release(); // Even a repeated stale event cannot reopen the revoked channel.
    });
  }
}

for (const changed of ["leader-status", "module", "workspace", "generation", "attempt", "capacity", "session", "root-session", "leader-session", "leader-cli", "duplicate-subtask", "role-selection", "binding"] as const) {
  test(`prelaunch final grant rechecks authoritative ${changed}`, { timeout: 15000 }, async (t) => {
    const h = await setup(t), event = holdOwnerEvent(t, "launch-request");
    const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
    const running = service.run("leader", "subtask", {}, h.expected); const rejected = assert.rejects(running);
    await event.ready;
    const leader = h.tasks.get("leader")!;
    if (changed === "leader-status") leader.status = "stopped";
    if (changed === "module") h.root.subTasks[0].title = "changed";
    if (changed === "workspace") leader.workspaceKey = "foreign";
    if (changed === "attempt") {
      const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "subtask", attemptId: "other" }]);
      leader.loopPlus = scheduler.snapshot();
    }
    if (changed === "root-session") h.root.sessionId = "ses_rootchanged";
    if (changed === "leader-session") leader.sessionId = "ses_leaderchanged";
    if (changed === "leader-cli") leader.cli = "codex";
    if (changed === "duplicate-subtask") leader.subTasks.push({ ...leader.subTasks[0] });
    if (changed === "session") leader.subTasks[0].executionSession!.sessionId = "ses_other";
    if (changed === "role-selection") h.leader.department!.routes.employee.model = "changed/model";
    if (["generation", "capacity", "binding"].includes(changed)) {
      const read = h.store.read.bind(h.store);
      t.mock.method(h.store, "read", (...args: Parameters<typeof read>) => {
        const value = read(...args);
        if (value.ok && value.value) {
          if (changed === "generation") value.value.runtime.leaders[0].generation!++;
          if (changed === "capacity") value.value.capacity.employees = [];
          if (changed === "binding") value.value.executionBindings![0].requirements.tab = false;
        }
        return value;
      });
    }
    event.release(); await rejected; await until(event.exited);
    assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
  });
}

test("prelaunch ignores self-written timestamps; uncancelled final grant launches once and survives later caller abort", { timeout: 15000 }, async (t) => {
  const h = await setup(t), event = holdOwnerEvent(t, "launch-request"), controller = new AbortController();
  const update = h.host.updateTask;
  h.host.updateTask = (id, patch) => update(id, { ...patch, updatedAt: Date.now() + 100 });
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  const running = service.run("leader", "subtask", {}, h.expected, undefined, { signal: controller.signal });
  await event.ready;
  assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
  event.release(); const handle = await running;
  controller.abort();
  await until(() => fs.existsSync(path.join(h.directory, "tail-ready")));
  assert.equal(service.run("leader", "subtask", {}, h.expected), running);
  assert.equal(fs.readFileSync(path.join(h.directory, "spawn-count"), "utf8"), "spawn\n");
  fs.writeFileSync(path.join(h.directory, "exit"), "open"); fs.writeFileSync(path.join(h.directory, "drain"), "open");
  assert.equal((await handle.lifecycle!).streams.status, "confirmed");
});


for (const cancel of ["kill", "signal"] as const) test(`prelaunch stream ${cancel} cancels real native preparation with one error; probe must drain before lease release`, { timeout: 15000 }, async (t) => {
  const h = await setup(t), controller = new AbortController();
  const prepare = h.host.prepareLaunch;
  h.host.prepareLaunch = async (...args) => {
    const input = await prepare(...args); input.launch.baseEnvironment!.DEPARTMENT_FIXTURE_EXPORT_GATE = "yes"; return input;
  };
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  let errors = 0;
  const handle = startDepartmentProcessInvocation(service, "leader", "subtask", { onError: () => { errors++; } }, h.expected,
    h.host.prepareLaunch, { signal: controller.signal });
  await until(() => fs.existsSync(path.join(h.directory, "export-ready")));
  if (cancel === "kill") { assert.equal(handle.kill(), true); assert.equal(handle.kill(), false); }
  else controller.abort();
  assert.equal((await handle.lifecycle!).processTerminal.status, "unobservable");
  const worker = h.workers[0]; assert.ok(worker); assert.equal(worker.exitCode, null);
  fs.writeFileSync(path.join(h.directory, "export-open"), "open");
  await until(() => worker.exitCode !== null);
  assert.equal(worker.exitCode, 0);
  assert.equal(errors, 1); assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
  assert.equal(read.value.executionBindings?.length ?? 0, 0); assert.equal(read.value.capacity.employees.length, 1);
});

test("prelaunch stream successful bridge preserves business output and lifecycle after grant", { timeout: 15000 }, async (t) => {
  const h = await setup(t), controller = new AbortController();
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  let output = "", errors = 0, exits = 0;
  const handle = startDepartmentProcessInvocation(service, "leader", "subtask", {
    onStdout: (chunk) => { output += chunk; }, onError: () => { errors++; }, onExit: () => { exits++; },
  }, h.expected, h.host.prepareLaunch, { signal: controller.signal });
  await until(() => output.includes("正确会话回答") && fs.existsSync(path.join(h.directory, "tail-ready")));
  controller.abort();
  fs.writeFileSync(path.join(h.directory, "exit"), "open"); fs.writeFileSync(path.join(h.directory, "drain"), "open");
  const facts = await handle.lifecycle!;
  assert.equal(facts.streams.status, "confirmed"); assert.equal(facts.processTerminal.status, "confirmed");
  assert.ok(output.includes("tail-output")); assert.equal(errors, 0); assert.equal(exits, 1); assert.equal(handle.kill(), false);
});

test("employee native tab capability is fixed before output adoption and reused for final release", { timeout: 15000 }, async t => {
  const { createDepartmentExecutionResources } = await import("../../extensionHost/departmentexecutionresources");
  const { sameExecution } = await import("../../runtime/departmentexecutionidentity");
  const h = await setup(t);
  const tab = { id: "employee-tab", cli: "opencode", sessionId: null as string | null };
  let live = true, active = true, closed = 0;
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: () => live ? tab : null,
    isActive: () => active,
    owns: identity => {
      const saved = h.store.read("root", "workspace");
      return saved.ok && !!saved.value?.executionBindings?.some(binding => sameExecution(binding.identity, identity));
    },
    close: async original => { assert.equal(original, tab); closed++; live = false; },
  });
  resources.recordCreated(tab.id);
  const consumer = resources.beginConsumer(tab.id);
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  const handle = await service.run("leader", "subtask", {
    onStdout: () => { tab.sessionId = "ses_fixture"; },
    onExit: () => { active = false; consumer.finish(); },
    onError: () => { active = false; consumer.finish(false); },
  }, h.expected, h.host.prepareLaunch, { tabTarget: consumer.target });
  await until(() => fs.existsSync(path.join(h.directory, "tail-ready")));
  // Real stream adoption changes the visible tab after the immutable capability
  // must already be bound, while task/binding persist their fixed native session.
  tab.sessionId = "ses_fixture";
  fs.writeFileSync(path.join(h.directory, "exit"), "open"); fs.writeFileSync(path.join(h.directory, "drain"), "open");
  await handle.lifecycle;
  await service.observe("leader", "attempt").done;
  assert.equal(closed, 1); assert.equal(live, false);
});
