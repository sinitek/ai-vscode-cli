import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import childProcess = require("node:child_process");
import { SharedRuntimeConfig } from "../../config/sharedRuntimeConfig";
import { createDepartmentLeaderProcessBootstrap } from "../../extensionHost/departmentleaderprocessbootstrap";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";
import type { DepartmentLeaderProcessPreparation } from "../../runtime/departmentleaderprocesscontract";

async function within<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`bootstrap-test-timeout:${label}`)), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

test("private OpenCode leader bootstrap keeps a bound Owner across rounds and observes its complete receipt", { timeout: 20000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-process-bootstrap-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, "workspace"); fs.mkdirSync(workspace);
  const configDirectory = path.join(directory, "configuration");
  const shared = await new SharedRuntimeConfig(configDirectory).change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: shared.revision,
    model: "provider/model", thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "owner", executionId: "execution", session: { state: "bound", id: "ses_bound123" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const argsFile = path.join(directory, "args.jsonl"), scriptFile = path.join(directory, "opencode.cjs");
  fs.writeFileSync(scriptFile, `const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(argsFile)},JSON.stringify(a)+'\\n');process.stdout.write('answer:'+a.at(-1)+'\\n');process.stderr.write('trace:'+a.at(-1)+'\\n');`);
  const command = process.platform === "win32" ? path.join(directory, "opencode.cmd") : path.join(directory, "opencode");
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${scriptFile}" %*\r\n` : `#!/usr/bin/env node\n${fs.readFileSync(scriptFile, "utf8")}`);
  fs.chmodSync(command, 0o755);
  const preparation: Omit<DepartmentLeaderProcessPreparation, "token"> = { version: 1, identity, selection,
    ownerDirectory: path.join(directory, "owner"), configurationDirectory: configDirectory,
    launch: { command, baseArgs: ["run", "--format", "json"], cwd: workspace, sessionId: "ses_bound123",
      baseEnvironment: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT } } };
  const output: string[] = [], drainedInvocations: string[] = [], released: DepartmentExecutionIdentity[] = [];
  const port = createDepartmentLeaderProcessBootstrap(preparation, {
    assertCurrent(actual) { assert.deepEqual(actual, identity); assert.equal(actual.session.state, "bound"); },
    async authorizeStart() {},
    onOutput(actual, invocationId, _stream, chunk) { assert.deepEqual(actual, identity); output.push(`${invocationId}:${chunk}`); },
    drainConsumers(actual, invocationId) { assert.deepEqual(actual, identity); drainedInvocations.push(invocationId); return true; },
    async releaseTab(actual) { assert.deepEqual(actual, identity); released.push(actual); return { status: "confirmed", evidence: "tab-closed-readback" }; },
  });
  const first = await within("first-invocation", port.invoke({ invocationId: "main-1", prompt: "first" }));
  const second = await within("second-invocation", port.invoke({ invocationId: "main-2", prompt: "second" }));
  assert.equal(first.processTerminal.status, "confirmed"); assert.equal(second.streams.status, "confirmed");
  const lines = fs.readFileSync(argsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.equal(lines.length, 2); assert.ok(lines.every((args) => args.includes("ses_bound123")));
  assert.deepEqual(drainedInvocations, ["main-1", "main-2"]);
  assert.match(output.join(""), /main-1:answer:first/); assert.match(output.join(""), /main-2:answer:second/);
  const closing = port.closeAdmissionsAndDrain();
  assert.strictEqual(port.closeAdmissionsAndDrain(), closing);
  const cleanup = await within("close-and-receipt", closing);
  assert.equal(cleanup.tab.status, "confirmed"); assert.equal(released.length, 1);
  const observed = await port.observe(); assert.equal(observed.status, "cleaned");
});

test("private OpenCode leader bootstrap rejects unbound and changed binding snapshots before launching", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-process-invalid-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const shared = await new SharedRuntimeConfig(path.join(directory, "configuration")).change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: shared.revision,
    model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: directory, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "owner", executionId: "execution", session: { state: "unbound" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const preparation = { version: 1 as const, identity, selection, ownerDirectory: path.join(directory, "owner"),
    configurationDirectory: path.join(directory, "configuration"), launch: { command: process.execPath, baseArgs: [], cwd: directory, sessionId: "" } };
  assert.throws(() => createDepartmentLeaderProcessBootstrap(preparation, {
    async authorizeStart() {},
    assertCurrent() {}, onOutput() {}, drainConsumers() { return true; }, async releaseTab() { return { status: "confirmed", evidence: "x" }; },
  }), /preparation-invalid/);
});

