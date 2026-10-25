import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";
import { buildClaudePrompt } from "../../cli/claudeToolPolicy";

installVscodeMock();

const {
  createCliRunArgStrategies,
  buildCliArgs: buildCliArgsFromStrategy,
  applyOpenCodeVariantArg: applyOpenCodeVariantArgFromStrategy,
} = require("../../cli/cliRunArgStrategies") as typeof import("../../cli/cliRunArgStrategies");
const {
  applyOpenCodeVariantArg,
  buildCliArgs,
} = require("../../cli/commandRunner") as typeof import("../../cli/commandRunner");

type VscodeConfiguration = {
  get: <T>(key: string, fallback?: T) => T | undefined;
  inspect: <T>(key: string) => {
    workspaceFolderValue?: T;
    workspaceValue?: T;
    globalValue?: T;
  } | undefined;
};

function installConfiguration(values: Record<string, unknown>): () => void {
  const vscode = require("vscode") as {
    workspace: { getConfiguration: () => VscodeConfiguration };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] as T : fallback
    ),
    inspect: () => undefined,
  });
  return () => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  };
}

test("registers exactly the current CLI platforms", () => {
  const strategies = createCliRunArgStrategies();
  assert.deepEqual(Object.keys(strategies).sort(), ["claude", "codex", "dsh", "grok", "opencode"]);
  assert.equal(strategies.opencode.includeThinkingArgs, false);
  assert.equal(strategies.claude.includeThinkingArgs, true);
  assert.equal(strategies.codex.includeThinkingArgs, true);
  assert.equal(strategies.grok.includeThinkingArgs, true);
});

test("keeps the public arg builders exported from commandRunner", () => {
  assert.equal(buildCliArgs, buildCliArgsFromStrategy);
  assert.equal(applyOpenCodeVariantArg, applyOpenCodeVariantArgFromStrategy);
});

test("adds Claude tool fallback instructions to one-shot prompts only", () => {
  const args = buildCliArgs("claude", {}, "今天上海天气");
  assert.ok(args.at(-1)?.startsWith("今天上海天气\n\n"));
  assert.match(args.at(-1) ?? "", /不要使用 WebSearch 或 WebFetch/);
  assert.match(args.at(-1) ?? "", /直接执行这条 curl/);
  assert.deepEqual(buildCliArgs("claude", {}, "/compact 保留结果"), ["/compact 保留结果"]);
  assert.deepEqual(buildCliArgs("claude", {}, ""), []);
  assert.deepEqual(buildCliArgs("claude", {}), []);
  assert.deepEqual(buildCliArgs("grok", {}, "原始需求"), ["原始需求"]);
});

