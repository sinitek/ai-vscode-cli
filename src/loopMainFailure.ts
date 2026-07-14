export const LOBSTER_MAIN_AI_FAILURE_LIMIT = 5;

export type LobsterMainAiFailureState = {
  mainAiFailureCount?: number;
  mainAiFailureLimitReached?: boolean;
  mainAiLastFailureAt?: number;
  mainAiLastFailureMessage?: string;
};

export function normalizeLobsterMainAiFailureCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function isLobsterMainAiFailureLimitReached(
  state: Pick<LobsterMainAiFailureState, "mainAiFailureCount" | "mainAiFailureLimitReached">,
): boolean {
  return Boolean(state.mainAiFailureLimitReached)
    || normalizeLobsterMainAiFailureCount(state.mainAiFailureCount) >= LOBSTER_MAIN_AI_FAILURE_LIMIT;
}

export function buildNextLobsterMainAiFailureState(
  state: Pick<LobsterMainAiFailureState, "mainAiFailureCount">,
  options: { failureMessage?: string | null; now?: number } = {},
): Required<Pick<LobsterMainAiFailureState,
  "mainAiFailureCount" | "mainAiFailureLimitReached" | "mainAiLastFailureAt" | "mainAiLastFailureMessage"
>> {
  const nextCount = normalizeLobsterMainAiFailureCount(state.mainAiFailureCount) + 1;
  return {
    mainAiFailureCount: nextCount,
    mainAiFailureLimitReached: nextCount >= LOBSTER_MAIN_AI_FAILURE_LIMIT,
    mainAiLastFailureAt: options.now ?? Date.now(),
    mainAiLastFailureMessage: typeof options.failureMessage === "string" ? options.failureMessage.trim() : "",
  };
}

export function buildResetLobsterMainAiFailureState(): Required<Pick<LobsterMainAiFailureState,
  "mainAiFailureCount" | "mainAiFailureLimitReached"
>> & Pick<LobsterMainAiFailureState, "mainAiLastFailureAt" | "mainAiLastFailureMessage"> {
  return {
    mainAiFailureCount: 0,
    mainAiFailureLimitReached: false,
    mainAiLastFailureAt: undefined,
    mainAiLastFailureMessage: undefined,
  };
}