test("bootstrap close is idempotent and transport loss settles an invocation that has not received a grant", { timeout: 20000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-process-disconnect-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configDirectory = path.join(directory, "configuration");
  const shared = await new SharedRuntimeConfig(configDirectory).change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: shared.revision,
    model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: directory, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "owner", executionId: "execution", session: { state: "bound", id: "ses_bound123" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const scriptFile = path.join(directory, "noop-opencode.cjs");
  fs.writeFileSync(scriptFile, "process.exit(0);\n");
  const command = process.platform === "win32" ? path.join(directory, "noop-opencode.cmd") : path.join(directory, "noop-opencode");
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${scriptFile}" %*\r\n`
    : `#!/usr/bin/env node\n${fs.readFileSync(scriptFile, "utf8")}`);
  fs.chmodSync(command, 0o755);
  const preparation: Omit<DepartmentLeaderProcessPreparation, "token"> = { version: 1, identity, selection,
    ownerDirectory: path.join(directory, "owner"), configurationDirectory: configDirectory,
    launch: { command, baseArgs: [], cwd: directory, sessionId: "ses_bound123" } };
  const port = createDepartmentLeaderProcessBootstrap(preparation, {
    async authorizeStart() {},
    assertCurrent() {}, onOutput() {}, drainConsumers() { return true; },
    async releaseTab() { return { status: "confirmed", evidence: "closed" }; },
  });
  const pending = port.invoke({ invocationId: "disconnect-before-grant", prompt: "never-run" });
  port.disconnect();
  await assert.rejects(within("ungranted-invocation-settlement", pending), /worker-disconnected|private-channel|worker-exit/);
  const closing = port.closeAdmissionsAndDrain();
  assert.strictEqual(port.closeAdmissionsAndDrain(), closing);
  await assert.rejects(within("failed-close-settlement", closing));
});

test("disconnect during resource receipt collection rejects close instead of waiting forever", { timeout: 20000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-process-close-disconnect-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configDirectory = path.join(directory, "configuration");
  const shared = await new SharedRuntimeConfig(configDirectory).change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: shared.revision,
    model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: directory, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "owner", executionId: "execution", session: { state: "bound", id: "ses_bound123" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const scriptFile = path.join(directory, "close-opencode.cjs"); fs.writeFileSync(scriptFile, "process.exit(0);\n");
  const command = process.platform === "win32" ? path.join(directory, "close-opencode.cmd") : path.join(directory, "close-opencode");
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${scriptFile}" %*\r\n`
    : `#!/usr/bin/env node\n${fs.readFileSync(scriptFile, "utf8")}`); fs.chmodSync(command, 0o755);
  const preparation: Omit<DepartmentLeaderProcessPreparation, "token"> = { version: 1, identity, selection,
    ownerDirectory: path.join(directory, "owner"), configurationDirectory: configDirectory,
    launch: { command, baseArgs: [], cwd: directory, sessionId: "ses_bound123" } };
  let releaseEntered!: () => void, releaseGate!: () => void;
  const entered = new Promise<void>((resolve) => { releaseEntered = resolve; });
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const port = createDepartmentLeaderProcessBootstrap(preparation, {
    async authorizeStart() {},
    assertCurrent() {}, onOutput() {}, drainConsumers() { return true; },
    async releaseTab() { releaseEntered(); await gate; return { status: "confirmed", evidence: "closed" }; },
  });
  try {
    const terminal = await port.invoke({ invocationId: "before-close-disconnect", prompt: "finish" });
    assert.equal(terminal.processTerminal.status, "confirmed");
    const closing = port.closeAdmissionsAndDrain();
    await within("tab-release-entered", entered);
    port.disconnect();
    releaseGate();
    await assert.rejects(within("close-disconnect-settlement", closing), /worker-disconnected|private-channel|worker-exit/);
  } finally { releaseGate(); }
});

