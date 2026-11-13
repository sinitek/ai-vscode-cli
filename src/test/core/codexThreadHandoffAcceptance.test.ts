import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { TestContext } from "node:test";

type Supervision = {
  pid: number; exited: boolean; closed: boolean; exitStatus: number | null; exitSignal: string | null;
  terminationAttempted: boolean; terminationAccepted: boolean | null; terminationError: string | null;
  outputComplete: boolean; resourceCleanup: string;
};
type CommandResult = { status: number | null; signal: string | null; stdout: string; stderr: string; error: string | null; supervision?: Supervision };
type Options = { live: boolean; help: boolean; runs: number; report: string | null };
type Report = { passed: boolean; runs: ({ passed: boolean; resourceCleanup?: string } & Partial<CommandResult>)[]; failure?: string };
const scriptPath = fs.realpathSync(path.resolve(__dirname, "../../../scripts/verify_codex_thread_handoff_acceptance.js"));
const liveScript = path.resolve(path.dirname(scriptPath), "verify_codex_thread_handoff.js");
const { parseOptions, verifyLiveResult, runAcceptance, runCommand } = require(scriptPath) as {
  parseOptions: (args: string[]) => Options;
  verifyLiveResult: (result: CommandResult) => Record<string, unknown>;
  runAcceptance: (options: Options, execute: (command: string, args: string[], echo?: boolean) => Promise<CommandResult>) => Promise<Report>;
  runCommand: (command: string, args: string[], echo: boolean, runtime: ReturnType<typeof commandFixture>["runtime"], options?: { env: NodeJS.ProcessEnv }) => Promise<CommandResult>;
};

class ManualClock {
  now = 0;
  private nextId = 0;
  jobs = new Map<number, { at: number; callback: () => void }>();
  setTimeout = (callback: () => void, delay: number): number => {
    const id = ++this.nextId;
    this.jobs.set(id, { at: this.now + delay, callback });
    return id;
  };
  clearTimeout = (id: number): void => { this.jobs.delete(id); };
  tick(milliseconds: number): void {
    const end = this.now + milliseconds;
    let callbacks = 0;
    while (true) {
      const next = [...this.jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      assert.ok(++callbacks < 100, "timer loop did not settle");
      this.now = next[1].at;
      this.jobs.delete(next[0]);
      next[1].callback();
    }
    this.now = end;
  }
}

class FakeVerifier extends EventEmitter {
  readonly pid = 987654321;
  readonly stdout = Object.assign(new PassThrough(), { unref: () => { this.stdoutUnrefs += 1; } });
  readonly stderr = Object.assign(new PassThrough(), { unref: () => { this.stderrUnrefs += 1; } });
  readonly kills: string[] = [];
  stdoutUnrefs = 0;
  stderrUnrefs = 0;
  unrefs = 0;
  killResult: boolean | Error = true;
  kill(signal: string): boolean {
    this.kills.push(signal);
    if (this.killResult instanceof Error) throw this.killResult;
    return this.killResult;
  }
  unref(): void { this.unrefs += 1; }
}

function commandFixture(context: TestContext, env?: NodeJS.ProcessEnv) {
  // No fake PID or accidental extra spawn may ever reach the OS, on any platform.
  context.mock.method(process, "kill", () => { throw new Error("real signal forbidden"); });
  context.mock.method(require("cross-spawn"), "spawn", () => { throw new Error("real spawn forbidden"); });
  const child = new FakeVerifier();
  const unrelated = new FakeVerifier();
  const clock = new ManualClock();
  let spawns = 0;
  const runtime = {
    spawn: (command: string, args: string[], options: unknown) => {
      spawns += 1;
      assert.equal(command, process.execPath);
      assert.ok(args.length > 0);
      assert.deepEqual(options, { cwd: path.dirname(path.dirname(scriptPath)), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}) });
      return child;
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  function released(closed: boolean): void {
    assert.equal(spawns, 1);
    assert.equal(clock.jobs.size, 0);
    assert.deepEqual(unrelated.kills, []);
    for (const event of ["exit", "close"]) assert.equal(child.listenerCount(event), 0);
    assert.equal(child.listenerCount("error"), closed ? 0 : 1, "only a detached late-error guard may remain");
    for (const stream of [child.stdout, child.stderr]) {
      assert.equal(stream.listenerCount("data"), 0);
      assert.equal(stream.listenerCount("end"), 0);
      assert.equal(stream.destroyed, false, "never destroy output to claim success");
    }
  }
  return { child, unrelated, clock, runtime, released };
}

test("public runner verifier receives the pinned environment and the same failure-only supervision", async (context) => {
  const env = { CODEX_COMMAND: "C:/Program Files/Codex/codex.cmd", PATH: "isolated-path" };
  const state = commandFixture(context, env);
  const result = runCommand(process.execPath, [path.join(path.dirname(scriptPath), "verify_codex_runner_unload.js"), "--live"], false, state.runtime, { env });
  state.clock.tick(120000);
  assert.equal(state.clock.jobs.size, 0);
  assert.deepEqual(state.child.kills, []);
  state.child.stderr.write('{"phase":"cleanup_failed"}\r\n');
  state.clock.tick(5000);
  assert.deepEqual(state.child.kills, ["SIGKILL"]);
  state.child.emit("exit", 1, null);
  state.child.emit("close", 1, null);
  const finished = await result;
  assert.equal(finished.supervision?.closed, true);
  assert.equal(finished.supervision?.terminationAttempted, true);
  assert.match(finished.error || "", /cleanup_failed/);
  state.released(true);
});

function stubRegressionDiscovery(context: TestContext): void {
  // Orchestration is mocked; it must not depend on a concurrent build's shared dist directory.
  context.mock.method(fs, "readdirSync", () => ["codexThreadHandoff.test.js", "codexRunnerProcess.test.js"]);
  context.mock.method(fs, "existsSync", () => true);
}

function liveResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    status: 0, signal: null, stderr: "", error: null,
    stdout: [
      { phase: "writer_conflict_reproduced", differentProcesses: true },
      { phase: "handoff_verified", elapsedMs: 60001, sameThread: true, otherThreadRetained: true, localRequests: 1 },
      { phase: "cleanup_verified", processesExited: true, stdioClosed: true, temporaryDirectoryRemoved: true },
    ].map((event) => JSON.stringify(event)).join("\r\n"),
    ...overrides,
  };
}

