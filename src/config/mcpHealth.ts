import { spawn } from "cross-spawn";
import { ConfigPlatform, McpHealthItem, McpMarketplaceItem } from "./types";
import type {
  CodexInstalledMcpServer,
  CodexMcpTransportConfig,
  CodexMcpTransportHttpConfig,
  CodexMcpTransportStdioConfig,
  McpProbeResult,
  SimpleFetch,
  SimpleFetchResponse,
} from "./mcpService";

const CODEX_MCP_HEALTH_CONNECT_TIMEOUT_MS = 15000;
const CODEX_MCP_HEALTH_REQUEST_TIMEOUT_MS = 15000;

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item === "string")
    .map(([key, item]) => [key, item as string]);

  return Object.fromEntries(entries);
}

function resolveServerTimeoutMs(timeoutSec: number | undefined, fallbackMs: number): number {
  if (!timeoutSec || timeoutSec <= 0) {
    return fallbackMs;
  }

  return Math.floor(timeoutSec * 1000);
}

function buildRpcPacket(id: number, method: string, params: Record<string, unknown>): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params,
  })}\n`;
}

function extractToolCount(result: unknown): number {
  if (!result || typeof result !== "object") {
    return 0;
  }

  const tools = (result as { tools?: unknown }).tools;
  return Array.isArray(tools) ? tools.length : 0;
}

export function parseInstalledCodexMcpTransport(raw: unknown): CodexMcpTransportConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const transportType = typeof record.type === "string" ? record.type : "";

  if (transportType === "stdio") {
    const command = typeof record.command === "string" ? record.command : "";
    if (!command) {
      return null;
    }

    return {
      type: "stdio",
      command,
      args: readStringArray(record.args),
      env: readStringMap(record.env),
      envVars: readStringArray(record.env_vars ?? record.envVars),
      cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    };
  }

  if (transportType === "http" || transportType === "streamable_http") {
    const url =
      (typeof record.url === "string" && record.url)
      || (typeof record.commandOrUrl === "string" && record.commandOrUrl)
      || "";
    if (!url) {
      return null;
    }

    const bearerTokenEnvVar =
      typeof record.bearer_token_env_var === "string"
        ? record.bearer_token_env_var
        : typeof record.bearerTokenEnvVar === "string"
          ? record.bearerTokenEnvVar
          : undefined;

    return {
      type: "http",
      protocol: transportType === "streamable_http" ? "streamable_http" : "http",
      url,
      headers: readStringMap(record.headers),
      bearerTokenEnvVar,
    };
  }

  return null;
}

export function parseInstalledCodexMcpServer(raw: unknown): CodexInstalledMcpServer | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const serverId = typeof record.name === "string" ? record.name.trim() : "";
  if (!serverId) {
    return undefined;
  }

  return {
    serverId,
    enabled: record.enabled !== false,
    disabledReason:
      typeof record.disabled_reason === "string"
        ? record.disabled_reason
        : typeof record.disabledReason === "string"
          ? record.disabledReason
          : undefined,
    startupTimeoutSec: readPositiveNumber(record.startup_timeout_sec ?? record.startupTimeoutSec),
    toolTimeoutSec: readPositiveNumber(record.tool_timeout_sec ?? record.toolTimeoutSec),
    transport: parseInstalledCodexMcpTransport(record.transport),
  };
}

function buildCodexMcpProbeEnv(
  transport: CodexMcpTransportStdioConfig,
  envValues: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envValues,
    ...transport.env,
  };

  for (const envName of transport.envVars) {
    const value = transport.env[envName] ?? envValues[envName] ?? process.env[envName] ?? "";
    if (value) {
      env[envName] = value;
    }
  }

  return env;
}

async function parseRpcPayloadFromHttpResponse(
  response: SimpleFetchResponse,
): Promise<{ error?: unknown; result?: unknown } | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();
  if (!responseText.trim()) {
    return undefined;
  }

  if (contentType.includes("text/event-stream")) {
    const dataLines = responseText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter((line) => line.length > 0);

    const lastData = dataLines[dataLines.length - 1];
    if (!lastData) {
      return undefined;
    }

    return JSON.parse(lastData) as { error?: unknown; result?: unknown };
  }

  return JSON.parse(responseText) as { error?: unknown; result?: unknown };
}

async function probeHttpCodexMcpServer(
  server: CodexInstalledMcpServer,
  transport: CodexMcpTransportHttpConfig,
  envValues: Record<string, string>,
): Promise<McpProbeResult> {
  const startedAt = Date.now();
  const timeoutMs = resolveServerTimeoutMs(
    server.toolTimeoutSec,
    CODEX_MCP_HEALTH_REQUEST_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchFn = globalThis.fetch as unknown as SimpleFetch | undefined;

  if (!fetchFn) {
    clearTimeout(timer);
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      details: "当前运行环境不支持 HTTP 健康检测",
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...transport.headers,
  };

  if (transport.protocol === "streamable_http") {
    headers.Accept = headers.Accept ?? "application/json, text/event-stream";
  }

  if (transport.bearerTokenEnvVar && !headers.Authorization) {
    const token = envValues[transport.bearerTokenEnvVar] ?? process.env[transport.bearerTokenEnvVar] ?? "";
    if (!token) {
      clearTimeout(timer);
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: `缺少鉴权环境变量：${transport.bearerTokenEnvVar}`,
      };
    }
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const initializeResponse = await fetchFn(transport.url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          clientInfo: {
            name: "sinitek-cli-tools",
            version: "0.4.2",
          },
        },
      }),
    });

    if (!initializeResponse.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: `初始化请求失败：HTTP ${initializeResponse.status}`,
      };
    }

    const initializePayload = await parseRpcPayloadFromHttpResponse(initializeResponse);
    if (initializePayload?.error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "初始化 RPC 返回错误",
      };
    }

    const requestHeaders = { ...headers };
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    if (sessionId) {
      requestHeaders["mcp-session-id"] = sessionId;
    }

    const toolsResponse = await fetchFn(transport.url, {
      method: "POST",
      signal: controller.signal,
      headers: requestHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    if (!toolsResponse.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: `工具列表请求失败：HTTP ${toolsResponse.status}`,
      };
    }

    const toolsPayload = await parseRpcPayloadFromHttpResponse(toolsResponse);
    if (toolsPayload?.error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "tools/list RPC 返回错误",
      };
    }

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      details: `握手成功，tools=${extractToolCount(toolsPayload?.result)}`,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeStdioCodexMcpServer(
  server: CodexInstalledMcpServer,
  transport: CodexMcpTransportStdioConfig,
  envValues: Record<string, string>,
): Promise<McpProbeResult> {
  const startedAt = Date.now();
  const startupTimeoutMs = resolveServerTimeoutMs(
    server.startupTimeoutSec,
    CODEX_MCP_HEALTH_CONNECT_TIMEOUT_MS,
  );
  const requestTimeoutMs = resolveServerTimeoutMs(
    server.toolTimeoutSec,
    CODEX_MCP_HEALTH_REQUEST_TIMEOUT_MS,
  );
  const timeoutMs = Math.max(startupTimeoutMs, requestTimeoutMs);

  return new Promise((resolve) => {
    const child = spawn(transport.command, transport.args, {
      env: buildCodexMcpProbeEnv(transport, envValues),
      cwd: transport.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const responses = new Map<number, { result?: unknown; error?: unknown }>();
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;

    const settle = (result: McpProbeResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      settle({
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "健康检查超时",
      });
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.stdin?.on("error", () => undefined);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) {
          continue;
        }

        try {
          const parsed = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: unknown };
          if (typeof parsed.id === "number") {
            responses.set(parsed.id, parsed);
          }
        } catch {
          // ignore non-rpc lines
        }
      }

      if (responses.has(1) && responses.has(2)) {
        const initialize = responses.get(1);
        const toolList = responses.get(2);

        if (initialize?.error || toolList?.error) {
          settle({
            ok: false,
            latencyMs: Date.now() - startedAt,
            details: "initialize/tools 返回错误",
          });
          return;
        }

        settle({
          ok: true,
          latencyMs: Date.now() - startedAt,
          details: `握手成功，tools=${extractToolCount(toolList?.result)}`,
        });
      }
    });

    child.on("error", (error) => {
      settle({
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: error.message,
      });
    });

    child.on("close", (code) => {
      if (settled || (responses.has(1) && responses.has(2))) {
        return;
      }

      const stderrText = stderr.trim();
      const stderrPreview = stderrText.length > 240 ? `${stderrText.slice(0, 240)}...` : stderrText;
      settle({
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: `握手前退出：exit_${String(code)}${stderrPreview ? `:${stderrPreview}` : ""}`,
      });
    });

    child.stdin?.write(
      buildRpcPacket(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        clientInfo: {
          name: "sinitek-cli-tools",
          version: "0.4.2",
        },
      }),
    );
    child.stdin?.write(buildRpcPacket(2, "tools/list", {}));
  });
}

export async function probeInstalledCodexMcpServer(
  server: CodexInstalledMcpServer,
  envValues: Record<string, string>,
): Promise<McpProbeResult> {
  if (!server.transport) {
    return {
      ok: false,
      latencyMs: 0,
      details: "MCP transport 配置缺失",
    };
  }

  if (server.transport.type === "http") {
    return probeHttpCodexMcpServer(server, server.transport, envValues);
  }

  return probeStdioCodexMcpServer(server, server.transport, envValues);
}

type ListedMcpHealthItem = Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">;

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseConnectedStatus(value: string): { status: McpHealthItem["status"]; details: string } {
  const normalized = value.replace(/[✓✗]/g, "").trim();
  if (/connected/i.test(normalized)) {
    return { status: "healthy", details: normalized || "Connected" };
  }
  if (/failed|disconnected|error|timeout/i.test(normalized)) {
    return { status: "unhealthy", details: normalized || "Failed to connect" };
  }
  return { status: "unknown", details: normalized || "状态未知" };
}

export function parseClaudeMcpHealthOutput(rawContent: string): Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">> {
  const result = new Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">>();
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (!line.includes(":")) {
      continue;
    }
    const parts = line.split(" - ");
    const statusPart = parts[parts.length - 1]?.trim() || "";
    const namePart = parts[0] || "";
    const separatorIndex = namePart.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const serverId = namePart.slice(0, separatorIndex).trim();
    if (!serverId) {
      continue;
    }
    const parsedStatus = parseConnectedStatus(statusPart);
    result.set(serverId, {
      enabled: !/disabled/i.test(statusPart),
      status: parsedStatus.status,
      details: parsedStatus.details,
      latencyMs: undefined,
    });
  }

  return result;
}

export function parseGeminiMcpHealthOutput(rawContent: string): Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">> {
  const result = new Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">>();
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (!line.includes(":") || !/^[✓✗]/.test(line)) {
      continue;
    }
    const normalizedLine = line.replace(/^[✓✗]\s*/, "");
    const separatorIndex = normalizedLine.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const serverId = normalizedLine.slice(0, separatorIndex).trim();
    const statusPart = normalizedLine.includes(" - ")
      ? normalizedLine.slice(normalizedLine.lastIndexOf(" - ") + 3).trim()
      : "";
    if (!serverId) {
      continue;
    }
    const parsedStatus = parseConnectedStatus(statusPart);
    result.set(serverId, {
      enabled: !/disabled/i.test(statusPart),
      status: parsedStatus.status,
      details: parsedStatus.details,
      latencyMs: undefined,
    });
  }

  return result;
}

const OPEN_CODE_MCP_ENTRY_PATTERN = /^[●○]\s*(?:([✓✔✗✘×!?])\s*)?(.+?)\s+(connected|failed|disabled|unknown)\b(.*)$/i;

function parseOpenCodeMcpDetailLine(rawLine: string): string | null {
  const hasTreePrefix = /^\s*[│┃]/.test(rawLine);
  if (!hasTreePrefix && !/^\s+/.test(rawLine)) {
    return null;
  }

  const normalized = hasTreePrefix
    ? rawLine.replace(/^\s*[│┃]\s*/, "").trim()
    : rawLine.trim();
  return normalized || null;
}

export function parseOpenCodeMcpHealthOutput(rawContent: string): Map<string, ListedMcpHealthItem> {
  const result = new Map<string, ListedMcpHealthItem>();
  let currentEntry: {
    serverId: string;
    statusText: string;
    detailLines: string[];
  } | null = null;

  const flushCurrentEntry = (): void => {
    if (!currentEntry) {
      return;
    }

    const parsedStatus = parseConnectedStatus(currentEntry.statusText);
    result.set(currentEntry.serverId, {
      enabled: !/\bdisabled\b/i.test(currentEntry.statusText),
      status: parsedStatus.status,
      details: [parsedStatus.details, ...currentEntry.detailLines].join("\n"),
      latencyMs: undefined,
    });
    currentEntry = null;
  };

  for (const rawLine of rawContent.split(/\r?\n/)) {
    const line = stripAnsi(rawLine);
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    const entryMatch = trimmedLine.match(OPEN_CODE_MCP_ENTRY_PATTERN);
    if (entryMatch) {
      flushCurrentEntry();
      const serverId = entryMatch[2]?.trim() || "";
      if (!serverId) {
        continue;
      }
      const statusName = entryMatch[3]?.trim() || "unknown";
      const statusSummary = entryMatch[4]?.trim().replace(/^[-:]\s*/, "") || "";
      currentEntry = {
        serverId,
        statusText: statusSummary ? `${statusName}: ${statusSummary}` : statusName,
        detailLines: [],
      };
      continue;
    }

    if (/^[┌└├┤┬┴]/.test(trimmedLine)) {
      if (/^└/.test(trimmedLine)) {
        flushCurrentEntry();
      }
      continue;
    }

    if (!currentEntry) {
      continue;
    }
    const detailLine = parseOpenCodeMcpDetailLine(line);
    if (detailLine) {
      currentEntry.detailLines.push(detailLine);
    }
  }

  flushCurrentEntry();
  return result;
}

export function mapCliListedMcpHealth(
  platform: Extract<ConfigPlatform, "claude" | "opencode">,
  marketplace: ReadonlyArray<Pick<McpMarketplaceItem, "id">>,
  listedById: ReadonlyMap<string, ListedMcpHealthItem>,
  checkedAt: string,
): McpHealthItem[] {
  return marketplace.map((item) => {
    const listed = listedById.get(item.id);
    if (!listed) {
      return {
        platform,
        serverId: item.id,
        installed: false,
        enabled: false,
        status: "unknown",
        checkedAt,
        details: "未安装",
      } satisfies McpHealthItem;
    }

    return {
      platform,
      serverId: item.id,
      installed: true,
      enabled: listed.enabled,
      status: listed.status,
      checkedAt,
      details: listed.details,
      latencyMs: listed.latencyMs,
    } satisfies McpHealthItem;
  });
}
