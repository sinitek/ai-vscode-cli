import { GeminiStreamJsonEvent } from "./geminiStreamJson";

export const GEMINI_NATIVE_COMPACT_PROMPT = "/compress";

export type GeminiCompactionResult = {
  compacted: boolean;
  sessionId: string | null;
  resultStatus: string | null;
  errorText: string | null;
};

export function isGeminiNativeCompactionPrompt(prompt: string): boolean {
  return prompt.trim() === GEMINI_NATIVE_COMPACT_PROMPT;
}

export function isGeminiNativeCompactUnsupportedErrorText(errorText: string | null | undefined): boolean {
  if (!errorText) {
    return false;
  }
  return (
    /(?:\/compress|compress)/i.test(errorText)
    && /(?:unknown|unsupported|invalid|disabled|unavailable|not available|not supported)/i.test(errorText)
  );
}

export function isGeminiCompactionEvent(event: GeminiStreamJsonEvent): boolean {
  if (event.type !== "message" || event.role !== "assistant") {
    return false;
  }
  const content = typeof event.content === "string" ? event.content : "";
  return /compress|summary|context/i.test(content);
}
