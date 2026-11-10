export function parseJsonContainerText(text: string): object | null {
  if (!text || (text[0] !== "{" && text[0] !== "[")) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function unwrapSingleMarkdownFence(content: string): string {
  const trimmed = String(content || "").replace(new RegExp("^" + String.fromCharCode(65279)), "").trim();
  const fence = String.fromCharCode(96);
  const match = trimmed.match(new RegExp("^(" + fence + "{3,}|~{3,})[^\\n\\r]*\\r?\\n([\\s\\S]*?)\\r?\\n\\1[ \\t]*$"));
  return match ? match[2] : trimmed;
}

export function parseCompleteJsonContainer(content: string): object | null {
  const trimmed = String(content || "").replace(new RegExp("^" + String.fromCharCode(65279)), "").trim();
  if (!trimmed) {
    return null;
  }
  const direct = parseJsonContainerText(trimmed);
  if (direct) {
    return direct;
  }
  const unwrapped = unwrapSingleMarkdownFence(trimmed);
  return unwrapped === trimmed ? null : parseJsonContainerText(String(unwrapped || "").trim());
}

export function buildJsonContainerRuntimeSource(): string {
  return [parseJsonContainerText, unwrapSingleMarkdownFence, parseCompleteJsonContainer]
    .map((parse) => parse.toString()).join("\n\n");
}
