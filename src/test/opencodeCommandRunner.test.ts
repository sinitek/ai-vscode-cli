import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const {
  applyOpenCodeVariantArg,
  buildOpenCodeRunFailureMessage,
  buildCliArgs,
  detectOpenCodeStreamActivity,
  createOpenCodeStreamActivityTracker,
  OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES,
  parseOpenCodeVisibleStreamEvents,
  parseOpenCodeSessionId,
  parseOpenCodeRunOutput,
  runCliStream,
  startOpenCodeServer,
} = require("../cli/commandRunner") as typeof import("../cli/commandRunner");
const { isInteractiveSupported } = require("../cli/config") as typeof import("../cli/config");
const {
  OPENCODE_ONE_SHOT_STARTUP_TIMEOUT_MS,
  resolveOpenCodeOneShotWatchdogTimeoutMs,
} = require("../cli/opencodewatchdog") as typeof import("../cli/opencodewatchdog");
const {
  extractSessionId,
  resolveCliSessionIdForResume,
} = require("../sessionLifecycle") as typeof import("../sessionLifecycle");

const packyConfig = JSON.stringify({
  model: "packyapi/claude-sonnet-5",
  provider: { packyapi: { models: { "claude-sonnet-5": {} } } },
});

const myApiConfig = JSON.stringify({
  model: "myAPI/model",
  provider: { myAPI: { models: { model: {}, "gpt-5.5": {} } } },
});

async function runOverlayLifecycleTest(cancel: boolean): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-runner-test-"));
  const markerPath = path.join(tempDir, "overlay-path.txt");
  const commandPath = path.join(tempDir, "mock-opencode.js");
  fs.writeFileSync(commandPath, [
    "#!/usr/bin/env node",
    "const fs = require('fs');",
    "fs.writeFileSync(process.env.TEST_OVERLAY_MARKER, process.env.OPENCODE_CONFIG || '');",
    cancel ? "setInterval(() => {}, 1000);" : "process.exit(0);",
  ].join("\n"), { mode: 0o755 });

  const vscode = require("vscode") as {
    workspace: { getConfiguration: () => { get: <T>(key: string, fallback?: T) => T | undefined } };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      if (key === "commands.opencode") {
        return commandPath as T;
      }
      if (key === "args.opencode") {
        return [] as T;
      }
      return fallback;
    },
  });
  try {
    let processHandle: ReturnType<typeof runCliStream> | null = null;
    await new Promise<void>((resolve, reject) => {
      processHandle = runCliStream("opencode", "hello", {
        onStdout: () => undefined,
        onStderr: () => undefined,
        onError: reject,
        onExit: () => resolve(),
      }, {
        model: "myAPI/model",
        openCodeSmallModel: "myAPI/gpt-5.5",
        openCodeConfigContent: myApiConfig,
        envOverrides: { TEST_OVERLAY_MARKER: markerPath },
      });
      if (cancel) {
        const deadline = Date.now() + 3000;
        const stopWhenReady = (): void => {
          if (fs.existsSync(markerPath)) {
            processHandle?.kill();
            return;
          }
          if (Date.now() >= deadline) {
            reject(new Error("overlay marker timeout"));
            return;
          }
          setTimeout(stopWhenReady, 10);
        };
        stopWhenReady();
      }
    });
    const overlayPath = fs.readFileSync(markerPath, "utf8");
    assert.ok(overlayPath);
    assert.equal(fs.existsSync(overlayPath), false);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("does not route OpenCode through the unsupported interactive runner", () => {
  assert.equal(isInteractiveSupported("codex"), true);
  assert.equal(isInteractiveSupported("claude"), true);
  assert.equal(isInteractiveSupported("opencode"), false);
});

test("builds OpenCode run args with provider/model selection", () => {
  assert.deepEqual(
    buildCliArgs("opencode", {
      model: "packyapi/claude-sonnet-5",
      openCodeConfigContent: packyConfig,
    }, "hello"),
    ["run", "--auto", "--format", "json", "--model", "packyapi/claude-sonnet-5", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("opencode", {
      model: "packyapi/claude-sonnet-5",
      sessionId: "session-1",
      openCodeConfigContent: packyConfig,
    }, "hello"),
    ["run", "--auto", "--format", "json", "--model", "packyapi/claude-sonnet-5", "--session", "session-1", "hello"],
  );
});

test("extracts the real OpenCode sessionID used by JSONL events", () => {
  const sessionId = "ses_0b6883a39ffe82DWaoYImvD0z7";
  const output = JSON.stringify({
    type: "step_start",
    sessionID: sessionId,
    part: {
      type: "step-start",
      sessionID: sessionId,
    },
  });

  assert.equal(parseOpenCodeSessionId(output), sessionId);
  assert.equal(extractSessionId("opencode", output), sessionId);
});

test("never passes an extension-local session id to OpenCode resume", () => {
  assert.equal(resolveCliSessionIdForResume("opencode", "local_1783675937696_75aeb62a8eb548"), null);
  assert.equal(resolveCliSessionIdForResume("opencode", "ses_0b6883a39ffe82DWaoYImvD0z7"), "ses_0b6883a39ffe82DWaoYImvD0z7");
  assert.deepEqual(
    buildCliArgs("opencode", {
      sessionId: resolveCliSessionIdForResume("opencode", "local_1783675937696_75aeb62a8eb548"),
    }, "hello"),
    ["run", "--auto", "--format", "json", "hello"],
  );
});

test("adds one OpenCode auto flag for one-shot and terminal launches", () => {
  assert.deepEqual(
    buildCliArgs("opencode", {}, "hello"),
    ["run", "--auto", "--format", "json", "hello"],
  );
  assert.deepEqual(buildCliArgs("opencode", {}), ["--auto"]);
});

test("attaches OpenCode run to the managed subagent monitoring server", () => {
  assert.deepEqual(
    buildCliArgs("opencode", { openCodeServerUrl: "http://127.0.0.1:41873/" }, "hello"),
    ["run", "--auto", "--format", "json", "--attach", "http://127.0.0.1:41873", "hello"],
  );
});

test("replaces a configured OpenCode run port with the managed attach endpoint", () => {
  const vscode = require("vscode") as {
    workspace: {
      getConfiguration: () => {
        get: <T>(key: string, defaultValue?: T) => T | undefined;
      };
    };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      if (key === "args.opencode") {
        return ["run", "--port", "4096"] as T;
      }
      return defaultValue;
    },
  });
  try {
    assert.deepEqual(
      buildCliArgs("opencode", { openCodeServerUrl: "http://127.0.0.1:41873" }, "hello"),
      ["run", "--auto", "--format", "json", "--attach", "http://127.0.0.1:41873", "hello"],
    );
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  }
});

