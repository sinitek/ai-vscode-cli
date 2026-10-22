import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("fs");
import path = require("path");
import ts = require("typescript");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { InteractiveRunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");

function claudeOptions(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-claude",
    mappedSessionId: null,
    command: "claude",
    args: ["--model", "sonnet"],
    cwd: "/workspace",
    thinkingMode: "medium" as const,
    interactiveMode: "coding" as const,
    model: "sonnet",
    entrypoint: "/usr/local/bin/claude",
    isolateProjectInstructions: false,
    ...overrides,
  };
}

test("Claude runners stay attached to one session until cwd, model, or CLI ownership changes", () => {
  const manager = new InteractiveRunnerManager();
  try {
    const first = manager.getOrCreateClaudeRunner(claudeOptions());
    const reused = manager.getOrCreateClaudeRunner(claudeOptions({ args: ["--model", "sonnet", "--verbose"] }));
    assert.equal(reused, first);
    assert.equal(manager.hasClaudeRunner("session-claude", first), true);

    const isolated = manager.getOrCreateClaudeRunner(claudeOptions({ isolateProjectInstructions: true }));
    const isolatedAgain = manager.getOrCreateClaudeRunner(claudeOptions({ isolateProjectInstructions: true }));
    assert.notEqual(isolated, first);
    assert.equal(first.isDisposed(), true);
    assert.equal(isolatedAgain, isolated);

    const moved = manager.getOrCreateClaudeRunner(claudeOptions({ cwd: "/other" }));
    assert.notEqual(moved, isolated);
    assert.equal(isolated.isDisposed(), true);

    manager.disposeIfMatches("claude", "session-claude");
    assert.equal(moved.isDisposed(), true);
    manager.disposeIfMatches("claude", "session-claude");
    manager.disposeForCli("opencode");
    manager.disposeAll();
    manager.disposeAll();
  } finally {
    manager.disposeAll();
  }
});

test("switching or disposing a CLI closes only that CLI runner", () => {
  const manager = new InteractiveRunnerManager();
  try {
    const claude = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "session-a" }));
    const other = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "session-b", model: "haiku" }));
    manager.disposeForCli("claude");
    assert.equal(claude.isDisposed(), true);
    assert.equal(other.isDisposed(), true);
    manager.disposeForCli("codex");
    manager.disposeForCli("opencode");
    assert.equal(manager.hasClaudeRunner("session-a", claude), false);
  } finally {
    manager.disposeAll();
  }
});

const { CodexInteractiveRunner } = require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
const { ClaudeInteractiveRunner } = require("../../interactive/claudeRunner") as typeof import("../../interactive/claudeRunner");
const { GrokInteractiveRunner } = require("../../interactive/grokRunner") as typeof import("../../interactive/grokRunner");
const codexModule = require("../../interactive/codexRunner") as typeof import("../../interactive/codexRunner");
const claudeModule = require("../../interactive/claudeRunner") as typeof import("../../interactive/claudeRunner");
const grokModule = require("../../interactive/grokRunner") as typeof import("../../interactive/grokRunner");

const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
type CodexRunner = InstanceType<typeof CodexInteractiveRunner>;
type ClaudeRunner = InstanceType<typeof ClaudeInteractiveRunner>;
type Manager = InstanceType<typeof InteractiveRunnerManager>;
type CodexOptions = Parameters<Manager["getOrCreateCodexRunner"]>[0];
type ClaudeOptions = Parameters<Manager["getOrCreateClaudeRunner"]>[0];
type GrokOptions = Parameters<Manager["getOrCreateGrokRunner"]>[0];

type StoredEntry = {
  cli: string;
  sessionId: string;
  runner: unknown;
  command?: string;
  args: string[];
  cwd?: string;
  entrypoint?: string;
  isolateProjectInstructions?: boolean;
  model: string | null;
  configId?: string | null;
  idleTimer: unknown;
  lastUsedAt: number;
};

type FakeTimer = {
  firesAt: number;
  delay: number;
  callback: () => void;
  cleared: boolean;
  unrefCalls: number;
  unref: () => FakeTimer;
};

function codexOptions(overrides: Partial<CodexOptions> = {}): CodexOptions {
  return {
    sessionId: "session-codex",
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

function withManager(run: (manager: Manager) => void): void {
  const manager = new InteractiveRunnerManager();
  try {
    run(manager);
  } finally {
    manager.disposeAll();
  }
}

async function withManagerAsync(run: (manager: Manager) => Promise<void>): Promise<void> {
  const manager = new InteractiveRunnerManager();
  try {
    await run(manager);
  } finally {
    manager.disposeAll();
  }
}

function storedEntries(manager: Manager): Map<string, StoredEntry> {
  return (manager as unknown as { entries: Map<string, StoredEntry> }).entries;
}

function stored(manager: Manager, cli: string, sessionId: string): StoredEntry {
  const entry = storedEntries(manager).get(`${cli}:${sessionId}`);
  assert.ok(entry);
  return entry;
}

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, next: T[K]): () => void {
  const previous = target[key];
  target[key] = next;
  return () => {
    target[key] = previous;
  };
}

function installControlledClock(start = 1_700_000_000_000) {
  const originalNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let now = start;
  const timers: FakeTimer[] = [];
  Date.now = () => now;
  global.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const timer: FakeTimer = {
      firesAt: now + (delay ?? 0),
      delay: delay ?? 0,
      cleared: false,
      unrefCalls: 0,
      callback: () => {
        (callback as () => void)();
      },
      unref() {
        this.unrefCalls += 1;
        return this;
      },
    };
    timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  global.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    const timer = timers.find((item) => item === (handle as unknown as FakeTimer));
    if (timer) {
      timer.cleared = true;
    }
  }) as typeof clearTimeout;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    active() {
      return timers.filter((timer) => !timer.cleared);
    },
    fireDue() {
      const due = timers.filter((timer) => !timer.cleared && timer.firesAt <= now);
      for (const timer of due) {
        timer.cleared = true;
        timer.callback();
      }
    },
    unrefCalls() {
      return timers.reduce((sum, timer) => sum + timer.unrefCalls, 0);
    },
    restore() {
      Date.now = originalNow;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    },
  };
}

function withClock(run: (clock: ReturnType<typeof installControlledClock>, manager: Manager) => void): void {
  const clock = installControlledClock();
  try {
    const manager = new InteractiveRunnerManager();
    try {
      run(clock, manager);
    } finally {
      manager.disposeAll();
    }
  } finally {
    clock.restore();
  }
}

function newCodexRunner(): CodexRunner {
  return new CodexInteractiveRunner({
    command: "codex",
    args: ["--fresh"],
    cwd: "/workspace",
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: "gpt-5.5",
    threadId: "thread-b",
  });
}

