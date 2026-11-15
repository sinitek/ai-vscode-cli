import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { CLEANUP_PARTS, cleanupComplete, exactKeys, isCleanupRequirements, isDepartmentExecutionIdentity,
  isExecutionCleanup, record, sameExecution, type CleanupRequirements,
  type DepartmentExecutionCleanup, type DepartmentExecutionIdentity } from "./departmentexecutionidentity";
import { DepartmentExecutionReceiptStore, identityMatchesQuery, type DepartmentExecutionReceipt,
  type StoredDepartmentExecution } from "./departmentexecutionreceiptstore";

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_CONNECTIONS = 32;
const MAX_EXECUTIONS = 256;
const SOCKET_TIMEOUT_MS = 5_000;

export type ExecutionKind = "process" | "turn" | "both";
export type ExecutionTerminalEvidence = Pick<DepartmentExecutionCleanup, "processTerminal" | "turnTerminal" | "streams">;
export type ExecutionCleanupEvidence = Pick<DepartmentExecutionCleanup, "runner" | "executionRoot" | "links" | "temp" | "tab">;
export type TrustedExecutionHandle = {
  kind: ExecutionKind;
  completion: Promise<ExecutionTerminalEvidence>;
  cleanup(): Promise<ExecutionCleanupEvidence>;
};
export type TrustedExecutionLauncher = {
  /** This port is injected by trusted host code. It receives no executable, shell, path or prompt from IPC. */
  requirements(identity: DepartmentExecutionIdentity): CleanupRequirements;
  launch(identity: DepartmentExecutionIdentity, bindSession: (sessionId: string) => Promise<void>): Promise<TrustedExecutionHandle>;
};
export type ExecutionObservation =
  | { status: "live"; identity: DepartmentExecutionIdentity; claimGeneration: number }
  | { status: "finalizing"; identity: DepartmentExecutionIdentity; claimGeneration: number }
  | { status: "cleaned"; identity: DepartmentExecutionIdentity; receipt: DepartmentExecutionReceipt }
  | { status: "unknown"; identity: DepartmentExecutionIdentity; reason: string }
  | { status: "conflict"; identity: DepartmentExecutionIdentity; reason: string };
export type DepartmentExecutionOwnerOptions = {
  directory: string;
  ownerId: string;
  launcher: TrustedExecutionLauncher;
};

type Entry = { record: StoredDepartmentExecution; handle?: TrustedExecutionHandle; phase: "starting" | "live" | "finalizing" | "failed";
  terminalObserved?: boolean; cleanupPending?: boolean; launch?: Promise<ExecutionObservation> };
type OwnerRequest =
  | { version: 1; requestId: string; operation: "start"; identity: DepartmentExecutionIdentity }
  | { version: 1; requestId: string; operation: "observe"; identity: DepartmentExecutionIdentity }
  | { version: 1; requestId: string; operation: "handoff"; identity: DepartmentExecutionIdentity; expectedClaimGeneration: number };
type OwnerResponse = { version: 1; requestId: string; result: ExecutionObservation | { status: "protocol-error"; reason: string } };

export function departmentExecutionOwnerEndpoint(directory: string): string {
  const resolved = path.resolve(directory);
  const key = createHash("sha256").update(process.platform === "win32" ? resolved.toLowerCase() : resolved).digest("hex").slice(0, 24);
  return process.platform === "win32"
    ? "\\\\.\\pipe\\sinitek-department-owner-" + key
    : path.join("/tmp", "sinitek-dept-owner-" + key + ".sock");
}

export class DepartmentExecutionOwnerServer {
  private readonly directory: string;
  private readonly store: DepartmentExecutionReceiptStore;
  private readonly entries = new Map<string, Entry>();
  private readonly server = net.createServer((socket) => this.accept(socket));
  private readonly lockPath: string;
  private lockFd: number | null = null;
  private lockIdentity: { dev: number; ino: number } | null = null;
  private socketIdentity: { dev: number; ino: number } | null = null;
  private listening = false;
  private closingAdmission = false;
  private closing: Promise<void> | null = null;

