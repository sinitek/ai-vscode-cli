import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test = require("node:test");
import { CLI_LIST, GROK_CLI, mapThinkingModeToGrokEffort } from "../../cli/types";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { inspectGrokCommandResolution } = require("../../cli/cliCommandRepair") as typeof import("../../cli/cliCommandRepair");
const { buildGrokAgentStdioArgs, getGrokAgentArgs, getGrokCommand } = require("../../cli/config") as typeof import("../../cli/config");

test("appends grok after the existing CLI enum and builds the official stdio command", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf8")) as {
    contributes: { configuration: { properties: Record<string, { enum?: string[]; default?: unknown }> } };
  };
  const properties = manifest.contributes.configuration.properties;
  assert.deepEqual(properties["sinitek-cli-tools.defaultCli"].enum, ["codex", "claude", "opencode", "grok", "dsh", "kimi-code"]);
  assert.deepEqual(CLI_LIST, ["codex", "claude", "opencode", "grok", "dsh", "kimi-code"]);
  assert.equal(GROK_CLI, "grok");
  assert.equal(CLI_LIST.indexOf("grok"), 3);
  assert.equal(CLI_LIST[CLI_LIST.indexOf("grok") + 1], "dsh");
  assert.equal(CLI_LIST.filter((cli) => cli === "grok").length, 1);
  assert.equal((CLI_LIST as readonly string[]).includes("gemini"), false);
  const defaultArgv = ["--no-auto-update", "--permission-mode", "bypassPermissions", "agent", "stdio"];
  assert.deepEqual(buildGrokAgentStdioArgs(["--always-approve"]), defaultArgv);
  assert.deepEqual(buildGrokAgentStdioArgs(getGrokAgentArgs()), defaultArgv);
  assert.equal(defaultArgv.includes("--always-approve"), false);
  assert.equal(properties["sinitek-cli-tools.commands.grok"].default, "grok");
  assert.deepEqual(properties["sinitek-cli-tools.args.grok"].default, ["--always-approve"]);
  assert.equal(getGrokCommand(), "grok");
  assert.deepEqual(getGrokAgentArgs(), []);
  assert.equal(mapThinkingModeToGrokEffort("xhigh"), "xhigh");
  assert.equal(mapThinkingModeToGrokEffort("off"), "none");
  assert.equal(mapThinkingModeToGrokEffort("on"), "medium");
  assert.equal(mapThinkingModeToGrokEffort("ultra"), "max");
  const { getWebviewHtml } = require("../../webview/viewContent") as typeof import("../../webview/viewContent");
  const html = getWebviewHtml({ cspSource: "vscode-resource://grok" });
  const select = html.match(/<select id="currentCli"[^>]*>(.*?)<\/select>/);
  assert.equal(
    select?.[1],
    '<option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option><option value="grok">Grok</option><option value="dsh">DSH</option><option value="kimi-code">KimiCode</option>',
  );
  assert.match(html, /const CLI_NAMES = \["codex","claude","opencode","grok","dsh","kimi-code"\]/);
  const grokSelectIds = [
    "currentCli",
    "codexLoopSubtaskCliSelect",
    "openCodeLoopSubtaskCliSelect",
    "claudeLoopSubtaskCliSelect",
    "rulesLoadCli",
  ];
  for (const id of grokSelectIds) {
    const block = html.match(new RegExp(`<select id="${id}"[^>]*>[\\s\\S]*?<\\/select>`));
    assert.ok(block, id);
    assert.equal((block[0].match(/<option value="grok">/g) ?? []).length, 1, id);
  }
  assert.equal((html.match(/<option value="grok">/g) ?? []).length, grokSelectIds.length);
});

test("keeps an empty Grok agent argument list between agent and stdio", () => {
  const defaultArgv = ["--no-auto-update", "--permission-mode", "bypassPermissions", "agent", "stdio"];
  assert.deepEqual(buildGrokAgentStdioArgs([]), defaultArgv);
  assert.deepEqual(buildGrokAgentStdioArgs(["", "   "]), defaultArgv);
  const resolved = inspectGrokCommandResolution("   ");
  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    return;
  }
  assert.equal(resolved.reason, "empty");
});

test("strips borrowed approval bypass flags and reports a missing grok command", () => {
  assert.deepEqual(
    buildGrokAgentStdioArgs([
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-skip-permissions",
      "--always-approve",
      "--yolo",
      "--permission-mode",
      "plan",
      "--permission-mode=default",
      "--keep",
    ]),
    ["--no-auto-update", "--permission-mode", "bypassPermissions", "agent", "--keep", "stdio"],
  );
  assert.deepEqual(
    buildGrokAgentStdioArgs(["--keep", "--model", "old", "-m", "older", "--model=inline"], " grok-4 "),
    ["--no-auto-update", "--permission-mode", "bypassPermissions", "agent", "--keep", "--model", "grok-4", "stdio"],
  );
  assert.deepEqual(
    buildGrokAgentStdioArgs(["--keep", "--model", "old"], ""),
    ["--no-auto-update", "--permission-mode", "bypassPermissions", "agent", "--keep", "stdio"],
  );
  assert.equal(mapThinkingModeToGrokEffort(""), null);
  assert.equal(mapThinkingModeToGrokEffort("ultra-raw"), null);
  const missing = inspectGrokCommandResolution("grok-does-not-exist-sinitek");
  assert.equal(missing.ok, false);
  if (missing.ok) {
    return;
  }
  assert.equal(missing.reason, "enoent");
  assert.equal(missing.summary, "spawn grok-does-not-exist-sinitek ENOENT");
  const executable = path.join(os.tmpdir(), `grok-resolvable-${process.pid}`);
  fs.writeFileSync(executable, "");
  fs.chmodSync(executable, 0o755);
  try {
    const resolved = inspectGrokCommandResolution(executable);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.command, executable);
    }
  } finally {
    fs.rmSync(executable, { force: true });
  }
});
