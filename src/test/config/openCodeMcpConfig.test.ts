import test = require("node:test");
import assert = require("node:assert/strict");
import * as path from "path";
import { resolveOpenCodeGlobalConfigPath } from "../../config/configPaths";

test("resolves the official OpenCode global config path with XDG support", () => {
  assert.equal(
    resolveOpenCodeGlobalConfigPath({ env: {}, homeDir: "/home/tester" }),
    path.join("/home/tester", ".config", "opencode", "opencode.json"),
  );
  assert.equal(
    resolveOpenCodeGlobalConfigPath({
      env: { XDG_CONFIG_HOME: "/custom/config" },
      homeDir: "/home/tester",
    }),
    path.join("/custom/config", "opencode", "opencode.json"),
  );
  assert.equal(
    resolveOpenCodeGlobalConfigPath({
      env: { XDG_CONFIG_HOME: "~/.xdg" },
      homeDir: "/home/tester",
    }),
    path.join("/home/tester", ".xdg", "opencode", "opencode.json"),
  );
});
