import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import { createRunnerEvidenceFixture } from "./codexRunnerEvidenceFixture";

const script = path.resolve(__dirname, "../../../scripts/verify_loop_plus_fix.js");
const { parseOptions, regressionTests, verifyRegressionResult, verifyRunnerResult, runVerification } = require(script);
const { verifyRunnerEvidence } = require(path.resolve(__dirname, "../../../scripts/verify_codex_runner_unload.js"));
type Result = { status: number | null; signal: string | null; error: string | null; stdout: string; stderr: string; supervision?: ReturnType<typeof supervision> };
type Call = { command: string; args: string[]; env?: NodeJS.ProcessEnv };

function supervision() {
  return { pid: 987654321, exited: true, closed: true, outputComplete: true,
    terminationAttempted: false, resourceCleanup: "unverified" };
}

function result(stdout = "", extra: Partial<Result> = {}): Result {
  return { status: 0, signal: null, error: null, stdout, stderr: "", ...extra };
}

function summary(extra: Record<string, number> = {}) {
  return Object.entries({ tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...extra })
    .map(([key, value]) => `# ${key} ${value}`).join("\r\n");
}

function poolResult() {
  return result([
    { phase: "writer_conflict_reproduced", differentProcesses: true },
    { phase: "handoff_verified", sameThread: true, otherThreadRetained: true, localRequests: 2, elapsedMs: 62000 },
    { phase: "cleanup_verified", processesExited: true, stdioClosed: true, temporaryDirectoryRemoved: true },
  ].map((event) => JSON.stringify(event)).join("\r\n"), { supervision: supervision() });
}

function runnerFixture(command: string, reportPath: string) {
  const evidence = createRunnerEvidenceFixture(true, command);
  const verified = verifyRunnerEvidence(evidence);
  const report = { passed: true, evidence, verified };
  const output = result([
    { phase: "cleanup_verified", ...evidence.cleanup },
    { phase: "runner_handoff_verified", passed: true, ...verified, reportPath },
  ].map((event) => JSON.stringify(event)).join("\r\n"), { supervision: supervision() });
  return { report, output };
}

function fixture(context: TestContext, scenario = "pass") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "loop-plus-acceptance-test-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, "含空格 report.json");
  const command = path.join(directory, "Program Files", "codex.cmd");
  const calls: Call[] = [];
  let poolRuns = 0;
  const runtime = {
    resolveCommand: (input: string) => {
      assert.equal(input, "configured CLI");
      return { command, resolvedFrom: "config" };
    },
    regressionTests: () => [path.resolve(__dirname, "fake-regression.test.js")],
    execute: async (executable: string, args: string[], _echo: boolean, env?: NodeJS.ProcessEnv) => {
      calls.push({ command: executable, args, env });
      if (args.includes("build") && scenario === "build_failure") return result("", { status: 1, stderr: "build failed" });
      if (args.includes("--version")) { assert.equal(executable, command); return result("codex-cli 0.162.1\n"); }
      if (args[0] === "rev-parse") return result("source-commit\n");
      if (args[0] === "status") return result(" M scripts/test.js\n");
      if (args.includes("--test")) return result(summary(scenario === "skipped" ? { skipped: 1 } : {}));
      if (path.basename(args[0]) === "verify_codex_thread_handoff.js") {
        poolRuns += 1;
        return scenario === "incomplete_pool" && poolRuns === 2 ? result("", { supervision: supervision() }) : poolResult();
      }
      if (path.basename(args[0]) === "verify_codex_runner_unload.js") {
        const runnerReportPath = args[args.indexOf("--report") + 1];
        const runner = runnerFixture(command, runnerReportPath);
        if (scenario === "bad_runner_evidence") runner.report.evidence.probes = [];
        if (scenario === "cleanup_failure") runner.output.stderr = '{"phase":"cleanup_failed"}\n';
        if (scenario !== "missing_runner_report") fs.writeFileSync(runnerReportPath, JSON.stringify(runner.report), { flag: "wx" });
        return runner.output;
      }
      return result();
    },
  };
  return { directory, reportPath, command, calls, runtime, options: { live: true, help: false, runs: 3, report: reportPath, codex: "configured CLI" } };
}

test("unified acceptance requires live consent and accepts quoted Windows/macOS paths without splitting", () => {
  assert.throws(() => parseOptions([]), /--live/);
  assert.equal(parseOptions(["--help"]).help, true);
  assert.equal(parseOptions(["--live"]).runs, 3);
  for (const command of ["C:\\Program Files\\Codex\\codex.cmd", "/Applications/Local CLI/codex"]) {
    assert.equal(parseOptions(["--live", "--codex", command]).codex, command);
  }
  for (const args of [["--runs", "0"], ["--runs", "21"], ["--runs", "1.5"], ["--runs", "-1"], ["--codex"], ["--codex", " "], ["--report"], ["--unknown"]]) {
    assert.throws(() => parseOptions(["--live", ...args]));
  }
});

