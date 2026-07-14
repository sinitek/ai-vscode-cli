export const LOOP_MAIN_AI_FAILURE_LIMIT = 5;

export type LoopMainAiFailureState = {
  mainAiFailureCount?: number;
  mainAiFailureLimitReached?: boolean;
  mainAiLastFailureAt?: number;
  mainAiLastFailureMessage?: string;
};

export function normalizeLoopMainAiFailureCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function isLoopMainAiFailureLimitReached(
  state: Pick<LoopMainAiFailureState, "mainAiFailureCount" | "mainAiFailureLimitReached">,
): boolean {
  return Boolean(state.mainAiFailureLimitReached)
    || normalizeLoopMainAiFailureCount(state.mainAiFailureCount) >= LOOP_MAIN_AI_FAILURE_LIMIT;
}

export function buildNextLoopMainAiFailureState(
  state: Pick<LoopMainAiFailureState, "mainAiFailureCount">,
  options: { failureMessage?: string | null; now?: number } = {},
): Required<Pick<LoopMainAiFailureState,
  "mainAiFailureCount" | "mainAiFailureLimitReached" | "mainAiLastFailureAt" | "mainAiLastFailureMessage"
>> {
  const nextCount = normalizeLoopMainAiFailureCount(state.mainAiFailureCount) + 1;
  return {
    mainAiFailureCount: nextCount,
    mainAiFailureLimitReached: nextCount >= LOOP_MAIN_AI_FAILURE_LIMIT,
    mainAiLastFailureAt: options.now ?? Date.now(),
    mainAiLastFailureMessage: typeof options.failureMessage === "string" ? options.failureMessage.trim() : "",
  };
}

export function buildResetLoopMainAiFailureState(): Required<Pick<LoopMainAiFailureState,
  "mainAiFailureCount" | "mainAiFailureLimitReached"
>> & Pick<LoopMainAiFailureState, "mainAiLastFailureAt" | "mainAiLastFailureMessage"> {
  return {
    mainAiFailureCount: 0,
    mainAiFailureLimitReached: false,
    mainAiLastFailureAt: undefined,
    mainAiLastFailureMessage: undefined,
  };
}
