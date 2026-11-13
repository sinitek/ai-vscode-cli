import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import { installVscodeMock } from "../vscodeMock";
import { blockRealProcessSignals, fakeCodexSpawn } from "./codexProcessFixture";
import type { CodexAssistantDeltaMeta } from "../../interactive/codexRunnerRuntime";

installVscodeMock();
test.beforeEach(blockRealProcessSignals);
test.beforeEach((t) => {
  // Lifecycle fake servers model app-server RPC, not a real executable's --version.
  assert.ok("mock" in t);
  t.mock.method(require("../../interactive/codexAppServerCapabilities"), "resolveCodexThreadUnloadCapability",
    async () => ({ supported: true, reason: "supported" }));
});

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
    child.signalCode = typeof signal === "string" ? signal : "SIGTERM";
    child.emit("exit", null, child.signalCode);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, child.signalCode);
    return true;
  };
  return child;
}

function attachTurnStatusAppServer(
  child: FakeChild,
  status: string,
  notifications: ReadonlyArray<{ method: string; params?: unknown }> = [],
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
          for (const notification of notifications) {
            send({ jsonrpc: "2.0", ...notification });
          }
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
  await waitForCondition(() => spawned.length >= count);
  assert.equal(spawned.length, count);
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "app-server fixture startup timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

for (const reason of ["supported", "unsupported", "unknown"] as const) {
  test(`Codex unload policy startup uses ${reason} capability and keys the final arguments`, async (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-unload-startup-"));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const capabilities = require("../../interactive/codexAppServerCapabilities") as typeof import("../../interactive/codexAppServerCapabilities");
    const pool = require("../../interactive/codexAppServerPool") as typeof import("../../interactive/codexAppServerPool");
    const processModule = require("../../interactive/codexRunnerProcess");
    const probes: Parameters<typeof capabilities.resolveCodexThreadUnloadCapability>[0][] = [];
    const specs: Parameters<typeof pool.acquireCodexAppServer>[0][] = [];
    const acquire = pool.acquireCodexAppServer;
    t.mock.method(capabilities, "resolveCodexThreadUnloadCapability", async (input: typeof probes[number]) => {
      probes.push(input);
      return { supported: reason === "supported", reason };
    });
    t.mock.method(pool, "acquireCodexAppServer", (spec: typeof specs[number], listener: Parameters<typeof acquire>[1]) => {
      specs.push(spec); return acquire(spec, listener);
    });
    t.mock.method(processModule, "resolveSpawnCommand", (_command: string, args: string[]) => ({
      command: process.execPath, args, usesShell: false, resolvedFrom: "test-resolved-target",
    }));
    const launches: Array<{ command: unknown; args: unknown }> = [];
    t.mock.method(crossSpawn, "spawn", fakeCodexSpawn((command, args) => {
      launches.push({ command, args });
      const child = createFakeChild(61910);
      attachSuccessfulAppServer(child);
      return child;
    }));
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: "entry-resolved-by-runner", args: [], cwd: temp,
      env: { HOME: temp, USERPROFILE: temp, CODEX_HOME: temp, CODEX_HOME_DIR: temp },
      thinkingMode: "medium", interactiveMode: "coding", threadId: null,
      configFingerprint: "test-config-identity",
    });
    t.after(() => runner.dispose());
    await runner.runStreamed("prompt", { ...createHandlers(), requestUserInputEnabled: true });
    assert.equal(probes.length, 1);
    assert.equal(probes[0].command, process.execPath, "probe the actual resolved target");
    assert.equal(probes[0].cwd, specs[0].cwd);
    assert.deepEqual(probes[0].env, specs[0].env);
    const spec = specs[0];
    assert.equal(spec.args.includes("thread_unload_delay_secs=0"), reason === "supported");
    assert.equal(Boolean(spec.exclusiveOwnerId), reason !== "supported");
    assert.equal(JSON.parse(spec.key).exclusiveOwnerId, spec.exclusiveOwnerId);
    assert.deepEqual(spec.args.slice(-2), ["--listen", "stdio://"]);
    assert.ok(spec.args.includes("default_mode_request_user_input"));
    assert.ok(spec.args.some((arg) => arg.startsWith("projects.") && arg.endsWith('.trust_level="trusted"')));
    assert.deepEqual(launches, [{ command: spec.command, args: spec.args }]);
    const key = JSON.parse(spec.key) as { args: string[]; configFingerprint: string };
    assert.deepEqual(key.args, spec.args);
    assert.equal(key.configFingerprint, "test-config-identity");
    assert.equal(fs.readFileSync(path.join(temp, "config.toml"), "utf8").includes("thread_unload_delay_secs"), false);
  });
}

