import assert = require("node:assert/strict");
import test = require("node:test");
import type { GrokJsonRpcMessage } from "../../interactive/grokAppServerProtocol";
import { GrokToolCallStream, normalizeGrokToolOutput, type GrokToolTrace } from "../../interactive/grokToolCallStream";

function message(update: Record<string, unknown>, sessionId = "session-1"): GrokJsonRpcMessage {
  return { method: "session/update", params: { sessionId, update } };
}

function updateOf(event: GrokJsonRpcMessage): Record<string, unknown> {
  return (event.params as { update: Record<string, unknown> }).update;
}

function createStream() {
  const events: GrokJsonRpcMessage[] = [];
  const traces: GrokToolTrace[] = [];
  const stream = new GrokToolCallStream((event) => events.push(event), (trace) => traces.push(trace));
  return { stream, events, traces };
}

test("aggregates a tool lifecycle into start and terminal events and stable summary identity", () => {
  const { stream, events, traces } = createStream();
  const start = message({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "run_terminal_command", rawInput: { command: "printf '你好'" } });
  stream.append(start);
  stream.append(start);
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "call-1", kind: "execute", content: [{ type: "text", text: "running command" }] }));
  for (let index = 0; index < 100; index += 1) {
    stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "in_progress", rawOutput: { type: "Bash", output: [...Buffer.from(`part ${index}`)], output_for_prompt: `part ${index}` } }));
  }
  const end = message({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed", rawOutput: { type: "Bash", output: [...Buffer.from("你好\n")], output_for_prompt: "你好\n", exit_code: 0 } });
  stream.append(end);
  stream.append(end);
  assert.equal(events.length, 2);
  assert.equal(traces.length, 2);
  assert.deepEqual(traces.map((trace) => trace.toolCallId), ["call-1", "call-1"]);
  assert.match(traces[0].content, /^tool: run_terminal_command\nstatus: in_progress\ncommand:/);
  assert.match(traces[1].content, /status: completed/);
  assert.equal(traces[1].content.includes("output_for_prompt"), false);
  assert.deepEqual(updateOf(events[1]).rawOutput, { type: "Bash", output: "你好\n", exit_code: 0 });
  assert.deepEqual(updateOf(start).rawInput, { command: "printf '你好'" });
});

test("isolates identical commands by call and session identities despite interleaving", () => {
  const { stream, events } = createStream();
  for (const [sessionId, toolCallId] of [["one", "same"], ["one", "second"], ["two", "same"]]) {
    stream.append(message({ sessionUpdate: "tool_call", toolCallId, title: "bash", rawInput: { command: "pwd" } }, sessionId));
  }
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "same", status: "completed", rawOutput: "two" }, "two"));
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "second", status: "completed", rawOutput: "second" }, "one"));
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "same", status: "completed", rawOutput: "one" }, "one"));
  assert.equal(events.length, 6);
  assert.deepEqual(events.slice(3).map((event) => updateOf(event).rawOutput), ["two", "second", "one"]);
});

test("flushes the latest unfinished snapshot exactly once on cancellation and rejects late updates", () => {
  const { stream, events, traces } = createStream();
  stream.append(message({ sessionUpdate: "tool_call", toolCallId: "one", title: "bash" }));
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", rawOutput: { type: "Bash", output: [...Buffer.from("partial")], exit_code: 0 } }));
  stream.finish("cancelled");
  stream.finish("failed");
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", status: "completed", rawOutput: "late" }));
  assert.equal(events.length, 2);
  assert.equal(updateOf(events[1]).status, "cancelled");
  assert.equal((updateOf(events[1]).rawOutput as { output: string }).output, "partial");
  assert.match(traces[1].content, /status: cancelled/);
});

test("surfaces nonzero commands and timeouts but treats grep no-match as success", () => {
  for (const [type, exitCode, expected] of [["Bash", 2, "failed"], ["Bash", -1, "failed"], ["GrepSearch", 1, "completed"], ["GrepSearch", 2, "failed"]] as const) {
    const { stream, events, traces } = createStream();
    stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", status: "completed", rawOutput: { type, exit_code: exitCode, output: [...Buffer.from("failure detail")] } }));
    assert.equal(updateOf(events[0]).status, expected);
    if (expected === "failed" && type === "Bash") {
      assert.match(traces[0].content, /failure detail/);
    }
  }
  const { stream, events } = createStream();
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", status: "completed", rawOutput: { type: "Bash", timed_out: true } }));
  assert.equal(updateOf(events[0]).status, "failed");
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "two", status: "cancelled", rawOutput: { type: "Bash", exit_code: -1 } }));
  assert.equal(updateOf(events[1]).status, "cancelled");
});

