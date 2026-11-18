import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import { setup, until, holdOwnerEvent } from "./fixtures/departmentprocesspreparationfixture";
import { prepareDepartmentProcessOwner } from "../../extensionHost/departmentprocessbootstrap";
import { createDepartmentProcessPreparation } from "../../extensionHost/departmentprocesspreparation";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { isDepartmentProcessPreparation } from "../../runtime/departmentprocesspreparationcontract";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";

async function firstSession(t: test.TestContext, gates = false) {
  const h = await setup(t);
  delete h.leader.subTasks[0].executionSession;
  const original = h.host.prepareLaunch;
  h.host.prepareLaunch = async (...args) => {
    const prepared = await original(...args);
    prepared.launch.args[0] = path.join(__dirname, "fixtures", "departmentopencodesessioncli.js");
    prepared.launch.baseEnvironment!.DEPARTMENT_FIXTURE_TASK_FILE = path.join(h.directory, "tasks.json");
    if (gates) {
      prepared.launch.baseEnvironment!.DEPARTMENT_FIXTURE_CREATE_GATE = "yes";
      prepared.launch.baseEnvironment!.DEPARTMENT_FIXTURE_SERVER_CLOSE_GATE = "yes";
    }
    return prepared;
  };
  const update = h.host.updateTask;
  h.host.updateTask = (id, patch) => {
    const updated = update(id, patch);
    fs.writeFileSync(path.join(h.directory, "tasks.json"), JSON.stringify({ tasks: [...h.tasks.values()] }));
    return updated;
  };
  const file = (name: string) => path.join(h.directory, name);
  const open = (name: string) => fs.writeFileSync(file(name), "open");
  const exists = (name: string) => fs.existsSync(file(name));
  const service = createDepartmentProcessPreparation(h.host);
  service.authorizeAttempt("leader", "subtask", "attempt");
  return { ...h, file, open, exists, service };
}

