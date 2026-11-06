import { isLoopMainAiFailureLimitReached } from "./loopMainFailure";
import { resolveLoopSchedulingMode, type LoopTaskRecord } from "./loopTaskStore";
import type { ChatMessage } from "./webview/types";

const LOOP_RESUME_PROMPT_MAX_LENGTH = 48;
const LOOP_RESUME_PROMPT_PATTERNS: RegExp[] = [
  /^继续(?:执行|进行|下去|一下|一下子|任务|主任务|这个任务|当前任务|上一轮|上轮|吧)?$/u,
  /^接着(?:执行|做|继续|下去|往下)?$/u,
  /^续上$/u,
  /^continue(?:\s+(?:please|task|run|loop|main|main\s+task))?$/i,
  /^resume(?:\s+(?:please|task|run|loop|main|main\s+task))?$/i,
  /^go\s*on$/i,
  /^carry\s*on$/i,
  /^keep\s*going$/i,
  /^proceed$/i,
];

export type LoopVerificationState = "yes" | "no" | "unknown";

export type LoopVerificationSignals = {
  unitTest: LoopVerificationState;
  build: LoopVerificationState;
  unitTestEvidence?: string;
  buildEvidence?: string;
};

export type LoopTaskCompletionMessagesState = {
  hasAnswerConclusion: boolean;
  hasFinalSummary: boolean;
};

export function normalizeLoopResumePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .replace(/[，,。.!！?？;；:：~～]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLoopResumePrompt(prompt: string): boolean {
  const normalized = normalizeLoopResumePrompt(prompt);
  if (!normalized || normalized.length > LOOP_RESUME_PROMPT_MAX_LENGTH) {
    return false;
  }
  return LOOP_RESUME_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function collectRecentLoopTaskIdsFromMessages(messages: readonly ChatMessage[], limit = 12): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const taskId = typeof messages[index]?.loopTaskId === "string"
      ? messages[index]?.loopTaskId?.trim()
      : "";
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    ids.push(taskId);
    if (ids.length >= limit) {
      break;
    }
  }
  return ids;
}

export function isLoopTaskResumable(
  task: Pick<LoopTaskRecord, "status" | "mainAiFailureLimitReached">,
): boolean {
  return !isLoopMainAiFailureLimitReached(task)
    && (
      task.status === "needs-review"
      || task.status === "error"
      || task.status === "stopped"
      || task.status === "running"
    );
}

export function isLoopTaskPromptResumeCandidate(
  task: Pick<LoopTaskRecord, "status" | "schedulingMode" | "mainAiFailureLimitReached">,
  options: { hasCompleteCompletionMessages: boolean },
): boolean {
  if (isLoopTaskResumable(task)) {
    return true;
  }
  return task.status === "completed"
    && resolveLoopSchedulingMode(task.schedulingMode) !== "event_driven"
    && !options.hasCompleteCompletionMessages;
}

export function isLoopTaskSessionCompatible(
  task: LoopTaskRecord,
  targetSessionId: string | null,
  options: { allowMissingTaskSessionId?: boolean } = {}
): boolean {
  if (!targetSessionId) {
    return !task.sessionId;
  }
  if (task.sessionId === targetSessionId) {
    return true;
  }
  return options.allowMissingTaskSessionId === true && !task.sessionId;
}

export function formatLoopVerificationState(state: LoopVerificationState): string {
  if (state === "yes") {
    return "已完成";
  }
  if (state === "no") {
    return "未完成";
  }
  return "未明确";
}

export function detectLoopVerificationSignals(content: string): LoopVerificationSignals {
  const unitTest = detectLoopVerificationState(content, "unitTest");
  const build = detectLoopVerificationState(content, "build");
  return {
    unitTest: unitTest.state,
    build: build.state,
    unitTestEvidence: unitTest.evidence,
    buildEvidence: build.evidence,
  };
}

