import test = require("node:test");
import assert = require("node:assert/strict");
import * as os from "os";
import * as path from "path";

import { buildGraphRunStoreFile } from "../../graph/graphStore";
import { sanitizeGraphPathSegment } from "../../graph/types";
import {
  buildLoopDebateParticipantTurnArtifactFile,
  buildLoopDebatePaths,
} from "../../loopDebate";
import { buildLoopTaskStoreFile } from "../../loopTaskStore";
import { sanitizePathSegment } from "../../shared/pathSegments";

test("sanitizes invalid path characters consistently and preserves case", () => {
  const value = " Workspace/A\\B:Run-42.Test ";

  assert.equal(sanitizePathSegment(value, "fallback"), "Workspace_A_B_Run-42.Test");
  assert.equal(sanitizeGraphPathSegment(value, "fallback"), "Workspace_A_B_Run-42.Test");
});

test("uses the supplied fallback for empty and nullish path segments", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(sanitizePathSegment(value, "fallback"), "fallback");
    assert.equal(sanitizeGraphPathSegment(value, "graph-fallback"), "graph-fallback");
  }
});

test("keeps Graph and Loop store paths compatible after segment reuse", () => {
  const graphFile = buildGraphRunStoreFile(
    "codex",
    "Workspace/A",
    "session\\one",
    "run:one",
    { baseDir: "/tmp/graph-path-segments" },
  );
  assert.equal(
    graphFile,
    path.join(
      "/tmp/graph-path-segments",
      "graph-runs",
      "Workspace_A",
      "codex",
      "session_one",
      "run_one",
      "graph-runs.json",
    ),
  );

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

test("keeps Loop debate artifact paths stable with sanitized participant ids", () => {
  const paths = buildLoopDebatePaths("/tmp/loop-communications/task-1", 2);

  assert.equal(
    buildLoopDebateParticipantTurnArtifactFile(paths, "risk/review", 1),
    "/tmp/loop-communications/task-1/debates/round-2/participants/risk_review-turn-1.md",
  );
  assert.equal(
    buildLoopDebateParticipantTurnArtifactFile(paths, "", 2),
    "/tmp/loop-communications/task-1/debates/round-2/participants/participant-turn-2.md",
  );
});