test("regression selection includes the Loop+ ownership, completion, tab lifecycle and runner guards", (context) => {
  context.mock.method(fs, "readdirSync", () => ["codexThreadHandoff.test.js", "codexRunnerProcess.test.js", "promptInteractiveRuntime.test.js"]);
  let missingStatusTest = false;
  context.mock.method(fs, "existsSync", (filename: fs.PathLike) => !missingStatusTest || !String(filename).endsWith("tabRunStatus.test.js"));
  const tests: string[] = regressionTests();
  for (const required of ["promptInteractiveRuntime", "tabRunStatus", "conversationTabClose", "loopSubtaskSession", "loopPlusRuntimeIntegration", "codexRunnerUnloadAcceptance", "loopPlusFixAcceptance"]) {
    assert.ok(tests.some((filename) => filename.endsWith(`${required}.test.js`)), required);
  }
  assert.equal(new Set(tests).size, tests.length);
  missingStatusTest = true;
  assert.throws(() => regressionTests(), /tabRunStatus/);
});

test("zero exit is insufficient without complete, non-skipped TAP evidence", () => {
  assert.equal(verifyRegressionResult(result(summary())).tests, 3);
  for (const field of ["fail", "cancelled", "skipped", "todo"]) assert.throws(() => verifyRegressionResult(result(summary({ [field]: 1 }))));
  for (const stdout of ["", summary({ tests: 0, pass: 0 }), summary({ pass: 2 }), `${summary()}\n# tests 3`]) {
    assert.throws(() => verifyRegressionResult(result(stdout)));
  }
  for (const change of [{ status: 1 }, { signal: "SIGTERM" }, { error: "spawn failed" }]) {
    assert.throws(() => verifyRegressionResult(result(summary(), change)));
  }
});

test("public runner must supply native protocol evidence matching version, path, cleanup, and summary", () => {
  const command = "C:/Program Files/Codex/codex.cmd";
  const reportPath = "C:/Reports/test.runner.json";
  const success = runnerFixture(command, reportPath);
  assert.equal(verifyRunnerResult(success.output, success.report, command, "0.162.1", reportPath).resourceCleanup, "verified");
  for (const mutate of [
    (value: ReturnType<typeof runnerFixture>) => { value.report.evidence.probes = []; },
    (value: ReturnType<typeof runnerFixture>) => { value.report.evidence.probes[0].version = "0.167.0"; },
    (value: ReturnType<typeof runnerFixture>) => { value.report.evidence.processes[0].command = "other CLI"; },
    (value: ReturnType<typeof runnerFixture>) => { value.report.evidence.environment.platform = "another-platform" as NodeJS.Platform; },
    (value: ReturnType<typeof runnerFixture>) => { value.report.evidence.cleanup.stdioClosed = false; },
    (value: ReturnType<typeof runnerFixture>) => { value.output.supervision!.closed = false; },
    (value: ReturnType<typeof runnerFixture>) => { value.output.supervision!.terminationAttempted = true; },
    (value: ReturnType<typeof runnerFixture>) => { value.output.supervision = undefined; },
    (value: ReturnType<typeof runnerFixture>) => { value.output.stdout += `\n${value.output.stdout}`; },
    (value: ReturnType<typeof runnerFixture>) => { value.output.stderr = '{"phase":"cleanup_failed"}'; },
    (value: ReturnType<typeof runnerFixture>) => { value.output.stdout = value.output.stdout.replace(/43/g, "44"); },
  ]) {
    const changed = runnerFixture(command, reportPath);
    mutate(changed);
    assert.throws(() => verifyRunnerResult(changed.output, changed.report, command, "0.162.1", reportPath));
  }
  assert.throws(() => verifyRunnerResult(success.output, success.report, command, "0.167.0", reportPath));
  assert.throws(() => verifyRunnerResult(success.output, success.report, command, "0.162.1", "stale.runner.json"));
});

