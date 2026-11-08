import {
  LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH,
  resolveLoopPlusDecisionSubtaskMax,
  resolveLoopPlusMaxAcceptances,
} from "../loopPlusDecision";
import {
  LOOP_PLUS_MAIN_PROTOCOL_PROMPT_PREFIX,
  LOOP_PLUS_SUBTASK_PROTOCOL_PROMPT_PREFIX,
} from "../loopPlusProtocolPrompt";
import { LOOP_MAIN_STALE_TASK_LIST_RULE_EN } from "../loopMainTaskListPolicy";
import { LOOP_DIRECT_EXECUTION_RULE_EN } from "../loopDirectExecutionPolicy";
import { SUBTASK_DESIGN_KEY_POINT_RULE_EN } from "../subtaskDesignBriefPolicy";
import { buildStructuredSvgSummaryPromptInstruction } from "../finalAnswerProtocol";
import { LOOP_BLOCKED_SUMMARY_EXAMPLE, LOOP_BLOCKED_SUMMARY_INSTRUCTION } from "../loopBlockedSummary";
import type { LoopPlusExecutionRecord, LoopPlusReviewItem, LoopPlusSchedulerView } from "../loopPlusScheduler";
import type { LoopSubtaskMode } from "../loopPlusSubtaskMode";
import type { LoopSubtaskDecision } from "../loopTaskStore";
import {
  buildLoopPlusAcceptancePlanPromptLines,
  listLoopPlusAcceptancePlanFeedbackItems,
  normalizeLoopPlusAcceptancePlanSnapshot,
  type LoopPlusAcceptancePlanSnapshot,
} from "../loopPlusAcceptancePlan";

export type LoopPlusMainPromptContext = {
  taskId: string;
  rootPrompt: string;
  taskStoreFile: string;
  mainCommunicationFile: string;
  kind: "initial" | "review" | "closeout" | "continue" | "user";
  /** 任务记录中固化的验收方案快照；缺失时只使用固定基线检查项。 */
  acceptancePlan?: LoopPlusAcceptancePlanSnapshot | null;
  allowDirectCompletion?: boolean;
  view: LoopPlusSchedulerView;
  currentEventId: string | null;
  acceptanceEventIds?: readonly string[];
  interruptedSubtaskIds?: readonly string[];
  supplementalRequirements: readonly string[];
  pendingUserMessages?: readonly string[];
  maxConcurrency: number;
  subtaskMax?: number;
  acceptedCount?: number;
  acceptanceLimit?: number;
  /** 任务快照上的模式。缺省按 split 描述，避免未传模式的旧调用突然要求全栈。 */
  loopSubtaskMode?: LoopSubtaskMode;
  routingSummary?: string;
  blockedReviewSummary?: string;
};

export type LoopPlusSubtaskPromptContext = {
  subtask: LoopSubtaskDecision;
  communicationFile: string;
  executionRole?: "backend" | "frontend" | "general";
  loopSubtaskMode?: LoopSubtaskMode;
};

const LOOP_PLUS_EXAMPLE_SUBTASK_PROMPT = [
  "Implement this self-contained subtask. The suggested write scope is not a hard limit; edit other workspace files when the task requires them and record why.",
  "Design key point: keep the public function signature stable and route the new branch through the existing validator; do not add a parallel code path.",
  "Record the command and result in the attempt report.",
].join(" ");

const LOOP_PLUS_ACCEPTANCE_CHECKS: Array<{ name: string; detail: string }> = [
  {
    name: "dispatched work",
    detail: "Every task arranged for this batch is implemented.",
  },
  {
    name: "contracts",
    detail: "Interfaces, data structures, and file boundaries match the agreed contract, or none apply.",
  },
  {
    name: "tests",
    detail: "Included tests pass, or no tests apply.",
  },
  {
    name: "artifacts",
    detail: "Produced artifacts run, or no runnable artifact applies.",
  },
  {
    name: "unauthorized changes",
    detail: "Files outside the suggested write scope changed only because the task required them. Unrelated edits are absent.",
  },
  {
    name: "omissions and regressions",
    detail: "No omission, regression, or boundary error remains.",
  },
];

