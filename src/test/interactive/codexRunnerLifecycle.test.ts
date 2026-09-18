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

function attachTurnStatusAppServer(child: FakeChild, status: string): void {
  let input = "";
  const send = (message: Record<string, unknown>): void => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const close = (): void => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
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
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start" || message.method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "parent-turn", status: "inProgress" } } });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId: "parent-thread",
              turn: { id: "parent-turn", status },
            },
          });
          setImmediate(close);
        });
      }
    }
  });
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

function attachAgentMessageTurnAppServer(
  child: FakeChild,
  item: Record<string, unknown>,
): void {
  let input = "";
  const send = (message: Record<string, unknown>): void => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const close = (): void => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
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
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start" || message.method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "parent-turn", status: "inProgress" } } });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            method: "item/completed",
            params: {
              threadId: "parent-thread",
              turnId: "parent-turn",
              item,
            },
          });
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId: "parent-thread",
              turn: { id: "parent-turn", status: "completed" },
            },
          });
          setImmediate(close);
        });
      }
    }
  });
}

function attachTokenUsageAppServer(child: FakeChild): void {
  let input = "";
  const send = (message: Record<string, unknown>): void => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const close = (): void => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
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
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start" || message.method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "parent-turn", status: "inProgress" } } });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            method: "thread/tokenUsage/updated",
            params: {
              threadId: "child-thread",
              turnId: "child-turn",
              tokenUsage: {
                last: { totalTokens: 999 },
                total: { totalTokens: 999 },
                modelContextWindow: 272000,
              },
            },
          });
          send({
            jsonrpc: "2.0",
            method: "thread/tokenUsage/updated",
            params: {
              threadId: "parent-thread",
              turnId: "parent-turn",
              tokenUsage: {
                last: { totalTokens: 12345, reasoningOutputTokens: 345 },
                total: { totalTokens: 88000, reasoningOutputTokens: 800 },
                modelContextWindow: 272000,
              },
            },
          });
          send({
            jsonrpc: "2.0",
            method: "item/completed",
            params: {
              threadId: "parent-thread",
              turnId: "parent-turn",
              item: { id: "message-1", type: "agent_message", text: "[final_answer] done", phase: "final_answer" },
            },
          });
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId: "parent-thread",
              turn: { id: "parent-turn", status: "completed" },
            },
          });
          setImmediate(close);
        });
      }
    }
  });
}

function attachTurnCompletedTokenUsageAppServer(child: FakeChild): void {
  let input = "";
  const send = (message: Record<string, unknown>): void => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const close = (): void => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
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
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start" || message.method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "parent-turn", status: "inProgress" } } });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            method: "item/completed",
            params: {
              threadId: "parent-thread",
              turnId: "parent-turn",
              item: { id: "message-1", type: "agent_message", text: "[final_answer] done", phase: "final_answer" },
            },
          });
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId: "parent-thread",
              turn: {
                id: "parent-turn",
                status: "completed",
                tokenUsage: {
                  last: { totalTokens: 4096, reasoningOutputTokens: 96 },
                  total: { totalTokens: 88000 },
                  modelContextWindow: 128000,
                },
              },
            },
          });
          setImmediate(close);
        });
      }
    }
  });
}

function attachSuccessfulAppServer(child: FakeChild, onMessage?: (message: Record<string, unknown>) => void): void {
  let input = "";
  const send = (message: Record<string, unknown>): void => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const close = (): void => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
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
      onMessage?.(message as Record<string, unknown>);
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start" || message.method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "parent-turn", status: "inProgress" } } });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            method: "item/completed",
            params: {
              threadId: "parent-thread",
              turnId: "parent-turn",
              item: { id: "message-1", type: "agent_message", text: "[final_answer] done", phase: "final_answer" },
            },
          });
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId: "parent-thread",
              turn: { id: "parent-turn", status: "completed" },
            },
          });
          setImmediate(close);
        });
      }
    }
  });
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

