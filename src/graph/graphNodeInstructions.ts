export const GRAPH_NODE_INSTRUCTIONS_MAX_LENGTH = 8000;

export function normalizeGraphNodeInstructions(value: unknown): string | undefined {
  const text = collectGraphNodeInstructions(value).trim();
  if (!text) {
    return undefined;
  }
  if (text.length <= GRAPH_NODE_INSTRUCTIONS_MAX_LENGTH) {
    return text;
  }
  const truncated = text.slice(0, GRAPH_NODE_INSTRUCTIONS_MAX_LENGTH).trimEnd();
  return truncated || undefined;
}

function collectGraphNodeInstructions(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join("\n");
}
