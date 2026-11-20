import test = require("node:test");
import assert = require("node:assert/strict");
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as logger from "../../logger";
import { createPerformanceTrace, type PerformanceEntry } from "../../performanceLog";

test("performance traces record settled stages once without capturing execution content", async (context) => {
  const entries: PerformanceEntry[] = [];
  context.mock.method(logger, "writePerformanceLog", async (entry: PerformanceEntry) => {
    entries.push(entry);
  });

  const trace = createPerformanceTrace("loop_plus", "codex", "subtask");
  const finishAdmission = trace.start("attempt-admission");
  finishAdmission("denied");
  finishAdmission("returned");
  assert.equal(await trace.measure("attempt-execution", async () => "done"), "done");
  assert.equal(await trace.measure("main-turn", async () => "done", () => { throw new Error("bad outcome mapping"); }), "done");
  await assert.rejects(trace.measure("runner", async () => { throw new Error("private prompt"); }));

  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(({ phase, outcome }) => ({ phase, outcome })), [
    { phase: "attempt-admission", outcome: "denied" },
    { phase: "attempt-execution", outcome: "returned" },
    { phase: "main-turn", outcome: "returned" },
    { phase: "runner", outcome: "threw" },
  ]);
  assert.ok(entries.every((entry) => entry.durationMs >= 0 && !("prompt" in entry)));
  assert.equal(new Set(entries.map((entry) => entry.traceId)).size, 1);
});

test("performance logs persist with debug disabled and follow history retention", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-performance-log-"));
  const dataDir = path.join(home, ".sinitek_cli");
  const logsDir = path.join(dataDir, "logs");
  const expiredLog = path.join(logsDir, "sinitek-cli.expired.log");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ historyRetentionDays: 1 }));
  fs.writeFileSync(expiredLog, "expired");
  const expiredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(expiredLog, expiredAt, expiredAt);

  const loggerPath = path.resolve(__dirname, "../../logger");
  const script = `
    (async () => {
      const logger = require(${JSON.stringify(loggerPath)});
      await logger.initLogger();
      await logger.writePerformanceLog({ traceId: "trace-test", mode: "vibe", cli: "codex", role: "main",
        phase: "runner", outcome: "completed", durationMs: 12.5 });
      await logger.scheduleLogRetentionCleanup();
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  try {
    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(expiredLog), false);
    const performanceFile = fs.readdirSync(logsDir).find((name) => name.startsWith("sinitek-cli.performance."));
    assert.ok(performanceFile);
    const entry = JSON.parse(fs.readFileSync(path.join(logsDir, performanceFile), "utf8").trim());
    assert.equal(entry.traceId, "trace-test");
    assert.equal(entry.phase, "runner");
    assert.equal(entry.durationMs, 12.5);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
