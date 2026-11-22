export type AcpJsonRpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export function parseAcpJsonRpcLine(
  line: string,
): { ok: true; message: AcpJsonRpcMessage } | { ok: false; reason: "empty" | "invalid"; error: string } {
  if (line.trim() === "") {
    return { ok: false, reason: "empty", error: "empty" };
  }
  try {
    const record = asRecord(JSON.parse(line));
    if (!record) {
      return { ok: false, reason: "invalid", error: "ACP frame is not an object" };
    }
    if (record.jsonrpc !== "2.0") {
      return { ok: false, reason: "invalid", error: "ACP frame is not JSON-RPC 2.0" };
    }
    return {
      ok: true,
      message: {
        jsonrpc: record.jsonrpc,
        id: record.id,
        method: typeof record.method === "string" ? record.method : undefined,
        params: record.params,
        result: record.result,
        error: record.error,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readAcpUpdateSessionId(message: AcpJsonRpcMessage): string | null {
  const params = asRecord(message.params);
  if (!params) {
    return null;
  }
  if (typeof params.sessionId === "string" && params.sessionId) {
    return params.sessionId;
  }
  const update = asRecord(params.update);
  if (update && typeof update.sessionId === "string" && update.sessionId) {
    return update.sessionId;
  }
  return null;
}

export function readAcpSessionUpdateBody(message: AcpJsonRpcMessage): Record<string, unknown> | null {
  const params = asRecord(message.params);
  if (!params) {
    return null;
  }
  const update = asRecord(params.update);
  if (update && typeof update.sessionUpdate === "string") {
    return update;
  }
  if (typeof params.sessionUpdate === "string") {
    return params;
  }
  return null;
}

export function extractAcpText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractAcpText(item)).join("");
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  if ("content" in record) {
    return extractAcpText(record.content);
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  return "";
}

export function acceptAcpIncrementalText(tracker: Map<string, string>, key: string, text: string): string | null {
  if (!text) {
    return null;
  }
  const previous = tracker.get(key) ?? "";
  if (text === previous) {
    return null;
  }
  if (previous && text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    tracker.set(key, text);
    return delta || null;
  }
  tracker.set(key, previous + text);
  return text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