test("close racing worker readiness sends one seal and shares one close promise", { timeout: 20000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-process-ready-close-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configDirectory = path.join(directory, "configuration");
  const shared = await new SharedRuntimeConfig(configDirectory).change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: shared.revision,
    model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: directory, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "owner", executionId: "execution", session: { state: "bound", id: "ses_bound123" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const scriptFile = path.join(directory, "ready-close.cjs"); fs.writeFileSync(scriptFile, "process.exit(0);\n");
  const command = process.platform === "win32" ? path.join(directory, "ready-close.cmd") : path.join(directory, "ready-close");
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${scriptFile}" %*\r\n`
    : `#!/usr/bin/env node\n${fs.readFileSync(scriptFile, "utf8")}`); fs.chmodSync(command, 0o755);
  const preparation: Omit<DepartmentLeaderProcessPreparation, "token"> = { version: 1, identity, selection,
    ownerDirectory: path.join(directory, "owner"), configurationDirectory: configDirectory,
    launch: { command, baseArgs: [], cwd: directory, sessionId: "ses_bound123" } };
  let releasePreparation: (() => void) | undefined;
  let seals = 0;
  const fork = childProcess.fork;
  t.mock.method(childProcess, "fork", (...args: Parameters<typeof fork>) => {
    const child = Reflect.apply(fork, childProcess, args) as childProcess.ChildProcess;
    const send = child.send;
    t.mock.method(child, "send", (message: { operation?: string }, ...sendArgs: unknown[]) => {
      if (message.operation === "seal") seals++;
      if (message.operation) return Reflect.apply(send, child, [message, ...sendArgs]);
      releasePreparation = () => { Reflect.apply(send, child, [message, ...sendArgs]); };
      return true;
    });
    return child;
  });
  const port = createDepartmentLeaderProcessBootstrap(preparation, {
    async authorizeStart() { assert.fail("closed invocation must not launch"); },
    assertCurrent() {}, onOutput() {}, drainConsumers() { return true; },
    async releaseTab() { return { status: "confirmed", evidence: "closed" }; },
  });
  try {
    const invocation = port.invoke({ invocationId: "close-before-ready", prompt: "must-not-run" });
    const closing = port.closeAdmissionsAndDrain();
    assert.strictEqual(port.closeAdmissionsAndDrain(), closing);
    assert.ok(releasePreparation);
    assert.equal(seals, 0);
    const cancelled = assert.rejects(within("cancelled-before-ready-invocation", invocation), /cancelled/);
    releasePreparation();
    await cancelled;
    const cleanup = await within("close-after-ready-race", closing);
    assert.equal(cleanup.tab.status, "confirmed");
    assert.equal(seals, 1);
    assert.equal((await port.observe()).status, "cleaned");
  } finally { port.disconnect(); }
});