for (const kind of ["turn", "compact"] as const) {
  for (const cancel of ["stop", "dispose"] as const) {
    test(`Codex unload policy startup cannot start a late ${kind} after ${cancel}`, async (t) => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-unload-cancel-"));
      t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
      let entered = false;
      let completeProbe!: (value: { supported: boolean; reason: "supported" }) => void;
      const probe = new Promise<{ supported: boolean; reason: "supported" }>((resolve) => { completeProbe = resolve; });
      t.mock.method(require("../../interactive/codexAppServerCapabilities"), "resolveCodexThreadUnloadCapability", () => {
        entered = true; return probe;
      });
      let launches = 0;
      t.mock.method(crossSpawn, "spawn", () => { launches += 1; assert.fail("late startup must not spawn any child"); });
      let acquisitions = 0;
      t.mock.method(require("../../interactive/codexAppServerPool"), "acquireCodexAppServer", () => {
        acquisitions += 1; assert.fail("late startup must not acquire a pooled connection");
      });
      const { CodexInteractiveRunner } = loadCodexRunner();
      const runner = new CodexInteractiveRunner({
        command: process.execPath, args: [],
        env: { HOME: temp, USERPROFILE: temp, CODEX_HOME: temp, CODEX_HOME_DIR: temp },
        thinkingMode: "medium", interactiveMode: "coding", threadId: kind === "compact" ? "existing-thread" : null,
      });
      t.after(() => runner.dispose());
      const running = kind === "turn" ? runner.runStreamed("prompt", createHandlers()) : runner.compactThread();
      const rejected = assert.rejects(running, { name: cancel === "stop" ? "AbortError" : "RunnerDisposedError" });
      await waitForCondition(() => entered);
      if (cancel === "stop") { runner.stopAndRebuild(); } else { runner.dispose(); }
      completeProbe({ supported: true, reason: "supported" });
      await rejected;
      assert.equal(launches, 0);
      assert.equal(acquisitions, 0);
    });
  }
}

test("Codex unload policy startup preserves compatibility for an unobserved shell target", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-unload-shell-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  t.mock.method(require("../../interactive/codexAppServerCapabilities"), "resolveCodexThreadUnloadCapability", () => {
    assert.fail("a login shell is not the identity of its eventual Codex executable");
  });
  t.mock.method(require("../../interactive/codexRunnerProcess"), "resolveSpawnCommand", (_command: string, args: string[]) => ({
    command: process.execPath, args, usesShell: true, resolvedFrom: "mac-shell-fallback",
  }));
  t.mock.method(crossSpawn, "spawn", fakeCodexSpawn((_command, args) => {
    assert.ok(Array.isArray(args) && !args.includes("thread_unload_delay_secs=0"));
    const child = createFakeChild(61911); attachSuccessfulAppServer(child); return child;
  }));
  const { CodexInteractiveRunner } = loadCodexRunner();
  const runner = new CodexInteractiveRunner({
    command: "shell-only-codex", args: [],
    env: { HOME: temp, USERPROFILE: temp, CODEX_HOME: temp, CODEX_HOME_DIR: temp },
    thinkingMode: "medium", interactiveMode: "coding", threadId: null,
  });
  t.after(() => runner.dispose());
  await runner.runStreamed("prompt", createHandlers());
});

