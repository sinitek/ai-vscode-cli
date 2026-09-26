import type { RunProcess } from "../cli/commandRunner";
import type {
  OpenCodeSubagentConnection,
  OpenCodeSubagentMonitor,
} from "../cli/openCodeSubagentMonitor";
import type {
  OpenCodeRuntimePreparation,
  PreparedOpenCodeSubagentRuntime,
} from "./promptExecutionShared";

type OpenCodeLongConnectionPreparer = OpenCodeSubagentRuntimePreparer;

const openCodeLongConnectionPreparers = new Set<OpenCodeLongConnectionPreparer>();

type OpenCodeSubagentRuntimeLogPayload = Record<string, unknown>;

type OpenCodeSubagentServerHandlers = {
  onStderr?: (content: string) => void;
  onError?: (error: Error) => void;
  onExit?: (code: number | null) => void;
};

type OpenCodeSubagentServerOptions = {
  cwd?: string;
  model?: string | null;
  openCodeSmallModel?: string | null;
  openCodeVariant?: string | null;
  openCodeSmallVariant?: string | null;
  openCodeConfigContent?: string;
  envOverrides?: Record<string, string>;
  isolateProjectInstructions?: boolean;
  processLabel?: string;
};

export type PrepareOpenCodeSubagentRuntimeOptions = {
  cwd: string | undefined;
  runId: string;
  runtime: OpenCodeRuntimePreparation;
  isolateProjectInstructions?: boolean;
};

export type OpenCodeSubagentRuntimePreparer = ((
  options: PrepareOpenCodeSubagentRuntimeOptions,
) => Promise<PreparedOpenCodeSubagentRuntime>) & {
  countAlive: () => number;
  dispose: () => void;
};

export function countAliveOpenCodeLongConnections(): number {
  let count = 0;
  for (const preparer of openCodeLongConnectionPreparers) {
    count += preparer.countAlive();
  }
  return count;
}

type PooledOpenCodeServer = {
  key: string;
  cwd: string;
  connection: OpenCodeSubagentConnection;
  process: RunProcess;
  refCount: number;
  alive: boolean;
};

export type OpenCodeSubagentRuntimeDeps = {
  getOpenCodeCliArgs: () => readonly string[];
  resolveConnection: (
    args: readonly string[],
    options: { env: Record<string, string> },
  ) => Promise<OpenCodeSubagentConnection>;
  startServer: (
    port: number,
    handlers: OpenCodeSubagentServerHandlers,
    options: OpenCodeSubagentServerOptions,
  ) => RunProcess;
  waitForServerReady: (
    connection: OpenCodeSubagentConnection,
    directory: string,
  ) => Promise<void>;
  buildServerProcessLabel: (runId: string) => string;
  getDefaultDirectory: () => string;
  logDebug: (event: string, payload: OpenCodeSubagentRuntimeLogPayload) => void;
  logInfo: (event: string, payload: OpenCodeSubagentRuntimeLogPayload) => void;
  logError: (event: string, payload: OpenCodeSubagentRuntimeLogPayload) => void;
};

export function createDisabledOpenCodeSubagentMonitor(): OpenCodeSubagentMonitor {
  return {
    setParentSessionId: () => undefined,
    pollNow: async () => undefined,
    finish: () => undefined,
    dispose: () => undefined,
  };
}

function applyBasicAuthEnvOverrides(
  envOverrides: Record<string, string>,
  authorization: string | undefined,
): Record<string, string> {
  const nextEnvOverrides = { ...envOverrides };
  if (!authorization?.startsWith("Basic ")) {
    return nextEnvOverrides;
  }
  const credentials = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  const separatorIndex = credentials.indexOf(":");
  if (separatorIndex >= 0) {
    nextEnvOverrides.OPENCODE_SERVER_USERNAME = credentials.slice(0, separatorIndex);
    nextEnvOverrides.OPENCODE_SERVER_PASSWORD = credentials.slice(separatorIndex + 1);
  }
  return nextEnvOverrides;
}

