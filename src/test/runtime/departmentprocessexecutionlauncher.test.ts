import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync, fork, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import * as runtime from "../../cli/cliProcessRuntime";
import { createDepartmentProcessExecutionLauncher, type DepartmentProcessResources,
  type PreparedDepartmentProcessExecution } from "../../runtime/departmentprocessexecutionlauncher";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity,
  type DepartmentExecutionSelection, type CleanupResult } from "../../runtime/departmentexecutionidentity";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { DepartmentExecutionReceiptStore } from "../../runtime/departmentexecutionreceiptstore";

const worker = path.join(__dirname, "fixtures", "departmentprocessownerworker.js");
const yes = { status: "confirmed", evidence: "fixture-confirmed" } as const;
const no = { status: "not-applicable", reason: "fixture-not-owned" } as const;
const bindForbidden = async (): Promise<void> => { throw new Error("must-not-bind-session"); };
function selection(): DepartmentExecutionSelection {
  return { version: 1, cli: "opencode", role: "employee", configId: "fixture-config", revision: "fixture-revision",
    model: "fixture/model", thinkingMode: null, openCodeVariant: null };
}
function identity(): DepartmentExecutionIdentity {
  return { version: 1, workspace: "fixture-workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    role: "employee", subtaskId: "subtask", attemptId: "attempt", generation: 1, cli: "opencode",
    ...fingerprintDepartmentExecutionSelection(selection()), session: { state: "bound", id: "native-session" },
    ownerId: "fixture-process-owner", executionId: randomUUID() };
}
function resources(): DepartmentProcessResources {
  return { runner: { owned: false }, executionRoot: { owned: false }, links: { owned: false },
    temp: { owned: false }, tab: { owned: false } };
}
function prepared(value = identity()): PreparedDepartmentProcessExecution {
  return { identity: structuredClone(value), selection: selection(), executionMode: "process",
    launch: { command: process.execPath, args: ["-e", "process.stdout.write('tail');process.stderr.write('tail')"] },
    resources: resources() };
}
function tempDir(t: test.TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "department-process-launcher-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const conflict of ["identity", "fingerprint", "role", "cli", "credential-field", "unbound", "interactive", "missing-config", "null-config"] as const) {
  test(`rejects ${conflict} preparation before any spawn`, async (t) => {
    let spawns = 0, resolves = 0;
    t.mock.method(runtime, "runCliProcess", () => { spawns++; throw new Error("must-not-spawn"); });
    const value = identity(), input = prepared(value);
    if (conflict === "identity") input.identity = { ...input.identity, generation: 2 };
    if (conflict === "fingerprint") input.selection.revision = "another-revision";
    if (conflict === "role") input.selection.role = "leader";
    if (conflict === "cli") input.selection.cli = "claude";
    if (conflict === "credential-field") Object.assign(input.selection, { profileDigest: "must-be-rejected" });
    if (conflict === "unbound") { value.session = { state: "unbound" }; input.identity.session = { state: "unbound" }; }
    if (conflict === "interactive") Object.assign(input, { executionMode: "interactive" });
    if (conflict === "null-config") {
      input.selection.configId = null;
      Object.assign(value, fingerprintDepartmentExecutionSelection(input.selection));
      input.identity = structuredClone(value);
    }
    const launcher = createDepartmentProcessExecutionLauncher(() => { resolves++; return conflict === "missing-config" ? null : input; });
    assert.throws(() => launcher.requirements(value));
    await assert.rejects(launcher.launch(value, bindForbidden));
    assert.equal(spawns, 0);
    assert.equal(resolves, conflict === "unbound" ? 0 : 1, "failed resolution is not retried");
  });
}

