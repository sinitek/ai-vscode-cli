export type LoopMainAutoCompactRequest = {
  /** The enclosing Vibe run leaves terminal status publication to compaction. */
  onStarted?: () => void;
  overlapLoopDispatch?: boolean;
  isolatedRun?: boolean;
};

export type LoopMainAutoCompactRunRequest = {
  allowActiveRun: boolean;
  onStopReady?: (stop: () => void) => void;
  onStarted?: () => void;
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

export async function settleAutoCompactAfterPrompt(options: {
  overlapLoopDispatch: boolean;
  canOverlap: () => boolean;
  onStarted?: () => void;
  run: (request: LoopMainAutoCompactRunRequest) => Promise<void>;
  reserve: () => LoopMainAutoCompactReservation;
  enqueue: (run: () => Promise<void>) => void;
}): Promise<void> {
  if (!options.overlapLoopDispatch) {
    await options.run({ allowActiveRun: false, onStarted: options.onStarted });
    return;
  }
  options.enqueue(async () => {
    if (!options.canOverlap()) {
      await options.run({ allowActiveRun: false, onStarted: options.onStarted });
      return;
    }
    const reservation = options.reserve();
    try {
      await options.run({ allowActiveRun: true, onStopReady: reservation.adoptStop, onStarted: options.onStarted });
    } finally {
      reservation.release();
    }
  });
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