test("first native session: responsibility, one creation, two durable confirmations, exact bound launch and observe-only reentry", { timeout: 15000 }, async (t) => {
  const h = await firstSession(t, true), stages: string[] = [];
  const builder = h.host.prepareLaunch;
  h.host.prepareLaunch = async (...args) => {
    assert.equal(h.admission.entries().length, 1);
    assert.equal(h.admission.entries()[0].executionId, null);
    stages.push(args[1] === null ? "unbound-builder" : "bound-builder");
    return builder(...args);
  };
  const update = h.host.updateTask, readTask = h.host.readTask;
  let wroteSession = false, readSession = false;
  h.host.updateTask = (id, patch) => {
    assert.equal(h.exists("spawn-count"), false);
    const result = update(id, patch); wroteSession = true; stages.push("session-write"); return result;
  };
  h.host.readTask = (id) => {
    const result = readTask(id);
    if (wroteSession && id === "leader") { readSession = true; stages.push("session-readback"); }
    return result;
  };
  const bind = h.store.bindLeaderExecution.bind(h.store);
  t.mock.method(h.store, "bindLeaderExecution", (...args: Parameters<typeof bind>) => {
    assert.equal(wroteSession && readSession, true);
    assert.equal(h.exists("spawn-count"), false);
    assert.equal(JSON.parse(fs.readFileSync(h.file("tasks.json"), "utf8")).tasks.find((v: { id: string }) => v.id === "leader")
      .subTasks[0].executionSession.sessionId, "ses_fixture");
    const result = bind(...args); stages.push("atomic-binding"); return result;
  });
  let output = "";
  const first = h.service.run("leader", "subtask", { onStdout: (chunk) => { output += chunk; } }, h.expected);
  assert.equal(h.service.run("leader", "subtask", {}, h.expected), first);
  await until(() => h.exists("create-ready"));
  assert.equal(h.exists("spawn-count"), false); assert.equal(wroteSession, false);
  assert.equal(h.admission.entries()[0].executionId, null);
  assert.equal((await h.config.change(async () => ({ configId: "other", profileDigest: null }))).configId, "other");
  h.open("create-open"); await until(() => h.exists("server-close-ready"));
  assert.equal(wroteSession, false, "server signal is not close/drain evidence");
  assert.equal(h.exists("spawn-count"), false);
  h.open("server-close-open");
  const handle = await first;
  await until(() => h.exists("tail-ready") && output.includes("正确会话回答"));
  assert.deepEqual(stages.filter((v) => !v.endsWith("readback")), ["unbound-builder", "bound-builder", "session-write", "atomic-binding"]);
  const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
  const binding = state.value.executionBindings![0];
  assert.deepEqual(binding.identity.session, { state: "bound", id: "ses_fixture" });
  assert.equal(h.admission.entries()[0].executionId, binding.identity.executionId);
  assert.equal(fs.readFileSync(h.file("create-count"), "utf8"), "create\n");
  assert.equal(fs.readFileSync(h.file("verify-count"), "utf8"), "verify\n");
  assert.equal(h.exists("unexpected-request"), false);
  assert.equal(fs.readFileSync(h.file("spawn-count"), "utf8"), "spawn\n");
  assert.equal(h.service.run("leader", "subtask", {}, h.expected), first);
  h.host.employeeAdmission = null;
  await assert.rejects(createDepartmentProcessPreparation(h.host).run("leader", "subtask", {}, h.expected), /existing-binding-observe-only:live/);
  const client = new DepartmentExecutionOwnerClient(path.join(h.host.ownerDirectory, binding.identity.ownerId));
  assert.equal((await client.startExecution(binding.identity)).status, "live");
  h.open("exit"); h.open("drain");
  const facts = await handle.lifecycle!;
  assert.equal(facts.processTerminal.status, "confirmed"); assert.equal(facts.streams.status, "confirmed");
  assert.equal(state.value.capacity.employees.length, 1);
  await until(async () => (await client.observeExecution(binding.identity)).status === "unknown");
  assert.equal(fs.readFileSync(h.file("create-count"), "utf8"), "create\n");
  assert.equal(fs.readFileSync(h.file("spawn-count"), "utf8"), "spawn\n");
});

for (const stage of ["create", "persist", "committed"] as const) {
  for (const revoke of ["caller", "authority", "configuration", "disconnect"] as const) {
    test(`first native ${stage}: ${revoke} prevents prompt and late preparation cannot revive`, { timeout: 15000 }, async (t) => {
      const h = await firstSession(t, true), controller = new AbortController();
      const event = holdOwnerEvent(t, stage === "committed" ? "committed" : stage === "persist" ? "prepared" : "native-session");
      const running = h.service.run("leader", "subtask", {}, h.expected, undefined, { signal: controller.signal });
      const rejected = assert.rejects(running);
      if (stage === "create") await until(() => h.exists("create-ready"));
      else { h.open("create-open"); h.open("server-close-open"); await event.ready; }
      assert.equal(h.exists("spawn-count"), false);
      const revokeNow = () => {
        if (revoke === "caller") controller.abort();
        if (revoke === "authority") h.root.status = "stopped";
        if (revoke === "configuration") h.tasks.get("leader")!.department!.routes.employee.configId = "changed";
        if (revoke === "disconnect") event.disconnect();
      };
      if (stage === "persist" && revoke !== "disconnect") {
        const update = h.host.updateTask;
        h.host.updateTask = (id, patch) => { const result = update(id, patch); revokeNow(); return result; };
        event.release();
      } else revokeNow();
      h.open("create-open"); h.open("server-close-open");
      // Preparation now rechecks host authority before returning a native-session event.
      // A revoked create must settle without waiting for an event it correctly never emits.
      if (stage === "committed") event.release();
      await rejected; await until(event.exited);
      if (stage !== "create") event.release();
      assert.equal(h.exists("spawn-count"), false);
      assert.equal(fs.readFileSync(h.file("create-count"), "utf8"), "create\n");
      const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
      assert.equal(read.value.capacity.employees.length, 1);
      assert.equal(h.admission.entries().length, 1);
      assert.equal(read.value.executionBindings?.length ?? 0, stage === "committed" ? 1 : 0);
      assert.equal(h.exists("unexpected-request"), false);
      // A new coordinator cannot create another session for an unknown original preparation.
      if (revoke === "authority") h.root.status = "running";
      if (revoke === "configuration") h.tasks.get("leader")!.department!.routes.employee.configId = "profile";
      const recovered = createDepartmentProcessPreparation(h.host); recovered.authorizeAttempt("leader", "subtask", "attempt");
      await assert.rejects(recovered.run("leader", "subtask", {}, h.expected), /reserved-or-unknown|existing-binding-observe-only/);
      assert.equal(fs.readFileSync(h.file("create-count"), "utf8"), "create\n");
    });
  }
}

