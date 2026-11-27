import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "node:child_process";
import {
  classifyLoopPlusInterruption,
  readLoopPlusInterruptionSource,
  summarizeLoopPlusProtocolRejection,
} from "../../extensionHost/loopPlusDiagnostics";

test("interruption source keeps only a known phase and reason", () => {
  assert.equal(classifyLoopPlusInterruption({ status: "stopped" }), "user-stop");
  assert.equal(classifyLoopPlusInterruption({ status: "error", userStopSource: "group-chat" }), "user-stop");
  assert.equal(classifyLoopPlusInterruption({ status: "error", persistenceFailure: true, userStopSource: "ai-panel" }), "persistence-failure");
  assert.equal(classifyLoopPlusInterruption({ status: "error", backgroundSubtaskFailure: true }), "background-subtask-failure");
  assert.equal(classifyLoopPlusInterruption({ status: "error" }), "execution-error");
  assert.deepEqual(readLoopPlusInterruptionSource({
    phase: "reviewing",
    reason: "execution-error",
    taskId: "msg_secret",
    error: "SYNTHETIC_PRIVATE_ERROR",
  }), { phase: "reviewing", reason: "execution-error" });
  assert.equal(readLoopPlusInterruptionSource({ phase: "nope", reason: "execution-error" }), undefined);
  assert.equal(readLoopPlusInterruptionSource({ phase: "idle", reason: "not-a-reason" }), undefined);
  assert.equal(readLoopPlusInterruptionSource(null), undefined);
});

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
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-interruption-source', {
        phase: 'reviewing', reason: 'execution-error', carried: false,
        taskId: 'msg_test', error: secret, detail: secret,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-interruption-source', {
        phase: 'not-a-phase', reason: 'execution-error', taskId: 'msg_test', error: secret,
      });
      await logger.logEssential('flush');
      const files = fs.readdirSync(path.join(process.env.HOME, '.sinitek_cli', 'logs'));
      const lines = files.map((file) => fs.readFileSync(path.join(process.env.HOME, '.sinitek_cli', 'logs', file), 'utf8')).join('\\n');
      if (!lines.includes('loop-plus-persist-failed') || !lines.includes('loop-plus-report-failed')
        || !lines.includes('loop-plus-subtask-tab-auto-close-error') || !lines.includes('loop-plus-subtask-tab-auto-closed')
        || !lines.includes('close_task') || !lines.includes('report_task') || !lines.includes('attempt_test')
        || !lines.includes('"stage":"handoff","code":"identity-rejected"')
        || !lines.includes('retrying') || lines.includes('loop-plus-paused')
        || !lines.includes('loop-plus-interruption-source')
        || !lines.includes('"phase":"reviewing"') || !lines.includes('"reason":"execution-error"')
        || !lines.includes('"carried":false') || lines.includes('not-a-phase')
        || lines.includes(secret) || lines.includes('msg_test')) throw Error('incorrect loop diagnostics');
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("dispatch host rejections stay on disk when debug logging is off and omit identifiers", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "loop-plus-dispatch-rejection-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const script = `
    const fs = require('node:fs'), path = require('node:path');
    const assert = require('node:assert/strict');
    const logger = require(${JSON.stringify(require.resolve("../../logger"))});
    const diagnostics = require(${JSON.stringify(require.resolve("../../extensionHost/loopPlusDiagnostics"))});
    (async () => {
      await logger.initLogger();
      logger.setDebugLogging(false);
      const secret = 'SYNTHETIC_DISPATCH_SECRET';
      const taskId = 'msg_dispatch_secret';
      const subtaskId = 'child_dispatch_secret';
      const attemptId = 'attempt_dispatch_secret';
      const prompt = 'PROMPT_DISPATCH_SECRET';
      const filePath = '/tmp/dispatch-secret/src/evil.ts';
      const freeText = 'FREE_TEXT_GRAPH_ERROR';
      const foreignReason = 'model rejected the prompt verbatim';
      const summary = diagnostics.summarizeLoopPlusDispatchRejections([
        { reason: 'invalid_spec', subtaskId, attemptId, detail: freeText },
        { reason: 'duplicate_attempt', prompt, path: filePath },
        { reason: 'active_subtask', taskId },
        { reason: 'parent_stopped' },
        { reason: 'completed' },
        { reason: 'invalid_dependencies', detail: freeText },
        { reason: foreignReason, prompt },
        { reason: 12 },
        null,
      ]);
      assert.deepEqual(summary, {
        rejectedCount: 9,
        reasonCounts: {
          invalid_spec: 1,
          duplicate_attempt: 1,
          active_subtask: 1,
          parent_stopped: 1,
          completed: 1,
          invalid_dependencies: 1,
          other: 3,
        },
      });
      assert.equal(diagnostics.summarizeLoopPlusDispatchRejections([]), null);
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-dispatched', {
        taskId, subtaskId, attemptId, prompt, path: filePath, detail: freeText, secret,
        rejected: [{ subtaskId, attemptId, reason: 'active_subtask', detail: freeText, prompt, secret }],
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-dispatch-rejected', {
        rejectedCount: 99,
        taskId, subtaskId, attemptId, prompt, path: filePath, detail: freeText, secret,
        reasonCounts: {
          active_subtask: 2,
          invalid_dependencies: 1,
          [foreignReason]: 4,
          '../secret': 1,
        },
        rejected: [{ subtaskId, attemptId, reason: 'active_subtask', detail: freeText, prompt, path: filePath }],
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-dispatch-rejected', {
        rejectedCount: 1,
        reasonCounts: { [foreignReason]: 1 },
        taskId, prompt, path: filePath, detail: freeText,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-dispatch-rejected', {
        taskId, prompt, path: filePath,
        rejected: [{ subtaskId, attemptId, reason: 'duplicate_attempt', detail: freeText, prompt }],
      });
      await logger.logEssential('flush');
      const logsDir = path.join(process.env.HOME, '.sinitek_cli', 'logs');
      const lines = fs.readdirSync(logsDir).map((file) => fs.readFileSync(path.join(logsDir, file), 'utf8')).join('\\n');
      const events = lines.split('\\n').filter((line) => line.includes('loop-plus-dispatch-rejected'));
      if (events.length !== 2) throw new Error('expected two persistent dispatch rejection lines, got ' + events.length + '\\n' + lines);
      const persisted = events.join('\\n');
      if (!persisted.includes('"rejectedCount":3') || !persisted.includes('"active_subtask":2')
        || !persisted.includes('"invalid_dependencies":1') || !persisted.includes('"duplicate_attempt":1')
        || !persisted.includes('[INFO]')) throw new Error('missing whitelist rejection counts\\n' + persisted);
      if (lines.includes('loop-plus-dispatched') || lines.includes(secret) || lines.includes(taskId)
        || lines.includes(subtaskId) || lines.includes(attemptId) || lines.includes(prompt)
        || lines.includes(filePath) || lines.includes(freeText) || lines.includes(foreignReason)
        || lines.includes('rejectedCount":99') || lines.includes('msg_') || lines.includes('/tmp/')) {
        throw new Error('dispatch rejection log leaked debug payload or identifiers\\n' + lines);
      }
      logger.setDebugLogging(true);
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-dispatched', {
        taskId: 'debug-only-task',
        rejected: [{ subtaskId: 'debug-only-subtask', attemptId: 'debug-only-attempt', reason: 'active_subtask' }],
      });
      await logger.logEssential('flush-debug');
      const debugLines = fs.readdirSync(logsDir).map((file) => fs.readFileSync(path.join(logsDir, file), 'utf8')).join('\\n');
      if (!debugLines.includes('loop-plus-dispatched') || !debugLines.includes('debug-only-subtask')) {
        throw new Error('debug dispatch payload was not retained while debug logging is on\\n' + debugLines);
      }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("protocol rejection summary keeps only the diagnostic contract", () => {
  assert.deepEqual(summarizeLoopPlusProtocolRejection({
    taskId: "msg_secret",
    sessionId: "sess_secret",
    prompt: "PROMPT_SECRET",
    error: "RAW_ERROR",
    path: "/tmp/secret.ts",
    rejectionKind: "format",
    reasonCode: "format.ColonExpected",
    fieldPath: "/tmp/secret.ts",
    protocolFailureCount: 1,
    recoveryStage: "continuation_requested",
    dispatchWindow: "closed",
  }), {
    rejectionKind: "format",
    reasonCode: "format.ColonExpected",
    protocolFailureCount: 1,
    recoveryStage: "continuation_requested",
    dispatchWindow: "closed",
  });
  assert.deepEqual(summarizeLoopPlusProtocolRejection({
    reasonCode: "validation.invalid_decision",
    fieldPath: "accept.reviews[1].prompt",
    protocolFailureCount: 2,
    recoveryStage: "continuation_requested",
    dispatchWindow: "closed",
    taskId: "msg_secret",
  }), {
    rejectionKind: "validation",
    reasonCode: "validation.invalid_decision",
    protocolFailureCount: 2,
    recoveryStage: "continuation_requested",
    dispatchWindow: "closed",
  });
  assert.deepEqual(summarizeLoopPlusProtocolRejection({
    reasonCode: "state.dispatch_window.preflight_failed",
    fieldPath: "/tmp/secret.ts",
    rejectionKind: "validation",
    protocolFailureCount: 1,
    recoveryStage: "continuation_requested",
    dispatchWindow: "open",
    reasonCounts: { active_subtask: 9 },
  }), {
    rejectionKind: "state",
    reasonCode: "state.dispatch_window.preflight_failed",
    fieldPath: "subtasks",
    protocolFailureCount: 1,
    recoveryStage: "continuation_requested",
    dispatchWindow: "open",
  });
  assert.equal(summarizeLoopPlusProtocolRejection({
    reasonCode: "validation.accept.invalid_reviews",
    fieldPath: "accept.reviews[1].acceptance",
    protocolFailureCount: 1,
    recoveryStage: "paused",
  }).fieldPath, "accept.reviews[1].acceptance");
  assert.equal(summarizeLoopPlusProtocolRejection({
    reasonCode: "validation.accept.invalid_reviews",
    fieldPath: "accept.reviews[1].prompt",
  }).fieldPath, "accept.reviews");
  assert.deepEqual(summarizeLoopPlusProtocolRejection({
    reasonCode: "format.NotARealCode",
    fieldPath: "/tmp/secret.ts",
    recoveryStage: "invented",
    protocolFailureCount: 1000,
    dispatchWindow: "wide",
  }), {
    rejectionKind: "format",
    reasonCode: "format.invalid_json",
    protocolFailureCount: 0,
    recoveryStage: "stopped",
    dispatchWindow: "closed",
  });
  assert.equal(summarizeLoopPlusProtocolRejection(null).reasonCode, "validation.invalid_decision");
});

