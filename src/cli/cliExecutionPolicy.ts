import { CLI_LIST, CliName } from "./types";

export type CliExecutionMode = "interactive" | "one-shot" | "parallel";

export type CliExecutionPolicy = {
  readonly interactive: boolean;
  readonly automaticContextCompaction: boolean;
  readonly modes: Readonly<Record<CliExecutionMode, boolean>>;
  readonly compactionRequiresInteractiveHost: boolean;
};

export const CLI_EXECUTION_POLICY = {
  codex: {
    interactive: true,
    automaticContextCompaction: true,
    modes: { interactive: true, "one-shot": false, parallel: false },
    compactionRequiresInteractiveHost: true,
  },
  claude: {
    interactive: true,
    automaticContextCompaction: true,
    modes: { interactive: true, "one-shot": false, parallel: false },
    compactionRequiresInteractiveHost: true,
  },
  opencode: {
    interactive: false,
    automaticContextCompaction: true,
    modes: { interactive: false, "one-shot": true, parallel: true },
    compactionRequiresInteractiveHost: true,
  },
  grok: {
    interactive: true,
    automaticContextCompaction: true,
    modes: { interactive: true, "one-shot": false, parallel: false },
    compactionRequiresInteractiveHost: true,
  },
  dsh: {
    interactive: true,
    automaticContextCompaction: false,
    modes: { interactive: true, "one-shot": false, parallel: false },
    compactionRequiresInteractiveHost: true,
  },
  "kimi-code": {
    interactive: true,
    automaticContextCompaction: true,
    modes: { interactive: true, "one-shot": false, parallel: false },
    compactionRequiresInteractiveHost: true,
  },
  zcode: {
    interactive: true,
    automaticContextCompaction: true,
    modes: { interactive: true, "one-shot": false, parallel: false },
    compactionRequiresInteractiveHost: true,
  },
} satisfies Record<CliName, CliExecutionPolicy>;

export function isInteractiveCli(cli: CliName): boolean {
  return CLI_EXECUTION_POLICY[cli].interactive;
}

export function isAutomaticContextCompactionCandidate(cli: string): cli is CliName {
  return (CLI_LIST as readonly string[]).includes(cli)
    && CLI_EXECUTION_POLICY[cli as CliName].automaticContextCompaction;
}

export function supportsCliExecutionMode(cli: CliName, mode: CliExecutionMode): boolean {
  return CLI_EXECUTION_POLICY[cli].modes[mode];
}

export function canHostContextCompaction(cli: CliName, interactiveHostAvailable: boolean): boolean {
  const policy = CLI_EXECUTION_POLICY[cli];
  return policy.automaticContextCompaction
    && (!policy.compactionRequiresInteractiveHost || interactiveHostAvailable);
}

export function selectCliExecutionMode(
  cli: CliName,
  options: { readonly hasOtherTabRun: boolean; readonly firstMainRun: boolean }
): CliExecutionMode {
  const preferredMode: CliExecutionMode = isInteractiveCli(cli)
    ? "interactive"
    : options.hasOtherTabRun ? "parallel" : "one-shot";
  if (options.firstMainRun) {
    if (!isInteractiveCli(cli)) {
      throw new Error(`First main run requires interactive execution: ${cli}`);
    }
    return "interactive";
  }
  if (!supportsCliExecutionMode(cli, preferredMode)) {
    throw new Error(`Unsupported ${preferredMode} execution mode: ${cli}`);
  }
  return preferredMode;
}
