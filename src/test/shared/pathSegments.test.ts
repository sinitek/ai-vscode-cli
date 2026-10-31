import test = require("node:test");
import assert = require("node:assert/strict");
import * as os from "os";
import * as path from "path";

import { buildLoopTaskStoreFile } from "../../loopTaskStore";
import { sanitizePathSegment } from "../../shared/pathSegments";

test("sanitizes invalid path characters consistently and preserves case", () => {
  const value = " Workspace/A\\B:Run-42.Test ";

  assert.equal(sanitizePathSegment(value, "fallback"), "Workspace_A_B_Run-42.Test");
});

test("uses the supplied fallback for empty and nullish path segments", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(sanitizePathSegment(value, "fallback"), "fallback");
  }
});

test("keeps Loop store paths compatible after segment reuse", () => {
  const loopFile = buildLoopTaskStoreFile("codex", "Workspace/A", "session\\one", "task:one");
  assert.equal(
    loopFile,
    path.join(
      os.homedir(),
      ".sinitek_cli",
      "loop-tasks",
      "Workspace_A",
      "codex",
      "session_one",
      "loop-tasks.json",
    ),
  );

  const pendingLoopFile = buildLoopTaskStoreFile("codex", "", null, "task:one");
  assert.equal(
    pendingLoopFile,
    path.join(
      os.homedir(),
      ".sinitek_cli",
      "loop-tasks",
      "no-workspace",
      "codex",
      "__pending__",
      "task_one",
      "loop-tasks.json",
    ),
  );
});
