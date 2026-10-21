import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";
import { buildTimedOutHumanInteractionSubmission, HUMAN_INTERACTION_TIMEOUT_TEXT, type HumanInteractionRequest } from "../../humanInteraction";

installVscodeMock();

import type { CliName } from "../../cli/types";
import type { GrokInteractiveRunner, GrokStreamHandlers } from "../../interactive/grokRunner";
import type { InteractiveRunnerManager } from "../../interactive/manager";
import type { ChatMessage } from "../../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import type { InteractiveTabRun } from "../../extensionHost/promptExecutionShared";

const { GrokInteractiveRunner: GrokRunner } = require("../../interactive/grokRunner") as typeof import("../../interactive/grokRunner");
const { InteractiveRunnerManager: RunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");
const {
  createPromptInteractiveRuntimeHost,
} = require("../../extensionHost/promptInteractiveRuntime") as typeof import("../../extensionHost/promptInteractiveRuntime");
const {
  applyGrokVisualPatch,
  serializeGrokDocument,
} = require("../../config/grokConfig") as typeof import("../../config/grokConfig");
const { parseGrokToml } = require("../../config/grokToml") as typeof import("../../config/grokToml");
const {
  applyConfig,
  getCurrentConfig,
} = require("../../config/configService") as typeof import("../../config/configService");
const {
  classifyGrokSessionMessage,
  formatGrokToolTrace,
  readGrokPromptStopReason,
} = require("../../interactive/grokAppServerProtocol") as typeof import("../../interactive/grokAppServerProtocol");

type RuntimeDeps = Parameters<typeof createPromptInteractiveRuntimeHost>[0];

function grokOptions(sessionId = "local-session") {
  return {
    sessionId,
    command: "grok",
    agentArgs: ["--always-approve"],
    cwd: "/workspace",
    thinkingMode: "xhigh" as const,
    interactiveMode: "coding" as const,
    model: "grok-4.7-kedaya",
    localSessionId: sessionId,
  };
}

test("host selection creates and reuses a GrokInteractiveRunner", () => {
  const manager = new RunnerManager();
  try {
    const first = manager.getOrCreateGrokRunner(grokOptions());
    const reused = manager.getOrCreateGrokRunner(grokOptions());
    assert.equal(first instanceof GrokRunner, true);
    assert.equal(reused, first);
    assert.equal(manager.hasGrokRunner("local-session", first), true);
    manager.setRunner("grok", "local-session", first, "max", "coding", "grok-4.7-kedaya", {
      command: "grok",
      args: ["--always-approve"],
      cwd: "/workspace",
    });
    assert.equal(manager.hasGrokRunner("local-session", first), true);
  } finally {
    manager.disposeAll();
  }
});

test("empty Grok session id does not create a runner", () => {
  const manager = new RunnerManager();
  try {
    assert.throws(() => manager.getOrCreateGrokRunner(grokOptions("   ")), (error: unknown) => {
      assert.equal((error as { reason?: string }).reason, "empty");
      return true;
    });
    assert.equal(manager.hasGrokRunner("local-session", {} as GrokInteractiveRunner), false);
  } finally {
    manager.disposeAll();
  }
});

test("failed Grok startup reports an empty command before spawning", async () => {
  const manager = new RunnerManager();
  try {
    const runner = manager.getOrCreateGrokRunner({ ...grokOptions(), command: "   " });
    await assert.rejects(() => runner.start(), /为空|empty/u);
    assert.equal(runner.isReusable(), true);
  } finally {
    manager.disposeAll();
  }
});

test("empty Grok prompt is rejected before a turn starts", async () => {
  const runner = new GrokRunner({ cwd: "/workspace", command: "grok", localSessionId: "local-session" });
  await assert.rejects(() => runner.prompt("   "), (error: unknown) => {
    assert.equal((error as { reason?: string }).reason, "empty");
    return true;
  });
});

function createHostHarness(options: {
  behavior: (prompt: string, handlers: GrokStreamHandlers) => Promise<void>;
  requireExplicitFinalAnswer?: boolean;
  acpSessionId?: string;
  resolveGrokModelForRun?: RuntimeDeps["resolveGrokModelForRun"];
  humanInteractionEnabled?: boolean;
  requestHumanInteraction?: RuntimeDeps["requestHumanInteraction"];
} ) {
  const activeRunsByTabId = new Map<string, InteractiveTabRun>();
  const messagesBySession = new Map<string, ChatMessage[]>();
  const pendingMessagesByTab = new Map<string, ChatMessage[]>();
  const panelMessages: Array<Record<string, unknown>> = [];
  const runStatus: string[] = [];
  const adopted: string[] = [];
  const created: string[] = [];
  const resumed: Array<string | null> = [];
  const models: Array<string | null | undefined> = [];
  const humanRequests: HumanInteractionRequest[] = [];
  let idCounter = 0;
  const runner = {
    start: async () => ({ acpSessionId: options.acpSessionId ?? "acp-session", resumed: false, retainedLocalSessionId: null }),
    prompt: options.behavior,
    cancelTurn: () => undefined,
    dispose: () => undefined,
    isReusable: () => true,
  };
  const manager = {
    getOrCreateGrokRunner: (input: { sessionId: string; localSessionId?: string | null; model?: string | null }) => {
      created.push(input.sessionId);
      resumed.push(input.localSessionId ?? null);
      models.push(input.model);
      return runner;
    },
    hasGrokRunner: () => created.length > 0,
    setRunner: () => undefined,
    detachRunner: () => undefined,
  } as unknown as InteractiveRunnerManager;
  const deps: RuntimeDeps = {
    AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024,
    activeRunsByTabId,
    adoptSessionId: (_cli, sessionId) => {
      adopted.push(sessionId);
    },
    applyProcessTitle: () => undefined,
    applyThinkingWorkspaceFiles: () => undefined,
    appendTaskRun: () => undefined,
    buildSubagentProgressLabels: () => ({
      provider: { codex: "Codex", loop: "Loop", opencode: "OpenCode" },
      subagent: "subagent",
      status: { running: "running", completed: "completed", failed: "failed", interrupted: "interrupted" },
      errorPrefix: "error: ",
    }),
    buildTaskRunCompletionText: (status) => `completion:${status}`,
    createMessageId: () => `msg-${++idCounter}`,
    getActiveConfigIdForCli: () => null,
    getConversationTabById: () => ({ sessionId: "local-session" }),
    getEffectiveCliArgs: () => [],
    getEffectiveThinkingMode: () => "xhigh",
    getGlobalHumanInteractionEnabled: () => options.humanInteractionEnabled === true,
    getPendingSessionDraft: (tabId) => {
      const existing = pendingMessagesByTab.get(tabId);
      if (existing) {
        return { messages: existing };
      }
      const next: ChatMessage[] = [];
      pendingMessagesByTab.set(tabId, next);
      return { messages: next };
    },
    getSelectedCliModel: () => "grok-4.7-kedaya",
    resolveGrokModelForRun: options.resolveGrokModelForRun,
    getWorkspaceInteractiveMode: () => "coding",
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
    resolveInteractiveSessionForResume: async (_cli, sessionId) => sessionId,
    resolveWorkspaceCwd: () => "/workspace",
    requestHumanInteraction: async (request) => {
      humanRequests.push(request);
      return options.requestHumanInteraction?.(request) ?? {
        interactionId: request.interactionId,
        tabId: request.tabId,
        status: "completed",
        values: {},
      };
    },
    cancelHumanInteractionForTab: () => undefined,
    sendPanelMessage: (payload) => {
      panelMessages.push(payload);
    },
    sendRunStatusForTab: (_tabId, status) => {
      runStatus.push(status);
    },
    shouldAutoCompactContextAfterRunForTarget: () => false,
    shouldRequireExplicitFinalAnswerForRun: () => options.requireExplicitFinalAnswer === true,
    t: (key) => key,
    updateProcessTitle: () => undefined,
    upsertInteractiveMapping: () => undefined,
  };
  return {
    host: createPromptInteractiveRuntimeHost(deps),
    panelMessages,
    runStatus,
    adopted,
    created,
    resumed,
    models,
    humanRequests,
    messagesBySession,
  };
}

function inputFor(prompt: string): PromptRunInput {
  return { displayPrompt: prompt, modelPrompt: prompt, contextTags: [] };
}

function targetFor(sessionId: string | null): PromptRunTarget {
  return { tabId: "tab-grok", cli: "grok", sessionId };
}

function deliverGrokSessionUpdate(handlers: GrokStreamHandlers, update: Record<string, unknown>): void {
  const event = classifyGrokSessionMessage({
    method: "session/update",
    params: { update },
  });
  if (event.type === "assistant_text") {
    handlers.onAssistantDelta?.(event.text);
    return;
  }
  if (event.type === "thinking") {
    handlers.onTrace?.(event.text, "thinking");
    return;
  }
  if (event.type === "tool" || event.type === "tool_update") {
    handlers.onTrace?.(formatGrokToolTrace(event));
  }
}

test("Grok session updates enter the existing assistant, thinking, and tool channels", async () => {
  const harness = createHostHarness({
    behavior: async (_prompt, handlers) => {
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello " },
      });
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_message_chunk",
        content: [{ type: "text", text: "world" }],
      });
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "" },
      });
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "   " },
      });
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "consider the file" },
      });
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "   " },
      });
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "tool_call",
        title: "read_file",
        status: "in_progress",
        rawInput: {},
      });
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "tool_call_update",
        title: "read_file",
        status: "completed",
        rawOutput: "ok",
      });
      const stopReason = readGrokPromptStopReason({
        result: { stopReason: "end_turn", text: "not-body" },
      });
      handlers.onComplete?.({ stopReason });
    },
  });
  await harness.host.runPromptInteractive(inputFor("Say hello"), targetFor("local-session"));
  assert.deepEqual(harness.created, ["local-session"]);
  assert.deepEqual(harness.adopted, []);
  assert.deepEqual(harness.runStatus, ["start", "end"]);
  const stored = harness.messagesBySession.get("local-session") ?? [];
  const assistant = stored.filter((message) => message.role === "assistant" && message.kind !== "thinking");
  const thinking = stored.filter((message) => message.role === "assistant" && message.kind === "thinking");
  const tools = stored.filter((message) => message.role === "trace");
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0]?.content, "Hello world");
  assert.equal(thinking.length, 1);
  assert.match(thinking[0]?.content ?? "", /consider the file/);
  assert.equal(tools.length, 2);
  assert.match(tools[0]?.content ?? "", /^tool:/);
  assert.match(tools[0]?.content ?? "", /status: in_progress/);
  assert.match(tools[1]?.content ?? "", /^tool result:/);
  assert.match(tools[1]?.content ?? "", /status: completed/);
  assert.equal(stored.some((message) => String(message.content).includes("end_turn")), false);
  assert.equal(stored.some((message) => String(message.content).includes("not-body")), false);
  assert.equal(assistant[0]?.content.includes("consider the file"), false);
  assert.equal(assistant[0]?.content.includes("read_file"), false);
});

