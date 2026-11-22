import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadWorkspaceSettings,
  normalizeWorkspaceLoopPlusDecisionSubtaskMax,
  resolveEffectiveLoopPlusDecisionSubtaskMax,
  saveWorkspaceSettings,
  trySaveWorkspaceSettings,
  tryUpdateWorkspaceSettings,
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
      value === "coding" || value === "plan" || value === "loop" || value === "loop_plus" || value === "department"
    ),
    normalizeVisibleInteractiveMode: (value) => (
      value === "plan" || value === "loop" || value === "department" || value === "loop_plus" ? value : "coding"
    ),
    sanitizeConversationTabRecord: () => null,
  };
}

test("workspace setting patches reload and preserve concurrent fields", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-patch-"));
  const options = createOptions(directory);
  try {
    saveWorkspaceSettings({ workspaceMemoryEnabled: true, loopPlusDecisionSubtaskMax: 4 }, options);
    assert.equal(tryUpdateWorkspaceSettings((settings) => {
      settings.loopPlusDecisionSubtaskMax = 9;
      return settings;
    }, options).ok, true);
    assert.equal(tryUpdateWorkspaceSettings((settings) => {
      settings.departmentMaxEmployees = 22;
      return settings;
    }, options).ok, true);
    assert.deepEqual(loadWorkspaceSettings(options), {
      workspaceMemoryEnabled: true,
      loopPlusDecisionSubtaskMax: 9,
      departmentMaxEmployees: 22,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stale workspace snapshots preserve settings saved by another host", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-stale-snapshot-"));
  const options = createOptions(directory);
  const filePath = path.join(directory, "workspace.json");
  try {
    saveWorkspaceSettings({
      currentCli: "codex",
      thinkingMode: "high",
      interactiveModeByCli: { codex: "coding" },
      loopPlusDecisionSubtaskMax: 4,
    }, options);
    const stale = loadWorkspaceSettings(options);

    fs.writeFileSync(filePath, JSON.stringify({
      currentCli: "codex",
      thinkingMode: "medium",
      interactiveModeByCli: { codex: "coding", claude: "plan" },
      loopPlusDecisionSubtaskMax: 7,
      workspaceMemoryEnabled: false,
    }), "utf8");

    stale.currentCli = "claude";
    stale.interactiveModeByCli!.codex = "loop";
    delete stale.loopPlusDecisionSubtaskMax;
    assert.equal(trySaveWorkspaceSettings(stale, options).ok, true);

    fs.writeFileSync(filePath, JSON.stringify({
      currentCli: "claude",
      thinkingMode: "ultra",
      interactiveModeByCli: { codex: "loop", claude: "plan" },
      workspaceMemoryEnabled: false,
    }), "utf8");
    stale.interactiveModeByCli!.codex = "plan";
    assert.equal(trySaveWorkspaceSettings(stale, options).ok, true);
    assert.deepEqual(loadWorkspaceSettings(options), {
      currentCli: "claude",
      thinkingMode: "ultra",
      interactiveModeByCli: { codex: "plan", claude: "plan" },
      workspaceMemoryEnabled: false,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("round-trips department mode and role routes scoped to the director profile", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const options = { ...createOptions(workspaceSettingsDir), isCliName: (value: string): value is CliName => ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"].includes(value) };
  try {
    saveWorkspaceSettings({
      interactiveModeByCli: { codex: "department" },
      activeConfigIdByCli: { codex: "director-profile" },
      departmentRoleRoutesByDirectorConfig: {
        "director-profile": {
          leader: { cli: "claude", configId: "leader-profile", model: null, thinkingMode: "high", openCodeVariant: null },
          employee: { cli: "opencode", configId: "employee-profile", model: "provider/model", thinkingMode: null, openCodeVariant: "high" },
        },
      },
    }, options);
    const loaded = loadWorkspaceSettings(options);
    assert.equal(loaded.interactiveModeByCli?.codex, "department");
    assert.deepEqual(loaded.departmentRoleRoutesByDirectorConfig?.["director-profile"], {
      leader: { cli: "claude", configId: "leader-profile", model: null, thinkingMode: "high", openCodeVariant: null },
      employee: { cli: "opencode", configId: "employee-profile", model: "provider/model", thinkingMode: null, openCodeVariant: "high" },
    });
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});

test("department partial choices round-trip without inventing another role or accepting coerced effort", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-partial-"));
  const options = createOptions(directory);
  try {
    saveWorkspaceSettings({ departmentRoleRoutesByDirectorConfig: {
      first: { leader: { cli: "codex", configId: "leader", model: null, thinkingMode: "high", openCodeVariant: null } },
      second: { employee: { cli: "claude", configId: "employee", model: null, thinkingMode: null, openCodeVariant: null } },
    } }, options);
    const loaded = loadWorkspaceSettings(options);
    assert.equal(loaded.departmentRoleRoutesByDirectorConfig?.first.employee, undefined);
    assert.equal(loaded.departmentRoleRoutesByDirectorConfig?.first.leader?.model, null);
    assert.equal(loaded.departmentRoleRoutesByDirectorConfig?.second.leader, undefined);
    fs.writeFileSync(path.join(directory, "workspace.json"), JSON.stringify({ departmentRoleRoutesByDirectorConfig: {
      first: { leader: { cli: "codex", configId: "leader", model: null, thinkingMode: ["high"], openCodeVariant: null } },
    } }));
    assert.equal(loadWorkspaceSettings(options).departmentRoleRoutesByDirectorConfig, undefined);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("workspace dispatch limit overrides global values and invalid overrides inherit", () => {
  for (const [workspace, global, expected] of [
    [2, 9, 2], [12, 3, 12], [undefined, 9, 9], [null, 9, 9],
    ["", 9, 9], ["invalid", 9, 9], [true, 9, 9], [Infinity, 9, 9],
    [undefined, undefined, 6], ["8.9", 9, 8], [0, 9, 1], [99, 9, 20],
  ] as const) {
    assert.equal(resolveEffectiveLoopPlusDecisionSubtaskMax(workspace, global), expected);
  }
  assert.equal(normalizeWorkspaceLoopPlusDecisionSubtaskMax({}), undefined);
  assert.equal(normalizeWorkspaceLoopPlusDecisionSubtaskMax("  "), undefined);
});

test("workspace dispatch limit persists per workspace, normalizes input and can be cleared", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-dispatch-"));
  const options = createOptions(workspaceSettingsDir);
  const filePath = path.join(workspaceSettingsDir, "workspace.json");
  try {
    for (const [value, expected] of [["8.9", 8], [0, 1], [99, 20], ["invalid", undefined], [null, undefined], ["", undefined]] as const) {
      fs.writeFileSync(filePath, JSON.stringify({ loopPlusDecisionSubtaskMax: value }), "utf8");
      assert.equal(loadWorkspaceSettings(options).loopPlusDecisionSubtaskMax, expected);
    }
    saveWorkspaceSettings({ loopPlusDecisionSubtaskMax: 3, workspaceMemoryEnabled: true }, options);
    assert.equal(loadWorkspaceSettings(options).loopPlusDecisionSubtaskMax, 3);
    assert.deepEqual(loadWorkspaceSettings({ ...options, workspaceKey: "other" }), {});
    const loaded = loadWorkspaceSettings(options);
    delete loaded.loopPlusDecisionSubtaskMax;
    saveWorkspaceSettings(loaded, options);
    assert.deepEqual(loadWorkspaceSettings(options), { workspaceMemoryEnabled: true });
  } finally {
    fs.rmSync(workspaceSettingsDir, { recursive: true, force: true });
  }
});

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
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "loopMaxRounds"), false);

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

test("各项目独立恢复最近选择并兼容迁移旧默认方案", () => {
  const workspaceSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-settings-"));
  const firstProject = { ...createOptions(workspaceSettingsDir), workspaceKey: "project-a" };
  const secondProject = { ...createOptions(workspaceSettingsDir), workspaceKey: "project-b" };
  const firstPath = path.join(workspaceSettingsDir, "project-a.json");
  try {
    fs.writeFileSync(firstPath, JSON.stringify({
      workspaceMemoryEnabled: true,
      loopPlusAcceptancePlans: [{
        id: "legacy-default", name: "默认方案", checks: ["security", "other"], otherText: "审计要求", updatedAt: 5,
      }],
      loopPlusAcceptancePlanSelection: "legacy-default",
    }), "utf8");
    saveWorkspaceSettings({ loopPlusAcceptancePlanSelection: "system_default" }, secondProject);
    const migrated = loadWorkspaceSettings(firstProject);
    assert.deepEqual(migrated.loopPlusAcceptancePlans, [{
      id: "legacy-default", name: "新建方案", checks: ["security", "other"], otherText: "审计要求", updatedAt: 5,
    }]);
    assert.equal(migrated.loopPlusAcceptancePlanSelection, "legacy-default");
    assert.equal(migrated.workspaceMemoryEnabled, true);
    saveWorkspaceSettings(migrated, firstProject);
    assert.deepEqual(loadWorkspaceSettings(firstProject), migrated);
    assert.equal(JSON.parse(fs.readFileSync(firstPath, "utf8")).loopPlusAcceptancePlans[0].name, "新建方案");
    assert.equal(loadWorkspaceSettings(secondProject).loopPlusAcceptancePlanSelection, "system_default");
    saveWorkspaceSettings({ ...migrated, loopPlusAcceptancePlanSelection: "system_default" }, firstProject);
    assert.equal(loadWorkspaceSettings(firstProject).loopPlusAcceptancePlanSelection, "system_default");
    assert.equal(loadWorkspaceSettings(secondProject).loopPlusAcceptancePlans, undefined);
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

test("workspace updates report and log a replaced lock without removing it", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-workspace-lock-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "workspace.json");
  const lockPath = `${filePath}.lock`;
  const logs: Array<{ event: string; payload: unknown }> = [];
  const options: WorkspaceSettingsStoreOptions = {
    ...createOptions(directory),
    logError: (event, payload) => logs.push({ event, payload }),
  };
  assert.deepEqual(trySaveWorkspaceSettings({ workspaceMemoryEnabled: true }, options), { ok: true });
  assert.equal(fs.existsSync(lockPath), false);

  const result = tryUpdateWorkspaceSettings((current) => {
    fs.renameSync(lockPath, `${lockPath}.original`);
    fs.writeFileSync(lockPath, "replacement", { flag: "wx" });
    return { ...current, departmentMaxEmployees: 12 };
  }, options);
  const error = "Error: 工作区设置锁已替换，拒绝释放未知锁。";
  assert.deepEqual(result, { ok: false, error });
  assert.deepEqual(logs, [{ event: "workspace-settings-write-error", payload: { error } }]);
  assert.equal(fs.readFileSync(lockPath, "utf8"), "replacement");
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), {
    workspaceMemoryEnabled: true,
    departmentMaxEmployees: 12,
  });
});

test("workspace capacity storage preserves inheritance, partial clears, other settings and isolation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-workspace-capacity-"));
  const a = { ...createOptions(directory), workspaceKey: "a" }, b = { ...createOptions(directory), workspaceKey: "b" };
  try {
    assert.deepEqual(loadWorkspaceSettings(a), {});
    assert.equal(trySaveWorkspaceSettings({ departmentMaxLeaders: 3, departmentMaxEmployees: 12, workspaceMemoryEnabled: true }, a).ok, true);
    assert.deepEqual(loadWorkspaceSettings(b), {});
    const next = loadWorkspaceSettings(a); delete next.departmentMaxLeaders;
    assert.equal(trySaveWorkspaceSettings(next, a).ok, true);
    assert.deepEqual(loadWorkspaceSettings(a), { departmentMaxEmployees: 12, workspaceMemoryEnabled: true });
    for (const value of ["", " ", true, "bad", 0, -1, 0.5, 9007199254740992]) {
      fs.writeFileSync(path.join(directory, "a.json"), JSON.stringify({ departmentMaxLeaders: value, departmentMaxEmployees: "13.8" }));
      assert.deepEqual(loadWorkspaceSettings(a), { departmentMaxEmployees: 13 });
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("partial workspace writes and replacement failures retain the previous saved document and remove temporary files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-atomic-save-"));
  const options = createOptions(directory);
  const mutableFs = require("node:fs") as typeof import("node:fs");
  const originalWrite = mutableFs.writeFileSync, originalRename = mutableFs.renameSync;
  try {
    const saved = { departmentMaxLeaders: 3, departmentMaxEmployees: 12, workspaceMemoryEnabled: true };
    assert.equal(trySaveWorkspaceSettings(saved, options).ok, true);
    const original = fs.readFileSync(path.join(directory, "workspace.json"), "utf8");
    mutableFs.writeFileSync = ((file: fs.PathOrFileDescriptor, ..._args: unknown[]) => {
      originalWrite(file, "partial"); throw new Error("injected partial write");
    }) as typeof fs.writeFileSync;
    assert.equal(trySaveWorkspaceSettings({ departmentMaxEmployees: 5 }, options).ok, false);
    mutableFs.writeFileSync = originalWrite;
    assert.equal(fs.readFileSync(path.join(directory, "workspace.json"), "utf8"), original);
    mutableFs.renameSync = () => { throw new Error("injected replacement failure"); };
    assert.equal(trySaveWorkspaceSettings({ departmentMaxEmployees: 5 }, options).ok, false);
    mutableFs.renameSync = originalRename;
    assert.deepEqual(loadWorkspaceSettings(options), saved);
    assert.deepEqual(fs.readdirSync(directory), ["workspace.json"]);
    assert.equal(trySaveWorkspaceSettings({ ...saved, departmentMaxEmployees: 5 }, options).ok, true);
    assert.equal(loadWorkspaceSettings(options).departmentMaxEmployees, 5);
  } finally {
    mutableFs.writeFileSync = originalWrite; mutableFs.renameSync = originalRename;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