test("first native final argv builder is cancellable without persisting or launching", { timeout: 15000 }, async (t) => {
  const h = await firstSession(t), controller = new AbortController(), builder = h.host.prepareLaunch;
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  h.host.prepareLaunch = async (...args) => {
    const value = await builder(...args);
    if (args[1] !== null) { entered(); await gate; }
    return value;
  };
  const run = h.service.run("leader", "subtask", {}, h.expected, undefined, { signal: controller.signal });
  const rejected = assert.rejects(run);
  await ready; controller.abort(); release(); await rejected;
  assert.equal(h.exists("spawn-count"), false);
  assert.equal(h.tasks.get("leader")!.subTasks[0].executionSession, undefined);
});

test("private unbound contract rejects conflicting session args and freezes every identity field", async (t) => {
  const h = await firstSession(t);
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "employee", configId: "profile", revision: h.expected.revision,
    model: "fixture/model", thinkingMode: null, openCodeVariant: null };
  const input = { ...await h.host.prepareLaunch(selection, null), version: 1, token: "a".repeat(64), selection, ownerDirectory: h.host.ownerDirectory,
    identity: { version: 1 as const, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module", generation: 1,
      cli: "opencode" as const, role: "employee" as const, subtaskId: "subtask", attemptId: "attempt", ownerId: "owner", executionId: "execution",
      session: { state: "unbound" as const }, ...fingerprintDepartmentExecutionSelection(selection) } };
  assert.equal(isDepartmentProcessPreparation(input), true);
  const { version: _version, token: _token, ...privatePrepared } = input;
  await assert.rejects(prepareDepartmentProcessOwner(privatePrepared), /native-finalizer-required/);
  assert.equal(h.exists("server-count"), false);
  assert.equal(isDepartmentProcessPreparation({ ...input, launch: { ...input.launch, args: [...input.launch.args, "--session", "ses_forged"] } }), false);
  assert.equal(isDepartmentProcessPreparation({ ...input, arbitrary: true }), false);
  assert.equal(isDepartmentProcessPreparation({ ...input, identity: { ...input.identity, generation: 0 } }), false);
  assert.equal(Object.keys(require.cache).some((file) => /vscodeMock|[/\\]cli[/\\]config\.js$/.test(file)), false,
    "the actual preparation/worker dependencies load in plain Node without installing a VS Code mock");
});

