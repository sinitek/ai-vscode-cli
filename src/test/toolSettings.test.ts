import test = require("node:test");
import assert = require("node:assert/strict");

import {
  normalizeToolSettings,
  resolveGlobalAutoCompactContextAfterRun,
  resolveGlobalMultiAgentEnabled,
  resolveLongTermMemoryEnabled,
  type ToolSettingsState,
} from "../toolSettings";

test("ignores retired final-answer policy fields", () => {
  assert.deepEqual(
    normalizeToolSettings({
      debug: true,
      finalAnswerPolicy: "successful_reply_fallback",
      codexFinalAnswerPolicy: "completed_turn_fallback",
    }),
    { debug: true },
  );
});

test("normalizes the global implicit-subagents setting", () => {
  assert.deepEqual(
    normalizeToolSettings({ multiAgentEnabled: true }),
    { multiAgentEnabled: true },
  );
  assert.deepEqual(
    normalizeToolSettings({ multiAgentEnabled: "true" }),
    {},
  );
});

test("resolves the global implicit-subagents setting before legacy workspace values", () => {
  assert.equal(resolveGlobalMultiAgentEnabled({}, {}), false);
  assert.equal(resolveGlobalMultiAgentEnabled({ multiAgentEnabled: false }, {
    multiAgentEnabled: true,
  }), false);
  assert.equal(resolveGlobalMultiAgentEnabled({ multiAgentEnabled: true }, {
    multiAgentEnabled: false,
  }), true);
  assert.equal(resolveGlobalMultiAgentEnabled({}, { multiAgentEnabled: true }), true);
  assert.equal(resolveGlobalMultiAgentEnabled({}, { codexMultiAgentEnabled: true }), true);
});

test("normalizes the global automatic-compaction setting", () => {
  assert.deepEqual(
    normalizeToolSettings({ autoCompactContextAfterRun: false }),
    { autoCompactContextAfterRun: false },
  );
  assert.deepEqual(
    normalizeToolSettings({ autoCompactContextAfterRun: "false" }),
    {},
  );
});

test("resolves global automatic compaction before legacy workspace values", () => {
  assert.equal(resolveGlobalAutoCompactContextAfterRun({}, {}), true);
  assert.equal(resolveGlobalAutoCompactContextAfterRun({ autoCompactContextAfterRun: false }, {
    autoCompactContextAfterRun: true,
  }), false);
  assert.equal(resolveGlobalAutoCompactContextAfterRun({ autoCompactContextAfterRun: true }, {
    autoCompactContextAfterRun: false,
  }), true);
  assert.equal(resolveGlobalAutoCompactContextAfterRun({}, {
    autoCompactContextAfterRun: false,
    autoCompactContextBeforeRun: true,
  }), false);
  assert.equal(resolveGlobalAutoCompactContextAfterRun({}, {
    autoCompactContextBeforeRun: false,
  }), false);
});

test("resolves long-term memory disabled by default without requiring persisted settings", () => {
  assert.equal(resolveLongTermMemoryEnabled({}), false);
});

test("keeps any explicit total-switch false as the effective long-term memory state", () => {
  assert.equal(resolveLongTermMemoryEnabled({ memoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ globalMemoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ workspaceMemoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ longTermMemoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ workspaceSettings: { longTermMemoryEnabled: false } }), false);
  assert.equal(resolveLongTermMemoryEnabled({ workspaceSettings: { workspaceMemoryEnabled: false } }), false);
});

test("ignores legacy global long-term memory field after memory became workspace scoped", () => {
  assert.equal(
    resolveLongTermMemoryEnabled({
      longTermMemoryEnabled: false,
      workspaceSettings: { workspaceMemoryEnabled: true },
    }),
    true,
  );
});

test("treats memory auto-extract settings as secondary switches only", () => {
  assert.equal(
    resolveLongTermMemoryEnabled({
      workspaceSettings: { workspaceMemoryEnabled: false },
      memoryAutoExtractAfterCompact: true,
      memoryAutoExtractAfterLobsterTask: true,
    }),
    false,
  );
  assert.equal(resolveLongTermMemoryEnabled({ memoryAutoExtractAfterCompact: true }), false);
});

test("preserves long-term memory false when saving unrelated tool settings", () => {
  const stored: ToolSettingsState = normalizeToolSettings({
    longTermMemoryEnabled: false,
    debug: false,
  });
  const saved = normalizeToolSettings({
    ...stored,
    locale: "zh-CN",
  });

  assert.deepEqual(saved, {
    debug: false,
    locale: "zh-CN",
    longTermMemoryEnabled: false,
  });
});

test("normalizes known legacy memory fields without accepting non-boolean values", () => {
  assert.deepEqual(
    normalizeToolSettings({
      memoryEnabled: false,
      globalMemoryEnabled: true,
      memoryAutoExtractAfterCompact: "true",
      memoryAutoExtractAfterLobsterTask: true,
    }),
    {
      memoryEnabled: false,
      globalMemoryEnabled: true,
      memoryAutoExtractAfterLobsterTask: true,
    },
  );
});

test("normalizes global Loop tool settings", () => {
  assert.deepEqual(
    normalizeToolSettings({
      lobsterMaxRounds: "42.9",
      lobsterAutoCloseSubtaskTabs: false,
    }),
    {
      lobsterMaxRounds: 42,
      lobsterAutoCloseSubtaskTabs: false,
    },
  );
  assert.deepEqual(
    normalizeToolSettings({
      lobsterMaxRounds: "",
      lobsterAutoCloseSubtaskTabs: "false",
    }),
    {},
  );
});
