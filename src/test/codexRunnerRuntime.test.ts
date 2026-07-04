import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildCodexAppServerArgs,
  buildCodexAppServerClientInfo,
  buildCodexAppServerConfig,
  buildCodexAppServerInitializeParams,
  buildCodexAppServerSandboxMode,
  buildCodexAppServerSandboxPolicy,
  buildCodexThreadOptions,
  buildCodexThreadParams,
  buildCodexTurnInput,
  buildCodexTurnStartParams,
  collectArgValues,
  handleCodexItemEvent,
  mapCodexReasoningEffort,
  pickArgValue,
  resolveCodexPackageVersionFromCommand,
  shouldEmitItemTraceCandidate,
} from "../interactive/codexRunnerRuntime";

test("argument helpers parse first values, repeated values, and flags", () => {
  const args = ["--model", "gpt-5", "--add-dir", " a ", "--add-dir", "b", "--image", "img.png"];

  assert.equal(pickArgValue(args, ["--model", "-m"]), "gpt-5");
  assert.equal(pickArgValue(args, ["--missing"]), null);
  assert.deepEqual(collectArgValues(args, ["--add-dir"]), [" a ", "b"]);
});

test("buildCodexThreadOptions preserves CLI behavior and plan overrides", () => {
  assert.deepEqual(
    buildCodexThreadOptions(
      [
        "--model",
        "ignored",
        "--ask-for-approval",
        "on-request",
        "--sandbox",
        "workspace-write",
        "--add-dir",
        " /tmp/extra ",
        "--enable",
        "web_search_request",
      ],
      "/repo",
      "high",
      "coding",
      "gpt-5",
      false
    ),
    {
      workingDirectory: "/repo",
      skipGitRepoCheck: true,
      modelReasoningEffort: "high",
      multiAgentEnabled: false,
      model: "gpt-5",
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
      additionalDirectories: ["/tmp/extra"],
      webSearchEnabled: true,
      webSearchMode: "live",
      networkAccessEnabled: true,
    }
  );

  assert.deepEqual(
    buildCodexThreadOptions(
      ["--dangerously-bypass-approvals-and-sandbox"],
      "/repo",
      "medium",
      "plan",
      null
    ),
    {
      workingDirectory: "/repo",
      skipGitRepoCheck: true,
      modelReasoningEffort: "medium",
      multiAgentEnabled: true,
      approvalPolicy: "untrusted",
      sandboxMode: "read-only",
    }
  );
});

test("app server builders produce stable config, args, input, and sandbox policies", () => {
  assert.equal(mapCodexReasoningEffort("on"), "low");
  assert.equal(mapCodexReasoningEffort("xhigh"), "xhigh");
  assert.deepEqual(
    buildCodexAppServerArgs(false, ["projects.'/repo'.trust_level=\"trusted\""]),
    [
      "app-server",
      "-c",
      "projects.'/repo'.trust_level=\"trusted\"",
      "--listen",
      "stdio://",
      "--disable",
      "multi_agent",
    ]
  );
  assert.deepEqual(
    buildCodexTurnInput("prompt", ["", " /tmp/a.png "]),
    [
      { type: "text", text: "prompt", text_elements: [] },
      { type: "localImage", path: "/tmp/a.png" },
    ]
  );
  assert.deepEqual(
    buildCodexAppServerConfig({ multiAgentEnabled: false, webSearchEnabled: true }),
    {
      agents: { job_max_runtime_seconds: 86400 },
      features: { multi_agent: false },
      web_search: "live",
    }
  );
  assert.equal(buildCodexAppServerSandboxMode("invalid"), "workspace-write");
  assert.deepEqual(
    buildCodexAppServerSandboxPolicy({
      sandboxMode: "workspace-write",
      workingDirectory: "/repo",
      additionalDirectories: ["/repo", "/extra", ""],
      networkAccessEnabled: true,
    }),
    {
      type: "workspaceWrite",
      writableRoots: ["/repo", "/extra"],
      readOnlyAccess: { type: "fullAccess" },
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    }
  );
  assert.deepEqual(
    buildCodexAppServerSandboxPolicy({ sandboxMode: "danger-full-access" }),
    { type: "dangerFullAccess" }
  );
});

test("request builders produce initialize, thread, and turn params", () => {
  const options = {
    workingDirectory: "/repo",
    model: "gpt-5",
    modelReasoningEffort: "high",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
    additionalDirectories: ["/extra"],
    webSearchEnabled: true,
  };

  assert.deepEqual(buildCodexAppServerInitializeParams("/missing/codex"), {
    clientInfo: {
      name: "codex",
      title: "Codex",
      version: "0.0.0",
    },
    capabilities: {
      experimentalApi: false,
      optOutNotificationMethods: [],
    },
  });
  assert.deepEqual(buildCodexThreadParams(options), {
    cwd: "/repo",
    sandbox: "workspace-write",
    config: {
      agents: { job_max_runtime_seconds: 86400 },
      web_search: "live",
    },
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    model: "gpt-5",
    approvalPolicy: "on-request",
  });
  assert.deepEqual(buildCodexTurnStartParams("thread-1", "prompt", [" /tmp/a.png "], options), {
    threadId: "thread-1",
    input: [
      { type: "text", text: "prompt", text_elements: [] },
      { type: "localImage", path: "/tmp/a.png" },
    ],
    cwd: "/repo",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["/repo", "/extra"],
      readOnlyAccess: { type: "fullAccess" },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    model: "gpt-5",
    effort: "high",
    approvalPolicy: "on-request",
  });
});