test("Codex reuse follows command, cwd, and normalized config id only", async () => {
  await withManagerAsync(async (manager) => {
    const first = manager.getOrCreateCodexRunner(codexOptions());
    const sameConfig = manager.getOrCreateCodexRunner(codexOptions({
      configId: "  config-a  ",
      model: "gpt-5.6",
      threadId: "thread-b",
      thinkingMode: "high",
      interactiveMode: "plan",
      args: ["--changed"],
    }));
    assert.equal(sameConfig, first);
    assert.deepEqual(manager.getCodexRunnerSelection("session-codex"), {
      configId: "config-a",
      model: "gpt-5.6",
    });

    const blank = manager.getOrCreateCodexRunner(codexOptions({
      sessionId: "blank",
      configId: "   ",
      model: "   ",
    }));
    assert.deepEqual(manager.getCodexRunnerSelection("blank"), { configId: null, model: null });
    assert.equal(manager.getOrCreateCodexRunner(codexOptions({
      sessionId: "blank",
      configId: null,
      model: null,
    })), blank);

    const otherCommand = manager.getOrCreateCodexRunner(codexOptions({ command: "Codex" }));
    assert.notEqual(otherCommand, first);
    await assert.rejects(() => first.ensureReady());
    const otherCwd = manager.getOrCreateCodexRunner(codexOptions({ command: "Codex", cwd: "C:/repo" }));
    const windowsCwd = manager.getOrCreateCodexRunner(codexOptions({ command: "Codex", cwd: "C:\\repo" }));
    assert.notEqual(windowsCwd, otherCwd);
    const otherConfig = manager.getOrCreateCodexRunner(codexOptions({ configId: "config-b" }));
    assert.notEqual(otherConfig, sameConfig);

    const spaced = manager.getOrCreateCodexRunner(codexOptions({ sessionId: "  sid  " }));
    assert.equal(manager.hasCodexRunner("  sid  ", spaced), true);
    assert.equal(manager.hasCodexRunner("sid", spaced), false);
    assert.equal(storedEntries(manager).has("codex:  sid  "), true);
    assert.equal(manager.getCodexRunnerSelection(null), null);
    assert.equal(manager.getCodexRunnerSelection(""), null);
  });
});

test("Codex updateOptions receives the current request and a normalized model", () => {
  withManager((manager) => {
    const calls: Array<Parameters<CodexRunner["updateOptions"]>[0]> = [];
    const original = CodexInteractiveRunner.prototype.updateOptions;
    const restore = replaceMethod(CodexInteractiveRunner.prototype, "updateOptions", function (this: CodexRunner, options) {
      calls.push(options);
      return original.call(this, options);
    });
    try {
      const args = ["--image", "one.png"];
      const first = manager.getOrCreateCodexRunner(codexOptions({ args }));
      assert.equal(calls.length, 0);
      assert.notEqual(stored(manager, "codex", "session-codex").args, args);
      args.push("--mutated");
      assert.deepEqual(stored(manager, "codex", "session-codex").args, ["--image", "one.png"]);

      const nextArgs = ["--image", "two.png"];
      const reused = manager.getOrCreateCodexRunner(codexOptions({
        args: nextArgs,
        threadId: null,
        thinkingMode: "high",
        interactiveMode: "plan",
        model: "  gpt-5.6  ",
      }));
      assert.equal(reused, first);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, "codex");
      assert.equal(calls[0].args, nextArgs);
      assert.equal(calls[0].cwd, "/workspace");
      assert.equal(calls[0].thinkingMode, "high");
      assert.equal(calls[0].interactiveMode, "plan");
      assert.equal(calls[0].model, "gpt-5.6");
      assert.equal(calls[0].threadId, null);
      assert.equal(first.getThreadId(), "thread-a");
      assert.deepEqual(stored(manager, "codex", "session-codex").args, ["--image", "two.png"]);
      assert.notEqual(stored(manager, "codex", "session-codex").args, nextArgs);

      calls.length = 0;
      const replaced = manager.getOrCreateCodexRunner(codexOptions({ command: "codex-other" }));
      assert.notEqual(replaced, first);
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });
});

test("Claude reuse keeps strict fields, one-way empty wildcards, and the established session id", () => {
  withManager((manager) => {
    const disposed = manager.getOrCreateClaudeRunner(claudeOptions());
    disposed.dispose();
    const afterDispose = manager.getOrCreateClaudeRunner(claudeOptions());
    assert.notEqual(afterDispose, disposed);
    assert.equal(manager.hasClaudeRunner("session-claude", disposed), false);
    assert.equal(manager.hasClaudeRunner("session-claude", afterDispose), true);

    const modeChanged = manager.getOrCreateClaudeRunner(claudeOptions({ thinkingMode: "high" }));
    assert.notEqual(modeChanged, afterDispose);
    const interactiveChanged = manager.getOrCreateClaudeRunner(claudeOptions({ thinkingMode: "high", interactiveMode: "plan" }));
    assert.notEqual(interactiveChanged, modeChanged);
    const modelChanged = manager.getOrCreateClaudeRunner(claudeOptions({
      thinkingMode: "high",
      interactiveMode: "plan",
      model: " sonnet ",
    }));
    assert.notEqual(modelChanged, interactiveChanged);
    assert.equal(stored(manager, "claude", "session-claude").model, " sonnet ");

    const isolated = manager.getOrCreateClaudeRunner(claudeOptions({ isolateProjectInstructions: undefined }));
    assert.equal(manager.getOrCreateClaudeRunner(claudeOptions({ isolateProjectInstructions: false })), isolated);
    const isolatedOn = manager.getOrCreateClaudeRunner(claudeOptions({ isolateProjectInstructions: true }));
    assert.notEqual(isolatedOn, isolated);

    const wildcard = manager.getOrCreateClaudeRunner(claudeOptions({
      sessionId: "wild",
      command: "",
      cwd: undefined,
      entrypoint: "",
      mappedSessionId: null,
    }));
    assert.equal(wildcard.getSessionId(), null);
    const boundFields = {
      sessionId: "wild",
      command: "claude",
      cwd: "/workspace",
      entrypoint: "/bin/claude",
    };
    const bound = manager.getOrCreateClaudeRunner(claudeOptions({
      ...boundFields,
      mappedSessionId: "",
    }));
    assert.equal(bound, wildcard);
    assert.equal(bound.getSessionId(), null);
    const withSession = manager.getOrCreateClaudeRunner(claudeOptions({
      ...boundFields,
      mappedSessionId: "real-1",
    }));
    assert.equal(withSession, wildcard);
    assert.equal(withSession.getSessionId(), "real-1");
    manager.getOrCreateClaudeRunner(claudeOptions({
      ...boundFields,
      mappedSessionId: "real-2",
    }));
    assert.equal(withSession.getSessionId(), "real-1");
    withSession.updateSessionId("  ");
    manager.getOrCreateClaudeRunner(claudeOptions({
      ...boundFields,
      mappedSessionId: "real-3",
    }));
    assert.equal(withSession.getSessionId(), "  ");
    withSession.updateSessionId("");
    manager.getOrCreateClaudeRunner(claudeOptions({
      ...boundFields,
      mappedSessionId: "real-4",
    }));
    assert.equal(withSession.getSessionId(), "real-4");
    const otherCommand = manager.getOrCreateClaudeRunner(claudeOptions({
      ...boundFields,
      command: "other",
    }));
    assert.notEqual(otherCommand, withSession);

    const rooted = manager.getOrCreateClaudeRunner(claudeOptions({
      sessionId: "rooted",
      cwd: "/workspace",
      entrypoint: "/bin/claude",
    }));
    const missingCwd = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "rooted", cwd: undefined }));
    assert.notEqual(missingCwd, rooted);
    assert.equal(rooted.isDisposed(), true);
    const missingEntrypoint = manager.getOrCreateClaudeRunner(claudeOptions({
      sessionId: "rooted",
      cwd: undefined,
      entrypoint: undefined,
    }));
    assert.notEqual(missingEntrypoint, missingCwd);
    assert.equal(missingCwd.isDisposed(), true);
  });
});

