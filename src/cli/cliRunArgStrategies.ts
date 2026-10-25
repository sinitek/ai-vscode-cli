import { getCliArgs, getThinkingArgs, readExplicitDshPatchArgs } from "./config";
import { applyModelArg } from "./modelArgs";
import type { CliName, ThinkingMode } from "./types";
import { buildClaudePrompt } from "./claudeToolPolicy";

/**
 * Fields the platform strategies read. Spawn and overlay fields stay out of this type.
 */
export type CliRunArgOptions = {
  thinkingMode?: ThinkingMode;
  isolateProjectInstructions?: boolean;
  openCodeVariant?: string | null;
  model?: string | null;
  openCodeConfigContent?: string | null;
  imagePaths?: readonly unknown[];
  sessionId?: string | null;
  openCodeServerUrl?: string;
};

/**
 * Existing buildCliArgs callers pass these on the same object literal.
 * Strategies do not read them.
 */
type CliRunArgBuildOptions = CliRunArgOptions & {
  openCodeSmallModel?: string | null;
  openCodeSmallVariant?: string | null;
  envOverrides?: Record<string, string>;
  cwd?: string;
  processLabel?: string;
};

export type CliRunArgStrategy = {
  readonly includeThinkingArgs: boolean;
  applyIsolation: (args: readonly string[]) => string[];
  applyBeforePrompt: (args: readonly string[], options: CliRunArgOptions) => string[];
  appendPrompt: (args: readonly string[], options: CliRunArgOptions, prompt: string) => string[];
};

function copyArgs(args: readonly string[]): string[] {
  return [...args];
}

function copyWithFlag(args: readonly string[], flag: string): string[] {
  return args.includes(flag) ? [...args] : [...args, flag];
}

function appendPromptOnly(args: readonly string[], prompt: string): string[] {
  return [...args, prompt];
}

function applyCodexBeforePrompt(args: readonly string[], options: CliRunArgOptions): string[] {
  const withSkip = args.includes("--skip-git-repo-check")
    ? [...args]
    : [...args, "--skip-git-repo-check"];
  if (!Array.isArray(options.imagePaths) || options.imagePaths.length === 0) {
    return withSkip;
  }
  const normalizedImagePaths = options.imagePaths
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (normalizedImagePaths.length === 0) {
    return withSkip;
  }
  return [
    ...withSkip,
    ...normalizedImagePaths.flatMap((imagePath) => ["--image", imagePath]),
  ];
}

export function applyOpenCodeVariantArg(
  args: readonly string[],
  variant: string | null | undefined,
): string[] {
  const normalizedVariant = typeof variant === "string" ? variant.trim() : "";
  const hasExplicitVariant = args.some((arg) => arg === "--variant" || arg.startsWith("--variant="));
  if (!normalizedVariant || hasExplicitVariant) {
    return [...args];
  }
  return [...args, "--variant", normalizedVariant];
}

function applyOpenCodeAutoArg(args: readonly string[]): string[] {
  const normalizedArgs = args.filter((arg) => arg !== "--auto");
  const insertIndex = normalizedArgs[0] === "run" ? 1 : 0;
  return [
    ...normalizedArgs.slice(0, insertIndex),
    "--auto",
    ...normalizedArgs.slice(insertIndex),
  ];
}

function buildOpenCodeRunArgs(
  sharedArgs: readonly string[],
  sessionId: string | null,
  prompt: string,
  serverUrl?: string,
): string[] {
  const hasRunSubcommand = sharedArgs[0] === "run";
  const runArgs = hasRunSubcommand ? [...sharedArgs] : ["run", ...sharedArgs];
  if (!runArgs.includes("--format") && !runArgs.some((arg) => arg.startsWith("--format="))) {
    runArgs.splice(2, 0, "--format", "json");
  }
  if (!runArgs.includes("--print-logs")) {
    const formatIndex = runArgs.findIndex((arg) => arg === "--format" || arg.startsWith("--format="));
    const insertAt = formatIndex >= 0
      ? formatIndex + (runArgs[formatIndex] === "--format" ? 2 : 1)
      : Math.min(2, runArgs.length);
    runArgs.splice(insertAt, 0, "--print-logs");
  }
  const hasAttach = runArgs.some((arg) => arg === "--attach" || arg.startsWith("--attach="));
  const normalizedServerUrl = typeof serverUrl === "string" ? serverUrl.trim().replace(/\/+$/u, "") : "";
  let nextArgs = runArgs;
  if (normalizedServerUrl) {
    nextArgs = runArgs.filter((arg, index, args) => (
      arg !== "--port"
      && !arg.startsWith("--port=")
      && args[index - 1] !== "--port"
    ));
    if (!hasAttach) {
      nextArgs.push("--attach", normalizedServerUrl);
    }
  }
  if (sessionId && !nextArgs.includes("--session") && !nextArgs.includes("-s")) {
    return [...nextArgs, "--session", sessionId, prompt];
  }
  return [...nextArgs, prompt];
}

