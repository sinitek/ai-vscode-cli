import { classifyGrokSessionMessage, type GrokJsonRpcMessage } from "./grokAppServerProtocol";

export type GrokToolTrace = {
  content: string;
  toolCallId?: string;
};

export type GrokPlanEntry = { content: string; status: string };

type ToolState = {
  message: GrokJsonRpcMessage;
  update: Record<string, unknown>;
  name: string;
  toolCallId: string;
  terminal: boolean;
  lastEvent: string;
  lastTrace: string;
  started: boolean;
  planApplied: boolean;
};

type GrokTodo = GrokPlanEntry & { id?: string };

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "interrupted"]);
const PLAN_TOOLS = new Set(["todo", "todo_write", "todowrite", "update_plan"]);
const SUMMARY_FIELDS = ["command", "path", "file_path", "absolute_path", "pattern", "glob", "query", "url", "task_id", "offset", "limit"];

export class GrokToolCallStream {
  private readonly tools = new Map<string, ToolState>();
  private readonly plans = new Map<string, GrokTodo[]>();
  private finished = false;

  public constructor(
    private readonly emit: (message: GrokJsonRpcMessage) => void,
    private readonly trace?: (trace: GrokToolTrace) => void,
  ) {}

  public append(message: GrokJsonRpcMessage): boolean {
    const params = asRecord(message.params);
    const update = asRecord(params?.update) ?? params;
    if (message.method !== "session/update" || !["tool_call", "tool_call_update"].includes(String(update?.sessionUpdate))) {
      return false;
    }
    if (this.finished || !update) {
      return true;
    }
    const event = classifyGrokSessionMessage(message);
    if (event.type !== "tool" && event.type !== "tool_update") {
      return false;
    }
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : "";
    const key = JSON.stringify([params?.sessionId ?? "", toolCallId]);
    const previous = toolCallId ? this.tools.get(key) : undefined;
    if (previous?.terminal && (!TERMINAL_STATUSES.has(String(update.status))
      || PLAN_TOOLS.has(previous.name.toLowerCase()) && (previous.planApplied || previous.update.status !== "completed"))) {
      return true;
    }
    const state: ToolState = previous ?? {
      message,
      update: {},
      name: event.name,
      toolCallId,
      terminal: false,
      lastEvent: "",
      lastTrace: "",
      started: false,
      planApplied: false,
    };
    state.message = message;
    const previousOutput = asRecord(state.update.rawOutput);
    const nextOutput = asRecord(update.rawOutput);
    state.update = {
      ...state.update,
      ...update,
      ...(previousOutput && nextOutput && ["Bash", "GrepSearch"].includes(String(previousOutput.type))
        && (!nextOutput.type || nextOutput.type === previousOutput.type)
        ? { rawOutput: { ...previousOutput, ...nextOutput } } : {}),
    };
    if (toolCallId || typeof state.update.status === "string") {
      state.update.status = readToolStatus(state.update);
    }
    if (PLAN_TOOLS.has(event.name.toLowerCase())
      || ["tool", "execute", "read", "search", "edit", "other", "think"].includes(state.name) && !["tool", "execute", "read", "search", "edit", "other", "think"].includes(event.name)) {
      state.name = event.name;
    }
    state.terminal = TERMINAL_STATUSES.has(String(state.update.status));
    if (toolCallId) {
      this.tools.set(key, state);
    }
    if (PLAN_TOOLS.has(state.name.toLowerCase())) {
      if (state.update.status === "completed" && !state.planApplied) {
        state.planApplied = this.emitPlan(state, String(params?.sessionId ?? ""));
      }
      if (!state.terminal || state.update.status === "completed") {
        return true;
      }
    }
    if (!toolCallId || event.type === "tool" || state.terminal) {
      this.emitState(state);
    }
    return true;
  }

  public observePlan(sessionId: string, value: unknown): void {
    const entries = normalizeGrokPlanEntries(value);
    if (this.finished || !entries) {
      return;
    }
    const previous = this.plans.get(sessionId) ?? [];
    this.plans.set(sessionId, readGrokTodos(value).map((entry) => {
      const matches = previous.filter((todo) => todo.content === entry.content);
      return { ...entry, ...(entry.id ? {} : matches.length === 1 && matches[0].id ? { id: matches[0].id } : {}) };
    }));
  }

  private emitPlan(state: ToolState, sessionId: string): boolean {
    const input = asRecord(state.update.rawInput);
    const output = asRecord(state.update.rawOutput);
    const result = asRecord(output?.TodosUpdated);
    const previous = this.plans.get(sessionId) ?? [];
    let todos: GrokTodo[] | null;
    if (result) {
      const entries = normalizeGrokPlanEntries(result.todos);
      if (!entries) {
        return false;
      }
      const known = [...previous, ...readGrokTodos(input?.todos)];
      todos = readGrokTodos(result.todos).map((entry) => {
        const ids = new Set(known.filter((todo) => todo.content === entry.content && todo.id).map((todo) => todo.id));
        return { ...entry, ...(entry.id ? {} : ids.size === 1 ? { id: [...ids][0] } : {}) };
      });
    } else {
      todos = mergeGrokTodos(previous, input);
    }
    if (!todos) {
      return false;
    }
    this.plans.set(sessionId, todos);
    this.emit(withUpdate(state.message, { sessionUpdate: "plan", entries: todos.map(({ content, status }) => ({ content, status })) }));
    return true;
  }

