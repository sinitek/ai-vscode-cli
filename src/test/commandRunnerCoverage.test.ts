import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const crossSpawn = require("cross-spawn") as {
  spawn: (...args: unknown[]) => unknown;
};
const {
  buildCliArgs,
  buildOpenCodeRunFailureMessage,
  buildProcessLabel,
  captureCliOutput,
  detectOpenCodeStreamActivity,
  isCliCommandAvailable,
  parseOpenCodeRunOutput,
  parseOpenCodeSessionId,
  parseOpenCodeVisibleStreamEvents,
  resolveCliCommand,
  runCli,
  runCliStream,
  startOpenCodeServer,
} = require("../cli/commandRunner") as typeof import("../cli/commandRunner");

type FakeStream = EventEmitter & {
  encodings: string[];
  setEncoding: (encoding: string) => void;
};

type FakeChild = EventEmitter & {
  stdout: FakeStream;
  stderr: FakeStream;
  stdin: { end: () => void };
  pid?: number;
  stdinEndCalls: number;
  kill: (signal?: NodeJS.Signals | number) => boolean;
};

type VscodeConfiguration = {
  get: <T>(key: string, fallback?: T) => T | undefined;
};

function createFakeStream(): FakeStream {
  const stream = new EventEmitter() as FakeStream;
  stream.encodings = [];
  stream.setEncoding = (encoding) => {
    stream.encodings.push(encoding);
  };
  return stream;
}

function createFakeChild(pid?: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = createFakeStream();
  child.stderr = createFakeStream();
  child.stdinEndCalls = 0;
  child.stdin = {
    end: () => {
      child.stdinEndCalls += 1;
    },
  };
  child.pid = pid;
  child.kill = () => true;
  return child;
}

function installConfiguration(values: Record<string, unknown>): () => void {
  const vscode = require("vscode") as {
    workspace: { getConfiguration: () => VscodeConfiguration };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] as T : fallback
    ),
  });
  return () => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  };
}

function setPlatform(value: NodeJS.Platform): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (!descriptor?.configurable) {
    throw new Error("process.platform must be configurable for command resolution tests");
  }
  Object.defineProperty(process, "platform", { ...descriptor, value });
  return () => {
    Object.defineProperty(process, "platform", descriptor);
  };
}

