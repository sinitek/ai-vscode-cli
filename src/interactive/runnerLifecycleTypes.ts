import type { InteractiveMode, ThinkingMode } from "../cli/types";
import type { CodexRunSelection } from "./codexThreadSelection";
import type { ClaudeInteractiveRunner } from "./claudeRunner";
import type { CodexInteractiveRunner } from "./codexRunner";
import type { DshInteractiveRunner } from "./dshRunner";
import type { KimiInteractiveRunner } from "./kimiRunner";
import type { ZcodeInteractiveRunner } from "./zcodeRunner";
import type { GrokInteractiveRunner } from "./grokRunner";

export type InteractiveRunnerCli = "codex" | "claude" | "grok" | "dsh" | "kimi-code" | "zcode";

export type RunnerLifecycleFields = {
  idleTimer: NodeJS.Timeout | null;
  lastUsedAt: number;
};

export type CodexRunnerEntry = {
  cli: "codex";
  sessionId: string;
  runner: CodexInteractiveRunner;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  configId: string | null;
  command?: string;
  args: string[];
  cwd?: string;
} & RunnerLifecycleFields;

export type ClaudeRunnerEntry = {
  cli: "claude";
  sessionId: string;
  runner: ClaudeInteractiveRunner;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  command: string;
  args: string[];
  cwd?: string;
  entrypoint?: string;
  isolateProjectInstructions: boolean;
} & RunnerLifecycleFields;

export type GrokRunnerEntry = {
  cli: "grok";
  sessionId: string;
  runner: GrokInteractiveRunner;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  command: string;
  args: string[];
  cwd?: string;
} & RunnerLifecycleFields;

export type DshRunnerEntry = {
  cli: "dsh";
  sessionId: string;
  runner: DshInteractiveRunner;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  command: string;
  args: string[];
  cwd?: string;
  localSessionId: string | null;
  env?: NodeJS.ProcessEnv;
} & RunnerLifecycleFields;

export type KimiCodeRunnerEntry = {
  cli: "kimi-code";
  sessionId: string;
  runner: KimiInteractiveRunner;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  command: string;
  args: string[];
  cwd?: string;
  localSessionId: string | null;
  env?: NodeJS.ProcessEnv;
} & RunnerLifecycleFields;

export type ZcodeRunnerEntry = {
  cli: "zcode";
  sessionId: string;
  runner: ZcodeInteractiveRunner;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  command: string;
  args: string[];
  cwd?: string;
  localSessionId: string | null;
  env?: NodeJS.ProcessEnv;
} & RunnerLifecycleFields;

export type ZcodeRunnerCreateOptions = {
  sessionId: string;
  command: string;
  agentArgs: string[];
  cwd: string;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  thinkingValue?: string | null;
  modeId?: string | null;
  localSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
};

export type PreparedZcodeCreate = {
  sessionId: string;
  options: ZcodeRunnerCreateOptions;
};

export type RunnerEntry = CodexRunnerEntry | ClaudeRunnerEntry | GrokRunnerEntry | DshRunnerEntry | KimiCodeRunnerEntry | ZcodeRunnerEntry;

export type RunnerEntryByCli = {
  codex: CodexRunnerEntry;
  claude: ClaudeRunnerEntry;
  grok: GrokRunnerEntry;
  dsh: DshRunnerEntry;
  "kimi-code": KimiCodeRunnerEntry;
  zcode: ZcodeRunnerEntry;
};

export type RunnerByCli = {
  [TCli in InteractiveRunnerCli]: RunnerEntryByCli[TCli]["runner"];
};

export type RunnerRegistration<TEntry extends RunnerEntry = RunnerEntry> =
  TEntry extends unknown ? Omit<TEntry, "idleTimer" | "lastUsedAt"> : never;

export type RunnerRegistrationByCli = {
  [TCli in InteractiveRunnerCli]: RunnerRegistration<RunnerEntryByCli[TCli]>;
};

export type CodexRunnerCreateOptions = {
  sessionId: string;
  threadId: string | null;
  command: string;
  args: string[];
  cwd?: string;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  configId?: string | null;
};

export type ClaudeRunnerCreateOptions = {
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
};

export type GrokRunnerCreateOptions = {
  sessionId: string;
  command: string;
  agentArgs: string[];
  cwd: string;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  localSessionId?: string | null;
};

export type PreparedCodexCreate = {
  sessionId: string;
  options: CodexRunnerCreateOptions;
  selection: CodexRunSelection;
};

export type PreparedClaudeCreate = {
  sessionId: string;
  options: ClaudeRunnerCreateOptions;
};

export type PreparedGrokCreate = {
  sessionId: string;
  options: GrokRunnerCreateOptions;
};

export type DshRunnerCreateOptions = {
  sessionId: string;
  command: string;
  agentArgs: string[];
  cwd: string;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  localSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
};

export type PreparedDshCreate = {
  sessionId: string;
  options: DshRunnerCreateOptions;
};

export type KimiCodeRunnerCreateOptions = {
  sessionId: string;
  command: string;
  agentArgs: string[];
  cwd: string;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  /** Confirmed thinking effort from the ACP `thinking` config option. */
  thinkingValue?: string | null;
  /** ACP `mode` value: default | plan | auto | yolo. */
  modeId?: string | null;
  localSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
};

export type PreparedKimiCodeCreate = {
  sessionId: string;
  options: KimiCodeRunnerCreateOptions;
};

export type RunnerSetOptions = {
  configId?: string | null;
  command?: string;
  args?: string[];
  cwd?: string;
  entrypoint?: string;
  isolateProjectInstructions?: boolean;
  localSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
};

export type SetRunnerMetadataInput<TRunner> = {
  sessionId: string;
  runner: TRunner;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model: string | null;
  options: RunnerSetOptions;
};

export type RunnerLifecycleStrategy<
  TCli extends InteractiveRunnerCli,
  TOptions,
  TPrepared extends { sessionId: string },
> = {
  readonly cli: TCli;
  prepare(options: TOptions): TPrepared;
  canReuse(entry: RunnerEntryByCli[TCli], prepared: TPrepared): boolean;
  applyReuse(entry: RunnerEntryByCli[TCli], prepared: TPrepared): void;
  createRunner(prepared: TPrepared): RunnerByCli[TCli];
  createRegistration(
    prepared: TPrepared,
    runner: RunnerByCli[TCli],
  ): RunnerRegistrationByCli[TCli];
  applySetMetadata(
    entry: RunnerEntryByCli[TCli],
    input: SetRunnerMetadataInput<RunnerByCli[TCli]>,
  ): void;
  createSetRegistration(
    input: SetRunnerMetadataInput<RunnerByCli[TCli]>,
  ): RunnerRegistrationByCli[TCli];
  stop(runner: RunnerByCli[TCli]): void;
};