test("one immutable preparation drives requirements and a single real spawn, including environment and release ownership", async (t) => {
  const directory = tempDir(t), value = identity(), input = prepared(value);
  const output = path.join(directory, "observed.json");
  let resolutions = 0, releases = 0, overlayReleases = 0;
  input.launch = { command: process.execPath, cwd: directory, processLabel: "department-process-test",
    args: ["-e", "require('fs').writeFileSync(process.argv[1],JSON.stringify({value:process.env.VALUE,base:process.env.BASE,host:process.env.LAUNCHER_HOST_ONLY??null,pwd:process.env.PWD,arg:process.argv[2],argv0:process.argv0}));process.stdout.write('tail');process.stderr.write('tail');", output, "space ' quote"],
    baseEnvironment: { VALUE: "base", BASE: "kept", PWD: "base-pwd" },
    envOverrides: { VALUE: "task", PWD: "task-pwd" },
    overlay: { envOverrides: { VALUE: "overlay", PWD: "overlay-pwd" }, cleanup() {
      overlayReleases++; return yes;
    } },
  };
  input.resources.runner = { owned: true, release() { releases++; assert.equal(this.owned, true); return yes; } };
  const previous = process.env.LAUNCHER_HOST_ONLY;
  process.env.LAUNCHER_HOST_ONLY = "host-must-not-leak";
  t.after(() => { if (previous === undefined) delete process.env.LAUNCHER_HOST_ONLY; else process.env.LAUNCHER_HOST_ONLY = previous; });
  const launcher = createDepartmentProcessExecutionLauncher(() => { resolutions++; return input; });
  const expected = launcher.requirements(value);
  assert.deepEqual(expected, { processTerminal: true, turnTerminal: false, streams: true, runner: true,
    executionRoot: false, links: false, temp: true, tab: false });
  expected.runner = false;
  input.launch.args[3] = "mutated";
  input.launch.baseEnvironment!.BASE = "mutated";
  input.launch.envOverrides!.VALUE = "mutated";
  input.launch.overlay!.envOverrides.VALUE = "mutated";
  input.selection.model = "changed-after-preparation";
  input.resources.runner.owned = false;
  input.resources.runner.release = () => { throw new Error("must-use-original-capability"); };
  // The original receiver is retained for capabilities; its public mutable metadata is not policy.
  const one = launcher.launch(value, bindForbidden), two = launcher.launch(structuredClone(value), bindForbidden);
  assert.strictEqual(one, two);
  const handle = await one;
  assert.strictEqual(handle, await two);
  assert.equal(handle.kind, "process");
  const firstCleanup = handle.cleanup(), secondCleanup = handle.cleanup();
  assert.strictEqual(firstCleanup, secondCleanup);
  const terminal = await handle.completion;
  assert.equal(terminal.processTerminal.status, "confirmed");
  assert.equal(terminal.streams.status, "confirmed");
  assert.equal(terminal.turnTerminal.status, "not-applicable");
  const cleanup = await firstCleanup;
  // This fixture's original method deliberately reads mutable receiver state, so it must fail rather than get rebound.
  assert.equal(cleanup.runner.status, "failed");
  assert.equal(cleanup.temp.status, "confirmed");
  assert.equal(cleanup.tab.status, "not-applicable");
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), {
    value: "overlay", base: "kept", host: null, pwd: directory, arg: "space ' quote", argv0: "department-process-test",
  });
  assert.equal(resolutions, 1); assert.equal(releases, 1); assert.equal(overlayReleases, 1);
  assert.equal(launcher.requirements(value).runner, true);
  await launcher.launch(value, bindForbidden);
  assert.equal(resolutions, 1);
  assert.strictEqual(handle.cleanup(), firstCleanup);
  await assert.rejects(launcher.launch({ ...value, generation: 2 }, bindForbidden));
});

