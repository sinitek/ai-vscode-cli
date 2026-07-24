import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadWorkspaceSettings,
  saveWorkspaceSettings,
  type WorkspaceSettingsStoreOptions,
} from "../workspaceSettingsStore";
import type { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import {
  LEGACY_LOOP_INTERACTIVE_MODE,
  getLegacyLoopPropertyKey,
} from "../loopLegacyMigration";

function createOptions(workspaceSettingsDir: string): WorkspaceSettingsStoreOptions {
  return {
    workspaceSettingsDir,
    workspaceKey: "workspace",
    isCliName: (value): value is CliName => (
      value === "codex" || value === "claude" || value === "opencode"
    ),
    isThinkingMode: (value): value is ThinkingMode => (
      value === "off" || value === "on" || value === "low" || value === "medium"
      || value === "high" || value === "xhigh" || value === "max" || value === "ultra"
    ),
    isInteractiveMode: (value): value is InteractiveMode => (
      value === "coding" || value === "plan" || value === "loop"
    ),
    normalizeVisibleInteractiveMode: (value) => (
      value === "plan" || value === "loop" ? value : "coding"
    ),
    normalizeLoopMaxRounds: () => 20,
    sanitizeConversationTabRecord: () => null,
  };
}

test("retains the legacy Codex multi-agent candidate until host migration succeeds", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify({ codexMultiAgentEnabled: true }), "utf8");

    const loaded = loadWorkspaceSettings(options);

    assert.deepEqual(loaded, { multiAgentEnabled: true });
    saveWorkspaceSettings(loaded, options);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { multiAgentEnabled: true });
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});

test("prefers the newer workspace migration candidate over the legacy Codex value", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      multiAgentEnabled: false,
      codexMultiAgentEnabled: true,
    }), "utf8");

    assert.deepEqual(loadWorkspaceSettings(options), { multiAgentEnabled: false });
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});

test("loads after-run automatic compaction before the legacy before-run candidate", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      autoCompactContextAfterRun: false,
      autoCompactContextBeforeRun: true,
    }), "utf8");

    const loaded = loadWorkspaceSettings(options);
    assert.deepEqual(loaded, { autoCompactContextAfterRun: false });
    saveWorkspaceSettings(loaded, options);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(filePath, "utf8")),
      { autoCompactContextAfterRun: false },
    );
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});

test("migrates legacy Loop workspace keys and interactive mode", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  const legacyExecutionModeKey = getLegacyLoopPropertyKey("loopExecutionModeByCli");
  const legacyMaxRoundsKey = getLegacyLoopPropertyKey("loopMaxRounds");
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      interactiveModeByCli: { codex: LEGACY_LOOP_INTERACTIVE_MODE },
      [legacyExecutionModeKey]: { codex: "debate_multi_agent" },
      [legacyMaxRoundsKey]: 30,
    }), "utf8");

    const loaded = loadWorkspaceSettings(options);

    assert.equal(loaded.interactiveModeByCli?.codex, "loop");
    assert.equal(loaded.loopExecutionModeByCli?.codex, "debate_multi_agent");
    assert.equal(loaded.loopMaxRounds, 20);

    saveWorkspaceSettings(loaded, options);
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, legacyExecutionModeKey), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, legacyMaxRoundsKey), false);
    assert.deepEqual(persisted.interactiveModeByCli, { codex: "loop" });
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});