test("unified acceptance pins one executable and isolated build for every native phase without changing process env", async (context) => {
  const state = fixture(context);
  const originalCommand = process.env.CODEX_COMMAND;
  const report = await runVerification(state.options, state.runtime);
  assert.equal(report.passed, true);
  assert.equal(report.fullyVerified, false);
  assert.equal(report.environment.codexCommand, state.command);
  assert.equal(report.environment.codexVersion, "0.162.1");
  assert.equal(report.environment.commit, "source-commit");
  assert.equal(report.environment.dirty, true);
  assert.deepEqual(report.coverage, { regression: true, poolHandoff: true, publicRunnerHandoff: true });
  assert.equal(report.runs.length, 3);
  assert.ok(report.checks.every((check: { passed: boolean }) => check.passed));
  assert.equal(process.env.CODEX_COMMAND, originalCommand);
  assert.deepEqual(state.calls[0], { command: "npm", args: ["run", "build"], env: undefined });
  const native = state.calls.filter((call) => call.args.includes("--live"));
  assert.equal(native.length, 4);
  for (const call of native) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.env?.CODEX_COMMAND, state.command);
    assert.equal(call.env?.SINITEK_CODEX_HANDOFF_MODULE_ROOT, path.resolve(__dirname, "../.."));
  }
  assert.ok(state.calls.findIndex((call) => call.args.includes("--test")) < state.calls.findIndex((call) => call.args.includes("--live")));
  const persisted = JSON.parse(fs.readFileSync(state.reportPath, "utf8"));
  assert.equal(persisted.verdict, "scoped-checks-passed");
  assert.ok(fs.readFileSync(report.logPath, "utf8").includes("public_runner_handoff"));
});

for (const scenario of ["build_failure", "skipped", "incomplete_pool", "missing_runner_report", "bad_runner_evidence", "cleanup_failure"]) {
  test(`unified acceptance never reports green for ${scenario}`, async (context) => {
    const state = fixture(context, scenario);
    const report = await runVerification(state.options, state.runtime);
    assert.equal(report.passed, false);
    assert.equal(report.verdict, "failed");
    assert.ok(report.failure);
    assert.ok(report.checks.some((check: { passed: boolean }) => !check.passed));
    assert.equal(JSON.parse(fs.readFileSync(state.reportPath, "utf8")).passed, false);
    assert.ok(fs.readFileSync(report.logPath, "utf8").includes(report.failure));
    if (["build_failure", "skipped"].includes(scenario)) assert.ok(!state.calls.some((call) => call.args.includes("--live")));
    if (scenario === "incomplete_pool") {
      assert.deepEqual(report.runs.map((run: { passed: boolean }) => run.passed), [true, false]);
      assert.ok(!state.calls.some((call) => path.basename(call.args[0]) === "verify_codex_runner_unload.js"));
    }
  });
}

test("existing reports and logs are not overwritten and launch no commands", async (context) => {
  const state = fixture(context);
  for (const filename of [state.reportPath, state.reportPath.replace(/\.json$/, ".log"), state.reportPath.replace(/\.json$/, ".runner.json")]) {
    fs.writeFileSync(filename, "keep-existing");
    await assert.rejects(runVerification(state.options, state.runtime), /不能覆盖/);
    assert.equal(fs.readFileSync(filename, "utf8"), "keep-existing");
    fs.unlinkSync(filename);
  }
  assert.equal(state.calls.length, 0);
});

test("an unresolved configured executable is a failure with no silent switch to PATH", async (context) => {
  const state = fixture(context);
  const report = await runVerification(state.options, { ...state.runtime, resolveCommand: () => null });
  assert.equal(report.passed, false);
  assert.match(report.failure, /--codex/);
  assert.equal(state.calls.length, 1);
});

test("help and missing consent have no live side effects, and native launchers preserve arguments and exit status", () => {
  const help = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--codex/);
  assert.doesNotMatch(help.stdout, /开始检测：/);
  const refused = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--live/);
  const mac = fs.readFileSync(script.replace(/\.js$/, ".command"), "utf8");
  assert.ok(mac.includes('"$(dirname "$0")/verify_loop_plus_fix.js" --live "$@"'));
  assert.match(mac, /exit \$\?/);
  const windows = fs.readFileSync(script.replace(/\.js$/, ".cmd"), "utf8");
  assert.ok(windows.includes('"%~dp0verify_loop_plus_fix.js" --live %*'));
  assert.match(windows, /exit \/b %VERIFY_EXIT%/);
});

test("native one-click launcher runs from another working directory without starting live work for help", () => {
  const launcher = script.replace(/\.js$/, process.platform === "win32" ? ".cmd" : ".command");
  const launched = require("cross-spawn").sync(launcher, ["--help"], { cwd: os.tmpdir(), encoding: "utf8" });
  assert.equal(launched.status, 0, launched.stderr || launched.error?.message);
  assert.match(launched.stdout, /verify:loop-plus/);
  assert.doesNotMatch(launched.stdout, /开始检测：/);
});
