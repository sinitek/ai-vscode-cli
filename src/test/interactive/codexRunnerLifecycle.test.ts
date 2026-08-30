import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const crossSpawn = require("cross-spawn") as {
  spawn: (...args: unknown[]) => unknown;
};

const PROVIDER_CAPTURE_APP_SERVER = `#!/usr/bin/env node
const fs = require("fs");
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/resume") {
    fs.writeFileSync(process.env.CODEX_THREAD_REQUEST_LOG, JSON.stringify(message.params));
    send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: message.params.threadId } } });
    return;
  }
  if (message.method !== "turn/start") {
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } });
  setImmediate(() => {
    send({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { threadId: message.params.threadId, turnId: "turn-1", itemId: "message-1", delta: "done", phase: "final_answer" },
    });
    send({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { threadId: message.params.threadId, turn: { id: "turn-1", status: "completed", items: [] } },
    });
  });
});
`;

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

function loadCodexRunner(): typeof import("../../interactive/codexRunner") {
  delete require.cache[require.resolve("../../interactive/codexRunner")];
  return require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
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

test("Codex runner resumes the mapped thread with the active TOML model provider", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-runner-"));
  const commandPath = path.join(tempDir, "mock-codex");
  const codexHomeDir = path.join(tempDir, "codex-home");
  const requestLogPath = path.join(tempDir, "thread-request.json");
  const previousCodexHomeDir = process.env.CODEX_HOME_DIR;
  const previousRequestLog = process.env.CODEX_THREAD_REQUEST_LOG;
  fs.mkdirSync(codexHomeDir, { recursive: true });
  fs.writeFileSync(commandPath, PROVIDER_CAPTURE_APP_SERVER, "utf8");
  fs.chmodSync(commandPath, 0o755);
  fs.writeFileSync(path.join(codexHomeDir, "config.toml"), [
    'model_provider = "gateway-b"',
    'model = "gpt-5.6"',
  ].join("\n"));
  process.env.CODEX_HOME_DIR = codexHomeDir;
  process.env.CODEX_THREAD_REQUEST_LOG = requestLogPath;

  const { CodexInteractiveRunner } = loadCodexRunner();
  const runner = new CodexInteractiveRunner({
    command: commandPath,
    args: [],
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: "gpt-5.6",
    threadId: "thread-before-provider-switch",
    multiAgentEnabled: true,
  });

  try {
    await runner.runStreamed("continue", createHandlers());

    assert.deepEqual(JSON.parse(fs.readFileSync(requestLogPath, "utf8")), {
      threadId: "thread-before-provider-switch",
      sandbox: "workspace-write",
      config: { agents: { job_max_runtime_seconds: 86400 } },
      experimentalRawEvents: false,
      model: "gpt-5.6",
      modelProvider: "gateway-b",
    });
  } finally {
    runner.dispose();
    if (previousCodexHomeDir === undefined) {
      delete process.env.CODEX_HOME_DIR;
    } else {
      process.env.CODEX_HOME_DIR = previousCodexHomeDir;
    }
    if (previousRequestLog === undefined) {
      delete process.env.CODEX_THREAD_REQUEST_LOG;
    } else {
      process.env.CODEX_THREAD_REQUEST_LOG = previousRequestLog;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
