import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { test } from "node:test";

import {
  inspectCodeGraphStatus,
  isCodeGraphInstalledAndInteractive,
  isCodeGraphWorkspaceIndexed,
} from "../../cli/codegraphStatus";

function withTempHome<T>(run: (homeDir: string, workspaceRoot: string) => T): T {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-codegraph-home-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-codegraph-workspace-"));
  try {
    return run(homeDir, workspaceRoot);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("treats CodeGraph as not ready when CLI, MCP, and workspace index are missing", () => {
  withTempHome((homeDir, workspaceRoot) => {
    const status = inspectCodeGraphStatus({
      homeDir,
      workspaceRoot,
      env: {},
      resolveCommand: () => null,
    });
    assert.deepEqual(status, {
      cliInstalled: false,
      mcpConfigured: false,
      workspaceIndexed: false,
      ready: false,
    });
    assert.equal(isCodeGraphInstalledAndInteractive(workspaceRoot, {
      homeDir,
      env: {},
      resolveCommand: () => null,
    }), false);
  });
});

test("requires CLI, MCP interaction, and workspace index before checking ready", () => {
  withTempHome((homeDir, workspaceRoot) => {
    writeFile(path.join(homeDir, ".codex", "config.toml"), "[mcp_servers.codegraph]\ncommand = \"codegraph\"\n");
    const withMcpOnly = inspectCodeGraphStatus({
      homeDir,
      workspaceRoot,
      env: {},
      resolveCommand: () => ({ command: "/usr/bin/codegraph" }),
    });
    assert.equal(withMcpOnly.cliInstalled, true);
    assert.equal(withMcpOnly.mcpConfigured, true);
    assert.equal(withMcpOnly.workspaceIndexed, false);
    assert.equal(withMcpOnly.ready, false);

    fs.mkdirSync(path.join(workspaceRoot, ".codegraph"));
    assert.equal(isCodeGraphWorkspaceIndexed(workspaceRoot), true);
    const ready = inspectCodeGraphStatus({
      homeDir,
      workspaceRoot,
      env: {},
      resolveCommand: () => ({ command: "/usr/bin/codegraph" }),
    });
    assert.equal(ready.workspaceIndexed, true);
    assert.equal(ready.ready, true);
    assert.equal(isCodeGraphInstalledAndInteractive(workspaceRoot, {
      homeDir,
      env: {},
      resolveCommand: () => ({ command: "/usr/bin/codegraph" }),
    }), true);
  });
});

test("recognizes an existing workspace CodeGraph index independently of interactive setup", () => {
  withTempHome((homeDir, workspaceRoot) => {
    fs.mkdirSync(path.join(workspaceRoot, ".codegraph"));
    assert.equal(isCodeGraphWorkspaceIndexed(workspaceRoot), true);
    assert.equal(inspectCodeGraphStatus({
      homeDir,
      workspaceRoot,
      env: {},
      resolveCommand: () => null,
    }).ready, false);
  });
});

test("detects Claude or OpenCode MCP interaction configs", () => {
  withTempHome((homeDir, workspaceRoot) => {
    writeFile(path.join(homeDir, ".claude.json"), JSON.stringify({
      mcpServers: {
        codegraph: { type: "stdio", command: "codegraph" },
      },
    }));
    fs.mkdirSync(path.join(workspaceRoot, ".codegraph"));
    assert.equal(inspectCodeGraphStatus({
      homeDir,
      workspaceRoot,
      env: {},
      resolveCommand: () => ({ command: "/usr/bin/codegraph" }),
    }).ready, true);

    fs.rmSync(path.join(homeDir, ".claude.json"));
    writeFile(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
      mcp: {
        codegraph: {
          type: "local",
          command: ["codegraph", "serve", "--mcp"],
          enabled: false,
        },
      },
    }));
    assert.equal(inspectCodeGraphStatus({
      homeDir,
      workspaceRoot,
      env: {},
      resolveCommand: () => ({ command: "/usr/bin/codegraph" }),
    }).mcpConfigured, false);

    writeFile(path.join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
      mcp: {
        codegraph: {
          type: "local",
          command: ["codegraph", "serve", "--mcp"],
          enabled: true,
        },
      },
    }));
    assert.equal(inspectCodeGraphStatus({
      homeDir,
      workspaceRoot,
      env: {},
      resolveCommand: () => ({ command: "/usr/bin/codegraph" }),
    }).ready, true);
  });
});

test("never marks CodeGraph ready without an open workspace index", () => {
  withTempHome((homeDir) => {
    writeFile(path.join(homeDir, ".codex", "config.toml"), "[mcp_servers.codegraph]\ncommand = \"codegraph\"\n");
    assert.equal(inspectCodeGraphStatus({
      homeDir,
      workspaceRoot: null,
      env: {},
      resolveCommand: () => ({ command: "/usr/bin/codegraph" }),
    }).ready, false);
  });
});
