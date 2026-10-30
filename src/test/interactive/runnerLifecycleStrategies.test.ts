import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import { PassThrough } from "node:stream";
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
  kimiCodeRunnerLifecycleStrategy,
  zcodeRunnerLifecycleStrategy,
  runnerLifecycleStrategies,
  stopManagedRunner,
} = require("../../interactive/runnerLifecycleStrategies") as typeof import("../../interactive/runnerLifecycleStrategies");
const { ZcodeInteractiveRunner } = require("../../interactive/zcodeRunner") as typeof import("../../interactive/zcodeRunner");

type CodexRunner = InstanceType<typeof CodexInteractiveRunner>;
type CodexOptions = Parameters<typeof codexRunnerLifecycleStrategy.prepare>[0];
type ClaudeOptions = Parameters<typeof claudeRunnerLifecycleStrategy.prepare>[0];
type GrokOptions = Parameters<typeof grokRunnerLifecycleStrategy.prepare>[0];
type DshOptions = Parameters<typeof dshRunnerLifecycleStrategy.prepare>[0];
type KimiCodeOptions = Parameters<typeof kimiCodeRunnerLifecycleStrategy.prepare>[0];
type ZcodeOptions = Parameters<typeof zcodeRunnerLifecycleStrategy.prepare>[0];

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

function kimiCodeOptions(overrides: Partial<KimiCodeOptions> = {}): KimiCodeOptions {
  return {
    sessionId: "session-kimi",
    command: "kimi-code",
    agentArgs: ["--keep"],
    cwd: "/workspace",
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: "kimi-latest",
    thinkingValue: "high",
    modeId: "plan",
    localSessionId: "local-kimi-1",
    env: { KIMI_CODE_HOME: "/tmp/kimi-home" },
    ...overrides,
  };
}

function zcodeOptions(overrides: Partial<ZcodeOptions & { spawnImpl?: unknown }> = {}): ZcodeOptions {
  const { spawnImpl: _spawnImpl, ...rest } = overrides;
  return {
    sessionId: "session-zcode",
    command: "zcode",
    agentArgs: ["--keep"],
    cwd: "/workspace",
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: "sinitek/zcode-latest",
    thinkingValue: "high",
    modeId: "auto",
    localSessionId: "local-zcode-1",
    env: { ZCODE_HOME: "/tmp/zcode-home" },
    ...rest,
  };
}

function makeSetInput(options: {
  runner: unknown;
  sessionId?: string;
  model?: string | null;
  options?: Record<string, unknown>;
}): {
  sessionId: string;
  runner: never;
  thinkingMode: "high";
  interactiveMode: "coding";
  model: string | null;
  options: never;
} {
  return {
    sessionId: options.sessionId ?? "set-session",
    runner: options.runner as never,
    thinkingMode: "high",
    interactiveMode: "coding",
    model: options.model ?? null,
    options: (options.options ?? {}) as never,
  };
}

test("strategy registry exposes one entry per supported CLI with matching metadata", () => {
  const expected: Array<[string, string]> = [
    ["codex", "codex"],
    ["claude", "claude"],
    ["grok", "grok"],
    ["dsh", "dsh"],
    ["kimi-code", "kimi-code"],
    ["zcode", "zcode"],
  ];
  assert.deepEqual(Object.keys(runnerLifecycleStrategies), expected.map(([key]) => key));
  for (const [key, cli] of expected) {
    const strategy = (runnerLifecycleStrategies as Record<string, { cli: string }>)[key];
    assert.equal(strategy.cli, cli);
    assert.equal(typeof (strategy as unknown as { prepare: unknown }).prepare, "function");
    assert.equal(typeof (strategy as unknown as { canReuse: unknown }).canReuse, "function");
    assert.equal(typeof (strategy as unknown as { applyReuse: unknown }).applyReuse, "function");
    assert.equal(typeof (strategy as unknown as { createRunner: unknown }).createRunner, "function");
    assert.equal(typeof (strategy as unknown as { createRegistration: unknown }).createRegistration, "function");
    assert.equal(typeof (strategy as unknown as { applySetMetadata: unknown }).applySetMetadata, "function");
    assert.equal(typeof (strategy as unknown as { createSetRegistration: unknown }).createSetRegistration, "function");
    assert.equal(typeof (strategy as unknown as { stop: unknown }).stop, "function");
  }
});

