import assert = require("node:assert/strict");
import test = require("node:test");

import {
  acceptKimiIncrementalText,
  assertAdvertisedKimiModel,
  assertAdvertisedKimiThinking,
  boundKimiDiagnostic,
  buildKimiChildEnv,
  buildKimiInitializeParams,
  buildKimiLaunchArgs,
  buildKimiPermissionResult,
  buildKimiSessionNewParams,
  buildKimiSessionPromptParams,
  buildKimiSessionResumeParams,
  buildKimiSetConfigOptionParams,
  buildKimiSetModeParams,
  classifyKimiSessionUpdate,
  extractKimiTaskListItems,
  findKimiForbiddenWire,
  formatKimiRpcError,
  isKimiCompletedStopReason,
  isKimiResumableSessionId,
  KimiCompactionUnsupportedError,
  KimiProtocolError,
  KIMI_FOREIGN_CREDENTIAL_ENV_KEYS,
  parseKimiJsonRpcLine,
  planKimiProcessTreeStop,
  projectKimiToolUpdate,
  readKimiConfigOptions,
  readKimiModeState,
  readKimiPermissionOffer,
  readKimiPromptStopReason,
  readKimiSessionId,
  readKimiTokenUsageUpdate,
  redactKimiDiagnostic,
  resolveKimiHostResumeId,
  resolveKimiPermissionDecision,
} from "../../interactive/kimiAppServerProtocol";

test("kimi launch args pin the verified ACP subcommand and only allow --region", () => {
  assert.deepEqual(buildKimiLaunchArgs(), ["acp"]);
  assert.deepEqual(buildKimiLaunchArgs(["--region", "global"]), ["acp", "--region", "global"]);
  assert.deepEqual(buildKimiLaunchArgs(["--region=mainland-cn"]), ["acp", "--region", "mainland-cn"]);
  for (const rejected of [
    ["--yolo"],
    ["--auto"],
    ["-p", "hello"],
    ["--prompt", "hello"],
    ["--session", "session_1"],
    ["--continue"],
    ["--plan"],
    ["-m", "subcoco/kimi-k3.1-pro"],
    ["--"],
    ["acp"],
    ["experimental"],
  ]) {
    assert.throws(() => buildKimiLaunchArgs(rejected), KimiProtocolError, JSON.stringify(rejected));
  }
  assert.throws(() => buildKimiLaunchArgs(["--region", "mars"]), /--region must be one of/);
});

test("kimi child env drops foreign credentials and never rewrites an explicit env", () => {
  const fallback: NodeJS.ProcessEnv = { PATH: "/bin", OPENAI_API_KEY: "sk-openai", XAI_API_KEY: "xai" };
  const stripped = buildKimiChildEnv(undefined, fallback);
  assert.equal(stripped.PATH, "/bin");
  for (const key of KIMI_FOREIGN_CREDENTIAL_ENV_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(stripped, key), false, key);
  }
  const explicit = { PATH: "/bin", KIMI_CODE_HOME: "/tmp/kimi" };
  assert.deepEqual(buildKimiChildEnv(explicit, fallback), explicit);
});

test("kimi session ids are only resumable in the documented ACP shape", () => {
  assert.equal(isKimiResumableSessionId("session_1dde7471-361"), true);
  assert.equal(isKimiResumableSessionId("session_"), false);
  assert.equal(isKimiResumableSessionId("local_1"), false);
  assert.equal(isKimiResumableSessionId(null), false);
  assert.equal(resolveKimiHostResumeId("local_x", "session_abc"), "session_abc");
  assert.equal(resolveKimiHostResumeId("session_abc", null), "session_abc");
  assert.equal(resolveKimiHostResumeId("local_x", null), null);
});

test("kimi builds only the documented ACP payloads", () => {
  assert.deepEqual(buildKimiInitializeParams(), {
    protocolVersion: 1,
    clientInfo: { name: "sinitek-kimi-code-runner", version: "0" },
  });
  assert.deepEqual(buildKimiSessionNewParams("/tmp/work"), { cwd: "/tmp/work", mcpServers: [] });
  assert.deepEqual(buildKimiSessionResumeParams("session_a", "/tmp/work"), {
    sessionId: "session_a",
    cwd: "/tmp/work",
    mcpServers: [],
  });
  assert.deepEqual(buildKimiSessionPromptParams("session_a", "hi"), {
    sessionId: "session_a",
    prompt: [{ type: "text", text: "hi" }],
  });
  assert.deepEqual(buildKimiSetConfigOptionParams("session_a", "thinking", "high"), {
    sessionId: "session_a",
    configId: "thinking",
    value: "high",
  });
  assert.deepEqual(buildKimiSetModeParams("session_a", "yolo"), { sessionId: "session_a", modeId: "yolo" });
  assert.deepEqual(buildKimiPermissionResult({ outcome: "selected", optionId: "approve_once" }), {
    outcome: { outcome: "selected", optionId: "approve_once" },
  });
  assert.deepEqual(buildKimiPermissionResult({ outcome: "cancelled" }), {
    outcome: { outcome: "cancelled" },
  });
});