test("legacy acceptance requires ownership rejection plus actual original-process exit", () => {
  const result = liveResult();
  const events = result.stdout.split(/\r?\n/).map((line) => JSON.parse(line));
  events[0] = { phase: "writer_conflict_prevented", differentProcesses: true, ownershipGuard: true };
  Object.assign(events[1], { connectionPolicy: "exclusive", releaseEvidence: "process/exit", originalProcessExited: true });
  const encode = () => ({ ...result, stdout: events.map((event) => JSON.stringify(event)).join("\n") });
  assert.equal(verifyLiveResult(encode()).connectionPolicy, "exclusive");
  events[1].originalProcessExited = false;
  assert.throws(() => verifyLiveResult(encode()), /原进程退出/);
  events[1].originalProcessExited = true;
  events[0].ownershipGuard = false;
  assert.throws(() => verifyLiveResult(encode()), /实际拒绝/);
});

test("acceptance requires explicit live consent and bounded repeat counts", () => {
  assert.deepEqual(parseOptions(["--live"]), { live: true, help: false, runs: 3, report: null });
  assert.equal(parseOptions(["--help"]).help, true);
  assert.equal(parseOptions(["--live", "--runs", "5"]).runs, 5);
  assert.equal(parseOptions(["--live", "--report", "report with spaces.json"]).report, path.resolve("report with spaces.json"));
  for (const args of [[], ["--live", "--runs"], ["--live", "--report", "--runs"], ["--unknown"]]) {
    assert.throws(() => parseOptions(args));
  }
  for (const value of ["0", "-1", "1.5", "21", "NaN", "Infinity"]) {
    assert.throws(() => parseOptions(["--live", "--runs", value]));
  }
});

test("acceptance accepts complete evidence with Windows newlines and ignores unrelated output", () => {
  const result = liveResult();
  result.stdout = `progress\r\nnull\r\n${result.stdout}\r\n`;
  assert.equal(verifyLiveResult(result).sameThread, true);
  assert.equal(verifyLiveResult(result).differentProcesses, true);
  assert.equal(verifyLiveResult(result).resourceCleanup, "verified");
});

