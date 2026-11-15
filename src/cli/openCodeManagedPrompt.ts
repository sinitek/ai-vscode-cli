import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import { randomBytes } from "crypto";
import type { RunProcess } from "./commandRunner";
import type { OpenCodeSubagentConnection } from "./openCodeSubagentMonitor";

type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("opencode-managed-invalid-response");
  return value as RecordValue;
};

/** Classic Loop compatibility for managed-server run --attach clients that exit
 * before consuming SSE. Execute ONCE through the native synchronous message API,
 * never export/search history or replay a decision. Independent Owners do not use this. */
export function runOpenCodeManagedPrompt(options: {
  connection: OpenCodeSubagentConnection;
  cwd: string;
  sessionId: string | null;
  model: string;
  variant: string | null;
  prompt: string;
  /** Effective argv built by the same CLI strategy as the stream transport. */
  args?: readonly string[];
  isCurrent: () => boolean;
  onSession: (sessionId: string) => void;
  maxBytes: number;
  timeoutMs?: number;
}, handlers: {
  onStdout: (chunk: string) => void;
  onActivity?: () => void;
  onExit: (code: number | null) => void;
  onError: (error: Error) => void;
}): RunProcess {
  let ended = false;
  let cancelled = false;
  const requests = new Set<http.ClientRequest>();
  let closeEvents = (): void => {};
  const cleanup = (): void => { closeEvents(); for (const request of requests) request.destroy(); requests.clear(); };
  const current = (): void => {
    if (ended || cancelled || !options.isCurrent()) throw new Error("opencode-managed-cancelled");
  };
  const timer = setTimeout(() => {
    finish(new Error("opencode-managed-timeout"));
  }, options.timeoutMs ?? 120000);
  const finish = (error?: Error): void => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    cleanup();
    if (error) handlers.onError(error);
    else handlers.onExit(0);
  };
  const requestJson = (method: string, pathname: string, directory: string, body?: unknown): Promise<unknown> => {
    current();
    return new Promise((resolve, reject) => {
      const url = new URL(pathname, options.connection.serverUrl);
      url.searchParams.set("directory", directory);
      const transport = url.protocol === "https:" ? https : http;
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = transport.request(url, { method, headers: {
        Accept: "application/json", "Content-Type": "application/json",
        ...(options.connection.authorization ? { Authorization: options.connection.authorization } : {}),
      } }, response => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > options.maxBytes) {
            const error = new Error("opencode-managed-response-budget");
            reject(error);
            req.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            current();
            if (response.statusCode !== 200) throw new Error(`opencode-managed-http-${response.statusCode}`);
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) { reject(error); }
        });
      });
      requests.add(req);
      req.once("close", () => requests.delete(req));
      req.on("error", reject);
      req.end(data);
    });
  };
  // Defer so the caller installs its cancellation handle before any callbacks.
  void Promise.resolve().then(async () => {
    current();
    const directory = fs.realpathSync(options.cwd);
    const selection = resolveManagedOpenCodeArgs(options.args ?? [], options.model, options.variant);
    const slash = selection.model.indexOf("/");
    if (slash <= 0 || slash === selection.model.length - 1) throw new Error("opencode-managed-invalid-model");
    const model = { providerID: selection.model.slice(0, slash), modelID: selection.model.slice(slash + 1) };
    if (selection.agent) {
      const agents = await requestJson("GET", "/agent", directory);
      if (!Array.isArray(agents) || !agents.some(agent => agent.name === selection.agent && agent.mode !== "subagent")) {
        throw new Error("opencode-managed-invalid-agent");
      }
    }
    current();
    const session = record(await requestJson(options.sessionId ? "GET" : "POST",
      options.sessionId ? `/session/${encodeURIComponent(options.sessionId)}` : "/session", directory,
      options.sessionId ? undefined : { permission: ["question", "plan_enter", "plan_exit"].map(permission => ({ permission, pattern: "*", action: "deny" })) }));
    current();
    if (typeof session.id !== "string" || !/^ses_[A-Za-z0-9]+$/u.test(session.id)
      || options.sessionId && session.id !== options.sessionId || session.directory !== directory || session.parentID) {
      throw new Error("opencode-managed-session-conflict");
    }
    options.onSession(session.id);
    current();
    const messageID = `msg_${Date.now().toString(16).padStart(12, "0")}${randomBytes(12).toString("hex")}`;
    const startedAt = Date.now();
    const messages = new Map<string, string>(); // assistant -> validated session
    const tools = new Map<string, RecordValue>();
    const children = new Map<string, { callID: string; model: RecordValue }>(); // validated current task child
    const replied = new Map<string, string>();
    let eventCount = 0, activityCount = 0;
    const trustedMessage = (info: RecordValue): boolean => {
      const expected = info.sessionID === session.id ? model : children.get(info.sessionID)?.model;
      return Boolean(expected && info.role === "assistant" && typeof info.id === "string" && info.path?.cwd === directory
        && info.modelID === expected.modelID && info.providerID === expected.providerID
        && (info.sessionID !== session.id || info.parentID === messageID));
    };
    // The stream is subscribed before submission. No DB/history lookup, reconnect,
    // or unbounded queue. Child authority requires a current task part, then a
    // cold native parent/directory check; session.created alone grants nothing.
    await new Promise<void>((resolve, reject) => {
      const url = new URL("/event", options.connection.serverUrl);
      url.searchParams.set("directory", directory);
      const transport = url.protocol === "https:" ? https : http;
      const req = transport.get(url, { headers: { Accept: "text/event-stream",
        ...(options.connection.authorization ? { Authorization: options.connection.authorization } : {}) } }, response => {
        if (response.statusCode !== 200) { reject(new Error("opencode-managed-event-http")); response.resume(); return; }
        let buffer = "", total = 0;
        let chain = Promise.resolve();
        const event = async (value: RecordValue): Promise<void> => {
          current();
          if (++eventCount > 8192) throw new Error("opencode-managed-event-budget");
          const props = value.properties ?? {};
          if (value.type === "message.updated") {
            const info = props.info;
            if (info && trustedMessage(info)) {
              if (messages.size >= 256 && !messages.has(info.id)) throw new Error("opencode-managed-message-budget");
              messages.set(info.id, info.sessionID);
            }
          }
          if (value.type === "message.part.updated") {
            const part = props.part;
            if (!part || messages.get(part.messageID) !== part.sessionID) return;
            if (part.type === "tool" && typeof part.callID === "string") {
              if (tools.size >= 512 && !tools.has(part.callID)) throw new Error("opencode-managed-tool-budget");
              const prior = tools.get(part.callID);
              if (prior && (prior.messageID !== part.messageID || prior.sessionID !== part.sessionID)) throw new Error("opencode-managed-tool-conflict");
              tools.set(part.callID, part);
              const childID = part.tool === "task" && part.state?.metadata?.sessionId;
              if (typeof childID === "string" && !children.has(childID)) {
                if (children.size >= 64) throw new Error("opencode-managed-child-budget");
                const child = record(await requestJson("GET", `/session/${encodeURIComponent(childID)}`, directory));
                current();
                if (child.id !== childID || child.parentID !== part.sessionID || child.directory !== directory
                  || !Number.isSafeInteger(child.time?.created) || child.time.created < startedAt) throw new Error("opencode-managed-child-conflict");
                const childModel = part.state.metadata.model;
                if (!childModel || typeof childModel.modelID !== "string" || typeof childModel.providerID !== "string") throw new Error("opencode-managed-child-conflict");
                children.set(childID, { callID: part.callID, model: childModel });
              }
            }
            // A real step/tool/reasoning/text update, not session creation or a
            // heartbeat, satisfies startup. Final output is delivered only once
            // after the synchronous response passes the original identity checks.
            if (["step-start", "step-finish", "tool"].includes(part.type)
              || ["text", "reasoning"].includes(part.type) && typeof part.text === "string" && part.text.trim()) {
              if (activityCount++ === 0) handlers.onActivity?.();
            }
          }
          if (value.type === "permission.asked") {
            const tool = tools.get(props.tool?.callID);
            if (!tool || tool.sessionID !== props.sessionID || tool.messageID !== props.tool?.messageID
              || messages.get(tool.messageID) !== props.sessionID || typeof props.id !== "string") return;
            if (!Array.isArray(props.patterns) || typeof props.permission !== "string") throw new Error("opencode-managed-permission-conflict");
            const identity = JSON.stringify([props.sessionID, props.tool, props.permission, props.patterns]);
            if (replied.has(props.id)) {
              if (replied.get(props.id) !== identity) throw new Error("opencode-managed-permission-conflict");
              return;
            }
            if (replied.size >= 128) throw new Error("opencode-managed-permission-budget");
            replied.set(props.id, identity);
            current();
            // Native evaluation never asks for explicitly denied operations.
            // Reply once (never always/allow), matching run --auto; keep the
            // noninteractive question/plan bans even on a resumed session.
            const reply = ["question", "plan_enter", "plan_exit"].includes(props.permission) ? "reject" : "once";
            if (await requestJson("POST", `/permission/${encodeURIComponent(props.id)}/reply`, directory, { reply }) !== true) {
              throw new Error("opencode-managed-permission-rejected");
            }
          }
        };
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (ended || cancelled) return;
          total += Buffer.byteLength(chunk);
          if (total > options.maxBytes * 4 || Buffer.byteLength(buffer) + Buffer.byteLength(chunk) > options.maxBytes) {
            finish(new Error("opencode-managed-event-budget")); return;
          }
          buffer += chunk.replace(/\r\n/gu, "\n");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            chain = chain.then(() => event(record(JSON.parse(data))));
            void chain.catch(error => finish(error));
          }
        });
        response.on("error", error => { if (!ended) finish(error); });
        response.on("end", () => { if (!ended) finish(new Error("opencode-managed-event-ended")); });
        resolve();
      });
      requests.add(req);
      req.on("error", error => { reject(error); if (!ended) finish(error); });
      req.once("close", () => requests.delete(req));
      closeEvents = () => req.destroy();
    });
    current();
    const response = record(await requestJson("POST", `/session/${encodeURIComponent(session.id)}/message`, directory, {
      messageID, model, ...(selection.variant ? { variant: selection.variant } : {}),
      ...(selection.agent ? { agent: selection.agent } : {}), parts: [{ type: "text", text: options.prompt }],
    }));
    current();
    const info = record(response.info);
    if (info.role !== "assistant" || info.sessionID !== session.id || info.parentID !== messageID
      || selection.agent && info.agent !== selection.agent
      || typeof info.id !== "string" || info.error || !info.finish || info.finish === "tool-calls"
      || info.modelID !== model.modelID || info.providerID !== model.providerID
      || info.path?.cwd !== directory || !Number.isSafeInteger(info.time?.completed) || info.time.completed < startedAt
      || !Array.isArray(response.parts) || !response.parts.length) throw new Error("opencode-managed-message-conflict");
    const ids = new Set<string>();
    const output: string[] = [];
    for (const value of response.parts) {
      const part = record(value);
      if (typeof part.id !== "string" || ids.has(part.id) || part.sessionID !== session.id || part.messageID !== info.id) {
        throw new Error("opencode-managed-part-conflict");
      }
      ids.add(part.id);
      if (part.type === "text" || part.type === "reasoning" || part.type === "step-start" || part.type === "step-finish" || part.type === "tool") {
        output.push(JSON.stringify({ type: part.type.replace(/-/gu, "_"), timestamp: info.time.completed, sessionID: session.id, part }) + "\n");
      }
    }
    if (!response.parts.some((part: RecordValue) => part.type === "text" && typeof part.text === "string" && part.text.trim())) {
      throw new Error("opencode-managed-empty-output");
    }
    const stdout = output.join("");
    if (Buffer.byteLength(stdout) > options.maxBytes) throw new Error("opencode-managed-output-budget");
    current();
    handlers.onStdout(stdout);
    finish();
  }).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
  return { kill: () => {
    if (ended) return false;
    cancelled = true;
    finish(new Error("opencode-managed-cancelled"));
    return true;
  } };
}