test("an empty Grok prompt does not create a runner or bubbles", async () => {
  const harness = createHostHarness({
    behavior: async () => {
      throw new Error("should not prompt");
    },
  });
  await harness.host.runPromptInteractive(inputFor(""), targetFor(null));
  assert.deepEqual(harness.created, []);
  assert.deepEqual(harness.panelMessages, []);
  assert.deepEqual(harness.runStatus, []);
});

test("a failed Grok turn does not become assistant text", async () => {
  const harness = createHostHarness({
    behavior: async () => {
      const error = new Error("spawn grok ENOENT");
      (error as { code?: string }).code = "ENOENT";
      throw error;
    },
  });
  await assert.rejects(() => harness.host.runPromptInteractive(inputFor("Say hello"), targetFor("local-session")));
  const stored = harness.messagesBySession.get("local-session") ?? [];
  assert.equal(stored.some((message) => message.role === "assistant"), false);
  assert.equal(harness.runStatus.includes("error"), true);
  assert.equal(harness.adopted.includes("acp-session"), false);
});

const SAMPLE_GROK_TOML = `
# keep-comment
[models]
default = "grok-4.7-kedaya"
default_reasoning_effort = "xhigh"

[model.grok-4.7-kedaya]
model = "grok-4.7-kedaya"
name = "grok-4.7-kedaya"
base_url = "http://127.0.0.1:33391/v1"
api_backend = "responses"
env_key = "EXAMPLE_ENV_NAME"
context_window = 500000
reasoning_summary = "auto"
compaction_at_tokens = 450000
kept_note = "leave-me"

[custom]
kept = true
`.trim() + "\n";