test("cleanup_verified must exist exactly once on the ordered stdout event stream", () => {
  const lines = liveResult().stdout.split(/\r?\n/);
  const handoffOnly = lines.slice(0, 2).join("\n");
  assert.throws(() => verifyLiveResult(liveResult({ stdout: handoffOnly })), /cleanup_verified/);
  assert.throws(() => verifyLiveResult(liveResult({ stdout: handoffOnly, stderr: lines[2] })), /cleanup_verified/);
  for (const duplicate of [lines[2], JSON.stringify({ phase: "cleanup_verified", processesExited: false })]) {
    assert.throws(() => verifyLiveResult(liveResult({ stdout: `${lines.join("\n")}\n${duplicate}` })), /cleanup_verified/);
  }
});

test("cleanup_verified must follow conflict and handoff in every event permutation", () => {
  const lines = liveResult().stdout.split(/\r?\n/);
  for (const order of [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    assert.throws(() => verifyLiveResult(liveResult({ stdout: order.map((index) => lines[index]).join("\r\n") })), /顺序/);
  }
});

test("cleanup_verified requires each completion field to be strictly true", () => {
  const events = liveResult().stdout.split(/\r?\n/).map((line) => JSON.parse(line));
  for (const field of ["processesExited", "stdioClosed", "temporaryDirectoryRemoved"]) {
    for (const value of [undefined, false, null, 0, 1, "true", [], {}]) {
      const cleanup = { ...events[2], [field]: value };
      assert.throws(() => verifyLiveResult(liveResult({
        stdout: [...events.slice(0, 2), cleanup].map((event) => JSON.stringify(event)).join("\n"),
      })), new RegExp(`cleanup_verified\\.${field}`));
    }
  }
});

test("acceptance rejects the conflict-only output reported by the Windows user", () => {
  assert.throws(() => verifyLiveResult(liveResult({
    stdout: JSON.stringify({ phase: "writer_conflict_reproduced", differentProcesses: true }),
  })), /handoff_verified/);
});

test("acceptance requires normal exit even after both successful phases", () => {
  for (const override of [{ status: 1 }, { status: null }, { signal: "SIGTERM" }, { error: "spawn ENOENT" }]) {
    assert.throws(() => verifyLiveResult(liveResult(override)));
  }
});

test("acceptance rejects cleanup_failed on either stream even with all success phases and status zero", () => {
  for (const stream of ["stdout", "stderr"] as const) {
    const result = liveResult();
    result[stream] += `\r\n${JSON.stringify({ phase: "cleanup_failed", children: [{ exited: true, closed: false }] })}\r\n`;
    assert.throws(() => verifyLiveResult(result), /cleanup_failed/);
  }
});

test("verifier success waits for close and has no initialization or handoff deadline", async (context) => {
  const fixture = commandFixture(context);
  const { child, clock } = fixture;
  let resolved = false;
  const pending = runCommand(process.execPath, [liveScript, "--live"], false, fixture.runtime).then((result) => { resolved = true; return result; });
  child.stdout.write("Error: progress text is not a terminal stderr exception\n");
  child.stderr.write('progress: waiting for initialization\n{"message":"Error: diagnostic context"}\n');
  clock.tick(120000);
  child.stdout.write(`${liveResult().stdout}\r\n`);
  clock.tick(120000);
  child.emit("exit", 0, null);
  clock.tick(120000);
  await Promise.resolve();
  assert.equal(resolved, false, "exit is not close");
  assert.equal(clock.jobs.size, 0);
  assert.deepEqual(child.kills, []);
  child.stderr.write("final diagnostic\r\n");
  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(verifyLiveResult(result).sameThread, true);
  assert.ok(result.stderr.endsWith("final diagnostic\r\n"));
  assert.equal(result.supervision?.closed, true);
  assert.equal(result.supervision?.outputComplete, true);
  assert.throws(() => verifyLiveResult({ ...result, supervision: { ...result.supervision!, closed: false } }));
  assert.throws(() => verifyLiveResult({ ...result, supervision: { ...result.supervision!, terminationAttempted: true } }));
  fixture.released(true);
});

test("cleanup failure terminates only the owned verifier once and retains output through close", async (context) => {
  const fixture = commandFixture(context);
  const { child, clock } = fixture;
  const pending = runCommand(process.execPath, [liveScript, "--live"], false, fixture.runtime);
  child.stdout.write(`${liveResult().stdout}\r\n`);
  const cleanup = JSON.stringify({ phase: "cleanup_failed", children: [{ pid: 1122334455, exited: true, closed: false }] });
  child.stderr.write(cleanup.slice(0, 15));
  clock.tick(120000);
  assert.equal(clock.jobs.size, 0, "partial JSON is not terminal evidence");
  child.stderr.write(cleanup.slice(15)); // Detect complete JSON even without a trailing newline.
  clock.tick(4999);
  assert.deepEqual(child.kills, []);
  child.stderr.write("\r\nError: cleanup timeout\r\n");
  clock.tick(1);
  assert.deepEqual(child.kills, ["SIGKILL"]);
  child.emit("exit", null, "SIGKILL");
  clock.tick(4999);
  const tail = Buffer.from("最后的诊断\r\n");
  child.stderr.write(tail.subarray(0, 2));
  child.stderr.write(tail.subarray(2));
  child.stdout.write("stdout tail\r\n");
  child.emit("close", null, "SIGKILL");
  const result = await pending;
  assert.match(result.error || "", /cleanup_failed/);
  assert.equal(result.stderr, `${cleanup}\r\nError: cleanup timeout\r\n最后的诊断\r\n`);
  assert.ok(result.stdout.endsWith("stdout tail\r\n"));
  assert.equal(result.supervision?.terminationAttempted, true);
  assert.equal(result.supervision?.terminationAccepted, true);
  assert.equal(result.supervision?.exited, true);
  assert.throws(() => verifyLiveResult(result));
  clock.tick(120000);
  assert.deepEqual(child.kills, ["SIGKILL"]);
  fixture.released(true);
});

test("terminal exception without verifier exit finishes as failure with explicit unresolved ownership", async (context) => {
  const fixture = commandFixture(context);
  const { child, clock } = fixture;
  const pending = runCommand(process.execPath, [liveScript, "--live"], false, fixture.runtime);
  child.stderr.write("AssertionError [ERR_ASSERTION]: original failure\r\n");
  clock.tick(5000);
  child.stderr.write("    at finalStackFrame\r\n");
  clock.tick(4999);
  child.stdout.write("last buffered output\r\n");
  clock.tick(1);
  const result = await pending;
  assert.equal(result.status, null);
  assert.equal(result.supervision?.closed, false);
  assert.equal(result.supervision?.exited, false);
  assert.equal(result.supervision?.outputComplete, false);
  assert.equal(result.supervision?.resourceCleanup, "unverified");
  assert.match(result.error || "", /original failure/);
  assert.match(result.error || "", /987654321.*终止未确认/);
  assert.match(result.error || "", /临时目录清理未确认/);
  assert.match(result.stderr, /finalStackFrame/);
  assert.match(result.stdout, /last buffered output/);
  assert.equal(child.unrefs, 1);
  assert.equal(child.stdoutUnrefs, 1);
  assert.equal(child.stderrUnrefs, 1);
  fixture.released(false);
  child.emit("error", new Error("late kill failure"));
  child.emit("close", 0, null);
  clock.tick(120000);
  assert.deepEqual(child.kills, ["SIGKILL"]);
  assert.equal(result.supervision?.closed, false, "late events cannot turn a completed failure into success");
});

test("failure that closes during grace cancels supervision without termination", async (context) => {
  const fixture = commandFixture(context);
  const { child, clock } = fixture;
  const pending = runCommand(process.execPath, [liveScript, "--live"], false, fixture.runtime);
  child.stdout.write(`${liveResult().stdout}\n`);
  child.stderr.write('{"phase":"cleanup_failed"}\nError: original reason\n');
  clock.tick(4999);
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  const result = await pending;
  assert.match(result.error || "", /cleanup_failed/);
  assert.throws(() => verifyLiveResult(result));
  clock.tick(120000);
  assert.deepEqual(child.kills, []);
  fixture.released(true);
});

for (const killResult of [false, new Error("access denied")] as const) {
  test(`failed termination stays bounded and records its outcome: ${String(killResult)}`, async (context) => {
    const fixture = commandFixture(context);
    const { child, clock } = fixture;
    child.killResult = killResult;
    const pending = runCommand(process.execPath, [liveScript, "--live"], false, fixture.runtime);
    child.stderr.write("Error: verifier failure\n");
    clock.tick(10000);
    const result = await pending;
    assert.match(result.error || "", /终止未确认/);
    assert.equal(result.supervision?.terminationAccepted, killResult === false ? false : null);
    assert.equal(result.supervision?.terminationError, killResult instanceof Error ? "access denied" : null);
    clock.tick(120000);
    assert.deepEqual(child.kills, ["SIGKILL"]);
    fixture.released(false);
  });
}

test("nonzero exit with inherited open pipes is failure and never signals an exited PID", async (context) => {
  const fixture = commandFixture(context);
  const { child, clock } = fixture;
  const pending = runCommand(process.execPath, [liveScript, "--live"], false, fixture.runtime);
  child.emit("exit", 1, null);
  child.stderr.write("tail after exit\n");
  clock.tick(10000);
  const result = await pending;
  assert.match(result.error || "", /非正常退出/);
  assert.equal(result.status, null, "exit is diagnostic evidence, never substituted for close");
  assert.equal(result.supervision?.exitStatus, 1);
  assert.equal(result.supervision?.closed, false);
  assert.equal(result.stderr, "tail after exit\n");
  assert.deepEqual(child.kills, []);
  fixture.released(false);
});

test("supervision does not apply to other commands or misleading progress output", async (context) => {
  const fixture = commandFixture(context);
  const { child, clock } = fixture;
  const pending = runCommand(process.execPath, ["unrelated-script.js", "--live"], false, fixture.runtime);
  child.stderr.write('Error: unrelated command output\n{"phase":"cleanup_failed"}\n');
  clock.tick(120000);
  assert.equal(clock.jobs.size, 0);
  assert.deepEqual(child.kills, []);
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.error, null);
  assert.equal(result.supervision, undefined);
  fixture.released(true);
});