for (const stage of ["create", "persist", "committed", "launch-request"] as const) {
  test(`first native ${stage}: shared selection revision change preserves the admitted route`, { timeout: 15000 }, async (t) => {
    const h = await firstSession(t, true);
    const event = holdOwnerEvent(t, stage === "committed" || stage === "launch-request" ? stage : "prepared");
    const run = h.service.run("leader", "subtask", {}, h.expected);
    const replace = () => {
      const target = h.file("configuration/selection.json"), current = JSON.parse(fs.readFileSync(target, "utf8"));
      fs.writeFileSync(target, JSON.stringify({ ...current, revision: "externally-conflicting-revision" }));
    };
    if (stage === "create") { await until(() => h.exists("create-ready")); replace(); }
    else {
      h.open("create-open"); h.open("server-close-open"); await event.ready;
      if (stage === "persist") {
        const update = h.host.updateTask;
        h.host.updateTask = (id, patch) => { const result = update(id, patch); replace(); return result; };
        event.release();
      } else { replace(); event.release(); }
    }
    h.open("create-open"); h.open("server-close-open");
    if (stage === "create") { await event.ready; event.release(); }
    const handle = await run;
    await until(() => h.exists("tail-ready"));
    h.open("exit"); h.open("drain");
    assert.equal((await handle.lifecycle!).streams.status, "confirmed");
    await assert.rejects(h.service.observe("leader", "attempt").done, /cleanup-observation-unknown/);
    assert.equal(fs.readFileSync(h.file("spawn-count"), "utf8"), "spawn\n");
    assert.equal(h.admission.entries().length, 1);
    assert.equal(h.admission.entries()[0].responsibility.selection.revision, h.expected.revision);
  });
}

for (const field of ["ownerId", "executionId", "generation", "attemptId", "token", "sequence", "extra", "duplicate", "sessionId"] as const) {
  test(`first native private receipt rejects ${field} conflict without task spawn`, { timeout: 15000 }, async (t) => {
    const h = await firstSession(t), cp = require("child_process") as typeof import("child_process"), original = cp.fork;
    let exited = false;
    t.mock.method(cp, "fork", (...args: Parameters<typeof cp.fork>) => {
      const child = original(...args), emit = child.emit as (event: string | symbol, ...args: unknown[]) => boolean;
      child.once("exit", () => { exited = true; });
      t.mock.method(child, "emit", (event: string | symbol, ...args: any[]) => {
        if (event === "message" && args[0]?.type === "native-session") {
          const value = structuredClone(args[0]);
          if (field === "token") value.token = "f".repeat(64);
          else if (field === "sequence") value.sequence++;
          else if (field === "extra") value.extra = true;
          else if (field === "generation") value.identity.generation++;
          else if (field === "sessionId") value.identity.session.id = "ses_conflict";
          else if (field !== "duplicate") value.identity[field] = "foreign";
          if (field === "duplicate") emit.call(child, event, ...args);
          return emit.call(child, event, value);
        }
        return emit.call(child, event, ...args);
      });
      return child;
    });
    await assert.rejects(h.service.run("leader", "subtask", {}, h.expected)); await until(() => exited);
    assert.equal(h.exists("spawn-count"), false);
    assert.equal(h.tasks.get("leader")!.subTasks[0].executionSession, undefined);
    assert.equal(h.admission.entries()[0].executionId, null);
  });
}

test("first native final builder cannot drift task argv while binding the new session", { timeout: 15000 }, async (t) => {
  const h = await firstSession(t), builder = h.host.prepareLaunch;
  h.host.prepareLaunch = async (...args) => {
    const prepared = await builder(...args);
    if (args[1]) prepared.launch.args.push("unexpected-policy-drift");
    return prepared;
  };
  await assert.rejects(h.service.run("leader", "subtask", {}, h.expected));
  assert.equal(h.exists("spawn-count"), false);
  assert.equal(h.tasks.get("leader")!.subTasks[0].executionSession, undefined);
});