test("default host inheritance is snapshotted during requirements and caller objects stay unchanged", async (t) => {
  const directory = tempDir(t), value = identity(), input = prepared(value), key = "LAUNCHER_DEFAULT_SNAPSHOT";
  const output = path.join(directory, "inherit.txt"), previous = process.env[key];
  process.env[key] = "prepared-host-value";
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  input.launch.args = ["-e", "require('fs').writeFileSync(process.argv[1],process.env.LAUNCHER_DEFAULT_SNAPSHOT)", output];
  const before = structuredClone(input.launch);
  const launcher = createDepartmentProcessExecutionLauncher(() => input);
  launcher.requirements(value);
  process.env[key] = "later-host-value";
  const handle = await launcher.launch(value, bindForbidden);
  assert.equal((await handle.completion).streams.status, "confirmed");
  assert.equal(fs.readFileSync(output, "utf8"), "prepared-host-value");
  assert.deepEqual(input.launch, before);
});

for (const mode of ["missing", "rejected", "undrained"] as const) {
  test(`${mode} lifecycle never becomes close/drain success or releases owned resources`, async (t) => {
    let releases = 0;
    const value = identity(), input = prepared(value);
    for (const part of ["runner", "executionRoot", "links", "temp", "tab"] as const) {
      input.resources[part] = { owned: true, release: () => { releases++; return yes; } };
    }
    t.mock.method(runtime, "runCliProcess", () => ({ pid: 123, kill: () => true,
      lifecycle: mode === "missing" ? undefined : mode === "rejected" ? Promise.reject(new Error("fixture"))
        : Promise.resolve({ processTerminal: yes, streams: { status: "unobservable", reason: "fixture-undrained" }, temp: no }),
    }));
    const launcher = createDepartmentProcessExecutionLauncher(() => input);
    const handle = await launcher.launch(value, bindForbidden);
    const terminal = await handle.completion;
    assert.equal(terminal.streams.status, "unobservable");
    if (mode !== "undrained") assert.equal(terminal.processTerminal.status, "unobservable");
    const cleanup = await handle.cleanup();
    for (const item of Object.values(cleanup)) assert.equal(item.status, "unobservable");
    assert.equal(releases, 0);
  });
}

test("pending lifecycle gates all releases; malformed, missing, failed and thrown release results remain failures", async (t) => {
  const value = identity(), input = prepared(value), gate = deferred<{ processTerminal: CleanupResult; streams: CleanupResult; temp: CleanupResult }>();
  const calls: string[] = [];
  t.mock.method(runtime, "runCliProcess", () => ({ kill: () => true, lifecycle: gate.promise }));
  input.launch.overlay = { envOverrides: {}, cleanup: () => yes };
  input.resources.runner = { owned: true };
  input.resources.executionRoot = { owned: true, release: () => { calls.push("root"); return { status: "confirmed", evidence: "bad evidence with spaces" }; } };
  input.resources.links = { owned: true, release: () => { calls.push("links"); throw new Error("private-error-not-propagated"); } };
  input.resources.temp = { owned: true, release: () => { calls.push("temp"); return { status: "failed", reason: "first-temp-failure" }; } };
  input.resources.tab = { owned: true, release: () => { calls.push("tab"); return no; } };
  const launcher = createDepartmentProcessExecutionLauncher(() => input), policy = launcher.requirements(value);
  const handle = await launcher.launch(value, bindForbidden), cleanup = handle.cleanup();
  let settled = false; void handle.completion.then(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false); assert.deepEqual(calls, []);
  gate.resolve({ processTerminal: yes, streams: yes, temp: yes });
  const facts = await cleanup;
  assert.equal(facts.runner.status, "unobservable");
  assert.equal(facts.executionRoot.status, "unobservable");
  assert.equal(facts.links.status, "failed");
  assert.deepEqual(facts.temp, { status: "failed", reason: "first-temp-failure" });
  assert.equal(facts.tab.status, "unobservable");
  assert.strictEqual(handle.cleanup(), cleanup); assert.deepEqual(await handle.cleanup(), facts);
  assert.deepEqual(calls, ["root", "links", "temp", "tab"]);
  assert.deepEqual(launcher.requirements(value), policy);
});

