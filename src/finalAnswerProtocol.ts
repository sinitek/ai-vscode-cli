export const FINAL_ANSWER_TEXT_MARKER = "[final_answer]";

export const FINAL_ANSWER_PROMPT_INSTRUCTION =
  `Final response requirement: When you have completed the task, start your final response with exactly ${FINAL_ANSWER_TEXT_MARKER}. Do not use ${FINAL_ANSWER_TEXT_MARKER} in progress updates or other non-final messages.`;

export function containsFinalAnswerTextMarker(value: unknown): boolean {
  return typeof value === "string" && value.includes(FINAL_ANSWER_TEXT_MARKER);
}

