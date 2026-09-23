import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";

import {
  loopModelRoutingFromPromptInput,
  promptModelsFromContinuePair,
  resolveLoopContinueModelPair,
  selectGraphContinueModelRouting,
} from "../../continueModelChoice";
import { normalizeLoopTaskModelRouting, normalizeLoopTaskOriginProfile } from "../../loopTaskStore";

test("continue model choice keeps recorded models or switches to the current Loop config", () => {
  const original = { main: "original-main", subtask: "original-subtask" };
  const current = { main: "current-main", subtask: "current-subtask" };

  assert.deepEqual(resolveLoopContinueModelPair({
    modelSource: "original",
    original,
    current,
  }), original);
  assert.deepEqual(promptModelsFromContinuePair(original), {
    model: "original-main",
    loopMainModel: "original-main",
    loopSubtaskModel: "original-subtask",
  });
  assert.deepEqual(resolveLoopContinueModelPair({
    modelSource: "current",
    original,
    current,
  }), current);
  assert.deepEqual(resolveLoopContinueModelPair({
    modelSource: null,
    original,
    current,
  }), current);
  assert.deepEqual(resolveLoopContinueModelPair({
    modelSource: "original",
    original: { main: null, subtask: null },
    current,
  }), current);
});

test("continue model routing ignores empty records and keeps Graph routing unless current is chosen", () => {
  assert.equal(normalizeLoopTaskModelRouting({ main: {}, subtask: { model: "  " } }), undefined);
  assert.deepEqual(normalizeLoopTaskModelRouting({
    main: { model: " gpt-main ", fallback: " main fallback " },
    subtask: { model: "gpt-subtask" },
  }), {
    main: { model: "gpt-main", fallback: "main fallback" },
    subtask: { model: "gpt-subtask" },
  });
  assert.deepEqual(loopModelRoutingFromPromptInput({
    model: "single-model",
    loopSubtaskModel: "subtask-model",
  }), {
    main: { model: "single-model" },
    subtask: { model: "subtask-model" },
  });

  const existing = {
    planner: { role: "main" as const, model: "original-main" },
    executor: { role: "subtask" as const, model: "original-subtask" },
  };
  const current = {
    planner: { role: "main" as const, model: "current-main" },
    executor: { role: "subtask" as const, model: "current-subtask" },
  };
  assert.equal(selectGraphContinueModelRouting(existing, current, "original"), existing);
  assert.equal(selectGraphContinueModelRouting(existing, current, null), existing);
  assert.equal(selectGraphContinueModelRouting(existing, {
    planner: { role: "main" },
    executor: { role: "subtask" },
  }, "current"), existing);
  assert.equal(selectGraphContinueModelRouting(existing, current, "current"), current);
});

test("new Loop tasks snapshot the prompt main and subtask models", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/extension.ts"), "utf8");
  const createTaskIndex = source.indexOf("task = createLoopTaskRecord(target.cli, input.displayPrompt");
  const snapshotIndex = source.indexOf("loopModelRoutingFromPromptInput(input)", createTaskIndex);
  const originIndex = source.indexOf("captureLoopOriginProfile(", snapshotIndex);
  assert.ok(createTaskIndex >= 0);
  assert.ok(snapshotIndex > createTaskIndex);
  assert.ok(originIndex > snapshotIndex);
  assert.ok(originIndex < source.indexOf("ensureLoopMainSubChatTranscript(task)", createTaskIndex));
});

test("Loop origin profile keeps config and thinking only when a config id exists", () => {
  assert.equal(normalizeLoopTaskOriginProfile({ configId: "  ", mainThinkingMode: "high" }), undefined);
  assert.deepEqual(normalizeLoopTaskOriginProfile({
    configId: " config-1 ",
    mainThinkingMode: "high",
    subtaskThinkingMode: "nope",
    mainOpenCodeVariant: " max ",
    subtaskOpenCodeVariant: "",
  }), {
    configId: "config-1",
    mainThinkingMode: "high",
    mainOpenCodeVariant: "max",
  });
});