async function withGrokHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-grok-config-"));
  const previous = process.env.GROK_HOME;
  process.env.GROK_HOME = homeDir;
  try {
    return await run(homeDir);
  } finally {
    if (previous === undefined) {
      delete process.env.GROK_HOME;
    } else {
      process.env.GROK_HOME = previous;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

test("Grok config platform reads and writes TOML while keeping unshown fields", async () => {
  await withGrokHome(async (homeDir) => {
    const parsed = parseGrokToml(SAMPLE_GROK_TOML);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const patched = applyGrokVisualPatch(parsed.value, {
      defaultModel: "grok-4.7-kedaya",
      defaultReasoningEffort: "xhigh",
      model: { id: "grok-4.7-kedaya", model: "gpt-6.1-sol" },
    });
    assert.equal(patched.ok, true);
    if (!patched.ok) {
      return;
    }
    const serialized = serializeGrokDocument(patched.document);
    assert.equal(serialized.ok, true);
    if (!serialized.ok) {
      return;
    }
    await applyConfig("grok", { content: serialized.content });
    const current = await getCurrentConfig("grok");
    assert.match(current.content ?? "", /model = "gpt-6.1-sol"/);
    assert.match(current.content ?? "", /name = "grok-4\.7-kedaya"/);
    assert.match(current.content ?? "", /kept_note = "leave-me"/);
    assert.match(current.content ?? "", /\[custom\]/);
    assert.match(current.configContent ?? "", /env_key = "EXAMPLE_ENV_NAME"/);
    assert.equal(current.authContent, undefined);
    const configPath = path.join(homeDir, "config.toml");
    assert.equal(await fs.readFile(configPath, "utf8"), serialized.content);
    const names = await fs.readdir(homeDir);
    assert.deepEqual(names, ["config.toml"]);
  });
});

test("empty Grok config text is not saved over the previous file", async () => {
  await withGrokHome(async (homeDir) => {
    await applyConfig("grok", { content: SAMPLE_GROK_TOML });
    const configPath = path.join(homeDir, "config.toml");
    const before = await fs.readFile(configPath, "utf8");
    await assert.rejects(() => applyConfig("grok", { content: "   " }));
    assert.equal(await fs.readFile(configPath, "utf8"), before);
  });
});

test("invalid Grok TOML does not replace the previous valid file", async () => {
  await withGrokHome(async (homeDir) => {
    await applyConfig("grok", { content: SAMPLE_GROK_TOML });
    const configPath = path.join(homeDir, "config.toml");
    const before = await fs.readFile(configPath, "utf8");
    await assert.rejects(() => applyConfig("grok", { content: "models = [\n" }));
    assert.equal(await fs.readFile(configPath, "utf8"), before);
    const current = await getCurrentConfig("grok");
    assert.match(current.content ?? "", /grok-4\.7-kedaya/);
  });
});


test("Grok runtime rechecks configured models before creating a runner", async () => {
  let requested: string | null = null;
  const harness = createHostHarness({
    resolveGrokModelForRun: async (model) => {
      requested = model;
      return "gpt-6.1-sol";
    },
    behavior: async (_prompt, handlers) => {
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "SOL_OK" },
      });
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive({ ...inputFor("Reply SOL_OK"), model: "removed" }, targetFor("local-session"));
  assert.equal(requested, "removed");
  assert.deepEqual(harness.models, ["gpt-6.1-sol"]);
});

test("Grok runtime rejects an empty or invalid model configuration before spawning", async () => {
  const harness = createHostHarness({
    resolveGrokModelForRun: async () => { throw new Error("No configured Grok model"); },
    behavior: async () => { throw new Error("Must not start"); },
  });
  await assert.rejects(
    () => harness.host.runPromptInteractive(inputFor("Reply SOL_OK"), targetFor("local-session")),
    /No configured Grok model/,
  );
  assert.deepEqual(harness.created, []);
});

test("Grok adopts the ACP session and ends a normal reply without a final-answer marker", async () => {
  const harness = createHostHarness({
    acpSessionId: "01a1450f-97a8-7882-a51c-b39c6d30a180",
    requireExplicitFinalAnswer: true,
    behavior: async (_prompt, handlers) => {
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "上海本周示例预报" },
      });
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("写一周上海天气预报"), targetFor("local_1792000000000_abc"));
  assert.deepEqual(harness.resumed, [null]);
  assert.deepEqual(harness.adopted, ["01a1450f-97a8-7882-a51c-b39c6d30a180"]);
  assert.deepEqual(harness.runStatus, ["start", "end"]);
  const stored = harness.messagesBySession.get("01a1450f-97a8-7882-a51c-b39c6d30a180") ?? [];
  const assistant = stored.filter((message) => message.role === "assistant" && message.kind !== "thinking");
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0]?.content, "上海本周示例预报");
});

