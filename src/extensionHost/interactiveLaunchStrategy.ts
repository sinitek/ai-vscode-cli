import { buildCliArgs } from "../cli/cliRunArgStrategies";
import { CLI_EXECUTION_POLICY } from "../cli/cliExecutionPolicy";
import { resolveCliCommand } from "../cli/commandResolution";
import { buildGrokAgentStdioArgs, getCliCommand, getDshCommand, getGrokAgentArgs, getGrokCommand, getKimiCommand, getZcodeCommand } from "../cli/config";
import type { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { selectCliExecutionMode, supportsCliExecutionMode, type CliExecutionMode } from "../cli/cliExecutionPolicy";
import { isLocalSessionId } from "../interactive/sessionHistoryRepair";
import { prepareDshIsolatedLaunch, type DshInteractiveLaunch } from "./dshInteractiveLaunch";
import { prepareKimiInteractiveLaunch, type KimiInteractiveLaunch } from "./kimiInteractiveLaunch";
import { prepareZcodeInteractiveLaunch, type ZcodeInteractiveLaunch } from "./zcodeInteractiveLaunch";

export type InteractiveLaunchCli = {
  [Cli in CliName]: typeof CLI_EXECUTION_POLICY[Cli]["modes"]["interactive"] extends true ? Cli : never;
}[CliName];

type DshLaunch = Pick<DshInteractiveLaunch, "agentArgs" | "env" | "isolatedHome">;
type KimiLaunch = Pick<KimiInteractiveLaunch, "agentArgs" | "env" | "modeId" | "modelAlias" | "thinkingValue">;
type ZcodeLaunch = Pick<ZcodeInteractiveLaunch, "agentArgs" | "env" | "modeId" | "modelRef" | "thinkingValue">;

type LaunchInput = {
  requestedModel: string | null;
  selectedModel: string | null;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  imagePaths?: string[];
  isolateProjectInstructions?: boolean;
  sessionId: string | null;
  tabId: string;
};

export type InteractiveLaunchDeps = {
  getEffectiveCliArgs: (cli: CliName, model: string | null) => string[];
  resolveClaudeInteractiveEntrypoint?: (command: string | undefined) => string | undefined;
  resolveGrokModelForRun?: (model: string | null) => Promise<string>;
  resolveDshModelWireForRun?: (model: string | null) => Promise<string>;
  resolveKimiModelWireForRun?: (model: string | null) => Promise<string>;
  resolveZcodeModelWireForRun?: (model: string | null) => Promise<string>;
  prepareDshInteractiveLaunch?: (input: { sessionKey: string }) => Promise<DshLaunch>;
  prepareKimiInteractiveLaunch?: (input: { interactiveMode: InteractiveMode; selectedModel: string | null; thinkingMode: ThinkingMode }) => Promise<KimiLaunch>;
  prepareZcodeInteractiveLaunch?: typeof prepareZcodeInteractiveLaunch;
};

type LaunchDetails = {
  codex: object;
  claude: { claudeEntrypoint: string | undefined };
  grok: { grokAgentArgs: string[] };
  dsh: { dshModelWire: string; dshLaunch: DshLaunch };
  "kimi-code": { kimiModelWire: string; kimiLaunch: KimiLaunch };
  zcode: { zcodeModelWire: string; zcodeLaunch: ZcodeLaunch };
};

type LaunchBase = {
  readonly command: string;
  readonly commandForRunner: string;
  readonly args: string[];
  readonly startupLog?: { resolvedCommand?: string; resolvedFrom?: string; execPath: string; entrypoint?: string };
};

export type InteractiveLaunch<Cli extends InteractiveLaunchCli = InteractiveLaunchCli> = {
  [Key in Cli]: { readonly cli: Key } & LaunchBase & Readonly<LaunchDetails[Key]>;
}[Cli];

type InteractiveLaunchRegistry = {
  [Cli in InteractiveLaunchCli]: {
    resolveModel?: (model: string | null) => Promise<string>;
    prepare(input: LaunchInput): InteractiveLaunch<Cli> | Promise<InteractiveLaunch<Cli>>;
  };
};

function resolveBundledClaudeCliPath(): string | undefined {
  try {
    return require.resolve("@anthropic-ai/claude-agent-sdk/cli.js");
  } catch {
    return undefined;
  }
}

export function resolveClaudeInteractiveEntrypoint(
  command: string | undefined,
  platform: NodeJS.Platform = process.platform,
  resolveBundled = resolveBundledClaudeCliPath,
): string | undefined {
  if (!command) return undefined;
  return platform === "win32" && /\.(cmd|bat)$/i.test(command) ? resolveBundled() : command;
}

export function resolvePromptExecutionMode(
  cli: CliName,
  hasOtherTabRun: boolean,
  firstMainRun = false,
): CliExecutionMode {
  return selectCliExecutionMode(cli, { hasOtherTabRun, firstMainRun });
}

export function supportsInteractiveLaunch(cli: CliName): boolean {
  return supportsCliExecutionMode(cli, "interactive");
}

export function isInteractiveLaunchCli(cli: CliName, registry: InteractiveLaunchRegistry): cli is InteractiveLaunchCli {
  return Object.prototype.hasOwnProperty.call(registry, cli);
}

export function createInteractiveLaunchStrategies(deps: InteractiveLaunchDeps): InteractiveLaunchRegistry {
  const buildArgs = (cli: "codex" | "claude", input: LaunchInput) => buildCliArgs(cli, {
    thinkingMode: input.thinkingMode,
    model: input.selectedModel,
    imagePaths: input.imagePaths,
    isolateProjectInstructions: input.isolateProjectInstructions,
  });
  return {
    codex: {
      prepare(input) {
        const args = buildArgs("codex", input);
        const command = getCliCommand("codex");
        return { cli: "codex", command, commandForRunner: command, args };
      },
    },
    claude: {
      prepare(input) {
        const args = input.isolateProjectInstructions
          ? buildArgs("claude", input)
          : deps.getEffectiveCliArgs("claude", input.selectedModel);
        const command = getCliCommand("claude");
        const resolved = resolveCliCommand(command);
        const commandForRunner = resolved?.command ?? "claude";
        const claudeEntrypoint = (deps.resolveClaudeInteractiveEntrypoint ?? resolveClaudeInteractiveEntrypoint)(commandForRunner);
        return {
          cli: "claude", command, commandForRunner, args, claudeEntrypoint,
          startupLog: {
            resolvedCommand: resolved?.command, resolvedFrom: resolved?.resolvedFrom,
            execPath: process.execPath, entrypoint: claudeEntrypoint,
          },
        };
      },
    },
    grok: {
      resolveModel: deps.resolveGrokModelForRun,
      prepare(input) {
        const grokAgentArgs = getGrokAgentArgs();
        const args = buildGrokAgentStdioArgs(grokAgentArgs, input.selectedModel);
        const command = getGrokCommand();
        return { cli: "grok", command, commandForRunner: command, args, grokAgentArgs };
      },
    },
    dsh: {
      async prepare(input) {
        if (!deps.resolveDshModelWireForRun) throw new Error("DSH model wire resolver is not configured.");
        const dshModelWire = await deps.resolveDshModelWireForRun(input.requestedModel);
        const dshLaunch = await (deps.prepareDshInteractiveLaunch ?? prepareDshIsolatedLaunch)({
          sessionKey: input.sessionId && !isLocalSessionId(input.sessionId) ? input.sessionId : input.tabId,
        });
        const args = [...dshLaunch.agentArgs];
        const command = getDshCommand();
        return { cli: "dsh", command, commandForRunner: command, args, dshModelWire, dshLaunch };
      },
    },
    "kimi-code": {
      async prepare(input) {
        if (!deps.resolveKimiModelWireForRun) throw new Error("Kimi Code model resolver is not configured.");
        const kimiModelWire = await deps.resolveKimiModelWireForRun(input.requestedModel);
        const kimiLaunch = await (deps.prepareKimiInteractiveLaunch ?? prepareKimiInteractiveLaunch)({
          interactiveMode: input.interactiveMode === "department" ? "coding" : input.interactiveMode,
          selectedModel: kimiModelWire,
          thinkingMode: input.thinkingMode,
        });
        const args = [...kimiLaunch.agentArgs];
        const command = getKimiCommand();
        return { cli: "kimi-code", command, commandForRunner: command, args, kimiModelWire, kimiLaunch };
      },
    },
    zcode: {
      async prepare(input) {
        if (!deps.resolveZcodeModelWireForRun) throw new Error("ZCode model resolver is not configured.");
        const zcodeModelWire = await deps.resolveZcodeModelWireForRun(input.requestedModel);
        const zcodeLaunch = await (deps.prepareZcodeInteractiveLaunch ?? prepareZcodeInteractiveLaunch)({
          interactiveMode: input.interactiveMode,
          selectedModel: zcodeModelWire,
          thinkingMode: input.thinkingMode,
        });
        const args = [...zcodeLaunch.agentArgs];
        const command = getZcodeCommand();
        return { cli: "zcode", command, commandForRunner: command, args, zcodeModelWire, zcodeLaunch };
      },
    },
  };
}