  public finish(status: "failed" | "cancelled" | "interrupted"): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    for (const state of this.tools.values()) {
      if (!state.terminal && !PLAN_TOOLS.has(state.name.toLowerCase())) {
        state.update = { ...state.update, sessionUpdate: "tool_call_update", status };
        state.terminal = true;
        this.emitState(state);
      }
    }
    this.tools.clear();
    this.plans.clear();
  }

  private emitState(state: ToolState): void {
    const update: Record<string, unknown> = {
      ...state.update,
      ...(state.terminal ? { sessionUpdate: "tool_call_update" } : {}),
      ...(Object.prototype.hasOwnProperty.call(state.update, "rawOutput")
        ? { rawOutput: normalizeGrokToolOutput(state.update.rawOutput) }
        : {}),
    };
    if (state.terminal && state.started) {
      delete update.rawInput;
    }
    const content = readPlainToolContent(update.content);
    const outputTexts = readKnownOutputTexts(update.rawOutput);
    const input = asRecord(state.update.rawInput);
    if (content !== null && (content === "" || content === input?.description || content === update.title
      || outputTexts.some((text) => text.includes(content))
      || asRecord(update.rawOutput)?.type === "ReadFile" && outputTexts.includes(stripFileLineNumbers(content)))) {
      delete update.content;
    }
    const signature = JSON.stringify(update);
    if (signature !== state.lastEvent) {
      state.lastEvent = signature;
      this.emit(withUpdate(state.message, update));
      if (!state.terminal) {
        state.started = true;
      }
    }
    const summary = formatToolSummary(state, update.rawOutput);
    if (summary !== state.lastTrace) {
      state.lastTrace = summary;
      this.trace?.({ content: summary, ...(state.toolCallId ? { toolCallId: state.toolCallId } : {}) });
    }
    if (state.terminal) {
      state.update = { ...state.update, ...(Object.prototype.hasOwnProperty.call(update, "rawOutput") ? { rawOutput: update.rawOutput } : {}) };
      state.message = withUpdate(state.message, update);
    }
  }
}

export function normalizeGrokToolOutput(value: unknown): unknown {
  const output = asRecord(value);
  if (!output) {
    return value;
  }
  if (output.type === "Bash" || output.type === "GrepSearch") {
    const normalized = { ...output };
    for (const key of output.type === "Bash" ? ["output"] : ["stdout", "stderr"]) {
      const decoded = decodeToolBytes(output[key]);
      if (decoded !== null) {
        normalized[key] = decoded;
      }
    }
    if (typeof normalized.output === "string" && normalized.output === normalized.output_for_prompt) {
      delete normalized.output_for_prompt;
    }
    return normalized;
  }
  if (output.type === "ReadFile") {
    const file = asRecord(output.FileContent);
    if (file) {
      const normalized = { ...file };
      if (typeof file.content === "string" && typeof file.raw_output === "string" && stripFileLineNumbers(file.content) === file.raw_output) {
        normalized.content = file.raw_output;
        delete normalized.raw_output;
      }
      if (normalized.content_concise === file.content) {
        delete normalized.content_concise;
      }
      return { ...output, FileContent: removeEquivalentText(normalized, "content", ["content_concise", "raw_output"]) };
    }
  }
  if (output.type === "SearchReplace") {
    const edits = asRecord(output.EditsApplied);
    if (edits) {
      return { ...output, EditsApplied: removeEquivalentText(edits, "tool_output_for_prompt", ["tool_output_for_prompt_concise"]) };
    }
  }
  return value;
}

export function normalizeGrokPlanEntries(value: unknown): GrokPlanEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: GrokPlanEntry[] = [];
  for (const item of value) {
    const entry = asRecord(item);
    const content = entry?.content ?? entry?.text;
    if (typeof content !== "string" || !content.trim()) {
      return null;
    }
    entries.push({ content, status: typeof entry?.status === "string" ? entry.status : entry?.done === true ? "completed" : "pending" });
  }
  return entries;
}

function readGrokTodos(value: unknown): GrokTodo[] {
  const entries = normalizeGrokPlanEntries(value);
  if (!entries || !Array.isArray(value)) {
    return [];
  }
  return entries.map((entry, index) => {
    const id = asRecord(value[index])?.id;
    return { ...entry, ...(typeof id === "string" && id ? { id } : {}) };
  });
}

