import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { TestContext } from "node:test";
import type { CodexInteractiveRunner, CodexStreamHandlers } from "../../../interactive/codexRunner";
import type { JsonRpcResolution } from "../../../interactive/codexAppServerProtocol";
import { blockRealProcessSignals, fakeCodexSpawn } from "../../interactive/codexProcessFixture";

type Message = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown };
type Child = EventEmitter & {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  terminationRequests: number;
  kill: () => boolean;
  send: (message: unknown) => void;
  exit: () => void;
};
type Question = {
  id: string;
  child: Child;
  threadId: string;
  turnId: string;
  answer?: (resolution: JsonRpcResolution) => void;
};

// Bounded predicate waits observe protocol/pool events, never elapsed time as release proof.
export async function waitForConfigHandoff(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out: ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

/** Real identity, manager, public runner and pool; only OS processes/probes and RPC peer are controlled. */
export function createCodexRuntimeConfigHandoffFixture(context: TestContext, home: string, cwd: string) {
  blockRealProcessSignals(context);
  context.mock.method(require("../../../interactive/codexAppServerCapabilities"), "resolveCodexThreadUnloadCapability",
    async () => ({ supported: true, reason: "supported", version: "0.167.0" }));
  const { InteractiveRunnerManager } = require("../../../interactive/manager") as typeof import("../../../interactive/manager");
  const { shutdownCodexAppServerPool, countAliveCodexAppServerConnections } = require("../../../interactive/codexAppServerPool") as typeof import("../../../interactive/codexAppServerPool");
  const manager = new InteractiveRunnerManager();
  const children: Child[] = [];
  const wire: Array<{ child: Child; message: Message }> = [];
  const events: string[] = [];
  const questions: Question[] = [];
  const running: Promise<unknown>[] = [];
  let threadSequence = 0;
  let turnSequence = 0;
  let pollingSteps = 0;
  const realSetTimeout = global.setTimeout;
  // Observe real waitStep checkpoints without changing the 75-second handoff deadline.
  context.mock.method(global, "setTimeout", ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
    realSetTimeout(() => { callback(...args); if (delay === 25) pollingSteps += 1; }, delay)) as typeof setTimeout);

  function complete(child: Child, threadId: string, turnId: string) {
    events.push(`complete:${turnId}`);
    child.send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: turnId, delta: `result:${threadId}:${turnId}` } });
    child.send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
  }
  context.mock.method(require("cross-spawn"), "spawn", fakeCodexSpawn((command, args, spawnOptions) => {
    assert.equal(command, process.execPath);
    assert.ok(Array.isArray(args) && args.includes("app-server"));
    assert.ok(args.includes("thread_unload_delay_secs=0"), "zero delay is configured, never treated as release evidence");
    const options = spawnOptions as { cwd: string; env: NodeJS.ProcessEnv };
    assert.equal(options.cwd, cwd, "configuration migration keeps the workspace fixed");
    assert.equal(options.env.CODEX_HOME, home);
    const child = new EventEmitter() as Child;
    child.pid = 1_200_000_000 + children.length;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null; child.signalCode = null; child.terminationRequests = 0;
    child.kill = () => {
      events.push(`termination-request:${child.pid}`);
      child.terminationRequests += 1;
      return true;
    };
    child.send = (message) => { child.stdout.write(`${JSON.stringify(message)}\n`); };
    child.exit = () => {
      if (child.exitCode !== null) return;
      events.push(`exit:${child.pid}`);
      child.exitCode = 0;
      child.emit("exit", 0, null);
      child.stdin.end(); child.stdout.end(); child.stderr.end();
      child.emit("close", 0, null);
    };
    children.push(child);
    let buffer = "";
    child.stdin.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/u); buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as Message;
        wire.push({ child, message });
        if (!message.method) {
          const question = questions.find((item) => item.child === child && item.id === message.id);
          assert.ok(question, `unexpected client reply: ${message.id}`);
          events.push(`answer:${question.id}`);
          const result = message.result as { answers?: Record<string, unknown> } | undefined;
          if (result?.answers && Object.keys(result.answers).length) complete(child, question.threadId, question.turnId);
          continue;
        }
        if (message.id === undefined) {
          assert.equal(message.method, "initialized");
          continue;
        }
        const reply = (result: unknown) => child.send({ id: message.id, result });
        const threadId = String(message.params?.threadId ?? "");
        if (message.method === "initialize") reply({});
        else if (message.method === "turn/interrupt") {
          events.push(`interrupt:${threadId}`);
          reply({});
        }
        else if (message.method === "thread/start" || message.method === "thread/resume") {
          const id = threadId || `config-thread-${++threadSequence}`;
          events.push(`${message.method}:${id}:${child.pid}`);
          reply({ thread: { id } });
        } else if (message.method === "turn/start") {
          const turnId = `config-turn-${++turnSequence}`;
          events.push(`turn:${threadId}:${child.pid}`);
          reply({ turn: { id: turnId, status: "inProgress" } });
          queueMicrotask(() => {
            const input = message.params?.input as Array<{ text?: string }>;
            if (input.some((item) => item.text?.startsWith("ask:"))) {
              const question = { id: `question-${turnId}`, child, threadId, turnId };
              questions.push(question);
              events.push(`question:${question.id}`);
              child.send({ id: question.id, method: "item/tool/requestUserInput", params: { threadId, turnId, questions: [] } });
            } else complete(child, threadId, turnId);
          });
        } else if (message.method === "thread/compact/start") {
          events.push(`compact:${threadId}:${child.pid}`);
          reply({});
          child.send({ method: "thread/compacted", params: { threadId } });
        } else if (message.method === "thread/unsubscribe") {
          events.push(`unsubscribe-ack:${threadId}`);
          reply({ status: "unsubscribed" });
          // No notLoaded / thread/closed / loaded-list inference: test owns release.
        } else assert.fail(`unexpected RPC: ${message.method}`);
      }
    });
    return child;
  }, { exitOnTaskkill: false, onTaskkill: (pid) => {
    events.push(`termination-request:${pid}`);
    children.find((child) => child.pid === pid)!.terminationRequests += 1;
  } }));

  const handlers: CodexStreamHandlers = {
    onAssistantDelta: () => undefined, onTrace: () => undefined,
    onTaskListUpdate: () => undefined, onThreadId: () => undefined,
    requestUserInputEnabled: true,
    onRequest: (request) => {
      assert.equal(request.method, "item/tool/requestUserInput");
      const params = request.params as { threadId: string; turnId: string };
      const question = questions.find((item) => item.threadId === params.threadId && item.turnId === params.turnId)!;
      assert.ok(question);
      return new Promise<JsonRpcResolution>((resolve) => { question.answer = resolve; });
    },
  };
  return {
    manager, children, wire, events, questions,
    pollingSteps: () => pollingSteps,
    runner: (sessionId: string, threadId: string | null, configFingerprint: string) => manager.getOrCreateCodexRunner({
      sessionId, threadId, configFingerprint, command: process.execPath,
      args: ["--sandbox", "workspace-write", "--ask-for-approval", "never"],
      cwd, thinkingMode: "medium", interactiveMode: "coding", model: "fixture-sub-model", configId: "fixture-profile",
    }),
    run: (runner: CodexInteractiveRunner, prompt: string) => {
      let text = "";
      const operation = runner.runStreamed(prompt, { ...handlers, onAssistantDelta: (chunk) => { text += chunk; } })
        .then(() => text);
      void operation.catch(() => undefined);
      running.push(operation);
      return operation;
    },
    compact: (runner: CodexInteractiveRunner) => {
      const operation = runner.compactThread();
      void operation.catch(() => undefined);
      running.push(operation);
      return operation;
    },
    replies: (question: Question) => wire.filter((entry) => entry.child === question.child
      && !entry.message.method && entry.message.id === question.id).map((entry) => entry.message.result),
    answer: (question: Question, value: string) => {
      assert.ok(question.answer);
      question.answer({ result: { answers: { choice: { answers: [value] } } } });
    },
    closeThread: (child: Child, threadId: string) => {
      events.push(`closed:${threadId}`);
      child.send({ method: "thread/closed", params: { threadId } });
    },
    cleanup: async () => {
      manager.disposeAll();
      shutdownCodexAppServerPool();
      for (const child of children) child.exit();
      for (const question of questions) question.answer?.({ result: { answers: {} } });
      await Promise.allSettled(running);
      assert.equal(countAliveCodexAppServerConnections(), 0);
      for (const child of children) {
        assert.equal(child.exitCode, 0);
        assert.ok([child.stdin, child.stdout, child.stderr].every((stream) => stream.writableEnded));
      }
    },
  };
}