test("overlay failure remains the first temp failure and cache never evicts into another launch", async (t) => {
  let spawns = 0, resolves = 0;
  t.mock.method(runtime, "runCliProcess", () => { spawns++; return { kill: () => true,
    lifecycle: Promise.resolve({ processTerminal: yes, streams: yes, temp: { status: "failed", reason: "first-overlay-failure" } }) }; });
  const value = identity(), input = prepared(value);
  input.launch.overlay = { envOverrides: {}, cleanup: () => yes };
  input.resources.temp = { owned: true, release: () => ({ status: "failed", reason: "later-temp-failure" }) };
  const launcher = createDepartmentProcessExecutionLauncher((requested) => {
    resolves++; return { ...input, identity: requested };
  });
  const handle = await launcher.launch(value, bindForbidden);
  assert.deepEqual((await handle.cleanup()).temp, { status: "failed", reason: "first-overlay-failure" });
  for (let index = 1; index < 256; index++) launcher.requirements({ ...value, executionId: "reserved-" + index });
  assert.throws(() => launcher.requirements({ ...value, executionId: "over-capacity" }), /capacity/);
  assert.strictEqual(await launcher.launch(value, bindForbidden), handle);
  assert.equal(resolves, 256); assert.equal(spawns, 1);
});

function waitForFile(directory: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { watcher.close(); reject(new Error("fixture-file-timeout:" + name)); }, 5_000);
    const check = (): void => {
      if (fs.existsSync(path.join(directory, name))) { clearTimeout(timer); watcher.close(); resolve(); }
    };
    const watcher = fs.watch(directory, check); check();
  });
}
function waitMessage(child: ChildProcess, key: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("owner-message-timeout:" + key)); }, 5_000);
    const cleanup = (): void => { clearTimeout(timer); child.removeListener("message", onMessage); child.removeListener("exit", onExit); };
    const onMessage = (message: unknown): void => {
      if (message && typeof message === "object" && key in message) { cleanup(); resolve(message as Record<string, unknown>); }
    };
    const onExit = (): void => { cleanup(); reject(new Error("owner-exited-before-message")); };
    child.on("message", onMessage); child.once("exit", onExit);
  });
}
function exitOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(child.exitCode); return; }
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("fixture-exit-timeout")); }, 5_000);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
}


function waitForFinalRecord(directory: string, value: DepartmentExecutionIdentity): Promise<void> {
  const store = new DepartmentExecutionReceiptStore(directory);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { watcher.close(); reject(new Error("final-record-timeout")); }, 5_000);
    const check = (): void => {
      const stored = store.read(value.executionId, value);
      if (stored.kind === "ok" && ["cleaned", "cleanup-failed"].includes(stored.value.state)) {
        clearTimeout(timer); watcher.close(); resolve();
      }
    };
    const watcher = fs.watch(directory, check); check();
  });
}

