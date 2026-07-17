import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { CodexRunSelection, normalizeCodexRunSelection } from "./codexThreadSelection";
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
      configId: string | null;
      multiAgentEnabled: boolean;
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

type InteractiveRunnerCli = "codex" | "claude";

export class InteractiveRunnerManager {
  private readonly entries = new Map<string, RunnerEntry>();

  public disposeAll(): void {
    for (const entry of this.entries.values()) {
      this.clearIdleTimer(entry);
      entry.runner.dispose();
    }
    this.entries.clear();
  }

  public disposeIfMatches(cli: CliName, sessionId: string | null): void {
    if (!sessionId) {
      return;
    }
    const key = this.buildKeyForCli(cli, sessionId);
    if (!key) {
      return;
    }
    this.disposeEntry(key);
  }

  public disposeForCli(cli: CliName): void {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.cli === cli) {
        this.disposeEntry(key);
      }
    }
  }

  public setRunner(
    cli: InteractiveRunnerCli,
    sessionId: string,
    runner: CodexInteractiveRunner | ClaudeInteractiveRunner,
    thinkingMode: ThinkingMode,
    interactiveMode: InteractiveMode,
    model: string | null,
    options: { multiAgentEnabled?: boolean; configId?: string | null } = {}
  ): void {
    const key = this.buildKey(cli, sessionId);
    const existing = this.entries.get(key);
    const codexSelection = cli === "codex"
      ? normalizeCodexRunSelection({ configId: options.configId, model })
      : null;
    if (existing && existing.runner === runner) {
      existing.sessionId = sessionId;
      existing.thinkingMode = thinkingMode;
      existing.interactiveMode = interactiveMode;
      if (existing.cli === "codex") {
        existing.model = codexSelection?.model ?? null;
        existing.configId = codexSelection?.configId ?? null;
        existing.multiAgentEnabled = options.multiAgentEnabled === true;
      } else {
        existing.model = model;
      }
      this.touch(existing);
      return;
    }
    if (existing) {
      this.disposeEntry(key);
    }
    const entry: RunnerEntry =
      cli === "codex"
        ? {
            cli,
            sessionId,
            runner: runner as CodexInteractiveRunner,
            thinkingMode,
            interactiveMode,
            model: codexSelection?.model ?? null,
            configId: codexSelection?.configId ?? null,
            multiAgentEnabled: options.multiAgentEnabled === true,
            idleTimer: null,
            lastUsedAt: Date.now(),
          }
        : { cli, sessionId, runner: runner as ClaudeInteractiveRunner, thinkingMode, interactiveMode, model, idleTimer: null, lastUsedAt: Date.now() };
    this.entries.set(key, entry);
    this.touch(entry);
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
    configId?: string | null;
    multiAgentEnabled: boolean;
  }): CodexInteractiveRunner {
    const key = this.buildKey("codex", options.sessionId);
    const existing = this.entries.get(key);
    const nextSelection = normalizeCodexRunSelection({
      configId: options.configId,
      model: options.model,
    });
    if (existing && existing.cli === "codex") {
      if (
        existing.thinkingMode === options.thinkingMode
        && existing.interactiveMode === options.interactiveMode
        && existing.model === nextSelection.model
        && existing.configId === nextSelection.configId
        && existing.multiAgentEnabled === options.multiAgentEnabled
      ) {
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
      model: nextSelection.model,
      threadId: options.threadId,
      multiAgentEnabled: options.multiAgentEnabled,
    });
    const entry: RunnerEntry = {
      cli: "codex",
      sessionId: options.sessionId,
      runner,
      thinkingMode: options.thinkingMode,
      interactiveMode: options.interactiveMode,
      model: nextSelection.model,
      configId: nextSelection.configId,
      multiAgentEnabled: options.multiAgentEnabled,
      idleTimer: null,
      lastUsedAt: Date.now(),
    };
    this.entries.set(key, entry);
    this.touch(entry);
    return runner;
  }

  public getCodexRunnerSelection(sessionId: string | null): CodexRunSelection | null {
    const entry = this.getEntry("codex", sessionId);
    if (!entry || entry.cli !== "codex") {
      return null;
    }
    return normalizeCodexRunSelection({
      configId: entry.configId,
      model: entry.model,
    });
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
    isolateProjectInstructions?: boolean;
  }): ClaudeInteractiveRunner {
    const key = this.buildKey("claude", options.sessionId);
    const existing = this.entries.get(key);
    if (existing && existing.cli === "claude") {
      if (
        existing.thinkingMode === options.thinkingMode
        && existing.interactiveMode === options.interactiveMode
        && existing.model === options.model
        && options.isolateProjectInstructions !== true
      ) {
        const runnerSessionId = existing.runner.getSessionId();
        const expectedSessionId = runnerSessionId || options.mappedSessionId;
        if (expectedSessionId && runnerSessionId !== expectedSessionId) {
          existing.runner.updateSessionId(expectedSessionId);
        }
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
      isolateProjectInstructions: options.isolateProjectInstructions,
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
    this.touch(entry);
    return runner;
  }

  public stopTurnAndRebuild(cli: CliName, sessionId: string | null): void {
    const entry = this.getEntry(cli, sessionId);
    if (!entry) {
      return;
    }
    entry.runner.stopAndRebuild();
    this.touch(entry);
  }

  public beginActiveRun(cli: CliName, sessionId: string | null): void {
    const entry = this.getEntry(cli, sessionId);
    if (!entry) {
      return;
    }
    entry.lastUsedAt = Date.now();
    this.clearIdleTimer(entry);
  }

  public endActiveRun(cli: CliName, sessionId: string | null): void {
    const entry = this.getEntry(cli, sessionId);
    if (!entry) {
      return;
    }
    this.touch(entry);
  }

  private buildKey(cli: InteractiveRunnerCli, sessionId: string): string {
    return `${cli}:${sessionId}`;
  }

  private buildKeyForCli(cli: CliName, sessionId: string | null): string | null {
    if (!sessionId || !this.isInteractiveRunnerCli(cli)) {
      return null;
    }
    return this.buildKey(cli, sessionId);
  }

  private getEntry(cli: CliName, sessionId: string | null): RunnerEntry | null {
    const key = this.buildKeyForCli(cli, sessionId);
    if (!key) {
      return null;
    }
    return this.entries.get(key) ?? null;
  }

  private isInteractiveRunnerCli(cli: CliName): cli is InteractiveRunnerCli {
    return cli === "codex" || cli === "claude";
  }

  private disposeEntry(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    this.clearIdleTimer(entry);
    entry.runner.dispose();
    this.entries.delete(key);
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
