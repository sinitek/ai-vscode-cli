import test = require("node:test");
import assert = require("node:assert/strict");

import {
  createOpenCodeSubagentMonitor,
  consumeOpenCodeSseChunk,
  extractOpenCodeSubagentMessageSnapshot,
  getOpenCodeSubagentReconnectDelayMs,
  OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
  parseOpenCodeChildSessions,
  resolveOpenCodeSubagentConnection,
  waitForOpenCodeServerReady,
} from "../../cli/openCodeSubagentMonitor";

test("polls current-attempt child sessions on a 60-second interval", async () => {
  const intervalDelays: number[] = [];
  const updates: Array<{ id: string; status?: string; text?: string }> = [];
  const now = Date.now();
  const monitor = createOpenCodeSubagentMonitor({
    connection: { serverUrl: "http://127.0.0.1:4200" },
    directory: "/repo",
    scheduler: {
      setInterval: (_callback, delayMs) => {
        intervalDelays.push(delayMs);
        return { type: "interval" };
      },
      clearInterval: () => {},
      setTimeout: () => ({ type: "timeout" }),
      clearTimeout: () => {},
    },
    subscribeEvents: () => ({ dispose: () => {} }),
    requestJson: async (pathname) => {
      if (pathname.endsWith("/children")) {
        return [
          { id: "old-child", parentID: "parent", time: { created: now - 60_000 } },
          { id: "new-child", parentID: "parent", agent: "explore", time: { created: now } },
        ];
      }
      if (pathname === "/session/status") {
        return { "new-child": { type: "busy" } };
      }
      if (pathname.includes("new-child")) {
        return [{
          info: { role: "assistant", time: { created: now } },
          parts: [{ type: "text", text: "live child text" }],
        }];
      }
      assert.fail(`unexpected path: ${pathname}`);
    },
    onUpdate: (update) => updates.push(update),
  });

  monitor.setParentSessionId("parent");
  await monitor.pollNow();

  assert.deepEqual(intervalDelays, [OPENCODE_SUBAGENT_POLL_INTERVAL_MS]);
  assert.equal(updates.some((update) => update.id === "old-child"), false);
  const lastUpdate = updates[updates.length - 1];
  assert.equal(lastUpdate?.id, "new-child");
  assert.equal(lastUpdate?.status, "running");
  assert.equal(lastUpdate?.text, "live child text");
  monitor.dispose();
});

test("ignores parent text events and refreshes only known child sessions", async () => {
  let onEvent: ((event: unknown) => void) | null = null;
  const scheduledTimeouts: Array<() => void> = [];
  const now = Date.now();
  const monitor = createOpenCodeSubagentMonitor({
    connection: { serverUrl: "http://127.0.0.1:4200" },
    directory: "/repo",
    scheduler: {
      setInterval: () => ({ type: "interval" }),
      clearInterval: () => {},
      setTimeout: (callback) => {
        scheduledTimeouts.push(callback);
        return { type: "timeout" };
      },
      clearTimeout: () => {},
    },
    subscribeEvents: (options) => {
      onEvent = options.onEvent;
      return { dispose: () => {} };
    },
    requestJson: async (pathname) => {
      if (pathname.endsWith("/children")) {
        return [{ id: "child", parentID: "parent", time: { created: now } }];
      }
      if (pathname === "/session/status") {
        return { child: { type: "busy" } };
      }
      return [];
    },
    onUpdate: () => {},
  });

  monitor.setParentSessionId("parent");
  await monitor.pollNow();
  assert.ok(onEvent);

  const dispatchEvent = onEvent as (event: unknown) => void;
  dispatchEvent({
    type: "message.part.updated",
    properties: { part: { sessionID: "parent", type: "text", text: "parent" } },
  });
  assert.equal(scheduledTimeouts.length, 0);

  dispatchEvent({
    type: "message.part.updated",
    properties: { part: { sessionID: "child", type: "text", text: "child" } },
  });
  assert.equal(scheduledTimeouts.length, 1);
  monitor.dispose();
});