function createCodexRunArgStrategy(): CliRunArgStrategy {
  return {
    includeThinkingArgs: true,
    applyIsolation(args) {
      return copyWithFlag(args, "--ignore-rules");
    },
    applyBeforePrompt(args, options) {
      return applyCodexBeforePrompt(args, options);
    },
    appendPrompt(args, _options, prompt) {
      return appendPromptOnly(args, prompt);
    },
  };
}

function createClaudeRunArgStrategy(): CliRunArgStrategy {
  return {
    includeThinkingArgs: true,
    applyIsolation(args) {
      return copyWithFlag(args, "--safe-mode");
    },
    applyBeforePrompt(args) {
      return copyArgs(args);
    },
    appendPrompt(args, _options, prompt) {
      return appendPromptOnly(args, buildClaudePrompt(prompt));
    },
  };
}

function createGrokRunArgStrategy(): CliRunArgStrategy {
  return {
    includeThinkingArgs: true,
    applyIsolation(args) {
      return copyWithFlag(args, "--pure");
    },
    applyBeforePrompt(args) {
      return copyArgs(args);
    },
    appendPrompt(args, _options, prompt) {
      return appendPromptOnly(args, prompt);
    },
  };
}

function createOpenCodeRunArgStrategy(): CliRunArgStrategy {
  return {
    includeThinkingArgs: false,
    applyIsolation(args) {
      return copyWithFlag(args, "--pure");
    },
    applyBeforePrompt(args, options) {
      return applyOpenCodeAutoArg(applyOpenCodeVariantArg(args, options.openCodeVariant));
    },
    appendPrompt(args, options, prompt) {
      return buildOpenCodeRunArgs(args, options.sessionId ?? null, prompt, options.openCodeServerUrl);
    },
  };
}

function createDshRunArgStrategy(): CliRunArgStrategy {
  return {
    includeThinkingArgs: false,
    applyIsolation(args) {
      return readExplicitDshPatchArgs(args);
    },
    applyBeforePrompt(args) {
      return readExplicitDshPatchArgs(args);
    },
    appendPrompt(args, _options, prompt) {
      if (prompt.trim()) {
        throw new Error("DSH one-shot prompt arguments are outside the verified ACP launch contract.");
      }
      return readExplicitDshPatchArgs(args);
    },
  };
}

export function createCliRunArgStrategies(): Record<CliName, CliRunArgStrategy> {
  return {
    claude: createClaudeRunArgStrategy(),
    codex: createCodexRunArgStrategy(),
    opencode: createOpenCodeRunArgStrategy(),
    grok: createGrokRunArgStrategy(),
    dsh: createDshRunArgStrategy(),
  };
}

export function buildCliArgs(
  cli: CliName,
  options: CliRunArgBuildOptions = {},
  prompt?: string,
): string[] {
  const strategy = createCliRunArgStrategies()[cli];
  const baseArgs = getCliArgs(cli);
  const thinkingArgs = strategy.includeThinkingArgs && options.thinkingMode
    ? getThinkingArgs(cli, options.thinkingMode)
    : [];
  let shared = applyModelArg(cli, [...baseArgs, ...thinkingArgs], options.model, {
    openCodeConfigContent: options.openCodeConfigContent,
  });
  if (options.isolateProjectInstructions) {
    shared = strategy.applyIsolation(shared);
  }
  shared = strategy.applyBeforePrompt(shared, options);
  if (prompt === undefined || prompt === "") {
    return shared;
  }
  return strategy.appendPrompt(shared, options, prompt);
}
