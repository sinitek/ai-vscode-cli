import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { productionWiring, until } from "./fixtures/departmentproductionwiringfixture";
import { DepartmentGenerationAuthorityClient } from "../../runtime/departmentgenerationauthorityclient";
import { departmentGenerationAuthorityDirectory } from "../../runtime/departmentgenerationauthority";

function scenario(name: string, run: (t: test.TestContext) => Promise<void>) {
  const selected = process.env.DEPARTMENT_COLD_GENERATION_SCENARIO;
  if (selected) { if (selected === name) test(name, { timeout: 30000 }, run); return; }
  test(name, { timeout: 40000 }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-cold-generation-user-"));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), DEPARTMENT_COLD_GENERATION_SCENARIO: name };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", __filename], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", v => { output += v; }); child.stderr.on("data", v => { output += v; });
    let timer: NodeJS.Timeout | undefined;
    try {
      const code = await Promise.race([new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error("cold-generation-test-timeout\n" + output)); }, 35000); })]);
      assert.equal(code, 0, output); assert.match(output, /# pass 1\b/);
    } finally { clearTimeout(timer); fs.rmSync(home, { recursive: true, force: true }); }
  });
}

scenario("original independent authority escrows full production Owner receipts before endpoints retire", async t => {
  const h = await productionWiring(t, "codex", true, false, 1, undefined, "codex", true, true);
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "backend", writeFiles: [],
    prompt: "Implement this isolated employee requirement completely and verify actual source and report all real changes and results." }] });
  h.answer(2, { status: "wait", finalSummary: "等待原责任证明" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => h.entries().length === 2 && h.entries().every(e => !!e.executionId));
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  const set = saved.value.leaderExecutionSets![0];
  const directory = departmentGenerationAuthorityDirectory(h.file("authorities"), set.scope);
  const cold = new DepartmentGenerationAuthorityClient(directory, set.scope, set.producerId);
  const competitor = new DepartmentGenerationAuthorityClient(directory, set.scope, set.producerId);
  await until(async () => (await cold.observe()).tickets.every(ticket => ticket.state === "started"));
  const results = await Promise.allSettled([cold.control("cold-one"), competitor.control("cold-two")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const id = results[0].status === "fulfilled" ? "cold-one" : "cold-two";
  const controller = results[0].status === "fulfilled" ? cold : competitor;
  await until(async () => {
    const recovery = await controller.recovery(id);
    if (recovery.state === "unknown") throw new Error(JSON.stringify({ recovery, snapshot: await controller.observe(), close: await h.producer.close(launch.taskId) }));
    return recovery.state === "closed";
  });
  const complete = await controller.recovery(id);
  assert.ok(complete.closure);
  assert.equal(complete.closure.producerId, set.producerId);
  const final = await controller.observe(); assert.equal(final.tickets.length, 2);
  assert.ok(final.tickets.every(ticket => ticket.state === "released"));
  const current = h.store.read("root", "workspace"); assert.ok(current.ok && current.value);
  assert.equal(current.value.leaderExecutionSets![0].state, "closed");
  assert.equal(current.value.capacity.leaders.length, 1);
  assert.equal(current.value.capacity.employees.length, 0, "the original employee lifecycle releases only after its actual full receipt");
  await controller.retire(id);
  const worker = h.workers.find(w => w.module.endsWith("departmentgenerationauthorityworker.js"))!;
  await until(() => worker.child.exitCode !== null); assert.equal(worker.child.exitCode, 0); assert.equal(worker.child.signalCode, null);
});


import { coldGenerationHost } from "./fixtures/departmentcoldgenerationhost";
scenario("cold production repository authenticates original complete generation and durably releases before unique successor", async t => {
  const h = await productionWiring(t, "codex", true, false, 1, undefined, "codex", true, true);
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "backend", writeFiles: [],
    prompt: "Implement this isolated employee requirement completely, verify actual source and report the changes and results." }] });
  h.answer(2, { status: "wait", finalSummary: "等待完整责任收尾" });
  // A restored employee finish may wake another real leader review. "blocked"
  // requires its own follow-up verification round; this scenario instead waits
  // for explicit public stop and must not fall through to an unconfigured answer.
  h.answer(3, { status: "wait", finalSummary: "后继真实执行已完成，等待验收" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => h.entries().length === 2 && h.entries().every(e => !!e.executionId));
  const before = h.store.read("root", "workspace"); assert.ok(before.ok && before.value);
  const original = before.value.leaderExecutionSets![0], bindings = before.value.executionBindings!;
  const authorityDirectory = departmentGenerationAuthorityDirectory(h.file("authorities"), original.scope);
  const observer = new DepartmentGenerationAuthorityClient(authorityDirectory, original.scope, original.producerId);
  await until(async () => (await observer.observe()).tickets.every(t => t.state === "started"));
  // Original production lifecycle finishes actual resources; shared leader capacity
  // remains held because the original host has no group-release observation.
  assert.deepEqual(await h.producer.close(launch.taskId), { ok: true });
  const originalTask = h.read(launch.taskId)!;
  assert.notEqual(originalTask.sessionId, originalTask.executionSession!.sessionId);
  fs.writeFileSync(h.file(`transcript-codex-${originalTask.sessionId}.json`), JSON.stringify(h.fixture.getMessages("leader-tab")));
  const authority = h.workers.find(w => w.module.endsWith("departmentgenerationauthorityworker.js"))!;
  authority.child.disconnect();
  assert.equal(await h.source.close(), true);
  const cold = await coldGenerationHost(t, h.directory);
  assert.throws(() => cold.producer.scope(launch.taskId), /no-live-generation/);
  await cold.composition.organizationControl.stop(cold.read("root")!);
  const released = cold.store.read("root", "workspace"); assert.ok(released.ok && released.value);
  assert.equal(released.value.leaderExecutionSets![0].state, "closed");
  assert.deepEqual(released.value.executionBindings, bindings);
  assert.deepEqual(released.value.capacity.leaders, []); assert.deepEqual(released.value.capacity.employees, []);
  assert.equal(cold.restored, 1); assert.equal(cold.runs, 0, "public stop never replays a prompt");
  assert.equal(cold.producer.canContinueLeader(launch.taskId), true);
  await until(() => authority.child.exitCode !== null); assert.equal(authority.child.exitCode, 0); assert.equal(authority.child.signalCode, null);
  const result = await cold.composition.host.continueRoot("root"); assert.ok(result.ok, JSON.stringify(result));
  await until(() => cold.runs === 1 && h.wire().filter(m => m.method === "turn/start").length >= 2);
  const continued = cold.store.read("root", "workspace"); assert.ok(continued.ok && continued.value);
  const next = continued.value.leaderExecutionSets!.find(s => s.scope.generation > original.scope.generation)!; assert.ok(next);
  const nextBinding = continued.value.executionBindings!.find(b => b.identity.generation === next.scope.generation)!; assert.ok(nextBinding);
  const oldBinding = bindings.find(b => b.identity.role === "leader")!;
  assert.notEqual(next.producerId, original.producerId); assert.notEqual(nextBinding.identity.ownerId, oldBinding.identity.ownerId);
  assert.notEqual(nextBinding.identity.executionId, oldBinding.identity.executionId);
  assert.deepEqual(nextBinding.identity.session, oldBinding.identity.session);
  assert.equal(cold.read(launch.taskId)!.sessionId, originalTask.sessionId);
  assert.ok(h.wire().some(m => m.method === "thread/resume" && m.params.threadId === "native"));
  await cold.fixture.adapter.waitForTaskIdle(launch.taskId);
  try { await cold.composition.organizationControl.stop(cold.read("root")!); }
  catch (error) { t.diagnostic(JSON.stringify(cold.diagnostics)); throw error; }
  const successorAuthority = h.workers.filter(w => w.module.endsWith("departmentgenerationauthorityworker.js"))[1];
  assert.equal(successorAuthority.child.exitCode, 0); assert.equal(successorAuthority.child.signalCode, null);
});