test("keeps both ends of long failures in summaries without truncating replay output", () => {
  const { stream, events, traces } = createStream();
  const output = `initial error\n${"diagnostic detail\n".repeat(250)}final error`;
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", status: "completed", rawOutput: { type: "Bash", output, exit_code: 2 } }));
  assert.match(traces[0].content, /initial error/);
  assert.match(traces[0].content, /final error$/);
  assert.ok(traces[0].content.length < 2200);
  assert.equal((updateOf(events[0]).rawOutput as { output: string }).output, output);
});

test("normalizes known UTF-8 fields without losing binary, distinct, or unknown representations", () => {
  const text = "中文🙂\n";
  const original = { type: "Bash", output: [...Buffer.from(text)], output_for_prompt: text, truncated: false };
  assert.deepEqual(normalizeGrokToolOutput(original), { type: "Bash", output: text, truncated: false });
  assert.ok(Array.isArray(original.output));
  for (const output of [[255], [256], [-1], [0.5], ["65"]]) {
    const payload = { type: "Bash", output, output_for_prompt: "retained" };
    assert.deepEqual(normalizeGrokToolOutput(payload), payload);
  }
  const unknown = { type: "FutureTool", output: [65, 66], output_for_prompt: "AB" };
  assert.equal(normalizeGrokToolOutput(unknown), unknown);
  assert.deepEqual(normalizeGrokToolOutput({ type: "Bash", output: [65, 66], output_for_prompt: "truncated differently", truncated: true }), { type: "Bash", output: "AB", output_for_prompt: "truncated differently", truncated: true });
  assert.deepEqual(normalizeGrokToolOutput({ type: "GrepSearch", stdout: [65], stderr: [], exit_code: 0 }), { type: "GrepSearch", stdout: "A", stderr: "", exit_code: 0 });
});

test("removes only equivalent file and edit aliases, retaining actual differences", () => {
  assert.deepEqual(normalizeGrokToolOutput({ type: "ReadFile", FileContent: { content: "body", content_concise: "body", raw_output: "different", absolute_path: "C:\\src\\a.ts" } }), { type: "ReadFile", FileContent: { content: "body", raw_output: "different", absolute_path: "C:\\src\\a.ts" } });
  assert.deepEqual(normalizeGrokToolOutput({ type: "SearchReplace", EditsApplied: { tool_output_for_prompt: "ok", tool_output_for_prompt_concise: "ok", old_string: "old", new_string: "new" } }), { type: "SearchReplace", EditsApplied: { tool_output_for_prompt: "ok", old_string: "old", new_string: "new" } });
  assert.deepEqual(normalizeGrokToolOutput({ type: "ReadFile", FileContent: { content: "1→first\n2→  second", raw_output: "first\n  second", content_concise: "1→first\n2→  second", offset: 1, total_lines: 2 } }), { type: "ReadFile", FileContent: { content: "first\n  second", offset: 1, total_lines: 2 } });
});

test("routes todo changes into plans instead of raw tool traces", () => {
  const { stream, events, traces } = createStream();
  const todos = [{ content: "验证", status: "in_progress" }];
  stream.append(message({ sessionUpdate: "tool_call", toolCallId: "todo-1", title: "todo_write", rawInput: { todos } }));
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "todo-1", status: "completed", rawOutput: { type: "Todo", TodosUpdated: { todos: [{ ...todos[0], status: "completed" }] } } }));
  stream.finish("interrupted");
  assert.equal(traces.length, 0);
  assert.deepEqual(events.map((event) => updateOf(event)), [
    { sessionUpdate: "plan", entries: [{ content: "验证", status: "completed" }] },
  ]);
});

test("does not merge calls without identity or change multimodal output", () => {
  const { stream, events } = createStream();
  const input = message({ sessionUpdate: "tool_call_update", status: "completed", content: [{ type: "image", data: "test" }], rawOutput: { type: "FutureTool", numbers: [65] } });
  stream.append(input);
  stream.append(input);
  assert.deepEqual(events, [input, input]);
  assert.equal(stream.append({ method: "other" }), false);
});

test("retains partial known output when a terminal patch only adds exit metadata", () => {
  const { stream, events } = createStream();
  stream.append(message({ sessionUpdate: "tool_call", toolCallId: "one", title: "bash", rawInput: { command: "pwd" } }));
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", rawOutput: { type: "Bash", output: [...Buffer.from("partial")] } }));
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", status: "completed", rawOutput: { exit_code: 0 } }));
  assert.deepEqual(updateOf(events[1]).rawOutput, { type: "Bash", output: "partial", exit_code: 0 });
  assert.equal("rawInput" in updateOf(events[1]), false);
});