for (const failure of ["session-readback", "atomic-binding"] as const) {
  test(`first native ${failure} failure retains frozen ID and responsibility without prompt`, { timeout: 15000 }, async (t) => {
    const h = await firstSession(t);
    if (failure === "session-readback") {
      const update = h.host.updateTask;
      h.host.updateTask = (id, patch) => { const result = update(id, patch); h.tasks.get(id)!.subTasks[0].executionSession!.sessionId = "ses_conflict"; return result; };
    } else t.mock.method(h.store, "bindLeaderExecution", () => ({ ok: false, error: "controlled-failure" }));
    await assert.rejects(h.service.run("leader", "subtask", {}, h.expected));
    assert.equal(h.exists("spawn-count"), false);
    assert.equal(h.admission.entries()[0].executionId, null);
    const nativeRecords = fs.readdirSync(h.file("owners/opencode-preparations")).filter((name) => name.endsWith(".native.json"));
    assert.equal(nativeRecords.length, 1);
    const native = JSON.parse(fs.readFileSync(h.file("owners/opencode-preparations/" + nativeRecords[0]), "utf8"));
    assert.deepEqual(native.identity.session, { state: "bound", id: "ses_fixture" });
    assert.deepEqual(Object.keys(native).sort(), ["identity", "selection", "version"]);
  });
}

for (const mode of ["same-root", "wrong-directory", "retained-root", "root-replaced", "link-replaced"] as const) {
  test(`employee owned event directory: ${mode}`, { timeout: 15000 }, async t => {
    const h = await firstSession(t), prepare = h.host.prepareLaunch;
    h.host.prepareLaunch = async (...args) => {
      const p = await prepare(...args);
      if (mode === "wrong-directory") p.launch.baseEnvironment!.DEPARTMENT_FIXTURE_BAD_DIRECTORY = "yes";
      return p;
    };
    const event = mode === "root-replaced" || mode === "link-replaced" ? holdOwnerEvent(t, "launch-request") : undefined;
    const running = h.service.run("leader", "subtask", {}, h.expected);
    if (mode === "wrong-directory") {
      await assert.rejects(running);
      assert.equal(h.exists("spawn-count"), false);
      assert.equal(h.exists("create-count"), true);
      assert.equal(h.exists("server-closed"), true);
      assert.equal(h.admission.entries()[0].executionId, null);
      assert.equal(h.store.read("root", "workspace").ok, true);
      return;
    }
    if (event) {
      const rejected = assert.rejects(running); await event.ready;
      const cwd = fs.readFileSync(h.file("native-cwd"), "utf8");
      if (mode === "root-replaced") { fs.renameSync(cwd, cwd + "-original"); fs.mkdirSync(cwd); }
      else { fs.unlinkSync(path.join(cwd, "source.txt")); fs.writeFileSync(path.join(cwd, "source.txt"), "foreign"); }
      event.release(); await rejected; await until(event.exited);
      assert.equal(h.exists("spawn-count"), false);
      assert.equal(fs.existsSync(cwd), true);
      // Hygiene only: substituted resources are deliberately retained by the Owner.
      fs.rmSync(cwd, { recursive: true, force: true }); fs.rmSync(cwd + "-original", { recursive: true, force: true });
      return;
    }
    const handle = await running;
    await until(() => h.exists("tail-ready"));
    const cwd = fs.readFileSync(h.file("native-cwd"), "utf8");
    assert.equal(JSON.parse(fs.readFileSync(h.file("observed"), "utf8")).cwd, cwd);
    assert.notEqual(cwd, fs.realpathSync(h.file("workspace")));
    if (mode === "retained-root") fs.writeFileSync(path.join(cwd, "unknown-content"), "retain");
    h.open("exit"); h.open("drain");
    assert.equal((await handle.lifecycle!).streams.status, "confirmed");
    await assert.rejects(h.service.observe("leader", "attempt").done);
    if (mode === "retained-root") {
      assert.equal(fs.existsSync(cwd), true);
      fs.rmSync(cwd, { recursive: true, force: true }); // hygiene, never evidence
    } else await until(() => !fs.existsSync(cwd));
  });
}

