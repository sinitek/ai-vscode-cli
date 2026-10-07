import { createHash } from "crypto";
import { resolveLoopAnswerConclusion } from "../loopDebateFinalSummary";
import {
  isLoopMainAiFailureLimitReached,
  LOOP_MAIN_AI_FAILURE_LIMIT,
  type LoopMainAiFailureState,
} from "../loopMainFailure";
import { ORCHESTRATOR_CLARIFICATION_LIMIT } from "../orchestratorClarification";
import type {
  LoopMainDecision,
  LoopSchedulingMode,
  LoopSubtaskDecision,
  LoopSubtaskRecord,
  LoopTaskRecord,
} from "../loopTaskStore";

export const LOOP_EVENT_DRIVEN_INTERRUPT_SUMMARY = "Loop+ orchestration stopped after an error. The scheduling snapshot was not cleared or downgraded.";

export type LoopMainDecisionTransitionStatus = "completed" | "continue" | "blocked" | "clarify";

export type LoopMainDecisionContext = {
  task: LoopTaskRecord;
  decision: LoopMainDecision;
  now: number;
};

export type LoopMainDecisionTransition = {
  status: LoopMainDecisionTransitionStatus;
  patch: Partial<LoopTaskRecord>;
  subtasks?: LoopSubtaskRecord[];
  appendDecisionMessages: boolean;
};

export type LoopStopContext = {
  task: LoopTaskRecord;
  now: number;
  finalSummary?: string;
  subtaskSummary?: string;
  participantSummary?: string;
};

export type LoopStopMemberUpdate = {
  persist: boolean;
  subTasks: LoopSubtaskRecord[];
  debateRounds?: NonNullable<LoopTaskRecord["debateRounds"]>;
};

export type LoopStopTransition = {
  idempotent: boolean;
  preserveActivitySnapshot: boolean;
  abortClarification: boolean;
  refreshGroupChat: boolean;
  patch: Partial<LoopTaskRecord>;
  activity: LoopStopMemberUpdate;
};

export type LoopInterruptContext = {
  task: LoopTaskRecord | null;
  status: "error" | "stopped";
  source: "main" | "subtask";
  failureMessage?: string | null;
  now: number;
};

export type LoopInterruptTransition = {
  idempotent: boolean;
  preserveActivitySnapshot: boolean;
  applyMainAiFailureCount: boolean;
  appendNeedsReviewMessage: boolean;
  patch: Partial<LoopTaskRecord>;
};

export type LoopMainDecisionStrategy = (context: LoopMainDecisionContext) => LoopMainDecisionTransition;

export type LoopStopStrategy = (context: LoopStopContext) => LoopStopTransition;

export type LoopInterruptStrategy = (context: LoopInterruptContext) => LoopInterruptTransition;

export type LoopTaskTransitionStrategyRegistry = {
  mainDecision: {
    completed: LoopMainDecisionStrategy;
    clarify: LoopMainDecisionStrategy;
    blocked: LoopMainDecisionStrategy;
    continue: LoopMainDecisionStrategy;
  };
  stop: {
    classic: LoopStopStrategy;
    event_driven: LoopStopStrategy;
  };
  interrupt: {
    classic: LoopInterruptStrategy;
    event_driven: LoopInterruptStrategy;
  };
};

export function buildLoopSubtaskId(title: string): string {
  return `subtask_${createHash("sha1").update(title).digest("hex").slice(0, 10)}`;
}

export function getLoopDecisionSubtasks(decision: LoopMainDecision): LoopSubtaskDecision[] {
  if (Array.isArray(decision.subtasks) && decision.subtasks.length > 0) {
    return decision.subtasks;
  }
  return decision.subtask ? [decision.subtask] : [];
}

export function getActiveLoopSubtaskIds(task: Pick<LoopTaskRecord, "activeSubtaskId" | "activeSubtaskIds">): string[] {
  const ids = Array.isArray(task.activeSubtaskIds) ? task.activeSubtaskIds : [];
  const normalized = ids.filter((id) => typeof id === "string" && id.trim());
  if (task.activeSubtaskId && !normalized.includes(task.activeSubtaskId)) {
    normalized.unshift(task.activeSubtaskId);
  }
  return Array.from(new Set(normalized));
}