export function createOpenCodeSubagentRuntimePreparer(
  deps: OpenCodeSubagentRuntimeDeps,
): OpenCodeSubagentRuntimePreparer {
  const pool = new Map<string, PooledOpenCodeServer>();
  const inflight = new Map<string, Promise<PooledStart>>();

  function retire(entry: PooledOpenCodeServer): void {
    if (!entry.alive) {
      return;
    }
    entry.alive = false;
    entry.process.kill();
  }

  function evictIdleServers(cwd: string, nextKey: string): void {
    for (const [key, entry] of pool) {
      if (key === nextKey || entry.refCount > 0 || entry.cwd !== cwd) {
        continue;
      }
      retire(entry);
      pool.delete(key);
    }
  }

  function countAlive(): number {
    let count = 0;
    for (const entry of pool.values()) {
      if (entry.alive) {
        count += 1;
      }
    }
    return count;
  }

  function dispose(): void {
    for (const entry of [...pool.values()]) {
      retire(entry);
    }
    pool.clear();
  }

  function leaseRuntime(entry: PooledOpenCodeServer): PreparedOpenCodeSubagentRuntime {
    let released = false;
    return {
      connection: entry.connection,
      endpointSource: "managed-server",
      error: null,
      dispose: () => {
        if (released) {
          return;
        }
        released = true;
        entry.refCount = Math.max(0, entry.refCount - 1);
      },
    };
  }

  async function startPooledServer(
    options: PrepareOpenCodeSubagentRuntimeOptions,
    directory: string,
    key: string,
  ): Promise<PooledStart> {
    const connection = await deps.resolveConnection(deps.getOpenCodeCliArgs(), {
      env: options.runtime.envOverrides,
    });
    if (!connection.serverPort) {
      return {
        kind: "attach",
        connection,
      };
    }

    evictIdleServers(directory, key);
    const managedServerEnvOverrides = applyBasicAuthEnvOverrides(
      options.runtime.envOverrides,
      connection.authorization,
    );
    let serverReady = false;
    let rejectServerLifecycle: ((error: Error) => void) | null = null;
    const serverLifecycleFailure = new Promise<never>((_resolve, reject) => {
      rejectServerLifecycle = reject;
    });
    const serverProcess = deps.startServer(connection.serverPort, {
      onStderr: (content) => {
        if (content.trim()) {
          deps.logDebug("opencode-subagent-server-stderr", {
            runId: options.runId,
            port: connection.serverPort,
            contentLength: content.length,
          });
        }
      },
      onError: (error) => {
        deps.logError("opencode-subagent-server-error", {
          runId: options.runId,
          port: connection.serverPort,
          error: error.message,
        });
        if (!serverReady) {
          rejectServerLifecycle?.(error);
        }
      },
      onExit: (code) => {
        deps.logInfo("opencode-subagent-server-exit", {
          runId: options.runId,
          port: connection.serverPort,
          code,
        });
        const pooled = pool.get(key);
        if (pooled) {
          pooled.alive = false;
          pool.delete(key);
        }
        if (!serverReady) {
          rejectServerLifecycle?.(new Error(`OpenCode server exited before readiness with code ${code ?? "unknown"}.`));
        }
      },
    }, {
      cwd: options.cwd,
      model: options.runtime.effectiveModel,
      openCodeSmallModel: options.runtime.subtaskModel,
      openCodeVariant: options.runtime.effectiveVariant,
      openCodeSmallVariant: options.runtime.subtaskVariant,
      openCodeConfigContent: options.runtime.configContent,
      envOverrides: managedServerEnvOverrides,
      isolateProjectInstructions: options.isolateProjectInstructions,
      processLabel: deps.buildServerProcessLabel(options.runId),
    });
    if (!serverProcess.pid) {
      serverProcess.kill();
      throw new Error("OpenCode server process did not start.");
    }

    try {
      await Promise.race([
        deps.waitForServerReady(connection, directory),
        serverLifecycleFailure,
      ]);
    } catch (error) {
      serverProcess.kill();
      throw error;
    }
    serverReady = true;
    const entry: PooledOpenCodeServer = {
      key,
      cwd: directory,
      connection,
      process: serverProcess,
      refCount: 0,
      alive: true,
    };
    pool.set(key, entry);
    deps.logInfo("opencode-subagent-server-ready", {
      runId: options.runId,
      port: connection.serverPort,
      pid: serverProcess.pid ?? null,
    });
    return {
      kind: "server",
      entry,
    };
  }

  async function prepareOpenCodeSubagentRuntime(
    options: PrepareOpenCodeSubagentRuntimeOptions,
  ): Promise<PreparedOpenCodeSubagentRuntime> {
    const directory = options.cwd ?? deps.getDefaultDirectory();
    const key = buildOpenCodeServerPoolKey(deps.getOpenCodeCliArgs(), directory, options);
    const existing = pool.get(key);
    if (existing?.alive) {
      try {
        await deps.waitForServerReady(existing.connection, directory);
        existing.refCount += 1;
        deps.logInfo("opencode-long-connection-reused", {
          runId: options.runId,
          port: existing.connection.serverPort ?? null,
          pid: existing.process.pid ?? null,
          refCount: existing.refCount,
        });
        return leaseRuntime(existing);
      } catch (error) {
        retire(existing);
        pool.delete(key);
        deps.logError("opencode-long-connection-unhealthy", {
          runId: options.runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let pending = inflight.get(key);
    if (!pending) {
      pending = startPooledServer(options, directory, key).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, pending);
    }

    try {
      const started = await pending;
      if (started.kind === "attach") {
        return {
          connection: started.connection,
          endpointSource: "configured-attach",
          error: null,
          dispose: () => undefined,
        };
      }
      started.entry.refCount += 1;
      return leaseRuntime(started.entry);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      deps.logError("opencode-subagent-server-unavailable", {
        runId: options.runId,
        error: normalizedError.message,
      });
      return {
        connection: null,
        endpointSource: "unavailable",
        error: normalizedError,
        dispose: () => undefined,
      };
    }
  }

  const preparer = prepareOpenCodeSubagentRuntime as OpenCodeSubagentRuntimePreparer;
  preparer.countAlive = countAlive;
  preparer.dispose = dispose;
  openCodeLongConnectionPreparers.add(preparer);
  return preparer;
}

type PooledStart = {
  kind: "attach";
  connection: OpenCodeSubagentConnection;
} | {
  kind: "server";
  entry: PooledOpenCodeServer;
};

function buildOpenCodeServerPoolKey(
  args: readonly string[],
  cwd: string,
  options: PrepareOpenCodeSubagentRuntimeOptions,
): string {
  const envEntries = Object.entries(options.runtime.envOverrides).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    args,
    cwd,
    isolate: options.isolateProjectInstructions === true,
    model: options.runtime.effectiveModel,
    smallModel: options.runtime.subtaskModel,
    variant: options.runtime.effectiveVariant,
    smallVariant: options.runtime.subtaskVariant,
    config: options.runtime.configContent,
    env: envEntries,
  });
}
