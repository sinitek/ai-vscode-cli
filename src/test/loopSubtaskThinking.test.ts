import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");

import {
  getEffectiveLoopSubtaskMaxThinkingMode,
  normalizeLoopSubtaskMaxThinkingMode,
  resolveLoopSubtaskThinkingMode,
} from "../loopSubtaskThinking";

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
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const start = extensionSource.indexOf("async function runLoopRound(");
  const end = extensionSource.indexOf("function buildLoopActiveSubtaskPatch(", start);
  const runLoopRoundSource = extensionSource.slice(start, end);

  assert.match(runLoopRoundSource, /const thinkingModeOverride = resolvePromptRunThinkingModeForRole\(input,\s*target\.cli,\s*role,\s*roleModel,\s*\{/u);
  assert.match(runLoopRoundSource, /applySubtaskCap:\s*true/u);
  assert.match(runLoopRoundSource, /thinkingModeOverride,/u);
});
