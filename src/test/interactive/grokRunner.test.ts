import assert = require("node:assert/strict");
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import test = require("node:test");
import { installVscodeMock } from "../vscodeMock";
import type { CliName } from "../../cli/types";
import type { GrokChild, GrokSpawn, GrokStreamHandlers } from "../../interactive/grokRunner";
import type { InteractiveRunnerManager } from "../../interactive/manager";
import type { ChatMessage } from "../../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import type { PromptInteractiveRuntimeHostDeps } from "../../extensionHost/promptInteractiveRuntime";
import type { InteractiveTabRun } from "../../extensionHost/promptExecutionShared";

installVscodeMock();

const { GrokInteractiveRunner } = require("../../interactive/grokRunner") as typeof import("../../interactive/grokRunner");

class FakeGrok extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public readonly signals: string[] = [];
  public readonly lines: string[] = [];
  public authMethods: Array<{ id: string }> = [{ id: "xai.api_key" }, { id: "cached_token" }];
  public loadSession = false;
  public failLoad = false;
  public advertiseReasoning = true;
  public reasoningOptions: string[] | null = ["none", "low", "medium", "high", "xhigh", "max"];

  public constructor() {
    super();
    this.stdin.setEncoding("utf8");
    let buffer = "";
    this.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      parts.filter((line) => line.trim()).forEach((line) => {
        this.lines.push(line);
        this.respond(JSON.parse(line) as Record<string, unknown>);
      });
    });
  }

  public kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? "");
    return true;
  }

  public respond(message: Record<string, unknown>): void {
    const method = String(message.method ?? "");
    const id = message.id;
    if (method === "initialize") {
      const result: Record<string, unknown> = {
        protocolVersion: 1,
        agentCapabilities: { loadSession: this.loadSession },
        authMethods: this.authMethods,
      };
      if (this.advertiseReasoning) {
        result.configOptions = [{ id: "reasoning_effort", options: this.reasoningOptions }];
      }
      this.send({ jsonrpc: "2.0", id, result });
      return;
    }
    if (method === "authenticate") {
      this.send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "session/load") {
      if (this.failLoad) {
        this.send({ jsonrpc: "2.0", id, error: { code: -32603, message: "Path not found." } });
        return;
      }
      this.send({ jsonrpc: "2.0", id, result: { sessionId: "loaded-session" } });
      return;
    }
    if (method === "session/new") {
      this.send({ jsonrpc: "2.0", id, result: { sessionId: "grok-session" } });
      return;
    }
    if (method === "session/set_config_option") {
      this.send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "session/prompt") {
      this.send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "think" },
          },
        },
      });
      this.send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
        },
      });
      this.send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            title: "bash",
            status: "pending",
            rawInput: { command: "pwd" },
          },
        },
      });
      this.send({
        jsonrpc: "2.0",
        id,
        result: { stopReason: "end_turn", text: "not body" },
      });
    }
  }

  public send(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

test("runs Grok ACP over stdio without treating prompt completion as text", async () => {
  const fake = new FakeGrok();
  let spawnOptions: { detached?: boolean; args?: readonly string[] } = {};
  const spawnImpl: GrokSpawn = (_command, args, options) => {
    spawnOptions = { detached: options.detached, args };
    return fake as unknown as GrokChild;
  };
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    agentArgs: ["--dangerously-skip-permissions", "--always-approve"],
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    thinkingMode: "ultra",
    model: " grok-4 ",
    spawnImpl,
  });
  const info = await runner.start();
  assert.equal(info.acpSessionId, "grok-session");
  assert.equal(info.resumed, false);
  assert.deepEqual(spawnOptions.args, [
    "--no-auto-update",
    "--permission-mode",
    "bypassPermissions",
    "agent",
    "--model",
    "grok-4",
    "stdio",
  ]);
  assert.equal(spawnOptions.detached, process.platform !== "win32");
  const initialize = fake.lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.method === "initialize");
  const clientInfo = (initialize?.params as { clientInfo?: { version?: string } } | undefined)?.clientInfo;
  assert.equal(typeof clientInfo?.version, "string");
  assert.notEqual(clientInfo?.version, "");
  const caps = (initialize?.params as { clientCapabilities?: { terminal?: boolean } } | undefined)?.clientCapabilities;
  assert.equal(caps?.terminal, false);
  const created = fake.lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.method === "session/new");
  assert.deepEqual((created?.params as { _meta?: unknown } | undefined)?._meta, { yoloMode: true });
  const auth = fake.lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.method === "authenticate");
  assert.deepEqual(auth?.params, { methodId: "xai.api_key", _meta: { headless: true } });
  assert.equal(JSON.stringify(auth).includes("set"), false);
  const reasoning = fake.lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.method === "session/set_config_option");
  assert.deepEqual(reasoning?.params, {
    sessionId: "grok-session",
    configId: "reasoning_effort",
    value: { value: "max" },
  });
  const deltas: string[] = [];
  const traces: Array<{ text: string; kind?: string }> = [];
  const events: Array<Record<string, unknown>> = [];
  const result = await runner.prompt("hello grok", {
    onAssistantDelta: (text) => deltas.push(text),
    onTrace: (text, kind) => traces.push({ text, kind }),
    onEvent: (message) => events.push(message as unknown as Record<string, unknown>),
  });
  assert.deepEqual(events.map((event) => event.method ?? "session/prompt"), [
    "session/update",
    "session/update",
    "session/update",
    "session/prompt",
  ]);
  assert.equal(events.some((event) => event.method === "initialize"), false);
  assert.equal(events.filter((event) => event.method === undefined).length, 1);
  assert.equal((events[events.length - 1]?.result as { stopReason?: string } | undefined)?.stopReason, "end_turn");
  assert.deepEqual(deltas, ["hello"]);
  assert.equal(result.stopReason, "end_turn");
  assert.equal(traces.some((trace) => trace.kind === "thinking" && trace.text === "think"), true);
  assert.equal(traces.some((trace) => trace.text.startsWith("tool: bash")), true);
  assert.equal(deltas.includes("not body"), false);
  runner.cancelTurn();
  const cancel = fake.lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.method === "session/cancel");
  assert.equal(cancel?.id, undefined);
  assert.deepEqual(cancel?.params, { sessionId: "grok-session" });
  runner.dispose();
  assert.equal(fake.stdin.writableEnded, true);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(fake.signals, ["SIGTERM", "SIGKILL"]);
});