test("employee bound session uses GET only and refuses a foreign native directory without replacement", { timeout: 15000 }, async t => {
  const h = await setup(t), prepare = h.host.prepareLaunch;
  h.host.prepareLaunch = async (...args) => {
    const p = await prepare(...args); p.launch.baseEnvironment!.DEPARTMENT_FIXTURE_BAD_DIRECTORY = "yes"; return p;
  };
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", {}, h.expected));
  assert.equal(fs.existsSync(path.join(h.directory, "create-count")), false);
  assert.equal(fs.readFileSync(path.join(h.directory, "verify-count"), "utf8"), "verify\n");
  assert.equal(fs.existsSync(path.join(h.directory, "spawn-count")), false);
  const next = createDepartmentProcessPreparation(h.host); next.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(next.run("leader", "subtask", {}, h.expected), /reserved-or-unknown/);
});

test("employee private argv rejects instance overrides before any native preparation", async t => {
  const h = await setup(t);
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "employee", configId: "profile", revision: h.current.revision,
    model: "fixture/model", thinkingMode: null, openCodeVariant: null };
  const p = await h.host.prepareLaunch(selection, null);
  const wire = { ...p, version: 1, token: "a".repeat(64), ownerDirectory: path.join(h.directory, "owners", "owner"), selection,
    identity: { version: 1, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module", generation: 1,
      cli: "opencode", role: "employee", subtaskId: "subtask", attemptId: "attempt", ownerId: "owner", executionId: "execution",
      session: { state: "unbound" }, ...fingerprintDepartmentExecutionSelection(selection) } };
  for (const arg of ["--dir", "--dir=/foreign", "--directory=/foreign", "--cwd=/foreign", "--attach", "--attach=http://127.0.0.1", "--continue", "-c", "-cfoo", "--fork"]) {
    assert.equal(isDepartmentProcessPreparation({ ...wire, launch: { ...p.launch, args: [...p.launch.args, arg] } }), false, arg);
  }
});

for (const retain of [false, true]) test(`employee same root full receipt ${retain ? "retains unknown root and capacity" : "waits original consumer and naturally retires the Owner"}`, { timeout: 15000 }, async t => {
  const h = await firstSession(t);
  const { createDepartmentExecutionResources } = await import("../../extensionHost/departmentexecutionresources");
  const tabs = new Map([["employee", { id: "employee", cli: "opencode", sessionId: "local_employee" }]]);
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: id => tabs.get(id) ?? null,
    isActive: () => false, owns: i => {
      const saved = h.store.read("root", "workspace");
      return !!(saved.ok && saved.value?.executionBindings?.some(b => JSON.stringify(b.identity) === JSON.stringify(i)));
    }, close: async tab => { tabs.delete(tab.id); } });
  resources.recordCreated("employee"); const consumer = resources.beginConsumer("employee");
  let originalClient: DepartmentExecutionOwnerClient | undefined;
  h.host.retainOriginalClient = (_binding, client) => { originalClient = client; };
  const stopped = holdOwnerEvent(t, "stopped");
  const handle = await h.service.run("leader", "subtask", {}, h.expected, undefined, { tabTarget: consumer.target });
  await until(() => h.exists("tail-ready"));
  const cwd = fs.readFileSync(h.file("native-cwd"), "utf8");
  if (retain) fs.writeFileSync(path.join(cwd, "unknown-owned-root-content"), "preserve");
  h.open("exit"); h.open("drain"); await handle.lifecycle;
  assert.equal(tabs.size, 1);
  let complete = false; const done = h.service.observe("leader", "attempt").done.then(() => { complete = true; });
  if (retain) {
    const rejected = assert.rejects(done); consumer.finish(); await rejected;
    assert.equal(complete, false); assert.equal(tabs.size, 0);
    assert.equal(fs.existsSync(cwd), true);
    const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
    assert.equal(saved.value.capacity.employees.length, 1); assert.equal(saved.value.capacity.leaders.length, 1);
    const b = saved.value.executionBindings![0]; assert.ok(originalClient);
    assert.equal((await originalClient.observeExecution(b.identity)).status, "unknown");
    fs.rmSync(cwd, { recursive: true, force: true }); // hygiene only, after failed receipt assertion
    return;
  }
  consumer.finish(); await stopped.ready;
  assert.equal(complete, false, "receipt alone does not confirm original worker retirement");
  assert.equal(tabs.size, 0); assert.equal(fs.existsSync(cwd), false);
  stopped.release(); await done; await until(stopped.exited);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  const binding = saved.value.executionBindings![0];
  assert.ok(originalClient);
  const receipt = await originalClient.waitForCleanup(binding.identity, binding.requirements);
  for (const [part, required] of Object.entries(binding.requirements)) if (required) assert.equal(receipt.cleanup[part as keyof typeof receipt.cleanup].status, "confirmed", part);
});

