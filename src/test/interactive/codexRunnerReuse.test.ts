import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { installVscodeMock } from "../vscodeMock";
import { blockRealProcessSignals, fakeCodexSpawn } from "./codexProcessFixture";

installVscodeMock();
test.beforeEach(blockRealProcessSignals);
test.beforeEach((t) => {
  assert.ok("mock" in t);
  // These fake executables implement RPC only; capability probes have their own suite.
  t.mock.method(require("../../interactive/codexAppServerCapabilities"), "resolveCodexThreadUnloadCapability",
    async () => ({ supported: true, reason: "supported" }));
});

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
    child.emit("exit", null, child.signalCode);
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
      if (method === "thread/compact/start" || method === "thread/unsubscribe") {
        send({ id: message.id, result: method === "thread/unsubscribe" ? { status: "unsubscribed" } : {} });
        queueMicrotask(() => send({
          method: method === "thread/unsubscribe" ? "thread/closed" : "thread/compacted",
          params: { threadId: message.params?.threadId },
        }));
      }
    }
  });
}

test("Codex runner reuses one app-server connection and loaded thread", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const methods: string[] = [];
  const spawned: FakeChild[] = [];
  crossSpawn.spawn = fakeCodexSpawn(() => {
    const child = createFakeChild(62000 + spawned.length);
    spawned.push(child);
    attachPersistentServer(child, methods);
    return child;
  });
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

test("configuration migration hands off only the target thread and compaction preserves identity", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const methods: string[] = [];
  const spawned: FakeChild[] = [];
  crossSpawn.spawn = fakeCodexSpawn(() => {
    const child = createFakeChild(62500 + spawned.length);
    spawned.push(child);
    attachPersistentServer(child, methods);
    return child;
  });
  process.kill = (() => { throw new Error("no process group"); }) as typeof process.kill;
  const { CodexInteractiveRunner } = loadCodexRunner();
  const options = {
    command: process.execPath, args: [], thinkingMode: "medium" as const,
    interactiveMode: "coding" as const, threadId: null, configFingerprint: "before",
  };
  const first = new CodexInteractiveRunner(options);
  const second = new CodexInteractiveRunner(options);
  const handlers = {
    onAssistantDelta: () => undefined, onTrace: () => undefined,
    onTaskListUpdate: () => undefined, onThreadId: () => undefined,
    requestUserInputEnabled: true,
  };
  try {
    await first.runStreamed("first", handlers);
    await second.runStreamed("other tab", handlers);
    first.updateOptions({ ...options, threadId: first.getThreadId(), configFingerprint: "after" });
    await first.runStreamed("changed config", handlers);
    assert.equal(spawned.length, 2);
    assert.equal(methods.filter((method) => method === "thread/unsubscribe").length, 1);
    assert.equal(spawned[0].killCalls.length, 0);
    first.updateOptions({ ...options, threadId: first.getThreadId(), configFingerprint: undefined });
    await first.compactThread();
    await first.runStreamed("continue", handlers);
    assert.equal(spawned.length, 2);
    assert.equal(methods.filter((method) => method === "thread/resume").length, 1);
    await second.runStreamed("still usable", handlers);
    first.updateOptions({ ...options, threadId: first.getThreadId(), configFingerprint: "new-config-for-compact" });
    await first.compactThread();
    assert.equal(spawned.length, 3);
    assert.equal(first.getThreadId(), "thread-1");
  } finally {
    first.dispose();
    second.dispose();
    crossSpawn.spawn = originalSpawn;
    process.kill = originalKill;
  }
});