/** Decode already-built effective argv, rather than reimplementing CLI model /
 * variant precedence. Unsupported run modes must fail before native submission. */
export function resolveManagedOpenCodeArgs(args: readonly string[], model: string, variant: string | null): {
  model: string; variant: string | null; agent?: string;
} {
  const selected: Record<string, string> = {};
  const values = new Set(["--agent", "--model", "-m", "--variant", "--format", "--port", "--username", "-u", "--password", "-p"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (i === 0 && arg === "run" || ["--auto", "--print-logs", "--pure"].includes(arg)) continue;
    const equals = arg.indexOf("=");
    const key = equals < 0 ? arg : arg.slice(0, equals);
    if (!values.has(key)) throw new Error(`opencode-managed-unsupported-argument:${key}`);
    const value = equals < 0 ? args[++i] : arg.slice(equals + 1);
    if (!value || value.startsWith("-") || selected[key] !== undefined) throw new Error(`opencode-managed-invalid-argument:${key}`);
    selected[key] = value;
  }
  if (selected["--format"] && selected["--format"] !== "json") throw new Error("opencode-managed-unsupported-format");
  if (selected["--model"] && selected["-m"]) throw new Error("opencode-managed-ambiguous-model");
  return { model: selected["--model"] ?? selected["-m"] ?? model, variant: selected["--variant"] ?? variant,
    ...(selected["--agent"] ? { agent: selected["--agent"] } : {}) };
}
