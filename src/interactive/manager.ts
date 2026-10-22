import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { CodexRunSelection } from "./codexThreadSelection";
import { CodexInteractiveRunner } from "./codexRunner";
import { ClaudeInteractiveRunner } from "./claudeRunner";
import { GrokInteractiveRunner } from "./grokRunner";
import {
  runnerLifecycleStrategies,
  stopManagedRunner,
} from "./runnerLifecycleStrategies";
import type {
  ClaudeRunnerCreateOptions,
  CodexRunnerCreateOptions,
  GrokRunnerCreateOptions,
  InteractiveRunnerCli,
  RunnerByCli,
  RunnerEntry,
  RunnerEntryByCli,
  RunnerRegistration,
  RunnerRegistrationByCli,
  RunnerSetOptions,
  SetRunnerMetadataInput,
} from "./runnerLifecycleTypes";

const platformEntries: {
  [TCli in InteractiveRunnerCli]: (entry: RunnerEntry) => RunnerEntryByCli[TCli] | undefined;
} = {
  codex: (entry) => entry.cli === "codex" ? entry : undefined,
  claude: (entry) => entry.cli === "claude" ? entry : undefined,
  grok: (entry) => entry.cli === "grok" ? entry : undefined,
};

const platformRunners: {
  [TCli in InteractiveRunnerCli]: (entry: RunnerEntryByCli[TCli]) => RunnerByCli[TCli];
} = {
  codex: (entry) => entry.runner,
  claude: (entry) => entry.runner,
  grok: (entry) => entry.runner,
};

