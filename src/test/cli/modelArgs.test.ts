import test = require("node:test");
import assert = require("node:assert/strict");

import {
  applyModelArg,
  readModelArg,
  resolveOpenCodeModelForConfig,
  stripModelArgs,
  supportsCliManagedModelSelection,
} from "../../cli/modelArgs";

const openCodeConfigContent = JSON.stringify({
  model: "myprovider/main-model",
  provider: {
    myprovider: { models: { "main-model": {}, "other-model": {} } },
    other: { models: { "cross-provider-model": {} } },
  },
});

test("Claude keeps configured args unchanged even when the webview passes a selected model", () => {
  assert.equal(supportsCliManagedModelSelection("claude"), false);
  assert.deepEqual(
    applyModelArg("claude", ["--dangerously-skip-permissions", "--model", "claude-opus"], "claude-sonnet-4"),
    ["--dangerously-skip-permissions", "--model", "claude-opus"]
  );
});

test("Codex still injects the selected model into CLI args", () => {
  assert.equal(supportsCliManagedModelSelection("codex"), true);
  assert.deepEqual(
    applyModelArg("codex", ["--dangerously-bypass-approvals-and-sandbox", "--model", "old-model"], "gpt-5-codex"),
    ["--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5-codex"]
  );
});

test("OpenCode reads model args from long, short, and inline forms", () => {
  assert.equal(supportsCliManagedModelSelection("opencode"), true);
  assert.equal(readModelArg("opencode", ["--model", "kimi-k2"]), "kimi-k2");
  assert.equal(readModelArg("opencode", ["-m", "qwen3-coder"]), "qwen3-coder");
  assert.equal(readModelArg("opencode", ["--model=gpt-5"]), "gpt-5");
  assert.equal(readModelArg("opencode", ["-m=deepseek-v3.1"]), "deepseek-v3.1");
});

test("OpenCode strips existing model args before writing the selected model", () => {
  const args = [
    "--print",
    "--model",
    "old-model",
    "--mode",
    "build",
    "-m=older-model",
  ];

  assert.deepEqual(stripModelArgs("opencode", args), ["--print", "--mode", "build"]);
  assert.deepEqual(
    applyModelArg("opencode", args, "myprovider/other-model", { openCodeConfigContent }),
    ["--print", "--mode", "build", "--model", "myprovider/other-model"],
  );
});

test("OpenCode preserves official provider/model model ids", () => {
  assert.equal(readModelArg("opencode", ["--model", "myprovider/my-model-name"]), "myprovider/my-model-name");
  assert.equal(readModelArg("opencode", ["-m=myprovider/my-model-name"]), "myprovider/my-model-name");
  assert.deepEqual(
    applyModelArg("opencode", ["run", "--format", "json"], "myprovider/main-model", {
      openCodeConfigContent,
    }),
    ["run", "--format", "json", "--model", "myprovider/main-model"],
  );
});

test("OpenCode rejects bare and unavailable model overrides before CLI execution", () => {
  assert.throws(
    () => applyModelArg("opencode", ["run"], "main-model", { openCodeConfigContent }),
    /must be an exact provider\/model reference/
  );
  assert.throws(
    () => applyModelArg("opencode", ["run"], "myprovider/missing", { openCodeConfigContent }),
    /not an available model declared by the active config/
  );
  assert.deepEqual(
    resolveOpenCodeModelForConfig("other/cross-provider-model", openCodeConfigContent),
    { model: "other/cross-provider-model", error: null }
  );
});

test("OpenCode leaves args unchanged when no selected model is provided", () => {
  assert.deepEqual(
    applyModelArg("opencode", ["--print", "--model", "configured-model"], ""),
    ["--print", "--model", "configured-model"],
  );
});
