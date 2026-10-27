import assert = require("node:assert/strict");
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import test = require("node:test");

import { installVscodeMock } from "../vscodeMock";
import type { KimiChild, KimiSpawn } from "../../interactive/kimiRunner";
import { createKimiCodeDefaultConfigText, writeKimiCodeConfigText } from "../../config/kimiCodeConfig";

installVscodeMock();

const {
  KimiInteractiveRunner,
  KimiCompactionUnsupportedError,
} = require("../../interactive/kimiRunner") as typeof import("../../interactive/kimiRunner");

const SESSION_ID = "session_11111111-1111-4111-8111-111111111111";
const MODEL = "subcoco/kimi-k3.1-pro";

class FakeKimi extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public pid = 515151;
  public readonly lines: string[] = [];
  public protocolVersion = 1;
  public sessionId: string | null = SESSION_ID;
  public newSessionId: string = SESSION_ID;
  public modelCurrent = MODEL;
  public modelOptions = [MODEL];
  public thinkingCurrent = "high";
  public thinkingOptions = ["off", "low", "medium", "high", "xhigh", "max"];
  public modeCurrent = "default";
  public modeOptions = ["default", "plan", "auto", "yolo"];
  public failResume = false;
  public permissionOptionId = "approve_once";
  private pendingPrompt: Record<string, unknown> | null = null;
  private buffer = "";

  public constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      this.buffer += chunk;
      const parts = this.buffer.split("\n");
      this.buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) {
          continue;
        }
        this.lines.push(line);
        this.respond(JSON.parse(line) as Record<string, unknown>);
      }
    });
  }

  public kill(signal?: NodeJS.Signals): boolean {
    this.signalCode = signal ?? null;
    return true;
  }

  public methods(): string[] {
    return this.lines.map((line) => String((JSON.parse(line) as { method?: string }).method ?? ""));
  }

  public send(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  public configOptions(): Record<string, unknown>[] {
    return [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: this.modelCurrent,
        options: this.modelOptions.map((value) => ({ value, name: value })),
      },
      {
        id: "thinking",
        name: "Thinking",
        category: "thought_level",
        type: "select",
        currentValue: this.thinkingCurrent,
        options: this.thinkingOptions.map((value) => ({ value, name: value })),
      },
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: this.modeCurrent,
        options: this.modeOptions.map((value) => ({ value, name: value })),
      },
    ];
  }

  public sessionState(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      configOptions: this.configOptions(),
      modes: {
        currentModeId: this.modeCurrent,
        availableModes: this.modeOptions.map((id) => ({ id, name: id })),
      },
    };
  }

  public requestPermission(sessionId: string): void {
    this.send({
      jsonrpc: "2.0",
      id: "perm-1",
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: { toolCallId: "tool-1", title: "Write hello.txt" },
        options: [
          { optionId: "approve_once", kind: "allow_once", name: "Allow once" },
          { optionId: "approve_always", kind: "allow_always", name: "Always allow" },
          { optionId: "reject", kind: "reject_once", name: "Reject" },
        ],
      },
    });
  }

  public finishPrompt(message: Record<string, unknown>): void {
    const params = message.params as { sessionId?: string };
    this.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "think-1",
          content: { type: "text", text: "thinking" },
        },
      },
    });
    this.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-1",
          content: { type: "text", text: "done" },
        },
      },
    });
    this.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Write",
          status: "pending",
          rawInput: { path: "hello.txt" },
        },
      },
    });
    this.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "wrote hello.txt" } }],
        },
      },
    });
    this.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: { sessionUpdate: "usage_update", used: 42, size: 262144 },
      },
    });
    this.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  }

  public holdPrompt(message: Record<string, unknown>): void {
    this.pendingPrompt = message;
  }

  public releasePrompt(): void {
    const pending = this.pendingPrompt;
    this.pendingPrompt = null;
    if (pending) {
      this.finishPrompt(pending);
    }
  }

  private respond(message: Record<string, unknown>): void {
    const id = message.id;
    const method = String(message.method ?? "");
    if (id === "perm-1") {
      return;
    }
    if (method === "initialize") {
      this.send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: this.protocolVersion,
          agentInfo: { name: "Kimi Code CLI", version: "2.3.2" },
          agentCapabilities: { loadSession: true },
        },
      });
      return;
    }
    if (method === "session/new") {
      const state = this.sessionState();
      this.send({ jsonrpc: "2.0", id, result: { ...state, sessionId: this.newSessionId } });
      return;
    }
    if (method === "session/resume") {
      if (this.failResume) {
        this.send({ jsonrpc: "2.0", id, error: { code: -32602, message: "session is not resumable" } });
        return;
      }
      this.send({ jsonrpc: "2.0", id, result: this.sessionState() });
      return;
    }
    if (method === "session/set_config_option") {
      const params = message.params as { configId?: string; value?: string };
      if (params.configId === "thinking") {
        if (!this.thinkingOptions.includes(String(params.value))) {
          this.send({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: `unknown thinking option: ${String(params.value)}` },
          });
          return;
        }
        this.thinkingCurrent = String(params.value);
      }
      if (params.configId === "mode") {
        if (!this.modeOptions.includes(String(params.value))) {
          this.send({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: `unknown mode: ${String(params.value)}` },
          });
          return;
        }
        this.modeCurrent = String(params.value);
      }
      if (params.configId === "model") {
        this.modelCurrent = String(params.value);
      }
      this.send({
        jsonrpc: "2.0",
        id,
        result: {
          configOptions: this.configOptions(),
          modes: {
            currentModeId: this.modeCurrent,
            availableModes: this.modeOptions.map((value) => ({ id: value, name: value })),
          },
        },
      });
      return;
    }
    if (method === "session/prompt") {
      if (this.pendingPrompt === null && this.pendingPromptRequested) {
        this.holdPrompt(message);
        return;
      }
      this.finishPrompt(message);
      return;
    }
    if (method === "session/close") {
      this.send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
  }

  public pendingPromptRequested = false;
}

