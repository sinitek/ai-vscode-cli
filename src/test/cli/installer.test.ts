import assert = require("node:assert/strict");
import test = require("node:test");
import { CLI_LIST } from "../../cli/types";
import { getCliDisplayName, getCliInstallCommand } from "../../cli/installer";

test("every CLI group has an install command on Windows and Unix", () => {
  for (const cli of CLI_LIST) {
    assert.ok(getCliDisplayName(cli).trim());
    assert.ok(getCliInstallCommand(cli, "win32").trim(), cli + " needs a Windows install command");
    assert.ok(getCliInstallCommand(cli, "linux").trim(), cli + " needs a Unix install command");
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
  ]);
});

test("Grok uses the official installer for the current platform", () => {
  assert.equal(getCliInstallCommand("grok", "win32"), "irm https://x.ai/cli/install.ps1 | iex");
  assert.equal(getCliInstallCommand("grok", "darwin"), "curl -fsSL https://x.ai/cli/install.sh | bash");
  assert.equal(getCliInstallCommand("grok", "linux"), "curl -fsSL https://x.ai/cli/install.sh | bash");
});
