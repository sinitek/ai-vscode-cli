import { CliName, ThinkingMode } from "../cli/types";
import { CodexInteractiveRunner } from "./codexRunner";
import { ClaudeInteractiveRunner } from "./claudeRunner";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

type RunnerEntry =
  | {
      cli: "codex";
      sessionId: string;
      runner: CodexInteractiveRunner;
      thinkingMode: ThinkingMode;
      idleTimer: NodeJS.Timeout | null;
      lastUsedAt: number;
    }
  | {
      cli: "claude";
      sessionId: string;
      runner: ClaudeInteractiveRunner;
      thinkingMode: ThinkingMode;
      idleTimer: NodeJS.Timeout | null;
      lastUsedAt: number;
    };

export class InteractiveRunnerManager {
  private current: RunnerEntry | null = null;

  public disposeAll(): void {
    if (!this.current) {
      return;
    }
    this.clearIdleTimer(this.current);
    this.current.runner.dispose();
    this.current = null;
  }

  public disposeIfMatches(cli: CliName, sessionId: string | null): void {
    if (!this.current) {
      return;
    }
    if (this.current.cli !== cli) {
      return;
    }
    if (!sessionId || this.current.sessionId !== sessionId) {
      return;
    }
    this.disposeAll();
  }

  public disposeForCli(cli: CliName): void {
    if (!this.current) {
      return;
    }
    if (this.current.cli !== cli) {
      return;
    }
    this.disposeAll();
  }

  public setCurrentRunner(
    cli: "codex" | "claude",
    sessionId: string,
    runner: any,
    thinkingMode: ThinkingMode
  ): void {
    this.disposeAll();
    const entry: RunnerEntry =
      cli === "codex"
        ? { cli, sessionId, runner, thinkingMode, idleTimer: null, lastUsedAt: Date.now() }
        : { cli, sessionId, runner, thinkingMode, idleTimer: null, lastUsedAt: Date.now() };
    this.current = entry;
    this.touch();
  }

  public getCurrent(): RunnerEntry | null {
    return this.current;
  }

  public getOrCreateCodexRunner(options: {
    sessionId: string;
    threadId: string | null;
    command: string;
    args: string[];
    cwd?: string;
    thinkingMode: ThinkingMode;
  }): CodexInteractiveRunner {
    if (this.current && this.current.cli === "codex" && this.current.sessionId === options.sessionId) {
      if (this.current.thinkingMode === options.thinkingMode) {
        this.touch();
        return this.current.runner;
      }
      this.disposeAll();
    }
    const runner = new CodexInteractiveRunner({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      thinkingMode: options.thinkingMode,
      threadId: options.threadId,
    });
    this.current = {
      cli: "codex",
      sessionId: options.sessionId,
      runner,
      thinkingMode: options.thinkingMode,
      idleTimer: null,
      lastUsedAt: Date.now(),
    };
    this.touch();
    return runner;
  }

  public getOrCreateClaudeRunner(options: {
    sessionId: string;
    mappedSessionId: string | null;
    command: string;
    args: string[];
    cwd?: string;
    thinkingMode: ThinkingMode;
  }): ClaudeInteractiveRunner {
    if (this.current && this.current.cli === "claude" && this.current.sessionId === options.sessionId) {
      if (this.current.thinkingMode === options.thinkingMode) {
        this.touch();
        return this.current.runner;
      }
      this.disposeAll();
    }
    const runner = new ClaudeInteractiveRunner({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      thinkingMode: options.thinkingMode,
      sessionId: options.mappedSessionId,
    });
    this.current = {
      cli: "claude",
      sessionId: options.sessionId,
      runner,
      thinkingMode: options.thinkingMode,
      idleTimer: null,
      lastUsedAt: Date.now(),
    };
    this.touch();
    return runner;
  }

  public stopCurrentTurnAndRebuild(): void {
    if (!this.current) {
      return;
    }
    this.current.runner.stopAndRebuild();
    this.touch();
  }

  private touch(): void {
    if (!this.current) {
      return;
    }
    this.current.lastUsedAt = Date.now();
    this.clearIdleTimer(this.current);
    this.current.idleTimer = setTimeout(() => {
      // Dispose on idle.
      if (!this.current) {
        return;
      }
      const idleFor = Date.now() - this.current.lastUsedAt;
      if (idleFor >= IDLE_TIMEOUT_MS - 2000) {
        this.disposeAll();
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
