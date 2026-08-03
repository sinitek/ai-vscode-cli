import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");

import { createLoopOrchestrationHost } from "../extensionHost/loopOrchestration";
import { createPromptParallelRuntimeHost } from "../extensionHost/promptParallelRuntime";

function readSource(...relativePath: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...relativePath), "utf8");
}

test("extension delegates Loop, parallel, one-shot, and interactive prompt runtime wiring to extensionHost hosts", () => {
  const extensionSource = readSource("src", "extension.ts");

  assert.match(extensionSource, /from "\.\/extensionHost\/loopOrchestration"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/promptParallelRuntime"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/promptOneShotRuntime"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/promptInteractiveRuntime"/);
  assert.match(extensionSource, /loopOrchestrationHost = createLoopOrchestrationHost\(\{/);
  assert.match(extensionSource, /const \{ runPromptParallel \} = createPromptParallelRuntimeHost\(\{/);
  assert.match(extensionSource, /const \{ runPromptOneShot \} = createPromptOneShotRuntimeHost\(\{/);
  assert.match(extensionSource, /const \{ runPromptInteractive \} = createPromptInteractiveRuntimeHost\(\{/);
  assert.match(extensionSource, /function runClassicLoopMainDecision\([\s\S]*requireLoopOrchestrationHost\(\)\.runClassicLoopMainDecision/);
  assert.match(extensionSource, /function runLoopSubtasksBatchWithRetry\([\s\S]*requireLoopOrchestrationHost\(\)\.runLoopSubtasksBatchWithRetry/);
  assert.match(extensionSource, /await runPromptOneShot\(promptInput, target, executionOptions\);/);
  assert.match(extensionSource, /await runPromptInteractive\(promptInput, target, executionOptions\);/);
  assert.doesNotMatch(extensionSource, /async function runPromptInteractive\(/);
});

test("Loop orchestration source contract lives in extensionHost/loopOrchestration", () => {
  const loopOrchestrationSource = readSource("src", "extensionHost", "loopOrchestration.ts");

  assert.match(loopOrchestrationSource, /export function createLoopOrchestrationHost\(deps: LoopOrchestrationHostDeps\)/);
  assert.match(loopOrchestrationSource, /async function runClassicLoopMainDecision\(/);
  assert.match(loopOrchestrationSource, /async function runLoopDebateRound\(/);
  assert.match(loopOrchestrationSource, /async function runLoopSubtasksBatchWithRetry\(/);
  assert.match(loopOrchestrationSource, /async function runLoopSubtaskWithRetry\(/);
  assert.match(loopOrchestrationSource, /function buildLoopSubtaskModelPrompt\(/);
  assert.match(loopOrchestrationSource, /return \{[\s\S]*runClassicLoopMainDecision[\s\S]*runLoopDebateRound[\s\S]*runLoopSubtasksBatchWithRetry/);
});

test("Loop orchestration host exposes small helpers through the injected host boundary", () => {
  const errors: unknown[] = [];
  const host = createLoopOrchestrationHost({
    logError: (_event: string, payload: unknown) => {
      errors.push(payload);
    },
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-orchestration-host-"));
  const filePath = path.join(tempDir, "nested", "artifact.md");
  try {
    assert.deepEqual(host.appendLoopSupplementalRequirement([" keep ", "", "existing"], " next "), [
      "keep",
      "existing",
      " next ",
    ]);
    assert.equal(host.formatLoopAutoWakeAtForRecord(Date.UTC(2026, 0, 2, 3, 4, 5)), "2026-01-02T03:04:05.000Z");
    assert.equal(host.formatLoopAutoWakeAtForRecord(undefined), "未记录");
    assert.equal(host.writeTextFileEnsuringDir(filePath, " first "), true);
    assert.equal(host.readTextFileIfNonEmpty(filePath), "first");
    assert.equal(host.appendTextFileEnsuringDir(filePath, "\nsecond"), true);
    assert.equal(host.readTextFileIfNonEmpty(filePath), "first \nsecond");
    assert.deepEqual(errors, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parallel prompt runtime host keeps unsupported and empty prompts inside its boundary", async () => {
  const { runPromptParallel } = createPromptParallelRuntimeHost({});

  await runPromptParallel(
    { displayPrompt: "", modelPrompt: "", contextTags: [] },
    { tabId: "tab-1", cli: "opencode", sessionId: null },
  );
  await assert.rejects(
    runPromptParallel(
      { displayPrompt: "run", modelPrompt: "run", contextTags: [] },
      { tabId: "tab-1", cli: "codex", sessionId: null },
    ),
    /parallel-run-unsupported:codex/,
  );
});

test("one-shot prompt runtime source contract lives in extensionHost/promptOneShotRuntime", () => {
  const oneShotRuntimeSource = readSource("src", "extensionHost", "promptOneShotRuntime.ts");

  assert.match(oneShotRuntimeSource, /export function createPromptOneShotRuntimeHost\(deps: PromptOneShotRuntimeHostDeps\)/);
  assert.match(oneShotRuntimeSource, /async function runPromptOneShot\(/);
  assert.match(oneShotRuntimeSource, /function appendOpenCodeJsonlEvents\(/);
  assert.match(oneShotRuntimeSource, /function flushOpenCodeJsonlBuffer\(/);
  assert.match(oneShotRuntimeSource, /function appendOpenCodeVisibleEvent\(/);
  assert.match(oneShotRuntimeSource, /buildOpenCodeOneShotStartupTimeoutMessage/);
  assert.match(oneShotRuntimeSource, /clearActiveRun:\s*clearPrimaryActiveRun/);
  assert.match(oneShotRuntimeSource, /const clearActiveRun = \(\): void => \{[\s\S]*clearPrimaryActiveRun\(\);/);
  assert.doesNotMatch(oneShotRuntimeSource, /clearActiveRun:\s*clearActiveRun/);
});

test("interactive prompt runtime source contract lives in extensionHost/promptInteractiveRuntime", () => {
  const interactiveRuntimeSource = readSource("src", "extensionHost", "promptInteractiveRuntime.ts");

  assert.match(interactiveRuntimeSource, /export function createPromptInteractiveRuntimeHost\(deps: PromptInteractiveRuntimeHostDeps\)/);
  assert.match(interactiveRuntimeSource, /async function runPromptInteractive\(/);
  assert.match(interactiveRuntimeSource, /rawStdout = appendBoundedUtf8Text\(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES\)\.text/);
  assert.match(interactiveRuntimeSource, /rawStderr = appendBoundedUtf8Text\(rawStderr, normalized, AI_TASK_RAW_OUTPUT_MAX_BYTES\)\.text/);
  assert.match(interactiveRuntimeSource, /const appendMessageForTab = \(message: ChatMessage\): void => \{[\s\S]*schedulePersistForInteractiveRun\(\);/);
  assert.match(interactiveRuntimeSource, /const flushPersistForInteractiveRun = \(\): void => \{[\s\S]*persistMessagesForInteractiveRun\(\);/);
  assert.match(interactiveRuntimeSource, /const stopFn = \(\): void => \{[\s\S]*sendRunStatusForTab\(tabId, "stopped"\)/);
  assert.match(interactiveRuntimeSource, /interactiveRunsByTabId\.set\(tabId, \{/);
  assert.match(interactiveRuntimeSource, /onAssistantDelta: \(chunk, meta\) => \{[\s\S]*codexFinalAnswer: meta\?\.codexFinalAnswer === true/);
  assert.match(interactiveRuntimeSource, /onTrace: \(content, kind, meta\) => \{[\s\S]*appendTraceMessageForTab\(content, kind === "thinking" \? "thinking" : "normal", meta\)/);
  assert.match(interactiveRuntimeSource, /onEvent: \(event\) => \{[\s\S]*type: "rawStreamDelta"[\s\S]*extractTaskListItemsFromForwardedCodexEvent/);
  assert.match(interactiveRuntimeSource, /onTaskListUpdate: \(items\) => \{[\s\S]*type: "taskListUpdate"/);
  assert.match(interactiveRuntimeSource, /onThreadId: \(threadId\) => \{[\s\S]*updateSessionForNewRun\(threadId/);
  assert.match(interactiveRuntimeSource, /onSessionId: \(newSessionId: string\) => \{[\s\S]*updateSessionForNewRun\(newSessionId\)/);
  assert.match(interactiveRuntimeSource, /return \{ runPromptInteractive \};/);
});
