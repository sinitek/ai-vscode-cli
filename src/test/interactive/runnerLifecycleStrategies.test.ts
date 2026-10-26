import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { CodexInteractiveRunner } = require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
const { ClaudeInteractiveRunner } = require("../../interactive/claudeRunner") as typeof import("../../interactive/claudeRunner");
const { GrokInteractiveRunner } = require("../../interactive/grokRunner") as typeof import("../../interactive/grokRunner");
const { DshInteractiveRunner } = require("../../interactive/dshRunner") as typeof import("../../interactive/dshRunner");
const {
  claudeRunnerLifecycleStrategy,
  codexRunnerLifecycleStrategy,
  dshRunnerLifecycleStrategy,
  grokRunnerLifecycleStrategy,
  runnerLifecycleStrategies,
  stopManagedRunner,
} = require("../../interactive/runnerLifecycleStrategies") as typeof import("../../interactive/runnerLifecycleStrategies");

type CodexRunner = InstanceType<typeof CodexInteractiveRunner>;
type CodexOptions = Parameters<typeof codexRunnerLifecycleStrategy.prepare>[0];
type ClaudeOptions = Parameters<typeof claudeRunnerLifecycleStrategy.prepare>[0];
type GrokOptions = Parameters<typeof grokRunnerLifecycleStrategy.prepare>[0];

function codexOptions(overrides: Partial<CodexOptions> = {}): CodexOptions {
  return {
    sessionId: "  sid  ",
    threadId: "thread-a",
    command: "codex",
    args: ["--a"],
    cwd: "/workspace",
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: "gpt-5.5",
    configId: "config-a",
    ...overrides,
  };
}

function claudeOptions(overrides: Partial<ClaudeOptions> = {}): ClaudeOptions {
  return {
    sessionId: "session-claude",
    mappedSessionId: null,
    command: "claude",
    args: ["--a"],
    cwd: "/workspace",
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: "sonnet",
    entrypoint: "/bin/claude",
    isolateProjectInstructions: false,
    ...overrides,
  };
}

function grokOptions(sessionId = "session-grok", overrides: Partial<GrokOptions> = {}): GrokOptions {
  return {
    sessionId,
    command: "grok",
    agentArgs: ["--keep"],
    cwd: "/workspace",
    thinkingMode: "high",
    interactiveMode: "coding",
    model: "grok-4",
    localSessionId: "local-1",
    ...overrides,
  };
}