test("runs a resolved stream command with mocked process output and termination", () => {
  const restoreConfiguration = installConfiguration({
    "commands.codex": process.execPath,
    "args.codex": ["--configured"],
  });
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  const spawnCalls: unknown[][] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const errors: Error[] = [];
  const exits: Array<number | null> = [];
  crossSpawn.spawn = (...args: unknown[]): unknown => {
    spawnCalls.push(args);
    return child;
  };

  try {
    const processHandle = runCliStream("codex", "inspect", {
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
      onError: (error) => errors.push(error),
      onExit: (code) => exits.push(code),
    }, {
      cwd: "/isolated/workspace",
      envOverrides: { SINITEK_RUNNER_TEST: "enabled" },
      processLabel: "sinitek-unit-stream",
    });

    assert.equal(processHandle.resolvedCommand, process.execPath);
    assert.equal(processHandle.kill(), false);
    assert.equal(child.stdinEndCalls, 1);
    assert.deepEqual(child.stdout.encodings, ["utf8"]);
    assert.deepEqual(child.stderr.encodings, ["utf8"]);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.[0], process.execPath);
    assert.deepEqual(spawnCalls[0]?.[1], ["--configured", "--skip-git-repo-check", "inspect"]);
    assert.deepEqual(spawnCalls[0]?.[2], {
      cwd: "/isolated/workspace",
      env: {
        ...process.env,
        SINITEK_RUNNER_TEST: "enabled",
        PWD: "/isolated/workspace",
      },
      argv0: "sinitek-unit-stream",
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const expectedError = new Error("mock stream failure");
    child.stdout.emit("data", "assistant chunk");
    child.stderr.emit("data", "provider warning");
    child.emit("error", expectedError);
    child.emit("close", null);

    assert.deepEqual(stdout, ["assistant chunk"]);
    assert.deepEqual(stderr, ["provider warning"]);
    assert.deepEqual(errors, [expectedError]);
    assert.deepEqual(exits, [null]);
  } finally {
    crossSpawn.spawn = originalSpawn;
    restoreConfiguration();
  }
});

test("reports an unresolved stream command without spawning a real process", () => {
  const missingCommand = "/sinitek-command-runner-coverage/missing-command";
  const restoreConfiguration = installConfiguration({
    "commands.claude": missingCommand,
    "args.claude": [],
  });
  const restorePlatform = setPlatform("linux");
  const originalSpawn = crossSpawn.spawn;
  const errors: Error[] = [];
  const exits: Array<number | null> = [];
  let spawnAttempts = 0;
  crossSpawn.spawn = (): unknown => {
    spawnAttempts += 1;
    throw new Error("unresolved command must not spawn");
  };

  try {
    const processHandle = runCliStream("claude", "inspect", {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onError: (error) => errors.push(error),
      onExit: (code) => exits.push(code),
    });

    assert.equal(processHandle.pid, undefined);
    assert.equal(processHandle.resolvedCommand, undefined);
    assert.equal(processHandle.kill(), false);
    assert.equal(spawnAttempts, 0);
    assert.deepEqual(exits, [127]);
    assert.equal(errors.length, 1);
    assert.equal((errors[0] as NodeJS.ErrnoException | undefined)?.code, "ENOENT");
    assert.equal(errors[0]?.message, `spawn ${missingCommand} ENOENT`);
  } finally {
    crossSpawn.spawn = originalSpawn;
    restorePlatform();
    restoreConfiguration();
  }
});

test("validates OpenCode server ports before starting a child process", () => {
  const originalSpawn = crossSpawn.spawn;
  const errors: Error[] = [];
  const exits: Array<number | null> = [];
  let spawnAttempts = 0;
  crossSpawn.spawn = (): unknown => {
    spawnAttempts += 1;
    throw new Error("invalid ports must not spawn");
  };

  try {
    for (const port of [Number.NaN, 0, 65536]) {
      const processHandle = startOpenCodeServer(port, {
        onError: (error) => errors.push(error),
        onExit: (code) => exits.push(code),
      });
      assert.equal(processHandle.kill(), false);
      assert.equal(processHandle.resolvedCommand, undefined);
    }

    assert.equal(spawnAttempts, 0);
    assert.deepEqual(exits, [1, 1, 1]);
    assert.deepEqual(
      errors.map((error) => error.message),
      [
        "invalid-opencode-server-port:NaN",
        "invalid-opencode-server-port:0",
        "invalid-opencode-server-port:65536",
      ],
    );
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("starts an OpenCode server through the mock and forwards its lifecycle events", () => {
  const restoreConfiguration = installConfiguration({
    "commands.opencode": process.execPath,
    "args.opencode": [],
  });
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  const spawnCalls: unknown[][] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const errors: Error[] = [];
  const exits: Array<number | null> = [];
  crossSpawn.spawn = (...args: unknown[]): unknown => {
    spawnCalls.push(args);
    return child;
  };

  try {
    const processHandle = startOpenCodeServer(41234, {
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
      onError: (error) => errors.push(error),
      onExit: (code) => exits.push(code),
    }, {
      cwd: "/isolated/opencode-workspace",
      envOverrides: { SINITEK_SERVER_TEST: "enabled" },
      isolateProjectInstructions: true,
      processLabel: "sinitek-unit-server",
    });

    assert.equal(processHandle.resolvedCommand, process.execPath);
    assert.equal(processHandle.kill(), false);
    assert.deepEqual(child.stdout.encodings, ["utf8"]);
    assert.deepEqual(child.stderr.encodings, ["utf8"]);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.[0], process.execPath);
    assert.deepEqual(spawnCalls[0]?.[1], [
      "serve",
      "--pure",
      "--hostname",
      "127.0.0.1",
      "--port",
      "41234",
    ]);
    assert.deepEqual(spawnCalls[0]?.[2], {
      cwd: "/isolated/opencode-workspace",
      env: {
        ...process.env,
        SINITEK_SERVER_TEST: "enabled",
        PWD: "/isolated/opencode-workspace",
      },
      argv0: "sinitek-unit-server",
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const expectedError = new Error("mock server failure");
    child.stdout.emit("data", "server stdout");
    child.stderr.emit("data", "server stderr");
    child.emit("error", expectedError);
    child.emit("close", 9);

    assert.deepEqual(stdout, ["server stdout"]);
    assert.deepEqual(stderr, ["server stderr"]);
    assert.deepEqual(errors, [expectedError]);
    assert.deepEqual(exits, [9]);
  } finally {
    crossSpawn.spawn = originalSpawn;
    restoreConfiguration();
  }
});

test("rejects captured output on timeout without retaining a child or timer", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  let spawnAttempts = 0;
  crossSpawn.spawn = (): unknown => {
    spawnAttempts += 1;
    return child;
  };

  try {
    await assert.rejects(
      captureCliOutput(process.execPath, ["--version"], { timeoutMs: 5 }),
      /capture-cli-output-timeout:5/u,
    );
    assert.equal(spawnAttempts, 1);
    assert.deepEqual(child.stdout.encodings, ["utf8"]);
    assert.deepEqual(child.stderr.encodings, ["utf8"]);
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("clears capture output timeout after a fast successful close", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  crossSpawn.spawn = (): unknown => {
    queueMicrotask(() => {
      child.stdout.emit("data", "fast output");
      child.emit("close", 0);
    });
    return child;
  };

  try {
    const output = await captureCliOutput(process.execPath, ["--version"], { timeoutMs: 1000 });

    assert.equal(output.stdout, "fast output");
    assert.equal(output.exitCode, 0);
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("handles Mac shell availability checks with only mocked child process events", async () => {
  const restorePlatform = setPlatform("darwin");
  const originalSpawn = crossSpawn.spawn;
  const toolSettings = require("../toolSettings") as typeof import("../toolSettings");
  const originalReadToolSettings = toolSettings.readToolSettings;
  const successChild = new EventEmitter();
  const errorChild = new EventEmitter();
  const bashChild = new EventEmitter();
  const spawnCalls: unknown[][] = [];
  let invocation = 0;
  crossSpawn.spawn = (...args: unknown[]): unknown => {
    spawnCalls.push(args);
    const child = invocation === 0 ? successChild : invocation === 1 ? errorChild : bashChild;
    invocation += 1;
    queueMicrotask(() => {
      if (child === successChild) {
        child.emit("close", 0);
      } else if (child === bashChild) {
        child.emit("close", 0);
      } else {
        child.emit("error", new Error("mock shell lookup failure"));
      }
    });
    return child;
  };

  try {
    assert.equal(await isCliCommandAvailable("sinitek-coverage-mock-command"), true);
    assert.equal(await isCliCommandAvailable("sinitek-coverage-mock-command"), false);
    toolSettings.readToolSettings = () => ({ ...originalReadToolSettings(), macTaskShell: "bash" });
    assert.equal(await isCliCommandAvailable("sinitek-coverage-mock-command"), true);
    assert.equal(spawnCalls.length, 3);
    assert.equal(spawnCalls[0]?.[1] instanceof Array, true);
    assert.match((spawnCalls[0]?.[1] as string[])[1] ?? "", /command -v/u);
    assert.equal(spawnCalls[2]?.[0], "/bin/bash");
  } finally {
    crossSpawn.spawn = originalSpawn;
    toolSettings.readToolSettings = originalReadToolSettings;
    restorePlatform();
  }
});

test("keeps malformed OpenCode structures isolated and uses the configured fallback", () => {
  const malformedError = [
    "{incomplete-json",
    JSON.stringify({
      type: "error",
      error: { data: { responseBody: "upstream response was not JSON" } },
    }),
  ].join("\n");

  assert.deepEqual(parseOpenCodeVisibleStreamEvents("{incomplete-json"), []);
  assert.equal(parseOpenCodeRunOutput(JSON.stringify({
    type: "error",
    error: {
      data: {
        responseBody: JSON.stringify({ message: "root body message", type: "root_type", code: "root_code", param: "root_param" }),
      },
    },
  }), "").errorText, "root body message\nroot_type\nroot_code");
  assert.deepEqual(parseOpenCodeRunOutput(malformedError, ""), {
    finalText: null,
    errorText: "upstream response was not JSON",
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
  assert.equal(
    buildOpenCodeRunFailureMessage({
      finalText: null,
      errorText: null,
      statusText: null,
      hasStructuredFinalAnswer: false,
    }, "", {
      missingFinalOutputMessage: "custom missing final output",
    }),
    "custom missing final output",
  );
  assert.equal(
    buildOpenCodeRunFailureMessage({
      finalText: null,
      errorText: null,
      statusText: "waiting",
      hasStructuredFinalAnswer: false,
    }, "fallback", {
      missingFinalOutputWithStatusMessage: (status) => `custom status ${status}`,
    }),
    "custom status waiting",
  );
  assert.match(
    buildOpenCodeRunFailureMessage({
      finalText: null,
      errorText: null,
      statusText: null,
      hasStructuredFinalAnswer: false,
    }, ""),
    /OpenCode exited without returning/u,
  );
});

test("builds non-OpenCode labels and arguments without executing a command", () => {
  assert.equal(buildProcessLabel("codex", "session-1"), "sinitek-ai-vscode-cli-codex/session-1");
  assert.equal(buildProcessLabel("claude"), "sinitek-ai-vscode-cli-claude/new");
  assert.deepEqual(
    buildCliArgs("codex", {
      sessionId: "previous-session",
      isolateProjectInstructions: true,
      imagePaths: [" /tmp/diagram.png ", 42 as unknown as string, ""],
    }, "continue"),
    ["--ignore-rules", "--skip-git-repo-check", "--image", "/tmp/diagram.png", "continue"],
  );
  assert.deepEqual(
    buildCliArgs("claude", { sessionId: "previous-session", isolateProjectInstructions: true }, "continue"),
    ["--safe-mode", "continue"],
  );
});

test("preserves existing project-isolation flags for every CLI", () => {
  let restoreConfiguration = installConfiguration({
    "args.codex": ["--ignore-rules"],
  });
  try {
    assert.deepEqual(buildCliArgs("codex", { isolateProjectInstructions: true }, "prompt"), ["--ignore-rules", "--skip-git-repo-check", "prompt"]);
  } finally {
    restoreConfiguration();
  }

  restoreConfiguration = installConfiguration({
    "args.claude": ["--safe-mode"],
  });
  try {
    assert.deepEqual(buildCliArgs("claude", { isolateProjectInstructions: true }, "prompt"), ["--safe-mode", "prompt"]);
  } finally {
    restoreConfiguration();
  }

  restoreConfiguration = installConfiguration({
    "args.opencode": ["run", "--pure"],
  });
  try {
    assert.deepEqual(buildCliArgs("opencode", { isolateProjectInstructions: true }, "prompt"), ["run", "--auto", "--format", "json", "--pure", "prompt"]);
  } finally {
    restoreConfiguration();
  }
});

test("uses only mocked macOS-shell resolution for stream and capture commands", async () => {
  const restorePlatform = setPlatform("darwin");
  const restoreConfiguration = installConfiguration({ "commands.codex": "sinitek-missing-mac-command" });
  const originalSpawn = crossSpawn.spawn;
  const streamChild = createFakeChild();
  const captureChild = createFakeChild();
  const spawnCalls: unknown[][] = [];
  let invocation = 0;
  crossSpawn.spawn = (...args: unknown[]): unknown => {
    spawnCalls.push(args);
    const child = invocation === 0 ? streamChild : captureChild;
    invocation += 1;
    if (child === captureChild) {
      queueMicrotask(() => child.emit("close", 0));
    }
    return child;
  };
  try {
    const stream = runCliStream("codex", "quoted prompt", {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onError: () => undefined,
      onExit: () => undefined,
    });
    assert.equal(stream.resolvedCommand, "sinitek-missing-mac-command");
    assert.equal(spawnCalls[0]?.[0], "/bin/zsh");
    assert.match(String((spawnCalls[0]?.[1] as string[])[1]), /sinitek-missing-mac-command/);

    const captured = await captureCliOutput("sinitek-missing-mac-command", ["arg with space"]);
    assert.equal(captured.resolvedCommand, "sinitek-missing-mac-command");
    assert.equal(spawnCalls[1]?.[0], "/bin/zsh");
  } finally {
    crossSpawn.spawn = originalSpawn;
    restoreConfiguration();
    restorePlatform();
  }
});

test("reports invalid OpenCode overlays without creating a process", () => {
  const errors: string[] = [];
  const exits: Array<number | null> = [];
  const activeConfig = JSON.stringify({
    model: "valid/model",
    provider: { valid: { models: { model: {} } } },
  });
  const invalidServer = startOpenCodeServer(43123, {
    onError: (error) => errors.push(error.message),
    onExit: (code) => exits.push(code),
  }, { model: "valid/model", openCodeSmallModel: "missing/model", openCodeConfigContent: activeConfig });
  const invalidStream = runCliStream("opencode", "prompt", {
    onStdout: () => undefined,
    onStderr: () => undefined,
    onError: (error) => errors.push(error.message),
    onExit: (code) => exits.push(code),
  }, { model: "valid/model", openCodeSmallModel: "missing/model", openCodeConfigContent: activeConfig });

  assert.equal(invalidServer.kill(), false);
  assert.equal(invalidStream.kill(), false);
  assert.deepEqual(exits, [1, 1]);
  assert.ok(errors.every(Boolean));
});

test("reports unresolved server and capture commands without leaving a process handle", async () => {
  const restorePlatform = setPlatform("linux");
  const restoreConfiguration = installConfiguration({ "commands.opencode": "/sinitek-missing-server" });
  const errors: Array<NodeJS.ErrnoException> = [];
  const exits: Array<number | null> = [];
  try {
    assert.equal(resolveCliCommand(process.execPath)?.command, process.execPath);
    const server = startOpenCodeServer(43124, {
      onError: (error) => errors.push(error as NodeJS.ErrnoException),
      onExit: (code) => exits.push(code),
    });
    assert.equal(server.kill(), false);
    assert.equal(server.pid, undefined);
    assert.equal(errors[0]?.code, "ENOENT");
    assert.deepEqual(exits, [127]);
    await assert.rejects(captureCliOutput("/sinitek-missing-capture", ["arg"]), {
      code: "ENOENT",
    });
  } finally {
    restoreConfiguration();
    restorePlatform();
  }
});

test("cleans OpenCode overlays on unresolved and child error paths", () => {
  const activeConfig = JSON.stringify({
    model: "valid/model",
    provider: { valid: { models: { model: {} } } },
  });
  const restorePlatform = setPlatform("linux");
  let restoreConfiguration = installConfiguration({ "commands.opencode": "/sinitek-missing-overlay-command" });
  try {
    const errors: Array<NodeJS.ErrnoException> = [];
    const exits: Array<number | null> = [];
    const server = startOpenCodeServer(43125, {
      onError: (error) => errors.push(error as NodeJS.ErrnoException),
      onExit: (code) => exits.push(code),
    }, { model: "valid/model", openCodeConfigContent: activeConfig });
    const stream = runCliStream("opencode", "prompt", {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onError: (error) => errors.push(error as NodeJS.ErrnoException),
      onExit: (code) => exits.push(code),
    }, { model: "valid/model", openCodeConfigContent: activeConfig });
    assert.equal(server.kill(), false);
    assert.equal(stream.kill(), false);
    assert.deepEqual(exits, [127, 127]);
    assert.equal(errors.every((error) => error.code === "ENOENT"), true);
  } finally {
    restoreConfiguration();
    restorePlatform();
  }

  restoreConfiguration = installConfiguration({
    "commands.opencode": process.execPath,
    "args.opencode": [],
  });
  const originalSpawn = crossSpawn.spawn;
  const serverChild = createFakeChild();
  const streamChild = createFakeChild();
  let invocation = 0;
  crossSpawn.spawn = (): unknown => {
    invocation += 1;
    return invocation === 1 ? serverChild : streamChild;
  };
  try {
    const errors: Error[] = [];
    startOpenCodeServer(43126, {
      onError: (error) => errors.push(error),
      onExit: () => undefined,
    }, { model: "valid/model", openCodeConfigContent: activeConfig });
    runCliStream("opencode", "prompt", {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onError: (error) => errors.push(error),
      onExit: () => undefined,
    }, { model: "valid/model", openCodeConfigContent: activeConfig });

    serverChild.emit("error", new Error("server overlay child error"));
    streamChild.emit("error", new Error("stream overlay child error"));
    assert.deepEqual(errors.map((error) => error.message), ["server overlay child error", "stream overlay child error"]);
  } finally {
    crossSpawn.spawn = originalSpawn;
    restoreConfiguration();
  }
});

test("parses nested OpenCode output, structured finals, provider errors, and streaming activity", () => {
  assert.equal(parseOpenCodeSessionId(JSON.stringify({ type: "step_start" })), null);
  const stdout = [
    "plain progress",
    "{incomplete",
    JSON.stringify({
      type: "assistant",
      messageID: "message-1",
      text: "<thinking>reasoning</thinking>answer",
      parts: [{ type: "assistant", text: "" }],
      content: { type: "assistant", text: " nested" },
      message: [{ type: "assistant", text: " message" }],
      messages: { type: "assistant", text: " messages" },
      output: [{ type: "assistant", text: " output" }],
    }),
    JSON.stringify({ type: "step_finish", messageID: "message-1", reason: "stop" }),
    JSON.stringify({
      type: "error",
      error: {
        name: "ProviderError",
        message: "provider failed",
        data: {
          statusCode: 429,
          metadata: { url: "https://provider.example/errors" },
          responseBody: JSON.stringify({ error: { message: "rate limited", type: "rate_limit", code: "limit" } }),
        },
      },
    }),
  ].join("\n");

  const output = parseOpenCodeRunOutput(stdout, "> planning step\nwarning text");
  assert.match(output.finalText ?? "", /answer/);
  assert.equal(output.hasStructuredFinalAnswer, true);
  assert.match(output.errorText ?? "", /rate limited/);
  assert.equal(output.statusText, "> planning step");
  assert.deepEqual(detectOpenCodeStreamActivity(stdout, "> planning step"), {
    hasAssistantAnswer: true,
    hasError: true,
    hasStatus: true,
    hasProgress: true,
  });
  assert.deepEqual(detectOpenCodeStreamActivity("plain progress only", ""), {
    hasAssistantAnswer: true,
    hasError: false,
    hasStatus: false,
    hasProgress: false,
  });
  assert.deepEqual(detectOpenCodeStreamActivity("<thinking>working</thinking>", ""), {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: false,
    hasProgress: true,
  });
  assert.deepEqual(parseOpenCodeRunOutput(JSON.stringify({
    type: "error",
    error: { message: "plain provider error" },
  }), ""), {
    finalText: null,
    errorText: "plain provider error",
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
  assert.deepEqual(parseOpenCodeRunOutput(JSON.stringify({
    type: "error",
    error: { name: "PlainError" },
  }), ""), {
    finalText: null,
    errorText: "PlainError",
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
  assert.deepEqual(parseOpenCodeRunOutput(JSON.stringify({
    type: "error",
    error: {},
  }), ""), {
    finalText: null,
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
  assert.deepEqual(
    parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "tool_use", tool: "shell", state: { status: "running", title: "Executing" } })),
    [{ kind: "tool-use", content: "tool shell\nstatus: running\nExecuting" }],
  );
  assert.deepEqual(
    parseOpenCodeVisibleStreamEvents(JSON.stringify({
      type: "tool_use",
      tool: "todowrite",
      todos: [{ content: "Ship coverage", status: "done" }],
    })),
    [{ kind: "tool-use", content: "tool todowrite", taskListItems: [{ text: "Ship coverage", done: true }] }],
  );
  assert.deepEqual(
    parseOpenCodeVisibleStreamEvents(JSON.stringify({
      type: "tool_use",
      tool: "todowrite",
      part: { type: "tool", tool: "todowrite" },
      todos: [{ content: "Ship fallback coverage", done: true }],
    })),
    [{ kind: "tool-use", content: "tool todowrite", taskListItems: [{ text: "Ship fallback coverage", done: true }] }],
  );
  assert.deepEqual(detectOpenCodeStreamActivity(JSON.stringify({ type: 42, error: "failed" }), ""), {
    hasAssistantAnswer: false,
    hasError: true,
    hasStatus: false,
    hasProgress: false,
  });
  assert.deepEqual(
    parseOpenCodeRunOutput(JSON.stringify({ content: { role: "assistant", text: "Nested assistant role" } }), ""),
    {
      finalText: "Nested assistant role",
      errorText: null,
      statusText: null,
      hasStructuredFinalAnswer: false,
    },
  );
  assert.deepEqual(
    parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "event", content: { type: "reasoning", text: "Nested thought" } })),
    [{ kind: "thinking", content: "thinking\nNested thought" }],
  );
  assert.deepEqual(
    parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "event", content: [{ type: "reasoning", text: "Array thought" }, null] })),
    [{ kind: "thinking", content: "thinking\nArray thought" }],
  );
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "event", content: [null] })), []);
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "session_update" })), []);
});

