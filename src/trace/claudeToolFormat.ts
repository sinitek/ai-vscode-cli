const EDIT_TOOL_REDACT_KEYS = new Set(["old_string", "new_string"]);

function formatClaudeToolPayload(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseToolPayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stripToolPayloadKeys(value: unknown, keys: Set<string>): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripToolPayloadKeys(item, keys));
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  Object.entries(record).forEach(([key, itemValue]) => {
    if (keys.has(key)) {
      return;
    }
    next[key] = stripToolPayloadKeys(itemValue, keys);
  });
  return next;
}

export function formatClaudeToolUseMessage(name: string | undefined, input: unknown): string {
  const header = name ? `调用工具: ${name}` : "调用工具";
  const payload =
    name === "Edit"
      ? stripToolPayloadKeys(parseToolPayload(input), EDIT_TOOL_REDACT_KEYS)
      : input;
  const formattedInput = formatClaudeToolPayload(payload);
  if (!formattedInput) {
    return header;
  }
  return `${header}\n输入:\n${formattedInput}`;
}

export function formatClaudeToolResultMessage(content: unknown, toolName?: string): string {
  const header = toolName ? `工具结果: ${toolName}` : "工具结果";
  if (typeof toolName === "string" && toolName.toLowerCase() === "read") {
    return header;
  }
  const output = formatClaudeToolPayload(content);
  if (!output) {
    return header;
  }
  return `${header}\n输出:\n${output}`;
}
