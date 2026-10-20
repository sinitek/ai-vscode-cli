import assert = require("node:assert/strict");
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
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
import { parseGrokToml } from "../../config/grokToml";

installVscodeMock();

const { GrokInteractiveRunner } = require("../../interactive/grokRunner") as typeof import("../../interactive/grokRunner");
const { buildGrokRequestError } = require("../../interactive/grokAppServerProtocol") as typeof import("../../interactive/grokAppServerProtocol");

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
  public loadedSessionId = "loaded-session";
  public promptResponse: ((message: Record<string, unknown>) => void) | null = null;
  public advertiseReasoning = true;
  public reasoningInInitialize = false;
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
    const configOptions = this.advertiseReasoning ? [{
      id: "reasoning_effort",
      name: "Reasoning Effort",
      category: "thought_level",
      type: "select",
      currentValue: "medium",
      options: this.reasoningOptions?.map((value) => ({ value, name: value })),
    }] : [];
    if (method === "initialize") {
      const result: Record<string, unknown> = {
        protocolVersion: 1,
        agentCapabilities: { loadSession: this.loadSession },
        authMethods: this.authMethods,
      };
      if (this.reasoningInInitialize) {
        result.configOptions = configOptions;
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
      this.send({ jsonrpc: "2.0", id, result: { sessionId: this.loadedSessionId, configOptions: this.reasoningInInitialize ? undefined : configOptions } });
      return;
    }
    if (method === "session/new") {
      this.send({ jsonrpc: "2.0", id, result: { sessionId: "grok-session", configOptions: this.reasoningInInitialize ? undefined : configOptions } });
      return;
    }
    if (method === "session/set_config_option") {
      if (typeof (message.params as { value?: unknown } | undefined)?.value !== "string") {
        this.send({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: expected a scalar config value" } });
        return;
      }
      this.send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "session/prompt") {
      if (this.promptResponse) {
        this.promptResponse(message);
        return;
      }
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
    value: "max",
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

async function createGrokCompactionFixture(context: test.TestContext) {
  const home = await emptyGrokHome();
  const fake = new FakeGrok();
  fake.loadSession = true;
  fake.loadedSessionId = "saved-session";
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: home },
    model: "gpt-6.1-sol",
    localSessionId: "saved-session",
    spawnImpl: () => fake as unknown as GrokChild,
  });
  context.after(async () => {
    runner.dispose();
    await fs.rm(home, { recursive: true, force: true });
  });
  return { fake, runner };
}

test("compacts the existing Grok session and reuses it for the following prompt", async (context) => {
  const { fake, runner } = await createGrokCompactionFixture(context);
  fake.promptResponse = (message) => {
    assert.deepEqual(message.params, { sessionId: "saved-session", prompt: [{ type: "text", text: "/compact" }] });
    for (const sessionUpdate of ["auto_compact_started", "auto_compact_completed"]) {
      fake.send({
        method: "_x.ai/session_notification",
        params: { sessionId: "saved-session", update: { sessionUpdate, tokens_before: 8000, tokens_after: 2000 } },
      });
    }
    fake.send({ id: message.id, result: { stopReason: "end_turn" } });
  };
  assert.deepEqual(await runner.compactSession(), {
    compacted: true, sessionId: "saved-session", tokensBefore: 8000, tokensAfter: 2000,
  });
  fake.promptResponse = null;
  const text: string[] = [];
  await runner.prompt("continue", { onAssistantDelta: (chunk) => text.push(chunk) });
  assert.equal(text.join(""), "hello");
  const methods = fake.lines.map((line) => JSON.parse(line).method);
  assert.equal(methods.filter((method) => method === "initialize").length, 1);
  assert.equal(methods.filter((method) => method === "session/load").length, 1);
  assert.equal(methods.includes("session/new"), false);
});

test("does not treat an ordinary Grok reply as successful compaction", async (context) => {
  const { runner } = await createGrokCompactionFixture(context);
  await assert.rejects(runner.compactSession(), /未确认原生上下文压缩完成/);
  assert.equal(runner.isReusable(), true);
});

test("rejects failed, cancelled and foreign-session Grok compaction confirmations", async (context) => {
  for (const scenario of ["failed", "cancelled", "foreign", "interrupted", "rpc-error"]) {
    await context.test(scenario, async (subcontext) => {
      const { fake, runner } = await createGrokCompactionFixture(subcontext);
      fake.promptResponse = (message) => {
        fake.send({
          method: "_x.ai/session_notification",
          params: {
            sessionId: scenario === "foreign" ? "other-session" : "saved-session",
            update: {
              sessionUpdate: scenario === "failed" || scenario === "cancelled" ? `auto_compact_${scenario}` : "auto_compact_completed",
              error: scenario === "failed" ? "compaction provider failed" : undefined,
            },
          },
        });
        fake.send(scenario === "rpc-error"
          ? { id: message.id, error: { code: -32603, message: "compact RPC failed" } }
          : { id: message.id, result: { stopReason: scenario === "interrupted" ? "cancelled" : "end_turn" } });
      };
      await assert.rejects(runner.compactSession(), /未确认原生上下文压缩完成|compaction provider failed|compact RPC failed/);
    });
  }
});

test("does not create or compact an empty Grok session when resuming fails", async (context) => {
  for (const scenario of ["missing", "unsupported", "wrong-session"]) {
    await context.test(scenario, async (subcontext) => {
      const { fake, runner } = await createGrokCompactionFixture(subcontext);
      fake.failLoad = scenario === "missing";
      fake.loadSession = scenario !== "unsupported";
      if (scenario === "wrong-session") fake.loadedSessionId = "other-session";
      await assert.rejects(runner.compactSession());
      const methods = fake.lines.map((line) => JSON.parse(line).method);
      assert.equal(methods.includes("session/new"), false);
      assert.equal(methods.includes("session/prompt"), false);
    });
  }
});

test("disposal settles pending Grok compaction and active prompts block compaction", async (context) => {
  const { fake, runner } = await createGrokCompactionFixture(context);
  await runner.start();
  let promptStarted!: () => void;
  const started = new Promise<void>((resolve) => { promptStarted = resolve; });
  fake.promptResponse = () => promptStarted();
  const pending = runner.prompt("active prompt");
  await started;
  await assert.rejects(runner.compactSession(), /当前任务运行中/);
  runner.dispose();
  await assert.rejects(pending, /disposed/);
});

test("disposal rejects pending native Grok compaction", async (context) => {
  const { fake, runner } = await createGrokCompactionFixture(context);
  let promptStarted!: () => void;
  const started = new Promise<void>((resolve) => { promptStarted = resolve; });
  fake.promptResponse = () => promptStarted();
  const pending = runner.compactSession();
  await started;
  runner.dispose();
  await assert.rejects(pending, /disposed/);
});

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
    thinkingMode: "high",
    spawnImpl: () => loaded as unknown as GrokChild,
  });
  const loadedInfo = await loadedRunner.start();
  assert.equal(loadedInfo.acpSessionId, "loaded-session");
  assert.equal(loadedInfo.resumed, true);
  const loadedReasoning = loaded.lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((line) => line.method === "session/set_config_option");
  assert.deepEqual(loadedReasoning?.params, {
    sessionId: "loaded-session",
    configId: "reasoning_effort",
    value: "high",
  });
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
  assert.deepEqual(allowed, { sessionId: "grok-session", configId: "reasoning_effort", value: "xhigh" });
  const max = await readReasoningParams("max", {});
  assert.equal((max as { value?: string }).value, "max");
  const ultra = await readReasoningParams("ultra", {});
  assert.equal((ultra as { value?: string }).value, "max");
  const blocked = await readReasoningParams("ultra", { reasoningOptions: ["low", "medium", "high"] });
  assert.equal(blocked, null);
  const missing = await readReasoningParams("xhigh", { advertiseReasoning: false });
  assert.equal(missing, null);
  const legacy = await readReasoningParams("high", { reasoningInInitialize: true });
  assert.deepEqual(legacy, { sessionId: "grok-session", configId: "reasoning_effort", value: "high" });
});

