import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildClaudeMcpInstallArgs,
  buildCodexMcpInstallArgs,
  buildOpenCodeMcpInstallArgs,
  parseCodexMcpServerIds,
} from "../../config/mcpInstallArgs";
import {
  parseClaudeMcpHealthOutput,
  parseGeminiMcpHealthOutput as parseLegacyGeminiMcpHealthOutput,
  parseInstalledCodexMcpServer,
} from "../../config/mcpHealth";
import { McpMarketplaceItem } from "../../config/types";

function createMarketplaceItem(overrides: Partial<McpMarketplaceItem> = {}): McpMarketplaceItem {
  return {
    id: "context7",
    name: "Context7",
    description: "Docs MCP",
    homepage: "https://example.com/context7",
    category: "docs",
    config: {
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: {
        CONTEXT7_API_KEY: "<YOUR_CONTEXT7_API_KEY>",
        ACTIVE_TOKEN: "default-token",
      },
    },
    ...overrides,
  };
}

test("builds Codex stdio install args and skips placeholder env values", () => {
  const result = buildCodexMcpInstallArgs(createMarketplaceItem(), {
    CONTEXT7_API_KEY: "override-token",
  });

  assert.deepEqual(result.commandArgs, [
    "mcp",
    "add",
    "context7",
    "--env",
    "CONTEXT7_API_KEY=override-token",
    "--env",
    "ACTIVE_TOKEN=default-token",
    "--",
    "npx",
    "-y",
    "@upstash/context7-mcp",
  ]);
  assert.deepEqual(result.warnings, []);
});

test("builds Codex HTTP install args with bearer token env var", () => {
  const result = buildCodexMcpInstallArgs(createMarketplaceItem({
    config: {
      type: "http",
      url: "https://mcp.example.test",
      headers: {
        Authorization: "Bearer $MCP_TOKEN",
        "X-Trace": "unsupported",
      },
    },
  }));

  assert.deepEqual(result.commandArgs, [
    "mcp",
    "add",
    "context7",
    "--url",
    "https://mcp.example.test",
    "--bearer-token-env-var",
    "MCP_TOKEN",
  ]);
  assert.deepEqual(result.warnings, [
    "MCP context7: custom headers are not supported by codex mcp add (X-Trace).",
  ]);
});

test("builds Claude sse install args without changing its CLI format", () => {
  const httpItem = createMarketplaceItem({
    config: {
      type: "sse",
      url: "https://mcp.example.test/sse",
      headers: { Authorization: "Bearer ${MCP_TOKEN}" },
    },
  });

  assert.deepEqual(buildClaudeMcpInstallArgs(httpItem).commandArgs, [
    "mcp",
    "add",
    "--scope",
    "user",
    "--transport",
    "sse",
    "context7",
    "--header",
    "Authorization: Bearer ${MCP_TOKEN}",
    "https://mcp.example.test/sse",
  ]);
});

test("builds OpenCode local args with env flags and command separator in order", () => {
  const result = buildOpenCodeMcpInstallArgs(createMarketplaceItem({
    config: {
      command: "node",
      args: ["server.js", "--label", "value with spaces", "--mapping=a:b=c"],
      env: {
        PLACEHOLDER: "<YOUR_TOKEN>",
        ACTIVE_TOKEN: "default-token",
        COMPLEX_VALUE: "left=right with spaces:ok",
      },
    },
  }), {
    ACTIVE_TOKEN: "runtime=token with spaces:ok",
  });

  assert.deepEqual(result.commandArgs, [
    "mcp",
    "add",
    "context7",
    "--env",
    "ACTIVE_TOKEN=runtime=token with spaces:ok",
    "--env",
    "COMPLEX_VALUE=left=right with spaces:ok",
    "--",
    "node",
    "server.js",
    "--label",
    "value with spaces",
    "--mapping=a:b=c",
  ]);
  assert.deepEqual(result.warnings, ["MCP context7: skipped template env PLACEHOLDER."]);
  assert.equal(result.commandArgs.includes("--scope"), false);
  assert.equal(result.commandArgs.includes("--transport"), false);
});

