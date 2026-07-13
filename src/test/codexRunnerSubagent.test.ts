import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const { CodexInteractiveRunner } = require("../interactive/codexRunner") as typeof import("../interactive/codexRunner");

const MOCK_APP_SERVER = `#!/usr/bin/env node
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/start" || message.method === "thread/resume") {
    send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
    return;
  }
  if (message.method !== "turn/start") {
    return;
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    result: { turn: { id: "parent-turn", status: "inProgress", items: [] } },
  });
  setImmediate(() => {
    send({
      jsonrpc: "2.0",
      method: "thread/started",
      params: { thread: { id: "child-thread" } },
    });
    send({
      jsonrpc: "2.0",
      method: "item/started",
      params: {
        threadId: "parent-thread",
        turnId: "parent-turn",
        startedAtMs: 1,
        item: {
          id: "collab-1",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "inProgress",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: { "child-thread": { status: "running" } },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        itemId: "child-message",
        delta: "child text",
      },
    });
    send({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        item: { id: "child-message", type: "agentMessage", text: "child text" },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId: "child-thread",
        turn: { id: "child-turn", status: "completed", items: [] },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: {
        threadId: "parent-thread",
        turnId: "parent-turn",
        itemId: "parent-message",
        delta: "parent final",
        phase: "final_answer",
      },
    });
    send({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId: "parent-thread",
        turnId: "parent-turn",
        item: {
          id: "parent-message",
          type: "agentMessage",
          text: "parent final",
          phase: "final_answer",
        },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId: "parent-thread",
        turn: { id: "parent-turn", status: "completed", items: [] },
      },
    });
  });
});
`;

test("Codex runner streams child bubbles without completing or replacing the parent thread", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-subagent-runner-"));
  const commandPath = path.join(tempDir, "mock-codex");
  fs.writeFileSync(commandPath, MOCK_APP_SERVER, "utf8");
  fs.chmodSync(commandPath, 0o755);

  const parentChunks: string[] = [];
  const threadIds: string[] = [];
  const subagentUpdates: Array<{ status: string; delta?: string }> = [];
  const runner = new CodexInteractiveRunner({
    command: commandPath,
    args: [],
    thinkingMode: "medium",
    interactiveMode: "coding",
    threadId: null,
    multiAgentEnabled: true,
  });

  try {
    await runner.runStreamed("test", {
      onAssistantDelta: (chunk) => parentChunks.push(chunk),
      onSubagentUpdate: (update) => subagentUpdates.push(update),
      onTrace: () => {},
      onTaskListUpdate: () => {},
      onThreadId: (threadId) => threadIds.push(threadId),
    });

    assert.equal(parentChunks.join(""), "parent final");
    assert.deepEqual(threadIds, ["parent-thread"]);
    assert.equal(runner.getThreadId(), "parent-thread");
    assert.equal(
      subagentUpdates.filter((update) => update.delta).map((update) => update.delta).join(""),
      "child text",
    );
    assert.equal(subagentUpdates.some((update) => update.status === "completed"), true);
  } finally {
    runner.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
