import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

type CommandResult = { status: number | null; signal: string | null; stdout: string; stderr: string; error: string | null };
type Options = { live: boolean; help: boolean; runs: number; report: string | null };
type Report = { passed: boolean; runs: { passed: boolean }[]; failure?: string };
const scriptPath = path.resolve(__dirname, "../../../scripts/verify_codex_thread_handoff_acceptance.js");
const { parseOptions, verifyLiveResult, runAcceptance } = require(scriptPath) as {
  parseOptions: (args: string[]) => Options;
  verifyLiveResult: (result: CommandResult) => Record<string, unknown>;
  runAcceptance: (options: Options, execute: (command: string, args: string[], echo?: boolean) => Promise<CommandResult>) => Promise<Report>;
};

function liveResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    status: 0, signal: null, stderr: "", error: null,
    stdout: [
      { phase: "writer_conflict_reproduced", differentProcesses: true },
      { phase: "handoff_verified", elapsedMs: 60001, sameThread: true, otherThreadRetained: true, localRequests: 1 },
    ].map((event) => JSON.stringify(event)).join("\r\n"),
    ...overrides,
  };
}

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
    assert.throws(() => verifyLiveResult(liveResult({ stdout: mutation.map((event) => JSON.stringify(event)).join("\n") })));
  }
});

for (const scenario of ["pass", "build_failure", "incomplete_live", "cleanup_failure"] as const) {
  test(`acceptance orchestration writes a truthful report: ${scenario}`, async (context) => {
    context.mock.method(console, "log", () => undefined);
    context.mock.method(console, "error", () => undefined);
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

test("acceptance help is safe and does not start live verification", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /自动构建/);
  assert.doesNotMatch(result.stdout, /acceptance_step_started/);
});