test("builds OpenCode remote args for sse using url and KEY=VALUE headers", () => {
  const result = buildOpenCodeMcpInstallArgs(createMarketplaceItem({
    config: {
      type: "sse",
      url: "https://mcp.example.test/sse",
      headers: {
        Authorization: "Bearer token=one two:three",
        "X-Trace": "trace=value: with spaces",
      },
    },
  }));

  assert.deepEqual(result.commandArgs, [
    "mcp",
    "add",
    "context7",
    "--url",
    "https://mcp.example.test/sse",
    "--header",
    "Authorization=Bearer token=one two:three",
    "--header",
    "X-Trace=trace=value: with spaces",
  ]);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.commandArgs.includes("--scope"), false);
  assert.equal(result.commandArgs.includes("--transport"), false);
  assert.equal(result.commandArgs.includes("sse"), false);
});

test("treats an OpenCode config with url as remote even without a remote type", () => {
  assert.deepEqual(buildOpenCodeMcpInstallArgs(createMarketplaceItem({
    config: {
      type: "http",
      url: "https://mcp.example.test/http",
    },
  })).commandArgs, [
    "mcp",
    "add",
    "context7",
    "--url",
    "https://mcp.example.test/http",
  ]);

  assert.deepEqual(buildOpenCodeMcpInstallArgs(createMarketplaceItem({
    config: {
      url: "https://mcp.example.test/by-url",
    },
  })).commandArgs, [
    "mcp",
    "add",
    "context7",
    "--url",
    "https://mcp.example.test/by-url",
  ]);
});

test("rejects OpenCode local configs without command and remote configs without url", () => {
  assert.throws(
    () => buildOpenCodeMcpInstallArgs(createMarketplaceItem({ config: {} })),
    /MCP context7 is missing command\./,
  );
  assert.throws(
    () => buildOpenCodeMcpInstallArgs(createMarketplaceItem({ config: { type: "http" } })),
    /MCP context7 is missing remote url\./,
  );
  assert.throws(
    () => buildOpenCodeMcpInstallArgs(createMarketplaceItem({ config: { type: "sse" } })),
    /MCP context7 is missing remote url\./,
  );
});

test("parses Codex MCP server ids from list JSON", () => {
  assert.deepEqual(
    parseCodexMcpServerIds(JSON.stringify([
      { name: "zeta" },
      { name: " alpha " },
      { id: "ignored" },
      null,
    ])),
    ["alpha", "zeta"],
  );
  assert.throws(() => parseCodexMcpServerIds("{}"), /Invalid codex mcp list output/);
});

test("normalizes installed Codex MCP server transports", () => {
  assert.deepEqual(parseInstalledCodexMcpServer({
    name: "context7",
    enabled: false,
    disabled_reason: "manual",
    startup_timeout_sec: 3,
    tool_timeout_sec: 7,
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: { ACTIVE_TOKEN: "runtime-token" },
      env_vars: ["ACTIVE_TOKEN"],
      cwd: "/tmp/project",
    },
  }), {
    serverId: "context7",
    enabled: false,
    disabledReason: "manual",
    startupTimeoutSec: 3,
    toolTimeoutSec: 7,
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: { ACTIVE_TOKEN: "runtime-token" },
      envVars: ["ACTIVE_TOKEN"],
      cwd: "/tmp/project",
    },
  });

  assert.deepEqual(parseInstalledCodexMcpServer({
    name: "remote",
    transport: {
      type: "streamable_http",
      commandOrUrl: "https://mcp.example.test",
      headers: { "X-Trace": "1" },
      bearer_token_env_var: "MCP_TOKEN",
    },
  }), {
    serverId: "remote",
    enabled: true,
    disabledReason: undefined,
    startupTimeoutSec: undefined,
    toolTimeoutSec: undefined,
    transport: {
      type: "http",
      protocol: "streamable_http",
      url: "https://mcp.example.test",
      headers: { "X-Trace": "1" },
      bearerTokenEnvVar: "MCP_TOKEN",
    },
  });
});

test("parses Claude MCP health output and legacy OpenCode-compatible health format", () => {
  const claude = parseClaudeMcpHealthOutput([
    "\u001B[32mcontext7: npx - Connected\u001B[0m",
    "broken: npx - Failed to connect",
  ].join("\n"));
  assert.equal(claude.get("context7")?.status, "healthy");
  assert.equal(claude.get("broken")?.status, "unhealthy");

  const legacyOpenCode = parseLegacyGeminiMcpHealthOutput([
    "✓ context7: npx - Connected",
    "✗ broken: npx - Timeout",
  ].join("\n"));
  assert.equal(legacyOpenCode.get("context7")?.status, "healthy");
  assert.equal(legacyOpenCode.get("broken")?.status, "unhealthy");
});