test("protocol rejection summaries stay on disk when debug logging is off and omit identifiers", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "loop-plus-protocol-rejection-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const script = `
    const fs = require('node:fs'), path = require('node:path');
    const logger = require(${JSON.stringify(require.resolve("../../logger"))});
    const diagnostics = require(${JSON.stringify(require.resolve("../../extensionHost/loopPlusDiagnostics"))});
    (async () => {
      await logger.initLogger();
      logger.setDebugLogging(false);
      const secret = 'SYNTHETIC_PROTOCOL_SECRET';
      const taskId = 'msg_protocol_secret';
      const sessionId = 'sess_protocol_secret';
      const prompt = 'PROMPT_PROTOCOL_SECRET';
      const filePath = '/tmp/protocol-secret/src/evil.ts';
      const rawError = 'RAW_PROTOCOL_ERROR_TEXT';
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-miss', {
        taskId, sessionId, prompt, path: filePath, error: rawError, held: false,
        protocolFailureCount: 1, rejectionKind: 'format', reasonCode: 'format.ColonExpected',
        dispatchWindow: 'closed', attemptState: 'first',
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-rejection', {
        taskId, sessionId, prompt, path: filePath, error: rawError,
        rejectionKind: 'format', reasonCode: 'format.ColonExpected', fieldPath: filePath,
        protocolFailureCount: 1, recoveryStage: 'continuation_requested', dispatchWindow: 'closed',
        position: { line: 2, column: 12 },
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-rejection', {
        taskId, sessionId, prompt, error: rawError, path: filePath,
        rejectionKind: 'format', reasonCode: 'validation.invalid_decision', fieldPath: filePath,
        protocolFailureCount: 2, recoveryStage: 'continuation_requested', dispatchWindow: 'closed',
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-rejection', {
        taskId, sessionId, prompt, error: rawError, path: filePath,
        rejectionKind: 'validation', reasonCode: 'state.dispatch_window.preflight_failed',
        fieldPath: filePath, protocolFailureCount: 1, recoveryStage: 'continuation_requested',
        dispatchWindow: 'open', reasonCounts: { invalid_dependencies: 4, active_subtask: 2 },
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-rejection', {
        taskId, prompt, reasonCode: 'validation.accept.invalid_reviews',
        fieldPath: 'accept.reviews[1].acceptance', protocolFailureCount: 3,
        recoveryStage: 'paused', dispatchWindow: 'open',
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-rejection', {
        reasonCode: 'format.NotARealCode', fieldPath: filePath, recoveryStage: 'invented',
        protocolFailureCount: 1000, dispatchWindow: 'wide', taskId, prompt, error: rawError,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-recovery', {
        taskId, sessionId, prompt, error: rawError, result: 'recovered',
        protocolFailureCount: 1, attemptState: 'first', automaticRetryLimit: 3,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-dispatch-rejected', {
        rejectedCount: 1, reasonCounts: { invalid_dependencies: 1 },
        taskId, prompt, path: filePath, detail: rawError,
      });
      await logger.logEssential('flush');
      const logsDir = path.join(process.env.HOME, '.sinitek_cli', 'logs');
      const lines = fs.readdirSync(logsDir).map((file) => fs.readFileSync(path.join(logsDir, file), 'utf8')).join('\\n');
      const rejectionLines = lines.split('\\n').filter((line) => line.includes('loop-plus-protocol-rejection'));
      if (rejectionLines.length !== 5) throw new Error('expected five rejection summaries, got ' + rejectionLines.length + '\\n' + lines);
      const summaries = rejectionLines.map((line) => JSON.parse(line.slice(line.indexOf(' | ') + 3)));
      const byCode = Object.fromEntries(summaries.map((item) => [item.reasonCode, item]));
      const format = byCode['format.ColonExpected'];
      const crossField = byCode['validation.invalid_decision'];
      const preflight = byCode['state.dispatch_window.preflight_failed'];
      if (!format || format.rejectionKind !== 'format' || format.fieldPath || format.protocolFailureCount !== 1
        || format.recoveryStage !== 'continuation_requested' || format.dispatchWindow !== 'closed') {
        throw new Error('format summary was not distinct\\n' + JSON.stringify(summaries));
      }
      if (!crossField || crossField.rejectionKind !== 'validation' || crossField.fieldPath
        || crossField.protocolFailureCount !== 2 || crossField.recoveryStage !== 'continuation_requested') {
        throw new Error('cross-field summary was not distinct\\n' + JSON.stringify(summaries));
      }
      if (!preflight || preflight.rejectionKind !== 'state' || preflight.fieldPath !== 'subtasks'
        || preflight.dispatchWindow !== 'open' || preflight.reasonCounts) {
        throw new Error('preflight summary was not distinct\\n' + JSON.stringify(summaries));
      }
      if (byCode['validation.accept.invalid_reviews'].fieldPath !== 'accept.reviews[1].acceptance'
        || byCode['validation.accept.invalid_reviews'].recoveryStage !== 'paused'
        || byCode['format.invalid_json'].recoveryStage !== 'stopped'
        || byCode['format.invalid_json'].protocolFailureCount !== 0
        || byCode['format.invalid_json'].fieldPath) {
        throw new Error('controlled field or fallback summary was wrong\\n' + JSON.stringify(summaries));
      }
      const rejectionText = rejectionLines.join('\\n');
      if (lines.includes('loop-plus-protocol-miss') || lines.includes('loop-plus-protocol-recovery')
        || rejectionText.includes(secret) || rejectionText.includes(taskId) || rejectionText.includes(sessionId)
        || rejectionText.includes(prompt) || rejectionText.includes(filePath) || rejectionText.includes(rawError)
        || rejectionText.includes('reasonCounts') || rejectionText.includes('msg_') || rejectionText.includes('/tmp/')) {
        throw new Error('protocol rejection log leaked debug payload or identifiers\\n' + lines);
      }
      if (!lines.includes('loop-plus-dispatch-rejected') || !lines.includes('"invalid_dependencies":1')
        || !lines.includes('"rejectedCount":1')) {
        throw new Error('dispatch counts were not left on the original event\\n' + lines);
      }
      logger.setDebugLogging(true);
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-miss', {
        taskId: 'debug-protocol-task', held: false, protocolFailureCount: 1,
        rejectionKind: 'format', reasonCode: 'format.ColonExpected', dispatchWindow: 'closed', attemptState: 'first',
      });
      await logger.logEssential('flush-debug');
      const debugLines = fs.readdirSync(logsDir).map((file) => fs.readFileSync(path.join(logsDir, file), 'utf8')).join('\\n');
      const debugMiss = debugLines.split('\\n').filter((line) => line.includes('loop-plus-protocol-miss'));
      if (debugMiss.length !== 1 || !debugMiss[0].includes('debug-protocol-task') || !debugMiss[0].includes('format.ColonExpected')) {
        throw new Error('debug protocol miss was not retained while debug logging is on\\n' + debugLines);
      }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
