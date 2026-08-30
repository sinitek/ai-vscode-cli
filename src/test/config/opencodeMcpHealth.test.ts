import test = require("node:test");
import assert = require("node:assert/strict");

import {
  mapCliListedMcpHealth,
  parseOpenCodeMcpHealthOutput,
} from "../../config/mcpHealth";

test("parses OpenCode MCP list entries, ANSI colors, and multiline details", () => {
  const listed = parseOpenCodeMcpHealthOutput([
    "\u001B[36m┌  MCP Servers\u001B[0m",
    "│",
    "\u001B[32m●  ✓ context7 connected\u001B[0m",
    "│      npx -y @upstash/context7-mcp",
    "│",
    "\u001B[31m●  ✗ broken failed\u001B[0m",
    "│      Error: connection closed",
    "│      Command: /bin/echo mcp-smoke",
    "│        stderr: first line",
    "│          second line",
    "│      command failed",
    "│",
    "●  ? mystery unknown",
    "│      status unavailable",
    "│",
    "○  ! paused disabled",
    "│      disabled by config",
    "│",
    "└  4 server(s)",
  ].join("\n"));

  assert.equal(listed.size, 4);
  assert.deepEqual(listed.get("context7"), {
    enabled: true,
    status: "healthy",
    details: "connected\nnpx -y @upstash/context7-mcp",
    latencyMs: undefined,
  });
  assert.equal(listed.get("broken")?.enabled, true);
  assert.equal(listed.get("broken")?.status, "unhealthy");
  assert.match(listed.get("broken")?.details || "", /failed/);
  assert.match(listed.get("broken")?.details || "", /Error: connection closed/);
  assert.match(listed.get("broken")?.details || "", /Command: \/bin\/echo mcp-smoke/);
  assert.match(listed.get("broken")?.details || "", /stderr: first line\nsecond line/);
  assert.equal(listed.has("command"), false);
  assert.deepEqual(listed.get("mystery"), {
    enabled: true,
    status: "unknown",
    details: "unknown\nstatus unavailable",
    latencyMs: undefined,
  });
  assert.deepEqual(listed.get("paused"), {
    enabled: false,
    status: "unknown",
    details: "disabled\ndisabled by config",
    latencyMs: undefined,
  });
});

test("returns an empty map for empty or unrelated OpenCode output", () => {
  assert.equal(parseOpenCodeMcpHealthOutput("").size, 0);
  assert.equal(parseOpenCodeMcpHealthOutput("No MCP servers configured").size, 0);
});

test("marks listed failed marketplace servers installed and absent servers uninstalled", () => {
  const listed = parseOpenCodeMcpHealthOutput([
    "┌  MCP Servers",
    "│",
    "●  ✗ context7 failed",
    "│      SSE error: Unable to connect",
    "│      http://127.0.0.1:9/mcp",
    "│",
    "└  1 server(s)",
  ].join("\n"));
  const checkedAt = "2026-07-10T00:00:00.000Z";

  const health = mapCliListedMcpHealth(
    "opencode",
    [{ id: "context7" }, { id: "not-installed" }],
    listed,
    checkedAt,
  );

  assert.deepEqual(health[0], {
    platform: "opencode",
    serverId: "context7",
    installed: true,
    enabled: true,
    status: "unhealthy",
    checkedAt,
    details: "failed\nSSE error: Unable to connect\nhttp://127.0.0.1:9/mcp",
    latencyMs: undefined,
  });
  assert.deepEqual(health[1], {
    platform: "opencode",
    serverId: "not-installed",
    installed: false,
    enabled: false,
    status: "unknown",
    checkedAt,
    details: "未安装",
  });
});