  public constructor(private readonly options: DepartmentExecutionOwnerOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(options.ownerId)) throw new Error("invalid-owner-id");
    this.directory = path.resolve(options.directory);
    this.store = new DepartmentExecutionReceiptStore(this.directory);
    this.lockPath = path.join(this.directory, "owner.lock");
    this.server.maxConnections = MAX_CONNECTIONS;
    this.server.on("error", () => undefined);
    this.server.on("connection", (socket) => {
      socket.setNoDelay(true);
      socket.setTimeout(SOCKET_TIMEOUT_MS, () => socket.destroy());
    });
  }

  public listen(): Promise<string> {
    if (this.listening) return Promise.resolve(departmentExecutionOwnerEndpoint(this.directory));
    try {
      this.lockFd = fs.openSync(this.lockPath, "wx", 0o600);
      const lockStat = fs.fstatSync(this.lockFd);
      this.lockIdentity = { dev: lockStat.dev, ino: lockStat.ino };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("owner-already-running-or-state-unknown");
      throw error;
    }
    const endpoint = departmentExecutionOwnerEndpoint(this.directory);
    if (process.platform !== "win32" && fs.existsSync(endpoint)) {
      this.releaseLock();
      throw new Error("owner-endpoint-exists-or-state-unknown");
    }
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.removeListener("listening", onListening);
        this.releaseLock();
        reject(error);
      };
      const onListening = (): void => {
        this.server.removeListener("error", onError);
        this.listening = true;
        if (process.platform !== "win32") {
          fs.chmodSync(endpoint, 0o600);
          const stat = fs.lstatSync(endpoint);
          this.socketIdentity = { dev: stat.dev, ino: stat.ino };
        }
        resolve(endpoint);
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(endpoint);
    });
  }

  public close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closingAdmission = true;
    if ([...this.entries.values()].some((entry) => entry.launch && !entry.handle
      || entry.handle && (!entry.terminalObserved || entry.phase !== "failed"))) {
      return Promise.reject(new Error("owner-has-live-executions"));
    }
    this.closing = new Promise<void>((resolve, reject) => {
      const finish = (): void => {
        try {
          this.removeOwnedEndpoint();
          this.releaseLock();
          this.listening = false;
          resolve();
        } catch (error) { reject(error); }
      };
      if (!this.listening) { finish(); return; }
      this.server.close((error) => error ? reject(error) : finish());
    });
    return this.closing;
  }

  private accept(socket: net.Socket): void {
    let buffer = Buffer.alloc(0);
    let handled = false;
    socket.on("data", (chunk) => {
      if (handled || buffer.length + chunk.length > MAX_MESSAGE_BYTES) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      if (newline !== buffer.length - 1) { socket.destroy(); return; }
      handled = true;
      let request: unknown;
      try { request = JSON.parse(buffer.subarray(0, newline).toString("utf8")); }
      catch { this.respond(socket, "invalid", { status: "protocol-error", reason: "invalid-json" }); return; }
      void this.dispatch(request).then((response) => this.respond(socket, response.requestId, response.result),
        () => this.respond(socket, "invalid", { status: "protocol-error", reason: "request-failed" }));
    });
    socket.on("error", () => undefined);
  }

  private respond(socket: net.Socket, requestId: string, result: OwnerResponse["result"]): void {
    if (socket.destroyed) return;
    const data = Buffer.from(JSON.stringify({ version: PROTOCOL_VERSION, requestId, result }) + "\n", "utf8");
    if (data.length > MAX_MESSAGE_BYTES) { socket.destroy(); return; }
    socket.end(data);
  }

  private async dispatch(input: unknown): Promise<OwnerResponse> {
    if (!isOwnerRequest(input)) return { version: PROTOCOL_VERSION, requestId: "invalid", result: { status: "protocol-error", reason: "invalid-request" } };
    let result: ExecutionObservation;
    if (input.operation === "start") result = await this.start(input.identity);
    else if (input.operation === "observe") result = this.observe(input.identity);
    else result = this.handoff(input.identity, input.expectedClaimGeneration);
    return { version: PROTOCOL_VERSION, requestId: input.requestId, result };
  }

  private async start(identity: DepartmentExecutionIdentity): Promise<ExecutionObservation> {
    if (this.closingAdmission) return { status: "unknown", identity, reason: "owner-closing-admission-closed" };
    if (identity.ownerId !== this.options.ownerId) return { status: "conflict", identity, reason: "owner-id-mismatch" };
    const read = this.store.read(identity.executionId, identity);
    if (read.kind === "corrupt") return { status: read.reason === "identity-conflict" ? "conflict" : "unknown", identity, reason: read.reason };
    if (read.kind === "ok") {
      if (read.value.state === "cleaned") return this.cleaned(read.value, identity);
      const existing = this.entries.get(identity.executionId);
      if (!existing || !existing.handle) {
        if (existing?.launch) return existing.launch;
        return { status: "unknown", identity, reason: "owner-has-no-live-execution-object" };
      }
      return this.observe(identity);
    }
    let requirements: CleanupRequirements;
    try {
      requirements = this.options.launcher.requirements(structuredClone(identity));
      if (!isCleanupRequirements(requirements)) throw new Error("invalid-trusted-cleanup-requirements");
    } catch {
      return { status: "unknown", identity, reason: "trusted-cleanup-requirements-unavailable" };
    }
    const slot = this.store.checkSlot(identity);
    if (slot !== "available") return slot === "conflict"
      ? { status: "conflict", identity, reason: "execution-generation-or-owner-conflict" }
      : { status: "unknown", identity, reason: "execution-store-unverifiable" };
    if (this.entries.size >= MAX_EXECUTIONS) return { status: "unknown", identity, reason: "owner-capacity-limit" };
    const starting = this.store.makeStarting(identity, requirements);
    let record = this.store.write(starting, null);
    const entry: Entry = { record, phase: "starting" };
    this.entries.set(identity.executionId, entry);
    const launch = (async (): Promise<ExecutionObservation> => {
      let handle: TrustedExecutionHandle;
      try {
        handle = await this.options.launcher.launch(structuredClone(identity), async (sessionId) => this.bindSession(entry, sessionId));
      } catch {
        entry.phase = "failed";
        try { this.writeRecord(entry, { ...entry.record, state: "launch-failed" }); } catch { /* unknown is safer than a guessed state */ }
        this.entries.delete(identity.executionId);
        return { status: "unknown", identity, reason: "trusted-launch-failed" };
      }
      entry.handle = handle;
      if (!handle || !validKind(handle.kind) || !requirementsMatchKind(requirements, handle.kind)) {
        entry.phase = "finalizing";
        void this.complete(entry, handle, false);
        return { status: "unknown", identity, reason: "trusted-launch-kind-mismatch" };
      }
      entry.phase = "live";
      try {
        record = this.writeRecord(entry, { ...entry.record, state: "live" });
      } catch {
        entry.phase = "finalizing";
        void this.complete(entry, handle);
        return { status: "unknown", identity, reason: "owner-state-write-failed" };
      }
      void this.complete(entry, handle);
      return { status: "live", identity: structuredClone(entry.record.identity), claimGeneration: entry.record.claimGeneration };
    })();
    entry.launch = launch;
    void launch.then(() => {
      if (entry.launch === launch) entry.launch = undefined;
    }, () => {
      if (entry.launch === launch) entry.launch = undefined;
    });
    return launch;
  }

  private observe(identity: DepartmentExecutionIdentity): ExecutionObservation {
    const read = this.store.read(identity.executionId, identity);
    if (read.kind === "corrupt") return { status: read.reason === "identity-conflict" ? "conflict" : "unknown", identity, reason: read.reason };
    if (read.kind === "missing") return { status: "unknown", identity, reason: "execution-record-missing" };
    if (read.value.state === "cleaned") return this.cleaned(read.value, identity);
    const entry = this.entries.get(identity.executionId);
    if (read.value.state === "live" && entry?.handle && entry.phase === "live" && sameExecution(entry.record.identity, read.value.identity)) {
      return { status: "live", identity: structuredClone(read.value.identity), claimGeneration: read.value.claimGeneration };
    }
    // This is an observation of the ORIGINAL in-flight cleanup, never a durable
    // state from which another Owner may resume, hand off, or infer a receipt.
    if (read.value.state === "live" && entry?.handle && entry.phase === "finalizing"
      && entry.terminalObserved && entry.cleanupPending && entry.record.state === "live"
      && sameExecution(identity, entry.record.identity) && sameExecution(entry.record.identity, read.value.identity)
      && entry.record.revision === read.value.revision && entry.record.claimGeneration === read.value.claimGeneration
      && CLEANUP_PARTS.every((part) => entry.record.requirements[part] === read.value.requirements[part])) {
      return { status: "finalizing", identity: structuredClone(entry.record.identity), claimGeneration: entry.record.claimGeneration };
    }
    return { status: "unknown", identity, reason: "owner-lost-or-cleanup-unverified" };
  }

  private handoff(identity: DepartmentExecutionIdentity, expectedClaimGeneration: number): ExecutionObservation {
    const observed = this.observe(identity);
    if (observed.status !== "live") return observed;
    if (observed.claimGeneration !== expectedClaimGeneration) return { status: "conflict", identity, reason: "stale-claim-generation" };
    const entry = this.entries.get(identity.executionId);
    if (!entry?.handle || !sameExecution(entry.record.identity, observed.identity)) {
      return { status: "unknown", identity, reason: "owner-lost-during-handoff" };
    }
    try {
      const next = this.writeRecord(entry, { ...entry.record, claimGeneration: entry.record.claimGeneration + 1 });
      return { status: "live", identity: structuredClone(next.identity), claimGeneration: next.claimGeneration };
    } catch { return { status: "unknown", identity, reason: "handoff-persistence-failed" }; }
  }

  private async bindSession(entry: Entry, sessionId: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(sessionId)) throw new Error("invalid-bound-session");
    const current = entry.record.identity.session;
    if (current.state === "bound") {
      if (current.id !== sessionId) throw new Error("session-already-bound");
      return;
    }
    const identity = { ...entry.record.identity, session: { state: "bound" as const, id: sessionId } } as DepartmentExecutionIdentity;
    entry.record = this.writeRecord(entry, { ...entry.record, identity });
  }

  private async complete(entry: Entry, handle: TrustedExecutionHandle, allowReceipt = true): Promise<void> {
    try {
      const terminal = await handle.completion;
      entry.terminalObserved = true;
      entry.phase = "finalizing";
      entry.cleanupPending = terminalComplete(terminal, entry.record.requirements);
      const cleanup = await handle.cleanup();
      entry.cleanupPending = false;
      const evidence = { ...cleanup, processTerminal: terminal.processTerminal, turnTerminal: terminal.turnTerminal,
        streams: terminal.streams } as DepartmentExecutionCleanup;
      if (!allowReceipt || !isExecutionCleanup(evidence) || !cleanupComplete(evidence, entry.record.requirements)
        || entry.record.identity.session.state !== "bound") throw new Error("execution-cleanup-incomplete");
      const receipt = new DepartmentExecutionReceiptStore(this.directory).makeReceipt(entry.record.identity,
        entry.record.claimGeneration, evidence, entry.record.requirements);
      const next = this.writeRecord(entry, { ...entry.record, state: "cleaned", receipt });
      entry.record = next;
      entry.handle = undefined;
      entry.phase = "failed";
      this.entries.delete(entry.record.identity.executionId);
    } catch {
      entry.cleanupPending = false;
      entry.phase = "failed";
      if (entry.terminalObserved) entry.handle = undefined;
      try { this.writeRecord(entry, { ...entry.record, state: "cleanup-failed", receipt: undefined }); } catch { /* preserve unknown */ }
    }
  }

  private cleaned(record: StoredDepartmentExecution, query: DepartmentExecutionIdentity): ExecutionObservation {
    if (!record.receipt || !identityMatchesQuery(record.identity, query)) {
      return { status: "unknown", identity: query, reason: "cleaned-receipt-unavailable" };
    }
    return { status: "cleaned", identity: structuredClone(record.identity), receipt: structuredClone(record.receipt) };
  }

  private writeRecord(entry: Entry, value: StoredDepartmentExecution): StoredDepartmentExecution {
    const next = this.store.write(value, entry.record.revision);
    entry.record = next;
    return next;
  }

  private releaseLock(): void {
    if (this.lockFd !== null) {
      fs.closeSync(this.lockFd);
      this.lockFd = null;
      const identity = this.lockIdentity;
      this.lockIdentity = null;
      try {
        const stat = fs.lstatSync(this.lockPath);
        if (identity && stat.dev === identity.dev && stat.ino === identity.ino) fs.unlinkSync(this.lockPath);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }

  private removeOwnedEndpoint(): void {
    if (process.platform === "win32" || !this.socketIdentity) return;
    const endpoint = departmentExecutionOwnerEndpoint(this.directory);
    try {
      const stat = fs.lstatSync(endpoint);
      if (stat.dev === this.socketIdentity.dev && stat.ino === this.socketIdentity.ino) fs.unlinkSync(endpoint);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.socketIdentity = null;
  }
}

/** Promise settlement alone cannot establish terminal/drain observation. */
function terminalComplete(terminal: ExecutionTerminalEvidence, requirements: CleanupRequirements): boolean {
  const na = { status: "not-applicable" as const, reason: "terminal-observation-only" };
  const evidence = { ...terminal, runner: na, executionRoot: na, links: na, temp: na, tab: na };
  return isExecutionCleanup(evidence) && cleanupComplete(evidence,
    { ...requirements, runner: false, executionRoot: false, links: false, temp: false, tab: false });
}

function requirementsMatchKind(requirements: CleanupRequirements, kind: ExecutionKind): boolean {
  return requirements.processTerminal === (kind === "process" || kind === "both")
    && requirements.turnTerminal === (kind === "turn" || kind === "both");
}
function validKind(value: unknown): value is ExecutionKind { return value === "process" || value === "turn" || value === "both"; }

function isOwnerRequest(value: unknown): value is OwnerRequest {
  if (!record(value) || value.version !== PROTOCOL_VERSION || typeof value.requestId !== "string"
    || !/^[A-Za-z0-9-]{1,64}$/.test(value.requestId) || !isDepartmentExecutionIdentity(value.identity)) return false;
  if (value.operation === "start") return exactKeys(value, ["version", "requestId", "operation", "identity"]);
  if (value.operation === "observe") return exactKeys(value, ["version", "requestId", "operation", "identity"]);
  return value.operation === "handoff" && exactKeys(value, ["version", "requestId", "operation", "identity", "expectedClaimGeneration"])
    && Number.isSafeInteger(value.expectedClaimGeneration) && (value.expectedClaimGeneration as number) >= 1;
}