test("fills missing reasoning configuration before spawning and sends the selected effort", async () => {
  const home = await emptyGrokHome();
  const configPath = path.join(home, "config.toml");
  await fs.writeFile(configPath, `[models]\ndefault = "default"\n[model.default]\nmodel = "default"\n[model.chosen]\nmodel = "chosen"\n`);
  const fake = new FakeGrok();
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: home },
    model: "chosen",
    thinkingMode: "ultra",
    spawnImpl: () => {
      const parsed = parseGrokToml(readFileSync(configPath, "utf8"));
      assert.equal(parsed.ok, true);
      if (parsed.ok) {
        const models = parsed.value.model as Record<string, { reasoning_efforts?: Array<{ value: string }> }>;
        assert.equal(models.default.reasoning_efforts, undefined);
        fake.reasoningOptions = models.chosen.reasoning_efforts!.map((option) => option.value);
        assert.ok(fake.reasoningOptions.includes("max"));
      }
      return fake as unknown as GrokChild;
    },
  });
  try {
    await runner.start();
    const request = fake.lines.map((line) => JSON.parse(line)).find((message) => message.method === "session/set_config_option");
    assert.deepEqual(request.params, { sessionId: "grok-session", configId: "reasoning_effort", value: "max" });
    const notices: string[] = [];
    await runner.prompt("test", { onTrace: (text, kind) => { if (kind === "normal") notices.push(text); } });
    assert.deepEqual(notices, []);
  } finally {
    runner.dispose();
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("rejects invalid reasoning configuration before spawning without changing the file", async () => {
  const home = await emptyGrokHome();
  const configPath = path.join(home, "config.toml");
  const content = '[model."broken"';
  await fs.writeFile(configPath, content);
  let spawned = false;
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, GROK_HOME: home },
    thinkingMode: "high",
    spawnImpl: () => { spawned = true; throw new Error("should not spawn"); },
  });
  try {
    await assert.rejects(runner.start(), /无法检查或补齐 Grok 思考档配置/);
    assert.equal(spawned, false);
    assert.equal(await fs.readFile(configPath, "utf8"), content);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("does not spawn if disposed while the reasoning preflight is pending", async () => {
  const home = await emptyGrokHome();
  let spawned = false;
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, GROK_HOME: home },
    thinkingMode: "high",
    spawnImpl: () => { spawned = true; throw new Error("should not spawn"); },
  });
  try {
    const starting = runner.start();
    runner.dispose();
    await assert.rejects(starting, /closed/);
    assert.equal(spawned, false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("explains missing or unsupported reasoning capabilities without blocking prompts", async () => {
  for (const advertiseReasoning of [false, true]) {
    const fake = new FakeGrok();
    fake.advertiseReasoning = advertiseReasoning;
    fake.reasoningOptions = ["low", "high"];
    const runner = new GrokInteractiveRunner({
      cwd: process.cwd(),
      command: process.execPath,
      env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
      thinkingMode: "xhigh",
      spawnImpl: () => fake as unknown as GrokChild,
    });
    try {
      await runner.start();
      const notices: string[] = [];
      await runner.prompt("first", { onTrace: (text, kind) => { if (kind === "normal") notices.push(text); } });
      await runner.prompt("second", { onTrace: (text, kind) => { if (kind === "normal") notices.push(text); } });
      assert.equal(notices.length, 1);
      assert.match(notices[0], advertiseReasoning ? /xhigh.*low, high/ : /已完成 Grok 思考档配置预检.*当前会话仍未提供/);
      assert.equal(fake.lines.some((line) => JSON.parse(line).method === "session/set_config_option"), false);
    } finally {
      runner.dispose();
    }
  }
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

test("does not mark a partial reply as complete and discards incompatible persistent runners", async () => {
  const home = await emptyGrokHome();
  const fake = new FakeGrok();
  const original = fake.respond.bind(fake);
  fake.respond = (message) => {
    if (message.method !== "session/prompt") {
      original(message);
      return;
    }
    fake.send({
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "partial reply" } } },
    });
    fake.send({
      method: "_x.ai/session/update",
      params: { update: {
        sessionUpdate: "retry_state", type: "failed",
        message: "serialization error: unknown variant `response.metadata`",
      } },
    });
    fake.send({ id: message.id, error: { code: -32603, message: "Internal error" } });
  };
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(), command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: home },
    model: "gpt-6.1-sol", spawnImpl: () => fake as unknown as GrokChild,
  });
  try {
    await runner.start();
    const body: string[] = [];
    let completed = false;
    await assert.rejects(runner.prompt("first", {
      onAssistantDelta: text => body.push(text),
      onComplete: () => { completed = true; },
    }), (error: Error & { code?: string }) => {
      assert.equal(error.code, "GROK_RESPONSES_STREAM_INCOMPATIBLE");
      assert.match(error.message, /gpt-6.1-sol.*response.metadata/);
      return true;
    });
    assert.deepEqual(body, ["partial reply"]);
    assert.equal(completed, false);
    assert.equal(runner.isReusable(), false);
    await assert.rejects(runner.prompt("second"));
    assert.equal(fake.lines.map(line => JSON.parse(line)).filter(message => message.method === "session/prompt").length, 1);
  } finally {
    runner.dispose();
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("host stops deterministic Responses failure after a partial bubble without retrying", async () => {
  let attempts = 0;
  const error = buildGrokRequestError({ message: "Internal error", data: "unknown variant `response.metadata`" }, null, "gpt-6.1-sol");
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      attempts += 1;
      handlers.onAssistantDelta?.("partial reply");
      throw error;
    },
  });
  await assert.rejects(harness.host.runPromptInteractive(inputFor("hello"), targetFor("local-session")), /response.metadata/);
  assert.equal(attempts, 1);
  assert.equal(harness.runStatus.includes("error"), true);
  assert.equal(harness.runStatus.includes("end"), false);
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

