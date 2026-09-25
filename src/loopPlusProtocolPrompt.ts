export const LOOP_PLUS_MAIN_PROTOCOL_PROMPT_PREFIX = "You are the Loop+ main reviewer.";
export const LOOP_PLUS_SUBTASK_PROTOCOL_PROMPT_PREFIX = "You are one independent Loop+ execution attempt.";

const HIDDEN_LOOP_PLUS_PROTOCOL_PROMPT_PREFIXES = [
  LOOP_PLUS_MAIN_PROTOCOL_PROMPT_PREFIX,
  LOOP_PLUS_SUBTASK_PROTOCOL_PROMPT_PREFIX,
] as const;

export function isHiddenLoopPlusProtocolPrompt(content: unknown): boolean {
  if (typeof content !== "string") {
    return false;
  }
  const trimmed = content.trim();
  return HIDDEN_LOOP_PLUS_PROTOCOL_PROMPT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function buildHiddenLoopPlusProtocolPromptRuntimeSource(): string {
  const prefixes = HIDDEN_LOOP_PLUS_PROTOCOL_PROMPT_PREFIXES
    .map((prefix) => JSON.stringify(prefix))
    .join(", ");
  return [
    "function isHiddenLoopPlusProtocolPrompt(content) {",
    "        if (typeof content !== \"string\") {",
    "          return false;",
    "        }",
    "        const trimmed = content.trim();",
    `        const prefixes = [${prefixes}];`,
    "        for (let index = 0; index < prefixes.length; index += 1) {",
    "          if (trimmed.startsWith(prefixes[index])) {",
    "            return true;",
    "          }",
    "        }",
    "        return false;",
    "      }",
  ].join("\n");
}
