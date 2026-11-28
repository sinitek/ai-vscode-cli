import test = require("node:test");
import assert = require("node:assert/strict");
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function runLoggerScenario(scriptBody: string): { home: string; status: number | null; stderr: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-logger-test-"));
  const loggerPath = path.resolve(__dirname, "../../logger");
  const script = `(async () => { const logger = require(${JSON.stringify(loggerPath)}); await logger.initLogger(); ${scriptBody} })().catch((error) => { console.error(error); process.exitCode = 1; });`;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { home, status: result.status, stderr: result.stderr };
}

test("debug logging defaults on and includes task and performance diagnostics", () => {
  const result = runLoggerScenario(`
    await logger.logInfo("loop-plus-dispatched", { taskId: "task-1" });
    await logger.writePerformanceLog({ traceId: "trace-1", mode: "loop_plus", role: "main", phase: "runner", outcome: "completed", durationMs: 5 });
  `);
  try {
    assert.equal(result.status, 0, result.stderr);
    const logsDir = path.join(result.home, ".sinitek_cli", "logs");
    const entries = fs.readFileSync(path.join(logsDir, fs.readdirSync(logsDir).find((name) => name.startsWith("sinitek-cli.") && !name.includes("performance"))!), "utf8");
    assert.match(entries, /loop-plus-dispatched/);
    assert.ok(fs.readdirSync(logsDir).some((name) => name.startsWith("sinitek-cli.performance.")));
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    assert.equal(packageJson.contributes.configuration.properties["sinitek-cli-tools.debug"].default, true);
  } finally {
    fs.rmSync(result.home, { recursive: true, force: true });
  }
});

test("disabled debug suppresses non-errors and performance logs but preserves errors", () => {
  const result = runLoggerScenario(`
    logger.setDebugLogging(false);
    await logger.logInfo("ordinary-diagnostic");
    await logger.logDebug("assistant-chunk");
    await logger.logInfo("config-panel-save-failed");
    await logger.logError("task-run-error");
    await logger.writePerformanceLog({ traceId: "trace-off", mode: "vibe", phase: "runner", outcome: "threw", durationMs: 7 });
    logger.setDebugLogging(true);
    await logger.logInfo("debug-reenabled");
    await logger.writePerformanceLog({ traceId: "trace-on", mode: "loop_plus", phase: "attempt", outcome: "completed", durationMs: 9 });
  `);
  try {
    assert.equal(result.status, 0, result.stderr);
    const logsDir = path.join(result.home, ".sinitek_cli", "logs");
    const generalLog = fs.readFileSync(path.join(logsDir, fs.readdirSync(logsDir).find((name) => name.startsWith("sinitek-cli.") && !name.includes("performance"))!), "utf8");
    assert.match(generalLog, /\[ERROR\] config-panel-save-failed/);
    assert.match(generalLog, /\[ERROR\] task-run-error/);
    assert.match(generalLog, /debug-reenabled/);
    assert.doesNotMatch(generalLog, /ordinary-diagnostic|assistant-chunk/);
    const performanceLogs = fs.readdirSync(logsDir).filter((name) => name.startsWith("sinitek-cli.performance."));
    assert.equal(performanceLogs.length, 1);
    assert.match(fs.readFileSync(path.join(logsDir, performanceLogs[0]), "utf8"), /trace-on/);
    assert.doesNotMatch(fs.readFileSync(path.join(logsDir, performanceLogs[0]), "utf8"), /trace-off/);
  } finally {
    fs.rmSync(result.home, { recursive: true, force: true });
  }
});
