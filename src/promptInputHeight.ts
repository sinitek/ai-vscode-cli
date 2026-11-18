export const PROMPT_INPUT_MIN_HEIGHT = 58.5;

export function normalizePromptInputHeight(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= PROMPT_INPUT_MIN_HEIGHT
    ? value
    : undefined;
}