export function upsertLoopTransitionSubtask(
  task: LoopTaskRecord,
  subtask: LoopSubtaskDecision,
  now: number,
): { record: LoopSubtaskRecord; nextSubtasks: LoopSubtaskRecord[] } {
  const id = subtask.id && subtask.id.trim() ? subtask.id.trim() : buildLoopSubtaskId(subtask.title);
  const nextSubtasks = [...task.subTasks];
  const existingIndex = nextSubtasks.findIndex((item) => item.id === id);
  const record: LoopSubtaskRecord = {
    id,
    title: subtask.title,
    prompt: subtask.prompt,
    conflictGroup: subtask.conflictGroup,
    writeFiles: subtask.writeFiles,
    status: "running",
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    const { skillIds: _skillIds, skillGuidance: _skillGuidance, ...existingRecord } = nextSubtasks[existingIndex];
    const nextRecord: LoopSubtaskRecord = {
      ...existingRecord,
      ...record,
      status: existingRecord.status === "completed" ? "completed" : "running",
    };
    nextSubtasks[existingIndex] = nextRecord;
    return { record: nextRecord, nextSubtasks };
  }
  nextSubtasks.push(record);
  return { record, nextSubtasks };
}

export function upsertLoopTransitionSubtasks(
  task: LoopTaskRecord,
  subtasks: readonly LoopSubtaskDecision[],
  now: number,
): { records: LoopSubtaskRecord[]; nextSubtasks: LoopSubtaskRecord[] } {
  let nextSubtasks = [...task.subTasks];
  const records: LoopSubtaskRecord[] = [];
  subtasks.forEach((subtask) => {
    const result = upsertLoopTransitionSubtask({ ...task, subTasks: nextSubtasks }, subtask, now);
    nextSubtasks = result.nextSubtasks;
    records.push(result.record);
  });
  return { records, nextSubtasks };
}

export function loopInterruptFailureLimitPatch(
  failureState: Pick<LoopMainAiFailureState, "mainAiFailureCount" | "mainAiFailureLimitReached">,
  failureMessage?: string | null,
): Partial<LoopTaskRecord> {
  if (!isLoopMainAiFailureLimitReached(failureState)) {
    return {};
  }
  return {
    status: "needs-review",
    finalSummary: [
      `主任务 AI 调用已连续失败 ${failureState.mainAiFailureCount}/${LOOP_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`,
      failureMessage ? `最近一次失败：${failureMessage}` : "",
    ].filter(Boolean).join("\n"),
  };
}

function clearedActiveSubtasks(): Pick<LoopTaskRecord, "activeSubtaskId" | "activeSubtaskIds"> {
  return {
    activeSubtaskId: null,
    activeSubtaskIds: [],
  };
}

function applyCompletedLoopMainDecision(context: LoopMainDecisionContext): LoopMainDecisionTransition {
  return {
    status: "completed",
    appendDecisionMessages: true,
    patch: {
      status: "completed",
      ...clearedActiveSubtasks(),
      answerConclusion: resolveLoopAnswerConclusion(context.task, context.decision),
      finalSummary: context.decision.finalSummary,
      estimatedRemainingRounds: 0,
      completionRoundSummaries: context.decision.roundSummaries ?? context.task.completionRoundSummaries,
      completionRequirementCoverage: context.decision.requirementCoverage ?? context.task.completionRequirementCoverage,
      updatedAt: context.now,
    },
  };
}

function applyClarifyLoopMainDecision(context: LoopMainDecisionContext): LoopMainDecisionTransition {
  const count = context.task.clarificationCount ?? 0;
  if (!context.decision.clarification || count >= ORCHESTRATOR_CLARIFICATION_LIMIT) {
    return {
      status: "blocked",
      appendDecisionMessages: true,
      patch: {
        status: "needs-review",
        ...clearedActiveSubtasks(),
        pendingClarification: undefined,
        finalSummary: context.decision.finalSummary ?? "Main task asked for clarification too many times.",
        updatedAt: context.now,
      },
    };
  }
  return {
    status: "clarify",
    appendDecisionMessages: true,
    patch: {
      status: "running",
      ...clearedActiveSubtasks(),
      pendingClarification: context.decision.clarification,
      clarificationCount: count + 1,
      ...(context.decision.finalSummary ? { finalSummary: context.decision.finalSummary } : {}),
      ...(typeof context.decision.estimatedRemainingRounds === "number"
        ? { estimatedRemainingRounds: context.decision.estimatedRemainingRounds }
        : {}),
      updatedAt: context.now,
    },
  };
}

