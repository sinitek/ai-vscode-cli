import assert = require("node:assert/strict");
import test = require("node:test");
import {
  acceptDshIncrementalText,
  assertAdvertisedDshModel,
  assertAdvertisedDshReasoning,
  buildDshChildEnv,
  buildDshInitializeParams,
  buildDshLaunchArgs,
  buildDshMethodNotFoundError,
  buildDshPermissionResult,
  buildDshSessionNewParams,
  buildDshSessionPromptParams,
  buildDshSessionResumeParams,
  buildDshSetConfigOptionParams,
  DshCompactionUnsupportedError,
  DshProtocolError,
  DSH_ACP_PROTOCOL_VERSION,
  findDshForbiddenWire,
  parseDshModelWireValue,
  planDshProcessTreeStop,
  projectDshToolUpdate,
  readDshConfigOptions,
  readDshTokenUsageUpdate,
  redactDshDiagnostic,
  isDshCompletedStopReason,
  resolveDshHostResumeId,
  resolveDshPermissionDecision,
} from "../../interactive/dshAppServerProtocol";

const FLASH = JSON.stringify(["deepseek-official", "deepseek-v4-flash"]);
const PRO = JSON.stringify(["deepseek-official", "deepseek-v4-pro"]);

test("DSH launch args stay on the ACP profile and only accept explicit patch args", () => {
  assert.deepEqual(buildDshLaunchArgs(), ["--profile", "acp"]);
  assert.deepEqual(buildDshLaunchArgs(["--patch", "/tmp/dsh-extra.yml", "--patch=/tmp/other.yml"]), [
    "--profile",
    "acp",
    "--patch",
    "/tmp/dsh-extra.yml",
    "--patch",
    "/tmp/other.yml",
  ]);
  for (const rejected of ["headless", "sdk", "tui", "desktop", "--profile", "--profile=headless", "--dump-config"]) {
    assert.throws(() => buildDshLaunchArgs([rejected]), (error: unknown) => {
      assert.equal((error as DshProtocolError).code, "agent-args");
      return true;
    });
  }
});

test("DSH child env keeps an explicit map and strips foreign credentials from the fallback", () => {
  const explicit = buildDshChildEnv({ DEEPSEEK_API_KEY: "dsh-fixture-secret", XAI_API_KEY: "kept-by-caller" }, {});
  assert.equal(explicit.XAI_API_KEY, "kept-by-caller");
  const fallback = buildDshChildEnv(undefined, {
    PATH: "/usr/bin",
    DEEPSEEK_API_KEY: "dsh-fixture-secret",
    XAI_API_KEY: "grok-fixture-secret",
    OPENAI_API_KEY: "openai-fixture-secret",
    ANTHROPIC_API_KEY: "anthropic-fixture-secret",
  });
  assert.equal(fallback.PATH, "/usr/bin");
  assert.equal(fallback.DEEPSEEK_API_KEY, "dsh-fixture-secret");
  assert.equal(fallback.XAI_API_KEY, undefined);
  assert.equal(fallback.OPENAI_API_KEY, undefined);
  assert.equal(fallback.ANTHROPIC_API_KEY, undefined);
});

test("DSH initialize goes directly to a versioned handshake without Grok metadata", () => {
  const params = buildDshInitializeParams();
  assert.equal(params.protocolVersion, DSH_ACP_PROTOCOL_VERSION);
  assert.equal(findDshForbiddenWire({ method: "initialize", params }), null);
  assert.equal("session/load" in buildDshSessionNewParams("/tmp/work"), false);
  assert.deepEqual(buildDshSessionResumeParams("sess-1", "/tmp/work"), {
    sessionId: "sess-1",
    cwd: "/tmp/work",
    mcpServers: [],
  });
  assert.equal(findDshForbiddenWire({ method: "session/load", params: { _meta: { yoloMode: true } } }), "$.method=session/load");
});

