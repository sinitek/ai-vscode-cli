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

test("extension delegates Loop and parallel prompt runtime wiring to extensionHost hosts", () => {
  const extensionSource = readSource("src", "extension.ts");

  assert.match(extensionSource, /from "\.\/extensionHost\/loopOrchestration"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/promptParallelRuntime"/);
  assert.match(extensionSource, /loopOrchestrationHost = createLoopOrchestrationHost\(\{/);
  assert.match(extensionSource, /const \{ runPromptParallel \} = createPromptParallelRuntimeHost\(\{/);
  assert.match(extensionSource, /function runClassicLoopMainDecision\([\s\S]*requireLoopOrchestrationHost\(\)\.runClassicLoopMainDecision/);
  assert.match(extensionSource, /function runLoopSubtasksBatchWithRetry\([\s\S]*requireLoopOrchestrationHost\(\)\.runLoopSubtasksBatchWithRetry/);
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