import { DepartmentColdGenerationRecovery } from "../../extensionHost/departmentcoldgenerationrecovery";
import { createDepartmentStoredLeaderIdentityReader } from "../../extensionHost/departmentleaderstoredidentity";
import { resolveLoopConversationTabContextFromMessages } from "../../panelStateBuilder";
import { gate } from "./fixtures/departmentproductionwiringfixture";
import { createDepartmentExecutionProducer } from "../../extensionHost/departmentexecutionproducer";
import type { LoopTaskRecord } from "../../loopTaskStore";

function observerFor(h: Awaited<ReturnType<typeof productionWiring>>, options: {
  read?: (id: string) => LoopTaskRecord | null; verify?: () => Promise<boolean>; authorityDirectory?: string;
} = {}) {
  let targets = 0;
  const readTask = options.read ?? h.read;
  const identity = createDepartmentStoredLeaderIdentityReader({ store: h.store, workspaceKey: () => "workspace",
    readSessionContext: (cli, id) => {
      const messages = h.fixture.getMessages("leader-tab");
      const context = resolveLoopConversationTabContextFromMessages(messages);
      const task = context.loopTaskId ? h.read(context.loopTaskId) : null;
      return task?.cli === cli && task.sessionId === id ? context : { taskRole: null, loopTaskId: null };
    } });
  const recovery = new DepartmentColdGenerationRecovery({ store: h.store, authorityDirectory: options.authorityDirectory ?? h.file("authorities"),
    workspaceKey: () => "workspace", readTask, verifyStoredIdentity: identity, verifySelection: options.verify ?? (async () => true),
    registerRestoredTarget() { assert.fail("negative-test-registration"); },
    restoreTarget() { targets++; throw new Error("negative-test-must-not-create-target"); }, acceptRetirement() { assert.fail("negative-test-retirement"); } });
  return { recovery, get targets() { return targets; } };
}

