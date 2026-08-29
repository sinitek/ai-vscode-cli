import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const crossSpawn = require("cross-spawn") as {
  spawn: (...args: unknown[]) => unknown;
};

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => boolean;
};

function loadMcpService(): typeof import("../config/mcpService") {
  const configPathsModulePath = require.resolve("../config/configPaths");
  const openCodeModulePath = require.resolve("../config/openCodeMcpConfig");
  const mcpServiceModulePath = require.resolve("../config/mcpService");
  delete require.cache[configPathsModulePath];
  delete require.cache[openCodeModulePath];
  delete require.cache[mcpServiceModulePath];
  return require("../config/mcpService") as typeof import("../config/mcpService");
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

function installConfiguration(values: Record<string, unknown>): () => void {
  const vscode = require("vscode") as {
    workspace: {
      getConfiguration: () => {
        get: <T>(key: string, fallback?: T) => T | undefined;
      };
    };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] as T : fallback
    ),
  });
  return () => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  };
}

async function withTempHome<T>(
  run: (homeDir: string, env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-mcp-installed-"));
  const homeDir = path.join(tempRoot, "home");
  const xdgConfigHome = path.join(tempRoot, "xdg");
  const originalHome = process.env.HOME;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  try {
    process.env.HOME = homeDir;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    return await run(homeDir, process.env);
  } finally {
    process.env.HOME = originalHome;
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test("reads Claude MCP installation status from user config without health probing", async () => {
  await withTempHome(async (homeDir) => {
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(path.join(homeDir, ".claude.json"), JSON.stringify({
      mcpServers: {
        context7: { command: "npx" },
      },
      mcp: {
        sqlite: { command: "mcp-server-sqlite" },
      },
      mcp_servers: {
        docker: { command: "docker-mcp" },
      },
    }));

    const { getMcpInstalledServerIds } = loadMcpService();
    assert.deepEqual(await getMcpInstalledServerIds("claude"), ["context7", "docker", "sqlite"]);
  });
});

test("reads Codex MCP installation status from config.toml without invoking codex mcp list", async () => {
  await withTempHome(async (homeDir) => {
    const configDir = path.join(homeDir, ".codex");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, "config.toml"), [
      "[model]",
      'name = "gpt-5"',
      "",
      "[mcp_servers.context7]",
      'command = "npx"',
      "",
      "[mcp_servers.sqlite]",
      'command = "mcp-server-sqlite"',
      "",
    ].join("\n"));

    const { getMcpInstalledServerIds } = loadMcpService();
    assert.deepEqual(await getMcpInstalledServerIds("codex"), ["context7", "sqlite"]);
  });
});

test("invokes Codex MCP list with configured command parts", async () => {
  const restoreConfiguration = installConfiguration({
    "commands.codex": `"${process.execPath}" --profile mcp`,
  });
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  const spawnCalls: unknown[][] = [];
  crossSpawn.spawn = (...args: unknown[]): unknown => {
    spawnCalls.push(args);
    queueMicrotask(() => {
      child.stdout.emit("data", JSON.stringify([{ name: "context7" }]));
      child.emit("close", 0);
    });
    return child;
  };

  try {
    const { getCodexMcpServerIds } = loadMcpService();
    assert.deepEqual(await getCodexMcpServerIds(), ["context7"]);
    assert.equal(spawnCalls[0]?.[0], process.execPath);
    assert.deepEqual(spawnCalls[0]?.[1], ["--profile", "mcp", "mcp", "list", "--json"]);
  } finally {
    crossSpawn.spawn = originalSpawn;
    restoreConfiguration();
  }
});

test("reads OpenCode MCP installation status from official global opencode.json", async () => {
  await withTempHome(async (_homeDir, env) => {
    const configPath = path.join(String(env.XDG_CONFIG_HOME), "opencode", "opencode.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, `{
  // JSONC is accepted for OpenCode global MCP config.
  "mcp": {
    "context7": { "type": "local", "command": ["npx", "-y", "@upstash/context7-mcp"] },
    "linear": { "type": "remote", "url": "https://mcp.linear.app/mcp" },
  },
}
`);

    const { getMcpInstalledServerIds } = loadMcpService();
    assert.deepEqual(await getMcpInstalledServerIds("opencode"), ["context7", "linear"]);
  });
});
