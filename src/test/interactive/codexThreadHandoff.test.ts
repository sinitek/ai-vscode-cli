import * as assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const crossSpawn = require("cross-spawn") as { spawn: (...args: unknown[]) => unknown };
const { acquireCodexAppServer, shutdownCodexAppServerPool } = require("../../interactive/codexAppServerPool") as typeof import("../../interactive/codexAppServerPool");
type Message = { id: number; method: string; params: Record<string, unknown> };
type TestChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killCalls: number;
  kill: () => boolean;
  messages: Message[];
  reply: (message: Message, result: unknown) => void;
  send: (message: Record<string, unknown>) => void;
  close: () => void;
  handle?: (message: Message) => boolean;
};

let childSequence = 0;
function createHarness() {
  const originalSpawn = crossSpawn.spawn;
  const children: TestChild[] = [];
  crossSpawn.spawn = () => {
    const child = new EventEmitter() as TestChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.pid = 1_000_000_000 + childSequence++;
    child.exitCode = null;
    child.signalCode = null;
    child.killCalls = 0;
    child.kill = () => { child.killCalls += 1; return true; };
    child.messages = [];
    child.send = (message) => { child.stdout.write(`${JSON.stringify(message)}\n`); };
    child.reply = (message, result) => child.send({ id: message.id, result });
    child.close = () => {
      child.exitCode = 0;
      child.emit("close", 0, null);
      child.stdout.end();
      child.stderr.end();
    };
    let buffered = "";
    child.stdin.on("data", (chunk) => {
      buffered += String(chunk);
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const message = JSON.parse(line) as Message;
        child.messages.push(message);
        if (child.handle?.(message) || message.id === undefined) {
          continue;
        }
        child.reply(message, message.method === "thread/resume" || message.method === "thread/start"
          ? { thread: { id: message.params.threadId ?? "new-thread" } }
          : message.method === "thread/unsubscribe" ? { status: "unsubscribed" } : {});
      }
    });
    children.push(child);
    return child;
  };
  const listener = (id: string) => ({
    id, isActive: () => false, handleNotification: () => undefined,
    handleServerRequest: () => null, onClosed: () => undefined,
  });
  const acquire = (key: string, owner: string, home = "/synthetic-handoff-home") => acquireCodexAppServer({
    key, command: "fake-codex", args: [], env: {}, codexHomeDir: home, initializeParams: {},
  }, listener(owner));
  return {
    children, acquire,
    cleanup: () => {
      shutdownCodexAppServerPool();
      for (const child of children) {
        child.close();
      }
      crossSpawn.spawn = originalSpawn;
    },
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1500;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "condition timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

test("handoff waits beyond unsubscribe acknowledgement without killing other tabs", async () => {
  const harness = createHarness();
  try {
    const old = harness.acquire("old", "a");
    harness.acquire("old", "b");
    const next = harness.acquire("next", "a-next");
    await old.request("a", "thread/resume", { threadId: "thread-a" });
    old.release("a");
    let resumed = false;
    const handoff = next.withThread("a-next", "thread-a", async () => {
      resumed = true;
      await next.request("a-next", "thread/resume", { threadId: "thread-a" });
    });
    await waitFor(() => harness.children[0].messages.some((message) => message.method === "thread/unsubscribe"));
    await new Promise<void>((resolve) => setTimeout(resolve, 35));
    assert.equal(resumed, false);
    assert.equal(old.hasLoadedThread("thread-a"), true);
    await old.withThread("b", "thread-b", () => old.request("b", "test/ping", {}));
    assert.equal(harness.children[0].killCalls, 0);
    harness.children[0].send({ method: "thread/closed", params: { threadId: "thread-a" } });
    await handoff;
    assert.equal(old.hasLoadedThread("thread-a"), false);
    assert.equal(next.hasLoadedThread("thread-a"), true);
    assert.equal(old.isAlive(), true);
  } finally {
    harness.cleanup();
  }
});

test("last-listener shutdown waits for actual process exit, including close-only children", async () => {
  const harness = createHarness();
  try {
    const old = harness.acquire("old", "a");
    const next = harness.acquire("next", "a-next");
    await old.request("a", "thread/resume", { threadId: "thread-a" });
    old.release("a");
    let resumed = false;
    const handoff = next.withThread("a-next", "thread-a", async () => { resumed = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 35));
    assert.equal(resumed, false);
    harness.children[0].close();
    await handoff;
    assert.equal(resumed, true);
    assert.equal(harness.children[0].messages.some((message) => message.method === "thread/unsubscribe"), false);
  } finally {
    harness.cleanup();
  }
});

for (const status of ["unsubscribed", "notSubscribed", "invalid", "rpc-error", "no-response", "exiting"]) {
  test(`unsafe handoff fails closed for ${status} and preserves ownership`, async () => {
    const harness = createHarness();
    try {
      const old = harness.acquire("old", "a");
      harness.acquire("old", "b");
      const next = harness.acquire("next", "a-next");
      await old.request("a", "thread/resume", { threadId: "thread-a" });
      harness.children[0].handle = (message) => {
        if (message.method !== "thread/unsubscribe") {
          return false;
        }
        if (status === "rpc-error") {
          harness.children[0].send({ id: message.id, error: { code: -32601, message: "unsupported" } });
        } else if (status !== "no-response") {
          harness.children[0].reply(message, { status });
        }
        return true;
      };
      if (status === "exiting") {
        old.release("a");
        old.release("b");
      }
      let resumed = false;
      await assert.rejects(next.withThread("a-next", "thread-a", async () => { resumed = true; }, { timeoutMs: 55 }), {
        code: "CODEX_THREAD_HANDOFF_FAILED",
      });
      assert.equal(resumed, false);
      assert.equal(old.hasLoadedThread("thread-a"), true);
      assert.equal(harness.children[0].killCalls > 0, status === "exiting");
    } finally {
      harness.cleanup();
    }
  });
}

test("notLoaded confirms release and handoff cancellation remains responsive", async () => {
  const harness = createHarness();
  try {
    const old = harness.acquire("old", "a");
    harness.acquire("old", "b");
    const next = harness.acquire("next", "a-next");
    await old.request("a", "thread/resume", { threadId: "thread-a" });
    harness.children[0].handle = (message) => {
      if (message.method !== "thread/unsubscribe") {
        return false;
      }
      harness.children[0].reply(message, { status: "notLoaded" });
      return true;
    };
    await next.withThread("a-next", "thread-a", async () => undefined);
    assert.equal(old.hasLoadedThread("thread-a"), false);
    old.claimThread("thread-a", "a");
    harness.children[0].handle = (message) => message.method === "thread/unsubscribe";
    let cancelled = false;
    const handoff = next.withThread("a-next", "thread-a", async () => undefined, {
      checkActive: () => { if (cancelled) { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } },
    });
    cancelled = true;
    await assert.rejects(handoff, { name: "AbortError" });
    assert.equal(old.hasLoadedThread("thread-a"), true);
  } finally {
    harness.cleanup();
  }
});

test("same-thread operations cannot overlap but unrelated threads and homes stay parallel", async () => {
  const harness = createHarness();
  try {
    const first = harness.acquire("first", "a");
    const next = harness.acquire("next", "b");
    const otherHome = harness.acquire("other-home", "c", "/different-home");
    let finish: () => void = () => undefined;
    const running = first.withThread("a", "thread-a", () => new Promise<void>((resolve) => { finish = resolve; }));
    await assert.rejects(next.withThread("b", "thread-a", async () => undefined), { code: "CODEX_THREAD_BUSY" });
    const alias = harness.acquire("alias", "alias-owner", "/synthetic-handoff-home/../synthetic-handoff-home");
    await assert.rejects(alias.withThread("alias-owner", "thread-a", async () => undefined), { code: "CODEX_THREAD_BUSY" });
    await next.withThread("b", "thread-b", async () => undefined);
    await otherHome.withThread("c", "thread-a", async () => undefined);
    finish();
    await running;
    await next.withThread("b", "thread-a", async () => undefined);
  } finally {
    harness.cleanup();
  }
});

test("a newly started thread cannot be stolen before its first turn finishes", async () => {
  const harness = createHarness();
  try {
    const first = harness.acquire("first", "a");
    const next = harness.acquire("next", "b");
    let finish: () => void = () => undefined;
    const running = first.withThread("a", null, async () => {
      await first.request("a", "thread/start", {});
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    await waitFor(() => first.hasLoadedThread("new-thread"));
    await assert.rejects(next.withThread("b", "new-thread", async () => undefined), { code: "CODEX_THREAD_BUSY" });
    finish();
    await running;
  } finally {
    harness.cleanup();
  }
});

test("abandoned resume responses are tracked before unloading a shared process", async () => {
  const harness = createHarness();
  try {
    const old = harness.acquire("old", "a");
    harness.acquire("old", "b");
    const next = harness.acquire("next", "a-next");
    let pendingResume: Message | undefined;
    harness.children[0].handle = (message) => {
      if (message.method === "thread/resume") {
        pendingResume = message;
        return true;
      }
      return false;
    };
    const resume = old.request("a", "thread/resume", { threadId: "thread-a" });
    await waitFor(() => pendingResume !== undefined);
    old.rejectOwner("a", new Error("abandoned"));
    old.release("a");
    await assert.rejects(resume, /abandoned/);
    let resumed = false;
    const handoff = next.withThread("a-next", "thread-a", async () => { resumed = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 35));
    assert.equal(harness.children[0].messages.some((message) => message.method === "thread/unsubscribe"), false);
    harness.children[0].reply(pendingResume!, { thread: { id: "thread-a" } });
    await waitFor(() => harness.children[0].messages.some((message) => message.method === "thread/unsubscribe"));
    assert.equal(resumed, false);
    harness.children[0].send({ method: "thread/closed", params: { threadId: "thread-a" } });
    await handoff;
    assert.equal(resumed, true);
  } finally {
    harness.cleanup();
  }
});

test("unknown writers produce stable non-retryable errors without killing any process", async () => {
  const harness = createHarness();
  try {
    const connection = harness.acquire("new", "a");
    harness.children[0].handle = (message) => {
      if (message.method !== "thread/resume") {
        return false;
      }
      harness.children[0].send({ id: message.id, error: { code: -32600, message: "thread thread-a already has an active writer" } });
      return true;
    };
    await assert.rejects(connection.withThread("a", "thread-a", () => connection.request("a", "thread/resume", { threadId: "thread-a" })), {
      code: "CODEX_THREAD_WRITER_CONFLICT",
    });
    assert.equal(harness.children[0].killCalls, 0);
    assert.equal(connection.hasLoadedThread("thread-a"), false);
  } finally {
    harness.cleanup();
  }
});

test("process exit confirms release without discarding stdout buffered before close", async () => {
  const harness = createHarness();
  try {
    const connection = harness.acquire("buffered-exit", "a");
    let request: Message | undefined;
    harness.children[0].handle = (message) => {
      if (message.method === "test/buffered") {
        request = message;
        return true;
      }
      return false;
    };
    const result = connection.request("a", "test/buffered", {});
    await waitFor(() => request !== undefined);
    harness.children[0].exitCode = 0;
    harness.children[0].emit("exit", 0, null);
    harness.children[0].reply(request!, { buffered: true });
    assert.deepEqual(await result, { buffered: true });
  } finally {
    harness.cleanup();
  }
});
