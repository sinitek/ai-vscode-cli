import assert = require("node:assert/strict");
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as path from "node:path";
import { test, TestContext } from "node:test";

type State = { exited: boolean; closed: boolean; streams: Record<string, { ended: boolean; closed: boolean }> };
type Tracked = { state: State; done: Promise<unknown> };
type Server = { closeAllConnections: () => void; close: (callback: (error?: Error) => void) => void };
const { cleanup, trackChild } = require(path.resolve(__dirname, "../../../scripts/verify_codex_thread_handoff.js")) as {
  trackChild: (child: EventEmitter, command: string) => Tracked;
  cleanup: (options: { shutdown: () => void; server: Server; tracked: Tracked[]; removeRoot: () => unknown;
    emit: (event: Record<string, unknown>) => void; root: string; timeoutMs: number }) => Promise<void>;
};

const closedServer: Server = { closeAllConnections: () => {}, close: (callback) => callback() };
function mockPlatform(t: TestContext, platform: NodeJS.Platform) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(descriptor);
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  t.after(() => { Object.defineProperty(process, "platform", descriptor); });
}

function childFixture() {
  // No termination API is called by this fixture; its PID is used only in diagnostics.
  const child = Object.assign(new EventEmitter(), { pid: 987654321,
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const tracked = trackChild(child, "fixture");
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.resume();
  return { child, tracked };
}

test("handoff cleanup preserves output after exit and waits for every stdio close and directory removal", async () => {
  const { child, tracked } = childFixture();
  const events: Record<string, unknown>[] = [];
  const tail: string[] = [];
  child.stdout.on("data", (data) => tail.push(String(data)));
  let removed = false;
  const result = cleanup({ shutdown: () => {}, server: closedServer, tracked: [tracked],
    removeRoot: () => { removed = true; }, emit: (event) => events.push(event), root: "fixture-only", timeoutMs: 1000 });
  child.emit("exit", 0, null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(removed, false);
  assert.equal(events.length, 0);
  child.stdout.end("tail after exit\n");
  child.stderr.end();
  child.emit("close", 0, null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(removed, false, "child close alone must not bypass stdin close");
  child.stdin.end();
  await result;
  assert.deepEqual(tail, ["tail after exit\n"]);
  assert.equal(removed, true);
  assert.equal(events[0].phase, "cleanup_verified");
  assert.ok(Object.values(tracked.state.streams).every((stream) => stream.closed));
});

for (const blocked of ["server", "stdio"]) {
  test(`handoff cleanup reports ${blocked} timeout without removing pipes or claiming success`, async () => {
    const events: Record<string, unknown>[] = [];
    let removed = false;
    const fixture = childFixture();
    const server = blocked === "server" ? { ...closedServer, close: () => {} } : closedServer;
    try {
      if (blocked === "stdio") fixture.child.emit("exit", 1, null);
      await assert.rejects(cleanup({ shutdown: () => {}, server,
        tracked: blocked === "stdio" ? [fixture.tracked] : [], root: "fixture-only",
        removeRoot: () => { removed = true; }, emit: (event) => events.push(event), timeoutMs: 15 }), /资源清理超时/);
      assert.equal(removed, false);
      assert.equal(events.length, 1);
      assert.equal(events[0].phase, "cleanup_failed");
      assert.equal(fixture.child.stdout.destroyed, false);
      assert.equal(fixture.child.stderr.destroyed, false);
      if (blocked === "stdio") {
        assert.equal(fixture.tracked.state.exited, true);
        assert.equal(fixture.tracked.state.closed, false);
      }
    } finally {
      fixture.child.stdin.end(); fixture.child.stdout.end(); fixture.child.stderr.end();
      fixture.child.emit("close", 1, null);
      await fixture.tracked.done;
    }
  });
}

test("handoff cleanup reports directory removal errors after normal process close", async () => {
  const events: Record<string, unknown>[] = [];
  await assert.rejects(cleanup({ shutdown: () => {}, server: closedServer, tracked: [], root: "fixture-only",
    removeRoot: () => { throw new Error("directory remains busy"); }, emit: (event) => events.push(event), timeoutMs: 1000 }), /directory remains busy/);
  assert.equal(events.length, 1);
  assert.equal(events[0].phase, "cleanup_failed");
});

for (const code of ["EPERM", "EBUSY", "ENOTEMPTY"]) {
  test(`Windows handoff cleanup retries transient ${code} removal only after close`, async (t) => {
    mockPlatform(t, "win32");
    const { child, tracked } = childFixture();
    const events: Record<string, unknown>[] = [];
    let attempts = 0;
    const result = cleanup({ shutdown: () => {}, server: closedServer, tracked: [tracked], root: "fixture-only",
      removeRoot: () => {
        assert.equal(tracked.state.exited, true);
        assert.ok(Object.values(tracked.state.streams).every((stream) => stream.closed));
        assert.equal(events.length, 0, "no success before the directory is removed");
        if (++attempts === 1) throw Object.assign(new Error("temporarily busy"), { code });
      }, emit: (event) => events.push(event), timeoutMs: 1000 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(attempts, 0);
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.end();
    child.emit("exit", 0, null); child.emit("close", 0, null);
    await result;
    assert.equal(attempts, 2);
    assert.equal(events.length, 1);
    assert.equal(events[0].phase, "cleanup_verified");
  });
}

test("Windows handoff cleanup fails bounded persistent removal errors without claiming success", async (t) => {
  mockPlatform(t, "win32");
  const events: Record<string, unknown>[] = [];
  let attempts = 0;
  await assert.rejects(cleanup({ shutdown: () => {}, server: closedServer, tracked: [], root: "fixture-only",
    removeRoot: () => { attempts += 1; throw Object.assign(new Error("still busy"), { code: "EPERM" }); },
    emit: (event) => events.push(event), timeoutMs: 5000 }), /still busy/);
  assert.equal(attempts, 6);
  assert.deepEqual(events.map((event) => event.phase), ["cleanup_failed"]);
});

test("Windows handoff cleanup stops removal retries at its original deadline", async (t) => {
  mockPlatform(t, "win32");
  const events: Record<string, unknown>[] = [];
  let attempts = 0;
  await assert.rejects(cleanup({ shutdown: () => {}, server: closedServer, tracked: [], root: "fixture-only",
    removeRoot: () => { attempts += 1; throw Object.assign(new Error("busy past deadline"), { code: "EBUSY" }); },
    emit: (event) => events.push(event), timeoutMs: 20 }), /资源清理超时/);
  const attemptsAtTimeout = attempts;
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  assert.equal(attempts, attemptsAtTimeout, "timed-out cleanup must not delete later");
  assert.deepEqual(events.map((event) => event.phase), ["cleanup_failed"]);
});

for (const platform of ["darwin", "linux"] as const) {
  for (const code of ["EPERM", "EBUSY", "ENOTEMPTY"]) {
    test(`${platform} handoff cleanup preserves one removal attempt for ${code}`, async (t) => {
      mockPlatform(t, platform);
      const events: Record<string, unknown>[] = [];
      const error = Object.assign(new Error("directory remains busy"), { code });
      let attempts = 0;
      await assert.rejects(cleanup({ shutdown: () => {}, server: closedServer, tracked: [], root: "fixture-only",
        removeRoot: () => { attempts += 1; throw error; }, emit: (event) => events.push(event), timeoutMs: 1000 }),
      (caught: unknown) => caught === error);
      assert.equal(attempts, 1);
      assert.deepEqual(events.map((event) => event.phase), ["cleanup_failed"]);
    });
  }
}

test("handoff cleanup includes shutdown escalation children created while draining", async () => {
  const first = childFixture();
  const later = childFixture();
  const tracked = [first.tracked];
  let removed = false;
  const result = cleanup({ shutdown: () => {}, server: closedServer, tracked, root: "fixture-only",
    removeRoot: () => { removed = true; }, emit: () => {}, timeoutMs: 1000 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  tracked.push(later.tracked);
  for (const stream of [first.child.stdin, first.child.stdout, first.child.stderr]) stream.end();
  first.child.emit("exit", 0, null); first.child.emit("close", 0, null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(removed, false);
  for (const stream of [later.child.stdin, later.child.stdout, later.child.stderr]) stream.end();
  later.child.emit("exit", 0, null); later.child.emit("close", 0, null);
  await result;
  assert.equal(removed, true);
});