test("client info resolves package version near command path and falls back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-runtime-"));
  try {
    const packageDir = path.join(dir, "node_modules", "@openai", "codex", "bin");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "node_modules", "@openai", "codex", "package.json"),
      JSON.stringify({ name: "@openai/codex", version: "1.2.3" })
    );
    const commandPath = path.join(packageDir, "codex.js");
    fs.writeFileSync(commandPath, "#!/usr/bin/env node\n");

    assert.equal(resolveCodexPackageVersionFromCommand(commandPath), "1.2.3");
    assert.deepEqual(buildCodexAppServerClientInfo(commandPath), {
      name: "codex",
      title: "Codex",
      version: "1.2.3",
    });
    assert.deepEqual(buildCodexAppServerClientInfo(path.join(dir, "missing")), {
      name: "codex",
      title: "Codex",
      version: "0.0.0",
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("item event helper emits assistant deltas, traces, todos, and deduped command output", () => {
  const assistant: Array<{ chunk: string; final?: boolean }> = [];
  const traces: Array<{ content: string; kind?: string }> = [];
  const todos: { text: string; done: boolean }[][] = [];
  const assistantBuffers = new Map<string, string>([["msg-1", "hello"]]);
  const emittedTraceContents = new Map<string, string>();
  const handlers = {
    onAssistantDelta: (chunk: string, meta?: { codexFinalAnswer?: boolean }) => {
      assistant.push({ chunk, final: meta?.codexFinalAnswer });
    },
    onTrace: (content: string, kind?: string) => {
      traces.push({ content, kind });
    },
    onTaskListUpdate: (items: { text: string; done: boolean }[]) => {
      todos.push(items);
    },
  };
  const visibleErrors: string[] = [];

  handleCodexItemEvent({
    eventType: "item.completed",
    rawItem: { type: "agent_message", id: "msg-1", text: "hello world", phase: "final_answer" },
    assistantBuffers,
    emittedTraceContents,
    handlers,
    onVisibleError: (message) => visibleErrors.push(message),
    formatCollabToolFailure: (failure) => `failed ${failure.tool}`,
  });
  handleCodexItemEvent({
    eventType: "item.completed",
    rawItem: { type: "reasoning", text: [{ text: "Think" }] },
    assistantBuffers,
    emittedTraceContents,
    handlers,
    onVisibleError: (message) => visibleErrors.push(message),
    formatCollabToolFailure: (failure) => `failed ${failure.tool}`,
  });
  handleCodexItemEvent({
    eventType: "item.completed",
    rawItem: { type: "todo_list", items: [{ text: "Ship", status: "completed" }] },
    assistantBuffers,
    emittedTraceContents,
    handlers,
    onVisibleError: (message) => visibleErrors.push(message),
    formatCollabToolFailure: (failure) => `failed ${failure.tool}`,
  });
  const commandItem = {
    type: "command_execution",
    id: "cmd-1",
    command: "npm test",
    aggregated_output: "ok",
    exit_code: 0,
  };
  handleCodexItemEvent({
    eventType: "item.completed",
    rawItem: commandItem,
    assistantBuffers,
    emittedTraceContents,
    handlers,
    onVisibleError: (message) => visibleErrors.push(message),
    formatCollabToolFailure: (failure) => `failed ${failure.tool}`,
  });
  handleCodexItemEvent({
    eventType: "item.completed",
    rawItem: commandItem,
    assistantBuffers,
    emittedTraceContents,
    handlers,
    onVisibleError: (message) => visibleErrors.push(message),
    formatCollabToolFailure: (failure) => `failed ${failure.tool}`,
  });

  assert.deepEqual(assistant, [{ chunk: " world", final: true }]);
  assert.equal(assistantBuffers.has("msg-1"), false);
  assert.deepEqual(todos, [[{ text: "Ship", done: true }]]);
  assert.equal(traces.filter((trace) => trace.kind === "thinking")[0]?.content, "Think");
  assert.equal(traces.filter((trace) => trace.content.includes("npm test")).length, 1);
  assert.deepEqual(visibleErrors, []);
});

test("trace candidate helper rejects blanks and repeated item content", () => {
  const emitted = new Map<string, string>();

  assert.equal(shouldEmitItemTraceCandidate(emitted, "command_execution", "1", ""), false);
  assert.equal(shouldEmitItemTraceCandidate(emitted, "command_execution", "1", "ok"), true);
  assert.equal(shouldEmitItemTraceCandidate(emitted, "command_execution", "1", "ok"), false);
  assert.equal(shouldEmitItemTraceCandidate(emitted, "", "", "ok"), true);
});
