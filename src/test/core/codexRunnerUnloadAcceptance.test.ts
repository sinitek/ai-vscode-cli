import * as assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

const { verifyRunnerEvidence, waitFor } = require(path.resolve(__dirname, "../../../scripts/verify_codex_runner_unload.js")) as {
  verifyRunnerEvidence: (evidence: ReturnType<typeof fixture>) => { immediateThreadUnload: boolean; releaseEvidence: string };
  waitFor: (predicate: () => boolean, timeoutMs: number, phase: string) => Promise<void>;
};

function fixture(supported = true) {
  const command = "C:/isolated CLI/codex.cmd";
  let sequence = 4;
  const events: { process: number; method: string; direction: string; threadId: string; seq: number; status?: string; persisted?: boolean; failed?: boolean }[] = [];
  const event = (process: number, method: string, direction: string, threadId: string, extra = {}) => {
    events.push({ process, method, direction, threadId, seq: ++sequence, ...extra });
  };
  event(0, "thread/start", "response", "target", { persisted: true });
  event(0, "turn/start", "request", "target");
  event(0, "turn/completed", "notification", "target", { status: "failed" });
  event(0, "thread/start", "response", "peer");
  event(0, "turn/start", "request", "peer");
  event(0, "turn/completed", "notification", "peer", { status: "failed" });
  const migrationSeq = ++sequence;
  event(0, "thread/unsubscribe", "request", "target");
  event(0, "thread/unsubscribe", "response", "target", { status: "unsubscribed" });
  event(0, "thread/closed", "notification", "target");
  event(1, "thread/resume", "request", "target");
  event(1, "thread/resume", "response", "target");
  event(1, "turn/start", "request", "target");
  event(1, "turn/completed", "notification", "target", { status: "failed" });
  const peerCheckSeq = ++sequence;
  event(0, "turn/start", "request", "peer");
  event(0, "turn/completed", "notification", "peer", { status: "failed" });
  return {
    capabilities: [{ command, supported, reason: supported ? "supported" : "unknown", version: "0.162.1", seq: 1 }],
    probes: [{ command, version: "0.162.1", closed: true }],
    processes: [123, 456].map((pid, index) => ({ command, pid, seq: index + 2,
      args: ["app-server", "--listen", "stdio://", ...(supported ? ["-c", "thread_unload_delay_secs=0"] : [])] })),
    events, migrationSeq, peerCheckSeq, targetThread: "target", peerThread: "peer", elapsedMs: 43,
    localRequests: 4, cleanup: { processesExited: true, stdioClosed: true, temporaryDirectoryRemoved: true },
  };
}

test("runner evidence accepts real release, original thread, retained peer, and complete cleanup", () => {
  assert.equal(verifyRunnerEvidence(fixture()).immediateThreadUnload, true);
  const compatible = fixture(false);
  assert.equal(verifyRunnerEvidence(compatible).immediateThreadUnload, false);
  compatible.capabilities[0].reason = "unsupported";
  assert.equal(verifyRunnerEvidence(compatible).immediateThreadUnload, false);
});

test("runner evidence requires actual version probe and capability for the spawned target", () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { value.probes = []; },
    (value: ReturnType<typeof fixture>) => { value.probes[0].closed = false; },
    (value: ReturnType<typeof fixture>) => { value.probes[0].version = "0.167.0"; },
    (value: ReturnType<typeof fixture>) => { value.capabilities = []; },
    (value: ReturnType<typeof fixture>) => { value.capabilities[0].command = "other CLI"; },
    (value: ReturnType<typeof fixture>) => { value.capabilities[0].seq = 999; },
  ]) {
    const value = fixture(); mutate(value); assert.throws(() => verifyRunnerEvidence(value));
  }
});