async function emptyGrokHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "grok-empty-"));
}

test("skips account authentication when the default model has its own api key", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "grok-keyed-"));
  await fs.writeFile(path.join(home, "config.toml"), `
[models]
default = "grok-4.7-kedaya"

[model."grok-4.7-kedaya"]
api_key = "secret-value"
`);
  const fake = new FakeGrok();
  fake.authMethods = [{ id: "grok.com" }];
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, GROK_HOME: home, XAI_API_KEY: "" },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  const info = await runner.start();
  assert.equal(info.acpSessionId, "grok-session");
  const methods = fake.lines.map((line) => JSON.parse(line) as { method?: string }).map((line) => line.method);
  assert.equal(methods.includes("authenticate"), false);
  assert.equal(methods.includes("session/new"), true);
  assert.equal(fake.lines.some((line) => line.includes("secret-value")), false);
  runner.dispose();
});

test("still authenticates grok.com when the model api key is empty", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "grok-empty-key-"));
  await fs.writeFile(path.join(home, "config.toml"), `
[models]
default = "grok-4.7-kedaya"

[model."grok-4.7-kedaya"]
api_key = ""
`);
  const fake = new FakeGrok();
  fake.authMethods = [{ id: "grok.com" }];
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, GROK_HOME: home, XAI_API_KEY: "" },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  const auth = fake.lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.method === "authenticate");
  assert.deepEqual(auth?.params, { methodId: "grok.com", _meta: { headless: true } });
  runner.dispose();
});


