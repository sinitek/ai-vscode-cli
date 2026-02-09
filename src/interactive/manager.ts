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
      idleTimer: NodeJS.Timeout | null;
      lastUsedAt: number;
    }
  | {
      cli: "claude";
      sessionId: string;
      runner: ClaudeInteractiveRunner;
      thinkingMode: ThinkingMode;
      interactiveMode: InteractiveMode;
      idleTimer: NodeJS.Timeout | null;
      lastUsedAt: number;
    };

export class InteractiveRunnerManager {
  private current: RunnerEntry | null = null;
  private activeRunCount = 0;

  public disposeAll(): void {
    if (!this.current) {
      this.activeRunCount = 0;
      return;
    }
    this.clearIdleTimer(this.current);
    this.current.runner.dispose();
    this.current = null;
    this.activeRunCount = 0;
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
    thinkingMode: ThinkingMode,
    interactiveMode: InteractiveMode
  ): void {
    if (this.current && this.current.runner === runner) {
      this.current.sessionId = sessionId;
      this.current.thinkingMode = thinkingMode;
      this.current.interactiveMode = interactiveMode;
      this.touch();
      return;
    }
    this.disposeAll();
    const entry: RunnerEntry =
      cli === "codex"
        ? { cli, sessionId, runner, thinkingMode, interactiveMode, idleTimer: null, lastUsedAt: Date.now() }
        : { cli, sessionId, runner, thinkingMode, interactiveMode, idleTimer: null, lastUsedAt: Date.now() };
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
    interactiveMode: InteractiveMode;
  }): CodexInteractiveRunner {
    if (this.current && this.current.cli === "codex" && this.current.sessionId === options.sessionId) {
      if (
        this.current.thinkingMode === options.thinkingMode
        && this.current.interactiveMode === options.interactiveMode
      ) {
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
      interactiveMode: options.interactiveMode,
      threadId: options.threadId,
    });
    this.current = {
      cli: "codex",
      sessionId: options.sessionId,
      runner,
      thinkingMode: options.thinkingMode,
      interactiveMode: options.interactiveMode,
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
    interactiveMode: InteractiveMode;
  }): ClaudeInteractiveRunner {
    if (this.current && this.current.cli === "claude" && this.current.sessionId === options.sessionId) {
      if (
        this.current.thinkingMode === options.thinkingMode
        && this.current.interactiveMode === options.interactiveMode
      ) {
        // 确保 runner 的 sessionId 与最新的 mappedSessionId 一致
        // 如果 runner 内部已有 sessionId，优先使用它（因为它是 SDK 返回的真实 session）
        // 否则使用 mappedSessionId
        const runnerSessionId = this.current.runner.getSessionId();
        const expectedSessionId = runnerSessionId || options.mappedSessionId;
        if (expectedSessionId && runnerSessionId !== expectedSessionId) {
          this.current.runner.updateSessionId(expectedSessionId);
        }
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
      interactiveMode: options.interactiveMode,
      sessionId: options.mappedSessionId,
    });
    this.current = {
      cli: "claude",
      sessionId: options.sessionId,
      runner,
      thinkingMode: options.thinkingMode,
      interactiveMode: options.interactiveMode,
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

  public beginActiveRun(): void {
    this.activeRunCount += 1;
    if (!this.current) {
      return;
    }
    this.current.lastUsedAt = Date.now();
    this.clearIdleTimer(this.current);
  }

  public endActiveRun(): void {
    if (this.activeRunCount > 0) {
      this.activeRunCount -= 1;
    }
    if (this.activeRunCount > 0) {
      return;
    }
    this.touch();
  }

  private touch(): void {
    if (!this.current) {
      return;
    }
    this.current.lastUsedAt = Date.now();
    this.clearIdleTimer(this.current);
    if (this.activeRunCount > 0) {
      return;
    }
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
