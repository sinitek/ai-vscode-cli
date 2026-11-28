import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { once } from "events";
import childProcess = require("child_process");
import { type ChildProcess } from "child_process";
import { SIMULATED_LEADER_CLI } from "../runtime/fixtures/departmentleadercodexhost";
import {
  cleanupDepartmentWorkerInstance,
  createDepartmentWorkerCleanupPorts,
  DEPARTMENT_WORKER_PS_TIMEOUT_MS,
  departmentWorkerPsCommand,
  DepartmentWorkerCleanupError,
  observeDepartmentWorkerInstance,
  parseDepartmentWorkerPsIdentity,
  readRecordedDepartmentWorkerInstances,
  recordDepartmentWorkerInstance,
  stopDepartmentFixtureWorkers,
  stopLeaderFixtureWorkers,
  stopPreparedFixtureWorkers,
  stopRecordedDepartmentTestWorkers,
  type DepartmentWorkerCleanupPorts,
  type DepartmentWorkerInstanceIdentity,
  type DepartmentWorkerSignal,
} from "./fixtures/departmentownedtestworkers";

const identity: DepartmentWorkerInstanceIdentity = {
  pid: 4242,
  startedAt: "Sat Nov 28 11:03:21 2026",
  command: "/usr/bin/node departmentleadercodexownerworker.js",
};
const limits = { termMs: 20, killMs: 20, pollMs: 20 };

function scripted(steps: Array<"same" | "other" | "gone" | Error>, handle?: ChildProcess) {
  const signals: Array<{ via: "handle" | "instance"; signal: DepartmentWorkerSignal }> = [];
  let now = 0;
  let index = 0;
  const ports: DepartmentWorkerCleanupPorts = {
    now: () => now,
    wait: async (ms) => { now += ms; },
    observe() {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step instanceof Error) throw step;
      if (step === "gone") return null;
      if (step === "other") return { ...identity, command: `${identity.command} other` };
      return identity;
    },
    signalHandle(_handle, signal) { signals.push({ via: "handle", signal }); },
    signalInstance(_pid, signal) { signals.push({ via: "instance", signal }); },
  };
  return { signals, ports, handle };
}

test("parse keeps the start time and the full command from ps", () => {
  const parsed = parseDepartmentWorkerPsIdentity(4242, "Sun Nov  8 01:02:03 2026     /bin/node fixture.js --flag\n");
  assert.deepEqual(parsed, { pid: 4242, startedAt: "Sun Nov 8 01:02:03 2026", command: "/bin/node fixture.js --flag" });
  assert.throws(() => parseDepartmentWorkerPsIdentity(4242, "not a process"), DepartmentWorkerCleanupError);
});

test("initial identity mismatch sends no signal", async () => {
  const fixture = scripted(["other"]);
  const result = await cleanupDepartmentWorkerInstance({ identity }, fixture.ports, limits);
  assert.equal(result.outcome, "identity-mismatch");
  assert.deepEqual(result.signals, []);
  assert.deepEqual(fixture.signals, []);
});

test("identity change after SIGTERM skips SIGKILL", async () => {
  const fixture = scripted(["same", "other"]);
  const result = await cleanupDepartmentWorkerInstance({ identity }, fixture.ports, limits);
  assert.equal(result.outcome, "identity-changed-after-term");
  assert.deepEqual(fixture.signals, [{ via: "instance", signal: "SIGTERM" }]);
});

test("SIGKILL is followed by a confirmed exit", async () => {
  const fixture = scripted(["same", "same", "same", "same", "gone"]);
  const result = await cleanupDepartmentWorkerInstance({ identity }, fixture.ports, limits);
  assert.equal(result.outcome, "exited-after-kill");
  assert.deepEqual(fixture.signals.map((signal) => signal.signal), ["SIGTERM", "SIGKILL"]);
});

test("a direct child is signaled through its handle", async () => {
  const handle = { pid: identity.pid, exitCode: null, signalCode: null } as ChildProcess;
  const fixture = scripted(["same", "same", "same", "same", "gone"], handle);
  const result = await cleanupDepartmentWorkerInstance({ identity, handle }, fixture.ports, limits);
  assert.equal(result.outcome, "exited-after-kill");
  assert.deepEqual(fixture.signals, [
    { via: "handle", signal: "SIGTERM" },
    { via: "handle", signal: "SIGKILL" },
  ]);
});