test("Codex runner enables default-mode request_user_input only when requested", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61090);
  const spawnArgs: string[][] = [];
  const initializeParams: unknown[] = [];
  attachSuccessfulAppServer(child, (message) => {
    if (message.method === "initialize") {
      initializeParams.push(message.params);
    }
  });
  crossSpawn.spawn = (_command: unknown, args: unknown): unknown => {
    spawnArgs.push(Array.isArray(args) ? args.map(String) : []);
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

    await runner.runStreamed("prompt", {
      ...createHandlers(),
      requestUserInputEnabled: true,
    });

    assert.deepEqual(spawnArgs[0]?.slice(0, 3), ["app-server", "--enable", "default_mode_request_user_input"]);
    assert.equal((initializeParams[0] as { capabilities?: { experimentalApi?: unknown } })?.capabilities?.experimentalApi, true);
    runner.dispose();
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runner sends request_user_input answers in the per-question schema", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61091);
  const responses: Array<Record<string, unknown>> = [];
  let input = "";
  const send = (message: Record<string, unknown>): void => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const close = (): void => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
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
      const message = JSON.parse(trimmed) as Record<string, unknown>;
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "parent-turn", status: "inProgress" } } });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            id: 41,
            method: "item/tool/requestUserInput",
            params: {
              threadId: "parent-thread",
              turnId: "parent-turn",
              itemId: "input-item",
              questions: [
                { id: "scope", header: "Scope", question: "Where?", isOther: false, isSecret: false, options: null },
                { id: "targets", header: "Targets", question: "Which targets?", isOther: false, isSecret: false, options: null },
                { id: "notes", header: "Notes", question: "Anything else?", isOther: true, isSecret: false, options: null },
              ],
              autoResolutionMs: null,
            },
          });
        });
        continue;
      }
      if (message.id !== 41 || message.method) {
        continue;
      }
      responses.push(message);
      send({
        jsonrpc: "2.0",
        method: "item/agentMessage/delta",
        params: {
          threadId: "parent-thread",
          turnId: "parent-turn",
          itemId: "final-message",
          delta: "[final_answer] done",
          phase: "final_answer",
        },
      });
      send({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: "parent-thread",
          turn: { id: "parent-turn", status: "completed" },
        },
      });
      setImmediate(close);
    }
  });
  crossSpawn.spawn = (): unknown => child;

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
    try {
      await runner.runStreamed("prompt", {
        ...createHandlers(),
        requestUserInputEnabled: true,
        onRequest: () => ({
          result: {
            answers: {
              scope: { answers: ["webview"] },
              targets: { answers: ["desktop", "mobile"] },
              notes: { answers: [] },
            },
          },
        }),
      });
      assert.deepEqual(responses, [{
        jsonrpc: "2.0",
        id: 41,
        result: {
          answers: {
            scope: { answers: ["webview"] },
            targets: { answers: ["desktop", "mobile"] },
            notes: { answers: [] },
          },
        },
      }]);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runner emits primary completed callback only for completed turns", async () => {
  const originalSpawn = crossSpawn.spawn;
  const { CodexInteractiveRunner } = loadCodexRunner();

  try {
    for (const status of ["failed", "interrupted"] as const) {
      const child = createFakeChild(61100);
      attachTurnStatusAppServer(child, status);
      crossSpawn.spawn = (): unknown => child;
      const completedTurns: unknown[] = [];
      const runner = new CodexInteractiveRunner({
        command: process.execPath,
        args: [],
        thinkingMode: "medium",
        interactiveMode: "coding",
        threadId: null,
        multiAgentEnabled: true,
      });
      try {
        const run = runner.runStreamed("prompt", {
          ...createHandlers(),
          onTurnCompleted: (completion) => completedTurns.push(completion),
        });
        if (status === "failed") {
          await assert.rejects(run);
        } else {
          await run;
        }
        assert.deepEqual(completedTurns, []);
      } finally {
        runner.dispose();
      }
    }
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

test("Codex runner promotes phase-null completed agent messages as final answers", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61200);
  attachAgentMessageTurnAppServer(child, {
    id: "message-1",
    type: "agent_message",
    text: "Hi! I'm ready to help with the `sinitek-ai-vscode-cli` repo.",
    phase: null,
  });
  const assistant: Array<{ chunk: string; final?: boolean }> = [];
  crossSpawn.spawn = (): unknown => child;

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
    try {
      await runner.runStreamed("hi", {
        ...createHandlers(),
        onAssistantDelta: (chunk, meta) => assistant.push({ chunk, final: meta?.codexFinalAnswer }),
      });
      assert.deepEqual(assistant, [
        { chunk: "Hi! I'm ready to help with the `sinitek-ai-vscode-cli` repo.", final: undefined },
        { chunk: "", final: true },
      ]);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runner does not promote commentary agent messages on completed turns", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61201);
  attachAgentMessageTurnAppServer(child, {
    id: "message-1",
    type: "agent_message",
    text: "Hi! 我在这里，随时可以帮你处理这个工作区的任务。",
    phase: "commentary",
  });
  const assistant: Array<{ chunk: string; final?: boolean }> = [];
  crossSpawn.spawn = (): unknown => child;

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
    try {
      await runner.runStreamed("hi", {
        ...createHandlers(),
        onAssistantDelta: (chunk, meta) => assistant.push({ chunk, final: meta?.codexFinalAnswer }),
      });
      assert.deepEqual(assistant, [
        { chunk: "Hi! 我在这里，随时可以帮你处理这个工作区的任务。", final: undefined },
      ]);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runner forwards primary thread/tokenUsage/updated as tokens_in_context_window", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61210);
  attachTokenUsageAppServer(child);
  const usageUpdates: Array<{ tokensInContextWindow: number; modelContextWindow: number | null; threadId: string }> = [];
  crossSpawn.spawn = (): unknown => child;

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: "parent-thread",
      multiAgentEnabled: true,
    });
    try {
      await runner.runStreamed("hi", {
        ...createHandlers(),
        onTokenUsageUpdate: (update) => usageUpdates.push(update),
      });
      assert.deepEqual(usageUpdates, [
        { tokensInContextWindow: 12000, modelContextWindow: 272000, threadId: "parent-thread" },
      ]);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runner reads tokens_in_context_window from primary turn/completed", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61211);
  attachTurnCompletedTokenUsageAppServer(child);
  const usageUpdates: Array<{ tokensInContextWindow: number; modelContextWindow: number | null; threadId: string }> = [];
  crossSpawn.spawn = (): unknown => child;

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: "parent-thread",
      multiAgentEnabled: true,
    });
    try {
      await runner.runStreamed("hi", {
        ...createHandlers(),
        onTokenUsageUpdate: (update) => usageUpdates.push(update),
      });
      assert.deepEqual(usageUpdates, [
        { tokensInContextWindow: 4000, modelContextWindow: 128000, threadId: "parent-thread" },
      ]);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});