test("Kimi Code strategy trims the session, copies args, and reuses across model changes", () => {
  assert.throws(() => kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({ sessionId: "   " })), (error: unknown) => {
    const failure = error as Error & { reason?: string };
    assert.equal(failure.message, "empty kimi-code session");
    assert.equal(failure.reason, "empty");
    return true;
  });

  const callerArgs = ["--keep"];
  const prepared = kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({
    sessionId: "  spaced  ",
    agentArgs: callerArgs,
    localSessionId: undefined,
  }));
  assert.equal(prepared.sessionId, "spaced");
  assert.equal(prepared.options.localSessionId, null);
  const runner = kimiCodeRunnerLifecycleStrategy.createRunner(prepared);
  try {
    const entry = {
      ...kimiCodeRunnerLifecycleStrategy.createRegistration(prepared, runner),
      idleTimer: null,
      lastUsedAt: 0,
    };
    assert.notEqual(entry.args, callerArgs);
    assert.deepEqual(entry.args, ["--keep"]);
    assert.equal(entry.localSessionId, null);
    assert.equal(entry.env && entry.env.KIMI_CODE_HOME, "/tmp/kimi-home");

    const reused = kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({
      sessionId: "spaced",
      model: "kimi-next",
      thinkingValue: null,
      modeId: null,
      localSessionId: undefined,
    }));
    assert.equal(kimiCodeRunnerLifecycleStrategy.canReuse(entry, reused), true);
    assert.equal(kimiCodeRunnerLifecycleStrategy.canReuse(entry, kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({
      sessionId: "spaced",
      env: { KIMI_CODE_HOME: "/tmp/other" },
    }))), false);
    assert.equal(kimiCodeRunnerLifecycleStrategy.canReuse(entry, kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({
      sessionId: "spaced",
      localSessionId: "local-kimi-2",
    }))), false);
    assert.equal(kimiCodeRunnerLifecycleStrategy.canReuse(entry, kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({
      sessionId: "spaced",
      agentArgs: ["--changed"],
    }))), false);
    assert.equal(kimiCodeRunnerLifecycleStrategy.canReuse(entry, kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({
      sessionId: "spaced",
      cwd: "/other",
    }))), false);
    kimiCodeRunnerLifecycleStrategy.applyReuse(entry, reused);
    assert.equal(entry.model, "kimi-next");
    assert.equal(entry.localSessionId, null);
    assert.deepEqual(entry.args, ["--keep"]);
    assert.notEqual(entry.args, reused.options.agentArgs);

    runner.dispose();
    assert.equal(kimiCodeRunnerLifecycleStrategy.canReuse(entry, reused), false);

    const fresh = kimiCodeRunnerLifecycleStrategy.createRunner(kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({ localSessionId: null })));
    try {
      const registered = kimiCodeRunnerLifecycleStrategy.createSetRegistration(makeSetInput({
        runner: fresh,
        options: { cwd: "/workspace" },
      }));
      assert.equal(registered.command, "");
      assert.equal(registered.localSessionId, null);
      const existing = {
        ...registered,
        command: "kimi-code",
        cwd: "/workspace",
        args: ["--old"],
        env: { KIMI_CODE_HOME: "/tmp/kept" },
        localSessionId: "kept-local",
        idleTimer: null,
        lastUsedAt: 0,
      };
      kimiCodeRunnerLifecycleStrategy.applySetMetadata(existing, makeSetInput({
        runner: fresh,
        model: "kimi-latest",
      }));
      assert.equal(existing.command, "kimi-code");
      assert.equal(existing.cwd, "/workspace");
      assert.deepEqual(existing.args, ["--old"]);
      assert.equal(existing.env && existing.env.KIMI_CODE_HOME, "/tmp/kept");
      assert.equal(existing.localSessionId, "kept-local");
      assert.equal(existing.model, "kimi-latest");
      kimiCodeRunnerLifecycleStrategy.applySetMetadata(existing, makeSetInput({
        runner: fresh,
        model: "kimi-latest",
        options: { args: ["--new"], env: { KIMI_CODE_HOME: "/tmp/next" }, localSessionId: "next-local", cwd: "/next" },
      }));
      assert.deepEqual(existing.args, ["--new"]);
      assert.notEqual(existing.args, ["--new"]);
      assert.equal(existing.env && existing.env.KIMI_CODE_HOME, "/tmp/next");
      assert.equal(existing.localSessionId, "next-local");
      assert.equal(existing.cwd, "/next");
    } finally {
      fresh.dispose();
    }
  } finally {
    if (runner.isReusable()) {
      runner.dispose();
    }
  }
});