test("the kill phase reports timeout when the same instance stays alive", async () => {
  const fixture = scripted(["same"]);
  await assert.rejects(
    () => cleanupDepartmentWorkerInstance({ identity }, fixture.ports, limits),
    (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-exit-timeout",
  );
  assert.deepEqual(fixture.signals.map((signal) => signal.signal), ["SIGTERM", "SIGKILL"]);
});

test("an observation failure before any signal sends nothing", async () => {
  const fixture = scripted([new Error("ps failed")]);
  await assert.rejects(
    () => cleanupDepartmentWorkerInstance({ identity }, fixture.ports, limits),
    (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-observation-failed",
  );
  assert.deepEqual(fixture.signals, []);
});

test("an observation failure after SIGTERM does not escalate to SIGKILL", async () => {
  const fixture = scripted(["same", new Error("ps failed")]);
  await assert.rejects(
    () => cleanupDepartmentWorkerInstance({ identity }, fixture.ports, limits),
    (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-observation-failed",
  );
  assert.deepEqual(fixture.signals, [{ via: "instance", signal: "SIGTERM" }]);
});

test("a plain pid record is an observation failure and sends no signal", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-worker-record-"));
  const pidFile = path.join(directory, "owned-worker-pids");
  fs.writeFileSync(pidFile, "4242\n");
  const signals: DepartmentWorkerSignal[] = [];
  const ports = scripted(["same"]).ports;
  ports.signalInstance = (_pid, signal) => { signals.push(signal); };
  try {
    await assert.rejects(
      () => stopRecordedDepartmentTestWorkers(pidFile, ports),
      (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-observation-failed",
    );
    assert.deepEqual(signals, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function waitForChildExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error("exit-not-observed")), 1000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

function portsFor(signaled: number[], dead: Set<number>): DepartmentWorkerCleanupPorts {
  return {
    now: () => 0,
    wait: async () => {},
    observe(pid) { return dead.has(pid) ? null : { ...identity, pid }; },
    signalHandle(handle, signal) {
      assert.equal(signal, "SIGTERM");
      signaled.push(handle.pid ?? 0);
      dead.add(handle.pid ?? 0);
      (handle as { exitCode: number | null }).exitCode = 0;
    },
    signalInstance(pid, signal) {
      assert.equal(signal, "SIGTERM");
      signaled.push(pid);
      dead.add(pid);
    },
  };
}

test("ps timeout uses the production limit and is not a late handle exit", async (t) => {
  const calls: Array<{ file: string; args: readonly string[]; timeout?: number }> = [];
  t.mock.method(childProcess, "execFileSync", ((file: string, args: readonly string[], options: { timeout?: number }) => {
    calls.push({ file, args, timeout: options.timeout });
    const error = new Error("ps timed out") as NodeJS.ErrnoException;
    error.code = "ETIMEDOUT";
    throw error;
  }) as unknown as typeof childProcess.execFileSync);
  const produced = departmentWorkerPsCommand(4242);
  assert.equal(produced.options.timeout, DEPARTMENT_WORKER_PS_TIMEOUT_MS);
  assert.equal(produced.file, "ps");
  assert.throws(
    () => observeDepartmentWorkerInstance(4242),
    (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-exit-timeout"
      ? false
      : error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-ps-timeout",
  );
  assert.deepEqual(calls, [{ file: "ps", args: produced.args, timeout: DEPARTMENT_WORKER_PS_TIMEOUT_MS }]);
  assert.match(SIMULATED_LEADER_CLI, new RegExp(`timeout:${DEPARTMENT_WORKER_PS_TIMEOUT_MS}`));
  assert.match(SIMULATED_LEADER_CLI, /observationFailed:error&&error\.code==='ETIMEDOUT'\?'department-worker-ps-timeout'/);
  assert.doesNotMatch(SIMULATED_LEADER_CLI, /throw new Error\('department-worker/);
});

test("leader teardown cleans native-instances after the first record fails and reports that error", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-teardown-"));
  fs.writeFileSync(path.join(directory, "owned-worker-pids"), JSON.stringify({ pid: 6101, observationFailed: "department-worker-ps-timeout" }) + "\n");
  fs.writeFileSync(path.join(directory, "native-instances"), JSON.stringify({ ...identity, pid: 6102 }) + "\n");
  const signaled: number[] = [];
  try {
    await assert.rejects(
      () => stopLeaderFixtureWorkers(directory, portsFor(signaled, new Set()), limits),
      (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-ps-timeout",
    );
    assert.deepEqual(signaled, [6102]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const PS_FIXTURE_JS = [
  "const fs=require('fs');",
  "const mode=process.env.DEPARTMENT_PS_FIXTURE;",
  "const marker=process.env.DEPARTMENT_PS_MARKER;",
  "fs.writeFileSync(marker, JSON.stringify({mode,status:mode==='timeout'?'hang':'exit-0'}));",
  "if(mode==='empty') process.exit(0);",
  "if(mode==='blank'){ process.stdout.write(' \\t\\r\\n \\n'); process.exit(0); }",
  "if(mode==='normal'){ process.stdout.write('Sat Nov 28 11:03:21 2026 /usr/bin/node departmentleadercodexownerworker.js\\n'); process.exit(0); }",
  "if(mode==='timeout'){ setInterval(()=>{},1000); return; }",
  "process.exit(2);",
  "",
].join("\n");

type InjectedPsMode = "empty" | "blank" | "normal" | "timeout";
type InjectedPsRecord = { pid?: number; ps?: string; observationFailed?: string };

function readStdoutLine(child: ChildProcess, timeoutMs: number, stderr: () => string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`initialize-timeout:${JSON.stringify(buffer)}:${stderr()}`));
    }, timeoutMs);
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      finish(undefined, buffer.slice(0, newline));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(new Error(`cli-exited:${code}:${signal}:${JSON.stringify(buffer)}:${stderr()}`));
    };
    function finish(error: Error | undefined, line?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(line ?? "");
    }
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
  });
}

async function stopInjectedLeader(child: ChildProcess, directory: string, marker: string): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    try { await waitForChildExit(child); } catch { /* exit already observed */ }
  }
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(marker, { force: true });
}

/** Run the simulated leader once. `ps` is a PATH shim so empty, whitespace, identity, and ETIMEDOUT are injected separately. */
async function assertInjectedLeaderPs(mode: InjectedPsMode, expectedError: "department-worker-observation-failed" | "department-worker-ps-timeout" | null): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-ps-"));
  const marker = path.join(os.tmpdir(), `department-ps-marker-${path.basename(directory)}`);
  const bin = path.join(directory, "ps-bin");
  fs.mkdirSync(bin);
  const fixtureJs = path.join(bin, "ps-fixture.js");
  fs.writeFileSync(fixtureJs, PS_FIXTURE_JS);
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(bin, "ps.cmd"), `@echo off\r\n"${process.execPath}" "${fixtureJs}" %*\r\n`);
  } else {
    const psPath = path.join(bin, "ps");
    fs.writeFileSync(psPath, `#!/bin/sh\nexec "${process.execPath}" "${fixtureJs}" "$@"\n`);
    fs.chmodSync(psPath, 0o755);
  }
  fs.writeFileSync(path.join(directory, "protocol.cjs"), `const ROOT=${JSON.stringify(directory)};\n${SIMULATED_LEADER_CLI}`);
  let stderr = "";
  const child = childProcess.spawn(process.execPath, [path.join(directory, "protocol.cjs")], {
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      DEPARTMENT_PS_FIXTURE: mode,
      DEPARTMENT_PS_MARKER: marker,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    const pending = readStdoutLine(child, mode === "timeout" ? 8000 : 4000, () => stderr);
    child.stdin?.write(`${JSON.stringify({ id: 41, method: "initialize" })}\n`);
    assert.deepEqual(JSON.parse(await pending), { id: 41, result: {} }, `${mode} initialize`);
    const records = fs.readFileSync(path.join(directory, "native-instances"), "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as InjectedPsRecord);
    assert.equal(records.length, 1, mode);
    const record = records[0];
    const pid = child.pid;
    assert.ok(pid, mode);
    assert.equal(record.pid, pid, mode);
    const markerBody = JSON.parse(fs.readFileSync(marker, "utf8")) as { mode?: string; status?: string };
    assert.equal(markerBody.mode, mode, mode);
    assert.equal(markerBody.status, mode === "timeout" ? "hang" : "exit-0", mode);
    if (expectedError) {
      assert.equal(record.observationFailed, expectedError, mode);
      assert.equal(record.ps, undefined, mode);
    } else {
      assert.equal(record.observationFailed, undefined, mode);
      assert.deepEqual(parseDepartmentWorkerPsIdentity(pid, record.ps ?? ""), { ...identity, pid }, mode);
    }
    const followupPid = pid === 9102 ? 9103 : 9102;
    fs.appendFileSync(path.join(directory, "native-instances"), JSON.stringify({ ...identity, pid: followupPid }) + "\n");
    const signals: Array<{ pid: number; signal: DepartmentWorkerSignal }> = [];
    const dead = new Set<number>();
    const ports: DepartmentWorkerCleanupPorts = {
      now: () => 0,
      wait: async () => {},
      observe(target) { return dead.has(target) ? null : { ...identity, pid: target }; },
      signalHandle(handle, signal) {
        signals.push({ pid: handle.pid ?? 0, signal });
        dead.add(handle.pid ?? 0);
      },
      signalInstance(target, signal) {
        signals.push({ pid: target, signal });
        dead.add(target);
      },
    };
    if (expectedError) {
      await assert.rejects(
        () => stopLeaderFixtureWorkers(directory, ports, limits),
        (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === expectedError,
      );
      assert.deepEqual(signals, [{ pid: followupPid, signal: "SIGTERM" }], mode);
      assert.equal(child.exitCode, null, mode);
      assert.equal(child.signalCode, null, mode);
    } else {
      await stopLeaderFixtureWorkers(directory, ports, limits);
      assert.deepEqual(signals, [
        { pid, signal: "SIGTERM" },
        { pid: followupPid, signal: "SIGTERM" },
      ], mode);
    }
  } finally {
    await stopInjectedLeader(child, directory, marker);
  }
}

test("simulated leader blank ps records an unsignaled observation failure and still cleans the next target", { timeout: 20000 }, async () => {
  await assertInjectedLeaderPs("empty", "department-worker-observation-failed");
  await assertInjectedLeaderPs("blank", "department-worker-observation-failed");
  await assertInjectedLeaderPs("timeout", "department-worker-ps-timeout");
  await assertInjectedLeaderPs("normal", null);
});

test("preparation teardown cleans the held handle after the first record fails and reports the original error", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-prepared-teardown-"));
  fs.writeFileSync(path.join(directory, "owned-worker-pids"), "not-json\n");
  const handle = { pid: 6103, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null };
  const signaled: number[] = [];
  try {
    await assert.rejects(
      () => stopPreparedFixtureWorkers(directory, [{ handle: handle as ChildProcess, identity: { ...identity, pid: 6103 } }], portsFor(signaled, new Set()), limits),
      (error: unknown) => error instanceof DepartmentWorkerCleanupError
        && error.message === "department-worker-observation-failed"
        && error.cause instanceof SyntaxError,
    );
    assert.deepEqual(signaled, [6103]);
    assert.equal(handle.exitCode, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function spawnReadyWorker(ignoreTerm: boolean): Promise<{ child: ChildProcess; directory: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-worker-live-"));
  const ready = path.join(directory, "ready");
  const install = ignoreTerm ? "process.on('SIGTERM', () => {});" : "";
  const child = childProcess.spawn(process.execPath, ["-e", `${install} require('fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`], { stdio: "ignore" });
  await once(child, "spawn");
  const deadline = Date.now() + 2000;
  while (!fs.existsSync(ready)) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("worker-exited-before-ready");
    if (Date.now() > deadline) throw new Error("worker-not-ready");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { child, directory };
}

test("a mismatched live instance receives no signal and a matching instance is confirmed gone", { timeout: 10000 }, async () => {
  const { child, directory } = await spawnReadyWorker(false);
  const signals: DepartmentWorkerSignal[] = [];
  const real = createDepartmentWorkerCleanupPorts();
  const ports: DepartmentWorkerCleanupPorts = {
    ...real,
    signalHandle() { throw new Error("cross-host cleanup must not use a held handle"); },
    signalInstance(pid, signal) { signals.push(signal); real.signalInstance(pid, signal); },
  };
  try {
    assert.ok(child.pid);
    const live = observeDepartmentWorkerInstance(child.pid);
    assert.ok(live);
    const mismatch = path.join(directory, "mismatch");
    fs.writeFileSync(mismatch, JSON.stringify({ ...live, command: `${live.command} mismatch` }) + "\n");
    const skipped = await stopRecordedQuiet(mismatch, ports);
    assert.equal(skipped, "identity-mismatch");
    assert.deepEqual(signals, []);
    assert.equal(process.kill(child.pid, 0), true);
    const recorded = recordDepartmentWorkerInstance(path.join(directory, "owned"), child.pid);
    assert.deepEqual(readRecordedDepartmentWorkerInstances(path.join(directory, "owned")), [recorded]);
    await stopRecordedDepartmentTestWorkers(path.join(directory, "owned"), ports);
    assert.deepEqual(signals, ["SIGTERM"]);
    await waitForChildExit(child);
    assert.equal(observeDepartmentWorkerInstance(child.pid), null);
  } finally {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try { process.kill(child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SIGKILL confirms exit when SIGTERM is ignored", { timeout: 10000 }, async () => {
  const { child, directory } = await spawnReadyWorker(true);
  const signals: DepartmentWorkerSignal[] = [];
  const real = createDepartmentWorkerCleanupPorts();
  const ports: DepartmentWorkerCleanupPorts = {
    ...real,
    signalInstance(pid, signal) { signals.push(signal); real.signalInstance(pid, signal); },
  };
  try {
    assert.ok(child.pid);
    recordDepartmentWorkerInstance(path.join(directory, "owned"), child.pid);
    await stopRecordedDepartmentTestWorkers(path.join(directory, "owned"), ports);
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    await waitForChildExit(child);
    assert.equal(observeDepartmentWorkerInstance(child.pid), null);
  } finally {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try { process.kill(child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a held handle waits for exit after the command becomes <defunct>", async () => {
  const handle = { pid: identity.pid, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null };
  let now = 0;
  let probes = 0;
  const signals: DepartmentWorkerSignal[] = [];
  const ports: DepartmentWorkerCleanupPorts = {
    now: () => now,
    wait: async (ms) => { now += ms; if (now >= 40) handle.signalCode = "SIGTERM"; },
    observe() {
      probes += 1;
      return probes === 1 ? identity : { ...identity, command: "<defunct>" };
    },
    signalHandle(_handle, signal) { signals.push(signal); },
    signalInstance() { throw new Error("cross-host signal"); },
  };
  const result = await cleanupDepartmentWorkerInstance(
    { identity, handle: handle as ChildProcess },
    ports,
    { termMs: 100, killMs: 100, pollMs: 20 },
  );
  assert.equal(result.outcome, "exited-after-identity-change");
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.ok(probes > 2);
  assert.equal(handle.signalCode, "SIGTERM");
});

test("a held handle reports timeout when <defunct> never reaches exit", async () => {
  const handle = { pid: identity.pid, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null };
  let now = 0;
  let probes = 0;
  const signals: DepartmentWorkerSignal[] = [];
  const ports: DepartmentWorkerCleanupPorts = {
    now: () => now,
    wait: async (ms) => { now += ms; },
    observe() {
      probes += 1;
      return probes === 1 ? identity : { ...identity, command: "<defunct>" };
    },
    signalHandle(_handle, signal) { signals.push(signal); },
    signalInstance() { throw new Error("cross-host signal"); },
  };
  await assert.rejects(
    () => cleanupDepartmentWorkerInstance(
      { identity, handle: handle as ChildProcess },
      ports,
      { termMs: 40, killMs: 40, pollMs: 20 },
    ),
    (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-exit-timeout",
  );
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(handle.exitCode, null);
  assert.equal(handle.signalCode, null);
  assert.ok(probes > 2);
});

test("wiring directories and a later handle are still cleaned after the first record fails", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "department-wiring-cleanup-"));
  const leaderFile = path.join(root, "native-instances");
  const employeeFile = path.join(root, "employee", "native-instances");
  fs.mkdirSync(path.dirname(employeeFile));
  const leaderIdentity = { ...identity, pid: 5101 };
  const employeeIdentity = { ...identity, pid: 5102 };
  const handleIdentity = { ...identity, pid: 5103 };
  const handle = { pid: 5103, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null };
  fs.writeFileSync(leaderFile, `bare-pid\n${JSON.stringify(leaderIdentity)}\n`);
  fs.writeFileSync(employeeFile, JSON.stringify(employeeIdentity) + "\n");
  const signaled: number[] = [];
  const dead = new Set<number>();
  const ports: DepartmentWorkerCleanupPorts = {
    now: () => 0,
    wait: async () => {},
    observe(pid) { return dead.has(pid) ? null : { ...identity, pid }; },
    signalHandle(_handle, signal) {
      assert.equal(signal, "SIGTERM");
      signaled.push(5103);
      dead.add(5103);
      handle.exitCode = 0;
    },
    signalInstance(pid, signal) {
      assert.equal(signal, "SIGTERM");
      signaled.push(pid);
      dead.add(pid);
    },
  };
  try {
    await assert.rejects(
      () => stopDepartmentFixtureWorkers({
        pidFiles: [leaderFile, employeeFile],
        handles: [{ handle: handle as ChildProcess, identity: handleIdentity }],
      }, ports, { termMs: 20, killMs: 20, pollMs: 20 }),
      (error: unknown) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-observation-failed",
    );
    assert.deepEqual(signaled, [5101, 5102, 5103]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function stopRecordedQuiet(pidFile: string, ports: DepartmentWorkerCleanupPorts): Promise<string> {
  const [recorded] = readRecordedDepartmentWorkerInstances(pidFile);
  const result = await cleanupDepartmentWorkerInstance({ identity: recorded }, ports);
  return result.outcome;
}