function detectLoopVerificationState(
  content: string,
  kind: "unitTest" | "build"
): { state: LoopVerificationState; evidence?: string } {
  const normalized = String(content || "").trim();
  if (!normalized) {
    return { state: "unknown" };
  }

  const lineCandidates = normalized
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const negativePatterns = kind === "unitTest"
    ? [
        /(?:未|没有|暂未|未能)\S{0,10}(?:单测|单元测试|测试)/i,
        /(?:单测|单元测试|测试)\S{0,10}(?:未执行|未跑|未做|失败|fail)/i,
        /\b(skip|skipped)\b.{0,16}\btest/i,
      ]
    : [
        /(?:未|没有|暂未|未能)\S{0,10}(?:编译|构建|build)/i,
        /(?:编译|构建|build)\S{0,10}(?:未执行|失败|fail)/i,
      ];
  const positivePatterns = kind === "unitTest"
    ? [
        /(?:已|完成|执行|运行|跑)\S{0,10}(?:单测|单元测试)/i,
        /(?:单测|单元测试)\S{0,12}(?:通过|成功|pass|passed|ok)/i,
        /\b(?:npm|pnpm|yarn)\s+test\b/i,
        /\b(?:jest|vitest|mocha|pytest|go test)\b/i,
      ]
    : [
        /(?:已|完成|执行|运行|跑)\S{0,10}(?:编译|构建|build)/i,
        /(?:编译|构建|build)\S{0,12}(?:通过|成功|pass|passed|ok)/i,
        /\b(?:npm|pnpm|yarn)\s+run\s+build\b/i,
        /\btsc\b/i,
      ];

  const negativeEvidence = findFirstEvidenceLine(lineCandidates, negativePatterns);
  if (negativeEvidence) {
    return { state: "no", evidence: negativeEvidence };
  }
  const positiveEvidence = findFirstEvidenceLine(lineCandidates, positivePatterns);
  if (positiveEvidence) {
    return { state: "yes", evidence: positiveEvidence };
  }
  return { state: "unknown" };
}

function findFirstEvidenceLine(lines: string[], patterns: RegExp[]): string | undefined {
  for (const line of lines) {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        return line.length > 180 ? `${line.slice(0, 180)}...` : line;
      }
    }
  }
  return undefined;
}

export function getLoopCompletionMessagesState(
  messages: readonly ChatMessage[],
  taskId: string,
): LoopTaskCompletionMessagesState {
  return messages.reduce<LoopTaskCompletionMessagesState>((state, message) => {
    if (isLoopAnswerConclusionMessageForTask(message, taskId)) {
      state.hasAnswerConclusion = true;
    }
    if (isLoopFinalSummaryMessageForTask(message, taskId) && isCompleteLoopFinalSummaryContent(message.content)) {
      state.hasFinalSummary = true;
    }
    return state;
  }, { hasAnswerConclusion: false, hasFinalSummary: false });
}

export function hasCompleteLoopCompletionMessages(messages: readonly ChatMessage[], taskId: string): boolean {
  const state = getLoopCompletionMessagesState(messages, taskId);
  return state.hasAnswerConclusion && state.hasFinalSummary;
}

export function isLoopAnswerConclusionMessageForTask(message: ChatMessage, taskId: string): boolean {
  return message.role === "assistant"
    && message.taskRole === "main"
    && message.loopTaskId === taskId
    && message.loopAnswerConclusion === true
    && typeof message.content === "string"
    && message.content.trim().length > 0;
}

export function isLoopFinalSummaryMessageForTask(message: ChatMessage, taskId: string): boolean {
  return message.role === "assistant"
    && message.taskRole === "main"
    && message.loopTaskId === taskId
    && message.loopFinalSummary === true
    && typeof message.content === "string"
    && message.content.trim().length > 0;
}

export function isCompleteLoopFinalSummaryContent(content: string): boolean {
  return /(?:^|\n)##\s+问题回答结论(?:\n|$)/u.test(content)
    && /(?:^|\n)##\s+整体任务总结(?:\n|$)/u.test(content);
}
