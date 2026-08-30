import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildLoopSubtaskExecutionPlan,
  normalizeLoopWriteFiles,
} from "../loopParallel";

test("keeps independent write files in one parallel group", () => {
  const plan = buildLoopSubtaskExecutionPlan([
    { id: "a", title: "A", writeFiles: ["src/a.ts"] },
    { id: "b", title: "B", writeFiles: ["src/b.ts"] },
    { id: "c", title: "C", conflictGroup: "docs", writeFiles: ["docs/README.md"] },
  ]);

  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.groups[0]?.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(plan.conflicts, []);
});

test("serializes subtasks that declare the same write file", () => {
  const plan = buildLoopSubtaskExecutionPlan([
    { id: "a", title: "A", writeFiles: ["src/extension.ts"] },
    { id: "b", title: "B", writeFiles: ["./src/extension.ts"] },
    { id: "c", title: "C", writeFiles: ["src/webview/viewContent.ts"] },
  ]);

  assert.deepEqual(plan.groups.map((group) => group.map((item) => item.id)), [["a", "c"], ["b"]]);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "writeFiles");
});

test("serializes subtasks that declare parent and child write paths", () => {
  const plan = buildLoopSubtaskExecutionPlan([
    { id: "parent", writeFiles: ["src/graph"] },
    { id: "child", writeFiles: ["src/graph/graphScheduler.ts"] },
    { id: "independent", writeFiles: ["src/cli/types.ts"] },
  ]);

  assert.deepEqual(plan.groups.map((group) => group.map((item) => item.id)), [
    ["parent", "independent"],
    ["child"],
  ]);
  assert.equal(plan.conflicts[0]?.reason, "writeFiles");
});

test("serializes subtasks that share a conflict group", () => {
  const plan = buildLoopSubtaskExecutionPlan([
    { id: "a", title: "A", conflictGroup: "model-store" },
    { id: "b", title: "B", conflictGroup: "MODEL-store" },
    { id: "c", title: "C", conflictGroup: "i18n" },
  ]);

  assert.deepEqual(plan.groups.map((group) => group.map((item) => item.id)), [["a", "c"], ["b"]]);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "conflictGroup");
});

test("normalizes write file metadata for stable conflict checks", () => {
  assert.deepEqual(
    normalizeLoopWriteFiles([" ./SRC/Extension.ts ", "src//extension.ts", "", 123]),
    ["src/extension.ts"],
  );
});
