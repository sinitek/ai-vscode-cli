import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";

const {
  OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES,
  buildOpenCodeRunFailureMessage,
  createOpenCodeStreamActivityTracker,
  detectOpenCodeStreamActivity,
  extractOpenCodePrintLogErrorText,
  extractOpenCodeRuntimeMessageIds,
  extractOpenCodeRuntimeSessionId,
  parseOpenCodeExportStdout,
  parseOpenCodeRunOutput,
  parseOpenCodeSessionId,
  parseOpenCodeVisibleStreamEvents,
} = require("../../cli/openCodeRunOutput") as typeof import("../../cli/openCodeRunOutput");

const DEFAULT_MISSING_OUTPUT_MESSAGE = "OpenCode exited without returning an assistant answer or a provider error. Check the OpenCode provider/model config or run `opencode run --format json` to verify it.";

function readRepoFile(...parts: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

function assistantExportMessage(id: string, text: string, finish: "stop" | "tool-calls"): Record<string, unknown> {
  return {
    info: {
      role: "assistant",
      id,
      sessionID: "ses_export",
      finish,
    },
    parts: [
      {
        type: "text",
        text,
        messageID: id,
        time: { start: 1, end: 2 },
      },
      {
        type: "step-finish",
        reason: finish,
        messageID: id,
      },
    ],
  };
}

test("loads the pure OpenCode output parser without a vscode stub", () => {
  const parserSource = readRepoFile("src", "cli", "openCodeRunOutput.ts");
  const runnerSource = readRepoFile("src", "cli", "commandRunner.ts");
  const compiled = readRepoFile("dist", "cli", "openCodeRunOutput.js");
  const forbiddenSource = [
    /from\s+["']vscode["']/,
    /from\s+["'][^"']*commandRunner["']/,
    /from\s+["'][^"']*extension(?:\.ts)?["']/,
    /from\s+["']fs["']/,
    /from\s+["']node:fs["']/,
    /from\s+["']child_process["']/,
    /from\s+["']node:child_process["']/,
    /require\(\s*["']vscode["']\s*\)/,
  ];
  for (const pattern of forbiddenSource) {
    assert.equal(pattern.test(parserSource), false, pattern.source);
  }
  assert.match(parserSource, /from\s+["']\.\.\/thinkingMarkup["']/);
  assert.match(parserSource, /from\s+["']\.\.\/boundedText["']/);
  assert.match(parserSource, /from\s+["']\.\/openCodeTaskList["']/);
  assert.match(parserSource, /from\s+["']\.\/opencodewatchdog["']/);
  assert.match(parserSource, /export const OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES = 64 \* 1024;/);
  assert.equal(/OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS/.test(parserSource), false);
  assert.equal(/captureCliOutput|spawn\(/.test(parserSource), false);

  assert.equal(/require\(["']vscode["']\)/.test(compiled), false);
  assert.equal(/commandRunner|child_process|node:fs|require\(["']fs["']\)/.test(compiled), false);
  assert.match(compiled, /require\(["']\.\.\/thinkingMarkup["']\)/);
  assert.match(compiled, /require\(["']\.\.\/boundedText["']\)/);
  assert.match(compiled, /require\(["']\.\/openCodeTaskList["']\)/);
  assert.match(compiled, /require\(["']\.\/opencodewatchdog["']\)/);

  assert.match(runnerSource, /export const OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS = 15 \* 1000;/);
  assert.match(runnerSource, /export async function recoverOpenCodeMissingAssistantOutput/);
  assert.match(runnerSource, /timeoutMs: OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS/);
  assert.match(runnerSource, /from\s+["']\.\/openCodeRunOutput["']/);
  assert.match(runnerSource, /OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES,/);
  assert.equal(/OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES\s*=/.test(runnerSource), false);
  const flushSource = parserSource.slice(
    parserSource.indexOf("flush: () =>"),
    parserSource.indexOf("snapshot,"),
  );
  assert.ok(flushSource.includes("collectOpenCodeStdoutActivityLine"));
  assert.ok(flushSource.indexOf("collectOpenCodeStdoutActivityLine") < flushSource.indexOf("collectOpenCodeStderrActivityLine"));
  assert.equal(OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES, 64 * 1024);
  assert.equal(typeof parseOpenCodeRunOutput, "function");
  assert.equal(typeof parseOpenCodeExportStdout, "function");
});

test("parses visible events in assistant, tool, then reasoning order", () => {
  assert.deepEqual(parseOpenCodeVisibleStreamEvents("not json"), []);
  assert.deepEqual(parseOpenCodeVisibleStreamEvents("{broken"), []);
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "session_update" })), []);
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "step_start" })), []);
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "text",
    part: { type: "text", text: "..." },
  })), []);
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "text",
    part: { type: "text", text: "…" },
  })), []);

  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "text",
    text: "<thinking>plan</thinking>answer",
    part: {
      type: "tool",
      tool: "read",
      state: { status: "running", title: "src/cli/commandRunner.ts" },
    },
  })), [
    { kind: "thinking", content: "thinking\nplan" },
    { kind: "assistant", content: "answer" },
  ]);

  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "reasoning",
    text: "consider",
  })), [
    { kind: "thinking", content: "thinking\nconsider" },
  ]);

  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "tool_use",
    part: {
      type: "tool",
      tool: "todowrite",
      state: {
        status: "completed",
        title: "1 todo",
        input: { todos: [{ content: "拆分解析", status: "pending" }] },
      },
    },
  })), [{
    kind: "tool-use",
    content: "tool todowrite\nstatus: completed\n1 todo",
    taskListItems: [{ text: "拆分解析", done: false }],
  }]);
});

test("keeps the first session id and the original message id insertion order", () => {
  const output = [
    "noise",
    "{broken",
    "null",
    JSON.stringify({ sessionID: "", part: { session_id: "ses_part" } }),
    JSON.stringify({ sessionID: "ses_later" }),
    JSON.stringify({ messageID: "msg_json" }),
    "messageID=msg_log",
    "messageID=msg_log",
    "messageID=not-valid",
    JSON.stringify({ part: { messageId: "msg_part" } }),
    JSON.stringify({ messageID: "msg-bad" }),
  ].join("\n");

  assert.equal(parseOpenCodeSessionId(output), "ses_part");
  assert.equal(parseOpenCodeSessionId("null\n[]\n{broken"), null);
  assert.deepEqual(extractOpenCodeRuntimeMessageIds(output), ["msg_log", "msg_json", "msg_part"]);
  assert.equal(
    extractOpenCodeRuntimeSessionId("session.id=ses_aaa111\ncreated id=ses_bbb222"),
    "ses_bbb222",
  );
  assert.equal(
    extractOpenCodeRuntimeSessionId(JSON.stringify({ part: { sessionId: "ses_jsonfallback" } })),
    "ses_jsonfallback",
  );
});

test("accepts a structured final answer only for the same message stop", () => {
  const stopped = [
    JSON.stringify({
      type: "text",
      part: { type: "text", text: "Choose one.", messageID: "msg_final" },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", reason: "stop", messageID: "msg_final" },
    }),
  ].join("\n");
  assert.deepEqual(parseOpenCodeRunOutput(stopped, ""), {
    finalText: "Choose one.",
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: true,
  });

  const differentIds = [
    JSON.stringify({
      type: "text",
      part: { type: "text", text: "Still working.", messageID: "msg_progress" },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", reason: "stop", messageID: "msg_other" },
    }),
  ].join("\n");
  assert.equal(parseOpenCodeRunOutput(differentIds, "").hasStructuredFinalAnswer, false);

  const missingIds = [
    JSON.stringify({ type: "text", part: { type: "text", text: "Unscoped." } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
  ].join("\n");
  assert.equal(parseOpenCodeRunOutput(missingIds, "").hasStructuredFinalAnswer, false);

  const toolPhase = [
    JSON.stringify({
      type: "text",
      part: {
        type: "text",
        text: "I will inspect the files.",
        messageID: "msg_tool",
        time: { start: 1, end: 2 },
      },
    }),
    JSON.stringify({
      type: "tool_use",
      part: { type: "tool", tool: "bash", messageID: "msg_tool" },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", reason: "tool-calls", messageID: "msg_tool" },
    }),
  ].join("\n");
  assert.equal(parseOpenCodeRunOutput(toolPhase, "").hasStructuredFinalAnswer, false);

  const conflictingStop = [
    JSON.stringify({
      type: "text",
      part: {
        type: "text",
        text: "Timed reply.",
        messageID: "msg_done",
        time: { end: 4 },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", reason: "stop", messageID: "msg_other" },
    }),
  ].join("\n");
  assert.equal(parseOpenCodeRunOutput(conflictingStop, "").finalText, "Timed reply.");
  assert.equal(parseOpenCodeRunOutput(conflictingStop, "").hasStructuredFinalAnswer, false);

  const completedText = JSON.stringify({
    type: "text",
    part: {
      type: "text",
      text: "Hi.",
      messageID: "msg_hi",
      time: { end: "12" },
    },
  });
  assert.equal(parseOpenCodeRunOutput(completedText, "").hasStructuredFinalAnswer, true);

  const mixed = [
    "plain should not win",
    JSON.stringify({ type: "text", part: { type: "text", text: "json wins" } }),
  ].join("\n");
  assert.equal(parseOpenCodeRunOutput(mixed, "").finalText, "json wins");
  assert.equal(parseOpenCodeRunOutput("plain final answer\n", "").finalText, "plain final answer");
  assert.deepEqual(parseOpenCodeRunOutput("", ""), {
    finalText: null,
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});

test("orders provider errors ahead of cleaned stderr and print-log errors", () => {
  const stdout = JSON.stringify({
    type: "error",
    error: {
      name: "APIError",
      message: "top-message",
      ref: "err_ref",
      data: {
        message: "data-message",
        statusCode: 503,
        ref: "data-ref",
        metadata: { url: "https://example.test/v1" },
        responseBody: "raw-body-not-json",
      },
    },
  });
  const printLog = 'timestamp=2026-09-27T00:45:22.834Z level=ERROR run=abc message="stream error" error.error="upstream down"';
  const stderr = `\u001b[31m${printLog}\u001b[0m\ndata-message\nplain stderr`;
  const output = parseOpenCodeRunOutput(stdout, stderr);

  assert.equal(output.finalText, null);
  assert.equal(
    output.errorText,
    [
      "APIError",
      "top-message",
      "data-message",
      "data-ref",
      "err_ref",
      "503",
      "https://example.test/v1",
      "raw-body-not-json",
      "plain stderr",
      "upstream down",
    ].join("\n"),
  );
  assert.equal(extractOpenCodePrintLogErrorText(stderr), "upstream down");

  const jsonBody = JSON.stringify({
    type: "error",
    error: {
      name: "APIError",
      data: {
        responseBody: JSON.stringify({
          error: { message: "body-message", type: "body-type", code: "body-code" },
        }),
      },
    },
  });
  assert.match(parseOpenCodeRunOutput(jsonBody, "").errorText ?? "", /body-message/);
  assert.match(parseOpenCodeRunOutput(jsonBody, "").errorText ?? "", /body-code/);

  const answered = JSON.stringify({
    type: "text",
    part: { type: "text", text: "done", messageID: "msg_done", time: { end: 2 } },
  });
  assert.equal(parseOpenCodeRunOutput(answered, printLog).errorText, null);
});

test("prefers error text, then status text, then the existing failure literals", () => {
  const providerFailure = parseOpenCodeRunOutput(JSON.stringify({
    type: "error",
    error: { name: "APIError", data: { message: "访问被拒绝", statusCode: 403 } },
  }), "\n> build · claude-sonnet-5\n");
  assert.equal(
    buildOpenCodeRunFailureMessage(providerFailure, "CLI exit code: 1"),
    "APIError\n访问被拒绝\n403",
  );

  const statusOnly = parseOpenCodeRunOutput("", "\u001b[0m\n> build · claude-sonnet-5\n\u001b[0m");
  assert.equal(statusOnly.errorText, null);
  assert.equal(statusOnly.statusText, "> build · claude-sonnet-5");
  assert.equal(
    buildOpenCodeRunFailureMessage(statusOnly, "CLI exit code: 1"),
    "OpenCode exited successfully, but did not return an assistant answer. Last status: > build · claude-sonnet-5",
  );
  assert.equal(
    buildOpenCodeRunFailureMessage(statusOnly, "CLI exit code: 1", {
      missingFinalOutputWithStatusMessage: (statusText) => `status:${statusText}`,
    }),
    "status:> build · claude-sonnet-5",
  );

  const empty = parseOpenCodeRunOutput("", "");
  assert.equal(buildOpenCodeRunFailureMessage(empty, "CLI exit code: 1"), "CLI exit code: 1");
  assert.equal(
    buildOpenCodeRunFailureMessage(empty, "", { missingFinalOutputMessage: "custom missing" }),
    "custom missing",
  );
  assert.equal(buildOpenCodeRunFailureMessage(empty, ""), DEFAULT_MISSING_OUTPUT_MESSAGE);
});

test("tracks fragmented stdout and stderr without sharing snapshots or pending buffers", () => {
  const tracker = createOpenCodeStreamActivityTracker();
  const other = createOpenCodeStreamActivityTracker();
  assert.deepEqual(tracker.updateStdout("out-a\r"), {
    hasAssistantAnswer: true,
    hasError: false,
    hasStatus: false,
    hasProgress: false,
  });
  assert.deepEqual(tracker.updateStderr("err-a\r\nerr-b"), {
    hasAssistantAnswer: true,
    hasError: true,
    hasStatus: false,
    hasProgress: false,
  });
  assert.deepEqual(tracker.getPendingByteLengths(), {
    stdout: 0,
    stderr: Buffer.byteLength("err-b"),
  });
  assert.equal(other.snapshot().hasAssistantAnswer, false);
  assert.deepEqual(other.getPendingByteLengths(), { stdout: 0, stderr: 0 });

  const partialJson = '{"type":"error","error":{"message":"late"}}';
  const statusLine = "> build · model";
  const manual = createOpenCodeStreamActivityTracker();
  assert.equal(manual.updateStdout(partialJson).hasError, false);
  assert.equal(manual.updateStderr(statusLine).hasStatus, true);
  assert.equal(manual.updateStderr(statusLine).hasError, false);
  const flushed = manual.flush();
  assert.deepEqual(flushed, {
    hasAssistantAnswer: false,
    hasError: true,
    hasStatus: true,
    hasProgress: false,
  });
  assert.deepEqual(manual.getPendingByteLengths(), { stdout: 0, stderr: 0 });
  assert.deepEqual(detectOpenCodeStreamActivity(partialJson, statusLine), flushed);

  const isolated = manual.snapshot();
  isolated.hasError = false;
  isolated.hasAssistantAnswer = true;
  assert.equal(manual.snapshot().hasError, true);
  assert.equal(manual.snapshot().hasAssistantAnswer, false);
  assert.notEqual(isolated, manual.snapshot());
});

test("caps pending activity lines at 64 KiB and keeps long-line activity classes", () => {
  const tracker = createOpenCodeStreamActivityTracker();
  const emojiLine = "😀".repeat(20000);
  assert.ok(Buffer.byteLength(emojiLine) > OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES);
  assert.equal(tracker.updateStdout(emojiLine).hasProgress, true);
  assert.equal(tracker.updateStdout(emojiLine).hasAssistantAnswer, false);
  const stderrLine = `>${"你".repeat(30000)}`;
  assert.equal(tracker.updateStderr(stderrLine).hasError, true);
  assert.equal(tracker.snapshot().hasStatus, false);
  const pending = tracker.getPendingByteLengths();
  assert.ok(pending.stdout > 0 && pending.stdout <= OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES);
  assert.ok(pending.stderr > 0 && pending.stderr <= OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES);

  assert.equal(tracker.updateStdout("\n").hasAssistantAnswer, true);
  assert.equal(tracker.flush().hasError, true);
  assert.deepEqual(tracker.getPendingByteLengths(), { stdout: 0, stderr: 0 });

  const longPlain = "p".repeat(OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES + 1);
  assert.deepEqual(detectOpenCodeStreamActivity(`${longPlain}\n`, ""), {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: false,
    hasProgress: true,
  });

  const longJson = `${JSON.stringify({
    type: "text",
    part: { type: "text", text: "x".repeat(OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES) },
  })}\n`;
  assert.ok(Buffer.byteLength(longJson) > OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES);
  assert.deepEqual(detectOpenCodeStreamActivity(longJson, ""), {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: false,
    hasProgress: false,
  });

  const longStderr = `${"e".repeat(OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES + 1)}\n`;
  assert.deepEqual(detectOpenCodeStreamActivity("", longStderr), {
    hasAssistantAnswer: false,
    hasError: true,
    hasStatus: false,
    hasProgress: false,
  });
});

test("selects the current export assistant and rejects ambiguous transcripts", () => {
  assert.equal(parseOpenCodeExportStdout("not-json"), null);
  assert.equal(parseOpenCodeExportStdout("{"), null);
  assert.equal(parseOpenCodeExportStdout('prefix {"info":{}}'), null);
  assert.deepEqual(parseOpenCodeExportStdout('log {"messages":[null,{"info":{"role":"user"}}]}'), {
    finalText: null,
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });

  const ambiguous = JSON.stringify({
    messages: [
      assistantExportMessage("msg_old", "Old reply", "stop"),
      assistantExportMessage("msg_new", "New reply", "stop"),
    ],
  });
  const ambiguousOutput = parseOpenCodeExportStdout(`Exporting session\n${ambiguous}`, []);
  assert.equal(ambiguousOutput?.finalText, null);
  assert.equal(ambiguousOutput?.hasStructuredFinalAnswer, false);

  const single = parseOpenCodeExportStdout(JSON.stringify({
    messages: [assistantExportMessage("msg_only", "<thinking>hidden</thinking>visible", "stop")],
  }));
  assert.equal(single?.finalText, "visible");
  assert.equal(single?.hasStructuredFinalAnswer, true);

  const knownLastStop = parseOpenCodeExportStdout(JSON.stringify({
    messages: [
      assistantExportMessage("msg_a", "Answer A", "stop"),
      assistantExportMessage("msg_b", "Answer B", "stop"),
      assistantExportMessage("msg_c", "Tool text", "tool-calls"),
    ],
  }), ["msg_c", "msg_a", "msg_b"]);
  assert.equal(knownLastStop?.finalText, "Answer B");
  assert.equal(knownLastStop?.hasStructuredFinalAnswer, true);

  const laterStop = parseOpenCodeExportStdout(JSON.stringify({
    messages: [
      assistantExportMessage("msg_old", "Old reply", "stop"),
      assistantExportMessage("msg_tool", "Looking around", "tool-calls"),
      assistantExportMessage("msg_new", "Current reply", "stop"),
    ],
  }), ["msg_tool"]);
  assert.equal(laterStop?.finalText, "Current reply");

  const unknownIds = parseOpenCodeExportStdout(ambiguous, ["msg_missing"]);
  assert.equal(unknownIds?.finalText, null);
  const onlyKnownFallback = parseOpenCodeExportStdout(JSON.stringify({
    messages: [assistantExportMessage("msg_only", "Only reply", "stop")],
  }), ["msg_missing"]);
  assert.equal(onlyKnownFallback?.finalText, "Only reply");

  const syntheticStop = parseOpenCodeExportStdout(JSON.stringify({
    messages: [{
      info: { role: "assistant", id: "msg_syn", sessionID: "ses_export", finish: "stop" },
      parts: [{ type: "text", text: "synth", messageID: "msg_syn" }],
    }],
  }), ["msg_syn"]);
  assert.equal(syntheticStop?.finalText, "synth");
  assert.equal(syntheticStop?.hasStructuredFinalAnswer, true);
});
