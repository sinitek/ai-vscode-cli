import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  isCliEnabled,
  listEnabledClis,
  normalizeCliEnabledByName,
  normalizeToolSettings,
  readHumanInteractionTimeoutMs,
  resolveGlobalAutoCompactContextAfterRun,
  resolveGlobalHumanInteractionEnabled,
  resolveHumanInteractionTimeoutMinutes,
  resolveLongTermMemoryEnabled,
  resolveNextEnabledCli,
  normalizeHistoryRetentionDays,
  type ToolSettingsState,
} from "../../toolSettings";
import { getLegacyLoopPropertyKey } from "../../loopLegacyMigration";

test("chat message limit keeps old settings compatible and preserves neighboring values", () => {
  assert.deepEqual(normalizeToolSettings(undefined), {});
  assert.deepEqual(normalizeToolSettings({ debug: true, historyRetentionDays: 45 }), {
    debug: true, historyRetentionDays: 45,
  });
  for (const [value, expected] of [["734.9", 734], ["", 500], [null, 500], [true, 500], [Infinity, 500], [0, 1], [20000, 10000]] as const) {
    assert.deepEqual(normalizeToolSettings({ debug: true, chatMessageLimit: value, historyRetentionDays: 45 }), {
      debug: true, chatMessageLimit: expected, historyRetentionDays: 45,
    });
  }
});

test("instruction bubble visibility accepts only booleans and keeps old settings compatible", () => {
  for (const enabled of [true, false]) {
    assert.deepEqual(normalizeToolSettings({ debug: true, hideInstructionBubbles: enabled }), {
      debug: true, hideInstructionBubbles: enabled,
    });
  }
  for (const value of [undefined, null, "true", "false", 1, 0, {}, []]) {
    assert.deepEqual(normalizeToolSettings({ debug: true, hideInstructionBubbles: value }), { debug: true });
  }
});

