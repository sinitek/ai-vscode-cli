export type LoopMainAutoCompactRequest = {
  overlapLoopDispatch?: boolean;
};

export type LoopMainAutoCompactRunRequest = {
  allowActiveRun: boolean;
  onStopReady?: (stop: () => void) => void;
};

export type LoopMainAutoCompactReservation = {
  adoptStop: (stop: () => void) => void;
  release: () => void;
};

export function shouldOverlapLoopMainContextCompaction(input: {
  taskRole?: string | null;
  loopTaskId?: string | null;
}): boolean {
  return input.taskRole === "main"
    && typeof input.loopTaskId === "string"
    && input.loopTaskId.trim().length > 0;
}

/**
 * Tracks an in-flight Loop/Loop+ main-session compaction so the next prompt on
 * that same tab waits, while prompts on other tabs do not.
 */
export class LoopMainAutoCompactFlights {
  private readonly flights = new Map<string, Promise<void>>();

  track(tabId: string, flight: Promise<void>): void {
    const tracked = flight.then(() => undefined, () => undefined).finally(() => {
      if (this.flights.get(tabId) === tracked) {
        this.flights.delete(tabId);
      }
    });
    this.flights.set(tabId, tracked);
  }

  has(tabId: string | null | undefined): boolean {
    return Boolean(tabId && this.flights.has(tabId));
  }

  async wait(tabId: string | null | undefined): Promise<void> {
    if (!tabId) {
      return;
    }
    const flight = this.flights.get(tabId);
    if (flight) {
      await flight;
    }
  }
}

/**
 * Loop/Loop+ main compaction only rewrites the main session. Subtask dispatch
 * uses other sessions, so it can start without waiting. The next prompt on the
 * main tab still waits via LoopMainAutoCompactFlights.
 */
export async function settleAutoCompactAfterPrompt(options: {
  overlapLoopDispatch: boolean;
  canOverlap: boolean;
  run: (request: LoopMainAutoCompactRunRequest) => Promise<void>;
  reserve: () => LoopMainAutoCompactReservation;
  track: (flight: Promise<void>) => void;
}): Promise<void> {
  if (!options.overlapLoopDispatch || !options.canOverlap) {
    await options.run({ allowActiveRun: false });
    return;
  }

  const reservation = options.reserve();
  let flight: Promise<void>;
  try {
    flight = options.run({
      allowActiveRun: true,
      onStopReady: reservation.adoptStop,
    });
  } catch (error) {
    reservation.release();
    throw error;
  }
  const tracked = flight.finally(() => {
    reservation.release();
  });
  options.track(tracked);
}

export function mergeCompactTranscriptIntoLive<T extends { id: string }>(
  live: T[],
  compactSnapshot: readonly T[],
): T[] {
  const seen = new Set(live.map((message) => message.id));
  for (const message of compactSnapshot) {
    if (seen.has(message.id)) {
      continue;
    }
    live.push(message);
    seen.add(message.id);
  }
  return live;
}