for (const mode of ["ok", "missing-tab", "fail-root", "fail-temp"] as const) {
  test(`independent Node Owner with real adapter: ${mode}, disconnected starter, single spawn and real close/drain`, async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-process-owner-")), value = identity();
    fs.writeFileSync(path.join(directory, "prepared-input"), JSON.stringify({ identity: value, selection: selection() }));
    const owner = fork(worker, ["owner", directory, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, OWNER_HOST_ONLY: "host-must-stay-omitted" } });
    const ready = await waitMessage(owner, "ready");
    t.after(async () => {
      fs.writeFileSync(path.join(directory, "release-parent"), "release");
      fs.writeFileSync(path.join(directory, "release-tail"), "release");
      if (owner.connected) owner.send({ shutdown: true });
      if (owner.exitCode === null && owner.signalCode === null) await exitOf(owner).catch(() => undefined);
      const overlayFile = path.join(directory, "overlay-path.txt");
      if (fs.existsSync(overlayFile)) fs.rmSync(path.dirname(fs.readFileSync(overlayFile, "utf8")), { recursive: true, force: true });
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const client = new DepartmentExecutionOwnerClient(directory);
    const unbound = { ...value, session: { state: "unbound" as const } };
    assert.equal((await client.startExecution(unbound)).status, "unknown");
    assert.equal(fs.existsSync(path.join(directory, "spawn-count.txt")), false);
    assert.equal((await client.startExecution({ ...value, configFingerprint: "f".repeat(64) })).status, "unknown");
    // The valid preparation is cached; conflicting requests must neither replace it nor spawn.
    const started = JSON.parse(execFileSync(process.execPath, [worker, "client-start", directory], { encoding: "utf8", timeout: 5_000 }));
    assert.equal(started.status, "live");
    await waitForFile(directory, "tail-ready");
    assert.equal((await client.startExecution(value)).status, "live");
    assert.equal((await client.startExecution({ ...value, generation: 2 })).status, "conflict");
    assert.equal((await client.observeExecution(value)).status, "live", "starter process already exited; Owner still holds handle");
    const overlayPath = fs.readFileSync(path.join(directory, "overlay-path.txt"), "utf8");
    assert.equal(fs.existsSync(overlayPath), true);
    assert.equal(fs.existsSync(path.join(directory, "release-count.txt")), false);
    fs.writeFileSync(path.join(directory, "release-parent"), "release");
    await waitForFile(directory, "parent-exiting");
    assert.equal((await client.observeExecution(value)).status, "live", "descendant still owns stdout/stderr");
    assert.equal(fs.existsSync(overlayPath), true);
    fs.writeFileSync(path.join(directory, "release-tail"), "release");
    await waitForFile(directory, "tail-written");
    await waitForFinalRecord(directory, value);
    assert.deepEqual(ready.requirements, launcherRequirements());
    const observation = client.waitForCleanup(value, launcherRequirements());
    if (mode === "ok") {
      const receipt = await observation;
      assert.deepEqual(receipt.identity, value);
      assert.equal(receipt.cleanup.processTerminal.status, "confirmed");
      assert.equal(receipt.cleanup.streams.status, "confirmed");
      assert.equal(receipt.cleanup.turnTerminal.status, "not-applicable");
      assert.equal(receipt.cleanup.temp.status, "confirmed");
      assert.equal(fs.existsSync(path.join(directory, "execution-root")), false);
      assert.equal(fs.existsSync(path.join(directory, "execution-link")), false);
      assert.equal(fs.existsSync(path.join(directory, "extra-temp")), false);
    } else {
      await assert.rejects(observation, /cleanup-observation-unknown/);
      const stored = new DepartmentExecutionReceiptStore(directory).read(value.executionId, value);
      assert.equal(stored.kind, "ok");
      if (stored.kind === "ok") { assert.equal(stored.value.state, "cleanup-failed"); assert.equal(stored.value.receipt, undefined); }
      assert.notEqual((await client.startExecution(value)).status, "cleaned");
    }
    assert.equal(fs.existsSync(overlayPath), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "observed.json"), "utf8")), {
      value: "task", base: "base-only", host: null, pwd: directory, cwd: fs.realpathSync(directory), argument: "prepared-argument", overlayReadable: true,
    });
    assert.equal(fs.readFileSync(path.join(directory, "spawn-count.txt"), "utf8"), "spawn\n");
    const releases = fs.readFileSync(path.join(directory, "release-count.txt"), "utf8").trim().split("\n");
    assert.equal(new Set(releases).size, releases.length);
    assert.equal(releases.length, mode === "missing-tab" ? 4 : 5);
    const exited = exitOf(owner); owner.send({ shutdown: true });
    assert.equal(await exited, 0);
    assert.equal(fs.existsSync(path.join(directory, "owner.lock")), false);
  });
}
function launcherRequirements() {
  return { processTerminal: true, turnTerminal: false, streams: true, runner: true,
    executionRoot: true, links: true, temp: true, tab: true };
}
