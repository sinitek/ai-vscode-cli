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
