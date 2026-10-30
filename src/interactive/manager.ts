import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { CodexRunSelection } from "./codexThreadSelection";
import type { ClaudeInteractiveRunner } from "./claudeRunner";
import type { CodexInteractiveRunner } from "./codexRunner";
import type { DshInteractiveRunner } from "./dshRunner";
import type { KimiInteractiveRunner } from "./kimiRunner";
import type { ZcodeInteractiveRunner } from "./zcodeRunner";
import type { GrokInteractiveRunner } from "./grokRunner";
import {
  runnerLifecycleStrategies,
  stopManagedRunner,
} from "./runnerLifecycleStrategies";
import type {
  CodexStrategyWithSelection,
  InteractiveRunnerCli,
  RunnerByCli,
  RunnerCreateOptionsByCli,
  RunnerEntry,
  RunnerEntryByCli,
  RunnerRegistration,
  RunnerRegistrationByCli,
  RunnerSetOptions,
  SetRunnerMetadataInput,
  StrategyForCli,
} from "./runnerLifecycleTypes";

const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const entryRunners: {
  [TCli in InteractiveRunnerCli]: (entry: RunnerEntryByCli[TCli]) => RunnerByCli[TCli];
} = {
  codex: (entry) => entry.runner,
  claude: (entry) => entry.runner,
  grok: (entry) => entry.runner,
  dsh: (entry) => entry.runner,
  "kimi-code": (entry) => entry.runner,
  zcode: (entry) => entry.runner,
};

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
    runner: RunnerByCli[InteractiveRunnerCli],
    thinkingMode: ThinkingMode,
    interactiveMode: InteractiveMode,
    model: string | null,
    options: RunnerSetOptions = {}
  ): void {
    const dispatch = <TCli extends InteractiveRunnerCli>(
      strategy: StrategyForCli<TCli>,
    ): void => {
      const input = { sessionId, runner: runner as RunnerByCli[TCli], thinkingMode, interactiveMode, model, options };
      this.registerExternalRunner(
        cli as TCli,
        input,
        (entry) => {
          strategy.applySetMetadata(entry, input);
        },
        () => strategy.createSetRegistration(input),
      );
    };
    switch (cli) {
      case "codex": return dispatch(runnerLifecycleStrategies.codex);
      case "claude": return dispatch(runnerLifecycleStrategies.claude);
      case "grok": return dispatch(runnerLifecycleStrategies.grok);
      case "dsh": return dispatch(runnerLifecycleStrategies.dsh);
      case "kimi-code": return dispatch(runnerLifecycleStrategies["kimi-code"]);
      case "zcode": return dispatch(runnerLifecycleStrategies.zcode);
    }
  }

  public getOrCreateCodexRunner(options: RunnerCreateOptionsByCli["codex"]): RunnerByCli["codex"] {
    return this.getOrCreateRunner("codex", options);
  }

  public getOrCreateClaudeRunner(options: RunnerCreateOptionsByCli["claude"]): RunnerByCli["claude"] {
    return this.getOrCreateRunner("claude", options);
  }

  public getOrCreateGrokRunner(options: RunnerCreateOptionsByCli["grok"]): RunnerByCli["grok"] {
    return this.getOrCreateRunner("grok", options);
  }

  public getOrCreateDshRunner(options: RunnerCreateOptionsByCli["dsh"]): RunnerByCli["dsh"] {
    return this.getOrCreateRunner("dsh", options);
  }

  public getOrCreateKimiCodeRunner(options: RunnerCreateOptionsByCli["kimi-code"]): RunnerByCli["kimi-code"] {
    return this.getOrCreateRunner("kimi-code", options);
  }

  public getOrCreateZcodeRunner(options: RunnerCreateOptionsByCli["zcode"]): RunnerByCli["zcode"] {
    return this.getOrCreateRunner("zcode", options);
  }

  private getOrCreateRunner<TCli extends InteractiveRunnerCli>(
    cli: TCli,
    options: RunnerCreateOptionsByCli[TCli],
  ): RunnerByCli[TCli] {
    const strategy: StrategyForCli<TCli> = runnerLifecycleStrategies[cli];
    const prepared = strategy.prepare(options);
    return this.reuseOrCreate(
      cli,
      prepared.sessionId,
      (entry) => strategy.canReuse(entry, prepared),
      (entry) => {
        strategy.applyReuse(entry, prepared);
      },
      () => strategy.createRunner(prepared),
      (created) => strategy.createRegistration(prepared, created),
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
    if (!entry || entry.cli !== "codex") {
      return null;
    }
    return (runnerLifecycleStrategies.codex as CodexStrategyWithSelection).readSelection(entry);
  }

  public hasGrokRunner(sessionId: string | null, runner: GrokInteractiveRunner): boolean {
    const entry = this.getEntry("grok", sessionId);
    return Boolean(entry && entry.cli === "grok" && entry.runner === runner);
  }

  public hasDshRunner(sessionId: string | null, runner: DshInteractiveRunner): boolean {
    const entry = this.getEntry("dsh", sessionId);
    return Boolean(entry && entry.cli === "dsh" && entry.runner === runner);
  }

  public hasKimiCodeRunner(sessionId: string | null, runner: KimiInteractiveRunner): boolean {
    const entry = this.getEntry("kimi-code", sessionId);
    return Boolean(entry && entry.cli === "kimi-code" && entry.runner === runner);
  }

  public hasZcodeRunner(sessionId: string | null, runner: ZcodeInteractiveRunner): boolean {
    const entry = this.getEntry("zcode", sessionId);
    return Boolean(entry && entry.cli === "zcode" && entry.runner === runner);
  }

  public detachRunner(
    cli: InteractiveRunnerCli,
    sessionId: string | null,
    runner: RunnerByCli[InteractiveRunnerCli],
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
    const matched = existing && existing.cli === cli ? (existing as RunnerEntryByCli[TCli]) : undefined;
    if (matched && canReuse(matched)) {
      applyReuse(matched);
      this.touch(matched);
      return entryRunners[cli](matched);
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
    const matched = existing && existing.cli === cli ? (existing as RunnerEntryByCli[TCli]) : undefined;
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
    return { ...registration, idleTimer: null, lastUsedAt: Date.now() };
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
    return cli === "codex" || cli === "claude" || cli === "grok" || cli === "dsh" || cli === "kimi-code" || cli === "zcode";
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
