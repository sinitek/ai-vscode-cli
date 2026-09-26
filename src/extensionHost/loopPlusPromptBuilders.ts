import {
  LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH,
  resolveLoopPlusDecisionSubtaskMax,
} from "../loopPlusDecision";
import {
  LOOP_PLUS_MAIN_PROTOCOL_PROMPT_PREFIX,
  LOOP_PLUS_SUBTASK_PROTOCOL_PROMPT_PREFIX,
} from "../loopPlusProtocolPrompt";
import { LOOP_MAIN_STALE_TASK_LIST_RULE_EN } from "../loopMainTaskListPolicy";
import type { LoopPlusExecutionRecord, LoopPlusReviewItem, LoopPlusSchedulerView } from "../loopPlusScheduler";
import type { LoopSubtaskDecision } from "../loopTaskStore";

export type LoopPlusMainPromptContext = {
  taskId: string;
  rootPrompt: string;
  taskStoreFile: string;
  mainCommunicationFile: string;
  kind: "initial" | "review" | "closeout" | "continue" | "user";
  view: LoopPlusSchedulerView;
  currentEventId: string | null;
  acceptanceEventIds?: readonly string[];
  supplementalRequirements: readonly string[];
  pendingUserMessages?: readonly string[];
  subtaskMax?: number;
};

export type LoopPlusSubtaskPromptContext = {
  taskId: string;
  rootPrompt: string;
  subtask: LoopSubtaskDecision;
  attemptId: string;
  communicationFile: string;
  taskStoreFile: string;
};

const LOOP_PLUS_EXAMPLE_SUBTASK_PROMPT = [
  "Implement this self-contained subtask inside its declared write scope only.",
  "Keep the change verifiable, record the command and result in the attempt report,",
  "and do not edit the parent task record, active ids, or loopPlus snapshot.",
].join(" ");

function formatExecution(record: LoopPlusExecutionRecord): string {
  const files = record.writeFiles.length > 0 ? record.writeFiles.join(", ") : "(none)";
  const group = record.conflictGroup ? ` group=${record.conflictGroup}` : "";
  return `- ${record.subtaskId} attempt=${record.attemptId} state=${record.state}${group} files=${files}`;
}

function formatReview(item: LoopPlusReviewItem, label: string): string {
  return `- ${label} eventId=${item.eventId} subtask=${item.subtaskId} attempt=${item.attemptId} outcome=${item.outcome} detail=${item.detail ?? ""}`;
}

function liveReviewEventId(currentEventId: string | null): string | null {
  if (typeof currentEventId !== "string") {
    return null;
  }
  const trimmed = currentEventId.trim();
  return trimmed ? trimmed : null;
}