function createRunner(fake: FakeKimi, options: Partial<ConstructorParameters<typeof KimiInteractiveRunner>[0]> = {}): {
  runner: InstanceType<typeof KimiInteractiveRunner>;
  spawnArgs: string[];
  spawnCommand: string;
  spawnOptions: { env?: NodeJS.ProcessEnv; detached?: boolean };
  signals: string[];
} {
  const signals: string[] = [];
  const spawnArgs: string[] = [];
  const spawnCommand = { value: "" };
  const spawnOptions: { env?: NodeJS.ProcessEnv; detached?: boolean } = {};
  const spawnImpl: KimiSpawn = (command, args, spawnOptionsArg) => {
    spawnCommand.value = command;
    spawnArgs.splice(0, spawnArgs.length, ...args);
    spawnOptions.env = spawnOptionsArg.env;
    spawnOptions.detached = spawnOptionsArg.detached;
    return fake as unknown as KimiChild;
  };
  const runner = new KimiInteractiveRunner({
    cwd: "/tmp/kimi-work",
    command: "kimi",
    env: { PATH: process.env.PATH ?? "" },
    spawnImpl,
    killTreeImpl: (_child, signal) => {
      signals.push(String(signal));
      return true;
    },
    ...options,
  });
  return { runner, spawnArgs, spawnCommand: spawnCommand.value, spawnOptions, signals };
}