test("continues a live Grok session with another prompt and no second handshake", async () => {
  const home = await emptyGrokHome();
  const fake = new FakeGrok();
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: home },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  await runner.prompt("first");
  await runner.start();
  await runner.prompt("second");
  const methods = fake.lines.map((line) => (JSON.parse(line) as { method?: string }).method);
  assert.equal(methods.filter((method) => method === "initialize").length, 1);
  assert.equal(methods.filter((method) => method === "session/new").length, 1);
  assert.deepEqual(methods.filter((method) => method === "session/prompt"), ["session/prompt", "session/prompt"]);
  runner.dispose();
});

test("loads a saved Grok session and falls back to a new session when it is gone", async () => {
  const home = await emptyGrokHome();
  const loaded = new FakeGrok();
  loaded.loadSession = true;
  const loadedRunner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: home },
    localSessionId: "01a1450f-97a8-7882-a51c-b39c6d30a180",
    spawnImpl: () => loaded as unknown as GrokChild,
  });
  const loadedInfo = await loadedRunner.start();
  assert.equal(loadedInfo.acpSessionId, "loaded-session");
  assert.equal(loadedInfo.resumed, true);
  loadedRunner.dispose();

  const missing = new FakeGrok();
  missing.loadSession = true;
  missing.failLoad = true;
  const missingRunner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: home },
    localSessionId: "01a1450f-97a8-7882-a51c-b39c6d30a180",
    spawnImpl: () => missing as unknown as GrokChild,
  });
  const missingInfo = await missingRunner.start();
  assert.equal(missingInfo.acpSessionId, "grok-session");
  assert.equal(missingInfo.resumed, false);
  const methods = missing.lines.map((line) => (JSON.parse(line) as { method?: string }).method);
  assert.equal(methods.includes("session/load"), true);
  assert.equal(methods.includes("session/new"), true);
  missingRunner.dispose();
});

test("answers Grok terminal/create instead of returning method not found", async () => {
  const fake = new FakeGrok();
  const original = fake.respond.bind(fake);
  fake.respond = (message: Record<string, unknown>): void => {
    if (message.method !== "session/prompt") {
      original(message);
      return;
    }
    fake.send({
      jsonrpc: "2.0",
      id: "client-terminal",
      method: "terminal/create",
      params: {
        sessionId: "grok-session",
        command: process.execPath,
        args: ["-e", "process.stdout.write('from-terminal')"],
      },
    });
  };
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  const prompt = runner.prompt("weather");
  const created = await waitForLine(fake, (line) => line.id === "client-terminal");
  assert.equal(created.error, undefined);
  const terminalId = (created.result as { terminalId?: string } | undefined)?.terminalId;
  assert.equal(typeof terminalId, "string");
  fake.send({
    jsonrpc: "2.0",
    id: "client-wait",
    method: "terminal/wait_for_exit",
    params: { sessionId: "grok-session", terminalId },
  });
  const waited = await waitForLine(fake, (line) => line.id === "client-wait");
  assert.equal((waited.result as { exitCode?: number } | undefined)?.exitCode, 0);
  const promptRequest = fake.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((line) => line.method === "session/prompt");
  fake.send({
    jsonrpc: "2.0",
    id: promptRequest?.id,
    result: { stopReason: "end_turn" },
  });
  const done = await prompt;
  assert.equal(done.stopReason, "end_turn");
  assert.equal(fake.lines.some((line) => line.includes("Method not found: terminal/create")), false);
  runner.dispose();
});

test("sends xhigh and max when advertised, and skips an effort that is not allowed", async () => {
  const allowed = await readReasoningParams("xhigh", {});
  assert.deepEqual(allowed, { sessionId: "grok-session", configId: "reasoning_effort", value: { value: "xhigh" } });
  const max = await readReasoningParams("max", {});
  assert.deepEqual((max as { value?: { value?: string } }).value, { value: "max" });
  const ultra = await readReasoningParams("ultra", {});
  assert.deepEqual((ultra as { value?: { value?: string } }).value, { value: "max" });
  const blocked = await readReasoningParams("ultra", { reasoningOptions: ["low", "medium", "high"] });
  assert.equal(blocked, null);
  const missing = await readReasoningParams("xhigh", { advertiseReasoning: false });
  assert.equal(missing, null);
});