test("lifecycle strategy modules do not import the manager facade", () => {
  for (const relativePath of [
    "src/interactive/runnerLifecycleStrategies.ts",
    "src/interactive/runnerLifecycleTypes.ts",
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.equal(/from\s+["']\.\/manager["']|require\(\s*["']\.\/manager["']\s*\)/.test(source), false);
  }
  assert.equal(runnerLifecycleStrategies.codex.cli, "codex");
  assert.equal(runnerLifecycleStrategies.claude.cli, "claude");
  assert.equal(runnerLifecycleStrategies.grok.cli, "grok");
  assert.equal(runnerLifecycleStrategies.dsh.cli, "dsh");
});

test("Codex strategy normalizes selection without trimming the session or rebuilding on model", () => {
  const options = codexOptions({ model: "  gpt-5.5  ", configId: "  config-a  " });
  const prepared = codexRunnerLifecycleStrategy.prepare(options);
  assert.equal(prepared.sessionId, "  sid  ");
  assert.deepEqual(prepared.selection, { configId: "config-a", model: "gpt-5.5" });
  const runner = codexRunnerLifecycleStrategy.createRunner(prepared);
  try {
    assert.equal(runner.getThreadId(), "thread-a");
    const entry = {
      ...codexRunnerLifecycleStrategy.createRegistration(prepared, runner),
      idleTimer: null,
      lastUsedAt: 0,
    };
    assert.notEqual(entry.args, options.args);
    const changed = codexRunnerLifecycleStrategy.prepare(codexOptions({
      model: "gpt-5.6",
      threadId: null,
      thinkingMode: "high",
      interactiveMode: "plan",
      args: ["--b"],
    }));
    assert.equal(codexRunnerLifecycleStrategy.canReuse(entry, changed), true);
    assert.equal(codexRunnerLifecycleStrategy.canReuse(entry, codexRunnerLifecycleStrategy.prepare(codexOptions({
      command: "other",
    }))), false);
    assert.equal(codexRunnerLifecycleStrategy.canReuse(entry, codexRunnerLifecycleStrategy.prepare(codexOptions({
      cwd: "C:/repo",
    }))), false);
    assert.equal(codexRunnerLifecycleStrategy.canReuse(entry, codexRunnerLifecycleStrategy.prepare(codexOptions({
      configId: "config-b",
    }))), false);

    const calls: Array<Parameters<CodexRunner["updateOptions"]>[0]> = [];
    const original = runner.updateOptions.bind(runner);
    runner.updateOptions = (next) => {
      calls.push(next);
      original(next);
    };
    codexRunnerLifecycleStrategy.applyReuse(entry, changed);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "gpt-5.6");
    assert.equal(calls[0].threadId, null);
    assert.equal(calls[0].args, changed.options.args);
    assert.equal(runner.getThreadId(), "thread-a");
    assert.deepEqual(codexRunnerLifecycleStrategy.readSelection(entry), {
      configId: "config-a",
      model: "gpt-5.6",
    });

    codexRunnerLifecycleStrategy.applySetMetadata(entry, {
      sessionId: "  sid  ",
      runner,
      thinkingMode: "low",
      interactiveMode: "coding",
      model: "   ",
      options: {},
    });
    assert.equal(entry.command, undefined);
    assert.equal(entry.cwd, undefined);
    assert.deepEqual(entry.args, []);
    assert.deepEqual(codexRunnerLifecycleStrategy.readSelection(entry), { configId: null, model: null });
    assert.equal(calls.length, 1);
  } finally {
    runner.dispose();
  }
});

test("Claude strategy wildcards only empty existing values and keeps an established session", () => {
  const prepared = claudeRunnerLifecycleStrategy.prepare(claudeOptions({ mappedSessionId: null }));
  const runner = claudeRunnerLifecycleStrategy.createRunner(prepared);
  try {
    const entry = {
      ...claudeRunnerLifecycleStrategy.createRegistration(prepared, runner),
      idleTimer: null,
      lastUsedAt: 0,
    };
    entry.command = "";
    entry.cwd = undefined;
    entry.entrypoint = "";
    const bound = claudeRunnerLifecycleStrategy.prepare(claudeOptions({
      command: "claude-bin",
      cwd: "/work",
      entrypoint: "/bin/claude",
      mappedSessionId: "real-1",
    }));
    assert.equal(claudeRunnerLifecycleStrategy.canReuse(entry, bound), true);
    claudeRunnerLifecycleStrategy.applyReuse(entry, bound);
    assert.equal(runner.getSessionId(), "real-1");
    assert.equal(entry.command, "claude-bin");
    claudeRunnerLifecycleStrategy.applyReuse(entry, claudeRunnerLifecycleStrategy.prepare(claudeOptions({
      command: "claude-bin",
      cwd: "/work",
      entrypoint: "/bin/claude",
      mappedSessionId: "real-2",
    })));
    assert.equal(runner.getSessionId(), "real-1");
    assert.equal(claudeRunnerLifecycleStrategy.canReuse(entry, claudeRunnerLifecycleStrategy.prepare(claudeOptions({
      command: "claude-bin",
      cwd: undefined,
      entrypoint: "/bin/claude",
    }))), false);
    runner.dispose();
    assert.equal(claudeRunnerLifecycleStrategy.canReuse(entry, bound), false);

    const fresh = new ClaudeInteractiveRunner({
      command: "caller",
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      sessionId: null,
    });
    const registered = claudeRunnerLifecycleStrategy.createSetRegistration({
      sessionId: "fresh",
      runner: fresh,
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: " sonnet ",
      options: {},
    });
    assert.equal(registered.command, "");
    assert.equal(registered.entrypoint, undefined);
    assert.equal(registered.isolateProjectInstructions, false);
    assert.equal(registered.model, " sonnet ");
    const keptArgs = ["--keep"];
    const existing = {
      ...registered,
      args: keptArgs,
      command: "claude",
      cwd: "/workspace",
      entrypoint: "/bin/claude",
      isolateProjectInstructions: true,
      idleTimer: null,
      lastUsedAt: 0,
    };
    claudeRunnerLifecycleStrategy.applySetMetadata(existing, {
      sessionId: "fresh",
      runner: fresh,
      thinkingMode: "high",
      interactiveMode: "plan",
      model: "haiku",
      options: {},
    });
    assert.equal(existing.command, "claude");
    assert.equal(existing.cwd, "/workspace");
    assert.equal(existing.entrypoint, "/bin/claude");
    assert.equal(existing.isolateProjectInstructions, true);
    assert.equal(existing.args, keptArgs);
    assert.equal(existing.model, "haiku");
    fresh.dispose();
  } finally {
    if (!runner.isDisposed()) {
      runner.dispose();
    }
  }
});

test("Grok strategy rejects a blank session before reuse and ignores agent args", () => {
  const blank = grokOptions(" \n\t ");
  assert.throws(() => grokRunnerLifecycleStrategy.prepare(blank), (error: unknown) => {
    const failure = error as Error & { reason?: string };
    assert.equal(failure.message, "empty grok session");
    assert.equal(failure.reason, "empty");
    return true;
  });
  assert.equal(blank.sessionId, " \n\t ");

  const callerArgs = ["--keep"];
  const options = grokOptions("  spaced  ", { agentArgs: callerArgs, localSessionId: undefined });
  const prepared = grokRunnerLifecycleStrategy.prepare(options);
  assert.equal(prepared.sessionId, "spaced");
  assert.equal(options.sessionId, "  spaced  ");
  assert.equal(prepared.options.agentArgs, callerArgs);
  const runner = grokRunnerLifecycleStrategy.createRunner(prepared);
  try {
    const entry = {
      ...grokRunnerLifecycleStrategy.createRegistration(prepared, runner),
      idleTimer: null,
      lastUsedAt: 0,
    };
    assert.equal(entry.sessionId, "spaced");
    assert.notEqual(entry.args, callerArgs);
    const reused = grokRunnerLifecycleStrategy.prepare(grokOptions("spaced", {
      agentArgs: ["--other"],
      localSessionId: "local-2",
    }));
    assert.equal(grokRunnerLifecycleStrategy.canReuse(entry, reused), true);
    assert.equal(grokRunnerLifecycleStrategy.canReuse(entry, grokRunnerLifecycleStrategy.prepare(grokOptions("spaced", {
      model: "other",
    }))), false);
    runner.dispose();
    assert.equal(runner.isReusable(), false);
    assert.equal(grokRunnerLifecycleStrategy.canReuse(entry, reused), false);

    const fresh = new GrokInteractiveRunner({ command: "grok", cwd: "/workspace", agentArgs: [], localSessionId: null });
    const registered = grokRunnerLifecycleStrategy.createSetRegistration({
      sessionId: "fresh",
      runner: fresh,
      thinkingMode: "high",
      interactiveMode: "coding",
      model: "grok-4",
      options: { cwd: "/workspace" },
    });
    assert.equal(registered.command, "");
    const existing = {
      ...registered,
      idleTimer: null,
      lastUsedAt: 0,
    };
    grokRunnerLifecycleStrategy.applySetMetadata(existing, {
      sessionId: "fresh",
      runner: fresh,
      thinkingMode: "low",
      interactiveMode: "plan",
      model: "grok-4",
      options: {},
    });
    assert.equal(existing.command, "");
    assert.equal(existing.cwd, "/workspace");
    assert.equal(existing.thinkingMode, "low");
    assert.equal(existing.interactiveMode, "plan");
    fresh.dispose();
  } finally {
    if (runner.isReusable()) {
      runner.dispose();
    }
  }
});

test("stop routes Codex and Claude to stopAndRebuild and Grok to cancelTurn", () => {
  const codex = new CodexInteractiveRunner({
    command: "codex",
    args: [],
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: null,
    threadId: null,
  });
  const claude = new ClaudeInteractiveRunner({
    command: "claude",
    args: [],
    thinkingMode: "medium",
    interactiveMode: "coding",
    sessionId: null,
  });
  const grok = new GrokInteractiveRunner({ command: "grok", cwd: "/workspace", agentArgs: [], localSessionId: null });
  const seen: string[] = [];
  const originalCodexStop = codex.stopAndRebuild.bind(codex);
  const originalClaudeStop = claude.stopAndRebuild.bind(claude);
  const originalGrokCancel = grok.cancelTurn.bind(grok);
  codex.stopAndRebuild = () => {
    seen.push("codex-stop");
  };
  claude.stopAndRebuild = () => {
    seen.push("claude-stop");
  };
  grok.cancelTurn = () => {
    seen.push("grok-cancel");
  };
  const codexEntry = {
    ...codexRunnerLifecycleStrategy.createRegistration(codexRunnerLifecycleStrategy.prepare(codexOptions()), codex),
    idleTimer: null,
    lastUsedAt: 0,
  };
  const claudeEntry = {
    ...claudeRunnerLifecycleStrategy.createRegistration(claudeRunnerLifecycleStrategy.prepare(claudeOptions()), claude),
    idleTimer: null,
    lastUsedAt: 0,
  };
  const grokEntry = {
    ...grokRunnerLifecycleStrategy.createRegistration(grokRunnerLifecycleStrategy.prepare(grokOptions()), grok),
    idleTimer: null,
    lastUsedAt: 0,
  };
  try {
    stopManagedRunner(codexEntry);
    stopManagedRunner(claudeEntry);
    stopManagedRunner(grokEntry);
    assert.deepEqual(seen, ["codex-stop", "claude-stop", "grok-cancel"]);
    assert.equal(claude.isDisposed(), false);
    assert.equal(grok.isReusable(), true);
  } finally {
    codex.stopAndRebuild = originalCodexStop;
    claude.stopAndRebuild = originalClaudeStop;
    grok.cancelTurn = originalGrokCancel;
    codex.dispose();
    claude.dispose();
    grok.dispose();
  }
});

test("DSH strategy keeps an independent runner and reuses across model changes", () => {
  assert.throws(() => dshRunnerLifecycleStrategy.prepare({
    sessionId: "  ",
    command: "dsh",
    agentArgs: [],
    cwd: "/workspace",
    thinkingMode: "ultra",
    interactiveMode: "coding",
    model: null,
  }), (error: unknown) => {
    assert.equal((error as { reason?: string }).reason, "empty");
    return true;
  });
  const callerArgs = ["--patch", "/tmp/acp-patch.yaml"];
  const prepared = dshRunnerLifecycleStrategy.prepare({
    sessionId: " local-session ",
    command: "dsh",
    agentArgs: callerArgs,
    cwd: "/workspace",
    thinkingMode: "ultra",
    interactiveMode: "coding",
    model: "[\"sinitek-custom\",\"subcoco/deepseek-v4.1-flash\"]",
    localSessionId: "9a871318-21c4-4603-8e65-693ba8589abe",
    env: { DSH_HOME: "/tmp/isolated", SINITEK_DSH_API_KEY: "secret" },
  });
  assert.equal(prepared.sessionId, "local-session");
  const runner = dshRunnerLifecycleStrategy.createRunner(prepared);
  try {
    assert.equal(runner instanceof DshInteractiveRunner, true);
    assert.equal(runner instanceof GrokInteractiveRunner, false);
    const entry = {
      ...dshRunnerLifecycleStrategy.createRegistration(prepared, runner),
      idleTimer: null,
      lastUsedAt: 0,
    };
    assert.notEqual(entry.args, callerArgs);
    assert.equal(entry.cli, "dsh");
    assert.equal(entry.localSessionId, "9a871318-21c4-4603-8e65-693ba8589abe");
    const changed = dshRunnerLifecycleStrategy.prepare({
      ...prepared.options,
      sessionId: "local-session",
      model: "[\"sinitek-custom\",\"other\"]",
      thinkingMode: "max",
    });
    assert.equal(dshRunnerLifecycleStrategy.canReuse(entry, changed), true);
    assert.equal(dshRunnerLifecycleStrategy.canReuse(entry, dshRunnerLifecycleStrategy.prepare({
      ...prepared.options,
      sessionId: "local-session",
      cwd: "/other",
    })), false);
    assert.equal(dshRunnerLifecycleStrategy.canReuse(entry, dshRunnerLifecycleStrategy.prepare({
      ...prepared.options,
      sessionId: "local-session",
      localSessionId: null,
    })), false);
    dshRunnerLifecycleStrategy.applyReuse(entry, changed);
    assert.equal(entry.model, "[\"sinitek-custom\",\"other\"]");
    assert.equal(entry.thinkingMode, "max");
    const calls: string[] = [];
    runner.cancelTurn = () => {
      calls.push("cancel");
    };
    dshRunnerLifecycleStrategy.stop(runner);
    stopManagedRunner(entry);
    assert.deepEqual(calls, ["cancel", "cancel"]);
  } finally {
    runner.dispose();
  }
});