scenario("cold preflight rejects scope session configuration and generation drift before targets or capacity mutation", async t => {
  const h = await productionWiring(t, "codex", true, false, 1, undefined, "codex", true, true);
  const held = gate(); let firstOutput = true; h.beforeLeaderCallback(async () => { if (firstOutput) firstOutput = false; else await held.promise; }); t.after(() => held.resolve());
  h.answer(1, { status: "blocked", finalSummary: "保留原生产身份" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => !!h.read(launch.taskId)?.executionSession && h.entries().some(e => !!e.executionId));
  await until(() => h.fixture.getMessages("leader-tab").length > 0 && h.mainInvocations.length >= 2);
  await until(() => h.wire().filter(m => m.method === "turn/start").length >= 2);
  const nativeGrants = h.wire().filter(m => m.method === "turn/start").length;
  const original = h.read(launch.taskId)!, root = h.read("root")!;
  const capacity = h.composition.readCapacity("root");
  for (const change of ["workspace", "root", "local-session", "native-session", "selection"] as const) {
    const probe = observerFor(h, { read(id) {
      const task = structuredClone(h.read(id)); if (!task || id !== original.id) return task;
      if (change === "workspace") task.workspaceKey = "foreign";
      if (change === "root") task.department = { ...task.department!, rootTaskId: "foreign" };
      if (change === "local-session") task.sessionId = "foreign-local";
      if (change === "native-session") task.executionSession = { ...task.executionSession!, sessionId: "foreign-native" };
      if (change === "selection") task.department = { ...task.department!, routes: { ...task.department!.routes, leader: { ...task.department!.routes.leader, model: "foreign-model" } } };
      return task;
    } });
    await assert.rejects(probe.recovery.prepare(root, () => {}), /identity-conflict|session-or-selection-conflict/);
    assert.equal(probe.targets, 0);
  }
  const originalRead = h.store.read.bind(h.store);
  const shifted = t.mock.method(h.store, "read", (...args: Parameters<typeof originalRead>) => {
    const value = originalRead(...args); if (value.ok && value.value) value.value.runtime.leaders[0].generation!++;
    return value;
  });
  await assert.rejects(observerFor(h).recovery.prepare(root, () => {}), /identity-conflict|responsibility-incomplete/);
  shifted.mock.restore();
  const changedConfig = observerFor(h, { verify: async () => false });
  await assert.rejects(changedConfig.recovery.prepare(root, () => {}), /config-conflict/);
  const hungConfig = observerFor(h, { verify: () => new Promise<boolean>(() => {}) });
  const deadlineStart = Date.now();
  await assert.rejects(hungConfig.recovery.prepare(root, () => {}, 80), /generation-deadline/);
  assert.ok(Date.now() - deadlineStart < 2_000, "configuration wait shares the original bounded deadline");
  assert.equal(hungConfig.targets, 0);
  const noCapability = observerFor(h, { authorityDirectory: h.file("missing-original-capability") });
  await assert.rejects(noCapability.recovery.prepare(root, () => {}), /authority-unavailable/);
  const invalidated = observerFor(h);
  await assert.rejects(invalidated.recovery.prepare(root, () => { throw new Error("public-control-revoked"); }), /public-control-revoked/);
  assert.deepEqual(h.composition.readCapacity("root"), capacity); assert.equal(h.wire().filter(m => m.method === "turn/start").length, nativeGrants);
  assert.equal(invalidated.targets, 0); held.resolve();
});

scenario("cold control seals incomplete employee preparation and retains its exact unknown ticket and capacity", async t => {
  const h = await productionWiring(t, "codex", true, false, 1, undefined, "codex", true, true);
  const entered = gate(), release = gate(); h.beforeEmployeeBuilder(async () => { entered.resolve(); await release.promise; });
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "backend", writeFiles: [],
    prompt: "Implement this complete isolated employee requirement and verify source changes with meaningful evidence and actual results." }] });
  const launch = await h.start(); assert.ok(launch.ok); await entered.promise;
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value); const set = saved.value.leaderExecutionSets![0];
  const client = new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(h.file("authorities"), set.scope), set.scope, set.producerId);
  const probe = observerFor(h);
  const pending = probe.recovery.prepare(h.read("root")!, () => {}); const rejected = assert.rejects(pending, /unverifiable|changed-during-control|deadline/);
  await until(async () => (await client.observe()).state === "sealed");
  release.resolve(); await rejected;
  await until(async () => (await client.observe()).tickets.some(t => t.target.role === "employee" && t.state === "unknown"));
  const observed = await client.observe(); const employee = observed.tickets.find(t => t.target.role === "employee")!;
  assert.equal(employee.identity, null); assert.equal(employee.state, "unknown");
  assert.equal(observed.tickets.length, 2); assert.equal(probe.targets, 0);
  assert.equal(h.wire(h.file("employee")).filter(m => m.method === "turn/start").length, 0);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1); assert.equal(h.composition.readCapacity("root")!.employees.length, 1);
  assert.deepEqual(probe.recovery.lifecycleState(), { prepared: 0, controls: 1, preparing: 0 });
  await assert.rejects(probe.recovery.prepare(h.read("root")!, () => {}), /unverifiable|changed-during-control|deadline/);
  assert.deepEqual(probe.recovery.lifecycleState(), { prepared: 0, controls: 1, preparing: 0 }, "retry retains the exact unknown control without accumulating targets");
});