test("runner evidence rejects missing supported override and unconfirmed or conflicting overrides", () => {
  const missing = fixture(); missing.processes[0].args = ["app-server", "--listen", "stdio://"];
  assert.throws(() => verifyRunnerEvidence(missing));
  for (const reason of ["unknown", "unsupported"]) {
    const value = fixture(); value.capabilities[0].reason = reason;
    assert.throws(() => verifyRunnerEvidence(value));
  }
  const conflict = fixture(); conflict.processes[0].args.push("-c", "thread_unload_delay_secs=90");
  assert.throws(() => verifyRunnerEvidence(conflict));
});

test("runner evidence rejects ACK, logical close and kill request as writer release", () => {
  for (const method of ["kill/request", "connection/closed", "thread/unsubscribe"]) {
    const value = fixture();
    const release = value.events.find((event) => event.method === "thread/closed")!;
    release.method = method; release.direction = "response"; release.status = "unsubscribed";
    assert.throws(() => verifyRunnerEvidence(value), /真实释放/);
  }
  const notLoaded = fixture();
  const release = notLoaded.events.find((event) => event.method === "thread/closed")!;
  release.method = "thread/unsubscribe"; release.direction = "response"; release.status = "notLoaded";
  assert.equal(verifyRunnerEvidence(notLoaded).releaseEvidence, "notLoaded");
});

test("runner evidence rejects late release, failed resume, substitute thread and retries", () => {
  const late = fixture(); late.events.find((event) => event.method === "thread/closed")!.seq = 999;
  assert.throws(() => verifyRunnerEvidence(late));
  const failed = fixture(); failed.events.find((event) => event.method === "thread/resume" && event.direction === "response")!.failed = true;
  assert.throws(() => verifyRunnerEvidence(failed));
  const changed = fixture(); changed.targetThread = "substitute";
  assert.throws(() => verifyRunnerEvidence(changed));
  const retry = fixture(); retry.events.push({ ...retry.events.find((event) => event.method === "thread/resume" && event.direction === "request")!, seq: 999 });
  assert.throws(() => verifyRunnerEvidence(retry));
});

test("runner evidence requires the retained peer to continue on the original process without reloading", () => {
  const moved = fixture(); moved.events.find((event) => event.threadId === "peer" && event.seq > moved.peerCheckSeq)!.process = 1;
  assert.throws(() => verifyRunnerEvidence(moved));
  const reloaded = fixture(); reloaded.events.push({ process: 0, method: "thread/resume", direction: "request", threadId: "peer", seq: 999 });
  assert.throws(() => verifyRunnerEvidence(reloaded));
  const exited = fixture(); exited.events.push({ process: 0, method: "process/exit", direction: "lifecycle", threadId: "", seq: exited.peerCheckSeq });
  assert.throws(() => verifyRunnerEvidence(exited));
});

test("runner evidence rejects incomplete local turns, deadline and resource cleanup", () => {
  const noTurn = fixture(); noTurn.events.pop(); assert.throws(() => verifyRunnerEvidence(noTurn));
  const noRequests = fixture(); noRequests.localRequests = 0; assert.throws(() => verifyRunnerEvidence(noRequests));
  const late = fixture(); late.elapsedMs = 75000; assert.throws(() => verifyRunnerEvidence(late));
  for (const key of ["processesExited", "stdioClosed", "temporaryDirectoryRemoved"] as const) {
    const incomplete = fixture(); incomplete.cleanup[key] = false;
    assert.throws(() => verifyRunnerEvidence(incomplete), /清理/);
  }
});

test("runner notification timeout stops polling and leaves no outstanding timer", async (context) => {
  let now = 0;
  let calls = 0;
  context.mock.method(Date, "now", () => now);
  context.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => {
    calls += 1;
    now += delay;
    callback();
    return 1 as unknown as NodeJS.Timeout;
  });
  await assert.rejects(waitFor(() => false, 45, "notification"), /notification超时/);
  assert.equal(calls, 3);
  await Promise.resolve();
  assert.equal(calls, 3, "a rejected wait cannot schedule background polling");
  await waitFor(() => true, 45, "notification");
  assert.equal(calls, 3);
});
