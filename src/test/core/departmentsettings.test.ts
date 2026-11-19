import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { installVscodeMock } from "../vscodeMock";
import {
  DEPARTMENT_MAX_EMPLOYEES_DEFAULT,
  DEPARTMENT_MAX_LEADERS_DEFAULT,
  normalizeDepartmentMaxEmployees,
  normalizeDepartmentMaxLeaders,
} from "../../departmentSettings";
installVscodeMock();
const { preferenceSettingCommands } = require("../../settingMessageHandlers/preferences") as typeof import("../../settingMessageHandlers/preferences");
const { WEBVIEW_STRINGS } = require("../../webview/viewContentStrings") as typeof import("../../webview/viewContentStrings");

test("department capacity defaults and numeric inputs normalize to safe positive integers", () => {
  assert.equal(DEPARTMENT_MAX_LEADERS_DEFAULT, 4);
  assert.equal(DEPARTMENT_MAX_EMPLOYEES_DEFAULT, 16);
  for (const [input, expected] of [["7.9", 7], [3.8, 3], [" 12 ", 12]] as const) {
    assert.equal(normalizeDepartmentMaxLeaders(input), expected);
    assert.equal(normalizeDepartmentMaxEmployees(input), expected);
  }
});

test("invalid department capacities fall back without coercing non-numeric values", () => {
  for (const input of [undefined, "", "  ", "NaN", "Infinity", Number.NaN, Infinity, true, false, {}, [], 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeDepartmentMaxLeaders(input), 4);
    assert.equal(normalizeDepartmentMaxEmployees(input), 16);
  }
});

test("department capacities round-trip through the global settings file", () => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-department-settings-"));
  try {
    const script = `
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const path = require("node:path");
      const home = ${JSON.stringify(temporaryHome)};
      require("node:os").homedir = () => home;
      const settings = require(${JSON.stringify(path.resolve(__dirname, "../../toolSettings.js"))});
      const filePath = path.join(home, ".sinitek_cli", "settings.json");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ loopPlusDecisionSubtaskMax: 11, departmentMaxLeaders: "5.8" }));
      assert.equal(settings.readToolSettings().departmentMaxEmployees, undefined);
      assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).departmentMaxEmployees, undefined);
      settings.writeToolSettings({ ...settings.readToolSettings(), departmentMaxEmployees: 20 });
      assert.equal(settings.readToolSettings().departmentMaxEmployees, 20);
      assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).departmentMaxEmployees, 20);
      settings.writeToolSettings({ ...settings.readToolSettings(), departmentMaxEmployees: 25.4 });
      assert.deepEqual(settings.readToolSettings(), { loopPlusDecisionSubtaskMax: 11, departmentMaxLeaders: 5, departmentMaxEmployees: 25 });
      assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { loopPlusDecisionSubtaskMax: 11, departmentMaxLeaders: 5, departmentMaxEmployees: 25 });
      assert.equal(settings.getToolSettingsFilePath(), filePath);
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});

test("typed preference commands persist normalized values and surface failed saves", async () => {
  for (const [key, value, expected] of [
    ["departmentMaxLeaders", "6.8", 6],
    ["departmentMaxEmployees", 23.2, 23],
  ] as const) {
    const saved: unknown[] = [];
    const errors: unknown[] = [];
    const command = preferenceSettingCommands.find((candidate) => candidate.matches({ type: "updateSetting", key, value }));
    assert.ok(command);
    await command.execute({ type: "updateSetting", key, value }, {
      updateStoredToolSettings: (patch: unknown) => { saved.push(patch); return true; },
      showWebviewError: (...args: unknown[]) => { errors.push(args); },
    } as never, { currentCli: "codex", workspaceSettings: {} } as never);
    assert.deepEqual(saved, [{ [key]: expected }]);
    assert.deepEqual(errors, []);
  }

  const failures: Array<[string, string]> = [];
  const failedCommand = preferenceSettingCommands.find((candidate) => candidate.matches({
    type: "updateSetting", key: "departmentMaxLeaders", value: 9,
  }));
  assert.ok(failedCommand);
  await failedCommand.execute({ type: "updateSetting", key: "departmentMaxLeaders", value: 9 }, {
    updateStoredToolSettings: () => false,
    showWebviewError: (title: string, detail: string) => { failures.push([title, detail]); },
  } as never, { currentCli: "codex", workspaceSettings: {} } as never);
  assert.deepEqual(failures, [[WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.departmentMaxLeadersSaveError]]);
  const retrySaves: unknown[] = [];
  await failedCommand.execute({ type: "updateSetting", key: "departmentMaxLeaders", value: 10 }, {
    updateStoredToolSettings: (patch: unknown) => { retrySaves.push(patch); return true; },
    showWebviewError: (title: string, detail: string) => { failures.push([title, detail]); },
  } as never, { currentCli: "codex", workspaceSettings: {} } as never);
  assert.deepEqual(retrySaves, [{ departmentMaxLeaders: 10 }]);
  assert.equal(failures.length, 1);
});

test("task mode preference has one strict boolean handler and reports failed persistence", async () => {
  const key = "departmentEnabled";
  const matching = preferenceSettingCommands.filter((candidate) => candidate.matches({ type: "updateSetting", key, value: true }));
  assert.equal(matching.length, 1);
  const patches: unknown[] = [];
  const errors: unknown[] = [];
  const command = matching[0]!;
  await command.execute({ type: "updateSetting", key, value: "true" as never }, {
    updateStoredToolSettings: (patch: unknown) => { patches.push(patch); return true; },
    showWebviewError: (...args: unknown[]) => { errors.push(args); },
  } as never, { currentCli: "codex", workspaceSettings: {} } as never);
  assert.deepEqual(patches, []);
  await command.execute({ type: "updateSetting", key, value: false } as never, {
    updateStoredToolSettings: (() => false) as never,
    showWebviewError: (...args: unknown[]) => { errors.push(args); },
  } as never, { currentCli: "codex", workspaceSettings: {} } as never);
  assert.deepEqual(patches, []);
  assert.equal(errors.length, 1);
});

test("workspace capacities resolve independently without turning corrupt overrides into defaults", () => {
  const { normalizeWorkspaceDepartmentCapacity: normalize, resolveEffectiveDepartmentLimits: resolve } = require("../../departmentSettings") as typeof import("../../departmentSettings");
  const global = { departmentMaxLeaders: "8.9", departmentMaxEmployees: 40 };
  for (const value of [undefined, null, "", " ", true, false, {}, [], "oops", 0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalize(value), undefined);
    assert.deepEqual(resolve({ departmentMaxLeaders: value, departmentMaxEmployees: value }, global), { maxLeaders: 8, maxEmployees: 40 });
  }
  assert.deepEqual(resolve({}, {}), { maxLeaders: 4, maxEmployees: 16 });
  assert.deepEqual(resolve({ departmentMaxLeaders: "2.8" }, global), { maxLeaders: 2, maxEmployees: 40 });
  assert.deepEqual(resolve({ departmentMaxEmployees: "11.9" }, global), { maxLeaders: 8, maxEmployees: 11 });
  assert.deepEqual(resolve({ departmentMaxLeaders: 2, departmentMaxEmployees: Number.MAX_SAFE_INTEGER }, global), { maxLeaders: 2, maxEmployees: Number.MAX_SAFE_INTEGER });
});