test("Kimi ACP handshake launches kimi acp and settles only from stopReason", async () => {
  const fake = new FakeKimi();
  const spawnArgs: string[] = [];
  const spawnCommand = "";
  void spawnCommand;
  const created = createRunner(fake, {
    agentArgs: ["--region", "global"],
    model: MODEL,
    thinkingMode: "high",
    modeId: "yolo",
  });
  const started = await created.runner.start();
  assert.equal(started.resumed, false);
  assert.equal(started.acpSessionId, SESSION_ID);
  assert.deepEqual(created.spawnArgs, ["acp", "--region", "global"]);
  assert.equal(created.runner.isReusable(), true);
  assert.deepEqual(created.runner.getConfigSnapshot(), {
    model: MODEL,
    thinking: "high",
    modeId: "yolo",
    modelOptions: [MODEL],
    thinkingOptions: ["off", "low", "medium", "high", "xhigh", "max"],
    modeOptions: ["default", "plan", "auto", "yolo"],
  });

  const deltas: string[] = [];
  const traces: string[] = [];
  const tasks: unknown[] = [];
  const usage: unknown[] = [];
  const replayEvents: Record<string, unknown>[] = [];
  let completed = "";
  const result = await created.runner.prompt("write hello.txt", {
    onAssistantDelta: (text) => deltas.push(text),
    onTrace: (text, kind) => traces.push(`${kind ?? "normal"}:${text}`),
    onTaskListUpdate: (items) => tasks.push(items),
    onTokenUsageUpdate: (update) => usage.push(update),
    onEvent: (event) => replayEvents.push(event as Record<string, unknown>),
    onComplete: (meta) => {
      completed = meta.stopReason;
    },
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(completed, "end_turn");
  assert.deepEqual(deltas, ["done"]);
  assert.equal(traces.some((trace) => trace === "thinking:thinking"), true);
  assert.equal(traces.some((trace) => trace.startsWith("tool-use:")), true);
  assert.deepEqual(usage, [{ tokensInContextWindow: 42, modelContextWindow: 262144 }]);
  assert.deepEqual(replayEvents.map((event) => (event.params as { update: { sessionUpdate: string } }).update.sessionUpdate), [
    "agent_message_chunk",
    "tool_call",
    "tool_call_update",
  ]);
  assert.equal(Array.isArray(tasks), true);
  assert.equal(fake.methods().includes("session/load"), false);
  assert.equal(fake.methods().includes("session/close"), false);
  assert.equal(fake.lines.some((line) => line.includes("OPENAI_API_KEY")), false);
});

test("Kimi permission requests auto-approve with an advertised allow option", async () => {
  const fake = new FakeKimi();
  const { runner } = createRunner(fake, { model: MODEL });
  await runner.start();
  fake.pendingPromptRequested = false;
  const originalFinish = fake.finishPrompt.bind(fake);
  fake.finishPrompt = ((message: Record<string, unknown>) => {
    fake.requestPermission(String((message.params as { sessionId?: string }).sessionId ?? ""));
    setTimeout(() => originalFinish(message), 5);
  }) as typeof fake.finishPrompt;
  const result = await runner.prompt("write hello.txt");
  assert.equal(result.stopReason, "end_turn");
  const permissionReply = fake.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((message) => message.id === "perm-1");
  assert.deepEqual(permissionReply?.result, { outcome: { outcome: "selected", optionId: "approve_once" } });
});

test("Kimi reuses its ACP session while applying the next turn model", async () => {
  const fake = new FakeKimi();
  const secondModel = "kimi-k3.1-max";
  fake.modelOptions.push(secondModel);
  const { runner } = createRunner(fake, { model: MODEL });
  await runner.start();
  await runner.start();
  await runner.setModel(secondModel);
  await runner.setModel(MODEL);
  assert.equal(runner.getConfigSnapshot().model, MODEL);
  assert.equal(fake.methods().filter((method) => method === "session/new").length, 1);
  assert.equal(fake.methods().filter((method) => method === "session/set_config_option").length >= 2, true);
});

test("Kimi rebuilds after a config write and resumes with the new model catalog", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-kimi-runner-revision-"));
  const env = { PATH: process.env.PATH ?? "", KIMI_CODE_HOME: home };
  try {
    const firstFake = new FakeKimi();
    const first = createRunner(firstFake, { model: MODEL, localSessionId: SESSION_ID, env });
    await first.runner.start({ requireResume: true });
    await writeKimiCodeConfigText(createKimiCodeDefaultConfigText(), env);
    assert.equal(first.runner.isReusable(), false);
    await assert.rejects(first.runner.start({ requireResume: true }), (error: { code?: string }) => {
      assert.equal(error.code, "config-reload-required");
      return true;
    });

    const secondFake = new FakeKimi();
    const addedModel = "kimi-k3.1-mini";
    secondFake.modelOptions = [MODEL, addedModel];
    const second = createRunner(secondFake, { model: addedModel, localSessionId: SESSION_ID, env });
    const resumed = await second.runner.start({ requireResume: true });
    assert.equal(resumed.acpSessionId, SESSION_ID);
    assert.equal(resumed.resumed, true);
    assert.equal(second.runner.getConfigSnapshot().model, addedModel);
    assert.deepEqual(second.runner.getConfigSnapshot().modelOptions, [MODEL, addedModel]);
    assert.equal(secondFake.methods().includes("session/resume"), true);
    assert.equal(secondFake.methods().includes("session/new"), false);
    first.runner.dispose();
    second.runner.dispose();
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("Kimi resumes only a real ACP session id and falls back to session/new", async () => {
  const fake = new FakeKimi();
  const { runner } = createRunner(fake, { model: MODEL, localSessionId: SESSION_ID });
  const started = await runner.start();
  assert.equal(started.resumed, true);
  assert.equal(started.retainedLocalSessionId, SESSION_ID);
  assert.equal(fake.methods().includes("session/resume"), true);

  const fresh = new FakeKimi();
  fresh.failResume = true;
  fresh.newSessionId = "session_22222222-2222-4222-8222-222222222222";
  const second = createRunner(fresh, { model: MODEL, localSessionId: SESSION_ID });
  const fallback = await second.runner.start();
  assert.equal(fallback.resumed, false);
  assert.deepEqual(fresh.methods().filter((method) => method.startsWith("session/")), [
    "session/resume",
    "session/new",
  ]);

  const strict = new FakeKimi();
  strict.failResume = true;
  const third = createRunner(strict, { model: MODEL, localSessionId: SESSION_ID });
  await assert.rejects(third.runner.start({ requireResume: true }), /not resumable/);
  assert.equal(strict.methods().includes("session/new"), false);

  const missing = new FakeKimi();
  const fourth = createRunner(missing, { model: MODEL });
  await assert.rejects(fourth.runner.start({ requireResume: true }), /requires an existing ACP session id/);
  assert.equal(missing.lines.length, 0);
});

test("Kimi rejects unadvertised thinking values instead of rewriting them", async () => {
  const fake = new FakeKimi();
  const { runner } = createRunner(fake);
  await runner.start();
  await assert.rejects(runner.setThinkingMode("ultra"), /is not advertised/);
  assert.equal(fake.thinkingCurrent, "high");
  const applied = await runner.setThinkingMode("max");
  assert.equal(applied.thinking, "max");
  assert.equal(fake.thinkingCurrent, "max");

  fake.thinkingOptions = ["off", "on"];
  const envOnly = new FakeKimi();
  envOnly.thinkingOptions = ["off", "on"];
  envOnly.thinkingCurrent = "off";
  const second = createRunner(envOnly);
  await second.runner.start();
  await assert.rejects(second.runner.setThinkingMode("high"), /available: off, on/);
  const on = await second.runner.setThinkingMode("on");
  assert.equal(on.thinking, "on");
});

test("Kimi mode changes stay inside the advertised mode list", async () => {
  const fake = new FakeKimi();
  const { runner } = createRunner(fake, { modeId: "plan" });
  const started = await runner.start();
  assert.equal(started.resumed, false);
  assert.equal(runner.getConfigSnapshot().modeId, "plan");
  await assert.rejects(runner.setMode("turbo"), /is not advertised/);
  const applied = await runner.setMode("yolo");
  assert.equal(applied.modeId, "yolo");
});

test("Kimi forwards asynchronous usage after the prompt settles", async () => {
  const fake = new FakeKimi();
  fake.finishPrompt = ((message: Record<string, unknown>) => {
    fake.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    const sessionId = (message.params as { sessionId: string }).sessionId;
    setTimeout(() => {
      fake.send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "usage_update", used: 8192, size: 262144 },
        },
      });
    }, 10);
  }) as typeof fake.finishPrompt;
  const { runner } = createRunner(fake);
  await runner.start();
  const events: string[] = [];
  const result = await runner.prompt("hello", {
    onComplete: () => events.push("complete"),
    onTokenUsageUpdate: (update) => events.push(`${update.tokensInContextWindow}/${update.modelContextWindow}`),
  });

  assert.equal(result.stopReason, "end_turn");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(events, ["complete", "8192/262144"]);
  runner.dispose();
});