class FakeZcodeProcess {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  private buffer = "";
  private pending = new Map<number, unknown>();

  public constructor() {
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines.filter((value) => value.trim())) {
        const request = JSON.parse(line) as { id: number; method: string; params: Record<string, unknown> };
        const result = request.method === "session/create" || request.method === "session/resume" ? {
          protocol: { name: "ZCode Protocol", version: 1 },
          session: { sessionId: "sess_test" },
          settings: {
            mode: { current: "yolo" },
            model: { current: request.params.model, available: [] },
            thoughtLevel: { current: null, enabled: true, available: [] },
          },
        } : {};
        this.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
      }
    });
  }

  public once(event: string, listener: (...args: unknown[]) => void): this {
    if (event === "error" || event === "exit") {
      // The fake child stays alive until disposed.
      return this;
    }
    return this;
  }

  public kill(): boolean {
    this.stdout.end();
    this.stderr.end();
    return true;
  }
}

test("Zcode strategy trims the session, copies args, and keeps env optional on reuse", async () => {
  assert.throws(() => zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({ sessionId: "" })), (error: unknown) => {
    const failure = error as Error & { reason?: string };
    assert.equal(failure.message, "empty zcode session");
    assert.equal(failure.reason, "empty");
    return true;
  });

  const callerArgs = ["--keep"];
  const prepared = zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({
    sessionId: "  spaced  ",
    agentArgs: callerArgs,
    localSessionId: undefined,
    env: undefined,
  }));
  assert.equal(prepared.sessionId, "spaced");
  const runner = zcodeRunnerLifecycleStrategy.createRunner(prepared);
  try {
    const entry = {
      ...zcodeRunnerLifecycleStrategy.createRegistration(prepared, runner),
      idleTimer: null,
      lastUsedAt: 0,
    };
    assert.notEqual(entry.args, callerArgs);
    assert.deepEqual(entry.args, ["--keep"]);
    assert.equal(entry.localSessionId, null);
    assert.equal(entry.env, undefined);

    const reused = zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({
      sessionId: "spaced",
      model: "zcode-next",
      localSessionId: undefined,
      env: { ZCODE_HOME: "/tmp/zcode-next" },
    }));
    assert.equal(zcodeRunnerLifecycleStrategy.canReuse(entry, reused), false,
      "a zcode runner that has not started is not reusable");
    const child = new FakeZcodeProcess();
    const started = new ZcodeInteractiveRunner({
      command: "zcode",
      agentArgs: callerArgs,
      cwd: "/workspace",
      thinkingMode: null,
      modeId: null,
      model: "sinitek/zcode-latest",
      localSessionId: null,
      env: undefined,
      spawnImpl: (() => child) as unknown as ConstructorParameters<typeof ZcodeInteractiveRunner>[0]["spawnImpl"],
    });
    const startedEntry = {
      ...zcodeRunnerLifecycleStrategy.createRegistration(zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({
        sessionId: "spaced",
        agentArgs: callerArgs,
        localSessionId: undefined,
        env: undefined,
      })), started),
      idleTimer: null,
      lastUsedAt: 0,
    };
    try {
      await started.start();
      assert.equal(started.isReusable(), true);
      assert.equal(zcodeRunnerLifecycleStrategy.canReuse(startedEntry, reused), true);
      assert.equal(zcodeRunnerLifecycleStrategy.canReuse(startedEntry, zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({
        sessionId: "spaced",
        localSessionId: "local-zcode-2",
      }))), false);
      assert.equal(zcodeRunnerLifecycleStrategy.canReuse(startedEntry, zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({
        sessionId: "spaced",
        agentArgs: ["--changed"],
      }))), false);
      zcodeRunnerLifecycleStrategy.applyReuse(startedEntry, reused);
      assert.equal(startedEntry.model, "zcode-next");
      assert.equal(startedEntry.env && (startedEntry.env as NodeJS.ProcessEnv).ZCODE_HOME, "/tmp/zcode-next");

      started.dispose();
      assert.equal(zcodeRunnerLifecycleStrategy.canReuse(startedEntry, reused), false);
    } finally {
      void started.dispose();
    }

    const fresh = zcodeRunnerLifecycleStrategy.createRunner(zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({ localSessionId: null })));
    try {
      const registered = zcodeRunnerLifecycleStrategy.createSetRegistration(makeSetInput({
        runner: fresh,
        options: {},
      }));
      assert.equal(registered.command, "");
      assert.equal(registered.localSessionId, null);
      const existing = {
        ...registered,
        command: "zcode",
        cwd: "/workspace",
        args: ["--old"],
        localSessionId: "kept-local",
        idleTimer: null,
        lastUsedAt: 0,
      };
      zcodeRunnerLifecycleStrategy.applySetMetadata(existing, makeSetInput({
        runner: fresh,
        model: "sinitek/zcode-latest",
      }));
      assert.equal(existing.command, "zcode");
      assert.deepEqual(existing.args, ["--old"]);
      assert.equal(existing.localSessionId, "kept-local");
      zcodeRunnerLifecycleStrategy.applySetMetadata(existing, makeSetInput({
        runner: fresh,
        model: "sinitek/zcode-latest",
        options: { args: ["--new"], localSessionId: null, env: { ZCODE_HOME: "/tmp/next" } },
      }));
      assert.deepEqual(existing.args, ["--new"]);
      assert.equal(existing.localSessionId, null);
      assert.equal(existing.env && existing.env.ZCODE_HOME, "/tmp/next");
    } finally {
      fresh.dispose();
    }
  } finally {
    void runner.dispose();
  }
});

