import test = require("node:test");
import assert = require("node:assert/strict");
import { CLI_LIST, CliName } from "../../cli/types";
import {
  canHostContextCompaction,
  CLI_EXECUTION_POLICY,
  isAutomaticContextCompactionCandidate,
  isInteractiveCli,
  selectCliExecutionMode,
} from "../../cli/cliExecutionPolicy";

test("execution policy exhaustively preserves all seven CLI capabilities", () => {
  assert.deepEqual(Object.keys(CLI_EXECUTION_POLICY).sort(), [...CLI_LIST].sort());
  const interactive = ["codex", "claude", "grok", "dsh", "kimi-code", "zcode"];
  const automaticCompaction = ["codex", "claude", "opencode", "grok", "kimi-code", "zcode"];
  for (const cli of CLI_LIST) {
    assert.equal(isInteractiveCli(cli), interactive.includes(cli), cli);
    assert.equal(isAutomaticContextCompactionCandidate(cli), automaticCompaction.includes(cli), cli);
    assert.equal(canHostContextCompaction(cli, true), automaticCompaction.includes(cli), cli);
  }
});

test("OpenCode remains a compaction candidate but requires an interactive host", () => {
  assert.equal(isAutomaticContextCompactionCandidate("opencode"), true);
  assert.equal(canHostContextCompaction("opencode", false), false);
  assert.equal(canHostContextCompaction("opencode", true), true);
  assert.equal(isInteractiveCli("opencode"), false);
});

test("invalid compaction candidate values fail closed", () => {
  for (const value of ["", "gemini", "unknown", "dsh"]) {
    assert.equal(isAutomaticContextCompactionCandidate(value), false, value);
  }
});

test("execution mode selection preserves interactive, parallel, one-shot and first-main-run constraints", () => {
  const select = (cli: CliName, hasOtherTabRun: boolean, firstMainRun = false) =>
    selectCliExecutionMode(cli, { hasOtherTabRun, firstMainRun });
  for (const cli of ["codex", "claude", "grok", "dsh", "kimi-code", "zcode"] as const) {
    assert.equal(select(cli, false), "interactive");
    assert.equal(select(cli, true), "interactive");
    assert.equal(select(cli, false, true), "interactive");
  }
  assert.equal(select("opencode", false), "one-shot");
  assert.equal(select("opencode", true), "parallel");
  assert.throws(() => select("opencode", false, true), /requires interactive execution/);
});