function applyBlockedLoopMainDecision(context: LoopMainDecisionContext): LoopMainDecisionTransition {
  return {
    status: "blocked",
    appendDecisionMessages: true,
    patch: {
      status: "needs-review",
      ...clearedActiveSubtasks(),
      finalSummary: context.decision.finalSummary ?? "Main task reported blocked.",
      ...(typeof context.decision.estimatedRemainingRounds === "number"
        ? { estimatedRemainingRounds: context.decision.estimatedRemainingRounds }
        : {}),
      updatedAt: context.now,
    },
  };
}

function applyContinueLoopMainDecision(context: LoopMainDecisionContext): LoopMainDecisionTransition {
  const decisionSubtasks = getLoopDecisionSubtasks(context.decision);
  if (decisionSubtasks.length === 0) {
    return {
      status: "blocked",
      appendDecisionMessages: false,
      patch: {
        status: "needs-review",
        ...clearedActiveSubtasks(),
        finalSummary: "Main task returned continue without subtasks.",
        updatedAt: context.now,
      },
    };
  }
  const batch = upsertLoopTransitionSubtasks(context.task, decisionSubtasks, context.now);
  const activeSubtaskIds = batch.records.map((item) => item.id);
  return {
    status: "continue",
    appendDecisionMessages: true,
    subtasks: batch.records,
    patch: {
      status: "running",
      activeSubtaskId: activeSubtaskIds[0] ?? null,
      activeSubtaskIds,
      subTasks: batch.nextSubtasks,
      ...(typeof context.decision.estimatedRemainingRounds === "number"
        ? { estimatedRemainingRounds: context.decision.estimatedRemainingRounds }
        : {}),
      updatedAt: context.now,
    },
  };
}

function stoppedLoopSubtasks(
  task: LoopTaskRecord,
  now: number,
  subtaskSummary?: string,
): LoopSubtaskRecord[] {
  const activeSubtaskIds = new Set(getActiveLoopSubtaskIds(task));
  return task.subTasks.map((subtask) => {
    const shouldStopSubtask = activeSubtaskIds.has(subtask.id)
      || subtask.status === "running"
      || subtask.status === "pending";
    if (!shouldStopSubtask) {
      return subtask;
    }
    return {
      ...subtask,
      status: "blocked",
      ...(subtask.summary || subtaskSummary ? { summary: subtask.summary || subtaskSummary } : {}),
      updatedAt: now,
    };
  });
}

function stoppedLoopDebateRounds(
  task: LoopTaskRecord,
  now: number,
  participantSummary?: string,
): LoopTaskRecord["debateRounds"] {
  return task.debateRounds?.map((round) => {
    const participants = round.participants.map((participant) => {
      if (participant.status !== "running" && participant.status !== "pending") {
        return participant;
      }
      return {
        ...participant,
        status: "stopped" as const,
        ...(participant.summary || participantSummary ? { summary: participant.summary || participantSummary } : {}),
        updatedAt: now,
      };
    });
    const shouldStopRound = round.status === "running"
      || Boolean(round.activeSpeaker)
      || round.participants.some((participant) => participant.status === "running" || participant.status === "pending");
    if (!shouldStopRound) {
      return { ...round, participants };
    }
    return {
      ...round,
      status: "stopped" as const,
      completedAt: round.completedAt ?? now,
      activeSpeaker: undefined,
      participants,
    };
  });
}

function stoppedLoopMembers(context: LoopStopContext): LoopStopMemberUpdate {
  const debateRounds = stoppedLoopDebateRounds(context.task, context.now, context.participantSummary);
  return {
    persist: false,
    subTasks: stoppedLoopSubtasks(context.task, context.now, context.subtaskSummary),
    ...(debateRounds ? { debateRounds } : {}),
  };
}

function idempotentLoopStop(task: LoopTaskRecord, preserveActivitySnapshot: boolean): LoopStopTransition {
  return {
    idempotent: true,
    preserveActivitySnapshot,
    abortClarification: false,
    refreshGroupChat: false,
    patch: {},
    activity: {
      persist: false,
      subTasks: task.subTasks,
      ...(task.debateRounds ? { debateRounds: task.debateRounds } : {}),
    },
  };
}

function applyClassicLoopStop(context: LoopStopContext): LoopStopTransition {
  if (context.task.status === "completed") {
    return idempotentLoopStop(context.task, true);
  }
  const activity = stoppedLoopMembers(context);
  return {
    idempotent: false,
    preserveActivitySnapshot: false,
    abortClarification: true,
    refreshGroupChat: true,
    activity: {
      ...activity,
      persist: true,
    },
    patch: {
      status: "stopped",
      ...clearedActiveSubtasks(),
      pendingClarification: undefined,
      subTasks: activity.subTasks,
      ...(activity.debateRounds ? { debateRounds: activity.debateRounds } : {}),
      ...(context.finalSummary ? { finalSummary: context.finalSummary } : {}),
      updatedAt: context.now,
    },
  };
}

