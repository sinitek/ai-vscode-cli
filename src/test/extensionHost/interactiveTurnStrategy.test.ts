import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  createInteractiveTurnStrategies,
} = require("../../extensionHost/interactiveTurnStrategy") as typeof import("../../extensionHost/interactiveTurnStrategy");

test("interactive turn strategy registry is codex, claude, grok, and dsh", () => {
  const strategies = createInteractiveTurnStrategies();
  assert.deepEqual(Object.keys(strategies).sort(), ["claude", "codex", "dsh", "grok"]);
  assert.equal(Object.prototype.hasOwnProperty.call(strategies, "opencode"), false);
  assert.equal("opencode" in strategies, false);
  assert.equal(typeof strategies.codex.runAttempt, "function");
  assert.equal(typeof strategies.claude.runAttempt, "function");
  assert.equal(typeof strategies.grok.runAttempt, "function");
  assert.equal(typeof strategies.dsh.runAttempt, "function");
});
