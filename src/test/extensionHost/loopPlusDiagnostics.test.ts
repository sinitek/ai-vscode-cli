import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "node:child_process";

test("Loop+ persistence errors are logged with debug disabled and do not leak the original error", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "loop-plus-diagnostics-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const script = `
    const fs = require('node:fs'), path = require('node:path');
    const logger = require(${JSON.stringify(require.resolve("../../logger"))});
    const diagnostics = require(${JSON.stringify(require.resolve("../../extensionHost/loopPlusDiagnostics"))});
    (async () => {
      await logger.initLogger(); logger.setDebugLogging(false);
      const secret = 'SYNTHETIC_PRIVATE_ERROR';
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-persist-failed', { taskId: 'msg_test', stage: 'finish-commit', reason: 'exception', error: secret });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-report-failed', { taskId: 'report_task', attemptId: 'attempt_test', error: secret });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-subtask-tab-auto-close-error', {
        taskId: 'close_task', subtaskId: 'child_a', attemptId: 'attempt_a', tabId: 'tab_a', closeAttempt: 1,
        retrying: true, error: 'simulated close rejection',
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-subtask-tab-auto-closed', {
        taskId: 'close_task', subtaskId: 'child_a', attemptId: 'attempt_a', tabId: 'tab_a', closeAttempt: 2,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-invocation-diagnostic', {
        stage: 'handoff', code: 'identity-rejected', content: secret, prompt: secret, sessionId: secret, path: secret,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-paused', { taskId: 'msg_test' });
      await logger.logEssential('flush');
      const files = fs.readdirSync(path.join(process.env.HOME, '.sinitek_cli', 'logs'));
      const lines = files.map((file) => fs.readFileSync(path.join(process.env.HOME, '.sinitek_cli', 'logs', file), 'utf8')).join('\\n');
      if (!lines.includes('loop-plus-persist-failed') || !lines.includes('loop-plus-report-failed')
        || !lines.includes('loop-plus-subtask-tab-auto-close-error') || !lines.includes('loop-plus-subtask-tab-auto-closed')
        || !lines.includes('close_task') || !lines.includes('report_task') || !lines.includes('attempt_test')
        || !lines.includes('"stage":"handoff","code":"identity-rejected"')
        || !lines.includes('retrying') || lines.includes('loop-plus-paused')
        || lines.includes(secret) || lines.includes('msg_test')) throw Error('incorrect loop diagnostics');
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
