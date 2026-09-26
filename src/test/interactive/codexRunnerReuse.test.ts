import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const crossSpawn = require("cross-spawn") as {
  spawn: (...args: unknown[]) => unknown;
};

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killCalls: Array<NodeJS.Signals | number | undefined>;
  kill: (signal?: NodeJS.Signals | number) => boolean;
};

function createFakeChild(pid: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.kill = (signal?: NodeJS.Signals | number): boolean => {
    child.killCalls.push(signal);
    child.exitCode = null;
    child.signalCode = typeof signal === "string" ? signal : "SIGTERM";
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, child.signalCode);
    return true;
  };
  return child;
}

function loadCodexRunner(): typeof import("../../interactive/codexRunner") {
  delete require.cache[require.resolve("../../interactive/codexRunner")];
  return require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
}

function attachPersistentServer(child: FakeChild, methods: string[]): void {
  let input = "";
  let threadSeq = 0;
  let turnSeq = 0;
  const send = (message: Record<string, unknown>): void => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };
  child.stdin.on("data", (chunk: Buffer | string) => {
    input += String(chunk);
    const lines = input.split(/\r?\n/u);
    input = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const message = JSON.parse(trimmed) as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
      const method = String(message.method || "");
      if (method) {
        methods.push(method);
      }
      if (method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (method === "thread/start" || method === "thread/resume") {
        threadSeq += 1;
        const threadId = String(message.params?.threadId || `thread-${threadSeq}`);
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: threadId } } });
        continue;
      }
      if (method === "turn/start") {
        turnSeq += 1;
        const turnId = `turn-${turnSeq}`;
        const threadId = String(message.params?.threadId || "");
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId,
              turn: { id: turnId, status: "completed" },
            },
          });
        });
        continue;
      }
      if (method === "turn/interrupt") {
        const threadId = String(message.params?.threadId || "");
        const turnId = String(message.params?.turnId || "");
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId,
              turn: { id: turnId, status: "interrupted" },
            },
          });
        });
      }
    }
  });
}

test("Codex runner reuses one app-server connection and loaded thread", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const methods: string[] = [];
  const spawned: FakeChild[] = [];
  crossSpawn.spawn = (): unknown => {
    const child = createFakeChild(62000 + spawned.length);
    spawned.push(child);
    attachPersistentServer(child, methods);
    return child;
  };
  process.kill = (() => {
    throw new Error("no process group");
  }) as typeof process.kill;

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
      multiAgentEnabled: true,
    });
    const handlers = {
      onAssistantDelta: () => undefined,
      onTrace: () => undefined,
      onTaskListUpdate: () => undefined,
      onThreadId: () => undefined,
    };
    try {
      await runner.runStreamed("first", handlers);
      await runner.runStreamed("second", handlers);
      assert.equal(spawned.length, 1);
      assert.equal(methods.filter((method) => method === "initialize").length, 1);
      assert.equal(methods.filter((method) => method === "thread/start").length, 1);
      assert.equal(methods.filter((method) => method === "thread/resume").length, 0);
      assert.equal(methods.filter((method) => method === "turn/start").length, 2);
      assert.equal(runner.getThreadId(), "thread-1");
    } finally {
      runner.dispose();
    }
  } finally {
    process.kill = originalKill;
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runners share initialize and start one thread each", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const methods: string[] = [];
  const spawned: FakeChild[] = [];
  crossSpawn.spawn = (): unknown => {
    const child = createFakeChild(62100 + spawned.length);
    spawned.push(child);
    attachPersistentServer(child, methods);
    return child;
  };
  process.kill = (() => {
    throw new Error("no process group");
  }) as typeof process.kill;

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const first = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
      multiAgentEnabled: true,
    });
    const second = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
      multiAgentEnabled: true,
    });
    const handlers = {
      onAssistantDelta: () => undefined,
      onTrace: () => undefined,
      onTaskListUpdate: () => undefined,
      onThreadId: () => undefined,
    };
    try {
      await Promise.all([
        first.runStreamed("one", handlers),
        second.runStreamed("two", handlers),
      ]);
      assert.equal(spawned.length, 1);
      assert.equal(methods.filter((method) => method === "initialize").length, 1);
      assert.equal(methods.filter((method) => method === "thread/start").length, 2);
      assert.equal(methods.filter((method) => method === "turn/start").length, 2);
    } finally {
      first.dispose();
      second.dispose();
    }
  } finally {
    process.kill = originalKill;
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runner interrupts a loaded turn without killing the app-server", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const methods: string[] = [];
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];
  const child = createFakeChild(62200);
  let releaseTurn: (() => void) | null = null;
  const turnStarted = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  let input = "";
  const send = (message: Record<string, unknown>): void => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };
  child.stdin.on("data", (chunk: Buffer | string) => {
    input += String(chunk);
    const lines = input.split(/\r?\n/u);
    input = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const message = JSON.parse(trimmed) as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
      const method = String(message.method || "");
      if (method) {
        methods.push(method);
      }
      if (method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (method === "thread/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "thread-hot" } } });
        continue;
      }
      if (method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-hot", status: "inProgress" } } });
        releaseTurn?.();
        continue;
      }
      if (method === "turn/interrupt") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
      }
    }
  });
  crossSpawn.spawn = (): unknown => child;
  process.kill = ((pid: number, signal?: NodeJS.Signals | number): true => {
    killSignals.push(signal);
    if (pid === -child.pid! || pid === child.pid) {
      child.kill(typeof signal === "string" ? signal : "SIGTERM");
    }
    return true;
  }) as typeof process.kill;

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
      multiAgentEnabled: true,
    });
    const run = runner.runStreamed("stay", {
      onAssistantDelta: () => undefined,
      onTrace: () => undefined,
      onTaskListUpdate: () => undefined,
      onThreadId: () => undefined,
    });
    try {
      await turnStarted;
      runner.stopAndRebuild();
      await assert.rejects(run, /Codex run aborted/u);
      assert.equal(methods.includes("turn/interrupt"), true);
      assert.equal(killSignals.includes("SIGTERM"), false);
    } finally {
      runner.dispose();
    }
  } finally {
    process.kill = originalKill;
    crossSpawn.spawn = originalSpawn;
  }
});