test("DSH model wire values must be canonical and advertised", () => {
  assert.deepEqual(parseDshModelWireValue(FLASH), { provider: "deepseek-official", model: "deepseek-v4-flash" });
  assert.equal(parseDshModelWireValue("deepseek-v4-flash"), null);
  assert.equal(parseDshModelWireValue("[\"deepseek-official\", \"deepseek-v4-flash\"]"), null);
  assert.deepEqual(assertAdvertisedDshModel(FLASH, [FLASH]), { provider: "deepseek-official", model: "deepseek-v4-flash" });
  assert.throws(() => assertAdvertisedDshModel("deepseek-v4-flash", [FLASH]), (error: unknown) => {
    assert.equal((error as DshProtocolError).code, "model-wire-invalid");
    return true;
  });
  assert.throws(() => assertAdvertisedDshModel(PRO, [FLASH]), (error: unknown) => {
    assert.equal((error as DshProtocolError).code, "model-not-advertised");
    return true;
  });
});

test("DSH reasoning accepts only advertised scalar options and preserves xhigh", () => {
  assert.equal(assertAdvertisedDshReasoning("low", ["low", "high", "xhigh", "max"]), "low");
  assert.equal(assertAdvertisedDshReasoning("xhigh", ["low", "high", "xhigh", "max"]), "xhigh");
  assert.equal(assertAdvertisedDshReasoning("custom", ["custom"]), "custom");
  assert.throws(() => assertAdvertisedDshReasoning("off", ["low", "high", "xhigh", "max"]), (error: unknown) => {
    const protocolError = error as DshProtocolError;
    assert.equal(protocolError.code, "reasoning-not-advertised");
    assert.equal(protocolError.message.includes("xhigh"), true);
    return true;
  });
  assert.deepEqual(buildDshSetConfigOptionParams("sess-1", "reasoning_effort", "low"), {
    sessionId: "sess-1",
    configId: "reasoning_effort",
    value: "low",
  });
  assert.equal(typeof buildDshSetConfigOptionParams("sess-1", "model", FLASH).value, "string");
});

test("DSH config option reader keeps grouped model values and scalar reasoning values", () => {
  const options = readDshConfigOptions({
    configOptions: [
      {
        id: "model",
        currentValue: FLASH,
        options: [{ group: "deepseek-official", options: [{ value: FLASH, name: "deepseek-v4-flash" }] }],
      },
      {
        id: "reasoning_effort",
        currentValue: "high",
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
          { value: "xhigh", name: "XHigh" },
          { value: "max", name: "Max" },
        ],
      },
    ],
  });
  assert.deepEqual(options.find((option) => option.id === "model")?.values, [FLASH]);
  assert.deepEqual(options.find((option) => option.id === "reasoning_effort")?.values, ["low", "high", "xhigh", "max"]);
});

test("DSH usage ignores missing values and accepts a real zero", () => {
  assert.equal(readDshTokenUsageUpdate(undefined, 1000), null);
  assert.equal(readDshTokenUsageUpdate(12, undefined), null);
  assert.equal(readDshTokenUsageUpdate("12", 1000), null);
  assert.equal(readDshTokenUsageUpdate(Number.NaN, 1000), null);
  assert.equal(readDshTokenUsageUpdate(-1, 1000), null);
  assert.deepEqual(readDshTokenUsageUpdate(0, 1000), {
    tokensInContextWindow: 0,
    modelContextWindow: 1000,
  });
  assert.deepEqual(readDshTokenUsageUpdate(12, 1000), {
    tokensInContextWindow: 12,
    modelContextWindow: 1000,
  });
});

test("DSH text and tool updates do not replay a full snapshot", () => {
  const tracker = new Map<string, string>();
  assert.equal(acceptDshIncrementalText(tracker, "m1", "hel"), "hel");
  assert.equal(acceptDshIncrementalText(tracker, "m1", "hello"), "lo");
  assert.equal(acceptDshIncrementalText(tracker, "m1", "hello"), null);
  assert.equal(acceptDshIncrementalText(tracker, "m1", "lo"), "lo");

  const first = projectDshToolUpdate(undefined, {
    toolCallId: "tool-1",
    title: "bash",
    status: "in_progress",
    contentText: "",
  });
  assert.equal(first.trace, "bash in_progress");
  const completed = projectDshToolUpdate(first.state, {
    toolCallId: "tool-1",
    status: "completed",
    contentText: "ok",
  });
  assert.equal(completed.trace, "bash completed\nok");
  const duplicate = projectDshToolUpdate(completed.state, {
    toolCallId: "tool-1",
    status: "completed",
    contentText: "ok",
  });
  assert.equal(duplicate.trace, null);
});