test("Codex runners share initialize and start one thread each", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const methods: string[] = [];
  const spawned: FakeChild[] = [];
  crossSpawn.spawn = fakeCodexSpawn(() => {
    const child = createFakeChild(62100 + spawned.length);
    spawned.push(child);
    attachPersistentServer(child, methods);
    return child;
  });
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
    });
    const second = new CodexInteractiveRunner({
      command: process.execPath,
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      threadId: null,
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
  crossSpawn.spawn = fakeCodexSpawn(() => child);
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

test("paused turn completion does not finish the next prompt before it answers", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const child = createFakeChild(62300);
  let input = "";
  let turnCount = 0;
  const nextTurnGate: { release: () => void } = { release: () => undefined };
  const nextTurnReady = new Promise<void>((resolve) => {
    nextTurnGate.release = resolve;
  });
  let releaseFirstTurn: (() => void) | null = null;
  const firstTurnStarted = new Promise<void>((resolve) => {
    releaseFirstTurn = resolve;
  });
  let releaseStaleCompletion: (() => void) | null = null;
  const staleCompletionSent = new Promise<void>((resolve) => {
    releaseStaleCompletion = resolve;
  });
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
      if (method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (method === "thread/start" || method === "thread/resume") {
        send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "thread-pause" } } });
        continue;
      }
      if (method === "turn/interrupt") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        continue;
      }
      if (method !== "turn/start") {
        continue;
      }
      turnCount += 1;
      if (turnCount === 1) {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-old", status: "inProgress" } } });
        releaseFirstTurn?.();
        continue;
      }
      send({
        jsonrpc: "2.0",
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-pause",
          turnId: "turn-old",
          itemId: "old-message",
          delta: "old partial",
        },
      });
      send({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: "thread-pause",
          turn: { id: "turn-old", status: "completed" },
        },
      });
      releaseStaleCompletion?.();
      void nextTurnReady.then(() => {
        send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-next", status: "inProgress" } } });
        send({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-pause",
            turnId: "turn-next",
            itemId: "next-message",
            delta: "[final_answer] next",
            phase: "final_answer",
          },
        });
        send({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: "thread-pause",
            turn: { id: "turn-next", status: "completed" },
          },
        });
      });
    }
  });
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];
  crossSpawn.spawn = fakeCodexSpawn(() => child);
  process.kill = ((pid: number, signal?: NodeJS.Signals | number): true => {
    killSignals.push(signal);
    assert.equal(pid, -child.pid!);
    child.kill(signal);
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
    const firstRun = runner.runStreamed("stay", {
      onAssistantDelta: () => undefined,
      onTrace: () => undefined,
      onTaskListUpdate: () => undefined,
      onThreadId: () => undefined,
    });
    const chunks: string[] = [];
    try {
      await firstTurnStarted;
      await new Promise((resolve) => setImmediate(resolve));
      runner.stopAndRebuild();
      const rejectedFirst = assert.rejects(firstRun, /Codex run aborted/u);
      const secondRun = runner.runStreamed("next", {
        onAssistantDelta: (chunk) => {
          if (chunk) {
            chunks.push(chunk);
          }
        },
        onTrace: () => undefined,
        onTaskListUpdate: () => undefined,
        onThreadId: () => undefined,
      });
      await staleCompletionSent;
      const settledEarly = await Promise.race([
        secondRun.then(() => "settled", () => "settled"),
        new Promise<string>((resolve) => setImmediate(() => resolve("pending"))),
      ]);
      assert.equal(settledEarly, "pending");
      nextTurnGate.release();
      await secondRun;
      await rejectedFirst;
      assert.deepEqual(chunks, ["[final_answer] next"]);
      assert.equal(killSignals.includes("SIGTERM"), false);
    } finally {
      runner.dispose();
    }
  } finally {
    process.kill = originalKill;
    crossSpawn.spawn = originalSpawn;
  }
});