scenario("cold durable capacity failure blocks successor and retains the original authority endpoint", async t => {
  const h = await productionWiring(t, "codex", true, false, 1, undefined, "codex", true, true);
  h.answer(1, { status: "wait", finalSummary: "待原容量持久移除" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => !!h.read(launch.taskId)?.executionSession); await h.fixture.adapter.waitForTaskIdle(launch.taskId);
  assert.deepEqual(await h.producer.close(launch.taskId), { ok: true });
  const task = h.read(launch.taskId)!;
  fs.writeFileSync(h.file(`transcript-codex-${task.sessionId}.json`), JSON.stringify(h.fixture.getMessages("leader-tab")));
  const worker = h.workers.find(w => w.module.endsWith("departmentgenerationauthorityworker.js"))!; worker.child.disconnect();
  assert.equal(await h.source.close(), true);
  const cold = await coldGenerationHost(t, h.directory);
  const write = cold.store.write.bind(cold.store);
  t.mock.method(cold.store, "write", (value: Parameters<typeof write>[0]) => value.capacity.leaders.length === 0
    ? { ok: false as const, error: "injected-capacity-persistence-failure" } : write(value));
  await assert.rejects(cold.composition.organizationControl.stop(cold.read("root")!), /尚未核验全部执行清理/);
  const saved = cold.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.equal(saved.value.capacity.leaders.length, 1); assert.equal(saved.value.leaderExecutionSets![0].state, "closed");
  assert.equal(cold.producer.canContinueLeader(launch.taskId), false); assert.equal(cold.runs, 0);
  assert.equal(worker.child.exitCode, null); assert.equal(worker.child.signalCode, null);
  const replacement = createDepartmentExecutionProducer({ store: cold.store, readTask: cold.read, workspaceKey: () => "workspace", validateRoutes: () => true,
    processOverlay: "required", authorityDirectory: h.file("authorities"), ownerDirectory: h.file("owners") });
  await assert.rejects(replacement.openContinuedLeader(launch.taskId, 3), /continuation-unverified/);
});

scenario("cold original endpoint loss retains complete durable set and forbids a replacement producer", async t => {
  const h = await productionWiring(t, "codex", true, false, 1, undefined, "codex", true, true);
  h.answer(1, { status: "blocked", finalSummary: "不得推断失联端点已清理" });
  const launch = await h.start(); assert.ok(launch.ok); await until(() => !!h.read(launch.taskId)?.executionSession);
  await h.fixture.adapter.waitForTaskIdle(launch.taskId);
  const before = h.store.read("root", "workspace"); assert.ok(before.ok && before.value);
  const worker = h.workers.find(w => w.module.endsWith("departmentgenerationauthorityworker.js"))!;
  const exited = new Promise<void>(resolve => worker.child.once("exit", () => resolve())); worker.child.kill(); await exited; // Fault injection only.
  const probe = observerFor(h);
  await assert.rejects(probe.recovery.prepare(h.read("root")!, () => {}), /authority-unreachable|authority-disconnected/);
  assert.equal(probe.targets, 0); assert.deepEqual(h.store.read("root", "workspace"), before);
  const failed = await h.producer.close(launch.taskId); assert.equal(failed.ok, false);
  const retained = h.store.read("root", "workspace"); assert.ok(retained.ok && retained.value);
  assert.equal(retained.value.leaderExecutionSets![0].state, "open"); assert.equal(retained.value.capacity.leaders.length, 1);
});

scenario("cold asynchronous configuration preflight rechecks authoritative task and revoked request", async t => {
  const h = await productionWiring(t, "codex", true, false, 1, undefined, "codex", true, true);
  const held = gate(); let firstOutput = true; h.beforeLeaderCallback(async () => { if (firstOutput) firstOutput = false; else await held.promise; }); t.after(() => held.resolve());
  h.answer(1, { status: "blocked", finalSummary: "保留身份" });
  const launch = await h.start(); assert.ok(launch.ok); await until(() => !!h.read(launch.taskId)?.executionSession);
  await until(() => h.fixture.getMessages("leader-tab").length > 0 && h.mainInvocations.length >= 2);
  const entered = gate(), release = gate();
  const probe = observerFor(h, { verify: async () => { entered.resolve(); await release.promise; return true; } });
  const preparing = probe.recovery.prepare(h.read("root")!, () => {}); const rejected = assert.rejects(preparing, /changed-during-control/);
  await entered.promise;
  assert.ok(h.update(launch.taskId, { supplementalRequirements: ["在等待期间变更的真实要求"] }));
  release.resolve(); await rejected;
  assert.equal(probe.targets, 0); const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  const set = saved.value.leaderExecutionSets![0];
  const client = new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(h.file("authorities"), set.scope), set.scope, set.producerId);
  assert.equal((await client.observe()).state, "open", "invalidated preflight cannot acquire control or launch");
  assert.equal(saved.value.capacity.leaders.length, 1); held.resolve();
});

