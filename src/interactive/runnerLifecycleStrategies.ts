import { normalizeCodexRunSelection, type CodexRunSelection } from "./codexThreadSelection";
import { ClaudeInteractiveRunner } from "./claudeRunner";
import { CodexInteractiveRunner } from "./codexRunner";
import { DshInteractiveRunner } from "./dshRunner";
import { KimiInteractiveRunner } from "./kimiRunner";
import { GrokInteractiveRunner } from "./grokRunner";
import type {
  ClaudeRunnerCreateOptions,
  CodexRunnerCreateOptions,
  CodexRunnerEntry,
  DshRunnerCreateOptions,
  GrokRunnerCreateOptions,
  KimiCodeRunnerCreateOptions,
  PreparedClaudeCreate,
  PreparedCodexCreate,
  PreparedDshCreate,
  PreparedGrokCreate,
  PreparedKimiCodeCreate,
  RunnerEntry,
  RunnerLifecycleStrategy,
} from "./runnerLifecycleTypes";

type CodexRunnerLifecycleStrategy = RunnerLifecycleStrategy<"codex", CodexRunnerCreateOptions, PreparedCodexCreate> & {
  readSelection(entry: CodexRunnerEntry): CodexRunSelection;
};

function copyArgs(args: readonly string[]): string[] {
  return [...args];
}

function sameOrUnspecified(existingValue: string | undefined, nextValue: string | undefined): boolean {
  return existingValue === nextValue || existingValue === undefined || existingValue === "";
}

function emptyGrokSessionError(): Error {
  return Object.assign(new Error("empty grok session"), { reason: "empty" });
}

function emptyDshSessionError(): Error {
  return Object.assign(new Error("empty dsh session"), { reason: "empty" });
}

