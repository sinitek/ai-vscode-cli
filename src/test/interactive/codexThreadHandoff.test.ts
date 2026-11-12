import * as assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { installVscodeMock } from "../vscodeMock";
import { fakeCodexSpawn } from "./codexProcessFixture";

installVscodeMock();

const crossSpawn = require("cross-spawn") as { spawn: (...args: unknown[]) => unknown };
const { acquireCodexAppServer, shutdownCodexAppServerPool } = require("../../interactive/codexAppServerPool") as typeof import("../../interactive/codexAppServerPool");
type Message = { id: string | number; method: string; params: Record<string, unknown>; result?: unknown; error?: unknown };
type TestChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  terminationRequests: number;
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
  const originalKill = process.kill;
  const children: TestChild[] = [];
  process.kill = ((pid: number): true => {
    const child = children.find((candidate) => -candidate.pid === pid);
    assert.ok(child, `kill targeted an unknown fake process group: ${pid}`);
    child.terminationRequests += 1;
    return true;
  }) as typeof process.kill;
  crossSpawn.spawn = fakeCodexSpawn(() => {
    const child = new EventEmitter() as TestChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.pid = 1_000_000_000 + childSequence++;
    child.exitCode = null;
    child.signalCode = null;
    child.terminationRequests = 0;
    child.kill = () => { child.terminationRequests += 1; return true; };
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
        if (!message.method || child.handle?.(message) || message.id === undefined) {
          continue;
        }
        child.reply(message, message.method === "thread/resume" || message.method === "thread/start"
          ? { thread: { id: message.params.threadId ?? "new-thread" } }
          : message.method === "thread/unsubscribe" ? { status: "unsubscribed" } : {});
      }
    });
    children.push(child);
    return child;
  }, {
    onTaskkill: (pid) => {
      const child = children.find((candidate) => candidate.pid === pid)!;
      child.terminationRequests += 1;
    },
    exitOnTaskkill: false,
  });
  const listener = (id: string) => ({
    id, isActive: () => false, handleNotification: () => undefined,
    handleServerRequest: () => null, onClosed: () => undefined,
  });
  const acquire = (key: string, owner: string, home = "/synthetic-handoff-home",
    overrides: Partial<import("../../interactive/codexAppServerPool").CodexAppServerListener> = {}) => acquireCodexAppServer({
    key, command: "fake-codex", args: [], env: {}, codexHomeDir: home, initializeParams: {},
  }, { ...listener(owner), ...overrides });
  return {
    children, acquire,
    cleanup: () => {
      shutdownCodexAppServerPool();
      for (const child of children) {
        child.close();
      }
      crossSpawn.spawn = originalSpawn;
      process.kill = originalKill;
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

for (const acknowledgement of ["unsubscribed", "notSubscribed"]) {
  test(`handoff reconciles ${acknowledgement} with native notLoaded when closed is absent`, async () => {
    const harness = createHarness();
    try {
      const old = harness.acquire("old", "a");
      harness.acquire("old", "b");
      const next = harness.acquire("next", "a-next");
      await old.request("a", "thread/resume", { threadId: "thread-a" });
      await old.request("b", "thread/resume", { threadId: "thread-b" });
      let unloaded = false;
      let queries = 0;
      harness.children[0].handle = (message) => {
        if (message.method !== "thread/unsubscribe") return false;
        assert.equal(message.params.threadId, "thread-a");
        harness.children[0].reply(message, { status: ++queries === 1 ? acknowledgement : unloaded ? "notLoaded" : acknowledgement });
        return true;
      };
      let resumed = false;
      const handoff = next.withThread("a-next", "thread-a", async () => { resumed = true; }, { timeoutMs: 1400 });
      await waitFor(() => queries === 1);
      assert.equal(resumed, false, "acknowledgement is not release");
      await old.withThread("b", "thread-b", () => old.request("b", "test/ping", {}));
      unloaded = true;
      await handoff;
      assert.ok(queries >= 2);
      assert.equal(old.hasLoadedThread("thread-a"), false);
      assert.equal(old.hasLoadedThread("thread-b"), true);
      assert.equal(harness.children[0].terminationRequests, 0);
    } finally { harness.cleanup(); }
  });
}

for (const response of ["still-loaded", "rpc-error", "no-response", "null", "unknown", "malformed"]) {
  test(`release state query fails closed for ${response}`, async () => {
    const harness = createHarness();
    try {
      const old = harness.acquire("old", "a");
      harness.acquire("old", "b");
      const next = harness.acquire("next", "a-next");
      await old.request("a", "thread/resume", { threadId: "thread-a" });
      let queries = 0;
      harness.children[0].handle = (message) => {
        if (message.method !== "thread/unsubscribe") return false;
        if (++queries === 1 || response === "still-loaded") harness.children[0].reply(message, { status: "unsubscribed" });
        else if (response === "rpc-error") harness.children[0].send({ id: message.id, error: { code: -32601, message: "unsupported" } });
        else if (response !== "no-response") harness.children[0].reply(message,
          response === "null" ? null : response === "unknown" ? { status: "released" } : { status: ["notLoaded"] });
        return true;
      };
      await assert.rejects(next.withThread("a-next", "thread-a", async () => assert.fail("unsafe resume"), { timeoutMs: 620 }), {
        code: "CODEX_THREAD_HANDOFF_FAILED",
      });
      assert.ok(queries >= 2);
      if (response !== "still-loaded") assert.equal(queries, 2, "failed/unanswered requests are not retried");
      assert.equal(old.hasLoadedThread("thread-a"), true);
      assert.equal(harness.children[0].terminationRequests, 0);
    } finally { harness.cleanup(); }
  });
}

test("notLoaded cannot erase a later load while release state query is in flight", async () => {
  const harness = createHarness();
  try {
    const old = harness.acquire("old", "a");
    harness.acquire("old", "b");
    const next = harness.acquire("next", "a-next");
    await old.request("a", "thread/resume", { threadId: "thread-a" });
    let query: Message | undefined;
    let lateLoad: Message | undefined;
    harness.children[0].handle = (message) => {
      if (message.method === "thread/unsubscribe") { query = message; return true; }
      if (message.method === "thread/resume") { lateLoad = message; return true; }
      return false;
    };
    let cancelled = false;
    const handoff = next.withThread("a-next", "thread-a", async () => assert.fail("stale release"), {
      checkActive: () => { if (cancelled) throw Object.assign(new Error("aborted"), { name: "AbortError" }); },
    });
    await waitFor(() => Boolean(query));
    const loading = old.request("a", "thread/resume", { threadId: "thread-a" });
    await waitFor(() => Boolean(lateLoad));
    old.rejectOwner("a", new Error("abandoned load"));
    await assert.rejects(loading, /abandoned/);
    harness.children[0].reply(lateLoad!, { thread: { id: "thread-a" } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.children[0].reply(query!, { status: "notLoaded" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(old.hasLoadedThread("thread-a"), true);
    cancelled = true;
    await assert.rejects(handoff, { name: "AbortError" });
  } finally { harness.cleanup(); }
});

test("cancelling a release query ignores its late response and allows a fresh operation", async () => {
  const harness = createHarness();
  try {
    const old = harness.acquire("old", "a");
    harness.acquire("old", "b");
    const next = harness.acquire("next", "a-next");
    await old.request("a", "thread/resume", { threadId: "thread-a" });
    let query: Message | undefined;
    harness.children[0].handle = (message) => {
      if (message.method !== "thread/unsubscribe") return false;
      query = message;
      return true;
    };
    let cancelled = false;
    const handoff = next.withThread("a-next", "thread-a", async () => assert.fail("cancelled resume"), {
      checkActive: () => { if (cancelled) throw Object.assign(new Error("aborted"), { name: "AbortError" }); },
    });
    await waitFor(() => Boolean(query));
    cancelled = true;
    await assert.rejects(handoff, { name: "AbortError" });
    harness.children[0].reply(query!, { status: "notLoaded" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(old.hasLoadedThread("thread-a"), true);
    harness.children[0].handle = (message) => {
      if (message.method !== "thread/unsubscribe") return false;
      harness.children[0].reply(message, { status: "notLoaded" });
      return true;
    };
    await next.withThread("a-next", "thread-a", async () => undefined);
  } finally { harness.cleanup(); }
});

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
    assert.equal(harness.children[0].terminationRequests, 0);
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
      assert.equal(harness.children[0].terminationRequests > 0, status === "exiting");
      assert.equal(harness.children[0].exitCode, null);
      assert.equal(harness.children[0].signalCode, null);
      if (status === "exiting") {
        harness.children[0].close();
        await next.withThread("a-next", "thread-a", async () => { resumed = true; }, { timeoutMs: 55 });
        assert.equal(resumed, true, "only actual exit confirms release");
        assert.equal(old.hasLoadedThread("thread-a"), false);
      }
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
    assert.equal(harness.children[0].terminationRequests, 0);
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


function deferredAnswer() {
  let resolve!: (answer: import("../../interactive/codexAppServerProtocol").JsonRpcResolution) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<import("../../interactive/codexAppServerProtocol").JsonRpcResolution>((yes, no) => {
    resolve = yes; reject = no;
  });
  return { promise, resolve, reject };
}

function replies(child: TestChild, id: string | number) {
  return child.messages.filter((message) => !message.method && message.id === id);
}

const question = (id: string | number, threadId: string) => ({
  id, method: "item/tool/requestUserInput", params: { threadId, questions: [] },
});

test("an unanswered B question does not block A RPC/closed/handoff and B can still answer once", async () => {
  const h = createHarness();
  const answer = deferredAnswer();
  let asked = 0;
  try {
    const old = h.acquire("old", "a");
    h.acquire("old", "b", undefined, {
      isActive: () => true, getOperationToken: () => answer,
      handleServerRequest: () => { asked++; return answer.promise; },
    });
    const next = h.acquire("next", "next-a");
    await old.request("a", "thread/resume", { threadId: "thread-a" });
    await old.request("b", "thread/resume", { threadId: "thread-b" });
    const child = h.children[0];
    child.send(question("B-question", "thread-b"));
    await waitFor(() => asked === 1);
    child.handle = (message) => {
      if (message.method !== "thread/unsubscribe") return false;
      child.reply(message, { status: "unsubscribed" });
      child.send({ method: "thread/closed", params: { threadId: "thread-a" } });
      return true;
    };
    const rpc = old.request("a", "thread/read", { threadId: "thread-a" });
    const handoff = next.withThread("next-a", "thread-a", async () => "handed-off", { timeoutMs: 300 });
    assert.deepEqual(await rpc, {});
    assert.equal(await handoff, "handed-off");
    assert.equal(replies(child, "B-question").length, 0, "B must remain unanswered");
    assert.equal(old.hasLoadedThread("thread-b"), true);
    answer.resolve({ result: { answers: { q: { answers: ["B answer"] } } } });
    await waitFor(() => replies(child, "B-question").length === 1);
    assert.deepEqual(replies(child, "B-question")[0].result, { answers: { q: { answers: ["B answer"] } } });
    assert.equal(child.terminationRequests, 0);
  } finally { h.cleanup(); }
});

for (const action of ["stop", "detach", "thread-close", "owner-change", "generation-change", "listener-replaced", "server-resolved", "exit"] as const) {
  test(`pending requests close only their scope on ${action}; late answers cannot escape`, async () => {
    const h = createHarness();
    const a = deferredAnswer(); const b = deferredAnswer();
    let token: object = {};
    let asked = 0;
    try {
      const connection = h.acquire("shared", "a", undefined, {
        isActive: () => true, getOperationToken: () => token,
        handleServerRequest: () => { asked++; return a.promise; },
      });
      h.acquire("shared", "b", undefined, {
        isActive: () => true, handleServerRequest: () => { asked++; return b.promise; },
      });
      await connection.request("a", "thread/resume", { threadId: "a" });
      await connection.request("b", "thread/resume", { threadId: "b" });
      const child = h.children[0];
      child.send(question(70, "a"));
      child.send(question("70", "b")); // string and numeric IDs are independent
      await waitFor(() => asked === 2);
      switch (action) {
        case "stop": connection.rejectOwner("a", new Error("stopped")); break;
        case "detach": connection.release("a"); break;
        case "thread-close": child.send({ method: "thread/closed", params: { threadId: "a" } }); break;
        case "owner-change": connection.claimThread("a", "b"); break;
        case "generation-change": token = {}; break;
        case "listener-replaced": h.acquire("shared", "a", undefined, { isActive: () => true }); break;
        case "server-resolved":
          child.send({ method: "serverRequest/resolved", params: { threadId: "a", requestId: 70 } }); break;
        case "exit": child.exitCode = 0; child.emit("exit", 0, null); break;
      }
      // Ordered RPC is also a barrier after thread/closed/resolved notifications.
      if (action !== "exit") await connection.request("b", "thread/read", { threadId: "b" });
      a.resolve({ result: { answers: { secret: "stale answer" } } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(replies(child, "70").length, 0, "unrelated B is still pending");
      if (action === "server-resolved" || action === "exit") {
        assert.equal(replies(child, 70).length, 0);
      } else {
        await waitFor(() => replies(child, 70).length === 1);
        assert.deepEqual(replies(child, 70)[0].result, { answers: {} });
      }
      b.resolve({ result: { answers: { q: { answers: ["current"] } } } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(replies(child, "70").length, action === "exit" ? 0 : 1);
      assert.equal((connection as unknown as { inbound: Map<unknown, unknown> }).inbound.size, 0);
      assert.equal(child.terminationRequests, 0);
    } finally { h.cleanup(); }
  });
}

test("explicit foreign thread never falls back to the sole active session; rejected handlers stay local", async () => {
  const h = createHarness();
  let calls = 0;
  try {
    const connection = h.acquire("shared", "a", undefined, {
      isActive: () => true,
      handleServerRequest: () => { calls++; throw new Error("secret user content"); },
    });
    await connection.request("a", "thread/resume", { threadId: "a" });
    const child = h.children[0];
    child.send(question("foreign", "unowned"));
    child.send(question("owned", "a"));
    await waitFor(() => replies(child, "owned").length === 1);
    assert.equal(calls, 1);
    assert.deepEqual(replies(child, "foreign")[0].result, { answers: {} });
    assert.deepEqual(replies(child, "owned")[0].result, { answers: {} });
    assert.deepEqual(await connection.request("a", "thread/read", { threadId: "a" }), {});
    assert.equal(connection.isAlive(), true);
    assert.equal(child.terminationRequests, 0);
  } finally { h.cleanup(); }
});

test("async handler rejection and duplicate in-flight ID produce at most one reply without affecting peers", async () => {
  const h = createHarness(); const answer = deferredAnswer(); let asked = 0;
  try {
    const connection = h.acquire("shared", "a", undefined, {
      isActive: () => true, handleServerRequest: () => { asked++; return answer.promise; },
    });
    await connection.request("a", "thread/resume", { threadId: "a" });
    const child = h.children[0];
    child.send(question(91, "a")); child.send(question(91, "a"));
    await waitFor(() => asked === 1);
    answer.reject(new Error("sensitive handler failure"));
    await waitFor(() => replies(child, 91).length === 1);
    assert.deepEqual(replies(child, 91)[0].result, { answers: {} });
    assert.equal(connection.isAlive(), true);
    assert.equal((connection as unknown as { inbound: Map<unknown, unknown> }).inbound.size, 0);
  } finally { h.cleanup(); }
});

for (const scenario of ["unsupported", "rpc-failed", "bad-status", "pending-load", "pending-close", "pending-exit", "no-response"] as const) {
  test(`handoff diagnostics identify ${scenario} without exposing the original sensitive text`, async () => {
    const h = createHarness();
    try {
      const old = h.acquire("old", "a"); h.acquire("old", "b");
      const next = h.acquire("next", "next");
      await old.request("a", "thread/resume", { threadId: "a" });
      const child = h.children[0];
      child.handle = (message) => {
        if (message.method === "thread/resume" && scenario === "pending-load") return true;
        if (message.method !== "thread/unsubscribe") return false;
        if (scenario === "unsupported" || scenario === "rpc-failed") {
          child.send({ id: message.id, error: { code: scenario === "unsupported" ? -32601 : -32603, message: "token=SECRET user answer" } });
        } else if (scenario === "bad-status") child.reply(message, { status: "unknown" });
        else if (scenario !== "no-response") child.reply(message, { status: "unsubscribed" });
        return true;
      };
      if (scenario === "pending-load") {
        const load = old.request("a", "thread/resume", { threadId: "a" });
        void load.catch(() => undefined);
        await waitFor(() => child.messages.filter((message) => message.method === "thread/resume").length === 2);
        old.rejectOwner("a", new Error("abandoned"));
      }
      if (scenario === "pending-exit") old.shutdown("terminate");
      await assert.rejects(next.withThread("next", "a", async () => assert.fail("unsafe resume"), { timeoutMs: 70 }), (error: unknown) => {
        const failure = error as Error & { code: string; diagnostic: import("../../interactive/codexThreadErrors").CodexHandoffDiagnostic };
        assert.equal(failure.code, "CODEX_THREAD_HANDOFF_FAILED");
        const d = failure.diagnostic;
        assert.equal(d.connectionId, old.id); assert.equal(d.threadId, "a");
        assert.equal(d.reason, scenario === "unsupported" ? "protocol_unsupported" : scenario === "rpc-failed" ? "unload_failed" : scenario === "bad-status" ? "invalid_response" : "timeout");
        assert.equal(d.stage, scenario === "pending-load" ? "waiting_load" : scenario === "pending-exit" ? "waiting_exit" : scenario === "pending-close" ? "waiting_close" : "requesting_unload");
        assert.ok(!JSON.stringify(failure).includes("SECRET"));
        assert.ok(!failure.message.includes("SECRET"));
        if (scenario === "unsupported") assert.equal(d.rpcCode, -32601);
        return true;
      });
    } finally { h.cleanup(); }
  });
}


test("resolved notification for another thread cannot cancel a matching request ID", async () => {
  const h = createHarness(); const answer = deferredAnswer(); let asked = false;
  try {
    const connection = h.acquire("shared", "a", undefined, {
      isActive: () => true, handleServerRequest: () => { asked = true; return answer.promise; },
    });
    await connection.request("a", "thread/resume", { threadId: "a" });
    const child = h.children[0]; child.send(question("q", "a"));
    await waitFor(() => asked);
    child.send({ method: "serverRequest/resolved", params: { threadId: "foreign", requestId: "q" } });
    await connection.request("a", "thread/read", { threadId: "a" });
    answer.resolve({ result: { answers: { q: { answers: ["valid"] } } } });
    await waitFor(() => replies(child, "q").length === 1);
    assert.deepEqual(replies(child, "q")[0].result, { answers: { q: { answers: ["valid"] } } });
  } finally { h.cleanup(); }
});

for (const [method, result] of [
  ["item/commandExecution/requestApproval", { decision: "decline" }],
  ["item/fileChange/requestApproval", { decision: "decline" }],
  ["item/permissions/requestApproval", { permissions: {}, scope: "turn" }],
  ["mcpServer/elicitation/request", { action: "cancel", content: null, _meta: null }],
  ["execCommandApproval", { decision: "denied" }],
  ["applyPatchApproval", { decision: "denied" }],
] as const) {
  test(`cancellation preserves native ${method} response and consumes a late rejection`, async () => {
    const h = createHarness(); const answer = deferredAnswer(); let asked = false;
    try {
      const connection = h.acquire("shared", "a", undefined, {
        isActive: () => true, handleServerRequest: () => { asked = true; return answer.promise; },
      });
      h.acquire("shared", "b");
      await connection.request("a", "thread/resume", { threadId: "a" });
      const child = h.children[0];
      child.send({ id: "approval", method, params: method.endsWith("Approval") ? { conversationId: "a" } : { threadId: "a" } });
      await waitFor(() => asked);
      connection.cancelServerRequests("a");
      assert.equal(replies(child, "approval").length, 1);
      assert.deepEqual(replies(child, "approval")[0].result, result);
      answer.reject(new Error("late rejection after cancellation"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(replies(child, "approval").length, 1);
      assert.equal((connection as unknown as { inbound: Map<unknown, unknown> }).inbound.size, 0);
      assert.equal(child.terminationRequests, 0);
    } finally { h.cleanup(); }
  });
}