test("keeps strategy source free of runner, extension, workspace, and grok stdio helpers", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/cli/cliRunArgStrategies.ts"), "utf8");
  assert.equal(/from\s+["']\.\/commandRunner["']/.test(source), false);
  assert.equal(/from\s+["'][^"']*extension["']/.test(source), false);
  assert.equal(/vscode\.workspace/.test(source), false);
  assert.equal(/buildGrokAgentStdioArgs|getGrokCommand/.test(source), false);
  assert.equal(/\bclass\s/.test(source), false);
});

test("appends Grok --pure once and does not add --skip-git-repo-check", () => {
  assert.deepEqual(
    buildCliArgs("grok", {
      sessionId: "previous-session",
      isolateProjectInstructions: true,
      imagePaths: ["/tmp/ignored.png"],
    }, "continue"),
    ["--pure", "continue"],
  );

  const restoreConfiguration = installConfiguration({
    "args.grok": ["--pure"],
  });
  try {
    const args = buildCliArgs("grok", { isolateProjectInstructions: true }, "continue");
    assert.deepEqual(args, ["--pure", "continue"]);
    assert.equal(args.filter((arg) => arg === "--pure").length, 1);
    assert.equal(args.includes("--skip-git-repo-check"), false);
  } finally {
    restoreConfiguration();
  }

  const strategies = createCliRunArgStrategies();
  const isolated = strategies.grok.applyIsolation(["keep"]);
  isolated.push("mutated");
  assert.deepEqual(strategies.grok.applyIsolation(["keep"]), ["keep", "--pure"]);
  assert.deepEqual(
    strategies.grok.appendPrompt(["--pure"], { sessionId: "previous-session" }, "continue"),
    ["--pure", "continue"],
  );
  assert.deepEqual(strategies.grok.applyBeforePrompt(["--pure"], {}), ["--pure"]);
});

test("preserves Codex, Claude, and OpenCode argv examples", () => {
  assert.deepEqual(
    buildCliArgs("codex", {
      sessionId: "previous-session",
      isolateProjectInstructions: true,
      imagePaths: [" /tmp/diagram.png ", 42 as unknown as string, ""],
    }, "continue"),
    ["--ignore-rules", "--skip-git-repo-check", "--image", "/tmp/diagram.png", "continue"],
  );
  assert.deepEqual(buildCliArgs("codex", {}, "hello"), ["--skip-git-repo-check", "hello"]);
  assert.deepEqual(buildCliArgs("codex", {}, ""), ["--skip-git-repo-check"]);
  assert.deepEqual(
    buildCliArgs("claude", { sessionId: "previous-session", isolateProjectInstructions: true }, "continue"),
    ["--safe-mode", buildClaudePrompt("continue")],
  );
  assert.deepEqual(
    buildCliArgs("claude", { sessionId: "previous-session", imagePaths: ["/tmp/diagram.png"] }, "continue"),
    [buildClaudePrompt("continue")],
  );
  assert.deepEqual(buildCliArgs("opencode", {}), ["--auto"]);
  assert.deepEqual(
    buildCliArgs("opencode", { openCodeVariant: "  ", thinkingMode: "high" }, ""),
    ["--auto"],
  );

  const restoreConfiguration = installConfiguration({
    "args.opencode": ["run", "--pure"],
  });
  try {
    assert.deepEqual(
      buildCliArgs("opencode", { isolateProjectInstructions: true }, "prompt"),
      ["run", "--auto", "--format", "json", "--print-logs", "--pure", "prompt"],
    );
  } finally {
    restoreConfiguration();
  }
});

test("reads thinking args only for platforms that include them", () => {
  const reads: string[] = [];
  const vscode = require("vscode") as {
    workspace: { getConfiguration: () => VscodeConfiguration };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      reads.push(key);
      if (key === "thinkingArgs.opencode.high") {
        return ["--legacy-opencode-effort"] as T;
      }
      if (key === "thinkingArgs.codex.high") {
        return ["--codex-thinking"] as T;
      }
      if (key === "args.codex") {
        return ["--base"] as T;
      }
      if (key === "thinkingArgs.grok.high") {
        return ["--grok-thinking"] as T;
      }
      return fallback;
    },
    inspect: () => undefined,
  });
  try {
    assert.deepEqual(
      buildCliArgs("opencode", { thinkingMode: "high" }, "hello"),
      ["run", "--auto", "--format", "json", "--print-logs", "hello"],
    );
    assert.equal(reads.includes("thinkingArgs.opencode.high"), false);
    assert.deepEqual(
      buildCliArgs("codex", { thinkingMode: "high", model: "gpt", isolateProjectInstructions: true }, "go"),
      ["--base", "--codex-thinking", "--model", "gpt", "--ignore-rules", "--skip-git-repo-check", "go"],
    );
    assert.equal(reads.includes("thinkingArgs.codex.high"), true);
    assert.deepEqual(
      buildCliArgs("grok", { thinkingMode: "high", isolateProjectInstructions: true }, "go"),
      ["--grok-thinking", "--pure", "go"],
    );
    assert.equal(reads.includes("thinkingArgs.grok.high"), true);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  }
});

test("keeps an existing isolation flag without appending it twice", () => {
  const strategies = createCliRunArgStrategies();
  assert.deepEqual(strategies.codex.applyIsolation(["--ignore-rules"]), ["--ignore-rules"]);
  assert.deepEqual(strategies.claude.applyIsolation(["--safe-mode"]), ["--safe-mode"]);
  assert.deepEqual(strategies.opencode.applyIsolation(["run", "--pure"]), ["run", "--pure"]);
  assert.deepEqual(
    strategies.codex.applyBeforePrompt(["--skip-git-repo-check"], {}),
    ["--skip-git-repo-check"],
  );
  assert.deepEqual(
    strategies.opencode.applyBeforePrompt(["run", "--pure"], {}),
    ["run", "--auto", "--pure"],
  );
  assert.deepEqual(
    strategies.opencode.appendPrompt(["run", "--auto", "--pure"], { sessionId: "session-1" }, "prompt"),
    ["run", "--auto", "--format", "json", "--print-logs", "--pure", "--session", "session-1", "prompt"],
  );
});
