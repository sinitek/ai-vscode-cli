import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");

import {
  getEffectiveLoopSubtaskMaxThinkingMode,
  normalizeLoopSubtaskMaxThinkingMode,
  resolveLoopSubtaskThinkingMode,
} from "../../loopSubtaskThinking";

test("defaults the Loop subtask thinking cap to xhigh", () => {
  assert.equal(getEffectiveLoopSubtaskMaxThinkingMode(undefined), "xhigh");
  assert.equal(normalizeLoopSubtaskMaxThinkingMode("invalid"), null);
});

test("normalizes max and ultra Loop subtask caps to xhigh", () => {
  assert.equal(normalizeLoopSubtaskMaxThinkingMode("max"), "xhigh");
  assert.equal(normalizeLoopSubtaskMaxThinkingMode("ultra"), "xhigh");
});

test("uses the lower of the selected thinking mode and Loop subtask cap", () => {
  assert.equal(resolveLoopSubtaskThinkingMode("ultra", "xhigh"), "xhigh");
  assert.equal(resolveLoopSubtaskThinkingMode("max", "xhigh"), "xhigh");
  assert.equal(resolveLoopSubtaskThinkingMode("high", "xhigh"), "high");
  assert.equal(resolveLoopSubtaskThinkingMode("medium", "high"), "medium");
  assert.equal(resolveLoopSubtaskThinkingMode("off", "low"), "off");
});

test("applies the cap only while dispatching Loop subtasks", () => {
  const loopOrchestrationSource = fs.readFileSync(
    path.join(process.cwd(), "src", "extensionHost", "loopOrchestration.ts"),
    "utf8",
  );
  const start = loopOrchestrationSource.indexOf("async function runLoopRound(");
  const end = loopOrchestrationSource.indexOf("function buildLoopActiveSubtaskPatch(", start);
  const runLoopRoundSource = loopOrchestrationSource.slice(start, end);

  assert.match(runLoopRoundSource, /const thinkingModeOverride = resolvePromptRunThinkingModeForRole\(input,\s*target\.cli,\s*role,\s*roleModel,\s*\{/u);
  assert.match(runLoopRoundSource, /applySubtaskCap:\s*true/u);
  assert.match(runLoopRoundSource, /thinkingModeOverride,/u);
});

test("applies the same thinking cap to Loop+ subtasks but not Graph nodes", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const adapterSource = fs.readFileSync(
    path.join(process.cwd(), "src", "extensionHost", "loopPlusRuntimeAdapter.ts"),
    "utf8",
  );
  const graphSource = fs.readFileSync(path.join(process.cwd(), "src", "extensionHost", "graphRuntime.ts"), "utf8");

  assert.match(
    extensionSource,
    /resolveThinkingMode:\s*\(input,\s*cli,\s*role,\s*model\)\s*=>\s*resolvePromptRunThinkingModeForRole\([\s\S]*?applySubtaskCap:\s*role === "subtask"/u,
  );
  assert.match(adapterSource, /promptInput\.thinkingModeOverride = deps\.resolveThinkingMode\(/u);
  assert.match(adapterSource, /promptForRole\(\s*request\.taskId,\s*"subtask",/u);
  assert.match(
    graphSource,
    /resolvePromptRunThinkingModeForRole\(rootInput, target\.cli, modelRole, selectedModel\);/u,
  );
  assert.doesNotMatch(graphSource, /applySubtaskCap:\s*true/u);
});
