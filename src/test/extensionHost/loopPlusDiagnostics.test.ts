import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "node:child_process";
import {
  classifyLoopPlusInterruption,
  readLoopPlusInterruptionSource,
  summarizeLoopPlusMainTerminal,
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
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-finish-contention', { batchKey: '0123456789ab', result: 'waiting-for-watchdog',
        stage: 'receipt-write', reason: 'identity-lock-present', retry: 4, elapsedMs: 1500, schedulerSeq: 22,
        taskId: 'msg_test', attemptId: secret, detail: secret, error: secret });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-completion-commit', { batchKey: '0123456789ab', result: 'waiting-for-watchdog',
        stage: 'host-route', attempt: 3, elapsedMs: 1500, taskId: 'msg_test', prompt: secret, response: secret });
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
      await logger.logError('flush');
      const files = fs.readdirSync(path.join(process.env.HOME, '.sinitek_cli', 'logs'));
      const lines = files.map((file) => fs.readFileSync(path.join(process.env.HOME, '.sinitek_cli', 'logs', file), 'utf8')).join('\\n');
      if (!lines.includes('"result":"waiting-for-watchdog"') || !lines.includes('"batchKey":"0123456789ab"')
        || !lines.includes('loop-plus-finish-contention') || !lines.includes('"stage":"receipt-write"')
        || !lines.includes('loop-plus-persist-failed') || !lines.includes('loop-plus-report-failed')
        || !lines.includes('loop-plus-subtask-tab-auto-close-error') || !lines.includes('close_task')
        || !lines.includes('report_task') || !lines.includes('attempt_test')
        || lines.includes('loop-plus-subtask-tab-auto-closed') || lines.includes('loop-plus-invocation-diagnostic')
        || lines.includes('loop-plus-paused') || lines.includes('loop-plus-interruption-source')
        || lines.includes(secret) || lines.includes('msg_test')) throw Error('incorrect errors-only diagnostics');
      logger.setDebugLogging(true);
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-subtask-tab-auto-closed', {
        taskId: 'close_task', subtaskId: 'child_a', attemptId: 'attempt_a', tabId: 'tab_a', closeAttempt: 2,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-invocation-diagnostic', {
        stage: 'handoff', code: 'identity-rejected', content: secret, prompt: secret, sessionId: secret, path: secret,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-paused', { taskId: 'msg_test' });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-interruption-source', {
        phase: 'reviewing', reason: 'execution-error', carried: false, taskId: 'msg_test', error: secret, detail: secret,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-interruption-source', {
        phase: 'not-a-phase', reason: 'execution-error', taskId: 'msg_test', error: secret,
      });
      await logger.logEssential('flush-debug');
      const debugLines = fs.readdirSync(path.join(process.env.HOME, '.sinitek_cli', 'logs'))
        .map((file) => fs.readFileSync(path.join(process.env.HOME, '.sinitek_cli', 'logs', file), 'utf8')).join('\\n');
      if (!debugLines.includes('loop-plus-subtask-tab-auto-closed')
        || !debugLines.includes('"stage":"handoff","code":"identity-rejected"')
        || !debugLines.includes('loop-plus-paused') || !debugLines.includes('loop-plus-interruption-source')
        || !debugLines.includes('"phase":"reviewing"') || !debugLines.includes('"reason":"execution-error"')
        || !debugLines.includes('"carried":false') || debugLines.includes('not-a-phase')
        || debugLines.includes(secret)) throw Error('debug task diagnostics were not retained safely');
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
        { reason: 'duplicate_subtask', subtaskId },
        { reason: 'parent_stopped' },
        { reason: 'completed' },
        { reason: 'invalid_dependencies', detail: freeText },
        { reason: foreignReason, prompt },
        { reason: 12 },
        null,
      ]);
      assert.deepEqual(summary, {
        rejectedCount: 10,
        reasonCounts: {
          invalid_spec: 1,
          duplicate_attempt: 1,
          active_subtask: 1,
          duplicate_subtask: 1,
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
          duplicate_subtask: 1,
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
      await logger.logError('flush');
      const logsDir = path.join(process.env.HOME, '.sinitek_cli', 'logs');
      const lines = fs.readdirSync(logsDir).map((file) => fs.readFileSync(path.join(logsDir, file), 'utf8')).join('\\n');
      const events = lines.split('\\n').filter((line) => line.includes('loop-plus-dispatch-rejected'));
      if (events.length !== 2) throw new Error('expected two persistent dispatch rejection lines, got ' + events.length + '\\n' + lines);
      const persisted = events.join('\\n');
      if (!persisted.includes('"rejectedCount":4') || !persisted.includes('"active_subtask":2')
        || !persisted.includes('"duplicate_subtask":1')
        || !persisted.includes('"invalid_dependencies":1') || !persisted.includes('"duplicate_attempt":1')
        || !persisted.includes('[ERROR]')) throw new Error('missing whitelist rejection counts\\n' + persisted);
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
  assert.deepEqual(summarizeLoopPlusProtocolRejection({
    reasonCode: "state.dispatch.rejected",
    fieldPath: "/tmp/secret.ts",
    taskId: "msg_secret",
    prompt: "PROMPT_SECRET",
    decisionStatus: "accept",
    protocolFailureCount: 4,
    recoveryStage: "paused",
    dispatchWindow: "closed",
    reasonCounts: { active_subtask: 9 },
    collisionCounts: { active_subtask: 1, duplicate_subtask: 0, subtaskId: "child_secret", note: "FREE_TEXT" },
  }), {
    rejectionKind: "state",
    reasonCode: "state.dispatch.rejected",
    fieldPath: "subtasks",
    protocolFailureCount: 4,
    recoveryStage: "paused",
    dispatchWindow: "closed",
    decisionStatus: "accept",
    collisionCounts: { active_subtask: 1, duplicate_subtask: 0 },
  });
  assert.equal(summarizeLoopPlusProtocolRejection({
    reasonCode: "state.dispatch.rejected",
    decisionStatus: "model wrote a status",
    collisionCounts: { active_subtask: -1, duplicate_subtask: 1.5 },
  }).decisionStatus, undefined);
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
        decisionStatus: 'accept', collisionCounts: { active_subtask: 3, duplicate_subtask: 1 },
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-rejection', {
        taskId, sessionId, prompt, path: filePath, error: rawError,
        reasonCode: 'state.dispatch.rejected', fieldPath: filePath,
        protocolFailureCount: 4, recoveryStage: 'paused', dispatchWindow: 'closed',
        decisionStatus: 'accept',
        reasonCounts: { active_subtask: 9, duplicate_subtask: 8 },
        collisionCounts: { active_subtask: 1, duplicate_subtask: 2, subtaskId: 'child_protocol_secret', note: rawError },
        rejected: [{ subtaskId: 'child_protocol_secret', attemptId: 'attempt_protocol_secret', prompt }],
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-recovery', {
        taskId, sessionId, prompt, error: rawError, result: 'recovered',
        protocolFailureCount: 1, attemptState: 'first', automaticRetryLimit: 3,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-dispatch-rejected', {
        rejectedCount: 1, reasonCounts: { invalid_dependencies: 1 },
        taskId, prompt, path: filePath, detail: rawError,
      });
      await logger.logError('flush');
      const logsDir = path.join(process.env.HOME, '.sinitek_cli', 'logs');
      const lines = fs.readdirSync(logsDir).map((file) => fs.readFileSync(path.join(logsDir, file), 'utf8')).join('\\n');
      const rejectionLines = lines.split('\\n').filter((line) => line.includes('loop-plus-protocol-rejection'));
      if (rejectionLines.length !== 6) throw new Error('expected six rejection summaries, got ' + rejectionLines.length + '\\n' + lines);
      const summaries = rejectionLines.map((line) => JSON.parse(line.slice(line.indexOf(' | ') + 3)));
      const byCode = Object.fromEntries(summaries.map((item) => [item.reasonCode, item]));
      const format = byCode['format.ColonExpected'];
      const crossField = byCode['validation.invalid_decision'];
      const preflight = byCode['state.dispatch_window.preflight_failed'];
      if (!format || format.rejectionKind !== 'format' || format.fieldPath || format.protocolFailureCount !== 1
        || format.recoveryStage !== 'continuation_requested' || format.dispatchWindow !== 'closed'
        || format.decisionStatus || format.collisionCounts) {
        throw new Error('format summary was not distinct\\n' + JSON.stringify(summaries));
      }
      if (!crossField || crossField.rejectionKind !== 'validation' || crossField.fieldPath
        || crossField.protocolFailureCount !== 2 || crossField.recoveryStage !== 'continuation_requested') {
        throw new Error('cross-field summary was not distinct\\n' + JSON.stringify(summaries));
      }
      if (!preflight || preflight.rejectionKind !== 'state' || preflight.fieldPath !== 'subtasks'
        || preflight.dispatchWindow !== 'open' || preflight.reasonCounts
        || preflight.decisionStatus || preflight.collisionCounts) {
        throw new Error('preflight summary was not distinct\\n' + JSON.stringify(summaries));
      }
      const dispatchRejected = byCode['state.dispatch.rejected'];
      if (!dispatchRejected || dispatchRejected.decisionStatus !== 'accept' || dispatchRejected.fieldPath !== 'subtasks'
        || dispatchRejected.protocolFailureCount !== 4 || dispatchRejected.recoveryStage !== 'paused'
        || dispatchRejected.dispatchWindow !== 'closed' || dispatchRejected.reasonCounts
        || dispatchRejected.collisionCounts.active_subtask !== 1
        || dispatchRejected.collisionCounts.duplicate_subtask !== 2
        || Object.keys(dispatchRejected.collisionCounts).length !== 2) {
        throw new Error('dispatch collision summary was not distinct\\n' + JSON.stringify(summaries));
      }
      if (byCode['validation.accept.invalid_reviews'].fieldPath !== 'accept.reviews[1].acceptance'
        || byCode['validation.accept.invalid_reviews'].recoveryStage !== 'paused'
        || byCode['format.invalid_json'].recoveryStage !== 'stopped'
        || byCode['format.invalid_json'].protocolFailureCount !== 0
        || byCode['format.invalid_json'].fieldPath
        || byCode['format.invalid_json'].decisionStatus
        || byCode['format.invalid_json'].collisionCounts) {
        throw new Error('controlled field or fallback summary was wrong\\n' + JSON.stringify(summaries));
      }
      const rejectionText = rejectionLines.join('\\n');
      if (lines.includes('loop-plus-protocol-miss') || lines.includes('loop-plus-protocol-recovery')
        || rejectionText.includes(secret) || rejectionText.includes(taskId) || rejectionText.includes(sessionId)
        || rejectionText.includes(prompt) || rejectionText.includes(filePath) || rejectionText.includes(rawError)
        || rejectionText.includes('reasonCounts') || rejectionText.includes('child_protocol_secret')
        || rejectionText.includes('attempt_protocol_secret') || rejectionText.includes('msg_') || rejectionText.includes('/tmp/')) {
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

test("terminal and rejection summaries keep the correlation contract and drop response text", () => {
  const secret = "PROMPT_SECRET_BODY";
  const hiddenPath = "/tmp/secret.ts";
  assert.deepEqual(summarizeLoopPlusProtocolRejection({
    reasonCode: "format.EmptyResponse",
    protocolFailureCount: 2,
    recoveryStage: "continuation_requested",
    dispatchWindow: "open",
    phase: "protocol_recovery",
    batchKey: "abc123def456",
    requestPhase: "review",
    responseShape: "empty",
    charCount: 0,
    elapsedMs: 15,
    attempt: 2,
    taskId: "msg_secret",
    prompt: secret,
    responseText: secret,
    path: hiddenPath,
    error: "RAW_ERROR",
  }), {
    rejectionKind: "format",
    reasonCode: "format.EmptyResponse",
    protocolFailureCount: 2,
    recoveryStage: "continuation_requested",
    dispatchWindow: "open",
    phase: "protocol_recovery",
    batchKey: "abc123def456",
    requestPhase: "review",
    responseShape: "empty",
    charCount: 0,
    elapsedMs: 15,
    attempt: 2,
  });
  const stripped = summarizeLoopPlusProtocolRejection({
    reasonCode: "format.EmptyResponse",
    batchKey: hiddenPath,
    responseShape: secret,
    charCount: -1,
    requestPhase: "argv",
    elapsedMs: 1.5,
    attempt: 0,
    phase: "main_terminal",
    prompt: secret,
  });
  assert.equal(stripped.batchKey, undefined);
  assert.equal(stripped.responseShape, undefined);
  assert.equal(stripped.charCount, undefined);
  assert.equal(stripped.requestPhase, undefined);
  assert.equal(stripped.elapsedMs, undefined);
  assert.equal(stripped.attempt, undefined);
  assert.equal(stripped.phase, undefined);
  assert.equal(JSON.stringify(stripped).includes(secret), false);
  assert.equal(JSON.stringify(stripped).includes(hiddenPath), false);
  const invocationKey = "fedcba654321";
  assert.deepEqual(summarizeLoopPlusMainTerminal({
    requestPhase: "continue",
    batchKey: "abc123def456",
    batchEvidence: "frozen_id_sequence",
    invocationKey,
    attempt: 4,
    responseShape: "absent",
    charCount: 0,
    elapsedMs: 8,
    prompt: secret,
    path: hiddenPath,
    taskId: "msg_secret",
  }), {
    phase: "main_terminal",
    requestPhase: "continue",
    batchKey: "abc123def456",
    batchEvidence: "frozen_id_sequence",
    invocationKey,
    attempt: 4,
    responseShape: "absent",
    charCount: 0,
    elapsedMs: 8,
  });
  const terminalBase = {
    requestPhase: "continue" as const,
    batchKey: "abc123def456",
    batchEvidence: "frozen_id_sequence" as const,
    invocationKey,
    attempt: 1,
    responseShape: "execution_failed" as const,
    charCount: 0,
    elapsedMs: 3,
  };
  assert.equal(summarizeLoopPlusMainTerminal({
    ...terminalBase,
    reasonCode: "DEPARTMENT_NATIVE_UNKNOWN",
    error: secret,
  })?.reasonCode, "DEPARTMENT_NATIVE_UNKNOWN");
  const syntheticCode = "PROMPT_SECRET_BODY";
  const syntheticReason = summarizeLoopPlusMainTerminal({
    ...terminalBase,
    reasonCode: syntheticCode,
  });
  assert.equal(syntheticReason?.reasonCode, undefined);
  assert.equal(JSON.stringify(syntheticReason).includes(syntheticCode), false);
  const rawReason = summarizeLoopPlusMainTerminal({
    ...terminalBase,
    reasonCode: `raw ${secret}`,
  });
  assert.equal(rawReason?.reasonCode, undefined);
  assert.equal(JSON.stringify(rawReason).includes(secret), false);
  assert.equal(summarizeLoopPlusMainTerminal({
    ...terminalBase,
    invocationKey: hiddenPath,
  }), null);
  assert.equal(summarizeLoopPlusMainTerminal({
    prompt: secret,
    responseShape: "empty",
    path: hiddenPath,
  }), null);
});

test("empty terminal diagnostics stay on disk without the response body when debug logging is off", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "loop-plus-main-terminal-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const script = `
    const fs = require('node:fs'), path = require('node:path');
    const logger = require(${JSON.stringify(require.resolve("../../logger"))});
    const diagnostics = require(${JSON.stringify(require.resolve("../../extensionHost/loopPlusDiagnostics"))});
    (async () => {
      await logger.initLogger();
      logger.setDebugLogging(false);
      const secret = 'SYNTHETIC_TERMINAL_SECRET';
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-main-terminal', {
        phase: 'main_terminal', requestPhase: 'review', batchKey: 'abc123def456',
        batchEvidence: 'frozen_id_sequence', invocationKey: 'fedcba654321', attempt: 2,
        responseShape: 'empty', charCount: 0, elapsedMs: 11,
        prompt: secret, responseText: secret, path: '/tmp/terminal-secret.ts', taskId: 'msg_terminal_secret',
        argv: ['node', secret], reasonCode: 'PROMPT_SECRET_BODY',
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-main-terminal', {
        phase: 'main_terminal', requestPhase: 'continue', batchKey: 'abc123def456',
        batchEvidence: 'frozen_id_sequence', invocationKey: '111111111111', attempt: 3,
        responseShape: 'text', charCount: 4, elapsedMs: 12, prompt: secret,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-main-terminal', {
        phase: 'main_terminal', requestPhase: 'continue', batchKey: 'abc123def456',
        batchEvidence: 'frozen_id_sequence', invocationKey: '222222222222', attempt: 4,
        responseShape: 'execution_failed', charCount: 0, elapsedMs: 9,
        reasonCode: 'DEPARTMENT_NATIVE_UNKNOWN', error: secret,
      });
      diagnostics.logLoopPlusRuntimeEvent('loop-plus-protocol-rejection', {
        reasonCode: 'format.EmptyResponse', protocolFailureCount: 2, recoveryStage: 'continuation_requested',
        dispatchWindow: 'open', phase: 'protocol_recovery', batchKey: 'abc123def456',
        batchEvidence: 'frozen_id_sequence', invocationKey: 'fedcba654321', requestPhase: 'review',
        responseShape: 'empty', charCount: 0, elapsedMs: 11, attempt: 2,
        prompt: secret, responseText: secret, path: '/tmp/terminal-secret.ts', taskId: 'msg_terminal_secret',
      });
      await logger.logError('flush');
      const logsDir = path.join(process.env.HOME, '.sinitek_cli', 'logs');
      const lines = fs.readdirSync(logsDir).map((file) => fs.readFileSync(path.join(logsDir, file), 'utf8')).join('\\n');
      if (!lines.includes('loop-plus-main-terminal') || !lines.includes('"responseShape":"empty"')
        || !lines.includes('"batchKey":"abc123def456"') || !lines.includes('"attempt":2')
        || !lines.includes('"invocationKey":"fedcba654321"') || !lines.includes('"batchEvidence":"frozen_id_sequence"')) {
        throw new Error('empty terminal summary was not persisted\\n' + lines);
      }
      if (lines.includes('"responseShape":"text"')) {
        throw new Error('non-empty terminal was persisted while debug logging is off\\n' + lines);
      }
      if (!lines.includes('"reasonCode":"DEPARTMENT_NATIVE_UNKNOWN"') || lines.includes('PROMPT_SECRET_BODY')) {
        throw new Error('terminal reason code filter did not keep the fixed code\\n' + lines);
      }
      if (lines.includes(secret) || lines.includes('msg_terminal_secret') || lines.includes('/tmp/terminal-secret')
        || lines.includes('argv')) {
        throw new Error('terminal log leaked payload\\n' + lines);
      }
      const rejection = lines.split('\\n').find((line) => line.includes('loop-plus-protocol-rejection'));
      if (!rejection || !rejection.includes('"attempt":2') || !rejection.includes('"batchKey":"abc123def456"')
        || !rejection.includes('"invocationKey":"fedcba654321"') || !rejection.includes('"responseShape":"empty"')
        || !rejection.includes('"batchEvidence":"frozen_id_sequence"')) {
        throw new Error('rejection summary lost the correlation\\n' + lines);
      }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const diskEnv: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete diskEnv.NODE_TEST_CONTEXT;
  const diskResult = spawnSync(process.execPath, ["-e", script], { env: diskEnv, encoding: "utf8", timeout: 15000 });
  assert.equal(diskResult.status, 0, diskResult.stdout + diskResult.stderr);
});
