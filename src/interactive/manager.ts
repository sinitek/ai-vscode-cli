import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { CodexInteractiveRunner } from "./codexRunner";
import { ClaudeInteractiveRunner } from "./claudeRunner";

const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

type RunnerEntry =
  | {
      cli: "codex";
      sessionId: string;
      runner: CodexInteractiveRunner;
      thinkingMode: ThinkingMode;
      interactiveMode: InteractiveMode;
      model: string | null;
      idleTimer: NodeJS.Timeout | null;
      lastUsedAt: number;
    }
  | {
      cli: "claude";
      sessionId: string;
      runner: ClaudeInteractiveRunner;
      thinkingMode: ThinkingMode;
      interactiveMode: InteractiveMode;
      model: string | null;
      idleTimer: NodeJS.Timeout | null;
      lastUsedAt: number;
    };

export class InteractiveRunnerManager {
  private readonly entries = new Map<string, RunnerEntry>();
  private currentKey: string | null = null;

  public disposeAll(): void {
    for (const entry of this.entries.values()) {
      this.clearIdleTimer(entry);
      entry.runner.dispose();
    }
    this.entries.clear();
    this.currentKey = null;
  }

  public disposeIfMatches(cli: CliName, sessionId: string | null): void {
    if (!sessionId) {
      return;
    }
    this.disposeEntry(this.buildKey(cli as "codex" | "claude", sessionId));
  }

  public disposeForCli(cli: CliName): void {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.cli === cli) {
        this.disposeEntry(key);
      }
    }
  }

  public setCurrentRunner(
    cli: "codex" | "claude",
    sessionId: string,
    runner: CodexInteractiveRunner | ClaudeInteractiveRunner,
    thinkingMode: ThinkingMode,
    interactiveMode: InteractiveMode,
    model: string | null
  ): void {
    const key = this.buildKey(cli, sessionId);
    const existing = this.entries.get(key);
    if (existing && existing.runner === runner) {
      existing.sessionId = sessionId;
      existing.thinkingMode = thinkingMode;
      existing.interactiveMode = interactiveMode;
      existing.model = model;
      this.currentKey = key;
      this.touch(existing);
      return;
    }
    if (existing) {
      this.disposeEntry(key);
    }
    const entry: RunnerEntry =
      cli === "codex"
        ? { cli, sessionId, runner: runner as CodexInteractiveRunner, thinkingMode, interactiveMode, model, idleTimer: null, lastUsedAt: Date.now() }
        : { cli, sessionId, runner: runner as ClaudeInteractiveRunner, thinkingMode, interactiveMode, model, idleTimer: null, lastUsedAt: Date.now() };
    this.entries.set(key, entry);
    this.currentKey = key;
    this.touch(entry);
  }

  public getCurrent(): RunnerEntry | null {
    if (!this.currentKey) {
      return null;
    }
    return this.entries.get(this.currentKey) ?? null;
  }

  public getOrCreateCodexRunner(options: {
    sessionId: string;
    threadId: string | null;
    command: string;
    args: string[];
    cwd?: string;
    thinkingMode: ThinkingMode;
    interactiveMode: InteractiveMode;
    model: string | null;
  }): CodexInteractiveRunner {
    const key = this.buildKey("codex", options.sessionId);
    const existing = this.entries.get(key);
    if (existing && existing.cli === "codex") {
      if (
        existing.thinkingMode === options.thinkingMode
        && existing.interactiveMode === options.interactiveMode
        && existing.model === options.model
      ) {
        this.currentKey = key;
        this.touch(existing);
        return existing.runner;
      }
      this.disposeEntry(key);
    }
    const runner = new CodexInteractiveRunner({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      thinkingMode: options.thinkingMode,
      interactiveMode: options.interactiveMode,
      model: options.model,
      threadId: options.threadId,
    });
    const entry: RunnerEntry = {
      cli: "codex",
      sessionId: options.sessionId,
      runner,
      thinkingMode: options.thinkingMode,
      interactiveMode: options.interactiveMode,
      model: options.model,
      idleTimer: null,
      lastUsedAt: Date.now(),
    };
    this.entries.set(key, entry);
    this.currentKey = key;
    this.touch(entry);
    return runner;
  }

  public getOrCreateClaudeRunner(options: {
    sessionId: string;
    mappedSessionId: string | null;
    command: string;
    args: string[];
    cwd?: string;
    thinkingMode: ThinkingMode;
    interactiveMode: InteractiveMode;
    model: string | null;
    entrypoint?: string;
  }): ClaudeInteractiveRunner {
    const key = this.buildKey("claude", options.sessionId);
    const existing = this.entries.get(key);
    if (existing && existing.cli === "claude") {
      if (
        existing.thinkingMode === options.thinkingMode
        && existing.interactiveMode === options.interactiveMode
        && existing.model === options.model
      ) {
        const runnerSessionId = existing.runner.getSessionId();
        const expectedSessionId = runnerSessionId || options.mappedSessionId;
        if (expectedSessionId && runnerSessionId !== expectedSessionId) {
          existing.runner.updateSessionId(expectedSessionId);
        }
        this.currentKey = key;
        this.touch(existing);
        return existing.runner;
      }
      this.disposeEntry(key);
    }
    const runner = new ClaudeInteractiveRunner({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      thinkingMode: options.thinkingMode,
      interactiveMode: options.interactiveMode,
      model: options.model,
      entrypoint: options.entrypoint,
      sessionId: options.mappedSessionId,
    });
    const entry: RunnerEntry = {
      cli: "claude",
      sessionId: options.sessionId,
      runner,
      thinkingMode: options.thinkingMode,
      interactiveMode: options.interactiveMode,
      model: options.model,
      idleTimer: null,
      lastUsedAt: Date.now(),
    };
    this.entries.set(key, entry);
    this.currentKey = key;
    this.touch(entry);
    return runner;
  }

  public stopCurrentTurnAndRebuild(): void {
    const entry = this.getCurrent();
    if (!entry) {
      return;
    }
    entry.runner.stopAndRebuild();
    this.touch(entry);
  }

  public beginActiveRun(): void {
    const entry = this.getCurrent();
    if (!entry) {
      return;
    }
    entry.lastUsedAt = Date.now();
    this.clearIdleTimer(entry);
  }

  public endActiveRun(): void {
    const entry = this.getCurrent();
    if (!entry) {
      return;
    }
    this.touch(entry);
  }

  private buildKey(cli: "codex" | "claude", sessionId: string): string {
    return `${cli}:${sessionId}`;
  }

  private disposeEntry(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    this.clearIdleTimer(entry);
    entry.runner.dispose();
    this.entries.delete(key);
    if (this.currentKey === key) {
      this.currentKey = null;
    }
  }

  private touch(entry: RunnerEntry): void {
    entry.lastUsedAt = Date.now();
    this.clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      const currentEntry = this.entries.get(this.buildKey(entry.cli, entry.sessionId));
      if (!currentEntry || currentEntry !== entry) {
        return;
      }
      const idleFor = Date.now() - currentEntry.lastUsedAt;
      if (idleFor >= IDLE_TIMEOUT_MS - 2000) {
        this.disposeEntry(this.buildKey(currentEntry.cli, currentEntry.sessionId));
      }
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(entry: RunnerEntry): void {
    if (!entry.idleTimer) {
      return;
    }
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}
