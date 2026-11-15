import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { assertModeAvailable, resolveModeAvailability } from "../../modeAvailability";

test("task modes default on except department and accept only booleans", () => {
  assert.deepEqual(resolveModeAvailability({}), { loopEnabled: true, loopPlusEnabled: true, departmentEnabled: false });
  assert.deepEqual(resolveModeAvailability({ loopEnabled: "false" as never, loopPlusEnabled: 0 as never, departmentEnabled: "true" as never }), {
    loopEnabled: true, loopPlusEnabled: true, departmentEnabled: false,
  });
  assert.deepEqual(resolveModeAvailability({ loopEnabled: false, loopPlusEnabled: false, departmentEnabled: true }), {
    loopEnabled: false, loopPlusEnabled: false, departmentEnabled: true,
  });
});

test("closed modes throw an explicit refusal while coding and enabled modes pass", () => {
  assert.doesNotThrow(() => assertModeAvailable("coding", {}));
  assert.doesNotThrow(() => assertModeAvailable("loop", {}));
  assert.throws(() => assertModeAvailable("department", {}), /产研部已在工具设置中关闭/);
  assert.throws(() => assertModeAvailable("loop_plus", { loopPlusEnabled: false }), /Loop\+已在工具设置中关闭/);
});

test("mode switches persist globally without coercing invalid values", () => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-mode-settings-"));
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
      fs.writeFileSync(filePath, JSON.stringify({ loopEnabled: "false", loopPlusEnabled: false, departmentEnabled: "true" }));
      assert.deepEqual(settings.readToolSettings(), { loopPlusEnabled: false });
      settings.writeToolSettings({ ...settings.readToolSettings(), loopEnabled: true, departmentEnabled: false });
      assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { loopPlusEnabled: false, loopEnabled: true, departmentEnabled: false });
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});