for (const stage of ["realpath", "assert"] as const) for (const cleanup of ["confirmed", "retained"] as const) {
  test(`employee root capability capture: first ${stage} failure with ${cleanup} original cleanup`, { timeout: 15000 }, async t => {
    const h = await firstSession(t);
    const cp = require("child_process") as typeof import("child_process"), fork = cp.fork;
    let worker: import("child_process").ChildProcess | undefined;
    const events: string[] = [];
    t.mock.method(cp, "fork", (...args: Parameters<typeof cp.fork>) => {
      assert.equal(h.admission.entries().length, 1, "reservation predates the worker and its root");
      assert.equal(h.admission.entries()[0].executionId, null);
      const child = fork(path.join(__dirname, "fixtures", "departmentrootcapturefailureworker.js"), [stage, cleanup, h.directory], args[2]);
      worker = child;
      child.on("message", (message: { type?: string }) => { if (message.type) events.push(message.type); });
      return child;
    });
    let cwd: string | undefined;
    t.after(() => { if (cwd) fs.rmSync(cwd, { recursive: true, force: true }); }); // hygiene only
    await assert.rejects(h.service.run("leader", "subtask", {}, h.expected));
    await until(() => worker?.exitCode !== null && worker?.exitCode !== undefined);
    const audit = fs.readFileSync(h.file("root-capture-audit"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    cwd = audit[0].cwd;
    assert.deepEqual(audit.map(entry => entry.event), ["created", "first-check-failed", "dispose-called", "dispose-result"]);
    assert.equal(audit[0].pid, worker!.pid);
    assert.equal(audit[1].stage, stage);
    assert.equal(audit[2].cwd, cwd, "dispose uses the original allocated root");
    assert.equal(audit[3].result.ok, cleanup === "confirmed");
    if (cleanup === "confirmed") assert.equal(audit[3].result.retainedDirectory, false);
    else {
      assert.equal(typeof audit[3].result.reason, "string");
      assert.equal(fs.readFileSync(path.join(cwd!, "unknown-content"), "utf8"), "retain");
    }
    assert.equal(fs.existsSync(cwd!), cleanup === "retained");
    assert.deepEqual(events, ["rejected"], "no native result, prepared binding, or grant request");
    for (const marker of ["server-count", "create-count", "verify-count", "spawn-count"]) assert.equal(h.exists(marker), false, marker);
    assert.equal(h.tasks.get("leader")!.subTasks[0].executionSession, undefined);
    const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
    assert.equal(state.value.executionBindings?.length ?? 0, 0);
    assert.equal(state.value.capacity.employees.length, 1);
    assert.equal(state.value.capacity.leaders.length, 1);
    assert.equal(h.admission.entries().length, 1, "failed attempt responsibility stays reserved even after confirmed preparation disposal");
    const recovered = createDepartmentProcessPreparation(h.host); recovered.authorizeAttempt("leader", "subtask", "attempt");
    await assert.rejects(recovered.run("leader", "subtask", {}, h.expected), /reserved-or-unknown/);
    assert.equal(audit.filter(entry => entry.event === "dispose-called").length, 1);
    assert.equal(worker!.signalCode, null, "worker retires naturally; teardown is not cleanup evidence");
    t.diagnostic(JSON.stringify({ stage, cleanup, workerPid: worker!.pid, naturallyExited: true, rootRetainedBeforeHygiene: fs.existsSync(cwd!) }));
  });
}