test("Grok trims only getOrCreate session ids and rebuilds on strict runner identity", () => {
  withManager((manager) => {
    const kept = manager.getOrCreateGrokRunner(grokOptions("keep"));
    assert.throws(() => manager.getOrCreateGrokRunner(grokOptions(" \n\t ")), (error: unknown) => {
      const failure = error as Error & { reason?: string };
      assert.equal(failure.message, "empty grok session");
      assert.equal(failure.reason, "empty");
      return true;
    });
    assert.equal(manager.hasGrokRunner("keep", kept), true);
    assert.equal(kept.isReusable(), true);

    const spaced = manager.getOrCreateGrokRunner(grokOptions("  spaced  "));
    assert.equal(manager.hasGrokRunner("spaced", spaced), true);
    assert.equal(manager.hasGrokRunner("  spaced  ", spaced), false);
    assert.equal(stored(manager, "grok", "spaced").sessionId, "spaced");
    manager.disposeIfMatches("grok", "  spaced  ");
    manager.stopTurnAndRebuild("grok", "  spaced  ");
    assert.equal(manager.hasGrokRunner("spaced", spaced), true);
    assert.equal(spaced.isReusable(), true);

    const first = manager.getOrCreateGrokRunner(grokOptions());
    const reused = manager.getOrCreateGrokRunner(grokOptions("session-grok", {
      agentArgs: ["--other"],
      localSessionId: "local-2",
    }));
    assert.equal(reused, first);
    assert.deepEqual(stored(manager, "grok", "session-grok").args, ["--other"]);
    const callerArgs = ["--fresh"];
    manager.getOrCreateGrokRunner(grokOptions("session-grok", { agentArgs: callerArgs }));
    callerArgs.push("--mutated");
    assert.deepEqual(stored(manager, "grok", "session-grok").args, ["--fresh"]);

    const byModel = manager.getOrCreateGrokRunner(grokOptions("session-grok", { model: "grok-4.7" }));
    assert.notEqual(byModel, first);
    assert.equal(first.isReusable(), false);
    const byThinking = manager.getOrCreateGrokRunner(grokOptions("session-grok", { model: "grok-4.7", thinkingMode: "low" }));
    assert.notEqual(byThinking, byModel);
    const byInteractive = manager.getOrCreateGrokRunner(grokOptions("session-grok", {
      model: "grok-4.7",
      thinkingMode: "low",
      interactiveMode: "plan",
    }));
    assert.notEqual(byInteractive, byThinking);
    const byCommand = manager.getOrCreateGrokRunner(grokOptions("session-grok", {
      model: "grok-4.7",
      thinkingMode: "low",
      interactiveMode: "plan",
      command: "grok-other",
    }));
    assert.notEqual(byCommand, byInteractive);
    const byCwd = manager.getOrCreateGrokRunner(grokOptions("session-grok", {
      model: "grok-4.7",
      thinkingMode: "low",
      interactiveMode: "plan",
      command: "grok-other",
      cwd: "/other",
    }));
    assert.notEqual(byCwd, byCommand);

    byCwd.dispose();
    const replaced = manager.getOrCreateGrokRunner(grokOptions("session-grok", {
      model: "grok-4.7",
      thinkingMode: "low",
      interactiveMode: "plan",
      command: "grok-other",
      cwd: "/other",
    }));
    assert.notEqual(replaced, byCwd);
    assert.equal(replaced.isReusable(), true);
    assert.equal(manager.hasGrokRunner("session-grok", byCwd), false);
    assert.equal(manager.hasGrokRunner("session-grok", replaced), true);
  });
});

