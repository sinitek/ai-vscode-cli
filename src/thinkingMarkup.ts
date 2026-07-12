export type ThinkingTaggedSegment = {
  kind: "assistant" | "thinking";
  content: string;
};

const THINKING_WRAPPER_TAG_PATTERN = /<\/?(?:thinking|think|analysis|reasoning)\b[^>]*>/giu;

export function stripThinkingWrapperTags(content: string): string {
  return content.replace(THINKING_WRAPPER_TAG_PATTERN, "");
}

export function splitThinkingTaggedContent(content: string): ThinkingTaggedSegment[] {
  const segments: ThinkingTaggedSegment[] = [];
  const blockPattern = /<(thinking|think|analysis|reasoning)\b[^>]*>([\s\S]*?)<\/\1\s*>/giu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const appendAssistant = (value: string): void => {
    const cleaned = stripThinkingWrapperTags(value);
    if (cleaned.trim()) {
      segments.push({ kind: "assistant", content: cleaned });
    }
  };

  while ((match = blockPattern.exec(content)) !== null) {
    appendAssistant(content.slice(cursor, match.index));
    const thinkingContent = stripThinkingWrapperTags(match[2] ?? "").trim();
    if (thinkingContent) {
      segments.push({ kind: "thinking", content: thinkingContent });
    }
    cursor = match.index + match[0].length;
  }

  appendAssistant(content.slice(cursor));
  return segments;
}

export function extractAssistantTextWithoutThinkingBlocks(content: string): string {
  return splitThinkingTaggedContent(content)
    .filter((segment) => segment.kind === "assistant")
    .map((segment) => segment.content)
    .join("");
}