test("never suppresses failed todo tools as harmless task-list updates", () => {
  const { stream, traces, events } = createStream();
  stream.append(message({ sessionUpdate: "tool_call", toolCallId: "one", title: "todo_write", rawInput: { todos: [{ content: "Test", status: "pending" }] } }));
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", status: "failed", rawOutput: { error: "cannot update plan" } }));
  assert.equal(events.length, 1);
  assert.equal(traces.length, 1);
  assert.equal(updateOf(events[0]).status, "failed");
  assert.match(traces[0].content, /cannot update plan/);
});

test("removes equivalent text content but preserves supplementary text and multimodal blocks", () => {
  const { stream, events } = createStream();
  for (const [toolCallId, content] of [["one", [{ type: "content", content: { type: "text", text: "body" } }]], ["two", [{ type: "text", text: "supplementary warning" }]], ["three", [{ type: "image", data: "test" }]]] as const) {
    stream.append(message({ sessionUpdate: "tool_call_update", toolCallId, status: "completed", content, rawOutput: { type: "Bash", output: [...Buffer.from("body")] } }));
  }
  assert.equal("content" in updateOf(events[0]), false);
  assert.deepEqual(updateOf(events[1]).content, [{ type: "text", text: "supplementary warning" }]);
  assert.deepEqual(updateOf(events[2]).content, [{ type: "image", data: "test" }]);
});

test("merges successful id-only patches without replacing the rest of the plan", () => {
  const { stream, events } = createStream();
  const todos = [{ id: "a", content: "调查", status: "pending" }, { id: "b", content: "验证", status: "pending" }];
  stream.append(message({ sessionUpdate: "tool_call", toolCallId: "create", kind: "think", title: "Updating plan", _meta: { "x.ai/tool": { name: "todo_write" } }, rawInput: { merge: false, todos } }));
  assert.equal(events.length, 0);
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "create", status: "completed", rawOutput: { type: "Todo", TodosUpdated: { todos: todos.map(({ content, status }) => ({ content, status })) } } }));
  stream.append(message({ sessionUpdate: "tool_call", toolCallId: "patch", kind: "think", rawInput: { variant: "TodoWrite", todos: [{ id: "a", status: "completed" }] } }));
  assert.equal(events.length, 1);
  const completed = message({ sessionUpdate: "tool_call_update", toolCallId: "patch", status: "completed" });
  stream.append(completed);
  stream.append(completed);
  assert.equal(events.length, 2);
  assert.deepEqual(updateOf(events[1]).entries, [{ content: "调查", status: "completed" }, { content: "验证", status: "pending" }]);
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "clear", title: "todo_write", status: "completed", rawInput: { merge: false, todos: [] } }));
  assert.deepEqual(updateOf(events[2]).entries, []);
  stream.append(completed);
  assert.equal(events.length, 3);
});

test("prefers complete successful todo output and isolates plans by session", () => {
  const { stream, events } = createStream();
  const complete = [{ content: "调查", status: "completed" }, { content: "验证", status: "in_progress" }];
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "patch", kind: "think", status: "completed", _meta: { "x.ai/tool": { name: "todo_write" } }, rawInput: { todos: [{ id: "a", status: "completed" }] }, rawOutput: { type: "Todo", TodosUpdated: { todos: complete } } }));
  assert.deepEqual(updateOf(events[0]).entries, complete);
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "foreign", title: "todo_write", status: "completed", rawInput: { todos: [{ id: "a", status: "completed" }] } }, "other-session"));
  assert.equal(events.length, 1);
});

test("failed, cancelled, interrupted and malformed todo updates never become plans", () => {
  for (const status of ["failed", "cancelled", "canceled", "interrupted"]) {
    const { stream, events, traces } = createStream();
    stream.append(message({ sessionUpdate: "tool_call", toolCallId: "one", title: "todo_write", rawInput: { todos: [{ id: "a", content: "未执行", status: "pending" }] } }));
    stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "one", status, rawOutput: { error: "update rejected" } }));
    assert.equal(events.length, 1);
    assert.equal(updateOf(events[0]).sessionUpdate, "tool_call_update");
    assert.equal(traces.length, 1);
  }
  const { stream, events } = createStream();
  stream.append(message({ sessionUpdate: "tool_call_update", toolCallId: "bad", title: "todo_write", status: "completed", rawInput: { merge: false, todos: [{ content: "意图", status: "pending" }] }, rawOutput: { type: "Todo", TodosUpdated: { todos: [{ status: "completed" }] } } }));
  stream.append(message({ sessionUpdate: "tool_call", toolCallId: "unfinished", title: "todo_write", rawInput: { merge: false, todos: [{ content: "未执行", status: "pending" }] } }));
  stream.finish("cancelled");
  assert.equal(events.length, 0);
});