test("setRunner refreshes the same object, replaces a different object, and copies args", async () => {
  await withManagerAsync(async (manager) => {
    const updateCalls: unknown[] = [];
    const sessionCalls: string[] = [];
    const originalUpdate = CodexInteractiveRunner.prototype.updateOptions;
    const originalSession = ClaudeInteractiveRunner.prototype.updateSessionId;
    const restoreUpdate = replaceMethod(CodexInteractiveRunner.prototype, "updateOptions", function (this: CodexRunner, options) {
      updateCalls.push(options);
      return originalUpdate.call(this, options);
    });
    const restoreSession = replaceMethod(ClaudeInteractiveRunner.prototype, "updateSessionId", function (this: ClaudeRunner, sessionId: string) {
      sessionCalls.push(sessionId);
      return originalSession.call(this, sessionId);
    });
    let codexDisposes = 0;
    const originalDispose = CodexInteractiveRunner.prototype.dispose;
    const restoreDispose = replaceMethod(CodexInteractiveRunner.prototype, "dispose", function (this: CodexRunner) {
      codexDisposes += 1;
      return originalDispose.call(this);
    });
    try {
      const codex = manager.getOrCreateCodexRunner(codexOptions({ args: ["--old"] }));
      updateCalls.length = 0;
      const codexArgs = ["--new"];
      manager.setRunner("codex", "session-codex", codex, "high", "plan", "  gpt-5.6  ", {
        configId: "  config-b  ",
        command: "codex",
        args: codexArgs,
        cwd: "/workspace",
      });
      assert.equal(codexDisposes, 0);
      assert.equal(updateCalls.length, 0);
      assert.equal(manager.hasCodexRunner("session-codex", codex), true);
      assert.deepEqual(manager.getCodexRunnerSelection("session-codex"), {
        configId: "config-b",
        model: "gpt-5.6",
      });
      codexArgs.push("--mutated");
      assert.deepEqual(stored(manager, "codex", "session-codex").args, ["--new"]);
      manager.setRunner("codex", "session-codex", codex, "medium", "coding", null, {});
      assert.deepEqual(manager.getCodexRunnerSelection("session-codex"), { configId: null, model: null });
      assert.equal(stored(manager, "codex", "session-codex").command, undefined);
      assert.equal(stored(manager, "codex", "session-codex").cwd, undefined);
      assert.deepEqual(stored(manager, "codex", "session-codex").args, []);
      const rebuilt = manager.getOrCreateCodexRunner(codexOptions());
      assert.notEqual(rebuilt, codex);

      const replacement = newCodexRunner();
      manager.setRunner("codex", "session-codex", replacement, "medium", "coding", "gpt-5.5", {
        configId: "config-a",
        command: "codex",
        cwd: "/workspace",
      });
      assert.equal(manager.hasCodexRunner("session-codex", replacement), true);
      assert.equal(manager.hasCodexRunner("session-codex", rebuilt), false);
      await assert.rejects(() => rebuilt.ensureReady());
      const blocked = newCodexRunner();
      const restoreThrow = replaceMethod(CodexInteractiveRunner.prototype, "dispose", function () {
        throw new Error("dispose boom");
      });
      try {
        assert.throws(() => manager.setRunner("codex", "session-codex", blocked, "medium", "coding", "gpt-5.5", {}), /dispose boom/);
      } finally {
        restoreThrow();
      }
      assert.equal(manager.hasCodexRunner("session-codex", replacement), true);
      assert.equal(manager.hasCodexRunner("session-codex", blocked), false);

      const claude = manager.getOrCreateClaudeRunner(claudeOptions({
        isolateProjectInstructions: true,
        args: ["--keep"],
      }));
      const keptArgs = stored(manager, "claude", "session-claude").args;
      manager.setRunner("claude", "session-claude", claude, "medium", "coding", " sonnet ", {});
      assert.equal(sessionCalls.length, 0);
      assert.equal(stored(manager, "claude", "session-claude").command, "claude");
      assert.equal(stored(manager, "claude", "session-claude").cwd, "/workspace");
      assert.equal(stored(manager, "claude", "session-claude").entrypoint, "/usr/local/bin/claude");
      assert.equal(stored(manager, "claude", "session-claude").isolateProjectInstructions, true);
      assert.equal(stored(manager, "claude", "session-claude").model, " sonnet ");
      assert.equal(stored(manager, "claude", "session-claude").args, keptArgs);
      const stillSame = manager.getOrCreateClaudeRunner(claudeOptions({
        isolateProjectInstructions: true,
        model: " sonnet ",
      }));
      assert.equal(stillSame, claude);
      const otherCommand = manager.getOrCreateClaudeRunner(claudeOptions({
        command: "other",
        isolateProjectInstructions: true,
        model: " sonnet ",
      }));
      assert.notEqual(otherCommand, claude);

      const claudeArgs = ["--copied"];
      const freshClaude = new ClaudeInteractiveRunner({
        command: "ignored-by-manager",
        args: [],
        thinkingMode: "medium",
        interactiveMode: "coding",
        sessionId: null,
      });
      manager.setRunner("claude", "fresh-claude", freshClaude, "medium", "coding", "haiku", { args: claudeArgs });
      assert.equal(stored(manager, "claude", "fresh-claude").command, "");
      assert.equal(stored(manager, "claude", "fresh-claude").entrypoint, undefined);
      assert.equal(stored(manager, "claude", "fresh-claude").isolateProjectInstructions, false);
      assert.notEqual(stored(manager, "claude", "fresh-claude").args, claudeArgs);
      assert.deepEqual(stored(manager, "claude", "fresh-claude").args, ["--copied"]);
      const boundFresh = manager.getOrCreateClaudeRunner(claudeOptions({
        sessionId: "fresh-claude",
        command: "claude",
        cwd: "/workspace",
        entrypoint: "/bin/claude",
        isolateProjectInstructions: false,
        model: "haiku",
      }));
      assert.equal(boundFresh, freshClaude);

      const grok = manager.getOrCreateGrokRunner(grokOptions());
      manager.setRunner("grok", "session-grok", grok, "high", "coding", "grok-4", {});
      assert.equal(stored(manager, "grok", "session-grok").command, "grok");
      assert.equal(stored(manager, "grok", "session-grok").cwd, "/workspace");
      assert.equal(manager.getOrCreateGrokRunner(grokOptions()), grok);
      const freshGrok = new GrokInteractiveRunner({ command: "grok", cwd: "/workspace", agentArgs: [], localSessionId: null });
      manager.setRunner("grok", "fresh-grok", freshGrok, "high", "coding", "grok-4", { cwd: "/workspace" });
      assert.equal(stored(manager, "grok", "fresh-grok").command, "");
      assert.equal(manager.getOrCreateGrokRunner(grokOptions("fresh-grok", { command: "" })), freshGrok);
      const otherGrok = manager.getOrCreateGrokRunner(grokOptions("fresh-grok", { command: "grok" }));
      assert.notEqual(otherGrok, freshGrok);
    } finally {
      restoreDispose();
      restoreSession();
      restoreUpdate();
    }
  });
});

test("detach drops only the matching runner object and never disposes it", async () => {
  await withManagerAsync(async (manager) => {
    const first = manager.getOrCreateCodexRunner(codexOptions());
    const second = newCodexRunner();
    let disposes = 0;
    const original = CodexInteractiveRunner.prototype.dispose;
    const restore = replaceMethod(CodexInteractiveRunner.prototype, "dispose", function (this: CodexRunner) {
      disposes += 1;
      return original.call(this);
    });
    try {
      manager.setRunner("codex", "session-codex", second, "medium", "coding", "gpt-5.5", {
        configId: "config-a",
        command: "codex",
        cwd: "/workspace",
      });
      assert.equal(disposes, 1);
      manager.detachRunner("codex", "session-codex", first);
      manager.detachRunner("codex", "other-session", second);
      manager.detachRunner("codex", null, second);
      assert.equal(manager.hasCodexRunner("session-codex", second), true);
      assert.equal(disposes, 1);
      manager.detachRunner("codex", "session-codex", second);
      assert.equal(manager.hasCodexRunner("session-codex", second), false);
      assert.equal(disposes, 1);
      await second.ensureReady();
    } finally {
      restore();
    }
  });
});

