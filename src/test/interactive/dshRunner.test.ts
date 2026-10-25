import assert = require("node:assert/strict");
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test = require("node:test");
import { installVscodeMock } from "../vscodeMock";
import type { DshChild, DshSpawn, DshStreamHandlers } from "../../interactive/dshRunner";

installVscodeMock();

const {
  DshInteractiveRunner,
} = require("../../interactive/dshRunner") as typeof import("../../interactive/dshRunner");

function protocolCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

const FLASH = JSON.stringify(["deepseek-official", "deepseek-v4-flash"]);
const PRO = JSON.stringify(["deepseek-official", "deepseek-v4-pro"]);
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

class FakeDsh extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public pid = 424242;
  public readonly lines: string[] = [];
  public sessionId = SESSION_ID;
  public modelOptions = [FLASH];
  public modelCurrent = FLASH;
  public reasoningOptions = ["low", "high", "xhigh", "max"];
  public reasoningCurrent = "high";
  public failResume = false;
  public omitResumeSessionId = false;
  public failConfig: string | null = null;
  public onPrompt: ((message: Record<string, unknown>) => void) | null = null;
  public permissionResult: unknown = null;
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
        options: [{
          group: "deepseek-official",
          name: "DeepSeek",
          options: this.modelOptions.map((value) => ({ value, name: value })),
        }],
      },
      {
        id: "reasoning_effort",
        name: "Reasoning effort",
        category: "thought_level",
        type: "select",
        currentValue: this.reasoningCurrent,
        options: this.reasoningOptions.map((value) => ({ value, name: value })),
      },
    ];
  }

  private respond(message: Record<string, unknown>): void {
    const method = String(message.method ?? "");
    const id = message.id;
    if (id === "perm-1") {
      this.permissionResult = message.result;
      if (this.pendingPrompt) {
        this.finishPrompt(this.pendingPrompt);
        this.pendingPrompt = null;
      }
      return;
    }
    if (method === "initialize") {
      this.send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" },
          authMethods: [],
        },
      });
      return;
    }
    if (method === "session/resume") {
      if (this.failResume) {
        this.send({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: session is not resumable" } });
        return;
      }
      this.send({
        jsonrpc: "2.0",
        id,
        result: this.omitResumeSessionId
          ? { configOptions: this.configOptions() }
          : { sessionId: this.sessionId, configOptions: this.configOptions() },
      });
      return;
    }
    if (method === "session/new") {
      this.send({
        jsonrpc: "2.0",
        id,
        result: { sessionId: this.sessionId, configOptions: this.configOptions() },
      });
      return;
    }
    if (method === "session/set_config_option") {
      const params = message.params as { configId?: string; value?: string };
      if (this.failConfig && this.failConfig === params.configId) {
        this.send({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Invalid params: unknown ${params.configId} option: ${String(params.value)}` },
        });
        return;
      }
      if (params.configId === "model" && typeof params.value === "string" && this.modelOptions.includes(params.value)) {
        this.modelCurrent = params.value;
      }
      if (params.configId === "reasoning_effort" && typeof params.value === "string" && this.reasoningOptions.includes(params.value)) {
        this.reasoningCurrent = params.value;
      }
      this.send({ jsonrpc: "2.0", id, result: { configOptions: this.configOptions() } });
      return;
    }
    if (method === "session/prompt") {
      if (this.onPrompt) {
        this.onPrompt(message);
        return;
      }
      this.finishPrompt(message);
      return;
    }
    if (method === "session/close") {
      this.send({ jsonrpc: "2.0", id, result: {} });
    }
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
          content: { type: "text", text: "think" },
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
          content: { type: "text", text: "hello" },
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
          title: "bash",
          status: "in_progress",
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
          content: [{ type: "content", content: { type: "text", text: "ok" } }],
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
          content: [{ type: "content", content: { type: "text", text: "ok" } }],
        },
      },
    });
    this.send({
      jsonrpc: "2.0",
      id: message.id,
      result: { stopReason: "end_turn" },
    });
  }

  public holdPrompt(message: Record<string, unknown>): void {
    this.pendingPrompt = message;
  }
}

function createRunner(fake: FakeDsh, options: Partial<ConstructorParameters<typeof DshInteractiveRunner>[0]> = {}): {
  runner: InstanceType<typeof DshInteractiveRunner>;
  spawnArgs: string[];
  spawnOptions: { detached?: boolean; env?: NodeJS.ProcessEnv };
  signals: string[];
} {
  const signals: string[] = [];
  const spawnArgs: string[] = [];
  const spawnOptions: { detached?: boolean; env?: NodeJS.ProcessEnv } = {};
  const spawnImpl: DshSpawn = (_command, args, spawnOptionsArg) => {
    spawnArgs.splice(0, spawnArgs.length, ...args);
    spawnOptions.detached = spawnOptionsArg.detached;
    spawnOptions.env = spawnOptionsArg.env;
    return fake as unknown as DshChild;
  };
  const runner = new DshInteractiveRunner({
    cwd: "/tmp/dsh-work",
    command: process.execPath,
    env: { PATH: process.env.PATH ?? "" },
    spawnImpl,
    killTreeImpl: (_child, signal) => {
      signals.push(String(signal));
      return true;
    },
    ...options,
  });
  return { runner, spawnArgs, spawnOptions, signals };
}

test("DSH ACP handshake and prompt complete only from stopReason", async () => {
  const fake = new FakeDsh();
  const { runner, spawnArgs } = createRunner(fake, {
    agentArgs: ["--patch", "/tmp/dsh-extra.yml"],
    model: FLASH,
    thinkingMode: "low",
  });
  const started = await runner.start();
  assert.equal(started.resumed, false);
  assert.equal(started.acpSessionId, SESSION_ID);
  assert.deepEqual(spawnArgs, ["--profile", "acp", "--patch", "/tmp/dsh-extra.yml"]);
  assert.equal(runner.isReusable(), true);
  assert.deepEqual(runner.getConfigSnapshot(), {
    model: FLASH,
    reasoningEffort: "low",
    modelOptions: [FLASH],
    reasoningOptions: ["low", "high", "xhigh", "max"],
  });

  const deltas: string[] = [];
  const traces: string[] = [];
  let completed = "";
  const result = await runner.prompt("reply with ok", {
    onAssistantDelta: (text) => deltas.push(text),
    onTrace: (text, kind) => traces.push(`${kind}:${text}`),
    onComplete: (meta) => {
      completed = meta.stopReason;
    },
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(completed, "end_turn");
  assert.deepEqual(deltas, ["hello"]);
  assert.equal(traces.filter((trace) => trace.startsWith("tool-use:")).length, 2);
  assert.equal(traces.some((trace) => trace === "thinking:think"), true);
  assert.equal(fake.methods().includes("session/load"), false);
  assert.equal(fake.methods().includes("initialized"), false);
  assert.equal(fake.lines.some((line) => line.includes("yoloMode")), false);
  const reasoning = fake.lines
    .map((line) => JSON.parse(line) as { method?: string; params?: { configId?: string; value?: unknown } })
    .find((message) => message.method === "session/set_config_option" && message.params?.configId === "reasoning_effort");
  assert.equal(reasoning?.params?.value, "low");
  runner.dispose();
});

test("DSH runner reassembles split frames and multiline chunks without splitting unicode separators", async () => {
  const fake = new FakeDsh();
  const { runner } = createRunner(fake);
  await runner.start();
  fake.onPrompt = (message) => {
    const thought = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "think-1",
          content: { type: "text", text: "思考\u2028继续\u2029完成" },
        },
      },
    });
    const ignored = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "other-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "foreign",
          content: { type: "text", text: "ignore-me" },
        },
      },
    });
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-1",
          content: { type: "text", text: "正文" },
        },
      },
    });
    const done = JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    const blob = Buffer.from(`${thought}\n${ignored}\n${body}\n${done}\n`, "utf8");
    const marker = Buffer.from("思考", "utf8");
    const splitAt = blob.indexOf(marker) + marker.length + 1;
    fake.stdout.write(blob.subarray(0, splitAt));
    fake.stdout.write(blob.subarray(splitAt));
  };
  const deltas: string[] = [];
  const thoughts: string[] = [];
  const result = await runner.prompt("第一行\u2028第二行", {
    onAssistantDelta: (text) => deltas.push(text),
    onTrace: (text, kind) => {
      if (kind === "thinking") {
        thoughts.push(text);
      }
    },
  });
  assert.equal(result.stopReason, "end_turn");
  assert.deepEqual(deltas, ["正文"]);
  assert.equal(thoughts.join(""), "思考\u2028继续\u2029完成");
  const promptLine = fake.lines.find((line) => line.includes("session/prompt")) ?? "";
  assert.equal(promptLine.includes("\u2028"), false);
  assert.equal(promptLine.includes("\u2029"), false);
  assert.equal((JSON.parse(promptLine) as { params: { prompt: Array<{ text: string }> } }).params.prompt[0].text, "第一行\u2028第二行");
  runner.dispose();
});

test("DSH model and thinking changes require advertised values and confirmed RPC state", async () => {
  const fake = new FakeDsh();
  fake.modelOptions = [FLASH, PRO];
  const { runner } = createRunner(fake, { model: FLASH });
  await runner.start();
  assert.equal(fake.methods().filter((method) => method === "session/set_config_option").length, 0);

  await assert.rejects(() => runner.setModel("deepseek-v4-pro"), (error: unknown) => {
    assert.equal(protocolCode(error), "model-wire-invalid");
    return true;
  });
  await assert.rejects(() => runner.setModel(JSON.stringify(["other", "missing"])), (error: unknown) => {
    assert.equal(protocolCode(error), "model-not-advertised");
    return true;
  });
  assert.equal(runner.getConfigSnapshot().model, FLASH);

  fake.failConfig = "model";
  await assert.rejects(() => runner.setModel(PRO), (error: unknown) => {
    assert.match((error as Error).message, /was not applied/);
    assert.match((error as Error).message, /deepseek-v4-flash/);
    return true;
  });
  assert.equal(runner.getConfigSnapshot().model, FLASH);
  fake.failConfig = null;

  await runner.setModel(PRO);
  assert.equal(runner.getConfigSnapshot().model, PRO);
  await assert.rejects(() => runner.setThinkingMode("ultra"), (error: unknown) => {
    assert.equal(protocolCode(error), "reasoning-not-advertised");
    return true;
  });
  assert.equal(fake.lines.some((line) => line.includes("\"ultra\"") || line.includes("\"max\"")), false);

  await runner.setThinkingMode("max");
  assert.equal(runner.getConfigSnapshot().reasoningEffort, "max");
  fake.reasoningOptions = ["off"];
  fake.reasoningCurrent = "off";
  await assert.rejects(() => runner.setModel(FLASH), (error: unknown) => {
    assert.equal(protocolCode(error), "reasoning-not-advertised");
    return true;
  });
  assert.equal(runner.getConfigSnapshot().model, FLASH);
  assert.equal(runner.getConfigSnapshot().reasoningEffort, "off");
  assert.equal(runner.getConfigSnapshot().reasoningEffort === "max", false);
  runner.dispose();
});

test("DSH resume succeeds only through session/resume and refuses a silent new session", async () => {
  const failing = new FakeDsh();
  failing.failResume = true;
  const failedRun = createRunner(failing, { localSessionId: SESSION_ID });
  await assert.rejects(() => failedRun.runner.start({ requireResume: true }), (error: unknown) => {
    assert.equal(protocolCode(error), "rpc-error");
    return true;
  });
  assert.equal(failing.methods().includes("session/resume"), true);
  assert.equal(failing.methods().includes("session/new"), false);
  assert.equal(failing.methods().includes("session/load"), false);
  assert.equal(failedRun.runner.isReusable(), false);

  const localOnly = new FakeDsh();
  let spawned = false;
  const localRun = createRunner(localOnly, {
    localSessionId: "local_pending",
    spawnImpl: () => {
      spawned = true;
      return localOnly as unknown as DshChild;
    },
  });
  await assert.rejects(() => localRun.runner.start({ requireResume: true }), (error: unknown) => {
    assert.equal(protocolCode(error), "resume-required");
    return true;
  });
  assert.equal(spawned, false);

  const resumed = new FakeDsh();
  const resumedRun = createRunner(resumed, { localSessionId: SESSION_ID });
  const started = await resumedRun.runner.start({ requireResume: true });
  assert.equal(started.resumed, true);
  assert.equal(started.acpSessionId, SESSION_ID);
  assert.equal(started.retainedLocalSessionId, SESSION_ID);
  assert.equal(resumed.methods().includes("session/resume"), true);
  assert.equal(resumed.methods().includes("session/new"), false);
  const again = await resumedRun.runner.start({ requireResume: true });
  assert.equal(again.resumed, true);
  assert.equal(resumed.methods().filter((method) => method === "initialize").length, 1);
  resumedRun.runner.dispose();

  const omitted = new FakeDsh();
  omitted.omitResumeSessionId = true;
  const omittedRun = createRunner(omitted, { localSessionId: SESSION_ID });
  const omittedStart = await omittedRun.runner.start({ requireResume: true });
  assert.equal(omittedStart.resumed, true);
  assert.equal(omittedStart.acpSessionId, SESSION_ID);
  assert.equal(omitted.methods().includes("session/new"), false);
  omittedRun.runner.dispose();
});

test("DSH usage notifications require real numbers and permission requests fail closed", async () => {
  const fake = new FakeDsh();
  const { runner } = createRunner(fake);
  await runner.start();
  const usage: Array<{ tokensInContextWindow: number; modelContextWindow: number }> = [];
  fake.onPrompt = (message) => {
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: SESSION_ID, update: { sessionUpdate: "usage_update", used: 12, size: 1000 } },
    });
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: SESSION_ID, update: { sessionUpdate: "usage_update", used: 12 } },
    });
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: SESSION_ID, update: { sessionUpdate: "usage_update", size: 1000 } },
    });
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: SESSION_ID, update: { sessionUpdate: "usage_update", used: "4", size: 1000 } },
    });
    fake.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  };
  await runner.prompt("usage", { onTokenUsageUpdate: (update) => usage.push(update) });
  assert.deepEqual(usage, [{ tokensInContextWindow: 12, modelContextWindow: 1000 }]);

  fake.onPrompt = (message) => {
    fake.holdPrompt(message);
    fake.send({
      jsonrpc: "2.0",
      id: "perm-1",
      method: "session/request_permission",
      params: {
        sessionId: SESSION_ID,
        toolCall: { toolCallId: "tool-9" },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      },
    });
  };
  const denied = runner.prompt("needs permission", {
    onRequest: () => ({ result: { outcome: { outcome: "selected", optionId: "reject-once" } } }),
  });
  const deniedResult = await denied;
  assert.equal(deniedResult.stopReason, "end_turn");
  assert.deepEqual(fake.permissionResult, { outcome: { outcome: "selected", optionId: "reject-once" } });

  fake.permissionResult = null;
  fake.onPrompt = (message) => {
    fake.holdPrompt(message);
    fake.send({
      jsonrpc: "2.0",
      id: "perm-1",
      method: "session/request_permission",
      params: {
        sessionId: SESSION_ID,
        toolCall: { toolCallId: "tool-allow", title: "read" },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      },
    });
  };
  const allowed = await runner.prompt("allow permission", {
    onRequest: () => ({ result: { outcome: { outcome: "selected", optionId: "allow-once" } } }),
  });
  assert.equal(allowed.stopReason, "end_turn");
  assert.deepEqual(fake.permissionResult, { outcome: { outcome: "selected", optionId: "allow-once" } });

  fake.permissionResult = null;
  fake.onPrompt = (message) => {
    fake.holdPrompt(message);
    fake.send({
      jsonrpc: "2.0",
      id: "perm-1",
      method: "session/request_permission",
      params: {
        sessionId: SESSION_ID,
        toolCall: { toolCallId: "tool-9" },
        options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
      },
    });
  };
  await runner.prompt("cancel permission");
  assert.deepEqual(fake.permissionResult, { outcome: { outcome: "cancelled" } });
  runner.dispose();
});

test("DSH prompt RPC failure is not success after partial text", async () => {
  const fake = new FakeDsh();
  const { runner } = createRunner(fake);
  await runner.start();
  const deltas: string[] = [];
  let completed = false;
  fake.onPrompt = (message) => {
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-1",
          content: { type: "text", text: "partial" },
        },
      },
    });
    fake.send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32603, message: "Internal error: turn failed: missing credential" },
    });
  };
  const handlers: DshStreamHandlers = {
    onAssistantDelta: (text) => deltas.push(text),
    onComplete: () => {
      completed = true;
    },
  };
  await assert.rejects(() => runner.prompt("fail", handlers), (error: unknown) => {
    assert.equal(protocolCode(error), "turn-failed");
    return true;
  });
  assert.deepEqual(deltas, ["partial"]);
  assert.equal(completed, false);
  runner.dispose();
});

test("DSH child exit settles pending work and drops late output", async () => {
  const fake = new FakeDsh();
  const { runner } = createRunner(fake, {
    env: { PATH: "/usr/bin", DEEPSEEK_API_KEY: "dsh-fixture-secret-9f3a" },
  });
  await runner.start();
  const deltas: string[] = [];
  fake.onPrompt = () => {
    fake.stderr.write("token=dsh-fixture-secret-9f3a\n");
    fake.exitCode = 1;
    fake.emit("close", 1, null);
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "late",
          content: { type: "text", text: "late" },
        },
      },
    });
  };
  await assert.rejects(() => runner.prompt("boom", { onAssistantDelta: (text) => deltas.push(text) }), (error: unknown) => {
    const message = (error as Error).message;
    assert.equal(protocolCode(error), "exited");
    assert.equal(message.includes("dsh-fixture-secret-9f3a"), false);
    return true;
  });
  assert.deepEqual(deltas, []);
  assert.equal(runner.isReusable(), false);
  await assert.rejects(() => runner.prompt("again"), (error: unknown) => {
    assert.equal(protocolCode(error), "exited");
    return true;
  });
});

test("DSH cancel, dispose, and unknown requests do not leak into the next turn", async () => {
  const fake = new FakeDsh();
  const signals: string[] = [];
  const ended: string[] = [];
  fake.stdin.on("end", () => ended.push("end"));
  const { runner } = createRunner(fake, {
    platform: "darwin",
    shutdownGraceMs: 20,
    killTreeImpl: (child, signal) => {
      signals.push(String(signal));
      if (signal === "SIGTERM") {
        child.exitCode = 0;
        (child as FakeDsh).emit("close", 0, null);
      }
      return true;
    },
  });
  await runner.start();
  fake.send({ jsonrpc: "2.0", id: "srv-9", method: "terminal/create", params: { command: "pwd" } });
  await new Promise((resolve) => setImmediate(resolve));
  const unknown = fake.lines.map((line) => JSON.parse(line) as { id?: unknown; error?: { code?: number; data?: { method?: string } } })
    .find((message) => message.id === "srv-9");
  assert.equal(unknown?.error?.code, -32601);
  assert.equal(unknown?.error?.data?.method, "terminal/create");

  const firstDeltas: string[] = [];
  let releasePrompt: (message: Record<string, unknown>) => void = () => undefined;
  fake.onPrompt = (message) => {
    releasePrompt = () => fake.finishPrompt(message);
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "old",
          content: { type: "text", text: "before" },
        },
      },
    });
  };
  const first = runner.prompt("first", { onAssistantDelta: (text) => firstDeltas.push(text) });
  await new Promise((resolve) => setImmediate(resolve));
  runner.cancelTurn();
  fake.send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: SESSION_ID,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "old",
        content: { type: "text", text: "after-cancel" },
      },
    },
  });
  const cancel = fake.lines.map((line) => JSON.parse(line) as { method?: string; id?: unknown })
    .filter((message) => message.method === "session/cancel");
  assert.equal(cancel.length > 0, true);
  assert.equal(cancel.every((message) => message.id === undefined), true);
  releasePrompt(fake.lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((message) => message.method === "session/prompt") ?? {});
  const firstResult = await first;
  assert.equal(firstResult.stopReason, "end_turn");
  assert.deepEqual(firstDeltas, ["before"]);

  const secondDeltas: string[] = [];
  fake.onPrompt = (message) => {
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "old",
          content: { type: "text", text: "stale" },
        },
      },
    });
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "new",
          content: { type: "text", text: "fresh" },
        },
      },
    });
    fake.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  };
  await runner.prompt("second", { onAssistantDelta: (text) => secondDeltas.push(text) });
  assert.deepEqual(secondDeltas, ["fresh"]);

  const beforeDispose = fake.lines.length;
  await assert.rejects(runner.compactSession(), (error: unknown) => {
    assert.equal((error as { code?: string; compacted?: boolean }).code, "compaction-unsupported");
    assert.equal((error as { compacted?: boolean }).compacted, false);
    return true;
  });
  assert.equal(fake.lines.length, beforeDispose);
  assert.equal(fake.lines.some((line) => line.includes("/compact")), false);

  runner.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  const shutdown = fake.lines.slice(beforeDispose).map((line) => JSON.parse(line) as { method?: string; id?: unknown });
  assert.equal(shutdown.some((message) => message.method === "session/cancel" && message.id === undefined), true);
  assert.equal(shutdown.some((message) => message.method === "session/close" && message.id !== undefined), true);
  assert.equal(shutdown.some((message) => message.method === "session/load"), false);
  assert.deepEqual(ended, ["end"]);
  assert.deepEqual(signals, ["SIGTERM"]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("DSH dispose uses Windows taskkill semantics and rejects profile switching", async () => {
  const fake = new FakeDsh();
  const signals: string[] = [];
  const { runner } = createRunner(fake, {
    platform: "win32",
    killTreeImpl: (_child, signal) => {
      signals.push(String(signal));
      return true;
    },
  });
  await runner.start();
  assert.equal(runner.isReusable(), true);
  runner.dispose();
  assert.deepEqual(signals, ["SIGKILL"]);
  assert.equal(runner.isReusable(), false);

  const rejected = new FakeDsh();
  let spawned = false;
  const blocked = createRunner(rejected, {
    agentArgs: ["--profile", "headless"],
    spawnImpl: () => {
      spawned = true;
      return rejected as unknown as DshChild;
    },
  });
  await assert.rejects(() => blocked.runner.start(), (error: unknown) => {
    assert.equal(protocolCode(error), "agent-args");
    return true;
  });
  assert.equal(spawned, false);
});

test("DSH runner strips foreign credentials when env is omitted and rejects a second prompt", async () => {
  const previous = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "grok-fixture-secret";
  const fake = new FakeDsh();
  try {
    const { runner, spawnOptions } = createRunner(fake, { env: undefined, platform: "darwin" });
    await runner.start();
    assert.equal(spawnOptions.env?.XAI_API_KEY, undefined);
    assert.equal(spawnOptions.detached, true);
    const gate: { finish: (() => void) | null } = { finish: null };
    fake.onPrompt = (message) => {
      gate.finish = () => fake.finishPrompt(message);
    };
    const first = runner.prompt("one");
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(() => runner.prompt("two"), (error: unknown) => {
      assert.equal(protocolCode(error), "concurrent-prompt");
      return true;
    });
    gate.finish?.();
    assert.equal((await first).stopReason, "end_turn");
    runner.dispose();
  } finally {
    if (previous === undefined) {
      delete process.env.XAI_API_KEY;
    } else {
      process.env.XAI_API_KEY = previous;
    }
  }
});
