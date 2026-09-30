import type { CliName } from "./cli/types";
import { FINAL_ANSWER_TEXT_MARKER } from "./finalAnswerProtocol";
import type { ChatMessage } from "./webview/types";

export type LoopMainModelQuestionTarget = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

export type LoopMainModelAnswerResult = {
  status: "ready" | "error" | "stopped";
  answer?: string;
  error?: string;
};

export type LoopMainModelQuestionProgress = {
  before: readonly ChatMessage[];
  current: readonly ChatMessage[];
};

type LoopMainModelQuestionPromptInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  loopAsk?: boolean;
  skipLongTermMemoryPersist?: boolean;
  throwOnError?: boolean;
};

export function presentLoopMainQuestionAnswer(content: string): string {
  const index = content.lastIndexOf(FINAL_ANSWER_TEXT_MARKER);
  const body = index >= 0 ? content.slice(index + FINAL_ANSWER_TEXT_MARKER.length) : content;
  return body.trim();
}

export function extractNewAssistantAnswer(
  before: readonly ChatMessage[],
  after: readonly ChatMessage[],
): string | null {
  const beforeById = new Map(before.map((message) => [message.id, presentLoopMainQuestionAnswer(message.content)]));
  for (let index = after.length - 1; index >= 0; index -= 1) {
    const message = after[index];
    if (!message || message.role !== "assistant" || message.kind === "thinking") {
      continue;
    }
    const presented = presentLoopMainQuestionAnswer(message.content);
    if (!presented) {
      continue;
    }
    const previous = beforeById.get(message.id);
    if (previous === undefined || previous !== presented) {
      return presented;
    }
  }
  return null;
}

export async function askLoopMainModelSession(options: {
  question: string;
  modelPrompt: string;
  target: LoopMainModelQuestionTarget | null;
  isTabRunActive: (tabId: string) => boolean;
  readMessages: (target: LoopMainModelQuestionTarget) => readonly ChatMessage[];
  runPrompt: (
    input: LoopMainModelQuestionPromptInput,
    runOptions: { targetTabId: string },
  ) => Promise<void>;
  onProgress?: (progress: LoopMainModelQuestionProgress) => void;
  isAborted?: () => boolean;
  progressIntervalMs?: number;
  unavailableMessage: string;
  busyMessage: string;
  emptyMessage: string;
  failedMessage: (detail: string) => string;
}): Promise<LoopMainModelAnswerResult> {
  const question = options.question.trim();
  const target = options.target;
  if (!question || !target?.tabId) {
    return { status: "error", error: options.unavailableMessage };
  }
  if (options.isAborted?.()) {
    return { status: "stopped" };
  }
  if (options.isTabRunActive(target.tabId)) {
    return { status: "error", error: options.busyMessage };
  }
  const before = options.readMessages(target).map((message) => ({ ...message }));
  const publish = (): void => {
    if (!options.onProgress) {
      return;
    }
    try {
      options.onProgress({
        before,
        current: options.readMessages(target),
      });
    } catch {
      // Progress is observational. A render failure must not hide the final answer.
    }
  };
  const intervalMs = options.progressIntervalMs ?? 250;
  const timer = options.onProgress
    ? setInterval(publish, intervalMs)
    : undefined;
  timer?.unref?.();
  try {
    await options.runPrompt({
      displayPrompt: question,
      modelPrompt: options.modelPrompt,
      contextTags: [],
      loopAsk: true,
      skipLongTermMemoryPersist: true,
      throwOnError: true,
    }, {
      targetTabId: target.tabId,
    });
  } catch (error) {
    const recovered = extractNewAssistantAnswer(before, options.readMessages(target));
    if (recovered) {
      return { status: "ready", answer: recovered };
    }
    if (options.isAborted?.()) {
      return { status: "stopped" };
    }
    const detail = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : String(error);
    return { status: "error", error: options.failedMessage(detail) };
  } finally {
    if (timer) {
      clearInterval(timer);
    }
    publish();
  }
  const answer = extractNewAssistantAnswer(before, options.readMessages(target));
  if (answer) {
    return { status: "ready", answer };
  }
  if (options.isAborted?.()) {
    return { status: "stopped" };
  }
  return { status: "error", error: options.emptyMessage };
}