test("covers command-resolution, terminal escaping, and malformed OpenCode JSON boundaries", async () => {
  const restoreConfiguration = installConfiguration({
    "commands.codex": process.execPath,
    "args.codex": [""],
  });
  const vscode = require("vscode") as {
    window: { createTerminal: (options: unknown) => { sendText: (value: string) => void } };
  };
  const originalCreateTerminal = vscode.window.createTerminal;
  const sent: string[] = [];
  vscode.window.createTerminal = () => ({ sendText: (value) => sent.push(value) });
  const restorePlatform = setPlatform("linux");
  try {
    assert.equal(await isCliCommandAvailable(process.execPath), true);
    assert.equal(await isCliCommandAvailable("/sinitek-command-runner-coverage/missing"), false);
    await runCli("codex");
    assert.match(sent[0] ?? "", /''/u);

    assert.deepEqual(parseOpenCodeVisibleStreamEvents("null"), []);
    assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "tool" })), [
      { kind: "tool-use", content: "tool tool" },
    ]);
    assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "reasoning", summary: "Working" })), [
      { kind: "thinking", content: "thinking\nWorking" },
    ]);
    assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({ type: "step_start" })), [
      { kind: "thinking", content: "thinking\nOpenCode is planning the next step\u2026" },
    ]);
    assert.deepEqual(parseOpenCodeRunOutput(JSON.stringify({ type: "error", error: "invalid" }), ""), {
      finalText: null,
      errorText: null,
      statusText: null,
      hasStructuredFinalAnswer: false,
    });
    assert.deepEqual(detectOpenCodeStreamActivity('{"type":"assistant","content":[null]}', ""), {
      hasAssistantAnswer: false,
      hasError: false,
      hasStatus: false,
      hasProgress: false,
    });
  } finally {
    restorePlatform();
    vscode.window.createTerminal = originalCreateTerminal;
    restoreConfiguration();
  }
});

