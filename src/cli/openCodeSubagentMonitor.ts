import * as http from "http";
import * as https from "https";
import * as net from "net";
import type { SubagentProgressStatus, SubagentProgressUpdate } from "../subagentProgress";

export const OPENCODE_SUBAGENT_POLL_INTERVAL_MS = 60 * 1000;
const OPENCODE_SUBAGENT_REQUEST_TIMEOUT_MS = 10 * 1000;
const OPENCODE_SUBAGENT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const OPENCODE_SUBAGENT_SSE_RECONNECT_MS = 1000;
const OPENCODE_SUBAGENT_EVENT_REFRESH_DELAY_MS = 100;

type UnknownRecord = Record<string, unknown>;

type OpenCodeChildSession = {
  id: string;
  parentId: string;
  agentName: string;
  createdAt: number | null;
};

export type OpenCodeSubagentMessageSnapshot = {
  text: string;
  hasCompletedAssistantMessage: boolean;
};

type OpenCodeSubagentState = OpenCodeChildSession & {
  text: string;
  status: SubagentProgressStatus;
  error: string;
};

type Disposable = {
  dispose: () => void;
};

type MonitorScheduler = {
  setInterval: (callback: () => void, delayMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type OpenCodeEventSubscriber = (options: {
  serverUrl: string;
  directory: string;
  authorization?: string;
  onEvent: (event: unknown) => void;
  onError: (error: Error) => void;
}) => Disposable;

export type OpenCodeSubagentMonitor = {
  setParentSessionId: (sessionId: string | null | undefined) => void;
  pollNow: () => Promise<void>;
  finish: (status: Exclude<SubagentProgressStatus, "running">) => void;
  dispose: () => void;
};

export type OpenCodeSubagentConnection = {
  serverUrl: string;
  serverPort?: number;
  authorization?: string;
};

const DEFAULT_SCHEDULER: MonitorScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readArgValue(args: readonly string[], names: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    for (const name of names) {
      if (arg === name) {
        return normalizeString(args[index + 1]);
      }
      if (arg.startsWith(`${name}=`)) {
        return normalizeString(arg.slice(name.length + 1));
      }
    }
  }
  return "";
}

export function reserveOpenCodeServerPort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("OpenCode monitor could not reserve a local port."));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function resolveOpenCodeSubagentConnection(
  args: readonly string[],
  options: {
    reservePort?: () => Promise<number>;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<OpenCodeSubagentConnection> {
  const attachUrl = readArgValue(args, ["--attach"]);
  const username = readArgValue(args, ["--username", "-u"])
    || options.env?.OPENCODE_SERVER_USERNAME
    || process.env.OPENCODE_SERVER_USERNAME
    || "opencode";
  const password = readArgValue(args, ["--password", "-p"])
    || options.env?.OPENCODE_SERVER_PASSWORD
    || process.env.OPENCODE_SERVER_PASSWORD
    || "";
  const authorization = password
    ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
    : undefined;
  if (attachUrl) {
    return { serverUrl: attachUrl.replace(/\/+$/u, ""), authorization };
  }

  const configuredPort = Number(readArgValue(args, ["--port"]));
  if (Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535) {
    return {
      serverUrl: `http://127.0.0.1:${configuredPort}`,
      authorization,
    };
  }

  const port = await (options.reservePort ?? reserveOpenCodeServerPort)();
  return {
    serverUrl: `http://127.0.0.1:${port}`,
    serverPort: port,
    authorization,
  };
}

export function parseOpenCodeChildSessions(value: unknown, parentSessionId: string): OpenCodeChildSession[] {
  const normalizedParentId = normalizeString(parentSessionId);
  if (!normalizedParentId || !Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = toRecord(item);
    const id = normalizeString(record?.id);
    const parentId = normalizeString(record?.parentID ?? record?.parent_id);
    if (!id || parentId !== normalizedParentId) {
      return [];
    }
    const time = toRecord(record?.time);
    return [{
      id,
      parentId,
      agentName: normalizeString(record?.agent),
      createdAt: typeof time?.created === "number" ? time.created : null,
    }];
  });
}

export function extractOpenCodeSubagentMessageSnapshot(value: unknown): OpenCodeSubagentMessageSnapshot {
  if (!Array.isArray(value)) {
    return { text: "", hasCompletedAssistantMessage: false };
  }
  const textParts: string[] = [];
  let hasCompletedAssistantMessage = false;
  for (const item of value) {
    const message = toRecord(item);
    const info = toRecord(message?.info);
    if (normalizeString(info?.role) !== "assistant") {
      continue;
    }
    const time = toRecord(info?.time);
    hasCompletedAssistantMessage = typeof time?.completed === "number";
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (const rawPart of parts) {
      const part = toRecord(rawPart);
      if (normalizeString(part?.type) !== "text" || typeof part?.text !== "string") {
        continue;
      }
      const text = part.text.trim();
      if (text) {
        textParts.push(text);
      }
    }
  }
  return {
    text: textParts.join("\n\n"),
    hasCompletedAssistantMessage,
  };
}

export function consumeOpenCodeSseChunk(
  previousBuffer: string,
  chunk: string,
): { buffer: string; events: unknown[] } {
  const normalized = `${previousBuffer}${chunk}`.replace(/\r\n/gu, "\n");
  const blocks = normalized.split("\n\n");
  const buffer = blocks.pop() ?? "";
  const events: unknown[] = [];
  for (const block of blocks) {
    const payload = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!payload) {
      continue;
    }
    try {
      events.push(JSON.parse(payload));
    } catch {
      // Ignore malformed event frames; the periodic snapshot poll remains authoritative.
    }
  }
  return { buffer, events };
}

