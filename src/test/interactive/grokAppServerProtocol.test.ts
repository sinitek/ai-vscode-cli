import assert = require("node:assert/strict");
import { PassThrough } from "node:stream";
import test = require("node:test");
import { createCodexAppServerNdjsonReader } from "../../interactive/codexAppServerNdjson";
import {
  buildGrokAuthenticateParams,
  buildGrokRequestError,
  buildGrokInitializeParams,
  buildGrokSessionNewParams,
  buildGrokReasoningConfigParams,
  GROK_CLIENT_INFO_VERSION,
  classifyGrokSessionMessage,
  extractGrokAssistantText,
  formatGrokToolTrace,
  findGrokReasoningOption,
  parseGrokJsonRpcLine,
  isGrokCompletedStopReason,
  readGrokPromptStopReason,
  readGrokSessionId,
  readGrokStreamFailure,
  readGrokCompactionEvent,
  readGrokTokenUsageUpdate,
  GROK_RESPONSES_STREAM_INCOMPATIBLE,
  resolveGrokReasoningEffort,
  resolveGrokResumeSessionId,
  selectGrokAuthMethod,
} from "../../interactive/grokAppServerProtocol";

test("reads Grok current context snapshots instead of cumulative session usage", () => {
  const params = {
    sessionId: "saved-session",
    update: {
      sessionUpdate: "session_status",
      schema_version: 1,
      session_id: "saved-session",
      context_window: {
        context_tokens: 12345,
        context_window_size: 128000,
        session_input_tokens: 900000,
        session_output_tokens: 50000,
      },
    },
  };
  for (const method of ["_x.ai/session_notification", "_x.ai/session/update"]) {
    assert.deepEqual(readGrokTokenUsageUpdate({ method, params }, "saved-session"), {
      tokensInContextWindow: 12345,
      modelContextWindow: 128000,
    });
  }
  params.update.context_window.context_tokens = 0;
  params.update.context_window.context_window_size = 0;
  assert.deepEqual(readGrokTokenUsageUpdate({ method: "_x.ai/session_notification", params }, "saved-session"), {
    tokensInContextWindow: 0,
    modelContextWindow: null,
  });
  assert.equal(readGrokTokenUsageUpdate({ method: "_x.ai/session_notification", params }, "other-session"), null);
  params.update.session_id = "other-session";
  assert.equal(readGrokTokenUsageUpdate({ method: "_x.ai/session_notification", params }, "saved-session"), null);
});

