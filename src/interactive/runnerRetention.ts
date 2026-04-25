import { CliName } from "../cli/types";

export type InteractiveSessionBinding = {
  cli: CliName;
  sessionId: string | null | undefined;
};

const INTERACTIVE_RUNNER_CLIS: readonly CliName[] = ["codex", "claude"];

export function buildInteractiveSessionKey(
  cli: CliName,
  sessionId: string | null | undefined,
): string | null {
  if (!INTERACTIVE_RUNNER_CLIS.includes(cli)) {
    return null;
  }
  const normalizedSessionId = typeof sessionId === "string" && sessionId.trim()
    ? sessionId.trim()
    : null;
  if (!normalizedSessionId) {
    return null;
  }
  return `${cli}:${normalizedSessionId}`;
}

export function collectInteractiveSessionKeys(
  bindings: readonly InteractiveSessionBinding[],
): Set<string> {
  const keys = new Set<string>();
  bindings.forEach((binding) => {
    const key = buildInteractiveSessionKey(binding.cli, binding.sessionId);
    if (key) {
      keys.add(key);
    }
  });
  return keys;
}

export function collectReferencedInteractiveSessionKeys(
  sessionIdMaps: ReadonlyArray<Partial<Record<CliName, string>> | null | undefined>,
): Set<string> {
  const keys = new Set<string>();
  sessionIdMaps.forEach((sessionIdMap) => {
    if (!sessionIdMap) {
      return;
    }
    INTERACTIVE_RUNNER_CLIS.forEach((cli) => {
      const key = buildInteractiveSessionKey(cli, sessionIdMap[cli]);
      if (key) {
        keys.add(key);
      }
    });
  });
  return keys;
}

export function shouldDisposeInteractiveSession(
  binding: InteractiveSessionBinding,
  options: {
    referencedSessionKeys: ReadonlySet<string>;
    activeSessionKeys: ReadonlySet<string>;
  },
): boolean {
  const key = buildInteractiveSessionKey(binding.cli, binding.sessionId);
  if (!key) {
    return false;
  }
  return !options.referencedSessionKeys.has(key) && !options.activeSessionKeys.has(key);
}