test("acceptance rejects missing safety guarantees, duplicate phases, and reversed phases", () => {
  const events = liveResult().stdout.split(/\r?\n/).map((line) => JSON.parse(line));
  const mutations = [
    [{ ...events[0], differentProcesses: false }, events[1]],
    [events[0], { ...events[1], sameThread: false }],
    [events[0], { ...events[1], otherThreadRetained: false }],
    [events[0], { ...events[1], localRequests: 0 }],
    [events[0], { ...events[1], elapsedMs: -1 }],
    [events[1], events[0]],
    [events[0], events[0], events[1]],
    [events[0], events[1], events[1]],
  ];
  for (const mutation of mutations) {
    assert.throws(() => verifyLiveResult(liveResult({ stdout: [...mutation, events[2]].map((event) => JSON.stringify(event)).join("\n") })));
  }
});

for (const scenario of ["verified", "missing", "invalid"] as const) {
  test(`cleanup report remains truthful after normal close: ${scenario}`, async (context) => {
    context.mock.method(console, "log", () => undefined);
    context.mock.method(console, "error", () => undefined);
    stubRegressionDiscovery(context);
    const fixture = commandFixture(context);
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek cleanup contract-"));
    context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const reportPath = path.join(temporaryRoot, "report.json");
    const execute = async (command: string, args: string[]): Promise<CommandResult> => {
      if (args[0] !== liveScript) return liveResult({ stdout: "" });
      const pending = runCommand(command, args, false, fixture.runtime);
      const events = liveResult().stdout.split(/\r?\n/).map((line) => JSON.parse(line));
      if (scenario === "missing") events.pop();
      if (scenario === "invalid") events[2].temporaryDirectoryRemoved = false;
      fixture.child.stdout.write(events.map((event) => JSON.stringify(event)).join("\r\n"));
      fixture.child.emit("exit", 0, null);
      fixture.child.emit("close", 0, null);
      const result = await pending;
      assert.equal(result.supervision?.resourceCleanup, "unverified", "normal close alone never verifies resource cleanup");
      return result;
    };
    const report = await runAcceptance({ live: true, help: false, runs: 1, report: reportPath }, execute);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), report);
    assert.equal(report.passed, scenario === "verified");
    assert.equal(report.runs[0].passed, scenario === "verified");
    assert.equal(report.runs[0].resourceCleanup, scenario === "verified" ? "verified" : undefined);
    assert.equal(report.runs[0].supervision?.resourceCleanup, scenario === "verified" ? "verified" : "unverified");
    if (scenario !== "verified") assert.match(report.failure || "", /cleanup_verified/);
    assert.deepEqual(fixture.child.kills, []);
    fixture.released(true);
  });
}

