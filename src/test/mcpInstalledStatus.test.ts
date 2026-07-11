import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

function loadMcpService(): typeof import("../config/mcpService") {
  const openCodeModulePath = require.resolve("../config/openCodeMcpConfig");
  const mcpServiceModulePath = require.resolve("../config/mcpService");
  delete require.cache[openCodeModulePath];
  delete require.cache[mcpServiceModulePath];
  return require("../config/mcpService") as typeof import("../config/mcpService");
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
