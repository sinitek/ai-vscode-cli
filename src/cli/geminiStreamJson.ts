const GEMINI_PROMPT_FLAGS = new Set(["-p", "--prompt"]);
const GEMINI_OUTPUT_FORMAT_FLAG = "--output-format";
const GEMINI_STREAM_JSON_FORMAT = "stream-json";

export type GeminiStreamJsonEvent = {
  type: string;
  timestamp?: string;
  session_id?: string;
  role?: string;
  content?: unknown;
  delta?: boolean;
  status?: string;
  error?: unknown;
  message?: unknown;
  [key: string]: unknown;
};

export type GeminiParsedLine =
  | { kind: "event"; event: GeminiStreamJsonEvent }
  | { kind: "text"; text: string };

export type GeminiStreamJsonChunk = {
  events: GeminiStreamJsonEvent[];
  textLines: string[];
  remainder: string;
};

export type GeminiEventDisplay = {
  assistantText: string;
  traceText: string;
  sessionId: string | null;
  resultStatus: string | null;
  errorText: string | null;
};

function isPromptFlag(arg: string): boolean {
  return GEMINI_PROMPT_FLAGS.has(arg) || arg.startsWith("--prompt=");
}

function hasGeminiPromptArg(args: string[]): boolean {
  return args.some((arg) => isPromptFlag(arg));
}

function hasGeminiOutputFormatArg(args: string[]): boolean {
  return args.some((arg) => arg === GEMINI_OUTPUT_FORMAT_FLAG || arg.startsWith(`${GEMINI_OUTPUT_FORMAT_FLAG}=`));
}

export function ensureGeminiHeadlessArgs(args: string[], prompt?: string): string[] {
  const nextArgs = [...args];
  if (prompt !== undefined && prompt !== "" && !hasGeminiPromptArg(nextArgs)) {
    nextArgs.push("-p", prompt);
  }
  if (!hasGeminiOutputFormatArg(nextArgs)) {
    nextArgs.push(GEMINI_OUTPUT_FORMAT_FLAG, GEMINI_STREAM_JSON_FORMAT);
  }
  return nextArgs;
}

export function parseGeminiStreamJsonLine(line: string): GeminiParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith("{")) {
    return { kind: "text", text: line };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { kind: "text", text: line };
    }
    const event = parsed as Record<string, unknown>;
    if (typeof event.type !== "string" || !event.type.trim()) {
      return { kind: "text", text: line };
    }
    return { kind: "event", event: event as GeminiStreamJsonEvent };
  } catch {
    return { kind: "text", text: line };
  }
}

export function parseGeminiStreamJsonChunk(previousRemainder: string, chunk: string): GeminiStreamJsonChunk {
  const normalized = `${previousRemainder}${chunk}`.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const remainder = lines.pop() ?? "";
  const events: GeminiStreamJsonEvent[] = [];
  const textLines: string[] = [];

  lines.forEach((line) => {
    const parsed = parseGeminiStreamJsonLine(line);
    if (!parsed) {
      return;
    }
    if (parsed.kind === "event") {
      events.push(parsed.event);
      return;
    }
    textLines.push(parsed.text);
  });

  return { events, textLines, remainder };
}

function stringifyUnknown(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeEventForTrace(event: GeminiStreamJsonEvent): string {
  const type = event.type;
  if (type === "tool_use" || type === "tool_call") {
    const name = stringifyUnknown(event.name ?? event.tool ?? event.tool_name).trim();
    const args = stringifyUnknown(event.args ?? event.arguments ?? event.input).trim();
    return [`tool: ${name || type}`, args].filter(Boolean).join("\n");
  }
  if (type === "tool_result") {
    const name = stringifyUnknown(event.name ?? event.tool ?? event.tool_name).trim();
    const output = stringifyUnknown(event.output ?? event.result ?? event.content).trim();
    return [`tool result ${name}`.trim(), output].filter(Boolean).join("\n");
  }
  if (type === "error") {
    return `error ${stringifyUnknown(event.error ?? event.message ?? event).trim()}`.trim();
  }
  if (type === "result" && event.status && event.status !== "success") {
    return `error Gemini result status: ${event.status}`;
  }
  return "";
}

export function getGeminiEventDisplay(event: GeminiStreamJsonEvent): GeminiEventDisplay {
  const sessionId = typeof event.session_id === "string" && event.session_id.trim()
    ? event.session_id.trim()
    : null;
  const resultStatus = event.type === "result" && typeof event.status === "string"
    ? event.status
    : null;
  const errorText = event.type === "error"
    ? stringifyUnknown(event.error ?? event.message ?? event).trim() || "Gemini stream-json error"
    : null;
  const assistantText = event.type === "message" && event.role === "assistant"
    ? stringifyUnknown(event.content)
    : "";
  return {
    assistantText,
    traceText: summarizeEventForTrace(event),
    sessionId,
    resultStatus,
    errorText,
  };
}

export function finalizeGeminiStreamJsonRemainder(remainder: string): GeminiParsedLine | null {
  return parseGeminiStreamJsonLine(remainder);
}
