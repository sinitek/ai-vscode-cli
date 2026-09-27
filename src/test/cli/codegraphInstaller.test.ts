import * as assert from "node:assert/strict";
import { test } from "node:test";

import { getCodeGraphInstallCommand, getCodeGraphInstallSteps } from "../../cli/installer";

const FULL_INSTALL = "npm install -g @colbymchenry/codegraph@latest && codegraph install --target codex --location global";

test("uses the full CodeGraph command when the CLI is not installed", () => {
  assert.deepEqual(getCodeGraphInstallSteps({ initializeWorkspace: true }), [
    "installCli",
    "registerMcp",
    "initWorkspace",
  ]);
  assert.equal(
    getCodeGraphInstallCommand({ initializeWorkspace: true, mcpConfigured: true }),
    `${FULL_INSTALL} && codegraph init`,
  );
});

test("skips workspace initialization when no workspace needs an index", () => {
  assert.equal(getCodeGraphInstallCommand(), FULL_INSTALL);
  assert.equal(
    getCodeGraphInstallCommand({ cliInstalled: false, initializeWorkspace: false }),
    FULL_INSTALL,
  );
});

test("registers MCP and initializes when the CLI is installed but MCP is missing", () => {
  assert.equal(
    getCodeGraphInstallCommand({
      cliInstalled: true,
      mcpConfigured: false,
      initializeWorkspace: true,
    }),
    "codegraph install --target codex --location global && codegraph init",
  );
  assert.equal(
    getCodeGraphInstallCommand({ cliInstalled: true, mcpConfigured: false }),
    "codegraph install --target codex --location global",
  );
});

test("initializes only the workspace when CodeGraph and MCP are already installed", () => {
  assert.deepEqual(
    getCodeGraphInstallSteps({
      cliInstalled: true,
      mcpConfigured: true,
      initializeWorkspace: true,
    }),
    ["initWorkspace"],
  );
  assert.equal(
    getCodeGraphInstallCommand({
      cliInstalled: true,
      mcpConfigured: true,
      initializeWorkspace: true,
    }),
    "codegraph init",
  );
});

test("returns no command when CodeGraph is already installed and no workspace needs initialization", () => {
  assert.deepEqual(
    getCodeGraphInstallSteps({ cliInstalled: true, mcpConfigured: true, initializeWorkspace: false }),
    [],
  );
  assert.equal(
    getCodeGraphInstallCommand({ cliInstalled: true, mcpConfigured: true }),
    "",
  );
});
