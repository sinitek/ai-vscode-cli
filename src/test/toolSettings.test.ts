import test = require("node:test");
import assert = require("node:assert/strict");

import {
  normalizeToolSettings,
  resolveLongTermMemoryEnabled,
  type ToolSettingsState,
} from "../toolSettings";

test("resolves long-term memory enabled by default without requiring persisted settings", () => {
  assert.equal(resolveLongTermMemoryEnabled({}), true);
});

test("keeps any explicit total-switch false as the effective long-term memory state", () => {
  assert.equal(resolveLongTermMemoryEnabled({ memoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ globalMemoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ workspaceMemoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ workspaceSettings: { workspaceMemoryEnabled: false } }), false);
});

test("lets legacy false override canonical true unless the caller explicitly changes persisted state", () => {
  assert.equal(
    resolveLongTermMemoryEnabled({
      longTermMemoryEnabled: true,
      memoryEnabled: false,
    }),
    false,
  );
});

test("treats memory auto-extract settings as secondary switches only", () => {
  assert.equal(
    resolveLongTermMemoryEnabled({
      longTermMemoryEnabled: false,
      memoryAutoExtractAfterCompact: true,
      memoryAutoExtractAfterLobsterTask: true,
    }),
    false,
  );
  assert.equal(resolveLongTermMemoryEnabled({ memoryAutoExtractAfterCompact: true }), true);
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
