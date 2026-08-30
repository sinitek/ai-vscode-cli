import test = require("node:test");
import assert = require("node:assert/strict");
import * as path from "path";

import {
  createConfigPaths,
  getCodexRuntimePaths,
  getConfigDir,
  getConfigFilePath,
  getConfigOrderPath,
  getOpenCodeRuntimePaths,
  normalizeConfigPlatform,
} from "../config/configPaths";

test("central config path helpers preserve profile roots and legacy OpenCode aliasing", () => {
  const homeDir = path.join(path.sep, "home", "tester");
  const paths = createConfigPaths(homeDir);

  assert.equal(normalizeConfigPlatform("claude"), "claude");
  assert.equal(normalizeConfigPlatform("codex"), "codex");
  assert.equal(normalizeConfigPlatform("opencode"), "opencode");
  assert.equal(normalizeConfigPlatform("gemini"), "opencode");

  assert.equal(getConfigDir("claude", paths), path.join(homeDir, ".claude", "__config"));
  assert.equal(getConfigDir("codex", paths), path.join(homeDir, ".codex", "__config"));
  assert.equal(getConfigDir("gemini", paths), path.join(homeDir, ".opencode", "__config"));
  assert.equal(
    getConfigOrderPath("opencode", paths),
    path.join(homeDir, ".opencode", "__config", "config-order.json"),
  );
  assert.equal(
    getConfigFilePath("codex", "primary", paths),
    path.join(homeDir, ".codex", "__config", "primary.json"),
  );

  assert.deepEqual(getCodexRuntimePaths(paths), {
    config: path.join(homeDir, ".codex", "config.toml"),
  });
  assert.deepEqual(getOpenCodeRuntimePaths(paths), {
    config: path.join(homeDir, ".opencode", "config.json"),
  });
});
