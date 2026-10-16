import { spawn, type ChildProcess } from "child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import * as path from "path";
import { killProcessTree } from "./codexRunnerProcess";

const DEFAULT_OUTPUT_BYTE_LIMIT = 1024 * 1024;

export class GrokAcpClientError extends Error {
  public constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = "GrokAcpClientError";
  }
}

type LiveTerminal = {
  id: string;
  child: ChildProcess;
  chunks: Buffer[];
  storedBytes: number;
  truncated: boolean;
  byteLimit: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  exited: Promise<void>;
  released: boolean;
};

type PermissionOption = {
  optionId: string;
  kind: string;
};

export class GrokAcpClient {
  private nextTerminalId = 1;
  private readonly terminals = new Map<string, LiveTerminal>();

  public constructor(private readonly cwd: string) {}

  public async handle(method: string, params: unknown, sessionId: string | null): Promise<unknown> {
    switch (method) {
      case "terminal/create":
        return this.createTerminal(params, sessionId);
      case "terminal/output":
        return this.readTerminalOutput(params, sessionId);
      case "terminal/wait_for_exit":
        return this.waitForTerminalExit(params, sessionId);
      case "terminal/kill":
        return this.killTerminal(params, sessionId);
      case "terminal/release":
        return this.releaseTerminal(params, sessionId);
      case "fs/read_text_file":
        return this.readTextFile(params, sessionId);
      case "fs/write_text_file":
        return this.writeTextFile(params, sessionId);
      case "session/request_permission":
        return this.requestPermission(params, sessionId);
      default:
        throw new GrokAcpClientError(`Method not found: ${method}`, -32601);
    }
  }

  public killAll(): void {
    for (const terminal of this.terminals.values()) {
      this.stopTerminal(terminal);
    }
  }

  public dispose(): void {
    this.killAll();
    this.terminals.clear();
  }

  private createTerminal(params: unknown, sessionId: string | null): { terminalId: string } {
    const record = requireRecord(params);
    requireSession(record, sessionId);
    const command = requireString(record.command, "command");
    const args = readStringArray(record.args);
    const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd : this.cwd;
    const byteLimit = readByteLimit(record.outputByteLimit);
    const id = `term-${this.nextTerminalId}`;
    this.nextTerminalId += 1;
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        env: buildTerminalEnv(record.env),
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new GrokAcpClientError(error instanceof Error ? error.message : String(error), -32603);
    }
    const terminal: LiveTerminal = {
      id,
      child,
      chunks: [],
      storedBytes: 0,
      truncated: false,
      byteLimit,
      exitCode: null,
      signal: null,
      exited: Promise.resolve(),
      released: false,
    };
    terminal.exited = new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      child.stdout?.on("data", (chunk: Buffer | string) => this.appendOutput(terminal, chunk));
      child.stderr?.on("data", (chunk: Buffer | string) => this.appendOutput(terminal, chunk));
      child.once("error", (error: Error) => {
        this.appendOutput(terminal, error.message);
        if (terminal.exitCode === null) {
          terminal.exitCode = 127;
        }
        finish();
      });
      child.once("close", (code, signal) => {
        terminal.exitCode = typeof code === "number" ? code : terminal.exitCode;
        terminal.signal = signal;
        finish();
      });
    });
    this.terminals.set(id, terminal);
    return { terminalId: id };
  }

  private async readTerminalOutput(params: unknown, sessionId: string | null): Promise<Record<string, unknown>> {
    const terminal = this.requireTerminal(params, sessionId);
    const response: Record<string, unknown> = {
      output: Buffer.concat(terminal.chunks).toString("utf8"),
      truncated: terminal.truncated,
    };
    if (terminal.exitCode !== null || terminal.signal) {
      response.exitStatus = exitStatus(terminal);
    }
    return response;
  }

  private async waitForTerminalExit(params: unknown, sessionId: string | null): Promise<Record<string, unknown>> {
    const terminal = this.requireTerminal(params, sessionId);
    await terminal.exited;
    return exitStatus(terminal);
  }

  private killTerminal(params: unknown, sessionId: string | null): Record<string, never> {
    this.stopTerminal(this.requireTerminal(params, sessionId));
    return {};
  }

  private releaseTerminal(params: unknown, sessionId: string | null): Record<string, never> {
    const terminal = this.requireTerminal(params, sessionId);
    terminal.released = true;
    this.stopTerminal(terminal);
    this.terminals.delete(terminal.id);
    return {};
  }

  private async readTextFile(params: unknown, sessionId: string | null): Promise<{ content: string }> {
    const record = requireRecord(params);
    requireSession(record, sessionId);
    const filePath = this.resolvePath(requireString(record.path, "path"));
    const raw = await readFile(filePath, "utf8");
    return { content: sliceTextLines(raw, record.line, record.limit) };
  }

  private async writeTextFile(params: unknown, sessionId: string | null): Promise<Record<string, never>> {
    const record = requireRecord(params);
    requireSession(record, sessionId);
    const filePath = this.resolvePath(requireString(record.path, "path"));
    const content = typeof record.content === "string" ? record.content : "";
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    return {};
  }

  private requestPermission(params: unknown, sessionId: string | null): { outcome: Record<string, string> } {
    const record = requireRecord(params);
    requireSession(record, sessionId);
    const optionId = selectAllowOption(record.options);
    if (!optionId) {
      return { outcome: { outcome: "cancelled" } };
    }
    return { outcome: { outcome: "selected", optionId } };
  }

  private requireTerminal(params: unknown, sessionId: string | null): LiveTerminal {
    const record = requireRecord(params);
    requireSession(record, sessionId);
    const terminalId = requireString(record.terminalId, "terminalId");
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.released) {
      throw new GrokAcpClientError(`Unknown terminal: ${terminalId}`, -32602);
    }
    return terminal;
  }

  private resolvePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(this.cwd, filePath);
  }

  private appendOutput(terminal: LiveTerminal, chunk: Buffer | string): void {
    if (terminal.truncated || terminal.storedBytes >= terminal.byteLimit) {
      terminal.truncated = true;
      return;
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = terminal.byteLimit - terminal.storedBytes;
    if (buffer.length > remaining) {
      terminal.chunks.push(buffer.subarray(0, remaining));
      terminal.storedBytes += remaining;
      terminal.truncated = true;
      return;
    }
    terminal.chunks.push(buffer);
    terminal.storedBytes += buffer.length;
  }

  private stopTerminal(terminal: LiveTerminal): void {
    if (terminal.exitCode !== null || terminal.signal) {
      return;
    }
    killProcessTree(terminal.child, "SIGTERM");
  }
}

