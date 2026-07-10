import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const {
  applyOpenCodeVariantArg,
  buildOpenCodeRunFailureMessage,
  buildCliArgs,
  parseOpenCodeRunOutput,
} = require("../cli/commandRunner") as typeof import("../cli/commandRunner");
const { isInteractiveSupported } = require("../cli/config") as typeof import("../cli/config");

test("does not route OpenCode through the unsupported interactive runner", () => {
  assert.equal(isInteractiveSupported("codex"), true);
  assert.equal(isInteractiveSupported("claude"), true);
  assert.equal(isInteractiveSupported("opencode"), false);
});

test("builds OpenCode run args with provider/model selection", () => {
  assert.deepEqual(
    buildCliArgs("opencode", { model: "packyapi/claude-sonnet-5" }, "hello"),
    ["run", "--format", "json", "--model", "packyapi/claude-sonnet-5", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("opencode", { model: "packyapi/claude-sonnet-5", sessionId: "session-1" }, "hello"),
    ["run", "--format", "json", "--model", "packyapi/claude-sonnet-5", "--session", "session-1", "hello"],
  );
});

test("adds only a valid non-default OpenCode variant", () => {
  assert.deepEqual(
    buildCliArgs("opencode", { model: "myAPI/model", openCodeVariant: "high" }, "hello"),
    ["run", "--format", "json", "--model", "myAPI/model", "--variant", "high", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("opencode", { model: "myAPI/model", openCodeVariant: null }, "hello"),
    ["run", "--format", "json", "--model", "myAPI/model", "hello"],
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
      ["run", "--format", "json", "hello"],
    );
    assert.deepEqual(
      buildCliArgs("codex", { thinkingMode: "high" }, "hello"),
      ["--codex-thinking", "--skip-git-repo-check", "hello"],
    );
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  }
});

test("builds OpenCode run args by qualifying bare model with active custom provider", () => {
  const openCodeConfigContent = JSON.stringify({
    model: "myAPI/gpt-5.5",
    provider: {
      myAPI: {
        models: {
          "gpt-5.5": {},
        },
      },
    },
  });

  assert.deepEqual(
    buildCliArgs("opencode", { model: "gpt-5.5", openCodeConfigContent }, "hello"),
    ["run", "--format", "json", "--model", "myAPI/gpt-5.5", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("opencode", { model: "myAPI/gpt-5.5", openCodeConfigContent }, "hello"),
    ["run", "--format", "json", "--model", "myAPI/gpt-5.5", "hello"],
  );
  assert.throws(
    () => buildCliArgs("opencode", { model: "glm-5.2", openCodeConfigContent }, "hello"),
    /not defined in active provider "myAPI"/,
  );
});

test("preserves explicit OpenCode output format args", () => {
  assert.deepEqual(
    buildCliArgs("opencode", {}, "hello"),
    ["run", "--format", "json", "hello"],
  );
  assert.deepEqual(
    buildCliArgs("opencode", { model: "packyapi/claude-sonnet-5" }, "hello"),
    ["run", "--format", "json", "--model", "packyapi/claude-sonnet-5", "hello"],
  );
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
  });
});

test("does not treat OpenCode status lines as assistant text", () => {
  assert.deepEqual(parseOpenCodeRunOutput("", "\u001b[0m\n> build · claude-sonnet-5\n\u001b[0m\n"), {
    finalText: null,
    errorText: null,
    statusText: "> build · claude-sonnet-5",
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
  });
});

test("keeps OpenCode stderr errors visible when no final text exists", () => {
  assert.deepEqual(parseOpenCodeRunOutput("", "\n> build · claude-sonnet-5\nprovider failed\n"), {
    finalText: null,
    errorText: "provider failed",
    statusText: "> build · claude-sonnet-5",
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
  });
});

test("falls back to plain stdout when OpenCode emits non-JSON text", () => {
  assert.deepEqual(parseOpenCodeRunOutput("plain final answer\n", ""), {
    finalText: "plain final answer",
    errorText: null,
    statusText: null,
  });
});
