import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { installVscodeMock } from "../vscodeMock";
import {
  createCodexAppServerNdjsonReader,
  serializeCodexAppServerMessage,
} from "../../interactive/codexAppServerNdjson";

installVscodeMock();

const crossSpawn = require("cross-spawn") as {
  spawn: (...args: unknown[]) => unknown;
};

async function readLines(chunks: Array<Buffer | string>): Promise<string[]> {
  const stdout = new PassThrough();
  const reader = createCodexAppServerNdjsonReader(stdout);
  const lines: string[] = [];
  const done = (async () => {
    for await (const line of reader.lines) {
      lines.push(line);
    }
  })();
  for (const chunk of chunks) {
    stdout.write(chunk);
  }
  stdout.end();
  await done;
  return lines;
}

test("codex app-server NDJSON keeps unicode line separators inside JSON strings", async () => {
  const text = "第一行\u2028第二行\u2029结束\n仍在同一字符串";
  const message = {
    jsonrpc: "2.0",
    method: "item/agentMessage/delta",
    params: { delta: text },
  };
  const payload = `${JSON.stringify(message)}\n${JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: {} })}\n`;
  const splitAt = payload.indexOf("\u2028");
  const encoded = Buffer.from(payload, "utf8");
  const splitByte = Buffer.from(payload.slice(0, splitAt), "utf8").length + 1;
  const lines = await readLines([
    encoded.subarray(0, splitByte),
    encoded.subarray(splitByte),
  ]);

  assert.equal(lines.length, 2);
  const parsed = JSON.parse(lines[0]) as { params: { delta: string } };
  assert.equal(parsed.params.delta, text);
  assert.equal(JSON.parse(lines[1]).method, "turn/completed");
});

test("codex app-server NDJSON splits only on LF and CRLF", async () => {
  const lines = await readLines([
    '{"id":1}\r\n',
    '{"id":2}',
  ]);
  assert.deepEqual(lines.map((line) => JSON.parse(line).id), [1, 2]);
});

test("serializeCodexAppServerMessage escapes unicode line separators", () => {
  const serialized = serializeCodexAppServerMessage({
    text: "A\u2028B\u2029C\"\\",
  });
  assert.equal(serialized.includes("\u2028"), false);
  assert.equal(serialized.includes("\u2029"), false);
  assert.equal(serialized.endsWith("\n"), true);
  assert.equal(JSON.parse(serialized).text, "A\u2028B\u2029C\"\\");
});

test("Codex runner accepts app-server messages that contain unicode line separators", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    pid: number;
    kill: () => boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 4242;
  child.kill = () => true;

  let input = "";
  const send = (message: Record<string, unknown>): void => {
    const json = JSON.stringify(message).replace("PLACEHOLDER", "思考\u2028继续\u2029完成");
    child.stdout.write(`${json}\n`);
  };
  child.stdin.on("data", (chunk: Buffer | string) => {
    input += String(chunk);
    const lines = input.split(/\r?\n/u);
    input = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line) as { id?: unknown; method?: unknown; params?: { threadId?: string } };
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
      } else if (message.method === "thread/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "thread-1" } } });
      } else if (message.method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-1", status: "inProgress" } } });
        send({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "message-1",
            delta: "PLACEHOLDER",
            phase: "final_answer",
          },
        });
        send({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } },
        });
        setImmediate(() => {
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0, null);
        });
      }
    }
  });

  crossSpawn.spawn = () => child;
  const deltas: string[] = [];
  try {
    delete require.cache[require.resolve("../../interactive/codexRunner")];
    const { CodexInteractiveRunner } = require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
      multiAgentEnabled: false,
    });
    await runner.runStreamed("第一行\u2028第二行", {
      onAssistantDelta: (chunk) => deltas.push(chunk),
      onTrace: () => undefined,
      onTaskListUpdate: () => undefined,
      onThreadId: () => undefined,
    });
    runner.dispose();
  } finally {
    crossSpawn.spawn = originalSpawn;
  }

  assert.equal(deltas.join(""), "思考\u2028继续\u2029完成");
});