test("dispose and stop stay inside one CLI and propagate runner errors", () => {
  withManager((manager) => {
    const codex = manager.getOrCreateCodexRunner(codexOptions({ sessionId: "shared" }));
    const claude = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "shared" }));
    const grok = manager.getOrCreateGrokRunner(grokOptions("shared"));
    const seen: string[] = [];
    const restoreCodex = replaceMethod(CodexInteractiveRunner.prototype, "stopAndRebuild", function () {
      seen.push("codex");
    });
    const restoreClaude = replaceMethod(ClaudeInteractiveRunner.prototype, "stopAndRebuild", function () {
      seen.push("claude");
    });
    const restoreGrok = replaceMethod(GrokInteractiveRunner.prototype, "cancelTurn", function () {
      seen.push("grok");
    });
    try {
      manager.stopTurnAndRebuild("codex", "shared");
      manager.stopTurnAndRebuild("claude", "shared");
      manager.stopTurnAndRebuild("grok", "shared");
      manager.stopTurnAndRebuild("opencode", "shared");
      manager.stopTurnAndRebuild("codex", null);
      manager.stopTurnAndRebuild("codex", "");
      manager.beginActiveRun("opencode", "shared");
      manager.endActiveRun("claude", null);
      manager.disposeIfMatches("opencode", "shared");
      manager.disposeIfMatches("codex", null);
      assert.deepEqual(seen, ["codex", "claude", "grok"]);
      assert.equal(manager.hasCodexRunner("shared", codex), true);
      assert.equal(manager.hasClaudeRunner("shared", claude), true);
      assert.equal(manager.hasGrokRunner("shared", grok), true);

      restoreCodex();
      const restoreThrow = replaceMethod(CodexInteractiveRunner.prototype, "stopAndRebuild", function () {
        throw new Error("stop boom");
      });
      try {
        assert.throws(() => manager.stopTurnAndRebuild("codex", "shared"), /stop boom/);
      } finally {
        restoreThrow();
      }
      assert.equal(manager.hasCodexRunner("shared", codex), true);
      assert.equal(manager.hasClaudeRunner("shared", claude), true);

      manager.disposeForCli("codex");
      assert.equal(manager.hasCodexRunner("shared", codex), false);
      assert.equal(manager.hasClaudeRunner("shared", claude), true);
      assert.equal(manager.hasGrokRunner("shared", grok), true);
      manager.disposeIfMatches("grok", "shared");
      manager.disposeIfMatches("grok", "shared");
      assert.equal(manager.hasGrokRunner("shared", grok), false);
      assert.equal(manager.hasClaudeRunner("shared", claude), true);
    } finally {
      restoreGrok();
      restoreClaude();
      restoreCodex();
    }
  });
});

test("dispose reports the runner error before deleting the entry or continuing the sweep", () => {
  withManager((manager) => {
    const events: string[] = [];
    const first = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "a" }));
    const second = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "b" }));
    const originalClear = global.clearTimeout;
    global.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
      events.push("clear");
      return originalClear(handle);
    }) as typeof clearTimeout;
    const originalDispose = ClaudeInteractiveRunner.prototype.dispose;
    const restoreDispose = replaceMethod(ClaudeInteractiveRunner.prototype, "dispose", function (this: ClaudeRunner) {
      events.push("dispose");
      return originalDispose.call(this);
    });
    try {
      manager.disposeIfMatches("claude", "a");
      assert.deepEqual(events, ["clear", "dispose"]);
      assert.equal(manager.hasClaudeRunner("a", first), false);
      assert.equal(first.isDisposed(), true);
      events.length = 0;
      const restoreThrow = replaceMethod(ClaudeInteractiveRunner.prototype, "dispose", function () {
        events.push("dispose");
        throw new Error("dispose boom");
      });
      try {
        assert.throws(() => manager.disposeForCli("claude"), /dispose boom/);
      } finally {
        restoreThrow();
      }
      assert.deepEqual(events, ["clear", "dispose"]);
      assert.equal(manager.hasClaudeRunner("b", second), true);
      assert.equal(second.isDisposed(), false);
    } finally {
      restoreDispose();
      global.clearTimeout = originalClear;
    }
  });
});

test("updateOptions and constructor failures propagate without a partial entry", async () => {
  await withManagerAsync(async (manager) => {
    const first = manager.getOrCreateCodexRunner(codexOptions());
    const originalUpdate = CodexInteractiveRunner.prototype.updateOptions;
    const restoreUpdate = replaceMethod(CodexInteractiveRunner.prototype, "updateOptions", function () {
      throw new Error("update boom");
    });
    try {
      assert.throws(() => manager.getOrCreateCodexRunner(codexOptions({ model: "gpt-5.6" })), /update boom/);
    } finally {
      restoreUpdate();
    }
    assert.equal(manager.hasCodexRunner("session-codex", first), true);
    assert.deepEqual(manager.getCodexRunnerSelection("session-codex"), {
      configId: "config-a",
      model: "gpt-5.6",
    });
    originalUpdate.call(first, {
      command: "codex",
      args: ["--a"],
      cwd: "/workspace",
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: "gpt-5.6",
      threadId: "thread-a",
    });

    const order: string[] = [];
    const Original = codexModule.CodexInteractiveRunner;
    let failNext = false;
    const restoreConstructor = replaceMethod(codexModule, "CodexInteractiveRunner", function (this: unknown, options: ConstructorParameters<typeof Original>[0]) {
      if (failNext) {
        order.push("construct-fail");
        throw new Error("construct boom");
      }
      order.push("construct");
      return new Original(options);
    } as unknown as typeof Original);
    const originalDispose = Original.prototype.dispose;
    const restoreDispose = replaceMethod(Original.prototype, "dispose", function (this: CodexRunner) {
      order.push("dispose");
      return originalDispose.call(this);
    });
    try {
      failNext = true;
      assert.throws(() => manager.getOrCreateCodexRunner(codexOptions({ configId: "config-b" })), /construct boom/);
      assert.deepEqual(order, ["dispose", "construct-fail"]);
      assert.equal(manager.hasCodexRunner("session-codex", first), false);
      assert.equal(manager.getCodexRunnerSelection("session-codex"), null);
      await assert.rejects(() => first.ensureReady());
      failNext = false;
      order.length = 0;
      const recovered = manager.getOrCreateCodexRunner(codexOptions({ configId: "config-b" }));
      assert.deepEqual(order, ["construct"]);
      assert.equal(manager.hasCodexRunner("session-codex", recovered), true);
      assert.deepEqual(manager.getCodexRunnerSelection("session-codex"), {
        configId: "config-b",
        model: "gpt-5.5",
      });
    } finally {
      restoreDispose();
      restoreConstructor();
    }
  });
});

test("Claude and Grok constructors that throw do not leave entries or clear an unrelated runner", () => {
  withManager((manager) => {
    const kept = manager.getOrCreateGrokRunner(grokOptions("keep"));
    let grokConstructions = 0;
    const OriginalGrok = grokModule.GrokInteractiveRunner;
    const restoreGrok = replaceMethod(grokModule, "GrokInteractiveRunner", function () {
      grokConstructions += 1;
      throw new Error("grok construct boom");
    } as unknown as typeof OriginalGrok);
    try {
      assert.throws(() => manager.getOrCreateGrokRunner(grokOptions("   ")), (error: unknown) => {
        assert.equal((error as Error).message, "empty grok session");
        return true;
      });
      assert.equal(grokConstructions, 0);
      assert.throws(() => manager.getOrCreateGrokRunner(grokOptions()), /grok construct boom/);
      assert.equal(grokConstructions, 1);
      assert.equal(manager.hasGrokRunner("session-grok", kept), false);
      assert.equal(manager.hasGrokRunner("keep", kept), true);
    } finally {
      restoreGrok();
    }

    const OriginalClaude = claudeModule.ClaudeInteractiveRunner;
    const restoreClaude = replaceMethod(claudeModule, "ClaudeInteractiveRunner", function () {
      throw new Error("claude construct boom");
    } as unknown as typeof OriginalClaude);
    try {
      assert.throws(() => manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "new-claude" })), /claude construct boom/);
      assert.equal(storedEntries(manager).has("claude:new-claude"), false);
    } finally {
      restoreClaude();
    }
  });
});