function mergeGrokTodos(previous: GrokTodo[], input: Record<string, unknown> | null): GrokTodo[] | null {
  if (!Array.isArray(input?.todos)) {
    return null;
  }
  if (input.merge === false) {
    return normalizeGrokPlanEntries(input.todos) ? readGrokTodos(input.todos) : null;
  }
  const next = previous.map((todo) => ({ ...todo }));
  for (const value of input.todos) {
    const patch = asRecord(value);
    if (!patch || typeof patch.id !== "string" || !patch.id) {
      return null;
    }
    const index = next.findIndex((todo) => todo.id === patch.id);
    const entry = normalizeGrokPlanEntries([{ ...(index >= 0 ? next[index] : {}), ...patch }])?.[0];
    if (!entry) {
      return null;
    }
    const todo = { ...entry, id: patch.id };
    if (index >= 0) {
      next[index] = todo;
    } else {
      next.push(todo);
    }
  }
  return next;
}

function decodeToolBytes(value: unknown): string | null {
  if (!Array.isArray(value) || !value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return null;
  }
  const buffer = Buffer.from(value);
  const text = buffer.toString("utf8");
  return Buffer.from(text, "utf8").equals(buffer) ? text : null;
}

function stripFileLineNumbers(value: string): string {
  return value.replace(/^\d+→/gm, "");
}

function readPlainToolContent(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const texts = value.map(readPlainToolContent);
    return texts.every((text) => text !== null) ? texts.join("\n") : null;
  }
  const record = asRecord(value);
  if (record?.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  return record?.type === "content" ? readPlainToolContent(record.content) : null;
}

function readKnownOutputTexts(value: unknown): string[] {
  const output = asRecord(value);
  const fields = output?.type === "Bash" ? [output.output, output.output_for_prompt]
    : output?.type === "GrepSearch" ? [output.stdout, output.stderr]
      : output?.type === "ReadFile" ? Object.values(asRecord(output.FileContent) ?? {})
        : [];
  return fields.filter((field): field is string => typeof field === "string");
}

function removeEquivalentText(source: Record<string, unknown>, key: string, aliases: string[]): Record<string, unknown> {
  const normalized = { ...source };
  if (typeof source[key] === "string") {
    for (const alias of aliases) {
      if (source[alias] === source[key]) {
        delete normalized[alias];
      }
    }
  }
  return normalized;
}

function readToolStatus(update: Record<string, unknown>): string {
  const output = asRecord(update.rawOutput);
  const result = asRecord(output?.Result) ?? output;
  const exitCode = result?.exit_code;
  const nonzeroExit = Number.isInteger(exitCode) && exitCode !== 0 && (output?.type !== "GrepSearch" || exitCode !== 1);
  if (update.status === "completed" && (nonzeroExit || result?.timed_out === true || Boolean(result?.signal))) {
    return "failed";
  }
  return typeof update.status === "string" && update.status ? update.status : "in_progress";
}

function formatToolSummary(state: ToolState, rawOutput: unknown): string {
  const lines = [`tool: ${state.name}`, `status: ${readToolStatus(state.update)}`];
  const output = asRecord(rawOutput);
  const input = asRecord(state.update.rawInput) ?? asRecord(output?.FileContent) ?? output;
  for (const field of SUMMARY_FIELDS) {
    const value = input?.[field];
    if ((typeof value === "string" && value) || typeof value === "number") {
      lines.push(`${field}: ${shorten(String(value), 1400)}`);
    }
  }
  const result = asRecord(output?.Result) ?? output;
  if (state.terminal && typeof result?.exit_code === "number") {
    lines.push(`exit_code: ${result.exit_code}`);
  }
  if (state.update.status === "failed") {
    const error = result?.error;
    const detail = typeof error === "string" ? error : asRecord(error)?.message ?? result?.message;
    const text = typeof detail === "string" ? detail
      : typeof rawOutput === "string" ? rawOutput
        : [result?.stderr, result?.output, result?.output_for_prompt].filter((value) => typeof value === "string" && value).join("\n");
    const fallback = text || (output ? JSON.stringify(output) : "");
    if (fallback) {
      lines.push(`output:\n${shorten(fallback, 2000, true)}`);
    }
  }
  return lines.join("\n");
}

function shorten(value: string, limit: number, preserveTail = false): string {
  if (value.length <= limit) {
    return value;
  }
  if (preserveTail) {
    const headLength = Math.floor(limit / 2);
    return `${value.slice(0, headLength)}\n…\n${value.slice(-(limit - headLength))}`;
  }
  return `${value.slice(0, limit)}…`;
}

function withUpdate(message: GrokJsonRpcMessage, update: Record<string, unknown>): GrokJsonRpcMessage {
  const params = asRecord(message.params);
  return { ...message, params: asRecord(params?.update) ? { ...params, update } : { ...params, ...update } };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