for (const scenario of ["pass", "build_failure", "incomplete_live", "cleanup_failure"] as const) {
  test(`acceptance orchestration writes a truthful report: ${scenario}`, async (context) => {
    context.mock.method(console, "log", () => undefined);
    context.mock.method(console, "error", () => undefined);
    stubRegressionDiscovery(context);
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek acceptance test-"));
    context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const reportPath = path.join(temporaryRoot, "nested directory", "report.json");
    const calls: string[][] = [];
    const execute = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push([command, ...args]);
      if (command === "npm" && scenario === "build_failure") return liveResult({ status: 1, stderr: "build failed" });
      if (args[0]?.endsWith("verify_codex_thread_handoff.js")) {
        if (scenario === "incomplete_live") return liveResult({ stdout: JSON.stringify({ phase: "writer_conflict_reproduced", differentProcesses: true }) });
        if (scenario === "cleanup_failure") return liveResult({ status: 1 });
        return liveResult();
      }
      return liveResult({ stdout: args[0] === "--version" ? "codex-cli test" : "" });
    };
    const report = await runAcceptance({ live: true, help: false, runs: 2, report: reportPath }, execute);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), report);
    assert.deepEqual(calls[0], ["npm", "run", "build"]);
    assert.equal(report.passed, scenario === "pass");
    const liveCalls = calls.filter((call) => call[1]?.endsWith("verify_codex_thread_handoff.js"));
    assert.equal(liveCalls.length, scenario === "pass" ? 2 : scenario === "build_failure" ? 0 : 1);
    assert.equal(report.runs.filter((run) => run.passed).length, scenario === "pass" ? 2 : 0);
    if (scenario === "build_failure") assert.equal(calls.length, 1);
    else assert.ok(calls.findIndex((call) => call[1] === "--test") < calls.findIndex((call) => call[1]?.endsWith("verify_codex_thread_handoff.js")));
  });
}

