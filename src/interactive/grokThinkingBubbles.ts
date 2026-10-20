import { containsFinalAnswerTextMarker } from "../finalAnswerProtocol";

export type GrokThinkingBubbleMessage = {
  id: string;
  role: string;
  kind?: string;
  content?: string;
  merge?: boolean;
  codexFinalAnswer?: boolean;
  loopAnswerConclusion?: boolean;
  loopFinalSummary?: boolean;
  graphFinalSummary?: boolean;
  subagentId?: string;
  actions?: readonly unknown[];
};

export type GrokThinkingContinuation = {
  thinkingMessageId: string;
  removedIds: string[];
  appendedContent: string;
  separateNextChunk: boolean;
};

function isGrokThinkingRunMember(message: GrokThinkingBubbleMessage | undefined): boolean {
  if (!message || message.role !== "assistant" || message.subagentId) {
    return false;
  }
  if (message.merge === false) {
    return false;
  }
  if (
    message.codexFinalAnswer === true
    || message.loopAnswerConclusion === true
    || message.loopFinalSummary === true
    || message.graphFinalSummary === true
  ) {
    return false;
  }
  if (Array.isArray(message.actions) && message.actions.length > 0) {
    return false;
  }
  return !containsFinalAnswerTextMarker(message.content);
}

function readBubbleText(message: GrokThinkingBubbleMessage): string {
  return typeof message.content === "string" ? message.content.trim() : "";
}

function joinThinkingParts(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join("\n\n");
}

function foldThinkingRun<T extends GrokThinkingBubbleMessage>(
  run: readonly T[],
): { messages: T[]; changed: boolean } {
  const thinkingIndexes = run.reduce<number[]>((indexes, message, index) => {
    if (message.kind === "thinking") {
      indexes.push(index);
    }
    return indexes;
  }, []);
  if (thinkingIndexes.length < 2) {
    return { messages: run.slice(), changed: false };
  }
  const first = thinkingIndexes[0];
  const last = thinkingIndexes[thinkingIndexes.length - 1];
  const anchor = run[first];
  const content = joinThinkingParts([
    readBubbleText(anchor),
    ...run.slice(first + 1, last + 1).map((message) => readBubbleText(message)),
  ]);
  const nextAnchor = content === anchor.content
    ? anchor
    : { ...anchor, content, kind: "thinking" as const };
  return {
    messages: [...run.slice(0, first), nextAnchor, ...run.slice(last + 1)],
    changed: true,
  };
}

export function collapseGrokConsecutiveThinkingMessages<T extends GrokThinkingBubbleMessage>(
  messages: readonly T[],
): { messages: T[]; changed: boolean } {
  if (messages.length < 2) {
    return { messages: messages.slice(), changed: false };
  }
  const collapsed: T[] = [];
  let changed = false;
  let index = 0;
  while (index < messages.length) {
    const current = messages[index];
    if (!isGrokThinkingRunMember(current)) {
      collapsed.push(current);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < messages.length && isGrokThinkingRunMember(messages[end])) {
      end += 1;
    }
    const folded = foldThinkingRun(messages.slice(index, end));
    changed = changed || folded.changed;
    collapsed.push(...folded.messages);
    index = end;
  }
  return { messages: changed ? collapsed : messages.slice(), changed };
}

export function prepareGrokThinkingContinuation<T extends GrokThinkingBubbleMessage>(
  messages: T[],
): GrokThinkingContinuation | null {
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!isGrokThinkingRunMember(messages[index])) {
      break;
    }
    start = index;
  }
  if (start >= messages.length) {
    return null;
  }
  let anchorIndex = -1;
  for (let index = start; index < messages.length; index += 1) {
    if (messages[index]?.kind === "thinking") {
      anchorIndex = index;
      break;
    }
  }
  if (anchorIndex < 0) {
    return null;
  }
  const anchor = messages[anchorIndex];
  const removedIds: string[] = [];
  const parts: string[] = [];
  for (let index = anchorIndex + 1; index < messages.length; index += 1) {
    const text = readBubbleText(messages[index]);
    if (text) {
      parts.push(text);
    }
    removedIds.push(messages[index].id);
  }
  const appendedContent = parts.length
    ? `${readBubbleText(anchor) ? "\n\n" : ""}${parts.join("\n\n")}`
    : "";
  if (appendedContent) {
    const current = typeof anchor.content === "string" ? anchor.content.replace(/\s+$/g, "") : "";
    anchor.content = current ? `${current}${appendedContent}` : appendedContent.replace(/^\n+/, "");
    anchor.kind = "thinking";
  }
  if (removedIds.length > 0) {
    messages.splice(anchorIndex + 1, removedIds.length);
  }
  return {
    thinkingMessageId: anchor.id,
    removedIds,
    appendedContent,
    separateNextChunk: removedIds.length > 0,
  };
}