test("does not replay parse failures, request pairing, or client requests", async () => {
  const fake = new FakeGrok();
  const original = fake.respond.bind(fake);
  fake.respond = (message: Record<string, unknown>): void => {
    if (message.method !== "session/prompt") {
      original(message);
      return;
    }
    fake.stdout.write("not-json\n");
    fake.send({
      jsonrpc: "2.0",
      id: "client-terminal",
      method: "terminal/create",
      params: { sessionId: "grok-session", command: process.execPath, args: ["-e", ""] },
    });
    fake.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } },
    });
    fake.send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  };
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  const events: Array<{ method?: string; result?: { stopReason?: string } }> = [];
  await runner.prompt("hello", {
    onEvent: (message) => {
      const result = message.result && typeof message.result === "object"
        ? message.result as { stopReason?: string }
        : undefined;
      events.push({ method: message.method, result });
    },
  });
  assert.deepEqual(events.map((event) => event.method ?? event.result?.stopReason), ["session/update", "end_turn"]);
  assert.equal(events.some((event) => event.method === "terminal/create"), false);
  assert.equal(fake.lines.some((line) => line.includes("not-json")), false);
  runner.dispose();
});

test("does not reuse a Grok runner when the selected model changes", () => {
  const { InteractiveRunnerManager: RunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");
  const manager = new RunnerManager();
  const base = {
    sessionId: "local-session",
    command: "grok",
    agentArgs: ["--keep"],
    cwd: "/workspace",
    thinkingMode: "high" as const,
    interactiveMode: "coding" as const,
    localSessionId: "local-session",
  };
  try {
    const first = manager.getOrCreateGrokRunner({ ...base, model: "grok-4" });
    const reused = manager.getOrCreateGrokRunner({ ...base, model: "grok-4" });
    const replaced = manager.getOrCreateGrokRunner({ ...base, model: "grok-4.7" });
    assert.equal(reused, first);
    assert.notEqual(replaced, first);
    assert.equal(manager.hasGrokRunner("local-session", replaced), true);
    assert.equal(manager.hasGrokRunner("local-session", first), false);
  } finally {
    manager.disposeAll();
  }
});

test("host sends session updates through rawStreamDelta without changing bubbles", async () => {
  const update = {
    jsonrpc: "2.0" as const,
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
      },
    },
  };
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      handlers.onEvent?.(update);
      handlers.onAssistantDelta?.("hello");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("Say hello"), targetFor("local-session"));
  const raw = harness.panelMessages.filter((message) => message.type === "rawStreamDelta");
  assert.deepEqual(raw, [{
    type: "rawStreamDelta",
    content: `${JSON.stringify(update)}\n`,
    stream: "event",
    tabId: "tab-grok",
  }]);
  const stored = harness.messagesBySession.get("local-session") ?? [];
  const assistant = stored.filter((message) => message.role === "assistant" && message.kind !== "thinking");
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0]?.content, "hello");
  assert.equal(stored.some((message) => String(message.content).includes("session/update")), false);
});

test("filters replay metadata and merges fragments without delaying assistant or tool handlers", async () => {
  const fake = new FakeGrok();
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  const original = fake.respond.bind(fake);
  let promptId: unknown;
  fake.respond = (message) => {
    if (message.method === "session/prompt") {
      promptId = message.id;
    } else {
      original(message);
    }
  };
  const events: Array<Record<string, unknown>> = [];
  const deltas: string[] = [];
  const traces: string[] = [];
  const turn = runner.prompt("hello", {
    onEvent: (message) => events.push(message),
    onAssistantDelta: (text) => deltas.push(text),
    onTrace: (text) => traces.push(text),
  });
  const sendUpdate = (update: Record<string, unknown>) => fake.send({ method: "session/update", params: { sessionId: "grok-session", update } });
  sendUpdate({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "help" }] });
  sendUpdate({ sessionUpdate: "session_info_update", title: "hello" });
  sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } });
  sendUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " world" } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(deltas, ["hello", " world"]);
  assert.equal(events.length, 0);
  const tool = { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "bash", status: "pending", rawInput: { command: "pwd" } };
  sendUpdate(tool);
  sendUpdate(tool);
  sendUpdate({ ...tool, sessionUpdate: "tool_call_update", status: "completed", rawOutput: "ok" });
  fake.send({ id: promptId, result: { stopReason: "end_turn" } });
  await turn;
  assert.equal(events.length, 4);
  assert.equal(((events[0].params as { update: { content: { text: string } } }).update.content.text), "hello world");
  assert.equal(traces.length, 3);
  assert.equal(events[3].id, promptId);
  runner.dispose();
});