test("kimi rejects unverified wire methods and never sends session/load", () => {
  assert.equal(findKimiForbiddenWire({ method: "session/load" }), "session/load");
  assert.equal(findKimiForbiddenWire({ method: "session/fork" }), "session/fork");
  assert.equal(findKimiForbiddenWire({ method: "session/prompt" }), null);
  assert.equal(findKimiForbiddenWire("nope"), null);
});

test("kimi parses JSON-RPC frames and reports protocol errors", () => {
  assert.deepEqual(parseKimiJsonRpcLine(""), { ok: false, reason: "empty", error: "empty" });
  assert.equal(parseKimiJsonRpcLine("{").ok, false);
  assert.equal(parseKimiJsonRpcLine(JSON.stringify({ id: 1 })).ok, false);
  const parsed = parseKimiJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } }));
  assert.equal(parsed.ok, true);
  assert.equal(readKimiSessionId({ sessionId: " session_a " }), "session_a");
  assert.equal(readKimiSessionId({}), null);
  assert.equal(readKimiPromptStopReason({ stopReason: "end_turn" }), "end_turn");
  assert.equal(readKimiPromptStopReason({}), null);
  assert.equal(isKimiCompletedStopReason("end_turn"), true);
  assert.equal(isKimiCompletedStopReason("cancelled"), false);
  const error = formatKimiRpcError({ code: -32000, message: "turn failed" });
  assert.equal(error.code, "turn-failed");
  assert.equal(error.rpcCode, -32000);
  assert.equal(formatKimiRpcError({}).message, "ACP request failed");
});

test("kimi reads advertised config options and mode state", () => {
  const options = readKimiConfigOptions({
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "subcoco/kimi-k3.1-pro",
        options: [{ value: "subcoco/kimi-k3.1-pro", name: "Kimi K3.1 Pro" }],
      },
      {
        id: "thinking",
        currentValue: "high",
        options: [{ value: "off" }, { value: "high" }, { value: "max" }],
      },
    ],
  });
  assert.deepEqual(options.map((option) => option.id), ["model", "thinking"]);
  assert.deepEqual(options[1]?.values, ["off", "high", "max"]);
  assert.deepEqual(readKimiConfigOptions(null), []);

  const modes = readKimiModeState({
    modes: {
      currentModeId: "default",
      availableModes: [{ id: "default" }, { id: "plan" }, { id: "auto" }, { id: "yolo" }],
    },
  });
  assert.equal(modes.currentModeId, "default");
  assert.deepEqual(modes.available, ["default", "plan", "auto", "yolo"]);
});

test("kimi model and thinking are restricted to advertised values without rewriting ultra", () => {
  const model = {
    id: "model",
    currentValue: "subcoco/kimi-k3.1-pro",
    values: ["subcoco/kimi-k3.1-pro"],
    raw: {
      options: [{ value: "subcoco/kimi-k3.1-pro", name: "Kimi K3.1 Pro" }],
    },
  };
  assert.equal(assertAdvertisedKimiModel("subcoco/kimi-k3.1-pro", model), "subcoco/kimi-k3.1-pro");
  assert.equal(assertAdvertisedKimiModel("Kimi K3.1 Pro", model), "subcoco/kimi-k3.1-pro");
  assert.throws(() => assertAdvertisedKimiModel("subcoco/other", model), /is not advertised/);
  assert.throws(() => assertAdvertisedKimiModel("", model), /model is empty/);
  assert.throws(() => assertAdvertisedKimiModel("m", null), /did not advertise a model/);

  const thinking = { id: "thinking", currentValue: "high", values: ["off", "high", "max"], raw: {} };
  assert.equal(assertAdvertisedKimiThinking("max", thinking), "max");
  assert.throws(() => assertAdvertisedKimiThinking("ultra", thinking), /is not advertised/);
  assert.throws(
    () => assertAdvertisedKimiThinking("xhigh", { id: "thinking", values: ["off", "high", "max"], raw: {} }),
    /available: off, high, max/,
  );
});