for (const action of ["hot-stop", "dispose", "complete"] as const) {
  test(`runner ${action} cancels only its pending question; late answers cannot reach a restarted turn`, async () => {
    const originalSpawn = crossSpawn.spawn;
    const originalKill = process.kill;
    const child = createFakeChild(1_000_008_000);
    const messages: Record<string, unknown>[] = [];
    const answers: Array<(answer: import("../../interactive/codexAppServerProtocol").JsonRpcResolution) => void> = [];
    let input = ""; let turns = 0;
    const send = (message: Record<string, unknown>) => child.stdout.write(`${JSON.stringify(message)}\n`);
    child.stdin.on("data", (chunk) => {
      input += String(chunk);
      const lines = input.split("\n"); input = lines.pop() ?? "";
      for (const line of lines) {
        const message = JSON.parse(line) as { id?: unknown; method?: string; params?: Record<string, unknown> };
        messages.push(message);
        if (!message.method) continue;
        if (message.method === "initialize" || message.method === "turn/interrupt") send({ id: message.id, result: {} });
        else if (message.method === "thread/resume") send({ id: message.id, result: { thread: { id: message.params?.threadId } } });
        else if (message.method === "turn/start") {
          const threadId = message.params?.threadId;
          const turnId = `turn-${++turns}`;
          send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
          if (threadId === "b") send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
          else send({ id: `question-${turns}`, method: "item/tool/requestUserInput", params: { threadId, turnId, questions: [] } });
        }
      }
    });
    crossSpawn.spawn = fakeCodexSpawn(() => child);
    process.kill = (() => { throw new Error("no real signals"); }) as typeof process.kill;
    const { CodexInteractiveRunner } = loadCodexRunner();
    const options = { command: process.execPath, args: [], thinkingMode: "medium" as const, interactiveMode: "coding" as const };
    const runner = new CodexInteractiveRunner({ ...options, threadId: "a" });
    const peer = new CodexInteractiveRunner({ ...options, threadId: "b" });
    const handlers = {
      onAssistantDelta: () => undefined, onTrace: () => undefined, onTaskListUpdate: () => undefined, onThreadId: () => undefined,
      requestUserInputEnabled: true,
      onRequest: () => new Promise<import("../../interactive/codexAppServerProtocol").JsonRpcResolution>((resolve) => answers.push(resolve)),
    };
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 2000;
      while (!condition()) {
        assert.ok(Date.now() < deadline, "runner lifecycle condition timed out");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
    };
    try {
      await peer.runStreamed("retain shared process", handlers);
      const first = runner.runStreamed("first", handlers);
      void first.catch(() => undefined);
      await wait(() => answers.length === 1);
      if (action === "hot-stop") runner.stopAndRebuild();
      else if (action === "dispose") runner.dispose();
      else send({ method: "turn/completed", params: { threadId: "a", turn: { id: "turn-2", status: "completed" } } });
      if (action === "complete") await first;
      else await assert.rejects(first);
      const response = () => messages.filter((message) => !message.method && message.id === "question-2");
      assert.equal(response().length, 1);
      assert.deepEqual(response()[0].result, { answers: {} });
      if (action !== "dispose") {
        const second = runner.runStreamed("restart", handlers);
        void second.catch(() => undefined);
        await wait(() => answers.length === 2);
        if (action === "hot-stop") {
          send({ id: "old-turn-late-question", method: "item/tool/requestUserInput", params: { threadId: "a", turnId: "turn-2", questions: [] } });
          await wait(() => messages.some((message) => !message.method && message.id === "old-turn-late-question"));
          assert.equal(answers.length, 2, "an old turn request must not ask the new operation");
          assert.deepEqual(messages.find((message) => !message.method && message.id === "old-turn-late-question")?.result, { answers: {} });
        }
        answers[0]({ result: { answers: { stale: "late old answer" } } });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(response().length, 1);
        answers[1]({ result: { answers: { current: { answers: ["new"] } } } });
        await wait(() => messages.some((message) => !message.method && message.id === "question-3"));
        send({ method: "turn/completed", params: { threadId: "a", turn: { id: "turn-3", status: "completed" } } });
        await second;
      } else {
        answers[0]({ result: { answers: { stale: "late disposed answer" } } });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(response().length, 1);
      }
      await peer.runStreamed("other session still usable", handlers);
      assert.equal(child.killCalls.length, 0);
    } finally {
      runner.dispose(); peer.dispose();
      crossSpawn.spawn = originalSpawn; process.kill = originalKill;
    }
  });
}