function buildOpenCodeApiUrl(serverUrl: string, pathname: string, directory: string): URL {
  const url = new URL(pathname, `${serverUrl.replace(/\/+$/u, "")}/`);
  url.searchParams.set("directory", directory);
  return url;
}

function requestOpenCodeJson(options: {
  serverUrl: string;
  pathname: string;
  directory: string;
  authorization?: string;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = buildOpenCodeApiUrl(options.serverUrl, options.pathname, options.directory);
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, {
      headers: options.authorization ? { Authorization: options.authorization } : undefined,
    }, (response) => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`OpenCode monitor request failed with HTTP ${response.statusCode ?? "unknown"}.`));
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => {
        body += chunk;
        if (Buffer.byteLength(body, "utf8") > OPENCODE_SUBAGENT_MAX_RESPONSE_BYTES) {
          request.destroy(new Error("OpenCode monitor response exceeded the size limit."));
        }
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    request.setTimeout(OPENCODE_SUBAGENT_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("OpenCode monitor request timed out."));
    });
    request.once("error", reject);
  });
}

function subscribeOpenCodeEvents(options: {
  serverUrl: string;
  directory: string;
  authorization?: string;
  onEvent: (event: unknown) => void;
  onError: (error: Error) => void;
}): Disposable {
  const url = buildOpenCodeApiUrl(options.serverUrl, "/event", options.directory);
  const client = url.protocol === "https:" ? https : http;
  let disposed = false;
  let buffer = "";
  const request = client.get(url, {
    headers: {
      Accept: "text/event-stream",
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
  }, (response) => {
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      options.onError(new Error(`OpenCode event stream failed with HTTP ${response.statusCode ?? "unknown"}.`));
      return;
    }
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      if (disposed) {
        return;
      }
      const result = consumeOpenCodeSseChunk(buffer, chunk);
      buffer = result.buffer;
      result.events.forEach(options.onEvent);
    });
    response.once("error", (error) => {
      if (!disposed) {
        options.onError(error);
      }
    });
    response.once("end", () => {
      if (!disposed) {
        options.onError(new Error("OpenCode event stream ended."));
      }
    });
  });
  request.once("error", (error) => {
    if (!disposed) {
      options.onError(error);
    }
  });
  return {
    dispose: () => {
      disposed = true;
      request.destroy();
    },
  };
}

function mapOpenCodeSessionStatus(value: unknown): SubagentProgressStatus | null {
  const type = normalizeString(toRecord(value)?.type);
  if (type === "busy" || type === "retry") {
    return "running";
  }
  if (type === "idle") {
    return "completed";
  }
  return null;
}