function applyEventDrivenLoopStop(context: LoopStopContext): LoopStopTransition {
  if (context.task.status === "completed") {
    return idempotentLoopStop(context.task, true);
  }
  return {
    idempotent: false,
    preserveActivitySnapshot: true,
    abortClarification: true,
    refreshGroupChat: true,
    activity: stoppedLoopMembers(context),
    patch: {
      status: "stopped",
      schedulingMode: "event_driven",
      pendingClarification: undefined,
      ...(context.finalSummary ? { finalSummary: context.finalSummary } : {}),
      updatedAt: context.now,
    },
  };
}

function ignoredLoopInterrupt(preserveActivitySnapshot: boolean): LoopInterruptTransition {
  return {
    idempotent: true,
    preserveActivitySnapshot,
    applyMainAiFailureCount: false,
    appendNeedsReviewMessage: false,
    patch: {},
  };
}

function applyClassicLoopInterrupt(context: LoopInterruptContext): LoopInterruptTransition {
  if (context.task && context.task.status !== "running") {
    return ignoredLoopInterrupt(true);
  }
  return {
    idempotent: false,
    preserveActivitySnapshot: false,
    applyMainAiFailureCount: context.source === "main" && context.status === "error",
    appendNeedsReviewMessage: true,
    patch: {
      status: context.status,
      ...clearedActiveSubtasks(),
      pendingClarification: undefined,
      updatedAt: context.now,
    },
  };
}

function applyEventDrivenLoopInterrupt(context: LoopInterruptContext): LoopInterruptTransition {
  if (!context.task || context.task.status !== "running") {
    return ignoredLoopInterrupt(true);
  }
  const failureMessage = context.failureMessage?.trim() || "";
  return {
    idempotent: false,
    preserveActivitySnapshot: true,
    applyMainAiFailureCount: false,
    appendNeedsReviewMessage: true,
    patch: {
      status: "error",
      schedulingMode: "event_driven",
      finalSummary: failureMessage || LOOP_EVENT_DRIVEN_INTERRUPT_SUMMARY,
      updatedAt: context.now,
    },
  };
}

export const loopTaskTransitionStrategies: LoopTaskTransitionStrategyRegistry = {
  mainDecision: {
    completed: applyCompletedLoopMainDecision,
    clarify: applyClarifyLoopMainDecision,
    blocked: applyBlockedLoopMainDecision,
    continue: applyContinueLoopMainDecision,
  },
  stop: {
    classic: applyClassicLoopStop,
    event_driven: applyEventDrivenLoopStop,
  },
  interrupt: {
    classic: applyClassicLoopInterrupt,
    event_driven: applyEventDrivenLoopInterrupt,
  },
};

function resolveLoopMainDecisionStrategy(status: LoopMainDecision["status"]): LoopMainDecisionStrategy {
  switch (status) {
    case "completed":
      return loopTaskTransitionStrategies.mainDecision.completed;
    case "clarify":
      return loopTaskTransitionStrategies.mainDecision.clarify;
    case "blocked":
      return loopTaskTransitionStrategies.mainDecision.blocked;
    case "continue":
      return loopTaskTransitionStrategies.mainDecision.continue;
    default:
      return loopTaskTransitionStrategies.mainDecision.continue;
  }
}

export function transitionLoopMainDecision(context: LoopMainDecisionContext): LoopMainDecisionTransition {
  return resolveLoopMainDecisionStrategy(context.decision.status)(context);
}

export function transitionLoopTaskStop(
  schedulingMode: LoopSchedulingMode | undefined,
  context: LoopStopContext,
): LoopStopTransition {
  if (schedulingMode === "event_driven") {
    return loopTaskTransitionStrategies.stop.event_driven(context);
  }
  return loopTaskTransitionStrategies.stop.classic(context);
}

export function transitionLoopTaskInterrupt(
  schedulingMode: LoopSchedulingMode | undefined,
  context: LoopInterruptContext,
): LoopInterruptTransition {
  if (schedulingMode === "event_driven") {
    return loopTaskTransitionStrategies.interrupt.event_driven(context);
  }
  return loopTaskTransitionStrategies.interrupt.classic(context);
}
