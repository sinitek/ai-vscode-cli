import { CLI_LIST, type CliName } from "./cli/types";
import type { LoopSubtaskDecision, LoopSubtaskRecord, LoopTaskRecord } from "./loopTaskStore";
import type { LoopPlusDecision } from "./loopPlusDecision";

export type LoopSubtaskSession = {
  cli: CliName;
  sessionId: string;
  configId: string | null;
};

export function readLoopContinuationSource(value: unknown): string | undefined | null {
  if (value == null) {
    return undefined;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeLoopSubtaskSession(value: unknown): LoopSubtaskSession | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Partial<LoopSubtaskSession>;
  if (!CLI_LIST.includes(raw.cli as CliName) || typeof raw.sessionId !== "string" || !raw.sessionId.trim()
    || raw.sessionId.trim().startsWith("local_") || (raw.configId !== null && typeof raw.configId !== "string")) {
    return undefined;
  }
  return { cli: raw.cli as CliName, sessionId: raw.sessionId.trim(), configId: raw.configId?.trim() || null };
}

export function resolveLoopSubtaskSession(
  task: Pick<LoopTaskRecord, "subTasks">,
  subtask: Pick<LoopSubtaskDecision, "id" | "continueFromSubtaskId">,
  cli: CliName,
  configId: string | null | undefined,
): { sessionId: string | null; sourceSubtaskId: string | null; reason: string } {
  const sourceSubtaskId = subtask.continueFromSubtaskId || subtask.id || null;
  const source = task.subTasks.find((item) => item.id === sourceSubtaskId);
  const binding = normalizeLoopSubtaskSession(source?.executionSession);
  if (!binding) {
    return { sessionId: null, sourceSubtaskId, reason: "来源子任务没有可恢复的会话，使用新会话" };
  }
  if (binding.cli !== cli || binding.configId !== (configId?.trim() || null)) {
    return { sessionId: null, sourceSubtaskId, reason: "来源会话的 CLI 或配置不兼容，使用新会话" };
  }
  return { sessionId: binding.sessionId, sourceSubtaskId, reason: "续接来源子任务会话" };
}

export function bindLoopSubtaskSession(
  subtasks: readonly LoopSubtaskRecord[],
  subtaskId: string,
  session: LoopSubtaskSession,
): LoopSubtaskRecord[] {
  const binding = normalizeLoopSubtaskSession(session);
  return subtasks.map((item) => item.id === subtaskId && binding ? { ...item, executionSession: binding } : item);
}

const sessionLeases = new Map<string, Promise<void>>();

export function inheritLoopPlusRepairSessions(
  decision: LoopPlusDecision,
  events: readonly { eventId: string; subtaskId: string }[],
): LoopPlusDecision {
  if (decision.status !== "accept" || !decision.subtasks?.length) {
    return decision;
  }
  const failedRepairSources = new Map<string, Set<string>>();
  decision.reviews
    ?.filter((review) => review.acceptance === "failed")
    .forEach((review) => {
      const sourceSubtaskId = events.find((event) => event.eventId === review.reviewEventId)?.subtaskId;
      if (!sourceSubtaskId) {
        return;
      }
      (review.subtaskIds ?? []).forEach((repairId) => {
        const sources = failedRepairSources.get(repairId) ?? new Set<string>();
        sources.add(sourceSubtaskId);
        failedRepairSources.set(repairId, sources);
      });
    });
  if (failedRepairSources.size === 0) {
    return decision;
  }
  return {
    ...decision,
    subtasks: decision.subtasks.map((subtask) => {
      const mappedSources = subtask.id ? failedRepairSources.get(subtask.id) : undefined;
      const inferredSource = mappedSources?.size === 1 ? Array.from(mappedSources)[0] : null;
      return !subtask.continueFromSubtaskId && inferredSource
        ? { ...subtask, continueFromSubtaskId: inferredSource }
        : subtask;
    }),
  };
}

export async function withLoopSubtaskSession<T>(
  cli: CliName,
  sessionId: string | null,
  run: () => Promise<T>,
  context?: { taskId: string; subtaskId: string; sourceSubtaskId?: string | null },
): Promise<T> {
  const keys = new Set<string>();
  if (sessionId) {
    keys.add(JSON.stringify(["session", cli, sessionId]));
  }
  if (context) {
    keys.add(JSON.stringify(["subtask", context.taskId, context.subtaskId]));
    if (context.sourceSubtaskId) {
      keys.add(JSON.stringify(["subtask", context.taskId, context.sourceSubtaskId]));
    }
  }
  const ordered = Array.from(keys).sort();
  const acquire = (index: number): Promise<T> => index === ordered.length
    ? run()
    : withSessionLease(ordered[index], () => acquire(index + 1));
  return acquire(0);
}

async function withSessionLease<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = sessionLeases.get(key);
  let release!: () => void;
  const lease = new Promise<void>((resolve) => { release = resolve; });
  sessionLeases.set(key, lease);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (sessionLeases.get(key) === lease) {
      sessionLeases.delete(key);
    }
  }
}