test("chat display settings persist globally without losing other settings", () => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-chat-limit-settings-"));
  try {
    const script = `
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const path = require("node:path");
      require("node:os").homedir = () => ${JSON.stringify(temporaryHome)};
      const settings = require(${JSON.stringify(path.resolve(__dirname, "../../toolSettings.js"))});
      const filePath = path.join(${JSON.stringify(temporaryHome)}, ".sinitek_cli", "settings.json");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ debug: true, historyRetentionDays: 45, humanInteractionTimeoutMinutes: 12 }));
      assert.deepEqual(settings.readToolSettings(), { debug: true, historyRetentionDays: 45, humanInteractionTimeoutMinutes: 12 });
      settings.writeToolSettings({ ...settings.readToolSettings(), chatMessageLimit: "879.9" });
      const expected = { debug: true, historyRetentionDays: 45, humanInteractionTimeoutMinutes: 12, chatMessageLimit: 879 };
      assert.equal(settings.getToolSettingsFilePath(), filePath);
      assert.deepEqual(settings.readToolSettings(), expected);
      assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), expected);
      for (const enabled of [true, false]) {
        settings.writeToolSettings({ ...settings.readToolSettings(), hideInstructionBubbles: enabled });
        const persisted = { ...expected, hideInstructionBubbles: enabled };
        assert.deepEqual(settings.readToolSettings(), persisted);
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), persisted);
      }
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});

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

test("ignores retired implicit-subagents settings without affecting other settings", () => {
  for (const value of [true, false, "true", null]) {
    assert.deepEqual(
      normalizeToolSettings({ multiAgentEnabled: value, codexMultiAgentEnabled: value, debug: true }),
      { debug: true },
    );
  }
  assert.deepEqual(normalizeToolSettings({ multiAgentEnabled: false }), {});
});

test("keeps CLI enable flags default-on and persists only explicit booleans", () => {
  assert.deepEqual(listEnabledClis({}), ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"]);
  assert.deepEqual(listEnabledClis(null), ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"]);
  assert.equal(isCliEnabled("codex", {}), true);
  assert.equal(isCliEnabled("zcode", {}), true);
  assert.equal(isCliEnabled("zcode", { cliEnabledByName: { zcode: false } }), false);
  assert.equal(isCliEnabled("not-a-cli", {}), false);
  assert.deepEqual(normalizeToolSettings({
    cliEnabledByName: { codex: false, claude: "no", grok: true, extra: false },
  }), {
    cliEnabledByName: { codex: false, grok: true },
  });
  assert.deepEqual(
    listEnabledClis({ cliEnabledByName: { codex: false } }),
    ["claude", "opencode", "grok", "dsh", "kimi-code", "zcode"],
  );
  assert.equal(resolveNextEnabledCli("codex", { cliEnabledByName: { codex: false } }), "claude");
  assert.equal(resolveNextEnabledCli("grok", { cliEnabledByName: { grok: true } }), "grok");
  assert.equal(resolveNextEnabledCli("codex", {
    cliEnabledByName: { codex: false, claude: false, opencode: false, grok: false, dsh: false, "kimi-code": false, zcode: false },
  }), null);
  assert.equal(normalizeCliEnabledByName(["codex"]), undefined);
  assert.equal(normalizeCliEnabledByName({ codex: 1, claude: null }), undefined);
});

test("normalizes the global human-interaction setting", () => {
  assert.deepEqual(
    normalizeToolSettings({ humanInteractionEnabled: false }),
    { humanInteractionEnabled: false },
  );
  assert.deepEqual(
    normalizeToolSettings({ humanInteractionEnabled: "false" }),
    {},
  );
});

test("resolves global human interaction as default-on", () => {
  assert.equal(resolveGlobalHumanInteractionEnabled({}), true);
  assert.equal(resolveGlobalHumanInteractionEnabled({ humanInteractionEnabled: true }), true);
  assert.equal(resolveGlobalHumanInteractionEnabled({ humanInteractionEnabled: false }), false);
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
      memoryAutoExtractAfterLoopTask: true,
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
  });

  assert.deepEqual(saved, {
    debug: false,
    longTermMemoryEnabled: false,
  });
});

test("normalizes known legacy memory fields without accepting non-boolean values", () => {
  assert.deepEqual(
    normalizeToolSettings({
      memoryEnabled: false,
      globalMemoryEnabled: true,
      memoryAutoExtractAfterCompact: "true",
      memoryAutoExtractAfterLoopTask: true,
    }),
    {
      memoryEnabled: false,
      globalMemoryEnabled: true,
      memoryAutoExtractAfterLoopTask: true,
    },
  );
});

test("normalizes global Loop tool settings", () => {
  assert.deepEqual(
    normalizeToolSettings({
      loopMaxRounds: "42.9",
      loopPlusDecisionSubtaskMax: "8.2",
      loopPlusMaxAcceptances: "100.8",
      humanInteractionTimeoutMinutes: "10.9",
      loopSubtaskMaxThinkingMode: "high",
    }),
    {
      loopMaxRounds: 42,
      loopPlusDecisionSubtaskMax: 8,
      loopPlusMaxAcceptances: 100,
      humanInteractionTimeoutMinutes: 10,
    },
  );
  assert.deepEqual(
    normalizeToolSettings({
      loopMaxRounds: "",
      loopPlusDecisionSubtaskMax: "",
      loopPlusMaxAcceptances: "",
      humanInteractionTimeoutMinutes: "",
      loopSubtaskMaxThinkingMode: "invalid",
    }),
    {},
  );
  assert.equal(resolveHumanInteractionTimeoutMinutes(undefined), 15);
  assert.equal(resolveHumanInteractionTimeoutMinutes(0), 1);
  assert.equal(resolveHumanInteractionTimeoutMinutes(9999), 1440);
  assert.equal(readHumanInteractionTimeoutMs({}), 900_000);
  assert.equal(readHumanInteractionTimeoutMs({ humanInteractionTimeoutMinutes: 2 }), 120_000);
  assert.equal(readHumanInteractionTimeoutMs({ humanInteractionTimeoutMinutes: 1440 }), 86_400_000);
  assert.deepEqual(
    normalizeToolSettings({ loopSubtaskMaxThinkingMode: "ultra" }),
    {},
  );
});

test("normalizes global automatic-cleanup retention days", () => {
  assert.deepEqual(normalizeToolSettings({ historyRetentionDays: "45.9" }), {
    historyRetentionDays: 45,
  });
  assert.equal(normalizeHistoryRetentionDays(0), 1);
  assert.equal(normalizeHistoryRetentionDays(99999), 3650);
  assert.equal(normalizeHistoryRetentionDays("invalid"), 30);
  assert.deepEqual(normalizeToolSettings({ historyRetentionDays: "" }), {});
});

test("migrates legacy Loop tool-setting keys and prefers current values", () => {
  assert.deepEqual(
    normalizeToolSettings({
      [getLegacyLoopPropertyKey("loopMaxRounds")]: "31.8",
      [getLegacyLoopPropertyKey("loopSubtaskMaxThinkingMode")]: "max",
      [getLegacyLoopPropertyKey("memoryAutoExtractAfterLoopTask")]: true,
    }),
    {
      loopMaxRounds: 31,
      memoryAutoExtractAfterLoopTask: true,
    },
  );
  assert.deepEqual(
    normalizeToolSettings({
      loopMaxRounds: 12,
      [getLegacyLoopPropertyKey("loopMaxRounds")]: 99,
    }),
    { loopMaxRounds: 12 },
  );
});