test("starts a dedicated OpenCode serve process and cleans its runtime overlay", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-opencode-server-test-"));
  const markerPath = path.join(tempDir, "server.json");
  const commandPath = path.join(tempDir, "mock-opencode-server.js");
  fs.writeFileSync(commandPath, [
    "#!/usr/bin/env node",
    "const fs = require('fs');",
    "fs.writeFileSync(process.env.TEST_SERVER_MARKER, JSON.stringify({ args: process.argv.slice(2), config: process.env.OPENCODE_CONFIG }));",
    "setInterval(() => {}, 1000);",
  ].join("\n"), { mode: 0o755 });

  const vscode = require("vscode") as {
    workspace: { getConfiguration: () => { get: <T>(key: string, fallback?: T) => T | undefined } };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      if (key === "commands.opencode") {
        return commandPath as T;
      }
      if (key === "args.opencode") {
        return [] as T;
      }
      return fallback;
    },
  });

  try {
    let processHandle: ReturnType<typeof startOpenCodeServer> | null = null;
    await new Promise<void>((resolve, reject) => {
      processHandle = startOpenCodeServer(41873, {
        onError: reject,
        onExit: () => resolve(),
      }, {
        model: "myAPI/model",
        openCodeSmallModel: "myAPI/gpt-5.5",
        openCodeConfigContent: myApiConfig,
        envOverrides: { TEST_SERVER_MARKER: markerPath },
      });
      const deadline = Date.now() + 3000;
      const stopWhenReady = (): void => {
        if (fs.existsSync(markerPath)) {
          processHandle?.kill();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error("managed OpenCode server marker timeout"));
          return;
        }
        setTimeout(stopWhenReady, 10);
      };
      stopWhenReady();
    });

    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as { args: string[]; config: string };
    assert.deepEqual(marker.args, ["serve", "--hostname", "127.0.0.1", "--port", "41873"]);
    assert.ok(marker.config);
    assert.equal(fs.existsSync(marker.config), false);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("deduplicates an explicit OpenCode auto flag", () => {
  const vscode = require("vscode") as {
    workspace: {
      getConfiguration: () => {
        get: <T>(key: string, defaultValue?: T) => T | undefined;
      };
    };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      if (key === "args.opencode") {
        return ["run", "--auto", "--auto", "--format", "json"] as T;
      }
      return defaultValue;
    },
  });
  try {
    const args = buildCliArgs("opencode", {}, "hello");
    assert.deepEqual(args, ["run", "--auto", "--format", "json", "hello"]);
    assert.equal(args.filter((arg) => arg === "--auto").length, 1);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  }
});

test("adds only a valid non-default OpenCode variant", () => {
  assert.deepEqual(
    buildCliArgs("opencode", {
      model: "myAPI/model",
      openCodeVariant: "high",
      openCodeConfigContent: myApiConfig,
    }, "hello"),
    ["run", "--auto", "--format", "json", "--model", "myAPI/model", "--variant", "high", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("opencode", {
      model: "myAPI/model",
      openCodeVariant: null,
      openCodeConfigContent: myApiConfig,
    }, "hello"),
    ["run", "--auto", "--format", "json", "--model", "myAPI/model", "hello"],
  );
});

test("preserves explicit OpenCode variant args over persisted selection", () => {
  assert.deepEqual(
    applyOpenCodeVariantArg(["run", "--variant", "custom"], "high"),
    ["run", "--variant", "custom"],
  );
  assert.deepEqual(
    applyOpenCodeVariantArg(["run", "--variant=custom"], "high"),
    ["run", "--variant=custom"],
  );
});

test("ignores fixed OpenCode thinking args while preserving Codex behavior", () => {
  const vscode = require("vscode") as {
    workspace: {
      getConfiguration: () => {
        get: <T>(key: string, defaultValue?: T) => T | undefined;
      };
    };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      if (key === "thinkingArgs.opencode.high") {
        return ["--legacy-opencode-effort"] as T;
      }
      if (key === "thinkingArgs.codex.high") {
        return ["--codex-thinking"] as T;
      }
      return defaultValue;
    },
  });
  try {
    assert.deepEqual(
      buildCliArgs("opencode", { thinkingMode: "high" }, "hello"),
      ["run", "--auto", "--format", "json", "hello"],
    );
    assert.deepEqual(
      buildCliArgs("codex", { thinkingMode: "high" }, "hello"),
      ["--codex-thinking", "--skip-git-repo-check", "hello"],
    );
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  }
});

