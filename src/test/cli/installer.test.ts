import assert = require("node:assert/strict");
import test = require("node:test");
import { CLI_LIST } from "../../cli/types";
import { getCliDisplayName, getCliInstallCommand } from "../../cli/installer";

test("every CLI group has an install command on Windows, macOS and Linux", () => {
  for (const cli of CLI_LIST) {
    assert.ok(getCliDisplayName(cli).trim());
    for (const platform of ["win32", "darwin", "linux"] as const) {
      assert.ok(getCliInstallCommand(cli, platform).trim(), cli + " needs an install command on " + platform);
    }
  }
});

test("ZCode uses the confirmed npm package on every supported platform", () => {
  for (const platform of ["win32", "darwin", "linux"] as const) {
    assert.equal(getCliInstallCommand("zcode", platform), "npm install -g zcode-app-cli@latest");
  }
});

test("CLI groups use the requested display names", () => {
  assert.deepEqual(CLI_LIST.map(getCliDisplayName), [
    "Codex",
    "Claude",
    "OpenCode",
    "Grok",
    "DSH",
    "KimiCode",
    "ZCode",
  ]);
});

test("Grok uses the official installer for the current platform", () => {
  assert.equal(getCliInstallCommand("grok", "win32"), "irm https://x.ai/cli/install.ps1 | iex");
  assert.equal(getCliInstallCommand("grok", "darwin"), "curl -fsSL https://x.ai/cli/install.sh | bash");
  assert.equal(getCliInstallCommand("grok", "linux"), "curl -fsSL https://x.ai/cli/install.sh | bash");
});
