import test = require("node:test");
import assert = require("node:assert/strict");

import {
  normalizeConflictGroup,
  normalizeWriteFiles,
  writeFilePathsOverlap,
} from "../shared/writeScope";

test("normalizes write files case-insensitively and removes duplicate paths", () => {
  assert.deepEqual(
    normalizeWriteFiles([
      " ./SRC/Graph ",
      "src//graph",
      "./src/graph/GraphScheduler.ts",
      "src/graph/graphscheduler.ts/",
      "",
      123,
    ]),
    ["src/graph", "src/graph/graphscheduler.ts"],
  );
});

test("treats parent and child write paths as overlapping but keeps sibling names separate", () => {
  assert.equal(writeFilePathsOverlap("src/graph", "src/graph/graphScheduler.ts"), true);
  assert.equal(writeFilePathsOverlap("src/graph/graphScheduler.ts", "src/graph"), true);
  assert.equal(writeFilePathsOverlap("src/graph", "src/graphics"), false);
  assert.equal(writeFilePathsOverlap("src/graph.ts", "src/graph.ts.bak"), false);
});

test("normalizes conflict groups by trimming, collapsing whitespace, and lowercasing", () => {
  assert.equal(normalizeConflictGroup("  Docs\t Build  "), "docs build");
  assert.equal(normalizeConflictGroup("MODEL-store"), "model-store");
  assert.equal(normalizeConflictGroup("   "), null);
  assert.equal(normalizeConflictGroup(null), null);
});