test("DSH permission decisions fail closed unless the host selects an offered option", () => {
  assert.deepEqual(resolveDshPermissionDecision(undefined, ["allow-once", "reject-once"]), { outcome: "cancelled" });
  assert.deepEqual(resolveDshPermissionDecision({ error: { message: "cancelled" } }, ["allow-once"]), { outcome: "cancelled" });
  assert.deepEqual(
    resolveDshPermissionDecision({ result: { outcome: { outcome: "selected", optionId: "allow-always" } } }, ["allow-once", "reject-once"]),
    { outcome: "cancelled" },
  );
  assert.deepEqual(
    resolveDshPermissionDecision({ result: { outcome: { outcome: "selected", optionId: "reject-once" } } }, ["allow-once", "reject-once"]),
    { outcome: "selected", optionId: "reject-once" },
  );
  assert.deepEqual(buildDshPermissionResult({ outcome: "cancelled" }), { outcome: { outcome: "cancelled" } });
});

test("DSH resume ids ignore plugin local ids and completion does not treat an empty reason as success", () => {
  assert.equal(resolveDshHostResumeId("local_1792000000000_abc", null), null);
  assert.equal(resolveDshHostResumeId("local_1792000000000_abc", "9a871318-21c4-4603-8e65-693ba8589abe"), "9a871318-21c4-4603-8e65-693ba8589abe");
  assert.equal(resolveDshHostResumeId("9a871318-21c4-4603-8e65-693ba8589abe", null), "9a871318-21c4-4603-8e65-693ba8589abe");
  assert.equal(isDshCompletedStopReason("end_turn"), true);
  assert.equal(isDshCompletedStopReason("cancelled"), false);
  assert.equal(isDshCompletedStopReason(""), false);
  assert.equal(isDshCompletedStopReason(null), false);
});

test("DSH unknown methods use the ACP method-not-found shape", () => {
  assert.deepEqual(buildDshMethodNotFoundError("terminal/create"), {
    code: -32601,
    message: "\"Method not found\": terminal/create",
    data: { method: "terminal/create" },
  });
});

test("DSH process stop plan covers Windows taskkill and POSIX signals", () => {
  assert.deepEqual(planDshProcessTreeStop("win32", 4242, "initial"), {
    kind: "taskkill",
    args: ["/PID", "4242", "/T", "/F"],
  });
  assert.equal(planDshProcessTreeStop("win32", 4242, "escalate"), null);
  assert.deepEqual(planDshProcessTreeStop("darwin", 4242, "initial"), { kind: "signal", signal: "SIGTERM" });
  assert.deepEqual(planDshProcessTreeStop("linux", 4242, "escalate"), { kind: "signal", signal: "SIGKILL" });
  assert.equal(planDshProcessTreeStop("darwin", undefined, "initial"), null);
});

test("DSH diagnostics redact credential values and stay bounded", () => {
  const redacted = redactDshDiagnostic(
    "missing DEEPSEEK_API_KEY=dsh-fixture-secret-9f3a bearer Bearer abcdefghijklmnop",
    { DEEPSEEK_API_KEY: "dsh-fixture-secret-9f3a" },
  );
  assert.equal(redacted.includes("dsh-fixture-secret-9f3a"), false);
  assert.equal(redacted.includes("abcdefghijklmnop"), false);
  assert.match(redacted, /DEEPSEEK_API_KEY=\[redacted\]/);
});

test("DSH compaction helper cannot report success", () => {
  const error = new DshCompactionUnsupportedError();
  assert.equal(error.code, "compaction-unsupported");
  assert.equal(error.compacted, false);
  assert.equal(buildDshSessionPromptParams("sess-1", "hello").prompt instanceof Array, true);
});