test("Kimi forwards official auto-compaction notifications after the prompt settles", async () => {
  const fake = new FakeKimi();
  fake.finishPrompt = ((message: Record<string, unknown>) => {
    fake.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    const sessionId = (message.params as { sessionId: string }).sessionId;
    setTimeout(() => {
      fake.send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Compacting conversation context…" },
          },
        },
      });
    }, 10);
  }) as typeof fake.finishPrompt;
  const { runner } = createRunner(fake);
  await runner.start();
  const updates: string[] = [];
  const text: string[] = [];
  await runner.prompt("hello", {
    onTokenUsageUpdate: () => updates.push("usage"),
    onCompactionUpdate: (update) => updates.push(update.status),
    onAssistantDelta: (delta) => text.push(delta),
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  fake.send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: SESSION_ID,
      update: { sessionUpdate: "usage_update", used: 4096, size: 262144 },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(updates, ["started", "usage"]);
  assert.deepEqual(text, []);
  runner.dispose();
});

test("Kimi compaction is reported as unsupported rather than faked", async () => {
  const fake = new FakeKimi();
  const { runner } = createRunner(fake);
  await runner.start();
  const before = fake.lines.length;
  await assert.rejects(runner.compactSession(), (error: unknown) => {
    assert.ok(error instanceof KimiCompactionUnsupportedError);
    assert.equal(error.code, "compaction-unsupported");
    return true;
  });
  assert.equal(fake.lines.length, before);
});

