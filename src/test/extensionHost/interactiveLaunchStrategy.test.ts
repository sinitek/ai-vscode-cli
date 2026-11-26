import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  createInteractiveLaunchStrategies,
  isInteractiveLaunchCli,
  resolveClaudeInteractiveEntrypoint,
  resolvePromptExecutionMode,
  supportsInteractiveLaunch,
} = require("../../extensionHost/interactiveLaunchStrategy") as typeof import("../../extensionHost/interactiveLaunchStrategy");

const input = {
  requestedModel: "requested-model",
  selectedModel: "selected-model",
  thinkingMode: "off" as const,
  interactiveMode: "coding" as const,
  imagePaths: ["/tmp/prompt.png"],
  sessionId: null,
  tabId: "tab-1",
};

test("launch registry is exhaustive for interactive CLIs and excludes OpenCode", async () => {
  const resolved: string[] = [];
  const strategies = createInteractiveLaunchStrategies({
    getEffectiveCliArgs: (cli) => [`configured-${cli}`],
    resolveGrokModelForRun: async (model) => { resolved.push(`grok:${model}`); return "grok-wire"; },
    resolveDshModelWireForRun: async (model) => { resolved.push(`dsh:${model}`); return "dsh-wire"; },
    prepareDshInteractiveLaunch: async () => ({ agentArgs: ["--dsh"], env: { DSH: "1" }, isolatedHome: "/tmp/dsh" }),
    resolveKimiModelWireForRun: async (model) => { resolved.push(`kimi:${model}`); return "kimi-wire"; },
    prepareKimiInteractiveLaunch: async () => ({ agentArgs: ["--kimi"], env: { KIMI: "1" }, modeId: "coding", modelAlias: "kimi-wire", thinkingValue: null }),
    resolveZcodeModelWireForRun: async (model) => { resolved.push(`zcode:${model}`); return "zcode-wire"; },
    prepareZcodeInteractiveLaunch: async () => ({ agentArgs: ["--zcode"], env: { ZCODE: "1" }, modeId: "yolo", modelRef: "zcode-wire", thinkingValue: null }),
  });
  assert.deepEqual(Object.keys(strategies).sort(), ["claude", "codex", "dsh", "grok", "kimi-code", "zcode"]);
  assert.equal(isInteractiveLaunchCli("opencode", strategies), false);
  assert.deepEqual(await strategies.codex.prepare(input), {
    cli: "codex", command: "codex", commandForRunner: "codex", args: ["--model", "selected-model", "--skip-git-repo-check", "--image", "/tmp/prompt.png"],
  });
  const claude = await strategies.claude.prepare(input);
  assert.equal(claude.cli, "claude");
  assert.equal(typeof claude.command, "string");
  assert.deepEqual(claude.args, ["configured-claude"]);
  assert.equal(claude.commandForRunner, claude.claudeEntrypoint);
  assert.equal(claude.startupLog?.entrypoint, claude.claudeEntrypoint);
  assert.equal(claude.startupLog?.execPath, process.execPath);
  const grokModel = await strategies.grok.resolveModel?.(input.requestedModel);
  const grok = await strategies.grok.prepare({ ...input, selectedModel: grokModel ?? input.selectedModel });
  assert.equal(grok.cli, "grok");
  assert.deepEqual(grok.grokAgentArgs, []);
  assert.equal(grok.args.includes("grok-wire"), true);
  const dsh = await strategies.dsh.prepare(input);
  assert.deepEqual(dsh.args, ["--dsh"]);
  assert.equal(dsh.dshModelWire, "dsh-wire");
  const kimi = await strategies["kimi-code"].prepare(input);
  assert.deepEqual(kimi.args, ["--kimi"]);
  assert.equal(kimi.kimiModelWire, "kimi-wire");
  const zcode = await strategies.zcode.prepare(input);
  assert.deepEqual(zcode.args, ["--zcode"]);
  assert.equal(zcode.zcodeModelWire, "zcode-wire");
  assert.deepEqual(resolved, ["grok:requested-model", "dsh:requested-model", "kimi:requested-model", "zcode:requested-model"]);
});

test("Claude bundled entrypoint is selected only for Windows cmd and bat commands", () => {
  let bundledLookups = 0;
  const lookup = () => { bundledLookups += 1; return "/sdk/cli.js"; };
  assert.equal(resolveClaudeInteractiveEntrypoint("C:\\tools\\claude.CMD", "win32", lookup), "/sdk/cli.js");
  assert.equal(resolveClaudeInteractiveEntrypoint("claude.bat", "win32", lookup), "/sdk/cli.js");
  assert.equal(resolveClaudeInteractiveEntrypoint("claude.exe", "win32", lookup), "claude.exe");
  assert.equal(resolveClaudeInteractiveEntrypoint("claude.cmd", "darwin", lookup), "claude.cmd");
  assert.equal(resolveClaudeInteractiveEntrypoint(undefined, "win32", lookup), undefined);
  assert.equal(bundledLookups, 2);
});

test("production prompt route helper preserves first-main and OpenCode mode reachability", () => {
  for (const cli of ["codex", "claude", "grok", "dsh", "kimi-code", "zcode"] as const) {
    assert.equal(supportsInteractiveLaunch(cli), true);
    assert.equal(resolvePromptExecutionMode(cli, true), "interactive");
    assert.equal(resolvePromptExecutionMode(cli, false, true), "interactive");
  }
  assert.equal(supportsInteractiveLaunch("opencode"), false);
  assert.equal(resolvePromptExecutionMode("opencode", false), "one-shot");
  assert.equal(resolvePromptExecutionMode("opencode", true), "parallel");
  assert.throws(() => resolvePromptExecutionMode("opencode", false, true), /First main run requires interactive execution/);
});
