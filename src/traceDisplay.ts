import { CliName, isOpenCodeCli } from "./cli/types";

export type TraceMessageKind = "thinking" | "normal" | "tool-use";

export type TraceDisplayResult = {
  content: string;
  shouldPersist: boolean;
};

export function isCommandExecutionTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  const trimmed = firstLine.trim();
  return trimmed.startsWith("exec") || trimmed.startsWith("【执行命令】");
}

export function isFileUpdateTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return firstLine.trim().startsWith("file update");
}

export function isToolUseTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:tool|调用工具)[:：]?\s*(.+)?$/i.test(firstLine.trim());
}

export function isToolResultTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:tool\s*result|工具结果)\b/i.test(firstLine.trim());
}

export function isWarningOrErrorTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:warning|警告|error|错误)\b/i.test(firstLine.trim());
}

export function isWebSearchTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:web\s*search\b|【网络查询】)/i.test(firstLine.trim());
}

export function isThinkingTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  const trimmed = firstLine.trim();
  return trimmed.startsWith("thinking") || trimmed.startsWith("思考");
}

export function resolveTraceKind(content: string, kind: TraceMessageKind): TraceMessageKind {
  if (kind === "thinking" || isThinkingTrace(content)) {
    return "thinking";
  }
  if (isToolUseTrace(content)) {
    return "tool-use";
  }
  return "normal";
}

export function resolveTraceMerge(content: string, merge?: boolean): boolean {
  if (merge !== undefined) {
    return merge;
  }
  // Structured trace events keep an independent bubble so tags, style and collapse state stay stable.
  return !(
    isCommandExecutionTrace(content)
    || isFileUpdateTrace(content)
    || isToolUseTrace(content)
    || isToolResultTrace(content)
    || isWarningOrErrorTrace(content)
    || isWebSearchTrace(content)
  );
}

export function formatCodexExecSegmentForDisplay(
  content: string,
  cli: CliName | null
): TraceDisplayResult {
  if (cli !== "codex" && !isOpenCodeCli(cli)) {
    return { content, shouldPersist: true };
  }
  const lines = content.split("\n");
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex === -1) {
    return { content, shouldPersist: true };
  }
  const firstLine = lines[firstLineIndex].trim();
  if (!firstLine.startsWith("exec") && !firstLine.startsWith("【执行命令】")) {
    return { content, shouldPersist: true };
  }

  let commandLine = firstLine;
  let consumedLineIndex = firstLineIndex;
  if (firstLine === "exec" || firstLine === "exec:" || firstLine === "【执行命令】") {
    const nextLineIndex = lines.findIndex((line, index) => index > firstLineIndex && line.trim());
    if (nextLineIndex !== -1) {
      const normalized = lines[nextLineIndex].trim().replace(/^\$\s*/, "");
      commandLine = `exec ${normalized}`;
      consumedLineIndex = nextLineIndex;
    }
  } else if (firstLine.startsWith("exec:")) {
    const normalized = firstLine.slice("exec:".length).trim();
    if (normalized) {
      commandLine = `exec ${normalized}`;
    }
  } else if (firstLine.startsWith("【执行命令】")) {
    const normalized = firstLine.slice("【执行命令】".length).trim();
    if (normalized) {
      commandLine = `exec ${normalized}`;
    } else {
      commandLine = "exec";
    }
  }

  const trailingLines = lines.slice(consumedLineIndex + 1);
  const merged = [commandLine, ...trailingLines].join("\n").trimEnd();
  return { content: merged || commandLine, shouldPersist: true };
}

export function isLegacyGeminiNoiseTraceLine(trimmed: string): boolean {
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized.includes(".npmrc") && normalized.includes("globalconfig")) {
    return true;
  }
  if (normalized.includes("yolo mode is enabled")) {
    return true;
  }
  if (normalized.includes("nvm use --delete-prefix") && normalized.includes("--silent")) {
    return true;
  }
  if (normalized.includes("failed to connect to ide companion extension")) {
    return true;
  }
  return false;
}

export function normalizeLegacyGeminiTraceLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return line;
  }
  if (/^\[(?:error|err)\]\s*/i.test(trimmed)) {
    return `error ${trimmed.replace(/^\[(?:error|err)\]\s*/i, "").trim()}`;
  }
  if (/^\[(?:warn|warning)\]\s*/i.test(trimmed)) {
    return `warning ${trimmed.replace(/^\[(?:warn|warning)\]\s*/i, "").trim()}`;
  }
  if (/^(?:running|executing)\s+command(?:\s*[:：]|\s+)\s*/i.test(trimmed)) {
    return `exec ${trimmed.replace(/^(?:running|executing)\s+command(?:\s*[:：]|\s+)\s*/i, "").trim()}`;
  }
  if (/^(?:tool(?:\s+call)?|调用工具)\s*[:：]\s*/i.test(trimmed)) {
    return `tool: ${trimmed.replace(/^(?:tool(?:\s+call)?|调用工具)\s*[:：]\s*/i, "").trim()}`;
  }
  if (/^(?:tool\s*result|工具结果)\s*[:：]?\s*/i.test(trimmed)) {
    return `tool result ${trimmed.replace(/^(?:tool\s*result|工具结果)\s*[:：]?\s*/i, "").trim()}`.trim();
  }
  if (/^(?:thinking|thought|思考)\s*[:：]\s*/i.test(trimmed)) {
    return `thinking ${trimmed.replace(/^(?:thinking|thought|思考)\s*[:：]\s*/i, "").trim()}`;
  }
  if (/^web\s*search\s*[:：]\s*/i.test(trimmed)) {
    return `web search ${trimmed.replace(/^web\s*search\s*[:：]\s*/i, "").trim()}`;
  }
  return trimmed;
}

export function formatLegacyGeminiTraceSegmentForDisplay(
  content: string,
  cli: string | null
): TraceDisplayResult {
  if (cli !== "gemini") {
    return { content, shouldPersist: true };
  }
  const normalizedLines = content
    .split("\n")
    .map((line) => normalizeLegacyGeminiTraceLine(line));
  const normalizedContent = normalizedLines.join("\n").trimEnd();
  if (!normalizedContent.trim()) {
    return { content: "", shouldPersist: false };
  }
  return { content: normalizedContent, shouldPersist: true };
}

export function formatTraceSegmentForDisplay(
  content: string,
  cli: CliName | null
): TraceDisplayResult {
  return { content, shouldPersist: true };
}

export function normalizeTraceContentForDisplay(content: string, cli: CliName | null): TraceDisplayResult {
  const { content: execContent, shouldPersist: execShouldPersist } =
    formatCodexExecSegmentForDisplay(content, cli);
  const { content: displayContent, shouldPersist } = formatTraceSegmentForDisplay(execContent, cli);
  return { content: displayContent, shouldPersist: shouldPersist && execShouldPersist };
}

export function isTraceSegmentStart(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(
    trimmed.startsWith("thinking")
      || trimmed.startsWith("思考")
      || trimmed.startsWith("exec")
      || trimmed.startsWith("file update")
      || trimmed.startsWith("apply_patch")
      || trimmed.startsWith("warning")
      || trimmed.startsWith("error")
      || /^\[(?:error|err|warn|warning)\]/i.test(trimmed)
      || /^(?:tool(?:\s+call)?|调用工具)\s*[:：]/i.test(trimmed)
      || /^(?:tool\s*result|工具结果)\b/i.test(trimmed)
      || /^(?:running|executing)\s+command\b/i.test(trimmed)
      || /^(?:web\s*search\b|【网络查询】)/i.test(trimmed)
  );
}

export function getTraceSegmentKind(content: string): "thinking" | "normal" {
  return isThinkingTrace(content) ? "thinking" : "normal";
}

export type TraceLineFilterState = {
  skipUserBlock: boolean;
  skipCodexBlock: boolean;
};

export function createTraceLineFilterState(): TraceLineFilterState {
  return {
    skipUserBlock: false,
    skipCodexBlock: false,
  };
}

export function resetTraceLineFilterState(state: TraceLineFilterState): void {
  state.skipUserBlock = false;
  state.skipCodexBlock = false;
}

export function shouldIgnoreTraceLine(
  state: TraceLineFilterState,
  line: string,
  hasSegment: boolean,
  cli: CliName | null
): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    if (state.skipUserBlock) {
      state.skipUserBlock = false;
    }
    if (state.skipCodexBlock) {
      state.skipCodexBlock = false;
    }
    return !hasSegment;
  }
  if (state.skipUserBlock) {
    if (isTraceSegmentStart(trimmed)) {
      state.skipUserBlock = false;
    }
    return true;
  }
  if (state.skipCodexBlock) {
    if (isTraceSegmentStart(trimmed) || trimmed.startsWith("tokens used")) {
      state.skipCodexBlock = false;
    }
    return true;
  }
  if (trimmed === "user") {
    state.skipUserBlock = true;
    return true;
  }
  if (trimmed === "codex") {
    state.skipCodexBlock = true;
    return true;
  }
  const ignoredPrefixes = [
    "OpenAI Codex",
    "--------",
    "workdir:",
    "model:",
    "provider:",
    "approval:",
    "sandbox:",
    "reasoning effort:",
    "reasoning summaries:",
    "session id:",
    "mcp startup:",
    "tokens used",
  ];
  if (ignoredPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return true;
  }
  return false;
}