scenario("OpenCode cold original directory capability survives host loss and retires before unique native successor", async t => {
  const h = await productionWiring(t, "codex", true, true, 1, undefined, "opencode", true, true);
  const observing = gate();
  // Freeze only the original host's organization observation at a controlled
  // host-loss boundary. This promise never supplies cleanup evidence; the
  // independent service must obtain every real receipt and stopped handshake.
  // A disconnected host cannot resume its old projection into the successor.
  h.beforeLeaderCleanup(() => { observing.resolve(); return new Promise<void>(() => {}); });
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "backend", writeFiles: [],
    prompt: "Implement this isolated employee requirement completely, verify actual source and report actual changes and results." }] });
  for (let n = 2; n <= 8; n++) h.answer(n, { status: "blocked", finalSummary: "等待原资源凭证与公开控制" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => h.entries().length === 2 && h.entries().every(e => !!e.executionId));
  await h.fixture.adapter.waitForTaskIdle(launch.taskId);
  await observing.promise;
  assert.notEqual(h.composition.host.runtimeSnapshot("root")!.leaders[0].status, "blocked", "host loss precedes an unverified observation result");
  assert.deepEqual(await h.producer.close(launch.taskId), { ok: true });
  const originalTask = h.read(launch.taskId)!;
  const before = h.store.read("root", "workspace"); assert.ok(before.ok && before.value);
  const original = before.value.leaderExecutionSets![0], bindings = before.value.executionBindings!;
  const oldBinding = bindings.find(b => b.identity.role === "leader")!;
  const oldDirectory = fs.readFileSync(h.file("cold-native-directory"), "utf8");
  assert.equal(fs.existsSync(oldDirectory), false);
  assert.notEqual(originalTask.sessionId, originalTask.executionSession!.sessionId);
  fs.writeFileSync(h.file(`transcript-opencode-${originalTask.sessionId}.json`), JSON.stringify(h.fixture.getMessages("leader-tab")));
  const authority = h.workers.find(w => w.module.endsWith("departmentgenerationauthorityworker.js"))!;
  const originalOwner = h.workers.find(w => w.module.endsWith("departmentleaderprocessownerworker.js"))!;
  await until(() => originalOwner.child.exitCode !== null);
  assert.equal(originalOwner.child.exitCode, 0); assert.equal(originalOwner.child.signalCode, null);
  const originalService = new DepartmentGenerationAuthorityClient(departmentGenerationAuthorityDirectory(h.file("authorities"), original.scope), original.scope, original.producerId);
  const nativeTicket = (await originalService.observe()).tickets.find(t => t.identity?.role === "leader")!;
  await assert.rejects(originalService.registerNativeSource(nativeTicket, oldDirectory), /original-producer-required/);
  await assert.rejects(originalService.nativeStopped(nativeTicket), /original-producer-required/);
  authority.child.disconnect(); assert.equal(await h.source.close(), true);
  const cold = await coldGenerationHost(t, h.directory);
  await Promise.all([cold.recovery.prepare(cold.read("root")!, () => {}), cold.recovery.prepare(cold.read("root")!, () => {})]);
  assert.equal(cold.restored, 1, "duplicate preparation shares exact control and target");
  assert.deepEqual(cold.recovery.lifecycleState(), { prepared: 1, controls: 1, preparing: 0 });
  // Premature retirement is a retryable module failure, never permission to
  // bypass organization capacity persistence (whose failure remains blocked).
  await assert.rejects(cold.recovery.released(launch.taskId, original.scope.generation), /capacity-removal-unconfirmed/);
  await assert.rejects(cold.recovery.released(launch.taskId, original.scope.generation), /capacity-removal-unconfirmed/);
  assert.deepEqual(cold.recovery.lifecycleState(), { prepared: 1, controls: 1, preparing: 0 });
  assert.equal(authority.child.exitCode, null); assert.equal(cold.producer.canContinueLeader(launch.taskId), false);
  try { await cold.composition.organizationControl.stop(cold.read("root")!); }
  catch (error) {
    throw new Error("OpenCode cold public stop failed: " + JSON.stringify({
      diagnostics: cold.diagnostics, lifecycle: cold.recovery.lifecycleState(), taskStatus: cold.read(launch.taskId)?.status,
      runtime: cold.composition.host.runtimeSnapshot("root"), capacity: cold.composition.readCapacity("root"),
    }) + "; first error: " + (error instanceof Error ? error.message : String(error)));
  }
  const released = cold.store.read("root", "workspace"); assert.ok(released.ok && released.value);
  assert.equal(released.value.leaderExecutionSets![0].state, "closed");
  assert.deepEqual(released.value.executionBindings, bindings);
  assert.deepEqual(released.value.capacity.leaders, []); assert.deepEqual(released.value.capacity.employees, []);
  assert.deepEqual(cold.recovery.lifecycleState(), { prepared: 0, controls: 0, preparing: 0 });
  await until(() => authority.child.exitCode !== null); assert.equal(authority.child.exitCode, 0); assert.equal(authority.child.signalCode, null);
  assert.equal(cold.producer.canContinueLeader(launch.taskId), true);
  const oldRuns = Number(fs.readFileSync(h.file("cold-native-round"), "utf8"));
  const result = await cold.composition.host.continueRoot("root"); assert.ok(result.ok, JSON.stringify(result));
  await until(() => Number(fs.readFileSync(h.file("cold-native-round"), "utf8")) > oldRuns);
  const continued = cold.store.read("root", "workspace"); assert.ok(continued.ok && continued.value);
  const nextBinding = continued.value.executionBindings!.find(b => b.identity.role === "leader" && b.identity.generation > original.scope.generation)!;
  assert.ok(nextBinding); assert.notEqual(nextBinding.identity.ownerId, oldBinding.identity.ownerId);
  assert.notEqual(nextBinding.identity.executionId, oldBinding.identity.executionId);
  assert.deepEqual(nextBinding.identity.session, oldBinding.identity.session);
  assert.deepEqual(nextBinding.selection, oldBinding.selection); assert.deepEqual(nextBinding.requirements, oldBinding.requirements);
  assert.notEqual(fs.readFileSync(h.file("cold-native-directory"), "utf8"), oldDirectory);
  assert.equal(fs.readFileSync(h.file("cold-native-events"), "utf8").split("\n").filter(e => e === "move").length, 1);
  assert.equal(cold.read(launch.taskId)!.sessionId, originalTask.sessionId);
  await cold.recovery.released(launch.taskId, original.scope.generation); // stale finalizer cannot touch successor
  assert.equal(cold.producer.canContinueLeader(launch.taskId), false);
  await cold.fixture.adapter.waitForTaskIdle(launch.taskId);
  await cold.composition.organizationControl.stop(cold.read("root")!);
  const nextAuthority = h.workers.filter(w => w.module.endsWith("departmentgenerationauthorityworker.js"))[1];
  assert.equal(nextAuthority.child.exitCode, 0); assert.equal(nextAuthority.child.signalCode, null);
});

