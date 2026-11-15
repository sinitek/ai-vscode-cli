export function buildOpenCodeRunArgs(
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
    if (!hasAttach) nextArgs.push("--attach", normalizedServerUrl);
  }
  if (sessionId && !nextArgs.includes("--session") && !nextArgs.includes("-s")) {
    return [...nextArgs, "--session", sessionId, prompt];
  }
  return [...nextArgs, prompt];
}