function emptyKimiCodeSessionError(): Error {
  return Object.assign(new Error("empty kimi-code session"), { reason: "empty" });
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const codexRunnerLifecycleStrategy: CodexRunnerLifecycleStrategy = {
  cli: "codex",
  prepare(options) {
    return {
      sessionId: options.sessionId,
      options,
      selection: normalizeCodexRunSelection({
        configId: options.configId,
        model: options.model,
      }),
    };
  },
  canReuse(entry, prepared) {
    return entry.command === prepared.options.command
      && entry.cwd === prepared.options.cwd
      && entry.configId === prepared.selection.configId;
  },
  applyReuse(entry, prepared) {
    entry.thinkingMode = prepared.options.thinkingMode;
    entry.interactiveMode = prepared.options.interactiveMode;
    entry.model = prepared.selection.model;
    entry.args = copyArgs(prepared.options.args);
    entry.runner.updateOptions({
      command: prepared.options.command,
      args: prepared.options.args,
      cwd: prepared.options.cwd,
      thinkingMode: prepared.options.thinkingMode,
      interactiveMode: prepared.options.interactiveMode,
      model: prepared.selection.model,
      threadId: prepared.options.threadId,
    });
  },
  createRunner(prepared) {
    return new CodexInteractiveRunner({
      command: prepared.options.command,
      args: prepared.options.args,
      cwd: prepared.options.cwd,
      thinkingMode: prepared.options.thinkingMode,
      interactiveMode: prepared.options.interactiveMode,
      model: prepared.selection.model,
      threadId: prepared.options.threadId,
    });
  },
  createRegistration(prepared, runner) {
    return {
      cli: "codex",
      sessionId: prepared.sessionId,
      runner,
      thinkingMode: prepared.options.thinkingMode,
      interactiveMode: prepared.options.interactiveMode,
      model: prepared.selection.model,
      configId: prepared.selection.configId,
      command: prepared.options.command,
      args: copyArgs(prepared.options.args),
      cwd: prepared.options.cwd,
    };
  },
  applySetMetadata(entry, input) {
    const selection = normalizeCodexRunSelection({
      configId: input.options.configId,
      model: input.model,
    });
    entry.sessionId = input.sessionId;
    entry.thinkingMode = input.thinkingMode;
    entry.interactiveMode = input.interactiveMode;
    entry.model = selection.model;
    entry.configId = selection.configId;
    entry.command = input.options.command;
    entry.args = copyArgs(input.options.args ?? []);
    entry.cwd = input.options.cwd;
  },
  createSetRegistration(input) {
    const selection = normalizeCodexRunSelection({
      configId: input.options.configId,
      model: input.model,
    });
    return {
      cli: "codex",
      sessionId: input.sessionId,
      runner: input.runner,
      thinkingMode: input.thinkingMode,
      interactiveMode: input.interactiveMode,
      model: selection.model,
      configId: selection.configId,
      command: input.options.command,
      args: copyArgs(input.options.args ?? []),
      cwd: input.options.cwd,
    };
  },
  readSelection(entry) {
    return normalizeCodexRunSelection({
      configId: entry.configId,
      model: entry.model,
    });
  },
  stop(runner) {
    runner.stopAndRebuild();
  },
};

export const claudeRunnerLifecycleStrategy: RunnerLifecycleStrategy<"claude", ClaudeRunnerCreateOptions, PreparedClaudeCreate> = {
  cli: "claude",
  prepare(options) {
    return {
      sessionId: options.sessionId,
      options,
    };
  },
  canReuse(entry, prepared) {
    if (entry.runner.isDisposed()) {
      return false;
    }
    const isolateProjectInstructions = prepared.options.isolateProjectInstructions === true;
    return entry.thinkingMode === prepared.options.thinkingMode
      && entry.interactiveMode === prepared.options.interactiveMode
      && entry.model === prepared.options.model
      && entry.isolateProjectInstructions === isolateProjectInstructions
      && sameOrUnspecified(entry.command, prepared.options.command)
      && sameOrUnspecified(entry.cwd, prepared.options.cwd)
      && sameOrUnspecified(entry.entrypoint, prepared.options.entrypoint);
  },
  applyReuse(entry, prepared) {
    const runnerSessionId = entry.runner.getSessionId();
    const expectedSessionId = runnerSessionId || prepared.options.mappedSessionId;
    if (expectedSessionId && runnerSessionId !== expectedSessionId) {
      entry.runner.updateSessionId(expectedSessionId);
    }
    entry.thinkingMode = prepared.options.thinkingMode;
    entry.interactiveMode = prepared.options.interactiveMode;
    entry.model = prepared.options.model;
    entry.command = prepared.options.command;
    entry.args = copyArgs(prepared.options.args);
    entry.cwd = prepared.options.cwd;
    entry.entrypoint = prepared.options.entrypoint;
    entry.isolateProjectInstructions = prepared.options.isolateProjectInstructions === true;
  },
  createRunner(prepared) {
    return new ClaudeInteractiveRunner({
      command: prepared.options.command,
      args: prepared.options.args,
      cwd: prepared.options.cwd,
      thinkingMode: prepared.options.thinkingMode,
      interactiveMode: prepared.options.interactiveMode,
      model: prepared.options.model,
      entrypoint: prepared.options.entrypoint,
      sessionId: prepared.options.mappedSessionId,
      isolateProjectInstructions: prepared.options.isolateProjectInstructions,
    });
  },
  createRegistration(prepared, runner) {
    return {
      cli: "claude",
      sessionId: prepared.sessionId,
      runner,
      thinkingMode: prepared.options.thinkingMode,
      interactiveMode: prepared.options.interactiveMode,
      model: prepared.options.model,
      command: prepared.options.command,
      args: copyArgs(prepared.options.args),
      cwd: prepared.options.cwd,
      entrypoint: prepared.options.entrypoint,
      isolateProjectInstructions: prepared.options.isolateProjectInstructions === true,
    };
  },
  applySetMetadata(entry, input) {
    entry.sessionId = input.sessionId;
    entry.thinkingMode = input.thinkingMode;
    entry.interactiveMode = input.interactiveMode;
    entry.model = input.model;
    if (typeof input.options.command === "string") {
      entry.command = input.options.command;
    }
    if (input.options.args) {
      entry.args = copyArgs(input.options.args);
    }
    if (input.options.cwd !== undefined) {
      entry.cwd = input.options.cwd;
    }
    if (input.options.entrypoint !== undefined) {
      entry.entrypoint = input.options.entrypoint;
    }
    if (input.options.isolateProjectInstructions !== undefined) {
      entry.isolateProjectInstructions = input.options.isolateProjectInstructions;
    }
  },
  createSetRegistration(input) {
    return {
      cli: "claude",
      sessionId: input.sessionId,
      runner: input.runner,
      thinkingMode: input.thinkingMode,
      interactiveMode: input.interactiveMode,
      model: input.model,
      command: input.options.command ?? "",
      args: copyArgs(input.options.args ?? []),
      cwd: input.options.cwd,
      entrypoint: input.options.entrypoint,
      isolateProjectInstructions: input.options.isolateProjectInstructions === true,
    };
  },
  stop(runner) {
    runner.stopAndRebuild();
  },
};

export const grokRunnerLifecycleStrategy: RunnerLifecycleStrategy<"grok", GrokRunnerCreateOptions, PreparedGrokCreate> = {
  cli: "grok",
  prepare(options) {
    const sessionId = options.sessionId.trim();
    if (!sessionId) {
      throw emptyGrokSessionError();
    }
    return {
      sessionId,
      options: { ...options, sessionId },
    };
  },
  canReuse(entry, prepared) {
    return entry.runner.isReusable()
      && entry.thinkingMode === prepared.options.thinkingMode
      && entry.interactiveMode === prepared.options.interactiveMode
      && entry.model === prepared.options.model
      && entry.command === prepared.options.command
      && entry.cwd === prepared.options.cwd;
  },
  applyReuse(entry, prepared) {
    entry.thinkingMode = prepared.options.thinkingMode;
    entry.interactiveMode = prepared.options.interactiveMode;
    entry.model = prepared.options.model;
    entry.command = prepared.options.command;
    entry.args = copyArgs(prepared.options.agentArgs);
    entry.cwd = prepared.options.cwd;
  },
  createRunner(prepared) {
    return new GrokInteractiveRunner({
      command: prepared.options.command,
      agentArgs: prepared.options.agentArgs,
      cwd: prepared.options.cwd,
      thinkingMode: prepared.options.thinkingMode,
      model: prepared.options.model,
      localSessionId: prepared.options.localSessionId ?? null,
    });
  },
  createRegistration(prepared, runner) {
    return {
      cli: "grok",
      sessionId: prepared.sessionId,
      runner,
      thinkingMode: prepared.options.thinkingMode,
      interactiveMode: prepared.options.interactiveMode,
      model: prepared.options.model,
      command: prepared.options.command,
      args: copyArgs(prepared.options.agentArgs),
      cwd: prepared.options.cwd,
    };
  },
  applySetMetadata(entry, input) {
    entry.sessionId = input.sessionId;
    entry.thinkingMode = input.thinkingMode;
    entry.interactiveMode = input.interactiveMode;
    entry.model = input.model;
    if (typeof input.options.command === "string") {
      entry.command = input.options.command;
    }
    if (input.options.args) {
      entry.args = copyArgs(input.options.args);
    }
    if (input.options.cwd !== undefined) {
      entry.cwd = input.options.cwd;
    }
  },
  createSetRegistration(input) {
    return {
      cli: "grok",
      sessionId: input.sessionId,
      runner: input.runner,
      thinkingMode: input.thinkingMode,
      interactiveMode: input.interactiveMode,
      model: input.model,
      command: input.options.command ?? "",
      args: copyArgs(input.options.args ?? []),
      cwd: input.options.cwd,
    };
  },
  stop(runner) {
    runner.cancelTurn();
  },
};

export const dshRunnerLifecycleStrategy: RunnerLifecycleStrategy<"dsh", DshRunnerCreateOptions, PreparedDshCreate> = {
  cli: "dsh",
  prepare(options) {
    const sessionId = options.sessionId.trim();
    if (!sessionId) {
      throw emptyDshSessionError();
    }
    return {
      sessionId,
      options: {
        ...options,
        sessionId,
        agentArgs: copyArgs(options.agentArgs),
        localSessionId: options.localSessionId ?? null,
      },
    };
  },
  canReuse(entry, prepared) {
    return entry.runner.isReusable()
      && entry.command === prepared.options.command
      && entry.cwd === prepared.options.cwd
      && entry.interactiveMode === prepared.options.interactiveMode
      && entry.localSessionId === (prepared.options.localSessionId ?? null)
      && (entry.env?.DSH_HOME ?? "") === (prepared.options.env?.DSH_HOME ?? "")
      && sameStringList(entry.args, prepared.options.agentArgs);
  },
  applyReuse(entry, prepared) {
    entry.command = prepared.options.command;
    entry.args = copyArgs(prepared.options.agentArgs);
    entry.cwd = prepared.options.cwd;
    entry.interactiveMode = prepared.options.interactiveMode;
    entry.localSessionId = prepared.options.localSessionId ?? null;
    entry.env = prepared.options.env;
    entry.model = prepared.options.model;
    entry.thinkingMode = prepared.options.thinkingMode;
  },
  createRunner(prepared) {
    return new DshInteractiveRunner({
      command: prepared.options.command,
      agentArgs: prepared.options.agentArgs,
      cwd: prepared.options.cwd,
      thinkingMode: prepared.options.thinkingMode,
      model: prepared.options.model,
      localSessionId: prepared.options.localSessionId ?? null,
      env: prepared.options.env,
    });
  },
  createRegistration(prepared, runner) {
    return {
      cli: "dsh",
      sessionId: prepared.sessionId,
      runner,
      thinkingMode: prepared.options.thinkingMode,
      interactiveMode: prepared.options.interactiveMode,
      model: prepared.options.model,
      command: prepared.options.command,
      args: copyArgs(prepared.options.agentArgs),
      cwd: prepared.options.cwd,
      localSessionId: prepared.options.localSessionId ?? null,
      env: prepared.options.env,
    };
  },
  applySetMetadata(entry, input) {
    entry.sessionId = input.sessionId;
    entry.thinkingMode = input.thinkingMode;
    entry.interactiveMode = input.interactiveMode;
    entry.model = input.model;
    if (typeof input.options.command === "string") {
      entry.command = input.options.command;
    }
    if (input.options.args) {
      entry.args = copyArgs(input.options.args);
    }
    if (input.options.cwd !== undefined) {
      entry.cwd = input.options.cwd;
    }
    if (input.options.localSessionId !== undefined) {
      entry.localSessionId = input.options.localSessionId;
    }
    if (input.options.env) {
      entry.env = input.options.env;
    }
  },
  createSetRegistration(input) {
    return {
      cli: "dsh",
      sessionId: input.sessionId,
      runner: input.runner,
      thinkingMode: input.thinkingMode,
      interactiveMode: input.interactiveMode,
      model: input.model,
      command: input.options.command ?? "",
      args: copyArgs(input.options.args ?? []),
      cwd: input.options.cwd,
      localSessionId: input.options.localSessionId ?? null,
      env: input.options.env,
    };
  },
  stop(runner) {
    runner.cancelTurn();
  },
};

export const kimiCodeRunnerLifecycleStrategy: RunnerLifecycleStrategy<
  "kimi-code",
  KimiCodeRunnerCreateOptions,
  PreparedKimiCodeCreate
> = {
  cli: "kimi-code",
  prepare(options) {
    const sessionId = options.sessionId.trim();
    if (!sessionId) {
      throw emptyKimiCodeSessionError();
    }
    return {
      sessionId,
      options: {
        ...options,
        sessionId,
        agentArgs: copyArgs(options.agentArgs),
        localSessionId: options.localSessionId ?? null,
      },
    };
  },
  canReuse(entry, prepared) {
    return entry.runner.isReusable()
      && entry.command === prepared.options.command
      && entry.cwd === prepared.options.cwd
      && entry.interactiveMode === prepared.options.interactiveMode
      && entry.localSessionId === (prepared.options.localSessionId ?? null)
      && (entry.env?.KIMI_CODE_HOME ?? "") === (prepared.options.env?.KIMI_CODE_HOME ?? "")
      && sameStringList(entry.args, prepared.options.agentArgs);
  },
  applyReuse(entry, prepared) {
    entry.command = prepared.options.command;
    entry.args = copyArgs(prepared.options.agentArgs);
    entry.cwd = prepared.options.cwd;
    entry.interactiveMode = prepared.options.interactiveMode;
    entry.localSessionId = prepared.options.localSessionId ?? null;
    entry.env = prepared.options.env;
    entry.model = prepared.options.model;
    entry.thinkingMode = prepared.options.thinkingMode;
  },
  createRunner(prepared) {
    return new KimiInteractiveRunner({
      command: prepared.options.command,
      agentArgs: prepared.options.agentArgs,
      cwd: prepared.options.cwd,
      thinkingMode: prepared.options.thinkingValue ?? null,
      modeId: prepared.options.modeId ?? null,
      model: prepared.options.model,
      localSessionId: prepared.options.localSessionId ?? null,
      env: prepared.options.env,
    });
  },
  createRegistration(prepared, runner) {
    return {
      cli: "kimi-code",
      sessionId: prepared.sessionId,
      runner,
      thinkingMode: prepared.options.thinkingMode,
      interactiveMode: prepared.options.interactiveMode,
      model: prepared.options.model,
      command: prepared.options.command,
      args: copyArgs(prepared.options.agentArgs),
      cwd: prepared.options.cwd,
      localSessionId: prepared.options.localSessionId ?? null,
      env: prepared.options.env,
    };
  },
  applySetMetadata(entry, input) {
    entry.sessionId = input.sessionId;
    entry.thinkingMode = input.thinkingMode;
    entry.interactiveMode = input.interactiveMode;
    entry.model = input.model;
    if (typeof input.options.command === "string") {
      entry.command = input.options.command;
    }
    if (input.options.args) {
      entry.args = copyArgs(input.options.args);
    }
    if (input.options.cwd !== undefined) {
      entry.cwd = input.options.cwd;
    }
    if (input.options.localSessionId !== undefined) {
      entry.localSessionId = input.options.localSessionId;
    }
    if (input.options.env) {
      entry.env = input.options.env;
    }
  },
  createSetRegistration(input) {
    return {
      cli: "kimi-code",
      sessionId: input.sessionId,
      runner: input.runner,
      thinkingMode: input.thinkingMode,
      interactiveMode: input.interactiveMode,
      model: input.model,
      command: input.options.command ?? "",
      args: copyArgs(input.options.args ?? []),
      cwd: input.options.cwd,
      localSessionId: input.options.localSessionId ?? null,
      env: input.options.env,
    };
  },
  stop(runner) {
    runner.cancelTurn();
  },
};

export const runnerLifecycleStrategies = {
  codex: codexRunnerLifecycleStrategy,
  claude: claudeRunnerLifecycleStrategy,
  grok: grokRunnerLifecycleStrategy,
  dsh: dshRunnerLifecycleStrategy,
  "kimi-code": kimiCodeRunnerLifecycleStrategy,
};

export function stopManagedRunner(entry: RunnerEntry): void {
  if (entry.cli === "codex") {
    codexRunnerLifecycleStrategy.stop(entry.runner);
    return;
  }
  if (entry.cli === "claude") {
    claudeRunnerLifecycleStrategy.stop(entry.runner);
    return;
  }
  if (entry.cli === "grok") {
    grokRunnerLifecycleStrategy.stop(entry.runner);
    return;
  }
  if (entry.cli === "dsh") {
    dshRunnerLifecycleStrategy.stop(entry.runner);
    return;
  }
  kimiCodeRunnerLifecycleStrategy.stop(entry.runner);
}