test("kimi update classification covers text, thinking, tools, plan, mode and usage", () => {
  assert.deepEqual(
    classifyKimiSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "hi" },
    }),
    { type: "assistant_text", messageId: "m1", text: "hi" },
  );
  assert.deepEqual(
    classifyKimiSessionUpdate({
      sessionUpdate: "agent_thought_chunk",
      content: [{ type: "text", text: "think" }],
    }),
    { type: "thinking", messageId: "", text: "think" },
  );
  const tool = classifyKimiSessionUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "Write",
    kind: "edit",
    status: "pending",
    rawInput: { path: "hello.txt" },
    content: [{ type: "content", content: { type: "text", text: "wrote" } }],
  });
  assert.equal(tool.type, "tool");
  assert.deepEqual(
    classifyKimiSessionUpdate({ sessionUpdate: "plan", entries: [{ content: "a", status: "completed" }] }),
    { type: "plan", planId: "", items: [{ text: "a", done: true }] },
  );
  assert.deepEqual(
    classifyKimiSessionUpdate({ sessionUpdate: "plan", entries: "nope" }),
    { type: "ignored" },
  );
  assert.deepEqual(
    classifyKimiSessionUpdate({ sessionUpdate: "plan_removed", planId: "p1" }),
    { type: "plan_removed", planId: "p1" },
  );
  assert.deepEqual(
    classifyKimiSessionUpdate({ sessionUpdate: "current_mode_update", currentModeId: "yolo" }),
    { type: "mode", modeId: "yolo" },
  );
  assert.deepEqual(
    classifyKimiSessionUpdate({
      sessionUpdate: "config_option_update",
      configOptions: [{ id: "thinking", currentValue: "max", options: [{ value: "max" }] }],
    }).type,
    "config",
  );
  assert.deepEqual(
    classifyKimiSessionUpdate({ sessionUpdate: "usage_update", used: 12, size: 100 }),
    { type: "usage", used: 12, size: 100 },
  );
  assert.deepEqual(classifyKimiSessionUpdate({ sessionUpdate: "unknown" }), { type: "ignored" });
  assert.equal(extractKimiTaskListItems([{ text: "x", status: "done" }])?.[0]?.done, true);
  assert.equal(extractKimiTaskListItems([{ text: "" }]), null);
  assert.equal(extractKimiTaskListItems("nope"), null);
});

test("kimi token usage requires real positive context sizes", () => {
  assert.deepEqual(readKimiTokenUsageUpdate(125, 262144), {
    tokensInContextWindow: 125,
    modelContextWindow: 262144,
  });
  assert.equal(readKimiTokenUsageUpdate(125, 0), null);
  assert.equal(readKimiTokenUsageUpdate(-1, 100), null);
  assert.equal(readKimiTokenUsageUpdate("125", 100), null);
  assert.equal(readKimiTokenUsageUpdate(Number.NaN, 100), null);
});

test("kimi incremental text tracker only reports new suffixes", () => {
  const tracker = new Map<string, string>();
  assert.equal(acceptKimiIncrementalText(tracker, "m", ""), null);
  assert.equal(acceptKimiIncrementalText(tracker, "m", "he"), "he");
  assert.equal(acceptKimiIncrementalText(tracker, "m", "he"), null);
  assert.equal(acceptKimiIncrementalText(tracker, "m", "hello"), "llo");
  assert.equal(acceptKimiIncrementalText(tracker, "m", "new"), "new");
  assert.equal(tracker.get("m"), "hellonew");
});

test("kimi tool projection merges content and emits a trace only on change", () => {
  const first = projectKimiToolUpdate(undefined, {
    toolCallId: "t1",
    title: "Bash",
    status: "in_progress",
    rawInput: { command: "ls" },
    contentText: "",
  });
  assert.equal(first.trace, "exec ls");
  const second = projectKimiToolUpdate(first.state, {
    toolCallId: "t1",
    status: "completed",
    contentText: "a.txt",
  });
  assert.equal(second.trace, null);
  const third = projectKimiToolUpdate(second.state, { toolCallId: "t1", contentText: "a.txt" });
  assert.equal(third.trace, null);
  assert.equal(second.state.status, "completed");
  assert.equal(second.state.title, "Bash");
  const write = projectKimiToolUpdate(undefined, {
    toolCallId: "t2",
    title: "Write",
    status: "completed",
    rawInput: { path: "a.txt", content: "private payload" },
    contentText: "full file contents",
  });
  assert.equal(write.trace, "tool Write");
  const failure = projectKimiToolUpdate(undefined, {
    toolCallId: "t3",
    title: "Bash",
    status: "failed",
    rawInput: { command: "false" },
    contentText: "first error\nsecond error\nthird error",
  });
  assert.equal(failure.trace, "exec false\nfirst error\nsecond error");
});

