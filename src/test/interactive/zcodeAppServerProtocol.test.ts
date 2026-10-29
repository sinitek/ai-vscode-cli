import assert = require("node:assert/strict");
import test = require("node:test");
import {
  buildZcodeLaunchArgs,
  buildZcodeModelSelection,
  buildZcodeRuntimePreferences,
  buildZcodeSessionModelSettings,
  parseZcodeModelRef,
  parseZcodeWireLine,
  readZcodeContextUsage,
  readZcodeSessionEvent,
  readZcodeSessionId,
  readZcodeSettings,
  readZcodeSnapshot,
  readZcodeTextDelta,
  readZcodeTurnFailure,
  selectZcodeAllowOption,
  serializeZcodeWireMessage,
  ZCODE_GLM_OFFICIAL_API_TYPE,
  ZcodeProtocolError,
} from "../../interactive/zcodeAppServerProtocol";

const snapshot = {
  protocol: { name: "ZCode Protocol", version: 1 },
  session: { sessionId: "sess_abc" },
  projection: { contextUsed: 12, contextWindow: 200000 },
  settings: {
    mode: { current: "yolo" },
    model: {
      current: { providerId: "local-glm", modelId: "glm-5.3-flash_sub-coco" },
      available: [{ ref: { providerId: "local-glm", modelId: "glm-5.3-flash_sub-coco" } }],
    },
    thoughtLevel: {
      enabled: true,
      current: "max",
      available: [{ value: "low" }, { value: "high" }, { value: "max" }],
    },
  },
};

test("ZCode context usage excludes initialization zeros and invalid or missing counts", () => {
  for (const contextUsed of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(readZcodeContextUsage({ projection: { contextUsed, contextWindow: 200000 } }), null);
  }
  for (const contextWindow of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(readZcodeContextUsage({ projection: { contextUsed: 1234, contextWindow } }), null);
  }
  assert.equal(readZcodeContextUsage({}), null);
  assert.deepEqual(readZcodeContextUsage({ projection: { contextUsed: 17956, contextWindow: 200000 } }), {
    tokensInContextWindow: 17956,
    modelContextWindow: 200000,
  });
});

test("ZCode wire format is not JSON-RPC and not ACP", () => {
  assert.equal(ZCODE_GLM_OFFICIAL_API_TYPE, "openai-chat-completions");
  assert.deepEqual(buildZcodeLaunchArgs(), ["app-server", "--stdio", "--mode", "yolo"]);
  assert.throws(() => buildZcodeLaunchArgs(["--prompt"]), ZcodeProtocolError);
  assert.throws(() => parseZcodeWireLine('{"jsonrpc":"2.0","id":1,"method":"initialize"}'), /JSON-RPC/);
  const line = serializeZcodeWireMessage({ id: 1, method: "session/create", params: {} });
  assert.equal(line.includes("jsonrpc"), false);
  assert.equal(line.includes("acp"), false);
  assert.deepEqual(parseZcodeWireLine(line), { id: 1, method: "session/create", params: {} });
});

