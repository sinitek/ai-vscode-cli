import assert = require("node:assert/strict");
import fs = require("fs");
import path = require("path");
import test = require("node:test");
import { shouldUseClassicLoopProjectInstructions } from "../../extensionHost/promptExecutionShared";

test("classic and legacy Loop subtasks load project instructions on initial execution and continuation", () => {
  for (const schedulingMode of ["classic", undefined] as const) {
    const task = { schedulingMode };
    const initial = { taskRole: "subtask" as const, loopTaskId: "classic-task" };
    const continuation = { ...initial, displayPrompt: "继续", loopRound: 2 };
    assert.equal(shouldUseClassicLoopProjectInstructions(initial, task), true);
    assert.equal(shouldUseClassicLoopProjectInstructions(continuation, task), true);
  }
});

test("Loop+, Graph, unknown tasks and non-subtasks retain their execution policy", () => {
  const input = { taskRole: "subtask" as const, loopTaskId: "task" };
  assert.equal(shouldUseClassicLoopProjectInstructions(input, { schedulingMode: "event_driven" }), false);
  assert.equal(shouldUseClassicLoopProjectInstructions({ ...input, graphRunId: "graph" }, { schedulingMode: "classic" }), false);
  assert.equal(shouldUseClassicLoopProjectInstructions(input, null), false);
  assert.equal(shouldUseClassicLoopProjectInstructions({ taskRole: "subtask" }, { schedulingMode: "classic" }), false);
  assert.equal(shouldUseClassicLoopProjectInstructions({ ...input, taskRole: "main" }, { schedulingMode: "classic" }), false);
  assert.equal(shouldUseClassicLoopProjectInstructions({ loopTaskId: "task" }, { schedulingMode: "classic" }), false);
});

test("the shared prompt entry applies classic project instructions before all runtime paths", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/extension.ts"), "utf8");
  const entry = source.split("async function runPrompt(")[1]?.split("// One-shot prompt runtime")[0] ?? "";
  assert.match(entry, /shouldUseClassicLoopProjectInstructions\([\s\S]*readLoopTaskRecord\(input\.loopTaskId\)/u);
  assert.match(entry, /!useClassicLoopProjectInstructions && !input\.executionCwd/u);
  assert.match(entry, /cwd: useClassicLoopProjectInstructions \? resolveWorkspaceCwd\(\)/u);
  assert.match(entry, /isolateProjectInstructions: useClassicLoopProjectInstructions\s*\? false/u);
  for (const runner of ["runPromptInteractive", "runPromptParallel", "runPromptOneShot"]) {
    assert.ok(entry.includes(`${runner}(attemptInput, attemptTarget, executionOptions)`));
  }
});
