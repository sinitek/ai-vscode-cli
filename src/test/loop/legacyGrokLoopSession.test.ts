import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { findLegacyGrokLoopCwd, isLegacyGrokLoopCwd } from "../../legacyGrokLoopSession";
import { createLoopSubtaskExecutionRoot, isLegacyGrokLoopExecutionCwd, resolveGrokLoopExecutionCwd } from "../../loopSubtaskExecutionRoot";

test("legacy Loop temp roots are recognized only under the historical parent and exact mkdtemp name", () => {
  assert.equal(isLegacyGrokLoopCwd("C:\\workspace\\.sinitek-loop-tmp\\sinitek-loop-subtask-Ab12Cd", "C:\\workspace\\.sinitek-loop-tmp", "win32"), true);
  assert.equal(isLegacyGrokLoopCwd("C:\\outside\\sinitek-loop-subtask-Ab12Cd", "C:\\workspace\\.sinitek-loop-tmp", "win32"), false);
  assert.equal(isLegacyGrokLoopCwd("C:\\workspace\\.sinitek-loop-tmp\\sinitek-loop-subtask-Ab12", "C:\\workspace\\.sinitek-loop-tmp", "win32"), false);
  assert.equal(isLegacyGrokLoopCwd("/tmp/sinitek-loop-subtask-Ab12Cd", "/tmp", "linux"), true);
});

test("legacy Grok session lookup restores one trusted cwd and permits recreating a deleted root", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-grok-loop-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const temp = path.join(root, "temp");
  const home = path.join(root, ".grok");
  await fs.mkdir(workspace);
  await fs.mkdir(temp);
  const cwd = path.join(temp, "sinitek-loop-subtask-Ab12Cd");
  const sessionId = "01a2078f-9b82-7e81-88eb-bb06188e2924";
  const session = path.join(home, "sessions", encodeURIComponent(cwd), sessionId);
  await fs.mkdir(session, { recursive: true });
  await fs.writeFile(path.join(session, "summary.json"), JSON.stringify({ info: { id: sessionId, cwd } }));
  await fs.writeFile(path.join(session, "updates.jsonl"), "");

  assert.equal(await findLegacyGrokLoopCwd(workspace, sessionId, { grokHome: home, tempDir: temp }), cwd);
  assert.equal(await findLegacyGrokLoopCwd(workspace, "invalid/../id", { grokHome: home, tempDir: temp }), null);
  assert.equal(isLegacyGrokLoopExecutionCwd(workspace, cwd), false);
  const validCwd = path.join(os.tmpdir(), "sinitek-loop-subtask-Gh56Jk");
  assert.equal(isLegacyGrokLoopExecutionCwd(workspace, validCwd), true);
  assert.equal(resolveGrokLoopExecutionCwd(workspace, "123e4567-e89b-42d3-a456-426614174000", root, validCwd), validCwd);
  assert.throws(() => resolveGrokLoopExecutionCwd(workspace, "123e4567-e89b-42d3-a456-426614174000", root, cwd));
});

test("legacy Grok session lookup rejects occupied roots and ambiguous session metadata", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-grok-loop-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const temp = path.join(root, "temp");
  const home = path.join(root, ".grok");
  await fs.mkdir(workspace);
  await fs.mkdir(temp);
  const cwd = path.join(temp, "sinitek-loop-subtask-Zy98Xw");
  const sessionId = "01a2078f-9b82-7e81-88eb-bb06188e2924";
  const group = path.join(home, "sessions", encodeURIComponent(cwd));
  const session = path.join(group, sessionId);
  await fs.mkdir(session, { recursive: true });
  await fs.writeFile(path.join(session, "summary.json"), JSON.stringify({ info: { id: sessionId, cwd } }));
  await fs.writeFile(path.join(session, "updates.jsonl"), "");
  await fs.mkdir(cwd);
  await fs.writeFile(path.join(cwd, "unknown.txt"), "retain");
  assert.equal(await findLegacyGrokLoopCwd(workspace, sessionId, { grokHome: home, tempDir: temp }), null);
  await fs.rm(cwd, { recursive: true });

  const duplicateGroup = path.join(home, "sessions", "long-path-hash");
  await fs.mkdir(path.join(duplicateGroup, sessionId), { recursive: true });
  await fs.writeFile(path.join(duplicateGroup, ".cwd"), cwd);
  await fs.writeFile(path.join(duplicateGroup, sessionId, "summary.json"), JSON.stringify({ info: { id: sessionId, cwd } }));
  await fs.writeFile(path.join(duplicateGroup, sessionId, "updates.jsonl"), "");
  assert.equal(await findLegacyGrokLoopCwd(workspace, sessionId, { grokHome: home, tempDir: temp }), null);
});