test("disconnect after receipt read but before stopped keeps bootstrap observation unknown", { timeout: 20000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-process-stopped-gate-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configDirectory = path.join(directory, "configuration");
  const shared = await new SharedRuntimeConfig(configDirectory).change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: shared.revision,
    model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: directory, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "owner", executionId: "execution", session: { state: "bound", id: "ses_bound123" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const scriptFile = path.join(directory, "stopped-gate.cjs"); fs.writeFileSync(scriptFile, "process.exit(0);\n");
  const command = process.platform === "win32" ? path.join(directory, "stopped-gate.cmd") : path.join(directory, "stopped-gate");
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${scriptFile}" %*\r\n`
    : `#!/usr/bin/env node\n${fs.readFileSync(scriptFile, "utf8")}`); fs.chmodSync(command, 0o755);
  const preparation: Omit<DepartmentLeaderProcessPreparation, "token"> = { version: 1, identity, selection,
    ownerDirectory: path.join(directory, "owner"), configurationDirectory: configDirectory,
    launch: { command, baseArgs: [], cwd: directory, sessionId: "ses_bound123" } };
  let receiptRead!: () => void, releaseReceipt!: () => void;
  const receiptEntered = new Promise<void>((resolve) => { receiptRead = resolve; });
  const receiptGate = new Promise<void>((resolve) => { releaseReceipt = resolve; });
  let observeEntered!: () => void, releaseObserve!: () => void;
  const observeRead = new Promise<void>((resolve) => { observeEntered = resolve; });
  const observeGate = new Promise<void>((resolve) => { releaseObserve = resolve; });
  const originalWait = DepartmentExecutionOwnerClient.prototype.waitForCleanup;
  const originalObserve = DepartmentExecutionOwnerClient.prototype.observeExecution;
  DepartmentExecutionOwnerClient.prototype.waitForCleanup = async function (...args: Parameters<typeof originalWait>) {
    const receipt = await originalWait.apply(this, args);
    receiptRead();
    await receiptGate;
    return receipt;
  };
  DepartmentExecutionOwnerClient.prototype.observeExecution = async function (...args: Parameters<typeof originalObserve>) {
    observeEntered();
    await observeGate;
    return originalObserve.apply(this, args);
  };
  const port = createDepartmentLeaderProcessBootstrap(preparation, {
    async authorizeStart() {},
    assertCurrent() {}, onOutput() {}, drainConsumers() { return true; },
    async releaseTab() { return { status: "confirmed", evidence: "closed" }; },
  });
  try {
    const terminal = await within("invocation-before-shutdown", port.invoke({ invocationId: "before-stopped", prompt: "finish" }));
    assert.equal(terminal.processTerminal.status, "confirmed");
    const pendingObservation = port.observe();
    await within("owner-observation-started", observeRead);
    const closing = port.closeAdmissionsAndDrain();
    assert.strictEqual(port.closeAdmissionsAndDrain(), closing);
    await within("receipt-read-before-shutdown", receiptEntered);
    releaseObserve();
    assert.equal((await within("owner-cleaned-filtered-during-close", pendingObservation)).status, "unknown");
    assert.equal((await port.observe()).status, "unknown");
    port.disconnect();
    releaseReceipt();
    await assert.rejects(within("close-without-stopped", closing), /private-channel|worker-disconnected|worker-exit/);
    assert.equal((await port.observe()).status, "unknown");
  } finally {
    releaseReceipt();
    releaseObserve();
    DepartmentExecutionOwnerClient.prototype.waitForCleanup = originalWait;
    DepartmentExecutionOwnerClient.prototype.observeExecution = originalObserve;
  }
});

test("bootstrap enforces the same 128 invocation limit before contacting the worker", { timeout: 120000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-process-limit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configDirectory = path.join(directory, "configuration");
  const shared = await new SharedRuntimeConfig(configDirectory).change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: shared.revision,
    model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: directory, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "owner", executionId: "execution", session: { state: "bound", id: "ses_bound123" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const scriptFile = path.join(directory, "noop-opencode.cjs");
  fs.writeFileSync(scriptFile, "process.exit(0);\n");
  const command = process.platform === "win32" ? path.join(directory, "noop-opencode.cmd") : path.join(directory, "noop-opencode");
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${scriptFile}" %*\r\n`
    : `#!/usr/bin/env node\n${fs.readFileSync(scriptFile, "utf8")}`);
  fs.chmodSync(command, 0o755);
  const preparation: Omit<DepartmentLeaderProcessPreparation, "token"> = { version: 1, identity, selection,
    ownerDirectory: path.join(directory, "owner"), configurationDirectory: configDirectory,
    launch: { command, baseArgs: [], cwd: directory, sessionId: "ses_bound123" } };
  const port = createDepartmentLeaderProcessBootstrap(preparation, {
    async authorizeStart() {},
    assertCurrent() {}, onOutput() {}, drainConsumers() { return true; },
    async releaseTab() { return { status: "confirmed", evidence: "closed" }; },
  });
  for (let i = 0; i < 128; i++) {
    const terminal = await port.invoke({ invocationId: `limit-${i}`, prompt: `prompt-${i}` });
    assert.equal(terminal.processTerminal.status, "confirmed");
  }
  await assert.rejects(port.invoke({ invocationId: "limit-128", prompt: "over-limit" }), /capacity/);
  await within("limit-owner-close", port.closeAdmissionsAndDrain());
});
