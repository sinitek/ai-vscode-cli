import test = require("node:test");
import assert = require("node:assert/strict");

import {
  normalizeConflictGroup,
  normalizeWriteFiles,
  writeFilePathsOverlap,
} from "../../shared/writeScope";

test("normalizes write files case-insensitively and removes duplicate paths", () => {
  assert.deepEqual(
    normalizeWriteFiles([
      " ./SRC/Shared ",
      "src//shared",
      "./src/shared/WriteScope.ts",
      "src/shared/writescope.ts/",
      "",
      123,
    ]),
    ["src/shared", "src/shared/writescope.ts"],
  );
});

test("treats parent and child write paths as overlapping but keeps sibling names separate", () => {
  assert.equal(writeFilePathsOverlap("src/shared", "src/shared/writeScope.ts"), true);
  assert.equal(writeFilePathsOverlap("src/shared/writeScope.ts", "src/shared"), true);
  assert.equal(writeFilePathsOverlap("src/shared", "src/sharedness"), false);
  assert.equal(writeFilePathsOverlap("src/shared.ts", "src/shared.ts.bak"), false);
});

test("normalizes conflict groups by trimming, collapsing whitespace, and lowercasing", () => {
  assert.equal(normalizeConflictGroup("  Docs\t Build  "), "docs build");
  assert.equal(normalizeConflictGroup("MODEL-store"), "model-store");
  assert.equal(normalizeConflictGroup("   "), null);
  assert.equal(normalizeConflictGroup(null), null);
});
