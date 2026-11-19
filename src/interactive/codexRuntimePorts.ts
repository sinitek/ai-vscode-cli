/** Trusted in-process options. No host configuration or implicit logging defaults. */
export type CodexRuntimePorts = Readonly<{
  macTaskShell: "bash" | "zsh";
  logInfo: (message: string, data?: unknown) => void | Promise<void>;
  logError: (message: string, data?: unknown) => void | Promise<void>;
  /** Exclusive native transport pacing only; excludes interactive request answers.
   * A bounded private consumer window must drain before another notification. */
  waitForNotificationConsumers?: () => Promise<void>;
}>;

/** Snapshot once: startup and capability probing must use the same shell selection. */
export function freezeCodexRuntimePorts(ports: CodexRuntimePorts): CodexRuntimePorts {
  if (!ports || !["bash", "zsh"].includes(ports.macTaskShell)
    || typeof ports.logInfo !== "function" || typeof ports.logError !== "function") {
    throw new TypeError("Explicit Codex macTaskShell and log ports are required");
  }
  return Object.freeze({
    macTaskShell: ports.macTaskShell,
    logInfo: ports.logInfo.bind(ports),
    logError: ports.logError.bind(ports),
    waitForNotificationConsumers: ports.waitForNotificationConsumers?.bind(ports),
  });
}
