import type { ZcodeSessionEvent } from "./zcodeAppServerProtocol";

export type ZcodeToolTrace = {
  toolCallId: string;
  content: string;
};

type ZcodeToolTraceState = {
  name: string;
  inputText: string;
  input: unknown;
  hasInput: boolean;
  lastContent: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringify(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return typeof text === "string" ? text : String(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseToolInput(state: ZcodeToolTraceState): void {
  if (!state.inputText.trim()) {
    return;
  }
  try {
    state.input = JSON.parse(state.inputText);
    state.hasInput = true;
  } catch {
    state.input = state.inputText;
    state.hasInput = true;
  }
}

function readCommand(name: string, input: unknown): string {
  const normalizedName = name.trim().toLowerCase();
  if (!new Set(["bash", "shell", "terminal"]).has(normalizedName)) {
    return "";
  }
  const record = asRecord(input);
  for (const key of ["command", "cmd", "script"]) {
    const value = readString(record?.[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function formatInput(state: ZcodeToolTraceState): string[] {
  if (!state.hasInput) {
    return [];
  }
  const command = readCommand(state.name, state.input);
  if (command) {
    return [];
  }
  return ["Input:", typeof state.input === "string" ? state.input : stringify(state.input)];
}

function formatToolUse(state: ZcodeToolTraceState): string {
  const command = readCommand(state.name, state.input);
  const header = command ? `exec ${command}` : `tool: ${state.name || "tool"}`;
  return [header, ...formatInput(state)].filter(Boolean).join("\n");
}

function formatToolResult(state: ZcodeToolTraceState, payload: Record<string, unknown>): string {
  const result = asRecord(payload.result);
  const command = readCommand(state.name, state.input);
  const header = command ? `exec ${command}` : `tool result: ${state.name || "tool"}`;
  const lines = [header];
  if (result?.success === false) {
    lines.push("status: failed");
  }
  const output = result?.content;
  if (output !== undefined && output !== null && output !== "") {
    lines.push("Output:");
    lines.push(typeof output === "string" ? output : stringify(output));
  }
  return lines.join("\n");
}

export class ZcodeToolTraceProjector {
  private readonly states = new Map<string, ZcodeToolTraceState>();
  private readonly retiredToolCallIds = new Set<string>();

  public beginTurn(): void {
    for (const toolCallId of this.states.keys()) {
      this.retiredToolCallIds.add(toolCallId);
    }
    this.states.clear();
  }

  public project(event: ZcodeSessionEvent): ZcodeToolTrace | null {
    if (event.type === "model.streaming") {
      return this.projectModelStream(event.payload);
    }
    if (event.type === "tool.updated") {
      return this.projectToolUpdate(event.payload);
    }
    return null;
  }

  private projectModelStream(payload: Record<string, unknown>): ZcodeToolTrace | null {
    const kind = readString(payload.kind);
    if (!["tool_input_start", "tool_input_delta", "tool_input_end", "tool_call"].includes(kind)) {
      return null;
    }
    const toolCallId = readString(payload.toolCallId);
    if (!toolCallId || this.retiredToolCallIds.has(toolCallId)) {
      return null;
    }
    const state = this.getState(toolCallId);
    const toolName = readString(payload.toolName);
    if (toolName) {
      state.name = toolName;
    }
    if (kind === "tool_input_start") {
      state.inputText = "";
      state.input = undefined;
      state.hasInput = false;
      return null;
    }
    if (kind === "tool_input_delta") {
      if (typeof payload.delta === "string") {
        state.inputText += payload.delta;
      }
      return null;
    }
    if (kind === "tool_input_end") {
      parseToolInput(state);
      return this.emit(toolCallId, state, formatToolUse(state));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "input")) {
      state.input = payload.input;
      state.hasInput = payload.input !== null && payload.input !== undefined;
    } else {
      parseToolInput(state);
    }
    return this.emit(toolCallId, state, formatToolUse(state));
  }

  private projectToolUpdate(payload: Record<string, unknown>): ZcodeToolTrace | null {
    const kind = readString(payload.kind);
    if (!["scheduled", "started", "result"].includes(kind)) {
      return null;
    }
    const toolCallId = readString(payload.toolCallId);
    if (!toolCallId || this.retiredToolCallIds.has(toolCallId)) {
      return null;
    }
    const state = this.getState(toolCallId);
    const toolName = readString(payload.toolName);
    if (toolName) {
      state.name = toolName;
    }
    if (kind === "result") {
      return this.emit(toolCallId, state, formatToolResult(state, payload));
    }
    if (!state.lastContent) {
      return this.emit(toolCallId, state, formatToolUse(state));
    }
    return null;
  }

  private getState(toolCallId: string): ZcodeToolTraceState {
    let state = this.states.get(toolCallId);
    if (!state) {
      state = { name: "", inputText: "", input: undefined, hasInput: false, lastContent: "" };
      this.states.set(toolCallId, state);
    }
    return state;
  }

  private emit(toolCallId: string, state: ZcodeToolTraceState, content: string): ZcodeToolTrace | null {
    if (!content || content === state.lastContent) {
      return null;
    }
    state.lastContent = content;
    return { toolCallId, content };
  }
}