test("rejects bare OpenCode model ids instead of guessing a provider", () => {
  assert.throws(
    () => buildCliArgs("opencode", { model: "gpt-5.5", openCodeConfigContent: myApiConfig }, "hello"),
    /exact provider\/model/u,
  );
  assert.deepEqual(
    buildCliArgs("opencode", { model: "myAPI/gpt-5.5", openCodeConfigContent: myApiConfig }, "hello"),
    ["run", "--auto", "--format", "json", "--model", "myAPI/gpt-5.5", "hello"],
  );
  assert.throws(
    () => buildCliArgs("opencode", { model: "glm-5.2", openCodeConfigContent: myApiConfig }, "hello"),
    /exact provider\/model/u,
  );
});

test("preserves explicit OpenCode output format args", () => {
  assert.deepEqual(
    buildCliArgs("opencode", {}, "hello"),
    ["run", "--auto", "--format", "json", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("opencode", {
      model: "packyapi/claude-sonnet-5",
      openCodeConfigContent: packyConfig,
    }, "hello"),
    ["run", "--auto", "--format", "json", "--model", "packyapi/claude-sonnet-5", "hello"],
  );
});

test("does not add OpenCode auto mode to Codex or Claude", () => {
  assert.deepEqual(buildCliArgs("codex", {}, "hello"), ["--skip-git-repo-check", "hello"]);
  assert.deepEqual(buildCliArgs("claude", {}, "hello"), ["hello"]);
});

test("adds the CLI-specific instruction isolation flags for Loop subtasks", () => {
  assert.deepEqual(
    buildCliArgs("codex", { isolateProjectInstructions: true }, "hello"),
    ["--ignore-rules", "--skip-git-repo-check", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("claude", { isolateProjectInstructions: true }, "hello"),
    ["--safe-mode", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("opencode", { isolateProjectInstructions: true }, "hello"),
    ["run", "--auto", "--format", "json", "--pure", "hello"],
  );
});

test("cleans runtime overlays after normal exit", async () => {
  await runOverlayLifecycleTest(false);
});

test("cleans runtime overlays after cancellation", async () => {
  await runOverlayLifecycleTest(true);
});

test("synchronizes the child PWD environment with the requested cwd", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-runner-cwd-test-"));
  const workspacePath = path.join(tempDir, "workspace");
  const markerPath = path.join(tempDir, "cwd.json");
  const commandPath = path.join(tempDir, "mock-opencode.js");
  fs.mkdirSync(workspacePath, { recursive: true });
  const workspaceDir = fs.realpathSync(workspacePath);
  fs.writeFileSync(commandPath, [
    "#!/usr/bin/env node",
    "const fs = require('fs');",
    "fs.writeFileSync(process.env.TEST_CWD_MARKER, JSON.stringify({ cwd: process.cwd(), pwd: process.env.PWD }));",
  ].join("\n"), { mode: 0o755 });

  const vscode = require("vscode") as {
    workspace: { getConfiguration: () => { get: <T>(key: string, fallback?: T) => T | undefined } };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      if (key === "commands.opencode") {
        return commandPath as T;
      }
      if (key === "args.opencode") {
        return [] as T;
      }
      return fallback;
    },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      runCliStream("opencode", "hello", {
        onStdout: () => undefined,
        onStderr: () => undefined,
        onError: reject,
        onExit: (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`mock OpenCode exited with code ${String(code)}`));
        },
      }, {
        cwd: workspaceDir,
        envOverrides: {
          PWD: path.parse(workspaceDir).root,
          TEST_CWD_MARKER: markerPath,
        },
      });
    });

    const childLocation = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
      cwd?: string;
      pwd?: string;
    };
    assert.deepEqual(childLocation, {
      cwd: workspaceDir,
      pwd: workspaceDir,
    });
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("passes independent OpenCode role models and reasoning efforts to the child process", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-runner-profile-test-"));
  const overlayPathMarker = path.join(tempDir, "overlay-path.txt");
  const overlayContentCopy = path.join(tempDir, "overlay-content.json");
  const commandPath = path.join(tempDir, "mock-opencode.js");
  fs.writeFileSync(commandPath, [
    "#!/usr/bin/env node",
    "const fs = require('fs');",
    "const configPath = process.env.OPENCODE_CONFIG || '';",
    "fs.writeFileSync(process.env.TEST_OVERLAY_PATH_MARKER, configPath);",
    "fs.copyFileSync(configPath, process.env.TEST_OVERLAY_CONTENT_COPY);",
  ].join("\n"), { mode: 0o755 });

  const vscode = require("vscode") as {
    workspace: { getConfiguration: () => { get: <T>(key: string, fallback?: T) => T | undefined } };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      if (key === "commands.opencode") {
        return commandPath as T;
      }
      if (key === "args.opencode") {
        return [] as T;
      }
      return fallback;
    },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      runCliStream("opencode", "hello", {
        onStdout: () => undefined,
        onStderr: () => undefined,
        onError: reject,
        onExit: () => resolve(),
      }, {
        model: "myAPI/model",
        openCodeSmallModel: "myAPI/gpt-5.5",
        openCodeVariant: "max",
        openCodeSmallVariant: "medium",
        openCodeConfigContent: myApiConfig,
        envOverrides: {
          TEST_OVERLAY_PATH_MARKER: overlayPathMarker,
          TEST_OVERLAY_CONTENT_COPY: overlayContentCopy,
        },
      });
    });

    const overlayPath = fs.readFileSync(overlayPathMarker, "utf8");
    const overlay = JSON.parse(fs.readFileSync(overlayContentCopy, "utf8")) as {
      model?: string;
      small_model?: string;
      provider?: {
        myAPI?: {
          models?: Record<string, { options?: { reasoningEffort?: string } }>;
        };
      };
    };
    assert.equal(overlay.model, "myAPI/model");
    assert.equal(overlay.small_model, "myAPI/gpt-5.5");
    assert.equal(overlay.provider?.myAPI?.models?.model?.options?.reasoningEffort, "max");
    assert.equal(overlay.provider?.myAPI?.models?.["gpt-5.5"]?.options?.reasoningEffort, "medium");
    assert.equal(fs.existsSync(overlayPath), false);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("extracts assistant text from OpenCode JSON events", () => {
  const stdout = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "part_delta", part: { type: "text", text: "Hello" } }),
    JSON.stringify({ type: "part_delta", part: { type: "text", text: " world" } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish" } }),
  ].join("\n");

  assert.deepEqual(parseOpenCodeRunOutput(stdout, ""), {
    finalText: "Hello world",
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});

test("accepts an OpenCode stop event as a structured final answer for the same text message", () => {
  const stdout = [
    JSON.stringify({
      type: "text",
      sessionID: "ses_final",
      part: {
        type: "text",
        text: "Please choose project 1 or 2.",
        messageID: "msg_final",
      },
    }),
    JSON.stringify({
      type: "step_finish",
      sessionID: "ses_final",
      part: {
        type: "step-finish",
        reason: "stop",
        messageID: "msg_final",
      },
    }),
  ].join("\n");

  assert.deepEqual(parseOpenCodeRunOutput(stdout, ""), {
    finalText: "Please choose project 1 or 2.",
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: true,
  });
});

test("does not combine OpenCode text and stop events from different messages", () => {
  const stdout = [
    JSON.stringify({
      type: "text",
      part: { type: "text", text: "Still working.", messageID: "msg_progress" },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", reason: "stop", messageID: "msg_empty_final" },
    }),
  ].join("\n");

  assert.deepEqual(parseOpenCodeRunOutput(stdout, ""), {
    finalText: "Still working.",
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});

test("does not treat OpenCode stop events without message ids as structured final answers", () => {
  const stdout = [
    JSON.stringify({ type: "text", part: { type: "text", text: "Unscoped reply." } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
  ].join("\n");

  assert.deepEqual(parseOpenCodeRunOutput(stdout, ""), {
    finalText: "Unscoped reply.",
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});

test("does not treat OpenCode tool-call step finishes as structured final answers", () => {
  const stdout = [
    JSON.stringify({
      type: "text",
      part: { type: "text", text: "I will inspect the files.", messageID: "msg_tool" },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", reason: "tool-calls", messageID: "msg_tool" },
    }),
  ].join("\n");

  assert.deepEqual(parseOpenCodeRunOutput(stdout, ""), {
    finalText: "I will inspect the files.",
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});

test("does not treat OpenCode status lines as assistant text", () => {
  assert.deepEqual(parseOpenCodeRunOutput("", "\u001b[0m\n> build · claude-sonnet-5\n\u001b[0m\n"), {
    finalText: null,
    errorText: null,
    statusText: "> build · claude-sonnet-5",
    hasStructuredFinalAnswer: false,
  });
});

test("does not treat OpenCode JSON bookkeeping events as assistant text", () => {
  const stdout = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish" } }),
  ].join("\n");

  assert.deepEqual(parseOpenCodeRunOutput(stdout, "\n> build · claude-sonnet-5\n"), {
    finalText: null,
    errorText: null,
    statusText: "> build · claude-sonnet-5",
    hasStructuredFinalAnswer: false,
  });
});

test("keeps OpenCode stderr errors visible when no final text exists", () => {
  assert.deepEqual(parseOpenCodeRunOutput("", "\n> build · claude-sonnet-5\nprovider failed\n"), {
    finalText: null,
    errorText: "provider failed",
    statusText: "> build · claude-sonnet-5",
    hasStructuredFinalAnswer: false,
  });
});

test("keeps OpenCode JSON error events visible when no final text exists", () => {
  const stdout = JSON.stringify({
    type: "error",
    error: {
      data: {
        message: "访问被拒绝",
        responseBody: "{\"error\":{\"type\":\"access_denied\"}}",
      },
    },
  });

  assert.deepEqual(parseOpenCodeRunOutput(stdout, ""), {
    finalText: null,
    errorText: "访问被拒绝\naccess_denied",
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});

test("keeps OpenCode UnknownError server ref visible", () => {
  const stdout = JSON.stringify({
    type: "error",
    timestamp: 1783589988844,
    sessionID: "ses_0b9c09683ffezGC7hbA525qyCt",
    error: {
      name: "UnknownError",
      data: {
        message: "Unexpected server error. Check server logs for details.",
        ref: "err_8e6c658e",
      },
    },
  });

  const output = parseOpenCodeRunOutput(stdout, "");
  assert.deepEqual(output, {
    finalText: null,
    errorText: "UnknownError\nUnexpected server error. Check server logs for details.\nerr_8e6c658e",
    statusText: null,
    hasStructuredFinalAnswer: false,
  });

  const message = buildOpenCodeRunFailureMessage(output, "CLI exit code: 1");
  assert.match(message, /UnknownError/);
  assert.match(message, /Unexpected server error\. Check server logs for details\./);
  assert.match(message, /err_8e6c658e/);
  assert.doesNotMatch(message, /CLI exit code/);
});

test("builds OpenCode final failure from provider JSON before exit code", () => {
  const output = parseOpenCodeRunOutput(
    JSON.stringify({
      type: "error",
      error: {
        name: "APIError",
        data: {
          message: "访问被拒绝",
          statusCode: 403,
          responseBody: "{\"error\":{\"code\":\"access_denied\"}}",
        },
      },
    }),
    "",
  );

  const message = buildOpenCodeRunFailureMessage(output, "CLI exit code: 1");
  assert.match(message, /APIError/);
  assert.match(message, /访问被拒绝/);
  assert.match(message, /403/);
  assert.match(message, /access_denied/);
  assert.doesNotMatch(message, /CLI exit code/);
});

test("builds OpenCode final failure from empty stdout and stderr fallback", () => {
  const output = parseOpenCodeRunOutput("", "");
  assert.deepEqual(output, {
    finalText: null,
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });

  const message = buildOpenCodeRunFailureMessage(output, "CLI exit code: 1");
  assert.equal(message, "CLI exit code: 1");
});

test("builds OpenCode final failure from empty output status before exit code", () => {
  const output = parseOpenCodeRunOutput("", "\n> build · claude-sonnet-5\n");

  const message = buildOpenCodeRunFailureMessage(output, "CLI exit code: 1");
  assert.match(message, /OpenCode exited successfully, but did not return an assistant answer/);
  assert.match(message, /> build · claude-sonnet-5/);
  assert.doesNotMatch(message, /CLI exit code/);
});

test("keeps OpenCode provider API details from JSON error events", () => {
  const stdout = JSON.stringify({
    type: "error",
    error: {
      name: "APIError",
      data: {
        message: "访问被拒绝 (request id: req-123)",
        statusCode: 403,
        responseBody: JSON.stringify({
          error: {
            message: "访问被拒绝 (request id: req-123)",
            type: "packy_api_error",
            code: "access_denied",
          },
        }),
        metadata: {
          url: "https://www.packyapi.com/v1/chat/completions",
        },
      },
    },
  });

  const output = parseOpenCodeRunOutput(stdout, "");
  assert.equal(output.finalText, null);
  assert.equal(output.statusText, null);
  assert.match(output.errorText ?? "", /APIError/);
  assert.match(output.errorText ?? "", /访问被拒绝/);
  assert.match(output.errorText ?? "", /403/);
  assert.match(output.errorText ?? "", /access_denied/);
  assert.match(output.errorText ?? "", /https:\/\/www\.packyapi\.com\/v1\/chat\/completions/);
});

test("detects OpenCode progress-only JSONL activity", () => {
  const stdout = [
    JSON.stringify({
      type: "step_start",
      sessionID: "ses_progress",
      part: { type: "step-start", sessionID: "ses_progress" },
    }),
    JSON.stringify({
      type: "tool_use",
      sessionID: "ses_progress",
      part: { type: "tool", tool: "read", state: { status: "completed" } },
    }),
  ].join("\n");

  assert.deepEqual(detectOpenCodeStreamActivity(stdout, ""), {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: false,
    hasProgress: true,
  });
});

test("disarms the OpenCode startup watchdog after the first JSONL activity", () => {
  assert.equal(
    resolveOpenCodeOneShotWatchdogTimeoutMs(false),
    OPENCODE_ONE_SHOT_STARTUP_TIMEOUT_MS,
  );

  const activity = detectOpenCodeStreamActivity(JSON.stringify({
    type: "step_start",
    sessionID: "ses_subagent",
    part: { type: "step-start", sessionID: "ses_subagent" },
  }), "");
  const hasActivity = activity.hasAssistantAnswer
    || activity.hasError
    || activity.hasStatus
    || activity.hasProgress;

  assert.equal(hasActivity, true);
  assert.equal(resolveOpenCodeOneShotWatchdogTimeoutMs(hasActivity), null);
});

test("tracks OpenCode stream activity incrementally across stdout and stderr chunks", () => {
  const tracker = createOpenCodeStreamActivityTracker();
  const progressEvent = JSON.stringify({
    type: "step_start",
    sessionID: "ses_incremental",
    part: { type: "step-start", sessionID: "ses_incremental" },
  });

  assert.deepEqual(tracker.updateStdout(progressEvent.slice(0, 18)), {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: false,
    hasProgress: false,
  });
  assert.deepEqual(tracker.updateStdout(`${progressEvent.slice(18)}\n`), {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: false,
    hasProgress: true,
  });
  assert.deepEqual(tracker.updateStderr("\u001b[0m\n> build \u00b7 claude-sonnet-5"), {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: true,
    hasProgress: true,
  });
  assert.deepEqual(tracker.updateStdout("plain progress"), {
    hasAssistantAnswer: true,
    hasError: false,
    hasStatus: true,
    hasProgress: true,
  });
});

test("detects OpenCode assistant and error activity through the incremental tracker", () => {
  const tracker = createOpenCodeStreamActivityTracker();
  const finalEvent = JSON.stringify({
    type: "text",
    sessionID: "ses_incremental_final",
    part: { type: "text", text: "[final_answer] done" },
  });
  const errorEvent = JSON.stringify({
    type: "error",
    error: { message: "provider failed" },
  });

  assert.equal(tracker.updateStdout(`${finalEvent}\n`).hasAssistantAnswer, true);
  assert.deepEqual(tracker.updateStdout(`${errorEvent}\n`), {
    hasAssistantAnswer: true,
    hasError: true,
    hasStatus: false,
    hasProgress: false,
  });
});

test("bounds the OpenCode incremental activity pending JSONL buffers", () => {
  const tracker = createOpenCodeStreamActivityTracker();
  const oversizedPartialJsonl = `{"type":"text","part":{"text":"${"x".repeat(OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES * 2)}`;

  tracker.updateStdout(oversizedPartialJsonl);
  tracker.updateStderr(`> ${"s".repeat(OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES * 2)}`);
  const pendingByteLengths = tracker.getPendingByteLengths();

  assert.ok(pendingByteLengths.stdout <= OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES);
  assert.ok(pendingByteLengths.stderr <= OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES);
});

test("detects OpenCode final answer activity from text events", () => {
  const stdout = JSON.stringify({
    type: "text",
    sessionID: "ses_final",
    part: {
      type: "text",
      text: "[final_answer] done",
    },
  });

  assert.deepEqual(detectOpenCodeStreamActivity(stdout, ""), {
    hasAssistantAnswer: true,
    hasError: false,
    hasStatus: false,
    hasProgress: false,
  });
});

test("formats OpenCode JSONL tool events for visible trace bubbles", () => {
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "tool_use",
    sessionID: "ses_visible",
    part: {
      type: "tool",
      tool: "read",
      state: { status: "completed", title: "src/extension.ts" },
    },
  })), [{
    kind: "tool-use",
    content: "tool read\nstatus: completed\nsrc/extension.ts",
  }]);
});

test("extracts OpenCode todowrite tasks while preserving the tool trace bubble", () => {
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "tool_use",
    sessionID: "ses_visible",
    part: {
      type: "tool",
      tool: "todowrite",
      state: {
        status: "completed",
        title: "3 todos",
        input: {
          todos: [
            { content: "检查日志", status: "completed", priority: "high" },
            { content: "实现解析", status: "in_progress", priority: "high" },
            { content: "运行测试", status: "pending", priority: "high" },
          ],
        },
      },
    },
  })), [{
    kind: "tool-use",
    content: "tool todowrite\nstatus: completed\n3 todos",
    taskListItems: [
      { text: "检查日志", done: true },
      { text: "实现解析", done: false },
      { text: "运行测试", done: false },
    ],
  }]);

  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "tool_use",
    part: {
      type: "tool",
      tool: "todo_write",
      state: { status: "completed", title: "0 todos", input: { todos: [] } },
    },
  })), [{
    kind: "tool-use",
    content: "tool todo_write\nstatus: completed\n0 todos",
    taskListItems: [],
  }]);
});