test("flushes partial replay before prompt errors and isolates reused turns", async () => {
  const fake = new FakeGrok();
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  fake.respond = (message) => {
    if (message.method !== "session/prompt") {
      return;
    }
    fake.send({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "partial" } } } });
    fake.send({ id: message.id, error: { code: -32603, message: "prompt failed" } });
  };
  const firstEvents: Array<Record<string, unknown>> = [];
  await assert.rejects(runner.prompt("first", { onEvent: (message) => firstEvents.push(message) }), /prompt failed/);
  assert.equal(firstEvents.length, 2);
  assert.equal(firstEvents[0].method, "session/update");
  assert.deepEqual(firstEvents[1].error, { code: -32603, message: "prompt failed" });
  const secondEvents: Array<Record<string, unknown>> = [];
  await assert.rejects(runner.prompt("second", { onEvent: (message) => secondEvents.push(message) }), /prompt failed/);
  assert.deepEqual(firstEvents.map((message) => message.method), secondEvents.map((message) => message.method));
  assert.equal(firstEvents.length, 2);
  runner.dispose();
});

test("flushes replay on cancel and process failure without leaking it into later turns", async () => {
  const fake = new FakeGrok();
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  fake.respond = (message) => {
    if (message.method === "session/prompt") {
      fake.send({ method: "session/update", params: { update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "partial thinking" } } } });
    }
  };
  const events: Array<Record<string, unknown>> = [];
  const turn = runner.prompt("first", { onEvent: (message) => events.push(message) });
  const rejection = assert.rejects(turn, /test exit/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(events.length, 0);
  runner.cancelTurn();
  assert.equal(events.length, 1);
  fake.send({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "partial body" } } } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  fake.emit("error", new Error("test exit"));
  await rejection;
  assert.equal(events.length, 2);
  assert.equal(runner.isReusable(), false);
  runner.dispose();
  assert.equal(events.length, 2);
});

async function readReasoningParams(
  mode: string,
  options: { reasoningOptions?: string[] | null; advertiseReasoning?: boolean },
): Promise<unknown> {
  const fake = new FakeGrok();
  if (options.reasoningOptions !== undefined) {
    fake.reasoningOptions = options.reasoningOptions;
  }
  if (options.advertiseReasoning !== undefined) {
    fake.advertiseReasoning = options.advertiseReasoning;
  }
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    thinkingMode: mode,
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  const reasoning = fake.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((line) => line.method === "session/set_config_option");
  runner.dispose();
  return reasoning?.params ?? null;
}