function timerCreatedBy(
  clock: ReturnType<typeof installControlledClock>,
  before: FakeTimer[],
): FakeTimer {
  const created = clock.active().filter((timer) => !before.includes(timer));
  assert.equal(created.length, 1);
  return created[0];
}

test("idle disposal starts at 24 hours minus two seconds and does not unref the timer", () => {
  withClock((clock, manager) => {
    const before = clock.active();
    const runner = manager.getOrCreateClaudeRunner(claudeOptions());
    const timer = timerCreatedBy(clock, before);
    assert.equal(timer.delay, IDLE_TIMEOUT_MS);
    assert.equal(clock.unrefCalls(), 0);
    clock.advance(IDLE_TIMEOUT_MS - 2000 - 1);
    timer.callback();
    assert.equal(runner.isDisposed(), false);
    clock.advance(1);
    timer.callback();
    assert.equal(runner.isDisposed(), true);
    assert.equal(manager.hasClaudeRunner("session-claude", runner), false);
  });
});

test("an active run cancels idle disposal until endActiveRun arms it again", () => {
  withClock((clock, manager) => {
    const codexBefore = clock.active();
    const codex = manager.getOrCreateCodexRunner(codexOptions());
    const codexTimer = timerCreatedBy(clock, codexBefore);
    const claudeBefore = clock.active();
    const claude = manager.getOrCreateClaudeRunner(claudeOptions());
    const claudeTimer = timerCreatedBy(clock, claudeBefore);

    manager.beginActiveRun("claude", "session-claude");
    assert.equal(claudeTimer.cleared, true);
    assert.equal(codexTimer.cleared, false);
    clock.advance(IDLE_TIMEOUT_MS * 2);
    clock.fireDue();
    assert.equal(claude.isDisposed(), false);
    assert.equal(manager.hasCodexRunner("session-codex", codex), false);

    manager.endActiveRun("claude", "session-claude");
    const resumed = clock.active();
    assert.equal(resumed.length, 1);
    clock.advance(IDLE_TIMEOUT_MS - 1);
    clock.fireDue();
    assert.equal(claude.isDisposed(), false);
    clock.advance(1);
    clock.fireDue();
    assert.equal(claude.isDisposed(), true);
    assert.equal(clock.unrefCalls(), 0);
  });
});

test("a stale idle callback does not dispose the runner that replaced it", () => {
  withClock((clock, manager) => {
    const before = clock.active();
    const first = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "stale" }));
    const stale = timerCreatedBy(clock, before);
    const second = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "stale", model: "haiku" }));
    assert.notEqual(second, first);
    assert.equal(first.isDisposed(), true);
    assert.equal(stale.cleared, true);
    clock.advance(IDLE_TIMEOUT_MS);
    stale.callback();
    assert.equal(second.isDisposed(), false);
    assert.equal(manager.hasClaudeRunner("stale", second), true);

    const touchBefore = clock.active();
    const touched = manager.getOrCreateGrokRunner(grokOptions("touched"));
    const oldTimer = timerCreatedBy(clock, touchBefore);
    clock.advance(23 * 60 * 60 * 1000);
    manager.endActiveRun("grok", "touched");
    assert.equal(oldTimer.cleared, true);
    clock.advance(2 * 60 * 60 * 1000);
    clock.fireDue();
    assert.equal(touched.isReusable(), true);
    clock.advance(22 * 60 * 60 * 1000);
    clock.fireDue();
    assert.equal(touched.isReusable(), false);
    assert.equal(manager.hasGrokRunner("touched", touched), false);
  });
});

test("detach and a thrown stop leave the current runner registered", async () => {
  await withManagerAsync(async (manager) => {
    const clock = installControlledClock();
    try {
      const before = clock.active();
      const detached = manager.getOrCreateCodexRunner(codexOptions({ sessionId: "detached" }));
      const detachedTimer = timerCreatedBy(clock, before);
      manager.detachRunner("codex", "detached", detached);
      clock.advance(IDLE_TIMEOUT_MS);
      detachedTimer.callback();
      assert.equal(manager.hasCodexRunner("detached", detached), false);
      await detached.ensureReady();

      const stopBefore = clock.active();
      const codex = manager.getOrCreateCodexRunner(codexOptions());
      const stopTimer = timerCreatedBy(clock, stopBefore);
      const restore = replaceMethod(CodexInteractiveRunner.prototype, "stopAndRebuild", function () {
        throw new Error("stop boom");
      });
      try {
        assert.throws(() => manager.stopTurnAndRebuild("codex", "session-codex"), /stop boom/);
      } finally {
        restore();
      }
      assert.equal(stopTimer.cleared, false);
      assert.equal(manager.hasCodexRunner("session-codex", codex), true);
      assert.equal(clock.unrefCalls(), 0);
    } finally {
      manager.disposeAll();
      clock.restore();
    }
  });
});

type ContractDiagnostic = {
  code: number;
  line: number;
  message: string;
};

function contractDiagnostics(overrides: Record<string, string>): ContractDiagnostic[] {
  const configPath = path.join(process.cwd(), "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, process.cwd());
  const contents = new Map<string, string>();
  for (const [fileName, source] of Object.entries(overrides)) {
    const resolved = path.resolve(fileName);
    contents.set(resolved, source);
    try {
      contents.set(fs.realpathSync(resolved), source);
    } catch {
    }
  }
  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => contents.has(path.resolve(fileName)) || fileExists(fileName);
  host.readFile = (fileName) => contents.get(path.resolve(fileName)) ?? readFile(fileName);
  const program = ts.createProgram(Object.keys(overrides).map((fileName) => path.resolve(fileName)), parsed.options, host);
  return ts.getPreEmitDiagnostics(program).flatMap((diagnostic) => {
    if (!diagnostic.file) {
      return [];
    }
    const resolved = path.resolve(diagnostic.file.fileName);
    let canonical = resolved;
    try {
      canonical = fs.realpathSync(resolved);
    } catch {
      canonical = resolved;
    }
    if (!contents.has(resolved) && !contents.has(canonical)) {
      return [];
    }
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return [{
      code: diagnostic.code,
      line: position.line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }];
  });
}

function blockSpan(source: string, name: string): { start: number; end: number } {
  const lines = source.split("\n");
  const startIndex = lines.findIndex((line) => line.startsWith(`function ${name}(`) || line.includes(` ${name}(`));
  assert.ok(startIndex >= 0, `missing ${name}`);
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("function ") || lines[index].startsWith("  private ")) {
      endIndex = index;
      break;
    }
  }
  return { start: startIndex + 1, end: endIndex + 1 };
}