const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

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
    runner: CodexInteractiveRunner | ClaudeInteractiveRunner | GrokInteractiveRunner,
    thinkingMode: ThinkingMode,
    interactiveMode: InteractiveMode,
    model: string | null,
    options: RunnerSetOptions = {}
  ): void {
    const metadata = {
      sessionId,
      thinkingMode,
      interactiveMode,
      model,
      options,
    };
    if (cli === "codex") {
      const codexRunner = runner as CodexInteractiveRunner;
      const input = { ...metadata, runner: codexRunner };
      this.registerExternalRunner("codex", input, (entry) => {
        runnerLifecycleStrategies.codex.applySetMetadata(entry, input);
      }, () => runnerLifecycleStrategies.codex.createSetRegistration(input));
      return;
    }
    if (cli === "claude") {
      const claudeRunner = runner as ClaudeInteractiveRunner;
      const input = { ...metadata, runner: claudeRunner };
      this.registerExternalRunner("claude", input, (entry) => {
        runnerLifecycleStrategies.claude.applySetMetadata(entry, input);
      }, () => runnerLifecycleStrategies.claude.createSetRegistration(input));
      return;
    }
    const grokRunner = runner as GrokInteractiveRunner;
    const input = { ...metadata, runner: grokRunner };
    this.registerExternalRunner("grok", input, (entry) => {
      runnerLifecycleStrategies.grok.applySetMetadata(entry, input);
    }, () => runnerLifecycleStrategies.grok.createSetRegistration(input));
  }

  public getOrCreateCodexRunner(options: CodexRunnerCreateOptions): CodexInteractiveRunner {
    const prepared = runnerLifecycleStrategies.codex.prepare(options);
    return this.reuseOrCreate(
      "codex",
      prepared.sessionId,
      (entry) => runnerLifecycleStrategies.codex.canReuse(entry, prepared),
      (entry) => {
        runnerLifecycleStrategies.codex.applyReuse(entry, prepared);
      },
      () => runnerLifecycleStrategies.codex.createRunner(prepared),
      (created) => runnerLifecycleStrategies.codex.createRegistration(prepared, created),
    );
  }

  public hasCodexRunner(sessionId: string | null, runner: CodexInteractiveRunner): boolean {
    const entry = this.getEntry("codex", sessionId);
    return Boolean(entry && entry.cli === "codex" && entry.runner === runner);
  }

  public hasClaudeRunner(sessionId: string | null, runner: ClaudeInteractiveRunner): boolean {
    const entry = this.getEntry("claude", sessionId);
    return Boolean(entry && entry.cli === "claude" && entry.runner === runner && !entry.runner.isDisposed());
  }

  public getCodexRunnerSelection(sessionId: string | null): CodexRunSelection | null {
    const entry = this.getEntry("codex", sessionId);
    if (!entry || !this.isEntryForCli(entry, "codex")) {
      return null;
    }
    return runnerLifecycleStrategies.codex.readSelection(entry);
  }

  public getOrCreateClaudeRunner(options: ClaudeRunnerCreateOptions): ClaudeInteractiveRunner {
    const prepared = runnerLifecycleStrategies.claude.prepare(options);
    return this.reuseOrCreate(
      "claude",
      prepared.sessionId,
      (entry) => runnerLifecycleStrategies.claude.canReuse(entry, prepared),
      (entry) => {
        runnerLifecycleStrategies.claude.applyReuse(entry, prepared);
      },
      () => runnerLifecycleStrategies.claude.createRunner(prepared),
      (created) => runnerLifecycleStrategies.claude.createRegistration(prepared, created),
    );
  }

  public hasGrokRunner(sessionId: string | null, runner: GrokInteractiveRunner): boolean {
    const entry = this.getEntry("grok", sessionId);
    return Boolean(entry && entry.cli === "grok" && entry.runner === runner);
  }

  public getOrCreateGrokRunner(options: GrokRunnerCreateOptions): GrokInteractiveRunner {
    const prepared = runnerLifecycleStrategies.grok.prepare(options);
    return this.reuseOrCreate(
      "grok",
      prepared.sessionId,
      (entry) => runnerLifecycleStrategies.grok.canReuse(entry, prepared),
      (entry) => {
        runnerLifecycleStrategies.grok.applyReuse(entry, prepared);
      },
      () => runnerLifecycleStrategies.grok.createRunner(prepared),
      (created) => runnerLifecycleStrategies.grok.createRegistration(prepared, created),
    );
  }

  public detachRunner(
    cli: InteractiveRunnerCli,
    sessionId: string | null,
    runner: CodexInteractiveRunner | ClaudeInteractiveRunner | GrokInteractiveRunner,
  ): void {
    const key = this.buildKeyForCli(cli, sessionId);
    if (!key) {
      return;
    }
    const entry = this.entries.get(key);
    if (!entry || entry.runner !== runner) {
      return;
    }
    this.clearIdleTimer(entry);
    this.entries.delete(key);
  }

  public stopTurnAndRebuild(cli: CliName, sessionId: string | null): void {
    const entry = this.getEntry(cli, sessionId);
    if (!entry) {
      return;
    }
    stopManagedRunner(entry);
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

  private reuseOrCreate<TCli extends InteractiveRunnerCli>(
    cli: TCli,
    sessionId: string,
    canReuse: (entry: RunnerEntryByCli[TCli]) => boolean,
    applyReuse: (entry: RunnerEntryByCli[TCli]) => void,
    createRunner: () => RunnerByCli[TCli],
    createRegistration: (runner: RunnerByCli[TCli]) => RunnerRegistrationByCli[TCli],
  ): RunnerByCli[TCli] {
    const key = this.buildKey(cli, sessionId);
    const existing = this.entries.get(key);
    const matched = existing ? platformEntries[cli](existing) : undefined;
    if (matched && canReuse(matched)) {
      applyReuse(matched);
      this.touch(matched);
      return platformRunners[cli](matched);
    }
    if (existing) {
      this.disposeEntry(key);
    }
    const runner = createRunner();
    const entry = this.withLifecycle(createRegistration(runner));
    this.entries.set(key, entry);
    this.touch(entry);
    return runner;
  }

  private registerExternalRunner<TCli extends InteractiveRunnerCli>(
    cli: TCli,
    input: SetRunnerMetadataInput<RunnerByCli[TCli]>,
    applySetMetadata: (entry: RunnerEntryByCli[TCli]) => void,
    createSetRegistration: () => RunnerRegistrationByCli[TCli],
  ): void {
    const key = this.buildKey(cli, input.sessionId);
    const existing = this.entries.get(key);
    const matched = existing ? platformEntries[cli](existing) : undefined;
    if (matched && matched.runner === input.runner) {
      applySetMetadata(matched);
      this.touch(matched);
      return;
    }
    if (existing) {
      this.disposeEntry(key);
    }
    const entry = this.withLifecycle(createSetRegistration());
    this.entries.set(key, entry);
    this.touch(entry);
  }

  private withLifecycle(registration: RunnerRegistration): RunnerEntry {
    const idleTimer = null;
    const lastUsedAt = Date.now();
    if (registration.cli === "codex") {
      const entry: RunnerEntryByCli["codex"] = { ...registration, idleTimer, lastUsedAt };
      return entry;
    }
    if (registration.cli === "claude") {
      const entry: RunnerEntryByCli["claude"] = { ...registration, idleTimer, lastUsedAt };
      return entry;
    }
    const entry: RunnerEntryByCli["grok"] = { ...registration, idleTimer, lastUsedAt };
    return entry;
  }

  private isEntryForCli<TCli extends InteractiveRunnerCli>(
    entry: RunnerEntry,
    cli: TCli,
  ): entry is Extract<RunnerEntry, { cli: TCli }> {
    return entry.cli === cli;
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
    return cli === "codex" || cli === "claude" || cli === "grok";
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
