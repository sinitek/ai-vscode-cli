export type CodexRawResponseToolCall = {
  callId: string;
  toolName: string;
};

export type CodexRawResponseToolOutput = {
  callId: string;
  text: string;
  success: boolean | null;
};

export type CodexWaitTimeoutPayload = {
  toolName: string;
  detail: string;
};

export type CodexCollabToolFailure = {
  tool: string;
  status: string;
  detail: string;
};

export type CodexWebSearchTraceCandidate = {
  itemId: string;
  query: string;
};

export type CodexItemTraceEventType = "item.started" | "item.completed";

export type CodexItemTraceCandidate = {
  itemType: string;
  itemId: string;
  content: string;
};

function normalizeCodexCompactionItemType(type: unknown): string {
  return String(type || "").trim().replace(/[_-]/g, "").toLowerCase();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(text: string): unknown | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function extractToolOutputText(output: unknown): string {
  const outputRecord = toRecord(output);
  const body = outputRecord && Object.prototype.hasOwnProperty.call(outputRecord, "body")
    ? outputRecord.body
    : output;
  if (typeof body === "string") {
    return body.trim();
  }
  if (Array.isArray(body)) {
    return body
      .map((item) => {
        const record = toRecord(item);
        return typeof record?.text === "string" ? record.text.trim() : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof body === "undefined" || body === null) {
    return "";
  }
  return safeStringify(body).trim();
}

function formatAgentStateFailure(threadId: string, rawState: unknown): string | null {
  const state = toRecord(rawState);
  if (!state) {
    return null;
  }
  const message = typeof state.message === "string" ? state.message.trim() : "";
  const status = state.status;
  const statusRecord = toRecord(status);
  if (statusRecord) {
    const errored = typeof statusRecord.errored === "string" ? statusRecord.errored.trim() : "";
    if (errored) {
      return `${threadId}: ${errored}`;
    }
    return null;
  }
  const normalizedStatus = String(status || "").trim();
  if (normalizedStatus === "not_found") {
    return `${threadId}: ${message || normalizedStatus}`;
  }
  return null;
}

export function normalizeCodexExecItemType(type: unknown): string {
  const normalized = String(type || "").trim();
  return ({
    agentMessage: "agent_message",
    commandExecution: "command_execution",
    fileChange: "file_change",
    mcpToolCall: "mcp_tool_call",
    todoList: "todo_list",
    webSearch: "web_search",
    dynamicToolCall: "dynamic_tool_call",
    collabAgentToolCall: "collab_agent_tool_call",
  } as Record<string, string>)[normalized] || normalized;
}

export function isCodexFinalAnswerPhase(phase: unknown): boolean {
  return String(phase || "").trim() === "final_answer";
}

export function isCodexFinalAnswerAgentMessage(rawItem: unknown): boolean {
  const item = toRecord(rawItem);
  return Boolean(
    item
    && normalizeCodexExecItemType(item.type) === "agent_message"
    && isCodexFinalAnswerPhase(item.phase)
  );
}

function joinTraceLines(lines: Array<string | null | undefined>): string {
  return lines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stringifyTraceArguments(value: unknown): string {
  if (typeof value === "undefined") {
    return "";
  }
  const text = safeStringify(value).trim();
  return text === "undefined" ? "" : text;
}

function extractCodexCommandExecutionTraceCandidate(
  rawItem: unknown,
  eventType: CodexItemTraceEventType
): CodexItemTraceCandidate | null {
  const item = toRecord(rawItem);
  if (!item || normalizeCodexExecItemType(item.type) !== "command_execution") {
    return null;
  }
  const command = typeof item.command === "string" ? item.command.trim() : "";
  if (eventType === "item.started" && !command) {
    return null;
  }
  return {
    itemType: "command_execution",
    itemId: String(item.id || "").trim(),
    content: command ? `exec ${command}` : "exec",
  };
}

function extractCodexMcpToolCallTraceCandidate(
  rawItem: unknown,
  eventType: CodexItemTraceEventType
): CodexItemTraceCandidate | null {
  const item = toRecord(rawItem);
  if (!item || normalizeCodexExecItemType(item.type) !== "mcp_tool_call") {
    return null;
  }
  const server = typeof item.server === "string" ? item.server.trim() : "";
  const tool = typeof item.tool === "string" ? item.tool.trim() : "";
  const status = typeof item.status === "string" ? item.status.trim() : "";
  const identity = [server, tool].filter(Boolean).join(" :: ").trim();
  const paramsText = stringifyTraceArguments(item.arguments);
  const shouldSurfaceStatus = eventType === "item.completed"
    && Boolean(status)
    && status !== "completed"
    && status !== "succeeded";
  if (eventType === "item.started" && !identity && !paramsText) {
    return null;
  }
  const content = joinTraceLines([
    "mcp",
    identity,
    shouldSurfaceStatus ? `status: ${status}` : "",
    paramsText ? `params: ${paramsText}` : "",
  ]);
  if (!content || content === "mcp") {
    return null;
  }
  return {
    itemType: "mcp_tool_call",
    itemId: String(item.id || "").trim(),
    content,
  };
}

function extractCodexWebSearchQuery(rawItem: unknown, eventType: CodexItemTraceEventType): string {
  if (eventType !== "item.completed") {
    return "";
  }
  const item = toRecord(rawItem);
  if (!item || normalizeCodexExecItemType(item.type) !== "web_search") {
    return "";
  }
  const action = toRecord(item.action);
  return [
    typeof item.query === "string" ? item.query.trim() : "",
    typeof action?.query === "string" ? action.query.trim() : "",
    typeof action?.url === "string" ? action.url.trim() : "",
  ].find((value) => value.length > 0) ?? "";
}

export function extractCodexItemTraceCandidate(
  rawItem: unknown,
  eventType: CodexItemTraceEventType
): CodexItemTraceCandidate | null {
  const item = toRecord(rawItem);
  if (!item) {
    return null;
  }
  const itemType = normalizeCodexExecItemType(item.type);
  if (itemType === "command_execution") {
    return extractCodexCommandExecutionTraceCandidate(item, eventType);
  }
  if (itemType === "mcp_tool_call") {
    return extractCodexMcpToolCallTraceCandidate(item, eventType);
  }
  if (itemType === "web_search") {
    const query = extractCodexWebSearchQuery(item, eventType);
    if (!query) {
      return null;
    }
    return {
      itemType: "web_search",
      itemId: String(item.id || "").trim(),
      content: `web search ${query}`,
    };
  }
  return null;
}

export function isCodexContextCompactionCompletedNotification(
  rawMessage: unknown,
  expectedThreadId = ""
): boolean {
  const message = toRecord(rawMessage);
  if (!message) {
    return false;
  }

  const method = String(message.method || "").trim();
  const normalizedExpectedThreadId = String(expectedThreadId || "").trim();
  const params = toRecord(message.params);

  if (method === "thread/compacted") {
    const compactedThreadId = String(params?.threadId || "").trim();
    return !compactedThreadId || !normalizedExpectedThreadId || compactedThreadId === normalizedExpectedThreadId;
  }

  if (method !== "item/completed") {
    return false;
  }

  const itemThreadId = String(params?.threadId || "").trim();
  if (normalizedExpectedThreadId && itemThreadId !== normalizedExpectedThreadId) {
    return false;
  }

  return normalizeCodexCompactionItemType(params?.item && toRecord(params.item)?.type) === "contextcompaction";
}

export function extractCodexWebSearchTraceCandidate(
  rawItem: unknown,
  eventType: CodexItemTraceEventType
): CodexWebSearchTraceCandidate | null {
  const query = extractCodexWebSearchQuery(rawItem, eventType);
  const item = toRecord(rawItem);
  if (!query) {
    return null;
  }
  return {
    itemId: String(item?.id || "").trim(),
    query,
  };
}

export function extractCodexRawResponseToolCall(rawItem: unknown): CodexRawResponseToolCall | null {
  const item = toRecord(rawItem);
  if (!item) {
    return null;
  }
  const itemType = String(item.type || "").trim();
  if (itemType !== "function_call" && itemType !== "custom_tool_call") {
    return null;
  }
  const callId = String(item.call_id || "").trim();
  const toolName = typeof item.name === "string" ? item.name.trim() : "";
  if (!callId || !toolName) {
    return null;
  }
  return { callId, toolName };
}

export function extractCodexRawResponseToolOutput(rawItem: unknown): CodexRawResponseToolOutput | null {
  const item = toRecord(rawItem);
  if (!item) {
    return null;
  }
  const itemType = String(item.type || "").trim();
  if (itemType !== "function_call_output" && itemType !== "custom_tool_call_output") {
    return null;
  }
  const callId = String(item.call_id || "").trim();
  if (!callId) {
    return null;
  }
  const output = toRecord(item.output);
  return {
    callId,
    text: extractToolOutputText(item.output),
    success: typeof output?.success === "boolean" ? output.success : null,
  };
}

export function extractCodexWaitTimeoutPayload(
  rawItem: unknown,
  toolName: string | null | undefined
): CodexWaitTimeoutPayload | null {
  const normalizedToolName = String(toolName || "").trim();
  if (normalizedToolName !== "wait") {
    return null;
  }
  const output = extractCodexRawResponseToolOutput(rawItem);
  if (!output || !output.text) {
    return null;
  }
  const parsed = parseJson(output.text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.timed_out === true) {
      return {
        toolName: normalizedToolName,
        detail: safeStringify(record),
      };
    }
  }
  if (output.text.includes('"timed_out":true')) {
    return {
      toolName: normalizedToolName,
      detail: output.text,
    };
  }
  return null;
}

export function extractCodexCollabToolFailure(rawItem: unknown): CodexCollabToolFailure | null {
  const item = toRecord(rawItem);
  if (!item || normalizeCodexExecItemType(item.type) !== "collab_agent_tool_call") {
    return null;
  }
  const tool = String(item.tool || "").trim() || "subtask";
  const status = String(item.status || "").trim();
  const agentsStates = toRecord(item.agentsStates) ?? toRecord(item.agents_states) ?? {};
  const details = Object.entries(agentsStates)
    .map(([threadId, rawState]) => formatAgentStateFailure(threadId, rawState))
    .filter((detail): detail is string => Boolean(detail));
  if (details.length > 0) {
    return {
      tool,
      status,
      detail: details.join("; "),
    };
  }
  if (status === "failed") {
    return {
      tool,
      status,
      detail: "collab tool reported failed",
    };
  }
  return null;
}