test("acceptance automatically writes failed 2/3 evidence when the final verifier never closes", async (context) => {
  context.mock.method(console, "log", () => undefined);
  context.mock.method(console, "error", () => undefined);
  stubRegressionDiscovery(context);
  const fixture = commandFixture(context);
  const { child, clock } = fixture;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek acceptance failure-"));
  context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const reportPath = path.join(temporaryRoot, "report.json");
  let liveCalls = 0;
  const execute = async (command: string, args: string[]): Promise<CommandResult> => {
    if (args[0] !== liveScript) return liveResult({ stdout: "" });
    if (++liveCalls < 3) return liveResult();
    const pending = runCommand(command, args, false, fixture.runtime);
    child.stdout.write(`${liveResult().stdout}\n`);
    child.stderr.write('{"phase":"cleanup_failed","children":[{"exited":true,"closed":false}]}\nError: cleanup timeout\n');
    clock.tick(5000);
    child.emit("exit", null, "SIGKILL");
    child.stderr.write("final tail before bounded completion\n");
    clock.tick(5000);
    return pending;
  };
  const report = await runAcceptance({ live: true, help: false, runs: 3, report: reportPath }, execute);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), report);
  assert.equal(report.passed, false);
  assert.equal(report.runs.filter((run) => run.passed).length, 2);
  assert.equal(liveCalls, 3, "failure is never hidden by retry");
  assert.match(report.failure || "", /cleanup_failed/);
  assert.match(report.runs[2].stderr || "", /cleanup timeout[\s\S]*final tail/);
  assert.match(report.runs[2].stdout || "", /handoff_verified/);
  assert.equal(report.runs[2].supervision?.closed, false);
  assert.equal(report.runs[2].supervision?.exited, true);
  assert.equal(report.runs[2].supervision?.resourceCleanup, "unverified");
  fixture.released(false);
});

test("acceptance help is safe and does not start live verification", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /自动构建/);
  assert.doesNotMatch(result.stdout, /acceptance_step_started/);
});
