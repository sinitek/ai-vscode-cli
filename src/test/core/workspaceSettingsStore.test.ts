import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadWorkspaceSettings,
  saveWorkspaceSettings,
  trySaveWorkspaceSettings,
  type WorkspaceSettingsStoreOptions,
} from "../../workspaceSettingsStore";
import type { CliName, InteractiveMode, ThinkingMode } from "../../cli/types";
import {
  LEGACY_LOOP_INTERACTIVE_MODE,
  getLegacyLoopPropertyKey,
} from "../../loopLegacyMigration";

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

test("ignores the retired Codex multi-agent field when loading and saving workspace settings", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify({ codexMultiAgentEnabled: true }), "utf8");

    const loaded = loadWorkspaceSettings(options);

    assert.deepEqual(loaded, {});
    saveWorkspaceSettings(loaded, options);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), {});
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});

test("ignores retired workspace implicit-subagents settings even when they disagree", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      multiAgentEnabled: false,
      codexMultiAgentEnabled: true,
    }), "utf8");

    assert.deepEqual(loadWorkspaceSettings(options), {});
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
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "loopExecutionModeByCli"), false);
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

test("loads acceptance plans and selection, then saves them beside other settings fields", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      workspaceMemoryEnabled: true,
      loopPlusAcceptancePlans: [
        { id: "plan-a", name: " 上线前加严 ", checks: { security: true, other: true }, otherText: " 鉴权边界 ", updatedAt: 5 },
        { id: "plan-a", name: "重复 ID 应被丢弃", checks: [], otherText: "" },
        { id: "", name: "缺少 ID", checks: [], otherText: "" },
      ],
      loopPlusAcceptancePlanSelection: "plan-a",
    }), "utf8");

    const loaded = loadWorkspaceSettings(options);
    assert.equal(loaded.workspaceMemoryEnabled, true);
    assert.deepEqual(loaded.loopPlusAcceptancePlans, [{
      id: "plan-a",
      name: "上线前加严",
      checks: ["security", "other"],
      otherText: "鉴权边界",
      updatedAt: 5,
    }]);
    assert.equal(loaded.loopPlusAcceptancePlanSelection, "plan-a");

    saveWorkspaceSettings(loaded, options);
    const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(saved.workspaceMemoryEnabled, true);
    assert.equal(saved.loopPlusAcceptancePlans[0].name, "上线前加严");
    assert.equal(saved.loopPlusAcceptancePlanSelection, "plan-a");
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});

test("corrupted acceptance plan settings fall back to the system default without breaking other fields", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      workspaceMemoryEnabled: true,
      loopPlusAcceptancePlans: "not-an-array",
      loopPlusAcceptancePlanSelection: { bad: true },
    }), "utf8");
    const loaded = loadWorkspaceSettings(options);
    assert.equal(loaded.workspaceMemoryEnabled, true);
    assert.equal(loaded.loopPlusAcceptancePlans, undefined);
    assert.equal(loaded.loopPlusAcceptancePlanSelection, "system_default");
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});

test("trySaveWorkspaceSettings reports failures instead of silently dropping the write", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = createOptions(workspaceSettingsDir);
  try {
    const ok = trySaveWorkspaceSettings({ loopPlusAcceptancePlanSelection: "system_default" }, options);
    assert.deepEqual(ok, { ok: true });

    const missingStore = trySaveWorkspaceSettings(
      { loopPlusAcceptancePlanSelection: "system_default" },
      { ...options, workspaceKey: null },
    );
    assert.equal(missingStore.ok, false);
    if (!missingStore.ok) {
      assert.match(missingStore.error, /设置存储位置/);
    }
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});