test("kimi permission offers resolve to advertised allow ids and cancel otherwise", () => {
  const offer = readKimiPermissionOffer({
    sessionId: "session_a",
    options: [
      { optionId: "approve_once", kind: "allow_once", name: "Allow" },
      { optionId: "approve_always", kind: "allow_always", name: "Always" },
      { optionId: "reject", kind: "reject_once", name: "Reject" },
    ],
    toolCall: { toolCallId: "t1", title: "Write" },
  });
  assert.equal(offer.approveOptionId, "approve_once");
  assert.equal(offer.rejectOptionId, "reject");
  assert.equal(offer.toolCallId, "t1");
  assert.deepEqual(
    resolveKimiPermissionDecision(null, offer),
    { outcome: "selected", optionId: "approve_once" },
  );
  assert.deepEqual(
    resolveKimiPermissionDecision({ result: { outcome: { outcome: "selected", optionId: "reject" } } }, offer),
    { outcome: "selected", optionId: "reject" },
  );
  assert.deepEqual(
    resolveKimiPermissionDecision(null, offer, { allowTools: false }),
    { outcome: "cancelled" },
  );
  const empty = readKimiPermissionOffer({ sessionId: "session_a", options: [] });
  assert.deepEqual(resolveKimiPermissionDecision(null, empty), { outcome: "cancelled" });
});

test("kimi stop planning is cross-platform and never touches pid 0", () => {
  assert.deepEqual(planKimiProcessTreeStop("win32", 42), {
    kind: "taskkill",
    args: ["/PID", "42", "/T", "/F"],
  });
  assert.deepEqual(planKimiProcessTreeStop("darwin", 42, "initial"), { kind: "signal", signal: "SIGTERM" });
  assert.deepEqual(planKimiProcessTreeStop("linux", 42, "escalate"), { kind: "signal", signal: "SIGKILL" });
  assert.equal(planKimiProcessTreeStop("win32", 42, "escalate"), null);
  assert.equal(planKimiProcessTreeStop("darwin", 0), null);
});

test("kimi diagnostics redact secret env values and bound their size", () => {
  const env: NodeJS.ProcessEnv = { KIMI_MODEL_API_KEY: "sk-very-secret-value" };
  assert.equal(redactKimiDiagnostic("token=sk-very-secret-value done", env), "token=[redacted] done");
  assert.equal(redactKimiDiagnostic("plain", env), "plain");
  assert.equal(boundKimiDiagnostic("abc", 10), "abc");
  assert.match(boundKimiDiagnostic("abcdefghijk", 4), /^abcd\n…\[truncated\]$/);
});

test("Kimi recognizes only official compaction notifications", async () => {
  const { readKimiCompactionUpdate } = require("../../interactive/kimiAppServerProtocol") as typeof import("../../interactive/kimiAppServerProtocol");
  assert.equal(readKimiCompactionUpdate("Compacting conversation context…")?.status, "started");
  assert.equal(readKimiCompactionUpdate("Compacting conversation context with instruction: keep tests")?.status, "started");
  assert.equal(readKimiCompactionUpdate("Context compaction started — it runs in the background and the compacted context applies once it finishes.")?.status, "started");
  assert.equal(readKimiCompactionUpdate("Compaction completed.\n- Tokens after: 1,000")?.status, "completed");
  assert.equal(readKimiCompactionUpdate("Compaction cancelled.")?.status, "cancelled");
  assert.equal(readKimiCompactionUpdate("Compaction is blocked by the current turn; retry when the turn is idle.")?.status, "blocked");
  assert.equal(readKimiCompactionUpdate("A normal answer mentioning compaction."), null);
});

test("kimi compaction is an explicit unsupported capability", async () => {
  const error = new KimiCompactionUnsupportedError();
  assert.equal(error.code, "compaction-unsupported");
  assert.equal(error.compacted, false);
  assert.match(error.message, /no compaction method/);
});
