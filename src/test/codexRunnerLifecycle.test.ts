import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { installVscodeMock } from "./vscodeMock";

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

function createFakeChild(pid?: number): FakeChild {
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
    return true;
  };
  return child;
}

function createHandlers(events: unknown[] = []) {
  return {
    onAssistantDelta: () => undefined,
    onTrace: () => undefined,
    onTaskListUpdate: () => undefined,
    onThreadId: () => undefined,
    onEvent: (event: unknown) => events.push(event),
  };
}

function loadCodexRunner(): typeof import("../interactive/codexRunner") {
  delete require.cache[require.resolve("../interactive/codexRunner")];
  return require("../interactive/codexRunner") as typeof import("../interactive/codexRunner");
}

async function waitForSpawnCount(spawned: FakeChild[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawned.length >= count) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(spawned.length, count);
}

test("Codex runner reports EAGAIN spawn errors without hanging", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  const events: unknown[] = [];
  crossSpawn.spawn = (): unknown => {
    queueMicrotask(() => {
      const error = new Error("spawn /mock/codex EAGAIN") as NodeJS.ErrnoException;
      error.code = "EAGAIN";
      error.path = "/mock/codex";
      error.syscall = "spawn";
      child.emit("error", error);
    });
    return child;
  };

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

    await assert.rejects(
      runner.runStreamed("prompt", createHandlers(events)),
      /operating system refused to create another process|EAGAIN/u,
    );
    assert.equal(
      events.some((event) => (
        Boolean(event)
        && typeof event === "object"
        && (event as { event?: unknown }).event === "spawn_error"
      )),
      true,
    );
    runner.dispose();
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runner stop requests shutdown for every active app-server child", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const spawned: FakeChild[] = [];
  const killCalls: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];

  crossSpawn.spawn = (): unknown => {
    const child = createFakeChild(61000 + spawned.length);
    spawned.push(child);
    return child;
  };
  process.kill = ((pid: number, signal?: NodeJS.Signals | number): true => {
    killCalls.push({ pid, signal });
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

    const firstRun = runner.runStreamed("first", createHandlers()).catch((error: Error) => error);
    const secondRun = runner.runStreamed("second", createHandlers()).catch((error: Error) => error);
    await waitForSpawnCount(spawned, 2);

    runner.stopAndRebuild();

    assert.deepEqual(
      killCalls.filter((call) => call.signal === "SIGTERM").map((call) => call.pid),
      [-61000, -61001],
    );

    for (const child of spawned) {
      child.signalCode = "SIGTERM";
      child.stdout.end();
      child.stderr.end();
      child.emit("close", null, "SIGTERM");
    }

    const results = await Promise.all([firstRun, secondRun]);
    assert.equal(results.every((result) => result instanceof Error), true);
    runner.dispose();
  } finally {
    process.kill = originalKill;
    crossSpawn.spawn = originalSpawn;
  }
});