function createHostHarness(options: {
  behavior: (prompt: string, handlers: GrokStreamHandlers) => Promise<void>;
}) {
  const { createPromptInteractiveRuntimeHost } = require("../../extensionHost/promptInteractiveRuntime") as typeof import("../../extensionHost/promptInteractiveRuntime");
  const activeRunsByTabId = new Map<string, InteractiveTabRun>();
  const messagesBySession = new Map<string, ChatMessage[]>();
  const pendingMessagesByTab = new Map<string, ChatMessage[]>();
  const panelMessages: Array<Record<string, unknown>> = [];
  const runStatus: string[] = [];
  let idCounter = 0;
  const runner = {
    start: async () => ({ acpSessionId: "acp-session", resumed: false, retainedLocalSessionId: null }),
    prompt: options.behavior,
    cancelTurn: () => undefined,
    dispose: () => undefined,
    isReusable: () => true,
  };
  const manager = {
    getOrCreateGrokRunner: () => runner,
    hasGrokRunner: () => true,
    setRunner: () => undefined,
    detachRunner: () => undefined,
  } as unknown as InteractiveRunnerManager;
  const deps: PromptInteractiveRuntimeHostDeps = {
    AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024,
    activeRunsByTabId,
    adoptSessionId: () => undefined,
    applyProcessTitle: () => undefined,
    applyThinkingWorkspaceFiles: () => undefined,
    appendTaskRun: () => undefined,
    buildSubagentProgressLabels: () => ({
      provider: { codex: "Codex", loop: "Loop", opencode: "OpenCode" },
      subagent: "subagent",
      status: { running: "running", completed: "completed", failed: "failed", interrupted: "interrupted" },
      errorPrefix: "error: ",
    }),
    buildTaskRunCompletionText: (status: string) => `completion:${status}`,
    createMessageId: () => `msg-${++idCounter}`,
    getActiveConfigIdForCli: () => "grok-config",
    getConversationTabById: () => ({ sessionId: "local-session" }),
    getEffectiveCliArgs: () => [],
    getEffectiveThinkingMode: () => "xhigh" as const,
    getGlobalHumanInteractionEnabled: () => false,
    getGlobalMultiAgentEnabled: () => false,
    getPendingSessionDraft: (tabId: string) => {
      const existing = pendingMessagesByTab.get(tabId);
      if (existing) {
        return { messages: existing };
      }
      const next: ChatMessage[] = [];
      pendingMessagesByTab.set(tabId, next);
      return { messages: next };
    },
    getSelectedCliModel: () => "grok-4",
    getWorkspaceInteractiveMode: () => "coding" as const,
    getInteractiveRunnerManager: () => manager,
    loadSessionMessages: (_cli: CliName, sessionId: string) => {
      const existing = messagesBySession.get(sessionId);
      if (existing) {
        return existing;
      }
      const next: ChatMessage[] = [];
      messagesBySession.set(sessionId, next);
      return next;
    },
    logCliStartup: () => undefined,
    maybeAutoCompactContextAfterPromptSuccess: async () => undefined,
    maybePersistLongTermMemoryFromRun: () => undefined,
    migrateLocalSessionToTargetSession: () => undefined,
    persistMessagesForTab: () => undefined,
    preparePendingLabel: () => undefined,
    resolveClaudeInteractiveEntrypoint: () => undefined,
    resolveCodexInteractiveSelection: () => null,
    resolveInteractiveMappedId: () => null,
    resolveInteractiveSessionForResume: async (_cli: CliName, sessionId: string | null) => sessionId,
    resolveWorkspaceCwd: () => "/workspace",
    requestHumanInteraction: async (request: { interactionId: string; tabId: string }) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {},
    }),
    cancelHumanInteractionForTab: () => undefined,
    sendPanelMessage: (payload: Record<string, unknown>) => {
      panelMessages.push(payload);
    },
    sendRunStatusForTab: (_tabId: string, status: string) => {
      runStatus.push(status);
    },
    shouldAutoCompactContextAfterRunForTarget: () => false,
    shouldRequireExplicitFinalAnswerForRun: () => false,
    t: (key: string) => key,
    updateProcessTitle: () => undefined,
    upsertInteractiveMapping: () => undefined,
  };
  return {
    host: createPromptInteractiveRuntimeHost(deps),
    panelMessages,
    runStatus,
    messagesBySession,
  };
}

function inputFor(prompt: string): PromptRunInput {
  return { displayPrompt: prompt, modelPrompt: prompt, contextTags: [] };
}

function targetFor(sessionId: string | null): PromptRunTarget {
  return { tabId: "tab-grok", cli: "grok", sessionId };
}

async function waitForLine(
  fake: FakeGrok,
  match: (line: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    const found = fake.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find(match);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for Grok client response");
}
