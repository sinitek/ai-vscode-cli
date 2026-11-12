import assert = require("node:assert/strict");
import fs = require("fs");
import os = require("os");
import path = require("path");
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { TestContext } from "node:test";
import { blockRealProcessSignals, fakeCodexSpawn } from "../../interactive/codexProcessFixture";
import { createLoopPlusRuntimeFixture } from "./loopPlusRuntimeFixture";

type Request = { id?: number | string; method: string; params: Record<string, unknown> };
type Child = EventEmitter & {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  terminationRequests: number;
  kill: () => boolean;
  exit: () => void;
  send: (message: unknown) => void;
};

// Predicate/event barriers, never an elapsed sleep as evidence of success.
export async function waitForRepair(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out: ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

/** Real orchestration/adapter/session gate/runner/pool; only spawn and its NDJSON peer are controlled. */
export function createLoopPlusCodexRepairFixture(context: TestContext, newConnection: boolean) {
  blockRealProcessSignals(context);
  const errors: Array<{ message: string; data: unknown }> = [];
  const logger = require("../../../logger") as typeof import("../../../logger");
  context.mock.method(logger, "logError", async (message: string, data: unknown) => { errors.push({ message, data }); });
  context.mock.method(logger, "logInfo", async () => undefined);
  context.mock.method(require("../../../interactive/codexAppServerCapabilities"), "resolveCodexThreadUnloadCapability",
    async () => ({ supported: true, reason: "supported", version: "0.167.0" }));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopplus-codex-repair-"));
  const home = path.join(root, "home");
  const firstCwd = path.join(root, "first");
  const repairCwd = newConnection ? path.join(root, "repair") : firstCwd;
  for (const dir of new Set([home, firstCwd, repairCwd])) fs.mkdirSync(dir, { recursive: true });
  const children: Child[] = [];
  const wire: Array<{ child: Child; request: Request }> = [];
  const events: string[] = [];
  let threadSequence = 0;
  let turnSequence = 0;
  let rootSequence = 0;
  let compact: { child: Child; request: Request } | null = null;
  let pollingSteps = 0;
  const realSetTimeout = global.setTimeout;
  // Observe actual pool polling checkpoints without shortening its 75-second deadline.
  context.mock.method(global, "setTimeout", ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
    realSetTimeout(() => { callback(...args); if (delay === 25) pollingSteps += 1; }, delay)) as typeof setTimeout);
  const crossSpawn = require("cross-spawn") as { spawn: (...args: unknown[]) => unknown };
  context.mock.method(crossSpawn, "spawn", fakeCodexSpawn((_command, args, spawnOptions) => {
    assert.ok(Array.isArray(args));
    assert.ok(args.includes("thread_unload_delay_secs=0"), "zero unload policy is present but is not release evidence");
    assert.equal((spawnOptions as { env: NodeJS.ProcessEnv }).env.CODEX_HOME, home);
    const child = new EventEmitter() as Child;
    child.pid = 1_100_000_000 + children.length;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.terminationRequests = 0;
    child.kill = () => { child.terminationRequests += 1; return true; };
    child.send = (message) => { child.stdout.write(`${JSON.stringify(message)}\n`); };
    child.exit = () => {
      if (child.exitCode !== null) return;
      events.push(`exit:${child.pid}`);
      child.exitCode = 0;
      child.emit("exit", 0, null);
      child.stdin.end();
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    };
    children.push(child);
    let buffered = "";
    child.stdin.on("data", (chunk) => {
      buffered += String(chunk);
      const lines = buffered.split(/\r?\n/u);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const request = JSON.parse(line) as Request;
        wire.push({ child, request });
        if (request.id === undefined) continue;
        const reply = (result: unknown) => child.send({ id: request.id, result });
        const threadId = String(request.params?.threadId ?? "");
        if (request.method === "initialize") reply({});
        else if (request.method === "thread/start" || request.method === "thread/resume") {
          const id = threadId || `protocol-thread-${++threadSequence}`;
          events.push(`${request.method}:${id}`);
          reply({ thread: { id } });
        } else if (request.method === "turn/start") {
          const turnId = `protocol-turn-${++turnSequence}`;
          events.push(`turn:${threadId}`);
          reply({ turn: { id: turnId, status: "inProgress" } });
          queueMicrotask(() => {
            child.send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: turnId, delta: `result:${threadId}:${turnId}` } });
            child.send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
          });
        } else if (request.method === "thread/compact/start") {
          assert.equal(compact, null);
          compact = { child, request };
          events.push(`compact-start:${threadId}`);
          // Both ACK and completion/error are released explicitly by the test.
        } else if (request.method === "thread/unsubscribe") {
          events.push(`unsubscribe-ack:${threadId}`);
          reply({ status: "unsubscribed" });
          // Intentionally no thread/closed or notLoaded here.
        } else assert.fail(`unexpected RPC: ${request.method}`);
      }
    });
    return child;
  }, {
    onTaskkill: (pid) => { children.find((child) => child.pid === pid)!.terminationRequests += 1; },
    exitOnTaskkill: false,
  }));

  const { CodexInteractiveRunner } = require("../../../interactive/codexRunner") as typeof import("../../../interactive/codexRunner");
  const { shutdownCodexAppServerPool, countAliveCodexAppServerConnections } = require("../../../interactive/codexAppServerPool") as typeof import("../../../interactive/codexAppServerPool");
  const { scheduleAutoCompactAfterPrompt, loopSubtaskAutoCompactions } = require("../../../loopSubtaskAutoCompact") as typeof import("../../../loopSubtaskAutoCompact");
  const runners: InstanceType<typeof CodexInteractiveRunner>[] = [];
  function runner(cwd: string, threadId: string | null) {
    const created = new CodexInteractiveRunner({
      command: process.execPath, args: ["--sandbox", "workspace-write", "--ask-for-approval", "never"],
      cwd, env: { CODEX_HOME: home }, threadId, thinkingMode: "low", interactiveMode: "coding",
      model: "sub-model", configFingerprint: "same-effective-profile",
    });
    runners.push(created);
    return created;
  }
  const other = runner(firstCwd, null);
  const fixture = createLoopPlusRuntimeFixture({
    configId: "sub-profile", maxConcurrency: 2,
    executionRootFactory: () => ({ cwd: rootSequence++ === 0 ? firstCwd : repairCwd, dispose: () => undefined }),
  });
  let original: InstanceType<typeof CodexInteractiveRunner> | null = null;
  let originalThread: string | null = null;
  fixture.setAttemptAction(async (input, tabId) => {
    assert.equal(input.model, "sub-model");
    assert.equal(input.loopSubtaskConfigId, "sub-profile");
    const target = fixture.createdSubtaskTargets.find((item) => item.tabId === tabId)!;
    const current = runner(input.executionCwd!, target.sessionId);
    let text = "";
    await current.runStreamed(input.modelPrompt ?? input.displayPrompt, {
      onThreadId: (id) => { target.sessionId = id; },
      onAssistantDelta: (chunk) => { text += chunk; },
      onTrace: () => undefined, onTaskListUpdate: () => undefined,
    });
    assert.ok(text.startsWith(`result:${current.getThreadId()}:`), "attempt content comes from the running protocol peer");
    if (input.loopSubtaskId === "A") {
      original = current;
      originalThread = current.getThreadId();
      assert.equal(target.sessionId, originalThread);
      await scheduleAutoCompactAfterPrompt(input, target, async (options) => {
        assert.equal(options.isolatedRun, true);
        events.push("background-compact");
        try { await current.compactThread(); }
        finally { events.push("compact-settled"); }
      });
    }
    fixture.publish(input, tabId, { status: "end", content: text });
  });

  return {
    fixture, children, wire, events, errors, other,
    originalThread: () => originalThread,
    pollingSteps: () => pollingSteps,
    original: () => original!,
    compactStarted: () => compact !== null,
    pendingCompact: () => loopSubtaskAutoCompactions.has("codex", originalThread),
    finishCompact: (reject: boolean) => {
      assert.ok(compact);
      const { child, request } = compact;
      events.push(reject ? "compact-rejected" : "compact-completed");
      child.send(reject
        ? { id: request.id, error: { code: -32000, message: "controlled compaction rejection" } }
        : { id: request.id, result: {} });
      if (!reject) child.send({ method: "thread/compacted", params: { threadId: request.params.threadId } });
    },
    closeOriginalThread: () => {
      events.push(`closed:${originalThread}`);
      children[0].send({ method: "thread/closed", params: { threadId: originalThread } });
    },
    cleanup: async (running?: Promise<unknown>) => {
      for (const input of fixture.mainCalls) {
        if (input.loopTaskId) fixture.adapter.host().stopParent(input.loopTaskId);
      }
      fixture.releaseHeldMain();
      for (const item of runners) item.dispose();
      shutdownCodexAppServerPool();
      for (const child of children) child.exit();
      await running?.catch(() => undefined);
      await loopSubtaskAutoCompactions.wait("codex", originalThread);
      assert.equal(loopSubtaskAutoCompactions.has("codex", originalThread), false);
      assert.equal(countAliveCodexAppServerConnections(), 0);
      for (const child of children) {
        assert.equal(child.exitCode, 0);
        assert.equal(child.stdin.writableEnded, true);
        assert.equal(child.stdout.writableEnded, true);
        assert.equal(child.stderr.writableEnded, true);
      }
      fixture.dispose();
      // The absolute target is the directory created above, never a user CLI directory.
      assert.equal(path.dirname(root), os.tmpdir());
      fs.rmSync(root, { recursive: true, force: true });
      assert.equal(fs.existsSync(root), false);
      assert.equal(fs.existsSync(fixture.rootDir), false);
    },
  };
}