test("host updates a single stored tool bubble per call and preserves distinct call identities", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      handlers.onTrace?.("tool: bash\nstatus: in_progress\ncommand: pwd", "tool-use", { toolCallId: "one" });
      handlers.onTrace?.("tool: bash\nstatus: completed\ncommand: pwd\nexit_code: 0", "tool-use", { toolCallId: "one" });
      handlers.onTrace?.("tool: bash\nstatus: failed\ncommand: pwd\noutput:\nfailed", "tool-use", { toolCallId: "two" });
      handlers.onAssistantDelta?.("done");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("test"), targetFor("local-session"));
  const traces = (harness.messagesBySession.get("local-session") ?? []).filter((message) => message.role === "trace");
  assert.equal(traces.length, 2);
  assert.match(traces[0].content, /status: completed/);
  assert.equal(traces[0].merge, false);
  const updates = harness.panelMessages.filter((message) => message.type === "traceSegment");
  assert.equal(updates.length, 3);
  assert.equal(updates[0].id, updates[1].id);
  assert.notEqual(updates[0].id, updates[2].id);
  assert.equal(updates[0].createdAt, updates[1].createdAt);
});

test("host drains cancelled tool presentation before detaching but rejects later callbacks", async () => {
  let handlers: GrokStreamHandlers = {};
  let finish: () => void = () => undefined;
  let started: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const harness = createHostHarness({
    behavior: async (_prompt, current) => {
      handlers = current;
      handlers.onTrace?.("tool: bash\nstatus: in_progress", "tool-use", { toolCallId: "one" });
      await new Promise<void>((resolve) => { finish = resolve; started(); });
    },
    onCancel: () => {
      handlers.onTrace?.("tool: bash\nstatus: cancelled", "tool-use", { toolCallId: "one" });
      handlers.onEvent?.({ method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "one", status: "cancelled", rawOutput: "partial" } } });
      finish();
    },
  });
  const turn = harness.host.runPromptInteractive(inputFor("test"), targetFor("local-session"));
  await ready;
  harness.activeRunsByTabId.get("tab-grok")?.stop();
  await turn;
  const count = harness.panelMessages.length;
  handlers.onTrace?.("late", "tool-use", { toolCallId: "one" });
  handlers.onEvent?.({ method: "late" });
  assert.equal(harness.panelMessages.length, count);
  const traces = (harness.messagesBySession.get("local-session") ?? []).filter((message) => message.role === "trace");
  assert.equal(traces.length, 1);
  assert.match(traces[0].content, /status: cancelled/);
  assert.equal(harness.panelMessages.filter((message) => message.type === "rawStreamDelta").length, 1);
});