test("stopManagedRunner routes DSH, Kimi Code, and Zcode to cancelTurn without disposing", () => {
  const dshRunner = dshRunnerLifecycleStrategy.createRunner(dshRunnerLifecycleStrategy.prepare({
    sessionId: "stop-dsh",
    command: "dsh",
    agentArgs: [],
    cwd: "/workspace",
    thinkingMode: "ultra",
    interactiveMode: "coding",
    model: null,
  }));
  const kimiRunner = kimiCodeRunnerLifecycleStrategy.createRunner(kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({})));
  const zcodeRunner = zcodeRunnerLifecycleStrategy.createRunner(zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({})));
  const seen: string[] = [];
  const hook = (runner: { cancelTurn: () => void }, label: string) => {
    const original = runner.cancelTurn.bind(runner);
    runner.cancelTurn = () => {
      seen.push(label);
    };
    return () => {
      runner.cancelTurn = original;
    };
  };
  const restoreDsh = hook(dshRunner as unknown as { cancelTurn: () => void }, "dsh-cancel");
  const restoreKimi = hook(kimiRunner as unknown as { cancelTurn: () => void }, "kimi-cancel");
  const restoreZcode = hook(zcodeRunner as unknown as { cancelTurn: () => void }, "zcode-cancel");
  const dshEntry = {
    ...dshRunnerLifecycleStrategy.createRegistration(dshRunnerLifecycleStrategy.prepare({
      sessionId: "stop-dsh",
      command: "dsh",
      agentArgs: [],
      cwd: "/workspace",
      thinkingMode: "ultra",
      interactiveMode: "coding",
      model: null,
    }), dshRunner),
    idleTimer: null,
    lastUsedAt: 0,
  };
  const kimiEntry = {
    ...kimiCodeRunnerLifecycleStrategy.createRegistration(kimiCodeRunnerLifecycleStrategy.prepare(kimiCodeOptions({})), kimiRunner),
    idleTimer: null,
    lastUsedAt: 0,
  };
  const zcodeEntry = {
    ...zcodeRunnerLifecycleStrategy.createRegistration(zcodeRunnerLifecycleStrategy.prepare(zcodeOptions({})), zcodeRunner),
    idleTimer: null,
    lastUsedAt: 0,
  };
  try {
    stopManagedRunner(dshEntry);
    stopManagedRunner(kimiEntry);
    stopManagedRunner(zcodeEntry);
    assert.deepEqual(seen, ["dsh-cancel", "kimi-cancel", "zcode-cancel"]);
    assert.equal(dshRunner.isReusable(), true);
    assert.equal(kimiRunner.isReusable(), true);
  } finally {
    restoreDsh();
    restoreKimi();
    restoreZcode();
    dshRunner.dispose();
    kimiRunner.dispose();
    void zcodeRunner.dispose();
  }
});
