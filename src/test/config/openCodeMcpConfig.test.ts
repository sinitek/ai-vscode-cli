import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  installOpenCodeMcpConfig,
  resolveOpenCodeGlobalConfigPath,
  uninstallOpenCodeMcpConfig,
} from "../config/openCodeMcpConfig";
import { McpMarketplaceItem } from "../config/types";

async function withTempDir(run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-opencode-mcp-"));
  try {
    await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function createMarketplaceItem(
  config: McpMarketplaceItem["config"],
  id = "context7",
): McpMarketplaceItem {
  return {
    id,
    name: id,
    description: "Test MCP",
    homepage: "https://example.test",
    category: "test",
    config,
  };
}

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

test("installs a local MCP into JSONC while preserving other config and servers", async () => {
  await withTempDir(async (homeDir) => {
    const configPath = resolveOpenCodeGlobalConfigPath({ env: {}, homeDir });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, `{
  // User settings must survive MCP updates.
  "$schema": "https://opencode.ai/config.json",
  "theme": "system",
  "mcp": {
    "existing": {
      "type": "remote",
      "url": "https://existing.example/mcp",
      "enabled": false,
    },
  },
}
`, "utf8");

    const result = await installOpenCodeMcpConfig(createMarketplaceItem({
      command: "node",
      args: ["server.js", "--flag"],
      env: {
        TEMPLATE_TOKEN: "<YOUR_TOKEN>",
        ACTIVE_TOKEN: "default-token",
      },
    }), {
      ACTIVE_TOKEN: "override-token",
    }, {
      env: {},
      homeDir,
    });

    assert.equal(result.configPath, configPath);
    assert.deepEqual(result.warnings, [
      "MCP context7: skipped template env TEMPLATE_TOKEN.",
    ]);
    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(saved.$schema, "https://opencode.ai/config.json");
    assert.equal(saved.theme, "system");
    assert.equal(saved.mcp.existing.enabled, false);
    assert.deepEqual(saved.mcp.context7, {
      type: "local",
      command: ["node", "server.js", "--flag"],
      environment: {
        ACTIVE_TOKEN: "override-token",
      },
      enabled: true,
    });
  });
});

test("installs and overwrites a remote MCP under a custom XDG config root", async () => {
  await withTempDir(async (tempDir) => {
    const xdgConfigHome = path.join(tempDir, "xdg");
    const options = {
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      homeDir: path.join(tempDir, "home"),
    };
    const configPath = resolveOpenCodeGlobalConfigPath(options);

    await installOpenCodeMcpConfig(createMarketplaceItem({
      command: "first-command",
    }, "remote-docs"), undefined, options);
    await installOpenCodeMcpConfig(createMarketplaceItem({
      type: "sse",
      url: "https://remote.example/mcp",
      headers: {
        Authorization: "Bearer ${MCP_TOKEN}",
        "X-Trace": "trace-value",
      },
    }, "remote-docs"), undefined, options);

    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.deepEqual(saved.mcp["remote-docs"], {
      type: "remote",
      url: "https://remote.example/mcp",
      headers: {
        Authorization: "Bearer ${MCP_TOKEN}",
        "X-Trace": "trace-value",
      },
      enabled: true,
    });
  });
});

test("uninstalls only the requested MCP and is idempotent when absent", async () => {
  await withTempDir(async (homeDir) => {
    const options = { env: {}, homeDir };
    const configPath = resolveOpenCodeGlobalConfigPath(options);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      model: "provider/model",
      mcp: {
        removeMe: { type: "local", command: ["node"], enabled: true },
        keepMe: { type: "remote", url: "https://keep.example/mcp", enabled: true },
      },
    }, null, 2), "utf8");

    const removed = await uninstallOpenCodeMcpConfig("removeMe", options);
    assert.equal(removed.changed, true);
    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(saved.model, "provider/model");
    assert.equal(Object.prototype.hasOwnProperty.call(saved.mcp, "removeMe"), false);
    assert.equal(saved.mcp.keepMe.url, "https://keep.example/mcp");

    const absent = await uninstallOpenCodeMcpConfig("missing", options);
    assert.equal(absent.changed, false);
  });
});

test("does not overwrite an invalid OpenCode config", async () => {
  await withTempDir(async (homeDir) => {
    const options = { env: {}, homeDir };
    const configPath = resolveOpenCodeGlobalConfigPath(options);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const invalidContent = "{ invalid json";
    await fs.writeFile(configPath, invalidContent, "utf8");

    await assert.rejects(
      installOpenCodeMcpConfig(createMarketplaceItem({ command: "node" }), undefined, options),
      /Unable to parse OpenCode config/,
    );
    assert.equal(await fs.readFile(configPath, "utf8"), invalidContent);
  });
});

test("rejects a non-object OpenCode config root without changing the file", async () => {
  await withTempDir(async (homeDir) => {
    const options = { env: {}, homeDir };
    const configPath = resolveOpenCodeGlobalConfigPath(options);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const originalContent = "[\n  { \"mcp\": {} }\n]\n";
    await fs.writeFile(configPath, originalContent, "utf8");

    await assert.rejects(
      installOpenCodeMcpConfig(createMarketplaceItem({ command: "node" }), undefined, options),
      /OpenCode config root must be a JSON object/,
    );
    assert.equal(await fs.readFile(configPath, "utf8"), originalContent);
  });
});

test("rejects a non-object mcp section without changing the file", async () => {
  await withTempDir(async (homeDir) => {
    const options = { env: {}, homeDir };
    const configPath = resolveOpenCodeGlobalConfigPath(options);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const originalContent = JSON.stringify({ mcp: [] }, null, 2);
    await fs.writeFile(configPath, originalContent, "utf8");

    await assert.rejects(
      installOpenCodeMcpConfig(createMarketplaceItem({ command: "node" }), undefined, options),
      /field "mcp" must be a JSON object/,
    );
    assert.equal(await fs.readFile(configPath, "utf8"), originalContent);
  });
});
