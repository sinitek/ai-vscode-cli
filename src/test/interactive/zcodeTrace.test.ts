import assert = require("node:assert/strict");
import test = require("node:test");
import { resolveTraceKind, resolveTraceMerge } from "../../traceDisplay";
import type { ZcodeSessionEvent } from "../../interactive/zcodeAppServerProtocol";
import { ZcodeToolTraceProjector } from "../../interactive/zcodeTrace";

function makeEvent(type: string, payload: Record<string, unknown>): ZcodeSessionEvent {
  return { sessionId: "sess_trace", type, payload, seq: 1 };
}

test("ZCode assembles streamed tool input and updates the same trace call with its result", () => {
  const projector = new ZcodeToolTraceProjector();
  projector.beginTurn();

  assert.equal(projector.project(makeEvent("model.streaming", {
    kind: "tool_input_start",
    toolCallId: "call_write_1",
    toolName: "Write",
  })), null);
  assert.equal(projector.project(makeEvent("model.streaming", {
    kind: "tool_input_delta",
    toolCallId: "call_write_1",
    delta: '{"file_path":"/tmp/bubble-sort.js",',
  })), null);
  assert.equal(projector.project(makeEvent("model.streaming", {
    kind: "tool_input_delta",
    toolCallId: "call_write_1",
    delta: '"content":"function bubbleSort() {}"}',
  })), null);

  const input = projector.project(makeEvent("model.streaming", {
    kind: "tool_input_end",
    toolCallId: "call_write_1",
  }));
  assert.deepEqual(input, {
    toolCallId: "call_write_1",
    content: 'tool: Write\nInput:\n{\n  "file_path": "/tmp/bubble-sort.js",\n  "content": "function bubbleSort() {}"\n}',
  });
  assert.equal(resolveTraceKind(input.content, "normal"), "tool-use");
  assert.equal(resolveTraceMerge(input.content), false);

  assert.equal(projector.project(makeEvent("model.streaming", {
    kind: "tool_call",
    toolCallId: "call_write_1",
    toolName: "Write",
    input: { file_path: "/tmp/bubble-sort.js", content: "function bubbleSort() {}" },
  })), null);
  assert.equal(projector.project(makeEvent("tool.updated", {
    kind: "scheduled",
    toolCallId: "call_write_1",
    toolName: "Write",
  })), null);
  assert.equal(projector.project(makeEvent("tool.updated", {
    kind: "started",
    toolCallId: "call_write_1",
    toolName: "Write",
  })), null);

  const result = projector.project(makeEvent("tool.updated", {
    kind: "result",
    toolCallId: "call_write_1",
    result: { success: true, content: "Wrote file successfully." },
  }));
  assert.deepEqual(result, {
    toolCallId: "call_write_1",
    content: "tool result: Write\nOutput:\nWrote file successfully.",
  });
  assert.equal(resolveTraceKind(result.content, "normal"), "tool-use");
  assert.equal(resolveTraceMerge(result.content), false);
  assert.equal(projector.project(makeEvent("tool.updated", {
    kind: "result",
    toolCallId: "call_write_1",
    result: { success: true, content: "Wrote file successfully." },
  })), null);
});

test("ZCode maps shell and web tools to the existing Codex-compatible trace forms", () => {
  const projector = new ZcodeToolTraceProjector();
  projector.beginTurn();

  const command = projector.project(makeEvent("model.streaming", {
    kind: "tool_call",
    toolCallId: "call_bash_1",
    toolName: "Bash",
    input: { command: "node /tmp/bubble-sort.js", description: "Run sorting check" },
  }));
  assert.equal(command?.content, "exec node /tmp/bubble-sort.js");
  assert.equal(resolveTraceMerge(command!.content), false);

  const commandResult = projector.project(makeEvent("tool.updated", {
    kind: "result",
    toolCallId: "call_bash_1",
    result: { success: false, content: "Assertion failed" },
  }));
  assert.equal(commandResult?.content, "exec node /tmp/bubble-sort.js\nstatus: failed\nOutput:\nAssertion failed");

  const web = projector.project(makeEvent("model.streaming", {
    kind: "tool_call",
    toolCallId: "call_web_1",
    toolName: "WebFetch",
    input: { url: "https://weather.example", prompt: "Find today's forecast" },
  }));
  assert.equal(web?.content, 'tool: WebFetch\nInput:\n{\n  "url": "https://weather.example",\n  "prompt": "Find today\'s forecast"\n}');
  assert.equal(resolveTraceKind(web!.content, "normal"), "tool-use");

  const webResult = projector.project(makeEvent("tool.updated", {
    kind: "result",
    toolCallId: "call_web_1",
    result: { success: true, content: "Forecast retrieved." },
  }));
  assert.equal(webResult?.content, "tool result: WebFetch\nOutput:\nForecast retrieved.");
});