const LOOP_PLUS_ACCEPTANCE_REASON_EXAMPLES = [
  "需求中的新增分支均已实现，代码见任务报告",
  "导出接口与约定一致，未改变调用方参数",
  "报告中的新增及回归用例全部通过",
  "产物启动成功，启动结果见任务报告",
  "范围外改动仅为接入新接口，无无关修改",
  "空值与失败分支均有覆盖，未发现回归",
];

function formatExecution(record: LoopPlusExecutionRecord): string {
  const files = record.writeFiles.length > 0 ? record.writeFiles.join(", ") : "(none)";
  const group = record.conflictGroup ? ` group=${record.conflictGroup}` : "";
  return `- ${record.subtaskId} attempt=${record.attemptId} state=${record.state}${group} files=${files}`;
}

function formatReview(item: LoopPlusReviewItem, label: string): string {
  return `- ${label} eventId=${item.eventId} subtask=${item.subtaskId} attempt=${item.attemptId} outcome=${item.outcome} detail=${item.detail ?? ""}`;
}

function normalizePromptCount(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.floor(numeric);
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

function buildLoopPlusProtocolExamples(
  eventIds: readonly string[],
  dispatchExampleCount: number,
  acceptancePlan?: LoopPlusAcceptancePlanSnapshot | null,
): string {
  const planReasons = {
    maintainability: "复用既有模块，未引入重复实现",
    security: "输入和路径均有校验，未泄露敏感信息",
    performance: "未增加无界循环或重复请求",
    ui_aesthetics: "沿用主题样式，布局无溢出",
    other: "已逐项核对用户审查要求，无遗漏",
  };
  const planResults = listLoopPlusAcceptancePlanFeedbackItems(acceptancePlan).map((item) => ({
    key: item.key,
    passed: true,
    reason: planReasons[item.key],
  }));
  const planFeedback = planResults.length > 0 ? { acceptancePlanResults: planResults } : {};
  const subtask = {
    id: "example-subtask",
    title: "Example backend coding subtask",
    prompt: LOOP_PLUS_EXAMPLE_SUBTASK_PROMPT,
    taskType: "backend",
    conflictGroup: "example-backend-scope",
    writeFiles: ["src/example-backend.ts"],
  };
  const parallelFrontendSubtask = {
    id: "example-frontend-subtask",
    title: "Example independent frontend coding subtask",
    prompt: [
      "Implement this self-contained frontend subtask. The suggested write scope is not a hard limit; edit other workspace files when the task requires them and record why.",
      "Design key point: keep the public UI contract stable and reuse the existing component boundary; do not modify the backend example scope.",
      "Record the command and result in the attempt report.",
    ].join(" "),
    taskType: "frontend",
    conflictGroup: "example-frontend-scope",
    writeFiles: ["src/example-frontend.ts"],
  };
  const parallelSupportSubtasks = [
    {
      id: "example-config-subtask",
      title: "Example independent configuration subtask",
      prompt: [
        "Implement the independent configuration validator against the agreed existing schema. Suggested write scope: src/example-config.ts and src/test/example-config.test.ts; no backend or frontend changes are needed.",
        "Design key point: reuse the existing schema and keep the public configuration contract stable. Record verification commands and results in the attempt report.",
      ].join(" "),
      taskType: "backend",
      conflictGroup: "example-config-scope",
      writeFiles: ["src/example-config.ts", "src/test/example-config.test.ts"],
    },
    {
      id: "example-docs-subtask",
      title: "Example independent documentation subtask",
      prompt: [
        "Document the already agreed user workflow. Suggested write scope: docs/example-usage.md. Use the existing contract and requirements, so this task does not wait for implementation changes.",
        "Design key point: keep examples consistent with the agreed contract and do not edit implementation files. Record documentation checks and results in the attempt report.",
      ].join(" "),
      taskType: "backend",
      conflictGroup: "example-docs-scope",
      writeFiles: ["docs/example-usage.md"],
    },
  ];
  const completed: Record<string, unknown> = {
    status: "completed",
    answerConclusion: "The main decision and any required work meet the original request.",
    finalSummary: "Every required check passed and no execution remains.",
    acceptance: {
      passed: true,
      summary: "All acceptance checks passed.",
      checks: LOOP_PLUS_ACCEPTANCE_CHECKS.map((check, index) => ({
        name: check.name,
        passed: true,
        detail: LOOP_PLUS_ACCEPTANCE_REASON_EXAMPLES[index],
      })),
    },
    requirementCoverage: [
      {
        name: "root request",
        passed: true,
        detail: "Each original requirement is covered with passing evidence.",
      },
    ],
    ...planFeedback,
  };
  if (eventIds.length === 1) {
    completed.reviewEventId = eventIds[0];
  } else if (eventIds.length > 1) {
    completed.reviewEventIds = eventIds.slice();
  }
  const acceptEventIds = eventIds.length > 0 ? eventIds.slice() : ["example-review-event-id"];
  const acceptConfirmation = eventIds.length > 1
    ? { reviewEventIds: acceptEventIds }
    : { reviewEventId: acceptEventIds[0] };
  const repairExample = eventIds.length > 1;
  const acceptReviews = acceptEventIds.map((reviewEventId, index) => {
    const launchesRepair = repairExample && index === acceptEventIds.length - 1;
    return {
      reviewEventId,
      acceptance: launchesRepair ? "failed" : "passed",
      reason: launchesRepair ? "用例失败，需先修复断言" : "实现符合需求且验证证据通过",
      ...(launchesRepair ? { subtaskIds: [subtask.id] } : {}),
    };
  });
  const reprompt = [
    "Continue this self-contained subtask. The suggested write scope is not a hard limit; edit other workspace files when the task requires them and record why.",
    "Design key point: keep the public function signature stable and replace the failed branch with the corrected check.",
    "Record the command and result in the attempt report.",
  ].join(" ");
  const examples: Array<{ status: string; value: Record<string, unknown> }> = [
    {
      status: "dispatch",
      value: {
        status: "dispatch",
        subtasks: [subtask, parallelFrontendSubtask, ...parallelSupportSubtasks].slice(0, dispatchExampleCount),
      },
    },
    {
      status: "accept",
      value: {
        status: "accept",
        ...acceptConfirmation,
        reviews: acceptReviews,
        acceptance: {
          passed: !repairExample,
          checks: LOOP_PLUS_ACCEPTANCE_CHECKS.map((check, index) => ({
            name: check.name,
            passed: !(repairExample && check.name === "tests"),
            detail: repairExample && check.name === "tests"
              ? "当前批次有用例失败，已派发修复任务"
              : LOOP_PLUS_ACCEPTANCE_REASON_EXAMPLES[index],
          })),
        },
        ...planFeedback,
        subtasks: repairExample ? [subtask] : [],
      },
    },
    {
      status: "wait",
      value: {
        status: "wait",
      },
    },
    {
      status: "steer",
      value: {
        status: "steer",
        controls: [
          { id: "example-running-subtask", action: "close" },
          { id: "example-other-subtask", action: "reprompt", prompt: reprompt },
        ].slice(0, dispatchExampleCount),
      },
    },
    {
      status: "blocked",
      value: {
        status: "blocked",
        finalSummary: LOOP_BLOCKED_SUMMARY_EXAMPLE,
      },
    },
    {
      status: "clarify",
      value: {
        status: "clarify",
        finalSummary: "The root request is ambiguous, so the user must choose the scope before dispatch.",
        clarification: {
          title: "Confirm the scope",
          instruction: "This choice changes the plan. Submit the form and the main task will continue.",
          submitLabel: "Submit",
          cancelLabel: "Reject",
          formFields: [{
            id: "scope",
            label: "Scope",
            type: "radio",
            required: true,
            options: [
              { label: "API only", value: "api" },
              { label: "API and callers", value: "api-and-callers" },
            ],
          }],
        },
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
  const parallelCapacity = Math.min(subtaskMax, context.maxConcurrency);
  const availableSlots = Math.max(0, context.maxConcurrency - context.view.running.length);
  const acceptedCount = normalizePromptCount(context.acceptedCount);
  const acceptanceLimit = resolveLoopPlusMaxAcceptances(context.acceptanceLimit);
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
  // 只追加用户勾选的审查项与有效的“其它”内容；固定基线检查项始终保留在上面的规则里。
  const acceptancePlanLines = context.acceptancePlan
    ? buildLoopPlusAcceptancePlanPromptLines(normalizeLoopPlusAcceptancePlanSnapshot(context.acceptancePlan))
    : [];
  return [
    `${LOOP_PLUS_MAIN_PROTOCOL_PROMPT_PREFIX} Loop+ has no batch barrier and no shared round gate.`,
    "Execution finishing is not review completion. The host owns scheduling state.",
    "Before deciding, read these sources, in order: the current attempt report, the main communication file, and the latest task record.",
    "Compare those sources with the code and the verification evidence. Judge every event in the acceptance batch against the acceptance checklist before accept or completed. Do not implement or repair that dispatched work yourself, and do not treat the subtask claim as proof.",
    "You may run included tests and start a produced runnable application or artifact. Both are allowed. Neither is required, and skipping either one is not a failure by itself.",
    "Do not edit scheduling state, active ids, the loopPlus snapshot, or the task record.",
    `Parent task: ${context.taskId}`,
    `Prompt kind: ${context.kind}`,
    ...(context.blockedReviewSummary !== undefined ? [
      "Bounded blocked review: this is the one remaining-work check before a global pause, not permission to retry a failed execution.",
      `Previous proposed blockage: ${context.blockedReviewSummary || "(no reason supplied)"}`,
      "Re-read every unfinished root and supplemental requirement. Separate safe independent work, work awaiting a live attempt, and work requiring external input. Dispatch independent work; wait for live dependencies only when no acceptance batch is open; preserve and judge the entire acceptance batch otherwise. A blocked path does not block unrelated deliverables.",
      "Only return blocked if no safe independent work remains. Its non-empty finalSummary must name unfinished requirements and evidence-backed blockers, then explain either who must provide what and the condition/action for continuing, or why the current requirements cannot be met and which alternatives remain. Do not remove safety gates, invent evidence, or dispatch placeholder work.",
    ] : []),
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
    `Scheduler concurrency limit: ${context.maxConcurrency}`,
    `Available concurrency slots in this snapshot: ${availableSlots}`,
    `Decision subtask limit: ${subtaskMax}`,
    "Still running (open reservations, including interrupted subtasks):",
    running,
    `Interrupted subtasks awaiting continuation: ${context.interruptedSubtaskIds?.join(", ") || "(none)"}`,
    "An interrupted subtask stays open until its continuation reports a result. Wait for its notification before reviewing that subtask. Other events in the acceptance batch can be reviewed independently.",
    `Still pending count: ${context.view.pending.length}`,
    "Still pending launch:",
    pending,
    `Confirmed acceptances: ${acceptedCount}`,
    `Acceptance limit: ${acceptanceLimit}`,
    `Snapshot phase: ${context.view.phase}`,
    `Snapshot completion blockers: ${blockers}`,
    `Snapshot says completion is allowed: ${context.view.canComplete ? "yes" : "no"}`,
    "Supplemental requirements:",
    requirements,
    "New user messages, oldest first. Read every message in this list together and make one decision:",
    pendingUserText,
    "Root request:",
    context.rootPrompt,
    "This prompt is a snapshot captured when the CLI started. The acceptance batch already includes every finished event waiting in the FIFO review queue; confirm that whole batch together. If another execution finishes before this decision is applied, and the larger batch still fits the acceptance limit, the host discards this answer and asks again with every queued event. User messages that arrive after this snapshot wait for the next decision. Read the latest task record before choosing a status. The host re-reads that record and is the final gate; your JSON does not mutate scheduling state.",
    "Rules:",
    "- " + LOOP_MAIN_STALE_TASK_LIST_RULE_EN,
    "- " + LOOP_DIRECT_EXECUTION_RULE_EN,
    `Direct completion available: ${context.allowDirectCompletion === true ? "yes" : "no"}`,
    "- Eligible independent trivial work may be executed directly in every decision, even when Direct completion available is no. That flag controls only the simplified final response, not permission to handle trivial supplemental work. Preserve the existing dispatch, wait, and accept rules for other work.",
    "- Only when Direct completion available is yes, the trivial-work rule is satisfied, and all original and supplemental requirements are finished, return {\"status\":\"completed\",\"directCompletion\":true,\"answerConclusion\":\"实际结果\",\"finalSummary\":\"实际操作与结果\"}. Omit subtasks, review ids, reviews, acceptance, requirementCoverage, and acceptancePlanResults. No extra independent acceptance or fabricated evidence is needed. Earlier reviewed work does not prohibit this path. Never use it to skip unreviewed events, failed or unfinished requirements, or user/project verification requirements. Otherwise use the normal completion protocol below.",
    "- dispatch starts 1 to " + subtaskMax + " new self-contained subtasks and confirms nothing. Do not send dispatch while the acceptance batch is open. Do not include reviewEventId or reviewEventIds.",
    "- Keep planning, decomposition, repository reasoning, and ordinary read-only thinking in this main decision by default. Do not dispatch general for a small or medium question, a single analysis track, ordinary inspection, making a plan, or explaining work. If the request is answer-only/read-only and needs no separate evidence report or parallel analysis, return completed directly with no subtasks.",
    "- Dispatch general subtasks only when the thinking workload is large enough to split into at least two independent analysis tracks, each needing substantial investigation, and parallel execution has a clear material benefit in wall-clock time or coverage. If so, dispatch at least two general subtasks together with distinct evidence scopes; general is read-only and never carries coding delivery.",
    "- For non-trivial coding or write-oriented work, including implementation, tests, docs, config, and scripts, prefer one dispatch containing multiple independent coding subtasks with separate deliverables, primary write ownership, and verification. Decompose by delivery boundary, not by model role: multiple backend, frontend, or fullstack subtasks can run together. Two roles do not mean a two-task limit.",
    parallelCapacity >= 3
      ? `- When at least three useful independent delivery boundaries are ready, aim for 3 to ${parallelCapacity} concurrent subtasks, bounded by available slots and the decision subtask limit. Do not default to only one or two. Use fewer when there are fewer useful boundaries, real prerequisite dependencies, or insufficient free slots; never create tiny or artificial tasks just to fill capacity.`
      : `- Use up to ${parallelCapacity} useful independent subtasks within the configured limits and available slots. Never create tiny or artificial tasks just to fill capacity.`,
    "- On dispatch and accept, look for ready independent work to refill free slots instead of waiting for all siblings. Review the whole open acceptance batch first and attach follow-up work to accept. Do not duplicate running or pending tasks; pending work already owns its place in the queue and may consume released slots.",
    "- Give each subtask concrete, narrow writeFiles and use conflictGroup only for a real shared mutable resource, not for a whole feature or model role. Shared read-only context is not a write conflict. Declare every known shared write path honestly; do not hide overlaps or drop conflictGroup to bypass scheduler protection. Known overlapping writeFiles or conflictGroup remain serialized by the host.",
    "- Shared contracts, central registration, and tightly coupled edits need one owner or a small prerequisite task; serialize only that part and continue unrelated deliverables. Separate tests or docs can run early against an agreed stable contract, but not when they genuinely depend on unfinished changes. Keep one coding subtask only when useful independent boundaries cannot be isolated.",
    "- Rare small incidental cross-scope edits are acceptable when necessary and locally reconcilable; their mere possibility must not collapse otherwise independent work into one task. Assign primary ownership and tell subtasks to re-read before writing, preserve concurrent changes, reconcile small disjoint edits, and report affected paths. Do not deliberately schedule competing edits to the same symbols or contract; substantial contention needs replanning.",
    ...loopPlusModeRuleLines(context),
    "- writeFiles is a concurrency hint, not a hard allowlist. Do not tell the subtask it may edit only those files. A shorter prompt is rejected.",
    "- " + SUBTASK_DESIGN_KEY_POINT_RULE_EN,
    "- accept confirms the whole acceptance batch and may append 0 to " + subtaskMax + " new subtasks. Do not send accept when the acceptance batch is (none).",
    "- accept.reviews is required: one object per confirmed event, in the same order. Each object has reviewEventId, acceptance (exactly passed or failed), and a short reason no longer than 50 characters explaining the evidence-backed result. A missing, extra, reordered review, or missing reason rejects the decision.",
    "- accept.acceptance is required and must report the default checks dispatched work, contracts, tests, artifacts, unauthorized changes, and omissions and regressions. Each check has passed and a concise evidence-backed detail no longer than 50 characters; failed checks are allowed while repair work is launched.",
    "- Every accept.reviews reason must briefly summarize the evidence-backed result of the default acceptance checklist for that event, no more than 50 characters. Do not reuse generic filler; name the decisive evidence or failed criterion.",
    "- Write each acceptance reason and check detail in the language that best matches the task, evidence, and surrounding conversation; Chinese is not mandatory. Keep each within 50 characters, state the decisive evidence, failure, or not-applicable reason, and never invent evidence or use a bare passed/failed claim.",
    "- acceptance passed records that event as successful. acceptance failed records that event as failed. Do not mark a successful event failed because another event fails or launches a subtask.",
    "- When an event launches new subtasks, list those ids in that review's subtaskIds. Every subtask id must appear in exactly one subtaskIds array. A passed event may launch follow-up work and stays passed. A failed event that can be repaired lists its repair ids and names the failed check in that subtask prompt.",
    "- Acceptance checklist, applied to every event in the batch: dispatched work is actually implemented; any interface, data structure, or file boundary matches the agreed contract; included tests pass; produced runnable artifacts run; files outside the suggested write scope changed only because the task required them, with no unrelated edits; no omission, regression, or boundary error remains. The host confirms the event ids and does not grade this checklist.",
    "- A checklist item that does not apply still has to be judged. Say not applicable. Do not mark a required test or artifact run as passed without evidence in the attempt report, the code, or a test or startup you chose to run. You are not required to run either one.",
    ...acceptancePlanLines,
    "- Do not send completed while any event fails its checklist. Accept the batch instead: mark the failed events failed, mark the successful events passed, and launch a repair only from the failed event. If a failed event cannot be repaired by a subtask, send blocked, which confirms nothing.",
    "- Decide whether each next subtask continues an earlier subtask. Set continueFromSubtaskId to that earlier subtask id for follow-up work; omit it for independent work. Wait for that source to finish; use controls.reprompt to redirect work that is still running. The host restores only a session recorded under this parent with the same CLI and configuration. Do not run two tasks concurrently on one source session.",
    "- Repairs linked by failed reviews[*].subtaskIds automatically inherit the failed event's subtask session. Prefer that original session for acceptance-failure fixes, not a fresh context. A new attempt or conversation tab does not imply a new CLI session. Missing sessions or incompatible CLI/configuration are recorded and fall back to a fresh session.",
    "- An attempt whose outcome is failed or stopped is an acceptance failure. Mark that review failed and explain why in no more than 50 characters. The host also records it failed.",
    "- completed.acceptance.checks must include one passed check for each name: dispatched work, contracts, tests, artifacts, unauthorized changes, omissions and regressions. Every check detail is a concise evidence-backed reason of no more than 50 characters.",
    "- When the acceptance batch has one event, copy it into reviewEventId and do not send reviewEventIds.",
    "- When the acceptance batch has more than one event, copy every id in order into reviewEventIds and do not send reviewEventId. A missing, extra, or reordered id is rejected.",
    acceptExampleRule,
    "- wait confirms nothing. Do not include reviewEventId, reviewEventIds, subtasks, or controls. Use wait only when the acceptance batch is (none) and at least one execution is still running or pending.",
    "- steer interrupts open subtasks and confirms nothing. Do not send steer while the acceptance batch is open. Do not include reviewEventId, reviewEventIds, or subtasks. controls must name running or pending subtask ids.",
    "- controls actions are close or reprompt. close aborts that subtask, closes its conversation tab, and drops it without an acceptance event or acceptance count. reprompt aborts it, closes that attempt's conversation tab, and starts one new attempt whose prompt is at least " + LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH + " characters. The host performs the interrupt and closes the tab; JSON alone does not stop a process.",
    "- dispatch and accept may include controls for other open subtasks. Do not control an id that is also in subtasks. Do not put controls on wait, blocked, or completed. A control for a subtask that is not running or pending is rejected.",
    "- When New user messages is not (none) and the acceptance batch is (none), judge the whole list together and directly handle eligible independent trivial work first. dispatch if remaining non-trivial work can start now. wait when other work is still running or pending, including after finishing a trivial supplemental request; complete when all requirements are done. Do not dispatch a placeholder just to wait, and do not use wait when Still running and Still pending are both empty.",
    "- When New user messages is not (none) and the acceptance batch is open, read those messages in the same decision and directly handle eligible independent trivial work. Put remaining non-trivial work that can start now on accept, and list its subtask ids on the review that needs the work. Passed reviews stay passed. If the new work must wait for a still-running or pending execution, accept the batch with no new subtasks. Do not use wait or dispatch while the batch is open.",
    "- Before blocked, check every unfinished root and supplemental requirement for safe independent work. A blocked execution path is not a global blocker. Dispatch useful independent work, or wait for live work when the acceptance batch is empty. Never repeat unchanged diagnostics or invent tasks just to stay busy.",
    "- blocked reports an external blocker or an evidence-backed impossibility under the current requirements and confirms nothing. Use it only when no safe independent work remains. Do not include reviewEventId, reviewEventIds, or subtasks. Supply a non-empty finalSummary explaining unfinished requirements and concrete blockers, with either actionable recovery prerequisites and responsible parties or why the task cannot be completed and what alternatives remain. The host performs one bounded remaining-work review before pausing.",
    LOOP_BLOCKED_SUMMARY_INSTRUCTION,
    "- clarify asks the user to fill a form in the group chat and confirms nothing. Use it when the root request is ambiguous or the plan would be materially incomplete without a user decision. Do not guess, and do not include reviewEventId, reviewEventIds, subtasks, or controls. clarification.formFields must contain 1 to 8 fields. The host pauses until the user submits or rejects.",
    "- Except for the explicitly permitted directCompletion path above, completed requires non-empty answerConclusion and finalSummary, acceptance.passed true, a non-empty acceptance.checks array in which every passed value is true, and a non-empty requirementCoverage array in which every passed value is true. Do not include subtasks or reviews. Use accept when any event failed.",
    buildStructuredSvgSummaryPromptInstruction("finalSummary"),
    "- When the acceptance batch has one event, completed must include that reviewEventId. When it has more than one, completed must include reviewEventIds in that order and must not include reviewEventId. When the acceptance batch is (none), omit both. A completed object missing any required field, or containing a failed check, is rejected.",
    "- Do not send confirmedEventIds or acceptedEventIds. Do not send reviewEventIds together with reviewEventId. Any of those forms rejects the whole decision.",
    "- Do not reuse the classic Loop status continue, and do not use roundSummaries as a required field or completion gate.",
    "- estimatedRemainingRounds is optional compatibility only, an integer from 0 through 100. It is not required and is not a round gate.",
    "- Confirmed acceptances count each reviewed attempt. Do not dispatch more subtasks when that count has reached the acceptance limit. The host rejects a whole review batch that would pass the limit and leaves that queue unchanged.",
    "Valid protocol examples follow. Return exactly one JSON object and do not repeat these examples.",
    "Protocol examples illustrate JSON shape, not a fixed task count or a role quota. Size real work using the rules and live capacity above.",
    buildLoopPlusProtocolExamples(batchIds, Math.min(4, parallelCapacity), context.acceptancePlan),
  ].join("\n");
}

function loopPlusModeRuleLines(context: LoopPlusMainPromptContext): string[] {
  const mode = context.loopSubtaskMode === "fullstack" ? "fullstack" : "split";
  const summary = context.routingSummary
    ? ["- Active route snapshot: " + context.routingSummary]
    : [];
  const shared = [
    "- Each subtask needs a title, a unique id, taskType, and a prompt of at least " + LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH + " characters that states its own goal, suggested write scope, and verification. taskType is exactly backend, frontend, or general. backend and frontend are coding tasks. general is read-only analysis and must not include writeFiles or codingDelivery. A missing or unknown taskType, a wrong data type, or general combined with writeFiles or codingDelivery is rejected.",
    "- Do not classify by title keywords or file extensions. The main model performs ordinary planning and non-deliverable analysis itself, then orchestrates and reviews; except for eligible trivial direct execution, it must not implement coding. Follow the large parallel-analysis rule before using general, and prefer independent coding or writing subtasks when their scopes do not conflict. A failed or missing sub-model configuration fails the attempt; never switch to main-model coding to recover it. The user may set a sub-role to the same model name as the main role; the constraint is the selected role configuration and duty.",
  ];
  if (mode === "fullstack") {
    return [
      "- Loop+ subtask mode: fullstack. Every delegated coding task uses the fullstack sub-model. Do not split coding into frontend and backend only to choose different models. One fullstack model is not a one-task limit: split useful independent delivery boundaries and dispatch them together under the parallel-capacity and ownership rules above.",
      ...shared,
      "- taskType backend, frontend, and any coding without a more specific type all execute on the fullstack sub-model. general stays read-only analysis on the main model configuration in both modes.",
      ...summary,
    ];
  }
  return [
    "- Loop+ subtask mode: split. Frontend coding uses the frontend sub-model. Backend coding and any other coding use the backend sub-model. general stays read-only analysis on the main model configuration.",
    ...shared,
    "- Keep ordinary analysis in the main decision and follow the large parallel-analysis rule for general. Split useful independent delivery boundaries under the parallel-capacity and ownership rules above; the frontend/backend routing does not limit the number of subtasks. Coding that cannot be split uses frontend for UI implementation and backend for every other code change.",
    ...summary,
  ];
}

export function buildLoopPlusSubtaskModelPrompt(context: LoopPlusSubtaskPromptContext): string {
  const files = context.subtask.writeFiles && context.subtask.writeFiles.length > 0
    ? context.subtask.writeFiles.join(", ")
    : "(not declared; edit the workspace files this attempt requires)";
  const role = context.executionRole
    ?? (context.subtask.taskType === "frontend" || context.subtask.taskType === "general"
      ? context.subtask.taskType
      : "backend");
  const fullstackCoding = context.loopSubtaskMode === "fullstack" && role !== "general";
  const roleLine = role === "general"
    ? "Execution role: general. Deliver findings, evidence, and recommendations only. Do not modify implementation, tests, scripts, or other code. If a fix is required, say so and stop; the main model will dispatch a coding task."
    : fullstackCoding
      ? "Execution role: coding under fullstack mode. Implement with the fullstack sub-model configuration. Backend, frontend, and other coding share this sub-model. Do not switch to the main model."
      : role === "frontend"
        ? "Execution role: frontend. Implement the requested UI or client code with the frontend sub-model configuration. Do not switch to another role."
        : "Execution role: backend. Implement the requested code with the backend sub-model configuration. Do not switch to another role.";
  return [
    `${LOOP_PLUS_SUBTASK_PROTOCOL_PROMPT_PREFIX} Complete only this attempt and write its report.`,
    `Attempt report file: ${context.communicationFile}`,
    roleLine,
    `Suggested write scope: ${role === "general" ? "(read only)" : files}`,
    role === "general"
      ? "This attempt is analysis only. A prompt instruction is not a sandbox; still do not edit files."
      : "The suggested write scope is a hint, not a hard limit. Edit other workspace files when completing this attempt requires them, and record those paths in the attempt report.",
    ...(role === "general" ? [] : [
      "Other subtasks may edit this workspace concurrently. Re-read the latest file before writing, preserve changes owned by others, and do not revert or overwrite their work. Reconcile small disjoint edits locally instead of stopping merely because another task changed the file.",
      "Keep necessary incidental cross-scope edits minimal and report their paths, reasons, and reconciliation in this attempt report. If the same symbols or shared contract need competing changes, report the dependency to the main model rather than forcing a broad rewrite.",
    ]),
    "Do not modify scheduling state, active ids, the loopPlus snapshot, the task record, or another attempt report.",
    "Before finishing, record what changed, the verification commands, and their results in the attempt report file.",
    role === "frontend"
      ? "If the subtask instructions include a UI design, implement that design. Do not redesign layout, color, or interaction."
      : "If the subtask instructions include a UI design, implement that design only when this attempt is the frontend coding task. Do not redesign layout, color, or interaction.",
    "",
    "Subtask instructions:",
    context.subtask.prompt,
  ].join("\n");
}