test("terminates mocked process trees through direct, child, and Windows fallbacks", async () => {
  const originalSpawn = crossSpawn.spawn;
  const originalKill = process.kill;
  const restoreConfiguration = installConfiguration({ "commands.codex": process.execPath, "args.codex": [] });
  const child = createFakeChild(4242);
  const spawned: unknown[][] = [];
  let childKillCalls = 0;
  child.kill = () => {
    childKillCalls += 1;
    return true;
  };
  crossSpawn.spawn = (...args: unknown[]): unknown => {
    spawned.push(args);
    return child;
  };
  try {
    process.kill = (() => {
      throw new Error("group process not available");
    }) as typeof process.kill;
    const handle = runCliStream("codex", "stop", {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onError: () => undefined,
      onExit: () => undefined,
    });
    assert.equal(handle.kill("SIGINT"), true);
    assert.equal(childKillCalls, 1);

    const restorePlatform = setPlatform("win32");
    try {
      assert.equal(handle.kill("SIGKILL"), true);
      assert.equal(spawned.at(-1)?.[0], "taskkill");
    } finally {
      restorePlatform();
    }

    const noPid = createFakeChild();
    crossSpawn.spawn = (): unknown => noPid;
    const noPidHandle = runCliStream("codex", "no-pid", {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onError: () => undefined,
      onExit: () => undefined,
    });
    assert.equal(noPidHandle.kill(), false);

    const throwingChild = createFakeChild(5252);
    throwingChild.kill = () => {
      throw new Error("child kill unavailable");
    };
    crossSpawn.spawn = (): unknown => throwingChild;
    const throwingHandle = runCliStream("codex", "throwing-child", {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onError: () => undefined,
      onExit: () => undefined,
    });
    assert.equal(throwingHandle.kill("SIGINT"), false);

    const escalationChild = createFakeChild(5353);
    const escalationSignals: Array<NodeJS.Signals | number | undefined> = [];
    escalationChild.kill = (signal?: NodeJS.Signals | number) => {
      escalationSignals.push(signal);
      if (signal === "SIGKILL") {
        throw new Error("child kill escalation unavailable");
      }
      return true;
    };
    crossSpawn.spawn = (): unknown => escalationChild;
    const escalationHandle = runCliStream("codex", "escalate-child", {
      onStdout: () => undefined,
      onStderr: () => undefined,
      onError: () => undefined,
      onExit: () => undefined,
    });
    assert.equal(escalationHandle.kill("SIGTERM"), true);
    await new Promise((resolve) => setTimeout(resolve, 2050));
    assert.deepEqual(escalationSignals, ["SIGTERM", "SIGKILL"]);
  } finally {
    process.kill = originalKill;
    crossSpawn.spawn = originalSpawn;
    restoreConfiguration();
  }
});
