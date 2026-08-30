import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";

import {
  LEGACY_LOOP_GROUP_CHAT_COMMAND_ID,
  LEGACY_LOOP_GROUP_CHAT_ACTION_TYPE,
  LEGACY_LOOP_INTERACTIVE_MODE,
  LOOP_GROUP_CHAT_COMMAND_ID,
  LOOP_GROUP_CHAT_ACTION_TYPE,
  getLegacyLoopPropertyKey,
  getLegacyLoopStoragePaths,
  migrateLegacyLoopJson,
} from "../../loopLegacyMigration";
import { normalizeTaskRunRecord, normalizeVisibleInteractiveMode } from "../../promptRunState";
import { sanitizeMessages } from "../../sessionStore";
import type { ChatMessage } from "../../webview/types";

test("migrates legacy Loop keys, protocol values, and storage paths", () => {
  const dataDir = path.join("/tmp", "sinitek-loop-migration");
  const legacyPaths = getLegacyLoopStoragePaths(dataDir);
  const legacyTaskIdKey = getLegacyLoopPropertyKey("loopTaskId");
  const legacyRoundKey = getLegacyLoopPropertyKey("loopRound");
  const input = {
    [legacyTaskIdKey]: "task-legacy",
    loopTaskId: "task-current",
    nested: {
      [legacyRoundKey]: 3,
      communicationFile: path.join(legacyPaths.communicationDir, "task-legacy", "main-task.md"),
    },
    action: {
      type: LEGACY_LOOP_GROUP_CHAT_ACTION_TYPE,
    },
  };

  const migrated = migrateLegacyLoopJson(input, dataDir);

  assert.equal(migrated.changed, true);
  assert.equal(migrated.value.loopTaskId, "task-current");
  assert.equal((migrated.value.nested as { loopRound?: number }).loopRound, 3);
  assert.equal(
    (migrated.value.nested as { communicationFile: string }).communicationFile,
    path.join(dataDir, "loop-communications", "task-legacy", "main-task.md"),
  );
  assert.equal(migrated.value.action.type, LOOP_GROUP_CHAT_ACTION_TYPE);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.value, legacyTaskIdKey), false);
});

test("normalizes the legacy interactive mode and task-run fields to Loop", () => {
  assert.equal(normalizeVisibleInteractiveMode(LEGACY_LOOP_INTERACTIVE_MODE), "loop");

  const record = normalizeTaskRunRecord({
    id: "run-1",
    cli: "codex",
    sessionId: "session-1",
    prompt: "Continue the existing task.",
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    status: "end",
    taskRole: "subtask",
    [getLegacyLoopPropertyKey("loopTaskId")]: "task-1",
    [getLegacyLoopPropertyKey("loopRound")]: 2,
    [getLegacyLoopPropertyKey("loopSubtaskId")]: "subtask-1",
  }, {
    isCliName: (value): value is "codex" => value === "codex",
    isLoopTaskRole: (value): value is "main" | "subtask" => value === "main" || value === "subtask",
  });

  assert.equal(record?.loopTaskId, "task-1");
  assert.equal(record?.loopRound, 2);
  assert.equal(record?.loopSubtaskId, "subtask-1");
});

test("sanitizes persisted legacy Loop message fields and group-chat actions", () => {
  const legacyTaskIdKey = getLegacyLoopPropertyKey("loopTaskId");
  const legacyFinalSummaryKey = getLegacyLoopPropertyKey("loopFinalSummary");
  const rawMessage = {
    id: "message-1",
    role: "assistant",
    content: "Completed.",
    [legacyTaskIdKey]: "task-1",
    [legacyFinalSummaryKey]: true,
    actions: [{
      type: LEGACY_LOOP_GROUP_CHAT_ACTION_TYPE,
      taskId: "task-1",
    }],
  } as unknown as ChatMessage;

  const sanitized = sanitizeMessages([rawMessage]);
  const message = sanitized.messages[0];

  assert.equal(sanitized.changed, true);
  assert.equal(message.loopTaskId, "task-1");
  assert.equal(message.loopFinalSummary, true);
  assert.equal(message.actions?.[0]?.type, LOOP_GROUP_CHAT_ACTION_TYPE);
  assert.equal(Object.prototype.hasOwnProperty.call(message, legacyTaskIdKey), false);
  assert.equal(Object.prototype.hasOwnProperty.call(message, legacyFinalSummaryKey), false);
});

test("contributes the Loop group-chat command and keeps the legacy command hidden", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as {
    activationEvents?: string[];
    contributes?: { commands?: Array<{ command?: string }> };
  };
  const contributedCommands = packageJson.contributes?.commands?.map((item) => item.command) ?? [];
  const commandRegistrySource = fs.readFileSync(
    path.join(process.cwd(), "src", "commandRegistry.ts"),
    "utf8",
  );

  assert.equal(contributedCommands.includes(LOOP_GROUP_CHAT_COMMAND_ID), true);
  assert.equal(contributedCommands.includes(LEGACY_LOOP_GROUP_CHAT_COMMAND_ID), false);
  assert.equal(packageJson.activationEvents?.includes(`onCommand:${LOOP_GROUP_CHAT_COMMAND_ID}`), true);
  assert.match(
    commandRegistrySource,
    /registerCommand\(LOOP_GROUP_CHAT_COMMAND_ID,[\s\S]*registerCommand\(LEGACY_LOOP_GROUP_CHAT_COMMAND_ID/,
  );
});