test("host routes filtered activity and plans without raw records and preserves whitespace deltas", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      handlers.onActivity?.();
      handlers.onActivity?.();
      handlers.onTaskListUpdate?.([{ text: "验证", done: false }]);
      handlers.onAssistantDelta?.("你好");
      handlers.onAssistantDelta?.(" \n");
      handlers.onAssistantDelta?.("世界");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("test"), targetFor("local-session"));
  assert.equal(harness.panelMessages.filter((message) => message.type === "runActivity").length, 1);
  assert.equal(harness.panelMessages.filter((message) => message.type === "rawStreamDelta").length, 0);
  assert.equal(harness.panelMessages.filter((message) => message.type === "taskListUpdate").length, 1);
  const assistant = (harness.messagesBySession.get("local-session") ?? []).filter((message) => message.role === "assistant");
  assert.equal(assistant[0].content, "你好 \n世界");
});

test("reports current Grok context after prompt completion and stops notifying on cancel", async () => {
  const fake = new FakeGrok();
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  const usage: Array<{ tokensInContextWindow: number; modelContextWindow: number | null }> = [];
  const events: unknown[] = [];
  const sendUsage = (tokens: number, sessionId = "grok-session") => fake.send({
    method: "_x.ai/session_notification",
    params: {
      sessionId,
      update: {
        sessionUpdate: "session_status",
        schema_version: 1,
        session_id: sessionId,
        context_window: { context_tokens: tokens, context_window_size: 128000, session_input_tokens: 900000 },
      },
    },
  });
  try {
    await runner.start();
    sendUsage(0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await runner.prompt("hello", { onTokenUsageUpdate: (update) => usage.push(update), onEvent: (event) => events.push(event) });
    sendUsage(12345);
    sendUsage(99999, "other-session");
    sendUsage(4000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(usage.map((update) => update.tokensInContextWindow), [0, 12345, 4000]);
    assert.equal(usage.every((update) => update.modelContextWindow === 128000), true);
    assert.equal(JSON.stringify(events).includes("session_status"), false);
    const nextUsage: number[] = [];
    await runner.prompt("again", { onTokenUsageUpdate: (update) => nextUsage.push(update.tokensInContextWindow) });
    sendUsage(6000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(nextUsage, [4000, 6000]);
    assert.equal(usage.length, 3);
    runner.cancelTurn();
    sendUsage(7000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(nextUsage, [4000, 6000]);
  } finally {
    runner.dispose();
  }
});

test("refreshes Grok context after every model response while a multi-step prompt is running", async () => {
  const fake = new FakeGrok();
  fake.promptResponse = () => undefined;
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(), command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  const usage: Array<{ tokensInContextWindow: number; modelContextWindow: number | null }> = [];
  const send = (update: Record<string, unknown>, sessionId = "grok-session") => fake.send({
    method: "_x.ai/session_notification", params: { sessionId, update },
  });
  const snapshot = (tokens: number, size = 128000) => send({
    sessionUpdate: "session_status", schema_version: 1, session_id: "grok-session",
    context_window: { context_tokens: tokens, context_window_size: size },
  });
  const response = (input: number, output: number, sessionId = "grok-session") => send({
    sessionUpdate: "response_completed",
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 3000, cache_creation_input_tokens: 200, reasoning_tokens: 10 },
  }, sessionId);
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    await runner.start();
    const turn = runner.prompt("multi-step task", { onTokenUsageUpdate: (update) => usage.push(update) });
    snapshot(1340);
    snapshot(1340);
    response(12000, 50);
    await flush();
    assert.deepEqual(usage, [
      { tokensInContextWindow: 1340, modelContextWindow: 128000 },
      { tokensInContextWindow: 15250, modelContextWindow: 128000 },
    ]);
    response(13000, 20);
    response(900000, 1, "other-session");
    send({ sessionUpdate: "turn_completed", usage: { input_tokens: 900000, output_tokens: 50000 } });
    send({ sessionUpdate: "response_completed", usage: { input_tokens: 8000 } });
    await flush();
    assert.equal(usage.at(-1)?.tokensInContextWindow, 16220);
    assert.equal(usage.length, 3);
    const prompt = fake.lines.map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((message) => message.method === "session/prompt");
    fake.send({ id: prompt?.id, result: { stopReason: "end_turn" } });
    await turn;
    response(99999, 1);
    snapshot(2000);
    snapshot(2000, 64000);
    snapshot(0, 64000);
    await flush();
    assert.deepEqual(usage.slice(3), [
      { tokensInContextWindow: 2000, modelContextWindow: 128000 },
      { tokensInContextWindow: 2000, modelContextWindow: 64000 },
      { tokensInContextWindow: 0, modelContextWindow: 64000 },
    ]);
    runner.cancelTurn();
    response(5000, 100);
    snapshot(5000);
    await flush();
    assert.equal(usage.length, 6);
  } finally {
    runner.dispose();
  }
});

test("host routes Grok context to its tab and accepts late snapshots only for the retained session", async () => {
  let handlers: GrokStreamHandlers = {};
  const harness = createHostHarness({
    behavior: async (_prompt, currentHandlers) => {
      handlers = currentHandlers;
      handlers.onTokenUsageUpdate?.({ tokensInContextWindow: 12345, modelContextWindow: 128000 });
      handlers.onAssistantDelta?.("[final_answer] Done.");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("hello"), targetFor("local-session"));
  const updates = () => harness.panelMessages.filter((message) => message.type === "contextTokenUsage");
  assert.deepEqual(updates(), [{ type: "contextTokenUsage", tabId: "tab-grok", tokensInContextWindow: 12345, modelContextWindow: 128000 }]);
  handlers.onTokenUsageUpdate?.({ tokensInContextWindow: 13000, modelContextWindow: 128000 });
  assert.equal(updates().length, 2);
  harness.tab.cli = "codex";
  handlers.onTokenUsageUpdate?.({ tokensInContextWindow: 1, modelContextWindow: null });
  harness.tab.cli = "grok";
  harness.tab.sessionId = "replacement-session";
  handlers.onTokenUsageUpdate?.({ tokensInContextWindow: 2, modelContextWindow: null });
  harness.tab.sessionId = "local-session";
  harness.runnerState.retained = false;
  handlers.onTokenUsageUpdate?.({ tokensInContextWindow: 3, modelContextWindow: null });
  harness.runnerState.retained = true;
  harness.activeRunsByTabId.set("tab-grok", { runId: "new-run" } as InteractiveTabRun);
  handlers.onTokenUsageUpdate?.({ tokensInContextWindow: 4, modelContextWindow: null });
  assert.equal(updates().length, 2);
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
  assert.equal(traces.length, 2);
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

test("keeps a cancelled prompt result out of the next turn replay", async () => {
  const fake = new FakeGrok();
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(),
    command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: await emptyGrokHome() },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  await runner.start();
  const promptIds: unknown[] = [];
  fake.respond = (message) => {
    if (message.method === "session/prompt") {
      promptIds.push(message.id);
    }
  };
  const firstEvents: Array<Record<string, unknown>> = [];
  const first = runner.prompt("first", { onEvent: (message) => firstEvents.push(message) });
  runner.cancelTurn();
  const secondEvents: Array<Record<string, unknown>> = [];
  const second = runner.prompt("second", { onEvent: (message) => secondEvents.push(message) });
  assert.equal(promptIds.length, 2);
  fake.send({ id: promptIds[0], result: { stopReason: "cancelled" } });
  await first;
  assert.equal(firstEvents.length, 0);
  assert.equal(secondEvents.length, 0);
  fake.send({
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "second body" } } },
  });
  fake.send({ id: promptIds[1], result: { stopReason: "end_turn" } });
  await second;
  assert.equal(secondEvents.length, 2);
  assert.match(JSON.stringify(secondEvents[0]), /second body/);
  assert.equal(secondEvents[1].id, promptIds[1]);
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
  assert.equal(events.length, 1);
  assert.equal(runner.isReusable(), false);
  runner.dispose();
  assert.equal(events.length, 1);
});

async function readReasoningParams(
  mode: string,
  options: { reasoningOptions?: string[] | null; advertiseReasoning?: boolean; reasoningInInitialize?: boolean },
): Promise<unknown> {
  const fake = new FakeGrok();
  if (options.reasoningOptions !== undefined) {
    fake.reasoningOptions = options.reasoningOptions;
  }
  if (options.advertiseReasoning !== undefined) {
    fake.advertiseReasoning = options.advertiseReasoning;
  }
  fake.reasoningInInitialize = options.reasoningInInitialize ?? false;
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
  onCancel?: () => void;
}) {
  const { createPromptInteractiveRuntimeHost } = require("../../extensionHost/promptInteractiveRuntime") as typeof import("../../extensionHost/promptInteractiveRuntime");
  const activeRunsByTabId = new Map<string, InteractiveTabRun>();
  const messagesBySession = new Map<string, ChatMessage[]>();
  const pendingMessagesByTab = new Map<string, ChatMessage[]>();
  const panelMessages: Array<Record<string, unknown>> = [];
  const runStatus: string[] = [];
  const tab: { cli: CliName; sessionId: string | null } = { cli: "grok", sessionId: "local-session" };
  const runnerState = { retained: true };
  let idCounter = 0;
  const runner = {
    start: async () => ({ acpSessionId: "acp-session", resumed: false, retainedLocalSessionId: null }),
    prompt: options.behavior,
    cancelTurn: () => options.onCancel?.(),
    dispose: () => undefined,
    isReusable: () => true,
  };
  const manager = {
    getOrCreateGrokRunner: () => runner,
    hasGrokRunner: () => runnerState.retained,
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
    getConversationTabById: () => tab,
    getEffectiveCliArgs: () => [],
    getEffectiveThinkingMode: () => "xhigh" as const,
    getGlobalHumanInteractionEnabled: () => false,
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
    tab,
    runnerState,
    activeRunsByTabId,
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

test("routes complete Grok todo snapshots once and rejects foreign, failed and previous-turn plans", async (context) => {
  const home = await emptyGrokHome();
  context.after(() => fs.rm(home, { recursive: true, force: true }));
  const fake = new FakeGrok();
  const runner = new GrokInteractiveRunner({
    cwd: process.cwd(), command: process.execPath,
    env: { ...process.env, XAI_API_KEY: "set", GROK_HOME: home },
    spawnImpl: () => fake as unknown as GrokChild,
  });
  const plans: Array<Array<{ text: string; done: boolean }>> = [];
  const send = (update: Record<string, unknown>, sessionId = "grok-session") => fake.send({ method: "session/update", params: { sessionId, update } });
  try {
    await runner.start();
    fake.promptResponse = ({ id }) => {
      send({ sessionUpdate: "plan", entries: [{ content: "外部", status: "pending" }] }, "foreign");
      send({ sessionUpdate: "tool_call", toolCallId: "create", kind: "think", title: "Updating plan", _meta: { "x.ai/tool": { name: "todo_write" } }, rawInput: { merge: false, todos: [{ id: "a", content: "调查", status: "pending" }, { id: "b", content: "验证", status: "pending" }] } });
      send({ sessionUpdate: "tool_call_update", toolCallId: "create", status: "completed", rawOutput: { type: "Todo", TodosUpdated: { todos: [{ content: "调查", status: "pending" }, { content: "验证", status: "pending" }] } } });
      send({ sessionUpdate: "plan", entries: [{ content: "调查", status: "pending" }, { content: "验证", status: "pending" }] });
      send({ sessionUpdate: "tool_call_update", toolCallId: "patch", title: "todo_write", status: "completed", rawInput: { todos: [{ id: "a", status: "completed" }] } });
      send({ sessionUpdate: "tool_call_update", toolCallId: "failure", title: "todo_write", status: "failed", rawInput: { merge: false, todos: [] } });
      send({ sessionUpdate: "plan", entries: [] });
      fake.send({ id, result: { stopReason: "end_turn" } });
    };
    await runner.prompt("调查并验证", { onTaskListUpdate: (items) => plans.push(items) });
    assert.deepEqual(plans, [
      [{ text: "调查", done: false }, { text: "验证", done: false }],
      [{ text: "调查", done: true }, { text: "验证", done: false }],
      [],
    ]);
    send({ sessionUpdate: "plan", entries: [{ content: "迟到", status: "pending" }] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(plans.length, 3);
    fake.promptResponse = ({ id }) => {
      send({ sessionUpdate: "tool_call_update", toolCallId: "patch", title: "todo_write", status: "completed", rawInput: { todos: [{ id: "a", status: "completed" }] } });
      fake.send({ id, result: { stopReason: "end_turn" } });
    };
    await runner.prompt("下一轮", { onTaskListUpdate: (items) => plans.push(items) });
    assert.equal(plans.length, 3);
  } finally {
    runner.dispose();
  }
});
