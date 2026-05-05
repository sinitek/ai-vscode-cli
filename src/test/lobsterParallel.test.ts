import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildLobsterSubtaskExecutionPlan,
  normalizeLobsterWriteFiles,
} from "../lobsterParallel";

test("keeps independent write files in one parallel group", () => {
  const plan = buildLobsterSubtaskExecutionPlan([
    { id: "a", title: "A", writeFiles: ["src/a.ts"] },
    { id: "b", title: "B", writeFiles: ["src/b.ts"] },
    { id: "c", title: "C", conflictGroup: "docs", writeFiles: ["docs/README.md"] },
  ]);

  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.groups[0]?.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(plan.conflicts, []);
});

test("serializes subtasks that declare the same write file", () => {
  const plan = buildLobsterSubtaskExecutionPlan([
    { id: "a", title: "A", writeFiles: ["src/extension.ts"] },
    { id: "b", title: "B", writeFiles: ["./src/extension.ts"] },
    { id: "c", title: "C", writeFiles: ["src/webview/viewContent.ts"] },
  ]);

  assert.deepEqual(plan.groups.map((group) => group.map((item) => item.id)), [["a", "c"], ["b"]]);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "writeFiles");
});

test("serializes subtasks that share a conflict group", () => {
  const plan = buildLobsterSubtaskExecutionPlan([
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
    normalizeLobsterWriteFiles([" ./SRC/Extension.ts ", "src//extension.ts", "", 123]),
    ["src/extension.ts"],
  );
});
