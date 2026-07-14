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
      value === "coding" || value === "plan" || value === "lobster"
    ),
    normalizeVisibleInteractiveMode: (value) => (
      value === "plan" || value === "lobster" ? value : "coding"
    ),
    normalizeLobsterMaxRounds: () => 20,
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
