import test = require("node:test");
import assert = require("node:assert/strict");

import { applyModelArg, supportsCliManagedModelSelection } from "../cli/modelArgs";

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
