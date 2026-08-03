import type { RunProcess } from "../cli/commandRunner";
import type {
  OpenCodeSubagentConnection,
  OpenCodeSubagentMonitor,
} from "../cli/openCodeSubagentMonitor";
import type {
  OpenCodeRuntimePreparation,
  PreparedOpenCodeSubagentRuntime,
} from "./promptExecutionShared";

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
): (options: PrepareOpenCodeSubagentRuntimeOptions) => Promise<PreparedOpenCodeSubagentRuntime> {
  return async function prepareOpenCodeSubagentRuntime(
    options: PrepareOpenCodeSubagentRuntimeOptions,
  ): Promise<PreparedOpenCodeSubagentRuntime> {
    const directory = options.cwd ?? deps.getDefaultDirectory();
    let managedServerProcess: RunProcess | null = null;
    try {
      const connection = await deps.resolveConnection(deps.getOpenCodeCliArgs(), {
        env: options.runtime.envOverrides,
      });
      if (!connection.serverPort) {
        return {
          connection,
          endpointSource: "configured-attach",
          error: null,
          dispose: () => undefined,
        };
      }

      const managedServerEnvOverrides = applyBasicAuthEnvOverrides(
        options.runtime.envOverrides,
        connection.authorization,
      );

      let disposed = false;
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
      managedServerProcess = serverProcess;
      if (!serverProcess.pid) {
        throw new Error("OpenCode server process did not start.");
      }

      await Promise.race([
        deps.waitForServerReady(connection, directory),
        serverLifecycleFailure,
      ]);
      serverReady = true;
      deps.logInfo("opencode-subagent-server-ready", {
        runId: options.runId,
        port: connection.serverPort,
        pid: serverProcess.pid ?? null,
      });
      return {
        connection,
        endpointSource: "managed-server",
        error: null,
        dispose: () => {
          if (disposed) {
            return;
          }
          disposed = true;
          serverProcess.kill();
        },
      };
    } catch (error) {
      managedServerProcess?.kill();
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
  };
}