test("snapshot readers keep only advertised thought levels and context counts", () => {
  const parsed = readZcodeSnapshot(snapshot);
  assert.equal(readZcodeSessionId(parsed), "sess_abc");
  assert.deepEqual(readZcodeContextUsage(parsed), {
    tokensInContextWindow: 12,
    modelContextWindow: 200000,
  });
  const settings = readZcodeSettings(parsed);
  assert.deepEqual(settings.thinkingOptions, ["low", "high", "max"]);
  assert.equal(settings.model, "local-glm/glm-5.3-flash_sub-coco");
  assert.equal(settings.modeId, "yolo");
  const event = readZcodeSessionEvent({
    method: "session/event",
    params: { sessionId: "sess_abc", type: "part.delta", seq: 3, payload: { field: "text", delta: "hi" } },
  });
  assert.equal(event?.type, "part.delta");
  assert.deepEqual(readZcodeTextDelta({
    sessionId: "sess_abc",
    type: "model.streaming",
    payload: { kind: "text_delta", delta: "assistant text" },
    seq: 4,
  }), { field: "text", delta: "assistant text" });
  assert.deepEqual(readZcodeTextDelta({
    sessionId: "sess_abc",
    type: "model.streaming",
    payload: { kind: "reasoning_delta", delta: "reasoning text" },
    seq: 5,
  }), { field: "reasoning", delta: "reasoning text" });
  assert.equal(readZcodeTextDelta({
    sessionId: "sess_abc",
    type: "model.streaming",
    payload: { kind: "tool_input_delta", delta: "{}" },
    seq: 6,
  }), null);
  assert.deepEqual(readZcodeTextDelta(event!), { field: "text", delta: "hi" });
  assert.equal(selectZcodeAllowOption({
    options: [{ optionId: "deny", kind: "deny" }, { optionId: "allow-1", response: { decision: "allow" } }],
  })?.optionId, "allow-1");
  assert.equal(selectZcodeAllowOption({ options: [{ optionId: "deny", kind: "deny" }] }), null);
  assert.deepEqual(parseZcodeModelRef("local-glm/glm-5.3-flash_sub-coco$max"), {
    providerId: "local-glm",
    modelId: "glm-5.3-flash_sub-coco",
    reasoningLevel: "max",
  });
  assert.deepEqual(buildZcodeModelSelection(parseZcodeModelRef("local-glm/glm-5.3-flash_sub-coco")), {
    providerId: "local-glm",
    modelId: "glm-5.3-flash_sub-coco",
    options: { reasoningLevel: "max" },
  });
  assert.deepEqual(buildZcodeModelSelection(parseZcodeModelRef("local-glm/glm-5.3-flash_sub-coco$max")), {
    providerId: "local-glm",
    modelId: "glm-5.3-flash_sub-coco",
    options: { reasoningLevel: "max" },
  });
  assert.deepEqual(buildZcodeSessionModelSettings(parseZcodeModelRef("local-glm/glm-5.3-flash_sub-coco$max")), {
    model: {
      providerId: "local-glm",
      modelId: "glm-5.3-flash_sub-coco",
      options: { reasoningLevel: "max" },
    },
    thoughtLevel: "max",
  });
  assert.deepEqual(buildZcodeSessionModelSettings(
    parseZcodeModelRef("local-glm/glm-5.3-flash_sub-coco$max"),
    "high",
  ), {
    model: {
      providerId: "local-glm",
      modelId: "glm-5.3-flash_sub-coco",
      options: { reasoningLevel: "high" },
    },
    thoughtLevel: "high",
  });
  assert.equal(buildZcodeRuntimePreferences().toolSearchMode, "off");
});

test("simplified GLM model refs keep the required reasoning option without configuration rule overrides", () => {
  assert.deepEqual(buildZcodeModelSelection(parseZcodeModelRef("local-glm/glm-5.3-flash")), {
    providerId: "local-glm", modelId: "glm-5.3-flash", options: { reasoningLevel: "max" },
  });
  assert.deepEqual(buildZcodeSessionModelSettings(parseZcodeModelRef("local-glm/glm-5.3-flash$low")), {
    model: { providerId: "local-glm", modelId: "glm-5.3-flash", options: { reasoningLevel: "low" } },
    thoughtLevel: "low",
  });
});

test("native structured turn failures expose the actual diagnostic without exposing credentials", () => {
  const event = {
    sessionId: "sess_failed", type: "turn.failed", seq: 1,
    payload: { error: { type: "ModelError", message: "Model 'glm-5.3-flash' not configured" }, turnPhase: "model" },
  };
  assert.equal(readZcodeTurnFailure(event), "Model 'glm-5.3-flash' not configured");
  assert.equal(readZcodeTurnFailure({ ...event, payload: { message: "  request failed  " } }), "request failed");
  assert.equal(readZcodeTurnFailure({ ...event, payload: {} }), "ZCode turn failed.");
  assert.equal(readZcodeTurnFailure({ ...event, payload: { error: { message: "invalid sk-synthetic-fixture-token" } } }), "invalid <redacted>");
});