function renderDiagnostics(diagnostics: ContractDiagnostic[]): string {
  return diagnostics.map((diagnostic) => `TS${diagnostic.code} ${diagnostic.line} ${diagnostic.message}`).join("\n");
}

function assertRejected(
  source: string,
  diagnostics: ContractDiagnostic[],
  name: string,
  expected: { codes?: number[]; messageIncludes?: string },
): void {
  const span = blockSpan(source, name);
  const hits = diagnostics.filter((diagnostic) => diagnostic.line >= span.start && diagnostic.line < span.end);
  const rendered = renderDiagnostics(diagnostics);
  assert.ok(hits.length > 0, `${name} compiled without a diagnostic\n${rendered}`);
  if (expected.codes !== undefined) {
    const codes = expected.codes;
    assert.ok(hits.some((diagnostic) => codes.includes(diagnostic.code)), `${name} missing TS${codes.join("/")}\n${rendered}`);
  }
  if (expected.messageIncludes !== undefined) {
    const needle = expected.messageIncludes;
    assert.ok(hits.some((diagnostic) => diagnostic.message.includes(needle)), `${name} missing ${needle}\n${rendered}`);
  }
}

const registrationContractPath = path.join(process.cwd(), "src/test/interactive/__virtualRegistrationContract.ts");

const registrationPositiveSource = `
import { InteractiveRunnerManager } from "../../interactive/manager";
import type { ClaudeInteractiveRunner } from "../../interactive/claudeRunner";
import type { CodexInteractiveRunner } from "../../interactive/codexRunner";
import type { GrokInteractiveRunner } from "../../interactive/grokRunner";
import type { RunnerEntry, RunnerRegistration, RunnerRegistrationByCli } from "../../interactive/runnerLifecycleTypes";

declare const manager: InteractiveRunnerManager;
declare const codexRunner: CodexInteractiveRunner;
declare const claudeRunner: ClaudeInteractiveRunner;
declare const grokRunner: GrokInteractiveRunner;

manager.setRunner("codex", "s", claudeRunner, "medium", "coding", null);
manager.setRunner("claude", "s", codexRunner, "medium", "coding", null);
manager.setRunner("grok", "s", grokRunner, "high", "plan", null);

const codexOk: RunnerRegistrationByCli["codex"] = {
  cli: "codex",
  sessionId: "s",
  runner: codexRunner,
  thinkingMode: "medium",
  interactiveMode: "coding",
  model: null,
  configId: null,
  args: [],
};
const claudeOk: RunnerRegistrationByCli["claude"] = {
  cli: "claude",
  sessionId: "s",
  runner: claudeRunner,
  thinkingMode: "medium",
  interactiveMode: "coding",
  model: null,
  command: "claude",
  args: [],
  isolateProjectInstructions: false,
};
const grokOk: RunnerRegistrationByCli["grok"] = {
  cli: "grok",
  sessionId: "s",
  runner: grokRunner,
  thinkingMode: "medium",
  interactiveMode: "coding",
  model: null,
  command: "grok",
  args: [],
};
const codexUnion: RunnerRegistration<RunnerEntry> = codexOk;
const claudeUnion: RunnerRegistration<RunnerEntry> = claudeOk;
const grokUnion: RunnerRegistration<RunnerEntry> = grokOk;

function codexEntry(registration: RunnerRegistrationByCli["codex"]): RunnerEntry {
  return { ...registration, idleTimer: null, lastUsedAt: 0 };
}
function claudeEntry(registration: RunnerRegistrationByCli["claude"]): RunnerEntry {
  return { ...registration, idleTimer: null, lastUsedAt: 0 };
}
function grokEntry(registration: RunnerRegistrationByCli["grok"]): RunnerEntry {
  return { ...registration, idleTimer: null, lastUsedAt: 0 };
}

void codexEntry(codexUnion.cli === "codex" ? codexUnion : codexOk);
void claudeEntry(claudeOk);
void grokEntry(grokOk);
void claudeUnion;
void grokUnion;
`;

const registrationNegativeSource = `
import type { ClaudeInteractiveRunner } from "../../interactive/claudeRunner";
import type { CodexInteractiveRunner } from "../../interactive/codexRunner";
import type { GrokInteractiveRunner } from "../../interactive/grokRunner";
import type { RunnerEntry, RunnerRegistration } from "../../interactive/runnerLifecycleTypes";

declare const codexRunner: CodexInteractiveRunner;
declare const claudeRunner: ClaudeInteractiveRunner;
declare const grokRunner: GrokInteractiveRunner;

function caseCrossRunner(): void {
  const viaVar = {
    cli: "codex" as const,
    sessionId: "s",
    runner: claudeRunner,
    thinkingMode: "medium" as const,
    interactiveMode: "coding" as const,
    model: null as string | null,
    configId: null,
    args: [] as string[],
  };
  const assigned: RunnerRegistration<RunnerEntry> = viaVar;
  void assigned;
}

function caseMissingConfig(): void {
  const viaVar = {
    cli: "codex" as const,
    sessionId: "s",
    runner: codexRunner,
    thinkingMode: "medium" as const,
    interactiveMode: "coding" as const,
    model: null as string | null,
    args: [] as string[],
  };
  const assigned: RunnerRegistration<RunnerEntry> = viaVar;
  void assigned;
}

function caseMissingIsolate(): void {
  const viaVar = {
    cli: "claude" as const,
    sessionId: "s",
    runner: claudeRunner,
    thinkingMode: "medium" as const,
    interactiveMode: "coding" as const,
    model: null as string | null,
    command: "claude",
    args: [] as string[],
  };
  const assigned: RunnerRegistration<RunnerEntry> = viaVar;
  void assigned;
}

function caseMissingCommand(): void {
  const viaVar = {
    cli: "grok" as const,
    sessionId: "s",
    runner: grokRunner,
    thinkingMode: "medium" as const,
    interactiveMode: "coding" as const,
    model: null as string | null,
    args: [] as string[],
  };
  const assigned: RunnerRegistration<RunnerEntry> = viaVar;
  void assigned;
}

function caseDirectEntry(): void {
  const direct: RunnerEntry = {
    cli: "codex",
    sessionId: "s",
    runner: claudeRunner,
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: null,
    configId: null,
    args: [],
    idleTimer: null,
    lastUsedAt: 0,
  };
  void direct;
}
`;

const managerAnchor = "  private clearIdleTimer(entry: RunnerEntry): void {";