test("resolves attached, configured-port, and reserved OpenCode monitor endpoints", async () => {
  assert.deepEqual(
    await resolveOpenCodeSubagentConnection(["run", "--attach", "http://localhost:4096/"]),
    { serverUrl: "http://localhost:4096", authorization: undefined },
  );
  assert.deepEqual(
    await resolveOpenCodeSubagentConnection(["run", "--port=4100"]),
    { serverUrl: "http://127.0.0.1:4100", serverPort: 4100, authorization: undefined },
  );
  assert.deepEqual(
    await resolveOpenCodeSubagentConnection([], { reservePort: async () => 4200 }),
    { serverUrl: "http://127.0.0.1:4200", serverPort: 4200, authorization: undefined },
  );
  assert.equal(OPENCODE_SUBAGENT_POLL_INTERVAL_MS, 60_000);
});

test("waits for the managed OpenCode server health endpoint", async () => {
  let attempts = 0;
  let clock = 0;
  const delays: number[] = [];
  await waitForOpenCodeServerReady(
    { serverUrl: "http://127.0.0.1:4200", serverPort: 4200 },
    "/repo",
    {
      timeoutMs: 500,
      pollIntervalMs: 100,
      now: () => clock,
      delay: async (delayMs) => {
        delays.push(delayMs);
        clock += delayMs;
      },
      requestHealth: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("connect ECONNREFUSED");
        }
        return { healthy: true, version: "1.17.18" };
      },
    },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 100]);
});

test("uses bounded exponential backoff for OpenCode event reconnects", () => {
  assert.equal(getOpenCodeSubagentReconnectDelayMs(1), 1000);
  assert.equal(getOpenCodeSubagentReconnectDelayMs(2), 2000);
  assert.equal(getOpenCodeSubagentReconnectDelayMs(6), 32_000);
  assert.equal(getOpenCodeSubagentReconnectDelayMs(7), 60_000);
  assert.equal(getOpenCodeSubagentReconnectDelayMs(20), 60_000);
});

test("parses only direct OpenCode child sessions", () => {
  assert.deepEqual(parseOpenCodeChildSessions([
    { id: "child-a", parentID: "parent", agent: "explore" },
    { id: "child-b", parent_id: "other", agent: "review" },
    { parentID: "parent" },
  ], "parent"), [{
    id: "child-a",
    parentId: "parent",
    agentName: "explore",
    createdAt: null,
  }]);
});

test("extracts visible assistant text without user prompts or tool payloads", () => {
  assert.deepEqual(extractOpenCodeSubagentMessageSnapshot([
    {
      info: { role: "user", time: { created: 1 } },
      parts: [{ type: "text", text: "private child prompt" }],
    },
    {
      info: { role: "assistant", time: { created: 2, completed: 3 } },
      parts: [
        { type: "tool", tool: "read", state: { output: "tool output" } },
        { type: "text", text: " first result " },
      ],
    },
    {
      info: { role: "assistant", time: { created: 4 } },
      parts: [{ type: "text", text: "second result" }],
    },
  ]), {
    text: "first result\n\nsecond result",
    hasCompletedAssistantMessage: false,
  });
});

test("buffers partial SSE frames and ignores malformed payloads", () => {
  const first = consumeOpenCodeSseChunk("", "data: {\"type\":\"server.connected\"}\n\ndata: {\"type\":");
  assert.deepEqual(first.events, [{ type: "server.connected" }]);
  const second = consumeOpenCodeSseChunk(
    first.buffer,
    "\"session.idle\",\"properties\":{\"sessionID\":\"child\"}}\n\ndata: nope\n\n",
  );
  assert.deepEqual(second.events, [{ type: "session.idle", properties: { sessionID: "child" } }]);
  assert.equal(second.buffer, "");
});