function exitStatus(terminal: LiveTerminal): { exitCode: number | null; signal: string | null } {
  return {
    exitCode: terminal.exitCode,
    signal: terminal.signal,
  };
}

function requireRecord(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new GrokAcpClientError("Invalid params", -32602);
  }
  return params as Record<string, unknown>;
}

function requireSession(record: Record<string, unknown>, sessionId: string | null): void {
  const requested = requireString(record.sessionId, "sessionId");
  if (!sessionId || requested !== sessionId) {
    throw new GrokAcpClientError("Invalid params", -32602);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GrokAcpClientError(`Invalid params: ${field}`, -32602);
  }
  return value;
}

function readStringArray(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new GrokAcpClientError("Invalid params: args", -32602);
  }
  return value;
}

function readByteLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_OUTPUT_BYTE_LIMIT;
  }
  return Math.max(0, Math.floor(value));
}

function buildTerminalEnv(value: unknown): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (value === undefined || value === null) {
    return env;
  }
  if (!Array.isArray(value)) {
    throw new GrokAcpClientError("Invalid params: env", -32602);
  }
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new GrokAcpClientError("Invalid params: env", -32602);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.trim() === "" || typeof record.value !== "string") {
      throw new GrokAcpClientError("Invalid params: env", -32602);
    }
    env[record.name] = record.value;
  }
  return env;
}

function sliceTextLines(content: string, line: unknown, limit: unknown): string {
  const start = typeof line === "number" && Number.isFinite(line) ? Math.max(1, Math.floor(line)) : 1;
  const lines = content.split(/\r?\n/);
  const selected = lines.slice(start - 1);
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return selected.join("\n");
  }
  return selected.slice(0, Math.max(0, Math.floor(limit))).join("\n");
}

function selectAllowOption(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const options: PermissionOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.optionId !== "string" || record.optionId.trim() === "") {
      continue;
    }
    options.push({
      optionId: record.optionId,
      kind: typeof record.kind === "string" ? record.kind : "",
    });
  }
  return options.find((option) => option.kind === "allow_always")?.optionId
    ?? options.find((option) => option.kind === "allow_once")?.optionId
    ?? null;
}