const reusePositiveProbe = `
  private __probeReusePositive(
    codexRunner: CodexInteractiveRunner,
    claudeRunner: ClaudeInteractiveRunner,
    grokRunner: GrokInteractiveRunner,
  ): void {
    const codex: CodexInteractiveRunner = this.reuseOrCreate(
      "codex",
      "session",
      (entry) => entry.configId === null,
      (entry) => {
        entry.configId = null;
      },
      () => codexRunner,
      (runner) => ({
        cli: "codex",
        sessionId: "session",
        runner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        configId: null,
        args: [],
      }),
    );
    const claude: ClaudeInteractiveRunner = this.reuseOrCreate(
      "claude",
      "session",
      (entry) => entry.isolateProjectInstructions === false,
      (entry) => {
        entry.isolateProjectInstructions = false;
      },
      () => claudeRunner,
      (runner) => ({
        cli: "claude",
        sessionId: "session",
        runner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        command: "claude",
        args: [],
        isolateProjectInstructions: false,
      }),
    );
    const grok: GrokInteractiveRunner = this.reuseOrCreate(
      "grok",
      "session",
      (entry) => entry.command === "grok",
      (entry) => {
        entry.command = "grok";
      },
      () => grokRunner,
      (runner) => ({
        cli: "grok",
        sessionId: "session",
        runner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        command: "grok",
        args: [],
      }),
    );
    this.registerExternalRunner(
      "codex",
      {
        sessionId: "session",
        runner: codexRunner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        options: {},
      },
      (entry) => {
        entry.configId = null;
      },
      () => ({
        cli: "codex",
        sessionId: "session",
        runner: codexRunner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        configId: null,
        args: [],
      }),
    );
    const codexEntry: RunnerEntry = this.withLifecycle({
      cli: "codex",
      sessionId: "session",
      runner: codexRunner,
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: null,
      configId: null,
      args: [],
    });
    const claudeEntry: RunnerEntry = this.withLifecycle({
      cli: "claude",
      sessionId: "session",
      runner: claudeRunner,
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: null,
      command: "claude",
      args: [],
      isolateProjectInstructions: false,
    });
    const grokEntry: RunnerEntry = this.withLifecycle({
      cli: "grok",
      sessionId: "session",
      runner: grokRunner,
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: null,
      command: "grok",
      args: [],
    });
    void codex;
    void claude;
    void grok;
    void codexEntry;
    void claudeEntry;
    void grokEntry;
  }
`;

const reuseNegativeProbe = `
  private __probeFactoryMismatch(claudeRunner: ClaudeInteractiveRunner): void {
    this.reuseOrCreate(
      "codex",
      "session",
      () => true,
      () => undefined,
      () => claudeRunner,
      (runner) => ({
        cli: "codex",
        sessionId: "session",
        runner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        configId: null,
        args: [],
      }),
    );
  }

  private __probeRegistrationMismatch(
    codexRunner: CodexInteractiveRunner,
    claudeRunner: ClaudeInteractiveRunner,
  ): void {
    this.reuseOrCreate(
      "codex",
      "session",
      () => true,
      () => undefined,
      () => codexRunner,
      () => ({
        cli: "claude",
        sessionId: "session",
        runner: claudeRunner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        command: "claude",
        args: [],
        isolateProjectInstructions: false,
      }),
    );
  }

  private __probeMissingConfig(codexRunner: CodexInteractiveRunner): void {
    this.reuseOrCreate(
      "codex",
      "session",
      () => true,
      () => undefined,
      () => codexRunner,
      (runner) => ({
        cli: "codex",
        sessionId: "session",
        runner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        args: [],
      }),
    );
  }

  private __probeWithLifecycleCross(claudeRunner: ClaudeInteractiveRunner): void {
    const viaVar = {
      cli: "codex" as const,
      sessionId: "session",
      runner: claudeRunner,
      thinkingMode: "medium" as const,
      interactiveMode: "coding" as const,
      model: null as string | null,
      configId: null,
      args: [] as string[],
    };
    this.withLifecycle(viaVar);
  }

  private __probeRegisterMismatch(claudeRunner: ClaudeInteractiveRunner): void {
    this.registerExternalRunner(
      "codex",
      {
        sessionId: "session",
        runner: claudeRunner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        options: {},
      },
      () => undefined,
      () => ({
        cli: "codex",
        sessionId: "session",
        runner: claudeRunner,
        thinkingMode: "medium",
        interactiveMode: "coding",
        model: null,
        configId: null,
        args: [],
      }),
    );
  }
`;

function patchedManager(probe: string): string {
  const source = fs.readFileSync(path.join(process.cwd(), "src/interactive/manager.ts"), "utf8");
  assert.equal(source.includes(managerAnchor), true);
  return source.replace(managerAnchor, `${probe}\n${managerAnchor}`);
}

test("registration keeps each platform runner and its required fields", () => {
  const positive = contractDiagnostics({ [registrationContractPath]: registrationPositiveSource });
  assert.deepEqual(positive, [], renderDiagnostics(positive));
  const negative = contractDiagnostics({ [registrationContractPath]: registrationNegativeSource });
  assertRejected(registrationNegativeSource, negative, "caseCrossRunner", { codes: [2322], messageIncludes: "runner" });
  assertRejected(registrationNegativeSource, negative, "caseMissingConfig", { codes: [2322, 2741], messageIncludes: "configId" });
  assertRejected(registrationNegativeSource, negative, "caseMissingIsolate", { codes: [2322, 2741], messageIncludes: "isolateProjectInstructions" });
  assertRejected(registrationNegativeSource, negative, "caseMissingCommand", { codes: [2322, 2741], messageIncludes: "command" });
  assertRejected(registrationNegativeSource, negative, "caseDirectEntry", { codes: [2322], messageIncludes: "runner" });
});

test("shared reuse flow rejects a CLI that does not match its factory or registration", () => {
  const managerPath = path.join(process.cwd(), "src/interactive/manager.ts");
  const positiveSource = patchedManager(reusePositiveProbe);
  const positive = contractDiagnostics({ [managerPath]: positiveSource });
  assert.deepEqual(positive, [], renderDiagnostics(positive));
  const negativeSource = patchedManager(reuseNegativeProbe);
  const negative = contractDiagnostics({ [managerPath]: negativeSource });
  assertRejected(negativeSource, negative, "__probeFactoryMismatch", { codes: [2322, 2740], messageIncludes: "CodexInteractiveRunner" });
  assertRejected(negativeSource, negative, "__probeRegistrationMismatch", { codes: [2322], messageIncludes: "codex" });
  assertRejected(negativeSource, negative, "__probeMissingConfig", { codes: [2322, 2741], messageIncludes: "configId" });
  assertRejected(negativeSource, negative, "__probeWithLifecycleCross", { codes: [2322, 2345], messageIncludes: "runner" });
  assertRejected(negativeSource, negative, "__probeRegisterMismatch", { codes: [2322, 2345, 2740], messageIncludes: "ClaudeInteractiveRunner" });
  const anchorLine = negativeSource.split("\n").findIndex((line) => line === managerAnchor) + 1;
  assert.ok(negative.every((diagnostic) => diagnostic.line < anchorLine), renderDiagnostics(negative));
});