test("Codex runner reports EAGAIN spawn errors without hanging", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  const events: unknown[] = [];
  crossSpawn.spawn = fakeCodexSpawn(() => {
    queueMicrotask(() => {
      const error = new Error("spawn /mock/codex EAGAIN") as NodeJS.ErrnoException;
      error.code = "EAGAIN";
      error.path = "/mock/codex";
      error.syscall = "spawn";
      child.emit("error", error);
    });
    return child;
  });

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
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
  crossSpawn.spawn = fakeCodexSpawn((_command, args) => {
    spawnArgs.push(Array.isArray(args) ? args.map(String) : []);
    return child;
  });

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
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
  crossSpawn.spawn = fakeCodexSpawn(() => child);

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
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

const finalMessageBoundaries = ["completed", "tool", "reasoning", "next-message", "request", "reconnect"] as const;
for (const [finalBoundary, nativeFinalPhase] of finalMessageBoundaries.flatMap((boundary) =>
  [true, false].map((native) => [boundary, native] as const))) {
  test(`Codex runner settles ${nativeFinalPhase ? "native" : "marker"} final messages at ${finalBoundary} without a turn completion`, { timeout: 8_000 }, async () => {
    const originalSpawn = crossSpawn.spawn;
    const child = createFakeChild();
    const requests: Array<{ method?: string; params?: Record<string, unknown> }> = [];
    const send = (method: string, params: Record<string, unknown>) => child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    const turns: string[] = [];
    let input = "";
    child.stdin.on("data", (chunk: Buffer | string) => {
      input += String(chunk);
      const lines = input.split(/\r?\n/u);
      input = lines.pop() ?? "";
      for (const line of lines.filter((value) => value.trim())) {
        const request = JSON.parse(line);
        requests.push(request);
        let result: Record<string, unknown> = {};
        if (request.method === "thread/start" || request.method === "thread/resume") {
          result = { thread: { id: "parent-thread" } };
        } else if (request.method === "turn/start") {
          const turnId = `final-turn-${turns.length + 1}`;
          turns.push(turnId);
          result = { turn: { id: turnId, status: "inProgress" } };
        }
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
      }
    });
    crossSpawn.spawn = fakeCodexSpawn(() => child);
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({ command: process.execPath, args: [], thinkingMode: "medium", interactiveMode: "coding", threadId: null });
    const assistant: Array<{ chunk: string; itemId?: string }> = [];
    const traces: string[] = [];
    const handlers = {
      ...createHandlers(),
      onAssistantDelta: (chunk: string, meta?: CodexAssistantDeltaMeta) => assistant.push({ chunk, itemId: meta?.assistantItemId }),
      onTrace: (content: string) => traces.push(content),
    };
    try {
      let settled = false;
      const run = runner.runStreamed("task", handlers).then(() => { settled = true; });
      await waitForCondition(() => turns.length >= 1);
      assert.equal(turns.length, 1);
      const primary = { threadId: "parent-thread", turnId: turns[0] };
      const prefix = nativeFinalPhase ? "**完整" : "[final_answer]\n";
      const suffix = nativeFinalPhase ? "结论**" : "**完整结论**";
      const text = prefix + suffix;
      send("item/agentMessage/delta", { ...primary, itemId: "answer", delta: prefix, ...(nativeFinalPhase ? { phase: "final_answer" } : {}) });
      await new Promise((resolve) => setTimeout(resolve, 1_050));
      assert.equal(settled, false, "a final prefix must not truncate an unfinished message");
      send("item/agentMessage/delta", { ...primary, itemId: "answer", delta: suffix, ...(nativeFinalPhase ? { phase: "final_answer" } : {}) });
      send("item/started", { threadId: "child-thread", turnId: "child-turn", item: { id: "child-tool", type: "web_search", query: "ignored child" } });
      send("item/completed", { threadId: "child-thread", turnId: "child-turn", item: { id: "child-final", type: "agent_message", phase: "final_answer", text } });
      send("item/completed", { ...primary, item: { id: "empty", type: "agent_message", phase: "final_answer", text: "" } });
      await new Promise((resolve) => setTimeout(resolve, 1_050));
      assert.equal(settled, false);
      assert.equal(requests.some((request) => request.method === "turn/interrupt"), false);
      if (finalBoundary === "completed") {
        send("item/completed", { ...primary, item: { id: "answer", type: "agent_message", ...(nativeFinalPhase ? { phase: "final_answer" } : {}), text } });
      } else if (finalBoundary === "tool") {
        send("item/started", { ...primary, item: { id: "next-search", type: "web_search", query: "should not continue searching" } });
      } else if (finalBoundary === "reasoning") {
        send("item/reasoning/textDelta", { ...primary, itemId: "next-reasoning", delta: "should not reason again" });
      } else if (finalBoundary === "next-message") {
        send("item/agentMessage/delta", { ...primary, itemId: "replacement-answer", delta: "should not restart the answer" });
      } else if (finalBoundary === "request") {
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: "late-request", method: "item/commandExecution/requestApproval", params: { ...primary, itemId: "late-command", command: "ignored" } })}\n`);
      } else {
        send("error", { ...primary, willRetry: true, error: { message: "Reconnecting... 1/5" } });
      }
      send("item/agentMessage/delta", { ...primary, itemId: "late", delta: "不应继续输出" });
      send("item/started", { ...primary, item: { id: "late-tool", type: "command_execution", command: "ignored" } });
      await new Promise<void>((resolve, reject) => {
        const completionTimeout = setTimeout(() => reject(new Error("final answer did not settle")), 1_500);
        run.then(() => { clearTimeout(completionTimeout); resolve(); }, (error) => { clearTimeout(completionTimeout); reject(error); });
      });
      assert.equal(assistant.map((entry) => entry.chunk).join(""), text);
      assert.ok(assistant.every((entry) => entry.itemId === "answer"));
      assert.deepEqual(assistant.filter((entry) => entry.chunk).map((entry) => entry.itemId), ["answer", "answer"]);
      assert.deepEqual(traces, []);
      assert.equal(requests.filter((request) => request.method === "turn/interrupt").length, 1);
      assert.deepEqual(requests.find((request) => request.method === "turn/interrupt")?.params, primary);
      const nextRun = runner.runStreamed("next task", handlers);
      await waitForCondition(() => turns.length >= 2);
      assert.equal(turns.length, 2);
      send("item/reasoning/textDelta", { ...primary, itemId: "late-thinking", delta: "上一轮迟到的思考" });
      send("item/agentMessage/delta", { ...primary, itemId: "late", delta: "上一轮迟到的答复" });
      send("turn/completed", { threadId: "parent-thread", turn: { id: turns[0], status: "completed" } });
      send("item/agentMessage/delta", { threadId: "parent-thread", turnId: turns[1], itemId: "next-answer", delta: "下一轮完整答复", phase: "final_answer" });
      send("turn/completed", { threadId: "parent-thread", turn: { id: turns[1], status: "completed" } });
      await nextRun;
      assert.equal(assistant.map((entry) => entry.chunk).join(""), text + "下一轮完整答复");
      assert.deepEqual(assistant.filter((entry) => entry.chunk).map((entry) => entry.itemId), ["answer", "answer", "next-answer"]);
    } finally {
      runner.dispose();
      crossSpawn.spawn = originalSpawn;
    }
  });
}

test("Codex runner emits primary completed callback only for completed turns", async () => {
  const originalSpawn = crossSpawn.spawn;
  const { CodexInteractiveRunner } = loadCodexRunner();

  try {
    for (const status of ["failed", "interrupted"] as const) {
      const child = createFakeChild(61100);
      attachTurnStatusAppServer(child, status);
      crossSpawn.spawn = fakeCodexSpawn(() => child);
      const completedTurns: unknown[] = [];
      const runner = new CodexInteractiveRunner({
        command: process.execPath,
        args: [],
        thinkingMode: "medium",
        interactiveMode: "coding",
        threadId: null,
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

test("Codex runner immediate stop cannot be lost while awaiting readiness", async () => {
  const { CodexInteractiveRunner } = loadCodexRunner();
  const runner = new CodexInteractiveRunner({
    command: process.execPath,
    args: [],
    thinkingMode: "medium",
    interactiveMode: "coding",
    threadId: null,
  });
  let executed = false;
  const internal = runner as unknown as { runStreamedOnce: () => Promise<void> };
  internal.runStreamedOnce = async () => { executed = true; };
  try {
    const pending = runner.runStreamed("立即停止", createHandlers());
    runner.stopAndRebuild();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(executed, false);
  } finally {
    runner.dispose();
  }
});

test("Codex runner stop requests shutdown for every active app-server child", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const spawned: FakeChild[] = [];
  const killCalls: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];

  crossSpawn.spawn = fakeCodexSpawn(() => {
    const child = createFakeChild(61000 + spawned.length);
    spawned.push(child);
    return child;
  }, {
    onTaskkill: (pid) => { killCalls.push({ pid, signal: "SIGTERM" }); },
    exitOnTaskkill: false,
  });
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
    });

    const firstRun = runner.runStreamed("first", createHandlers()).catch((error: Error) => error);
    const secondRun = runner.runStreamed("second", createHandlers()).catch((error: Error) => error);
    await waitForSpawnCount(spawned, 1);

    runner.stopAndRebuild();

    assert.deepEqual(
      killCalls.filter((call) => call.signal === "SIGTERM").map((call) => call.pid),
      [process.platform === "win32" ? 61000 : -61000],
    );
    assert.equal(spawned.length, 1, "taskkill must not create an app-server");
    assert.equal(spawned[0].exitCode, null, "a shutdown request is not process exit");
    assert.equal(spawned[0].signalCode, null);

    for (const child of spawned) {
      child.signalCode = "SIGTERM";
      child.emit("exit", null, "SIGTERM");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", null, "SIGTERM");
    }

    const results = await Promise.all([firstRun, secondRun]);
    assert.equal(results.every((result) => result instanceof Error), true);
    runner.dispose();
  } finally {
    for (const child of spawned) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
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
  });

  try {
    await runner.runStreamed("continue", createHandlers());

    assert.deepEqual(JSON.parse(fs.readFileSync(requestLogPath, "utf8")), {
      threadId: "thread-before-provider-switch",
      sandbox: "workspace-write",
      config: {
        agents: { job_max_runtime_seconds: 86400 },
        model_reasoning_summary: "detailed",
      },
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
  crossSpawn.spawn = fakeCodexSpawn(() => child);

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
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
  crossSpawn.spawn = fakeCodexSpawn(() => child);

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
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

test("Codex notification routing preserves reasoning aliases, plan updates, and item events", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61230);
  const primary = { threadId: "parent-thread", turnId: "parent-turn" };
  attachTurnStatusAppServer(child, "completed", [
    { method: "turn/started", params: { thread_id: "parent-thread", turn: { id: "parent-turn" } } },
    { method: "item/reasoning/summaryTextDelta", params: { ...primary, itemId: "thinking", delta: "先分析" } },
    { method: "item/reasoning/summaryPartAdded", params: { ...primary, itemId: "thinking" } },
    { method: "item/reasoning/textDelta", params: { ...primary, itemId: "thinking", delta: "再验证" } },
    {
      method: "turn/plan/updated",
      params: {
        ...primary,
        plan: [{ step: "检查路由", status: "completed" }, { step: "完成验证", status: "in_progress" }],
      },
    },
    { method: "item/started", params: { ...primary, item: { id: "tool", type: "commandExecution", command: "echo ready" } } },
    {
      method: "item/completed",
      params: { ...primary, item: { id: "tool", type: "commandExecution", command: "echo ready", aggregatedOutput: "ready", exitCode: 0 } },
    },
  ]);
  const assistant: Array<{ chunk: string; kind?: string }> = [];
  const taskLists: Array<Array<{ text: string; done: boolean }>> = [];
  const traces: string[] = [];
  const events: unknown[] = [];
  crossSpawn.spawn = fakeCodexSpawn(() => child);
  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: "parent-thread",
    });
    try {
      await runner.runStreamed("检查通知路由", {
        ...createHandlers(events),
        onAssistantDelta: (chunk, meta) => assistant.push({ chunk, kind: meta?.kind }),
        onTaskListUpdate: (items) => taskLists.push(items),
        onTrace: (content) => traces.push(content),
      });
      assert.deepEqual(assistant, [
        { chunk: "先分析", kind: "thinking" },
        { chunk: "\n", kind: "thinking" },
        { chunk: "再验证", kind: "thinking" },
      ]);
      assert.deepEqual(taskLists, [[{ text: "检查路由", done: true }, { text: "完成验证", done: false }]]);
      assert.ok(traces.some((content) => content.includes("ready")));
      assert.deepEqual(events.map((event) => (event as { type?: string }).type).filter((type) => type !== "codex.lifecycle"), [
        "turn.started", "turn.plan.updated", "item.started", "item.completed", "turn.completed",
      ]);
      assert.equal(runner.getThreadId(), "parent-thread");
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex notification routing ignores unknown methods and accepts missing params", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61231);
  attachTurnStatusAppServer(child, "completed", [
    { method: "" },
    { method: "future/notification", params: null },
    { method: "__proto__" },
    { method: "constructor" },
    { method: "toString" },
    { method: "account/rateLimits/updated", params: { message: "不应作为错误处理" } },
    { method: "account/updated" },
    { method: "thread/started" },
    { method: "item/reasoning/textDelta" },
    { method: "item/agentMessage/delta" },
    { method: "thread/tokenUsage/updated" },
    { method: "turn/plan/updated" },
    { method: "rawResponseItem/completed" },
    { method: "error" },
  ]);
  const output: string[] = [];
  let completed = 0;
  crossSpawn.spawn = fakeCodexSpawn(() => child);
  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: "parent-thread",
    });
    try {
      await runner.runStreamed("忽略无效通知", {
        ...createHandlers(),
        onAssistantDelta: (chunk) => output.push(chunk),
        onTrace: (content) => output.push(content),
        onTurnCompleted: () => { completed += 1; },
      });
      assert.deepEqual(output, []);
      assert.equal(completed, 1);
      assert.equal(runner.getThreadId(), "parent-thread");
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex notification routing keeps child failures isolated and fails the primary on rate limits", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61232);
  attachTurnStatusAppServer(child, "completed", [
    { method: "error", params: { threadId: "child-thread", error: { message: "子任务失败" } } },
    { method: "error", params: { threadId: "parent-thread", message: "Reconnecting... 1/5" } },
    {
      method: "error",
      params: { threadId: "parent-thread", error: { type: "rate_limit_error", message: "Concurrency limit exceeded" } },
    },
  ]);
  const traces: string[] = [];
  const subagents: Array<{ threadId: string; status: string; error?: string }> = [];
  let completed = 0;
  crossSpawn.spawn = fakeCodexSpawn(() => child);
  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: "parent-thread",
    });
    try {
      await assert.rejects(runner.runStreamed("检查错误路由", {
        ...createHandlers(),
        onTrace: (content) => traces.push(content),
        onSubagentUpdate: (update) => subagents.push(update),
        onTurnCompleted: () => { completed += 1; },
      }), /Concurrency limit exceeded/u);
      assert.deepEqual(subagents, [{ threadId: "child-thread", status: "failed", error: "子任务失败" }]);
      assert.ok(traces.some((content) => content === "warning Reconnecting... 1/5"));
      assert.ok(traces.some((content) => content.includes("Concurrency limit exceeded")));
      assert.equal(completed, 0);
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
  crossSpawn.spawn = fakeCodexSpawn(() => child);

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: "parent-thread",
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
  crossSpawn.spawn = fakeCodexSpawn(() => child);

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: "parent-thread",
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


function attachReasoningDeltaAppServer(child: FakeChild): void {
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
      const message = JSON.parse(trimmed) as { id?: unknown; method?: unknown };
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start" || message.method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method !== "turn/start") {
        continue;
      }
      send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "parent-turn", status: "inProgress" } } });
      queueMicrotask(() => {
        send({
          jsonrpc: "2.0",
          method: "item/reasoning/summaryPartAdded",
          params: { threadId: "parent-thread", turnId: "parent-turn", itemId: "rs-1", summaryIndex: 0 },
        });
        send({
          jsonrpc: "2.0",
          method: "item/reasoning/summaryTextDelta",
          params: { threadId: "parent-thread", turnId: "parent-turn", itemId: "rs-1", delta: "Ah! This is likely the root cause:" },
        });
        send({
          jsonrpc: "2.0",
          method: "item/reasoning/summaryTextDelta",
          params: { threadId: "parent-thread", turnId: "parent-turn", itemId: "rs-1", delta: "\nLet me inspect the CSS." },
        });
        send({
          jsonrpc: "2.0",
          method: "item/reasoning/summaryTextDelta",
          params: {
            threadId: "parent-thread",
            turnId: "parent-turn",
            itemId: "rs-1",
            delta: "\n[final_answer]已修复审计日志和性能观测页面的表格宽度问题。\n\n1.",
          },
        });
        send({
          jsonrpc: "2.0",
          method: "item/completed",
          params: {
            threadId: "parent-thread",
            turnId: "parent-turn",
            item: {
              type: "reasoning",
              id: "rs-1",
              summary_text: [
                "Ah! This is likely the root cause:\n[final_answer]已修复审计日志和性能观测页面的表格宽度问题。\n\n1.",
              ],
            },
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
  });
}

test("Codex runner streams reasoning summary deltas and strips leaked final_answer drafts", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61220);
  attachReasoningDeltaAppServer(child);
  const assistant: Array<{ chunk: string; kind?: string; final?: boolean }> = [];
  crossSpawn.spawn = fakeCodexSpawn(() => child);

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
    });
    try {
      await runner.runStreamed("hi", {
        ...createHandlers(),
        onAssistantDelta: (chunk, meta) => assistant.push({
          chunk,
          kind: meta?.kind,
          final: meta?.codexFinalAnswer,
        }),
        onTrace: () => undefined,
      });
      assert.deepEqual(assistant, [
        { chunk: "Ah! This is likely the root cause:", kind: "thinking", final: undefined },
        { chunk: "\nLet me inspect the CSS.", kind: "thinking", final: undefined },
      ]);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});


test("Codex runner finishes when the primary turn completes before turn/start responds", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61092);
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
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start" || message.method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method === "turn/start") {
        send({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: "parent-thread",
            turnId: "real-turn",
            itemId: "final-message",
            delta: "[final_answer] done",
          },
        });
        send({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: "parent-thread",
            turn: { id: "real-turn", status: "completed" },
          },
        });
      }
    }
  });
  crossSpawn.spawn = fakeCodexSpawn(() => child);

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
    });
    const chunks: string[] = [];
    try {
      await runner.runStreamed("prompt", {
        ...createHandlers(),
        onAssistantDelta: (chunk) => chunks.push(chunk),
      });
      assert.deepEqual(chunks, ["[final_answer] done"]);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("Codex runner finishes a streamed turn whose id differs from the turn/start response", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild(61093);
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
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (message.method === "thread/start" || message.method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "parent-thread" } } });
        continue;
      }
      if (message.method === "turn/start") {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "rpc-turn", status: "inProgress" } } });
        queueMicrotask(() => {
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId: "parent-thread",
              turn: { id: "old-turn", status: "completed" },
            },
          });
          send({
            jsonrpc: "2.0",
            method: "item/agentMessage/delta",
            params: {
              threadId: "parent-thread",
              turnId: "real-turn",
              itemId: "final-message",
              delta: "[final_answer] tungsten",
            },
          });
          send({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId: "parent-thread",
              turn: { id: "real-turn", status: "completed" },
            },
          });
        });
      }
    }
  });
  crossSpawn.spawn = fakeCodexSpawn(() => child);

  try {
    const { CodexInteractiveRunner } = loadCodexRunner();
    const runner = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
    });
    let completed = 0;
    try {
      await runner.runStreamed("prompt", {
        ...createHandlers(),
        onTurnCompleted: () => {
          completed += 1;
        },
      });
      assert.equal(completed, 1);
    } finally {
      runner.dispose();
    }
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});