test("accepts standard ACP context usage but rejects missing or malformed Grok counts", () => {
  const message = (update: Record<string, unknown>) => ({ method: "session/update", params: { sessionId: "saved-session", update } });
  assert.deepEqual(readGrokTokenUsageUpdate(message({ sessionUpdate: "usage_update", used: 12345, size: 128000, cost: { amount: 500 } }), "saved-session"), {
    tokensInContextWindow: 12345,
    modelContextWindow: 128000,
  });
  for (const used of [undefined, null, -1, 1.5, NaN, Infinity, "123", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(readGrokTokenUsageUpdate(message({ sessionUpdate: "usage_update", used, size: 128000 }), "saved-session"), null);
  }
  for (const size of [-1, null, Infinity, "128000", 1.5]) {
    assert.equal(readGrokTokenUsageUpdate(message({ sessionUpdate: "usage_update", used: 123, size }), "saved-session"), null);
  }
  for (const update of [
    { sessionUpdate: "response_completed", usage: { input_tokens: 5000, output_tokens: 100 } },
    { sessionUpdate: "session_status", schema_version: 1, session_id: "saved-session", context_window: { session_input_tokens: 900000 } },
    { sessionUpdate: "session_status", schema_version: 2, session_id: "saved-session", context_window: { context_tokens: 5000 } },
  ]) {
    assert.equal(readGrokTokenUsageUpdate(message(update), "saved-session"), null);
  }
  assert.equal(readGrokTokenUsageUpdate({ method: "other", params: { sessionId: "saved-session", update: { sessionUpdate: "usage_update", used: 123 } } }, "saved-session"), null);
  assert.equal(readGrokTokenUsageUpdate({ method: "session/update", params: { update: { sessionUpdate: "usage_update", used: 123 } } }, "saved-session"), null);
  assert.equal(readGrokTokenUsageUpdate({ method: "session/update", params: null }, "saved-session"), null);
  assert.equal(readGrokTokenUsageUpdate(message({ sessionUpdate: "usage_update", used: 123 }), ""), null);
});

test("reads native Grok compaction notifications without retaining summary content", () => {
  for (const method of ["_x.ai/session_notification", "_x.ai/session/update", "session/update"]) {
    const event = readGrokCompactionEvent({
      method,
      params: {
        sessionId: "saved-session",
        update: {
          sessionUpdate: "auto_compact_completed",
          tokens_before: 8000,
          tokens_after: 2000,
          summary_preview: "private conversation",
        },
      },
    }, "saved-session");
    assert.deepEqual(event, { status: "completed", tokensBefore: 8000, tokensAfter: 2000, error: null });
  }
});

test("filters foreign or invalid Grok compaction notifications and validates token counts", () => {
  const message = {
    method: "_x.ai/session_notification",
    params: { sessionId: "saved-session", update: { sessionUpdate: "auto_compact_completed" } },
  };
  assert.equal(readGrokCompactionEvent(message, "other-session"), null);
  assert.equal(readGrokCompactionEvent({ ...message, method: "other" }, "saved-session"), null);
  assert.equal(readGrokCompactionEvent({ method: "session/update", params: null }, "saved-session"), null);
  assert.equal(readGrokCompactionEvent({ method: "session/update", params: { update: { sessionUpdate: "toString" } } }, "saved-session"), null);
  for (const [sessionUpdate, status] of [
    ["auto_compact_started", "started"],
    ["auto_compact_failed", "failed"],
    ["auto_compact_cancelled", "cancelled"],
  ]) {
    assert.deepEqual(readGrokCompactionEvent({
      ...message,
      params: { ...message.params, update: { sessionUpdate, tokens_before: -1, tokens_after: "2000", error: "provider failure" } },
    }, "saved-session"), { status, tokensBefore: null, tokensAfter: null, error: "provider failure" });
  }
});

test("reports unsupported Responses events without exposing arbitrary RPC data", () => {
  for (const streamFailure of [null, "serialization error: unknown variant `response.metadata`"] as const) {
    const error = buildGrokRequestError({
      code: -32603, message: "Internal error",
      data: streamFailure ? undefined : "serialization error: unknown variant `response.metadata`",
    }, streamFailure, "gpt-6.1-sol");
    assert.equal((error as Error & { code: string }).code, GROK_RESPONSES_STREAM_INCOMPATIBLE);
    assert.match(error.message, /gpt-6.1-sol.*response.metadata/);
    assert.match(error.message, /chat_completions/);
  }
  assert.equal(buildGrokRequestError({ message: "Network error", data: "private diagnostic" }).message, "Network error");
  assert.equal(buildGrokRequestError({ message: "Internal error", data: {} }).message, "Internal error");
});

test("reads only failed Grok retry-state diagnostics", () => {
  const failure = { sessionUpdate: "retry_state", type: "failed", message: "serialization error" };
  assert.equal(readGrokStreamFailure({ method: "_x.ai/session/update", params: { update: failure } }), "serialization error");
  assert.equal(readGrokStreamFailure({ method: "session/update", params: { update: { ...failure, type: "retrying" } } }), null);
  assert.equal(readGrokStreamFailure({ method: "other", params: { update: failure } }), null);
  assert.equal(readGrokStreamFailure({ method: "session/update", params: {} }), null);
});

test("parses a Grok session update and keeps line separators inside strings", async () => {
  const stdout = new PassThrough();
  const reader = createCodexAppServerNdjsonReader(stdout);
  const pending = reader.lines[Symbol.asyncIterator]().next();
  const text = `line\u2028break`;
  stdout.end(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  })}\n`);
  const line = (await pending).value as string;
  const parsed = parseGrokJsonRpcLine(line);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(extractGrokAssistantText(parsed.message), text);
  assert.equal(classifyGrokSessionMessage(parsed.message).type, "assistant_text");
  const completion = parseGrokJsonRpcLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    result: { stopReason: "end_turn", text: "not body" },
  }));
  assert.equal(completion.ok, true);
  if (!completion.ok) {
    return;
  }
  assert.equal(extractGrokAssistantText(completion.message), "");
  assert.equal(readGrokPromptStopReason(completion.message), "end_turn");
  const initialize = buildGrokInitializeParams();
  assert.equal(initialize.protocolVersion, 1);
  const clientInfo = initialize.clientInfo as { name?: string; version?: string };
  assert.equal(clientInfo.name, "sinitek-cli-tools");
  assert.equal(clientInfo.version, GROK_CLIENT_INFO_VERSION);
  assert.equal(typeof clientInfo.version, "string");
  assert.notEqual(clientInfo.version, "");
  const capabilities = initialize.clientCapabilities as { terminal?: boolean; fs?: { readTextFile?: boolean } };
  assert.equal(capabilities.terminal, false);
  assert.equal(capabilities.fs?.readTextFile, false);
  assert.deepEqual((initialize.clientCapabilities as Record<string, unknown>)._meta, { "x.ai/statusLine": true });
  assert.deepEqual(buildGrokSessionNewParams("/tmp/grok"), {
    cwd: "/tmp/grok",
    mcpServers: [],
    _meta: { yoloMode: true },
  });
  const auth = buildGrokAuthenticateParams("cached_token");
  assert.deepEqual(auth, { methodId: "cached_token", _meta: { headless: true } });
  assert.equal(JSON.stringify(auth).includes("secret-value"), false);
  reader.close();
});

test("selects grok.com when that is the only advertised auth method", () => {
  const selected = selectGrokAuthMethod(["grok.com"], {});
  assert.deepEqual(selected, { ok: true, methodId: "grok.com" });
  const preferred = selectGrokAuthMethod(["grok.com", "xai.api_key"], { XAI_API_KEY: "present" });
  assert.deepEqual(preferred, { ok: true, methodId: "xai.api_key" });
  assert.equal(JSON.stringify(buildGrokAuthenticateParams("grok.com")).includes("present"), false);
});

test("rejects empty Grok protocol input", () => {
  const parsed = parseGrokJsonRpcLine(" \n");
  assert.deepEqual(parsed, { ok: false, reason: "empty", error: "空 Grok 消息。" });
  const auth = selectGrokAuthMethod([], { XAI_API_KEY: "present" });
  assert.equal(auth.ok, false);
  if (auth.ok) {
    return;
  }
  assert.equal(auth.reason, "empty");
});

test("fails closed for invalid JSON, missing auth methods, and unlisted reasoning", () => {
  const parsed = parseGrokJsonRpcLine("{");
  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    return;
  }
  assert.equal(parsed.reason, "invalid");
  const auth = selectGrokAuthMethod(["password"], { XAI_API_KEY: "present" });
  assert.equal(auth.ok, false);
  if (auth.ok) {
    return;
  }
  assert.equal(auth.reason, "unavailable");
  assert.match(auth.error, /grok login/);
  assert.match(auth.error, /XAI_API_KEY/);
  const option = findGrokReasoningOption({
    configOptions: [{ id: "reasoning_effort", options: ["low", "high"] }],
  });
  assert.equal(resolveGrokReasoningEffort("ultra", option), null);
  assert.equal(resolveGrokReasoningEffort("on", option), null);
  assert.equal(resolveGrokReasoningEffort("off", null), null);
  const params = buildGrokReasoningConfigParams("session-1", "max");
  assert.deepEqual(params, {
    sessionId: "session-1",
    configId: "reasoning_effort",
    value: "max",
  });
  assert.notEqual(params.value, "ultra");
});

test("reads official session config options and sends a scalar reasoning value", () => {
  const option = findGrokReasoningOption({
    configOptions: [{
      id: "reasoning_effort",
      name: "Reasoning Effort",
      category: "thought_level",
      type: "select",
      currentValue: "low",
      options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }],
    }],
  });
  assert.deepEqual(option, { id: "reasoning_effort", allowed: ["low", "high"] });
  assert.equal(resolveGrokReasoningEffort("high", option), "high");
  assert.equal(resolveGrokReasoningEffort("xhigh", option), null);
  assert.deepEqual(buildGrokReasoningConfigParams("session-1", "high"), {
    sessionId: "session-1",
    configId: "reasoning_effort",
    value: "high",
  });
});


test("resumes only a real Grok session and treats end_turn as completion", () => {
  assert.equal(resolveGrokResumeSessionId("local_1_abc", null), null);
  assert.equal(resolveGrokResumeSessionId("local_1_abc", "01a1450f-97a8-7882-a51c-b39c6d30a180"), "01a1450f-97a8-7882-a51c-b39c6d30a180");
  assert.equal(resolveGrokResumeSessionId("01a1450f-97a8-7882-a51c-b39c6d30a180", null), "01a1450f-97a8-7882-a51c-b39c6d30a180");
  assert.equal(isGrokCompletedStopReason("end_turn"), true);
  assert.equal(isGrokCompletedStopReason(null), true);
  assert.equal(isGrokCompletedStopReason("cancelled"), false);
  assert.equal(isGrokCompletedStopReason("refusal"), false);
});


test("reads a Grok session id from session/load _meta", () => {
  assert.equal(readGrokSessionId({
    models: { currentModelId: "grok-4.7-kedaya" },
    _meta: {
      sessionId: "01a14527-e90f-7980-9af5-d9db3333ee4d",
      "x.ai/sessionDetail": { sessionId: "01a14527-e90f-7980-9af5-d9db3333ee4d" },
    },
  }), "01a14527-e90f-7980-9af5-d9db3333ee4d");
});

function grokUpdate(update: Record<string, unknown>) {
  return classifyGrokSessionMessage({
    method: "session/update",
    params: { update },
  });
}

function formatUpdateTrace(update: Record<string, unknown>): string {
  const event = grokUpdate(update);
  assert.ok(event.type === "tool" || event.type === "tool_update");
  if (event.type !== "tool" && event.type !== "tool_update") {
    return "";
  }
  return formatGrokToolTrace(event);
}

function firstTraceLine(update: Record<string, unknown>): string {
  return formatUpdateTrace(update).split("\n")[0] ?? "";
}

test("names a Grok tool result from output type instead of the call id", () => {
  const callId = "call-2d87b215-0a75-404f-815a-686594e3def5-84";
  const event = grokUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: callId,
    status: "completed",
    rawOutput: { type: "ReadFile", path: "a.ts" },
  });
  assert.equal(event.type, "tool_update");
  if (event.type !== "tool_update") {
    return;
  }
  const trace = formatGrokToolTrace(event);
  assert.equal(trace.split("\n")[0], "tool result: ReadFile");
  assert.equal(trace.includes(callId), false);
  assert.match(trace, /^tool result: ReadFile\nstatus: completed\noutput:\n/);
  assert.match(trace, /"type": "ReadFile"/);
  assert.match(trace, /"path": "a\.ts"/);

  assert.equal(firstTraceLine({
    sessionUpdate: "tool_call",
    title: "bash",
    toolCallId: callId,
    status: "in_progress",
    rawInput: { command: "pwd" },
    rawOutput: { type: "ReadFile", path: "a.ts" },
  }), "tool: bash");

  const fallback = formatUpdateTrace({
    sessionUpdate: "tool_call_update",
    toolCallId: callId,
    status: "completed",
  });
  assert.equal(fallback.split("\n")[0], "tool result: tool");
  assert.equal(fallback.includes(callId), false);

  assert.equal(firstTraceLine({
    sessionUpdate: "tool_call_update",
    toolCallId: callId,
    rawOutput: "{\"type\":\"ReadFile\",\"path\":\"a.ts\"}",
  }), "tool result: ReadFile");
  assert.equal(firstTraceLine({
    sessionUpdate: "tool_call_update",
    toolCallId: callId,
    content: [{ type: "text", text: "hello" }, { type: "image" }, { type: "ReadFile", path: "a.ts" }],
  }), "tool result: ReadFile");
  assert.equal(firstTraceLine({
    sessionUpdate: "tool_call",
    kind: "bash",
    title: "ReadFile",
    rawOutput: { type: "grep" },
  }), "tool: bash");
  assert.equal(firstTraceLine({
    sessionUpdate: "tool_call_update",
    title: "2d87b215-0a75-404f-815a-686594e3def5",
    rawOutput: { type: "ReadFile" },
  }), "tool result: ReadFile");
  assert.equal(firstTraceLine({
    sessionUpdate: "tool_call_update",
    toolCallId: callId,
    rawOutput: "{",
  }), "tool result: tool");
});