test("forwards parsed OpenCode visible events to the matching conversation tab", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const handlerStart = extensionSource.indexOf("function appendOpenCodeVisibleEvent");
  const handlerEnd = extensionSource.indexOf("function appendSystemMessage", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handlerSource = extensionSource.slice(handlerStart, handlerEnd);

  assert.match(handlerSource, /Array\.isArray\(event\.taskListItems\)/);
  assert.match(handlerSource, /sendOpenCodeTaskListUpdate\(event\.taskListItems,[\s\S]*primary-stream/);
  assert.match(handlerSource, /appendTraceMessage\(event\.content,[\s\S]*taskListItems: event\.taskListItems/);
  assert.match(
    extensionSource,
    /consumeOpenCodeTabStreamChunk\([\s\S]*applyOpenCodeTabStreamActions\(streamResult\.actions\)/,
  );
  assert.match(
    extensionSource,
    /action\.type === "task-list-update"[\s\S]*sendOpenCodeTaskListUpdate\(action\.items,[\s\S]*tabId: target\.tabId/,
  );
  assert.match(
    extensionSource,
    /action\.type === "append-trace"[\s\S]*appendParallelTrace\(action\.content, action\.taskListItems\)/,
  );
  assert.match(
    extensionSource,
    /action\.type === "append-assistant-message"[\s\S]*appendMessage[\s\S]*tabId: target\.tabId/,
  );
  assert.match(
    extensionSource,
    /type: "assistantDelta"[\s\S]*tabId: target\.tabId/,
  );
  assert.match(
    extensionSource,
    /latestOpenCodeTaskListByTabId\.set\(tabId, normalizedItems\)[\s\S]*opencode-task-list-forwarded/,
  );
  assert.match(
    extensionSource,
    /function clearTaskListForRunStart\([\s\S]*latestOpenCodeTaskListByTabId\.delete\(normalizedTabId\)[\s\S]*type: "taskListUpdate"[\s\S]*items: \[\][\s\S]*tabId: normalizedTabId/,
  );
  assert.match(
    extensionSource,
    /function sendRunStatusForTab\([\s\S]*status === "start"[\s\S]*clearTaskListForRunStart\(tabId\)[\s\S]*type: "runStatus"/,
  );
  assert.match(
    extensionSource,
    /function sendRunStatus\([\s\S]*status === "start"[\s\S]*clearTaskListForRunStart\(activeTabIdForRun\)[\s\S]*type: "runStatus"/,
  );
  assert.match(
    extensionSource,
    /function postPanelState\([\s\S]*viewProvider\?\.postState\(state\);[\s\S]*replayOpenCodeTaskLists\(\)/,
  );
});

test("one-shot OpenCode activity detection uses incremental tracker state", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const oneShotStart = extensionSource.indexOf("async function runPromptOneShot");
  const oneShotEnd = extensionSource.indexOf("function appendTraceMessage", oneShotStart);
  assert.ok(oneShotStart >= 0 && oneShotEnd > oneShotStart);
  const oneShotSource = extensionSource.slice(oneShotStart, oneShotEnd);

  assert.match(oneShotSource, /const openCodeActivityTracker = createOpenCodeStreamActivityTracker\(\)/);
  assert.match(oneShotSource, /openCodeActivityTracker\.snapshot\(\)/);
  assert.match(oneShotSource, /openCodeActivityTracker\.updateStdout\(chunk\)/);
  assert.match(oneShotSource, /openCodeActivityTracker\.updateStderr\(chunk\)/);
  assert.match(oneShotSource, /openCodeActivityTracker\.flush\(\)/);
  assert.doesNotMatch(oneShotSource, /detectOpenCodeStreamActivity\(rawStdout, rawStderr\)/);
});

test("OpenCode host raw stdout and stderr caches remain bounded in all run modes", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const parallelStart = extensionSource.indexOf("async function runPromptParallel");
  const oneShotStart = extensionSource.indexOf("async function runPromptOneShot");
  const interactiveStart = extensionSource.indexOf("async function runPromptInteractive");
  assert.ok(parallelStart >= 0 && oneShotStart > parallelStart && interactiveStart > oneShotStart);

  const parallelSource = extensionSource.slice(parallelStart, oneShotStart);
  const oneShotSource = extensionSource.slice(oneShotStart, interactiveStart);
  const interactiveSource = extensionSource.slice(interactiveStart);

  for (const source of [parallelSource, oneShotSource, interactiveSource]) {
    assert.match(source, /rawStdout = appendBoundedUtf8Text\(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES\)\.text/);
  }
  assert.match(parallelSource, /rawStderr = appendBoundedUtf8Text\(rawStderr, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES\)\.text/);
  assert.match(oneShotSource, /rawStderr = appendBoundedUtf8Text\(rawStderr, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES\)\.text/);
  assert.match(interactiveSource, /rawStderr = appendBoundedUtf8Text\(rawStderr, normalized, AI_TASK_RAW_OUTPUT_MAX_BYTES\)\.text/);
  assert.match(extensionSource, /const OPENCODE_JSONL_PENDING_LINE_MAX_BYTES = 64 \* 1024/);
});

test("wires subagent event monitoring and 60-second polling into both OpenCode run paths", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const connectionFactories = extensionSource.match(/resolveOpenCodeSubagentConnection\(getCliArgs\("opencode"\)/g) ?? [];
  const monitorFactories = extensionSource.match(/createOpenCodeSubagentMonitor\(\{/g) ?? [];
  const serverUrls = extensionSource.match(/openCodeServerUrl: subagentRuntime\.connection\?\.serverUrl/g) ?? [];
  const progressUpdates = extensionSource.match(/subagentProgress\.update\(update\)/g) ?? [];
  const localizedMessages = extensionSource.match(/t\("run\.openCodeSubagentPollEmpty"\)/g) ?? [];

  assert.equal(connectionFactories.length, 1);
  assert.equal(monitorFactories.length, 2);
  assert.equal(serverUrls.length, 2);
  assert.equal(progressUpdates.length, 2);
  assert.equal(localizedMessages.length, 2);
  assert.match(extensionSource, /startOpenCodeServer\(connection\.serverPort/);
  assert.match(extensionSource, /waitForOpenCodeServerReady\(connection, directory\)/);
  assert.match(extensionSource, /runPrompt-parallel-subagent-poll-empty[\s\S]*pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS/);
  assert.match(extensionSource, /runPrompt-one-shot-subagent-poll-empty[\s\S]*pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS/);
  assert.match(
    extensionSource,
    /silentProgressNoticeShown = true;[\s\S]*activeAssistantMessageId: null,[\s\S]*activeAssistantKind: null/,
  );
  assert.match(
    extensionSource,
    /silentProgressNoticeShown = true;[\s\S]*activeAssistantMessageId = undefined;[\s\S]*activeMessageIndex = null/,
  );
});

test("uses structured OpenCode final events in both successful completion paths", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const structuredFinalChecks = extensionSource.match(
    /observedFinalAnswer:\s*openCodeOutput\.hasStructuredFinalAnswer/g,
  ) ?? [];
  const successfulExitOutcomeChecks = extensionSource.match(
    /resolveOpenCodeSuccessfulExitOutcome\(\{/g,
  ) ?? [];

  assert.equal(structuredFinalChecks.length, 2);
  assert.equal(successfulExitOutcomeChecks.length, 2);
});

test("wires one fresh-session recovery into both Loop OpenCode run paths", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const sessionTabsSource = fs.readFileSync(path.join(process.cwd(), "src", "extensionHost", "sessionTabs.ts"), "utf8");
  const recoverySelectors = extensionSource.match(
    /shouldRecoverOpenCodeLoopMainSessionInFreshSession\(\{/g,
  ) ?? [];
  const queuedRecoveryMessages = extensionSource.match(
    /run\.openCodeLoopFreshSessionRecoveryQueued/g,
  ) ?? [];
  const recoveryAdoptions = extensionSource.match(
    /adoptFreshOpenCodeLoopRecoverySession\(\{/g,
  ) ?? [];
  const freshSessionArguments = extensionSource.match(
    /isFreshSessionRecoveryAttempt\s*\?\s*null/g,
  ) ?? [];

  assert.equal(recoverySelectors.length, 2);
  assert.equal(queuedRecoveryMessages.length, 2);
  assert.equal(recoveryAdoptions.length, 2);
  assert.equal(freshSessionArguments.length, 2);
  assert.match(sessionTabsSource, /function adoptFreshOpenCodeLoopRecoverySession\([\s\S]*bindLoopTaskToSession\(options\.loopTaskId, sessionId\)/);
});

test("formats OpenCode JSONL text and reasoning events for visible bubbles", () => {
  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "text",
    sessionID: "ses_visible",
    part: { type: "text", text: "开始检查日志。\n" },
  })), [{
    kind: "assistant",
    content: "开始检查日志。\n",
  }]);

  assert.deepEqual(parseOpenCodeVisibleStreamEvents(JSON.stringify({
    type: "reasoning_delta",
    sessionID: "ses_visible",
    part: { type: "reasoning-delta", text: "需要先确认事件类型" },
  })), [{
    kind: "thinking",
    content: "thinking\n需要先确认事件类型",
  }]);
});

test("splits OpenCode thinking wrappers from mixed assistant text without showing tags", () => {
  const stdout = JSON.stringify({
    type: "text",
    sessionID: "ses_tagged_thinking",
    part: {
      type: "text",
      text: "<thinking>**Mapping execution flow**</thinking>\n继续检查运行链路。",
    },
  });

  assert.deepEqual(parseOpenCodeVisibleStreamEvents(stdout), [
    { kind: "thinking", content: "thinking\n**Mapping execution flow**" },
    { kind: "assistant", content: "\n继续检查运行链路。" },
  ]);
  assert.deepEqual(parseOpenCodeRunOutput(stdout, ""), {
    finalText: "继续检查运行链路。",
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});

test("treats a tagged OpenCode thinking-only text event as progress, not an assistant answer", () => {
  const stdout = JSON.stringify({
    type: "text",
    sessionID: "ses_tagged_thinking",
    part: { type: "text", text: "<thinking>Inspecting tests</thinking>" },
  });

  assert.deepEqual(detectOpenCodeStreamActivity(stdout, ""), {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: false,
    hasProgress: true,
  });
});

test("deduplicates OpenCode JSON and stderr error text", () => {
  const stdout = JSON.stringify({
    type: "error",
    error: {
      name: "APIError",
      data: {
        message: "访问被拒绝",
        statusCode: 403,
        responseBody: "{\"error\":{\"code\":\"access_denied\"}}",
      },
    },
  });
  const stderr = "访问被拒绝\naccess_denied\n";

  assert.deepEqual(parseOpenCodeRunOutput(stdout, stderr), {
    finalText: null,
    errorText: "APIError\n访问被拒绝\n403\naccess_denied",
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});

test("falls back to plain stdout when OpenCode emits non-JSON text", () => {
  assert.deepEqual(parseOpenCodeRunOutput("plain final answer\n", ""), {
    finalText: "plain final answer",
    errorText: null,
    statusText: null,
    hasStructuredFinalAnswer: false,
  });
});