test("Grok reloads a saved ACP session instead of the local session id", async () => {
  const harness = createHostHarness({
    acpSessionId: "01a1450f-97a8-7882-a51c-b39c6d30a180",
    behavior: async (_prompt, handlers) => {
      deliverGrokSessionUpdate(handlers, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "42" },
      });
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("继续"), targetFor("01a1450f-97a8-7882-a51c-b39c6d30a180"));
  assert.deepEqual(harness.resumed, ["01a1450f-97a8-7882-a51c-b39c6d30a180"]);
  assert.deepEqual(harness.adopted, []);
  assert.deepEqual(harness.runStatus, ["start", "end"]);
});

const grokQuestionRequest = {
  method: "_x.ai/ask_user_question",
  params: { sessionId: "acp-session", questions: [{ question: "选择平台？", options: [{ label: "Linux" }, { label: "Windows" }], multiSelect: true }] },
};

test("Grok native questions use the existing tab-bound human interaction form", async () => {
  const harness = createHostHarness({
    humanInteractionEnabled: true,
    requestHumanInteraction: async (request) => ({
      interactionId: request.interactionId, tabId: request.tabId, status: "completed", values: { answer_1: ["Linux", "Windows"] },
    }),
    behavior: async (_prompt, handlers) => {
      assert.deepEqual(await handlers.onRequest?.(grokQuestionRequest), { result: { outcome: "accepted", answers: { "选择平台？": ["Linux", "Windows"] } } });
      handlers.onAssistantDelta?.("已根据选择继续。");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("确认平台后继续"), targetFor("local-session"));
  assert.equal(harness.humanRequests.length, 1);
  assert.equal(harness.humanRequests[0].tabId, "tab-grok");
  assert.deepEqual(harness.runStatus, ["start", "end"]);
  const messages = harness.messagesBySession.get("local-session") ?? [];
  assert.ok(messages.some((message) => message.role === "user" && message.content.includes("Linux") && message.content.includes("Windows")));
});

test("Grok native questions respect disabled interaction and Loop or Graph ownership", async () => {
  for (const input of [{ enabled: false }, { enabled: true, loopTaskId: "loop-one" }, { enabled: true, graphRunId: "graph-one" }]) {
    const harness = createHostHarness({
      humanInteractionEnabled: input.enabled,
      behavior: async (_prompt, handlers) => {
        assert.equal(await handlers.onRequest?.(grokQuestionRequest), null);
        handlers.onAssistantDelta?.("继续执行。");
        handlers.onComplete?.({ stopReason: "end_turn" });
      },
    });
    await harness.host.runPromptInteractive({ ...inputFor("继续"), loopTaskId: input.loopTaskId, graphRunId: input.graphRunId }, targetFor("local-session"));
    assert.equal(harness.humanRequests.length, 0);
  }
});

test("Grok timed-out questions return autonomous continuation rather than rejection", async () => {
  const harness = createHostHarness({
    humanInteractionEnabled: true,
    requestHumanInteraction: async (request) => buildTimedOutHumanInteractionSubmission(request),
    behavior: async (_prompt, handlers) => {
      assert.deepEqual(await handlers.onRequest?.(grokQuestionRequest), {
        result: { outcome: "accepted", answers: { "选择平台？": [HUMAN_INTERACTION_TIMEOUT_TEXT] } },
      });
      handlers.onAssistantDelta?.("自行选择后继续。");
      handlers.onComplete?.({ stopReason: "end_turn" });
    },
  });
  await harness.host.runPromptInteractive(inputFor("确认后继续"), targetFor("local-session"));
  assert.deepEqual(harness.runStatus, ["start", "end"]);
});

test("rejecting a Grok native question stops the host task without hidden retries", async () => {
  let prompts = 0;
  const harness = createHostHarness({
    humanInteractionEnabled: true,
    requestHumanInteraction: async (request) => ({ interactionId: request.interactionId, status: "aborted", values: {} }),
    behavior: async (_prompt, handlers) => {
      prompts += 1;
      await handlers.onRequest?.(grokQuestionRequest);
    },
  });
  await harness.host.runPromptInteractive(inputFor("确认后继续"), targetFor("local-session"));
  assert.equal(prompts, 1);
  assert.deepEqual(harness.runStatus, ["start", "stopped"]);
});