function acceptanceEventIds(context: LoopPlusMainPromptContext): string[] {
  if (context.acceptanceEventIds) {
    return context.acceptanceEventIds
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  const single = liveReviewEventId(context.currentEventId);
  return single ? [single] : [];
}

function buildLoopPlusProtocolExamples(eventIds: readonly string[]): string {
  const subtask = {
    id: "example-subtask",
    title: "Example self-contained subtask",
    prompt: LOOP_PLUS_EXAMPLE_SUBTASK_PROMPT,
    conflictGroup: "example-scope",
    writeFiles: ["src/example-scope.ts"],
  };
  const completed: Record<string, unknown> = {
    status: "completed",
    answerConclusion: "The dispatched work meets the original request.",
    finalSummary: "Every required check passed and no execution remains.",
    acceptance: {
      passed: true,
      summary: "All acceptance checks passed.",
      checks: [
        {
          name: "dispatched work",
          passed: true,
          detail: "The attempt report matches the code and the verification evidence.",
        },
      ],
    },
    requirementCoverage: [
      {
        name: "root request",
        passed: true,
        detail: "Each original requirement is covered with passing evidence.",
      },
    ],
  };
  if (eventIds.length === 1) {
    completed.reviewEventId = eventIds[0];
  } else if (eventIds.length > 1) {
    completed.reviewEventIds = eventIds.slice();
  }
  const acceptConfirmation = eventIds.length > 1
    ? { reviewEventIds: eventIds.slice() }
    : { reviewEventId: eventIds[0] ?? "example-review-event-id" };
  const examples: Array<{ status: string; value: Record<string, unknown> }> = [
    {
      status: "dispatch",
      value: {
        status: "dispatch",
        subtasks: [subtask],
      },
    },
    {
      status: "accept",
      value: {
        status: "accept",
        ...acceptConfirmation,
        subtasks: [],
      },
    },
    {
      status: "wait",
      value: {
        status: "wait",
      },
    },
    {
      status: "blocked",
      value: {
        status: "blocked",
        finalSummary: "A person must resolve this blocker before Loop+ can proceed.",
      },
    },
    {
      status: "completed",
      value: completed,
    },
  ];
  return examples.map((example) => [
    `LOOP_PLUS_PROTOCOL_EXAMPLE ${example.status}`,
    "```json",
    JSON.stringify(example.value, null, 2),
    "```",
  ].join("\n")).join("\n");
}

export function buildLoopPlusMainModelPrompt(context: LoopPlusMainPromptContext): string {
  const subtaskMax = resolveLoopPlusDecisionSubtaskMax(context.subtaskMax);
  const current = context.view.currentReview;
  const queue = context.view.reviewQueue;
  const batchIds = acceptanceEventIds(context);
  const liveEventId = batchIds[0] ?? (
    context.acceptanceEventIds ? null : liveReviewEventId(context.currentEventId)
  );
  const requirements = context.supplementalRequirements.length > 0
    ? context.supplementalRequirements.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "(none)";
  const pendingUserMessages = context.pendingUserMessages ?? [];
  const pendingUserText = pendingUserMessages.length > 0
    ? pendingUserMessages.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "(none)";
  const running = context.view.running.length > 0
    ? context.view.running.map(formatExecution).join("\n")
    : "(none)";
  const pending = context.view.pending.length > 0
    ? context.view.pending.map(formatExecution).join("\n")
    : "(none)";
  const queued = queue.length > 0
    ? queue.map((item, index) => formatReview(item, `queued#${index + 1}`)).join("\n")
    : "(none)";
  const blockers = context.view.blockers.length > 0 ? context.view.blockers.join(", ") : "(none)";
  const batchText = batchIds.length > 0
    ? batchIds.map((eventId, index) => `${index + 1}. ${eventId}`).join("\n")
    : "(none)";
  const acceptExampleRule = batchIds.length > 1
    ? "- The accept example copies the open acceptance batch in order. Do not replace, drop, or reorder it."
    : batchIds.length === 1
      ? "- The accept example copies the one open acceptance-batch event. Do not replace it."
      : "- If the accept example uses example-review-event-id, that id is only a shape sample and must not be emitted.";
  const currentReport = current
    ? `communicationFile of subtask ${current.subtaskId} in the latest task record`
    : "(no current item)";
  return [
    `${LOOP_PLUS_MAIN_PROTOCOL_PROMPT_PREFIX} Loop+ has no batch barrier and no shared round gate.`,
    "Execution finishing is not review completion. The host owns scheduling state.",
    "Before deciding, read only these sources, in order: the current attempt report, the main communication file, and the latest task record.",
    "Compare those sources with the code and the verification evidence. Review only work that was already dispatched. Do not implement that work yourself.",
    "Do not edit scheduling state, active ids, the loopPlus snapshot, or the task record.",
    `Parent task: ${context.taskId}`,
    `Prompt kind: ${context.kind}`,
    `Record file: ${context.taskStoreFile}`,
    `Main communication file: ${context.mainCommunicationFile}`,
    `Main communication report path: ${context.mainCommunicationFile}`,
    `Latest task record path: ${context.taskStoreFile}`,
    `Current attempt report path: ${currentReport}`,
    "Queued attempt report paths: read each queued subtask communicationFile from the latest task record.",
    "Main communication and task record paths above are the supplied snapshot values. Attempt report paths are the communicationFile values stored in that record. Do not invent or hardcode a machine path.",
    `Current review eventId: ${liveEventId ?? "(none)"}`,
    current ? formatReview(current, "current") : "Current review item: (none)",
    `Acceptance batch count: ${batchIds.length}`,
    "Acceptance batch, oldest first. Confirm this whole list in this decision:",
    batchText,
    `FIFO review queue count: ${queue.length}`,
    `Visible review count including the current item: ${context.view.visibleReviewCount}`,
    "FIFO review queue, oldest first:",
    queued,
    `Still running count: ${context.view.running.length}`,
    "Still running:",
    running,
    `Still pending count: ${context.view.pending.length}`,
    "Still pending launch:",
    pending,
    `Snapshot phase: ${context.view.phase}`,
    `Snapshot completion blockers: ${blockers}`,
    `Snapshot says completion is allowed: ${context.view.canComplete ? "yes" : "no"}`,
    "Supplemental requirements:",
    requirements,
    "New user messages, oldest first. Read every message in this list together and make one decision:",
    pendingUserText,
    "Root request:",
    context.rootPrompt,
    "This prompt is a snapshot captured when the CLI started. More executions may finish and join the FIFO queue after that. The acceptance batch above stays fixed for this decision; later completions and user messages wait for the next one. Read the latest task record before choosing a status. The host re-reads that record and is the final gate; your JSON does not mutate scheduling state.",
    "Rules:",
    "- " + LOOP_MAIN_STALE_TASK_LIST_RULE_EN,
    "- dispatch starts 1 to " + subtaskMax + " new self-contained subtasks and confirms nothing. Do not send dispatch while the acceptance batch is open. Do not include reviewEventId or reviewEventIds.",
    "- Each subtask needs a title, a unique id, and a prompt of at least " + LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH + " characters that states its own goal, write scope, and verification. A shorter prompt is rejected.",
    "- accept confirms the whole acceptance batch and may append 0 to " + subtaskMax + " new subtasks. Do not send accept when the acceptance batch is (none).",
    "- When the acceptance batch has one event, copy it into reviewEventId and do not send reviewEventIds.",
    "- When the acceptance batch has more than one event, copy every id in order into reviewEventIds and do not send reviewEventId. A missing, extra, or reordered id is rejected.",
    acceptExampleRule,
    "- wait confirms nothing. Do not include reviewEventId, reviewEventIds, or subtasks. Use wait only when the acceptance batch is (none) and at least one execution is still running or pending.",
    "- When New user messages is not (none) and the acceptance batch is (none), judge the whole list together. dispatch if that work can start now. wait instead when a still-running or pending execution must finish before the new subtask can be launched. Do not dispatch a placeholder just to wait, and do not use wait when Still running and Still pending are both empty.",
    "- When New user messages is not (none) and the acceptance batch is open, read those messages in the same decision. Put work that can start now on accept. If it must wait for a still-running or pending execution, accept the batch with no new subtasks. Do not use wait or dispatch while the batch is open.",
    "- blocked asks a person for a decision and confirms nothing. Do not include reviewEventId, reviewEventIds, or subtasks. finalSummary is optional.",
    "- completed requires non-empty answerConclusion and finalSummary, acceptance.passed true, a non-empty acceptance.checks array in which every passed value is true, and a non-empty requirementCoverage array in which every passed value is true. Do not include subtasks.",
    "- When the acceptance batch has one event, completed must include that reviewEventId. When it has more than one, completed must include reviewEventIds in that order and must not include reviewEventId. When the acceptance batch is (none), omit both. A completed object missing any required field, or containing a failed check, is rejected.",
    "- Do not send confirmedEventIds or acceptedEventIds. Do not send reviewEventIds together with reviewEventId. Any of those forms rejects the whole decision.",
    "- Do not reuse the classic Loop status continue, and do not use roundSummaries as a required field or completion gate.",
    "- estimatedRemainingRounds is optional compatibility only, an integer from 0 through 100. It is not required and is not a round gate.",
    "Valid protocol examples follow. Return exactly one JSON object and do not repeat these examples.",
    buildLoopPlusProtocolExamples(batchIds),
  ].join("\n");
}

export function buildLoopPlusSubtaskModelPrompt(context: LoopPlusSubtaskPromptContext): string {
  const files = context.subtask.writeFiles && context.subtask.writeFiles.length > 0
    ? context.subtask.writeFiles.join(", ")
    : "(not declared; follow the subtask instructions)";
  return [
    `${LOOP_PLUS_SUBTASK_PROTOCOL_PROMPT_PREFIX} Finishing this attempt only writes your attempt report. It does not accept, complete, or schedule the parent task.`,
    `Parent task: ${context.taskId}`,
    `Subtask: ${context.subtask.id ?? context.subtask.title}`,
    `Attempt: ${context.attemptId}`,
    `Title: ${context.subtask.title}`,
    `Authorized write scope: ${files}`,
    `Conflict group: ${context.subtask.conflictGroup ?? "(none)"}`,
    `Attempt report file: ${context.communicationFile}`,
    `Task record file, read only: ${context.taskStoreFile}`,
    "Write the attempt report only to the attempt report file shown above. Include what changed, the verification commands, and their results.",
    "Create or edit files only inside the authorized write scope shown above.",
    "Do not modify scheduling state, active ids, the loopPlus snapshot, or the task record.",
    "Do not apply a classic batched parent decision, and do not write a parent status.",
    "Paths in this prompt are only the values supplied above. Do not replace them with a hardcoded machine path.",
    "Root request:",
    context.rootPrompt,
    "Subtask instructions:",
    context.subtask.prompt,
  ].join("\n");
}