import { createDepartmentExecutionResources, bindDepartmentExecutionTab } from "../../extensionHost/departmentexecutionresources";
import type { DepartmentColdRestoredTab } from "../../extensionHost/departmentcoldgenerationrecovery";
scenario("original authority restored-tab capabilities reject forgery staleness conflicts and preserve consumer failures", async t => {
  const h = await productionWiring(t, "codex", true, false, 1, undefined, "codex", true, true);
  h.answer(1, { status: "blocked", finalSummary: "保留原组长用于可信恢复登记验证" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => h.entries().length === 1 && !!h.entries()[0].executionId);
  await h.fixture.adapter.waitForTaskIdle(launch.taskId);
  assert.deepEqual(await h.producer.close(launch.taskId), { ok: true });
  const task = h.read(launch.taskId)!;
  fs.writeFileSync(h.file(`transcript-codex-${task.sessionId}.json`), JSON.stringify(h.fixture.getMessages("leader-tab")));
  h.workers.find(w => w.module.endsWith("departmentgenerationauthorityworker.js"))!.child.disconnect();
  assert.equal(await h.source.close(), true);
  let mode = "stale", prior: DepartmentColdRestoredTab | undefined;
  const cold = await coldGenerationHost(t, h.directory, (cap, resources, tab) => {
    prior = cap;
    if (mode === "stale") throw new Error("controlled-registration-rejection"); // Invalidated even on callback failure.
    if (mode === "success") {
      resources.recordRestored(cap);
      assert.throws(() => resources.recordRestored(cap), /unverified-or-consumed/);
      assert.throws(() => resources.beginConsumer(tab.id), /not-owned/, "registration before retirement cannot launch");
      return;
    }
    let workspace = "workspace", active = false;
    let current = tab;
    const testResources = createDepartmentExecutionResources({ workspace: () => workspace, readTab: () => current,
      isActive: () => active, owns: () => true, close: async () => {} });
    if (mode === "workspace") workspace = "other";
    if (mode === "replacement") current = { ...tab };
    if (mode === "active") active = true;
    if (mode === "session") tab.sessionId = "other-local";
    if (mode === "conflict") testResources.recordCreated(tab.id);
    try {
      assert.throws(() => testResources.recordRestored(cap), /restoration-conflict/);
      assert.throws(() => testResources.recordRestored(cap), /unverified-or-consumed/);
    } finally { tab.sessionId = task.sessionId!; }
    throw new Error("controlled-registration-rejection");
  });
  for (const variant of ["stale", "workspace", "replacement", "active", "session", "conflict"]) {
    mode = variant;
    await assert.rejects(cold.recovery.prepare(cold.read("root")!, () => {}), /controlled-registration-rejection/);
    assert.throws(() => cold.resources.recordRestored(prior!), /unverified-or-consumed/);
  }
  assert.throws(() => cold.resources.recordRestored({ kind: "verified-cold-restored-tab" }), /unverified-or-consumed/);
  mode = "success";
  await cold.composition.organizationControl.stop(cold.read("root")!);
  const tab = [...cold.tabs.values()][0];
  const consumer = cold.resources.beginConsumer(tab.id);
  const old = cold.store.read("root", "workspace"); assert.ok(old.ok && old.value);
  const binding = old.value.executionBindings!.find(b => b.identity.role === "leader")!;
  assert.throws(() => bindDepartmentExecutionTab(consumer.target, binding.identity), /restored-scope-conflict/);
  consumer.finish(false);
  assert.throws(() => cold.resources.beginConsumer(tab.id), /not-owned/);
  assert.throws(() => cold.resources.recordCreated(tab.id), /creation-conflict/);
});