function extractOpenCodeEventSessionId(event: UnknownRecord): string {
  const payload = toRecord(event.properties) ?? toRecord(event.data) ?? {};
  const part = toRecord(payload.part);
  const info = toRecord(payload.info);
  return normalizeString(
    payload.sessionID
    ?? payload.sessionId
    ?? part?.sessionID
    ?? part?.sessionId
    ?? info?.id,
  );
}

function extractOpenCodeErrorMessage(value: unknown): string {
  const error = toRecord(value);
  const data = toRecord(error?.data);
  return normalizeString(error?.message ?? data?.message ?? error?.name);
}

export function createOpenCodeSubagentMonitor(options: {
  connection: OpenCodeSubagentConnection;
  directory: string;
  onUpdate: (update: SubagentProgressUpdate) => void;
  onNoChildren?: () => void;
  onError?: (error: Error) => void;
  intervalMs?: number;
  scheduler?: MonitorScheduler;
  requestJson?: (pathname: string) => Promise<unknown>;
  subscribeEvents?: OpenCodeEventSubscriber;
}): OpenCodeSubagentMonitor {
  const scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  const intervalMs = options.intervalMs ?? OPENCODE_SUBAGENT_POLL_INTERVAL_MS;
  const states = new Map<string, OpenCodeSubagentState>();
  const refreshTimers = new Map<string, unknown>();
  const refreshGenerations = new Map<string, number>();
  let parentSessionId = "";
  let intervalHandle: unknown = null;
  let reconnectHandle: unknown = null;
  let eventSubscription: Disposable | null = null;
  let pollPromise: Promise<void> | null = null;
  let disposed = false;
  let noChildrenNotified = false;
  const minimumChildCreatedAt = Date.now() - 5000;

  const isCurrentAttemptChild = (child: OpenCodeChildSession): boolean => (
    child.createdAt === null || child.createdAt >= minimumChildCreatedAt
  );

  const requestJson = options.requestJson ?? ((pathname: string) => requestOpenCodeJson({
    serverUrl: options.connection.serverUrl,
    pathname,
    directory: options.directory,
    authorization: options.connection.authorization,
  }));

  const emitState = (state: OpenCodeSubagentState): void => {
    options.onUpdate({
      provider: "opencode",
      id: state.id,
      agentName: state.agentName,
      status: state.status,
      text: state.text,
      error: state.error,
    });
  };

  const ensureChildState = (child: OpenCodeChildSession): OpenCodeSubagentState => {
    const existing = states.get(child.id);
    if (existing) {
      if (child.agentName) {
        existing.agentName = child.agentName;
      }
      return existing;
    }
    const state: OpenCodeSubagentState = {
      ...child,
      text: "",
      status: "running",
      error: "",
    };
    states.set(child.id, state);
    emitState(state);
    return state;
  };

  const refreshChild = async (
    child: OpenCodeChildSession,
    rawStatus?: unknown,
    inferCompletion = false,
  ): Promise<void> => {
    if (disposed) {
      return;
    }
    const state = ensureChildState(child);
    const generation = (refreshGenerations.get(child.id) ?? 0) + 1;
    refreshGenerations.set(child.id, generation);
    const rawMessages = await requestJson(`/session/${encodeURIComponent(child.id)}/message`);
    if (disposed || refreshGenerations.get(child.id) !== generation) {
      return;
    }
    const snapshot = extractOpenCodeSubagentMessageSnapshot(rawMessages);
    const apiStatus = mapOpenCodeSessionStatus(rawStatus);
    state.text = snapshot.text;
    state.status = apiStatus
      ?? (inferCompletion && snapshot.hasCompletedAssistantMessage ? "completed" : state.status);
    emitState(state);
  };

  const runPoll = async (notifyWhenEmpty: boolean): Promise<void> => {
    if (disposed || !parentSessionId) {
      return;
    }
    const [rawChildren, rawStatuses] = await Promise.all([
      requestJson(`/session/${encodeURIComponent(parentSessionId)}/children`),
      requestJson("/session/status"),
    ]);
    if (disposed) {
      return;
    }
    const children = parseOpenCodeChildSessions(rawChildren, parentSessionId).filter(isCurrentAttemptChild);
    if (children.length === 0 && notifyWhenEmpty && !noChildrenNotified) {
      noChildrenNotified = true;
      options.onNoChildren?.();
    }
    const statuses = toRecord(rawStatuses) ?? {};
    await Promise.all(children.map((child) => refreshChild(child, statuses[child.id], true)));
  };

  const poll = (notifyWhenEmpty: boolean): Promise<void> => {
    if (pollPromise) {
      return pollPromise;
    }
    pollPromise = runPoll(notifyWhenEmpty)
      .catch((error) => {
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        pollPromise = null;
      });
    return pollPromise;
  };

  const scheduleChildRefresh = (sessionId: string): void => {
    if (disposed || refreshTimers.has(sessionId)) {
      return;
    }
    const handle = scheduler.setTimeout(() => {
      refreshTimers.delete(sessionId);
      const state = states.get(sessionId);
      if (!state) {
        void poll(false);
        return;
      }
      void refreshChild(state).catch((error) => {
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    }, OPENCODE_SUBAGENT_EVENT_REFRESH_DELAY_MS);
    refreshTimers.set(sessionId, handle);
  };

  const handleEvent = (rawEvent: unknown): void => {
    const event = toRecord(rawEvent);
    const eventType = normalizeString(event?.type);
    const payload = toRecord(event?.properties) ?? toRecord(event?.data) ?? {};
    if (!event || !eventType) {
      return;
    }
    if (eventType === "session.created" || eventType === "session.updated") {
      const info = toRecord(payload.info);
      const child = parseOpenCodeChildSessions([info], parentSessionId)[0];
      if (child && isCurrentAttemptChild(child)) {
        ensureChildState(child);
        scheduleChildRefresh(child.id);
      }
      return;
    }
    const sessionId = extractOpenCodeEventSessionId(event);
    if (!sessionId) {
      return;
    }
    const state = states.get(sessionId);
    if (eventType === "session.error" && state) {
      state.status = "failed";
      state.error = extractOpenCodeErrorMessage(payload.error);
      emitState(state);
      return;
    }
    if ((eventType === "session.idle" || eventType === "session.status") && state) {
      const status = eventType === "session.idle"
        ? "completed"
        : mapOpenCodeSessionStatus(payload.status);
      if (status) {
        state.status = status;
        emitState(state);
      }
    }
    if (state && ["message.part.updated", "session.idle", "session.status"].includes(eventType)) {
      scheduleChildRefresh(sessionId);
    }
  };

  const startEventSubscription = (): void => {
    if (disposed || !parentSessionId || eventSubscription) {
      return;
    }
    eventSubscription = (options.subscribeEvents ?? subscribeOpenCodeEvents)({
      serverUrl: options.connection.serverUrl,
      directory: options.directory,
      authorization: options.connection.authorization,
      onEvent: handleEvent,
      onError: (error) => {
        eventSubscription?.dispose();
        eventSubscription = null;
        options.onError?.(error);
        if (!disposed && reconnectHandle === null) {
          reconnectHandle = scheduler.setTimeout(() => {
            reconnectHandle = null;
            startEventSubscription();
          }, OPENCODE_SUBAGENT_SSE_RECONNECT_MS);
        }
      },
    });
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (intervalHandle !== null) {
      scheduler.clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (reconnectHandle !== null) {
      scheduler.clearTimeout(reconnectHandle);
      reconnectHandle = null;
    }
    for (const handle of refreshTimers.values()) {
      scheduler.clearTimeout(handle);
    }
    refreshTimers.clear();
    refreshGenerations.clear();
    eventSubscription?.dispose();
    eventSubscription = null;
  };

  return {
    setParentSessionId: (sessionId) => {
      const normalized = normalizeString(sessionId);
      if (disposed || !normalized || normalized === parentSessionId) {
        return;
      }
      parentSessionId = normalized;
      if (intervalHandle === null) {
        intervalHandle = scheduler.setInterval(() => {
          void poll(true);
        }, intervalMs);
      }
      startEventSubscription();
      void poll(false);
    },
    pollNow: () => poll(false),
    finish: (status) => {
      for (const state of states.values()) {
        if (state.status === "running") {
          state.status = status;
          emitState(state);
        }
      }
      dispose();
    },
    dispose,
  };
}