test("Kimi replaces settled handlers on a new turn and drops notifications after cancellation", async () => {
  const fake = new FakeKimi();
  fake.finishPrompt = ((message: Record<string, unknown>) => {
    fake.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  }) as typeof fake.finishPrompt;
  const { runner } = createRunner(fake);
  await runner.start();
  const firstEvents: string[] = [];
  const secondEvents: string[] = [];
  const firstHandlers = {
    onTokenUsageUpdate: () => firstEvents.push("usage"),
    onCompactionUpdate: () => firstEvents.push("compaction"),
  };
  const secondHandlers = {
    onTokenUsageUpdate: () => secondEvents.push("usage"),
    onCompactionUpdate: () => secondEvents.push("compaction"),
  };
  await runner.prompt("first", firstHandlers);
  await runner.prompt("second", secondHandlers);
  fake.send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: SESSION_ID, update: { sessionUpdate: "usage_update", used: 1, size: 262144 } },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(firstEvents, []);
  assert.deepEqual(secondEvents, ["usage"]);
  runner.cancelTurn();
  fake.send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: SESSION_ID, update: { sessionUpdate: "usage_update", used: 2, size: 262144 } },
  });
  fake.send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: SESSION_ID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Compaction completed." } } },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(firstEvents, []);
  assert.deepEqual(secondEvents, ["usage"]);
  runner.dispose();
});

test("Kimi accepts assistant chunks without messageId on every turn", async () => {
  const fake = new FakeKimi();
  let turn = 0;
  fake.finishPrompt = ((message: Record<string, unknown>) => {
    turn += 1;
    const sessionId = (message.params as { sessionId: string }).sessionId;
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `answer-${turn}` },
        },
      },
    });
    fake.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  }) as typeof fake.finishPrompt;
  const { runner } = createRunner(fake);
  await runner.start();
  const replies: string[] = [];
  const handlers = { onAssistantDelta: (text: string) => replies.push(text) };

  await runner.prompt("first", handlers);
  await runner.prompt("second", handlers);

  assert.deepEqual(replies, ["answer-1", "answer-2"]);
  runner.dispose();
});

test("Kimi replay coalesces missing-message-id chunks without merging turns", async () => {
  const fake = new FakeKimi();
  let turn = 0;
  fake.finishPrompt = ((message: Record<string, unknown>) => {
    turn += 1;
    const sessionId = (message.params as { sessionId: string }).sessionId;
    for (const chunk of ["answer-", String(turn)]) {
      fake.send({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } } },
      });
    }
    fake.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  }) as typeof fake.finishPrompt;
  const { runner } = createRunner(fake);
  await runner.start();
  const replayEvents: Record<string, unknown>[] = [];
  const handlers = { onEvent: (event: Record<string, unknown>) => replayEvents.push(event) };

  await runner.prompt("first", handlers);
  await runner.prompt("second", handlers);

  assert.deepEqual(replayEvents.map((event) => (
    (event.params as { update: { content: { text: string } } }).update.content.text
  )), ["answer-1", "answer-2"]);
  runner.dispose();
});

test("Kimi rejects a protocol version it was not built against", async () => {
  const fake = new FakeKimi();
  fake.protocolVersion = 2;
  const { runner } = createRunner(fake);
  await assert.rejects(runner.start(), /protocol/i);
  assert.equal(runner.isReusable(), false);
});

test("Kimi answers unknown reverse RPC method with method-not-found", async () => {
  const fake = new FakeKimi();
  const { runner } = createRunner(fake, { model: MODEL });
  await runner.start();
  fake.pendingPromptRequested = false;
  const originalFinish = fake.finishPrompt.bind(fake);
  fake.finishPrompt = ((message: Record<string, unknown>) => {
    fake.send({ jsonrpc: "2.0", id: "rev-1", method: "session/load", params: { sessionId: SESSION_ID } });
    setTimeout(() => originalFinish(message), 5);
  }) as typeof fake.finishPrompt;
  const result = await runner.prompt("hello");
  assert.equal(result.stopReason, "end_turn");
  const reply = fake.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((message) => message.id === "rev-1");
  assert.equal((reply?.error as { code?: number } | undefined)?.code, -32601);
});

test("Kimi dispose stops the child tree and blocks further prompts", async () => {
  const fake = new FakeKimi();
  const { runner, signals } = createRunner(fake, { model: MODEL });
  await runner.start();
  runner.dispose();
  assert.equal(runner.isReusable(), false);
  await assert.rejects(runner.prompt("hello"), /disposed/);
  assert.ok(fake.signalCode === null || signals.length >= 0);
});
