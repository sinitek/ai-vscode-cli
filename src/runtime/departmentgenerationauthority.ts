import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { fork } from "child_process";
import { exactKeys, identifier, isCleanupRequirements, isDepartmentExecutionIdentity, record,
  type CleanupRequirements, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import { fingerprintDepartmentExecutionSelection } from "./departmentexecutionidentity";
import { isLeaderExecutionScope, leaderExecutionScopeKey, type DepartmentLeaderProducerClosure, type DepartmentExecutionResponsibility, type DepartmentLeaderExecutionScope } from "../extensionHost/departmentleaderexecutionledger";

import { DepartmentExecutionOwnerClient } from "./departmentexecutionownerclient";
import type { DepartmentOpenCodeRetiredSession } from "./departmentopencodesessionpreparation";
import type { DepartmentExecutionReceipt } from "./departmentexecutionreceiptstore";

export type DepartmentGenerationRecovery = { id: string; state: "draining" | "closed" | "unknown";
  closure: DepartmentLeaderProducerClosure | null; nativeSources: (DepartmentOpenCodeRetiredSession & { localSessionId: string })[] };
const VERSION = 2;
const MAX_BYTES = 64 * 1024;
const MAX_CONNECTIONS = 32;
const MAX_TICKETS = 256;
const REQUEST_TIMEOUT_MS = 3_000;

export type DepartmentGenerationTicket = {
  id: string;
  registrationId: string;
  target: DepartmentExecutionResponsibility["target"];
  selection: DepartmentExecutionSelection;
  requirements: CleanupRequirements;
  localSessionId: string;
  nativeSessionId: string | null;
  identity: DepartmentExecutionIdentity | null;
  state: "preparing" | "bound" | "granted" | "started" | "released" | "unknown";
};
export type DepartmentGenerationAuthoritySnapshot = {
  version: 2;
  scope: DepartmentLeaderExecutionScope;
  producerId: string;
  claim: string;
  state: "open" | "sealed";
  tickets: DepartmentGenerationTicket[];
};
type Request = { version: 2; requestId: string; token: string; scope: DepartmentLeaderExecutionScope;
  expectedClaim: string; operation: "observe" | "claim" | "ticket" | "bind" | "grant" | "consume" | "release" | "unknown" | "seal" | "native-source" | "native-stopped" | "witness" | "control" | "recovery" | "retire";
  ticket?: DepartmentGenerationTicket; producerProof?: string; controlId?: string; nativeDirectory?: string };
type Response = { version: 2; requestId: string; result: { ok: true; claim: string; snapshot: DepartmentGenerationAuthoritySnapshot; recovery?: DepartmentGenerationRecovery }
  | { ok: false; reason: string } };

export function departmentGenerationAuthorityEndpoint(directory: string): string {
  const resolved = path.resolve(directory);
  const key = createHash("sha256").update(process.platform === "win32" ? resolved.toLowerCase() : resolved).digest("hex").slice(0, 24);
  return process.platform === "win32" ? `\\\\.\\pipe\\sinitek-dept-generation-${key}` : path.join("/tmp", `sinitek-dept-generation-${key}.sock`);
}

export function departmentGenerationAuthorityDirectory(parentDirectory: string, scope: DepartmentLeaderExecutionScope): string {
  if (!isLeaderExecutionScope(scope)) throw new Error("department-generation-authority-scope-invalid");
  const key = createHash("sha256").update(leaderExecutionScopeKey(scope)).digest("hex");
  return path.join(path.resolve(parentDirectory), key);
}

/** Non-blocking readiness: ownership awaits this barrier before Ledger.open and the first scheduler pump. */
export function startDepartmentGenerationAuthority(directory: string, scope: DepartmentLeaderExecutionScope,
  producerId: string, timeoutMs = 5_000, recovery?: { ownerDirectory: string; drain(): Promise<void> }): Promise<{ snapshot: DepartmentGenerationAuthoritySnapshot; producerProof: string; confirmDrain(): void; close(): Promise<void> }> {
  const readyFile = path.join(directory, "authority.ready");
  if (readDepartmentGenerationAuthority(directory)) throw new Error("department-generation-authority-already-exists");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const child = fork(path.join(__dirname, "departmentgenerationauthorityworker.js"), [], {
    detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.unref();
  child.send({ directory, readyFile, producerId, scope, ...(recovery ? { ownerDirectory: path.resolve(recovery.ownerDirectory) } : {}) });
  return new Promise((resolve, reject) => {
    let settled = false, closeResolve: (() => void) | undefined, closeReject: ((error: Error) => void) | undefined;
    let closeTimer: NodeJS.Timeout | undefined;
    let closeAcknowledged = false;
    const timer = setTimeout(() => fail(new Error("department-generation-authority-registration-timeout")), timeoutMs);
    const cleanupReady = () => { try { fs.unlinkSync(readyFile); } catch { /* Readiness is advisory. */ } };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); cleanupReady(); child.removeListener("message", onMessage);
      try { child.kill(); } catch { /* Child owns its endpoint cleanup on exit. */ }
      reject(error);
    };
    const onMessage = (value: unknown) => {
      if (!record(value) || !exactKeys(value, ["version", "scope", "producerId", "claim", "state", "producerProof"])
        || value.version !== 2 || !isLeaderExecutionScope(value.scope) || leaderExecutionScopeKey(value.scope) !== leaderExecutionScopeKey(scope)
        || value.producerId !== producerId || !identifier(value.claim) || value.state !== "open"
        || typeof value.producerProof !== "string" || value.producerProof.length < 32) {
        fail(new Error("department-generation-authority-registration-conflict")); return;
      }
      const stored = readDepartmentGenerationAuthority(directory);
      if (!stored || stored.snapshot.claim !== value.claim || stored.snapshot.state !== "open") {
        fail(new Error("department-generation-authority-registration-readback-failed")); return;
      }
      settled = true; clearTimeout(timer); cleanupReady(); child.channel?.unref();
      child.removeListener("message", onMessage);
      child.on("message", (control: unknown) => {
        if (recovery && record(control) && exactKeys(control, ["operation", "id"]) && control.operation === "drain-original" && identifier(control.id)) {
          // Only the original inherited channel owns native/consumer/tab ports.
          void recovery.drain().then(() => {
            if (child.connected) child.send({ operation: "drain-result", id: control.id, ok: true });
          }, () => { if (child.connected) child.send({ operation: "drain-result", id: control.id, ok: false }); });
          return;
        }
        if (record(control) && exactKeys(control, ["operation", "ok", "reason"]) && control.operation === "shutdown-result") {
          const resolveClose = closeResolve, rejectClose = closeReject;
          if (control.ok === true) closeAcknowledged = true;
          else {
            closeResolve = undefined; closeReject = undefined;
            if (closeTimer) clearTimeout(closeTimer);
            rejectClose?.(new Error(typeof control.reason === "string" ? control.reason : "department-generation-authority-shutdown-unconfirmed"));
          }
        }
      });
      child.once("exit", (code) => { if (closeReject) {
        const resolveClose = closeResolve, rejectClose = closeReject; closeResolve = undefined; closeReject = undefined;
        if (closeTimer) clearTimeout(closeTimer);
        if (closeAcknowledged && code === 0) resolveClose?.();
        else rejectClose(new Error(`department-generation-authority-worker-exit-${code ?? "unknown"}`));
      } });
      resolve({ snapshot: structuredClone(stored.snapshot), producerProof: value.producerProof, confirmDrain: () => {
        if (!child.connected) throw new Error("department-generation-authority-worker-unavailable");
        child.send({ operation: "native-drained", claim: stored.snapshot.claim });
      }, close: () => new Promise<void>((yes, no) => {
        if (!child.connected || closeResolve || closeReject) { no(new Error("department-generation-authority-worker-unavailable")); return; }
        closeResolve = yes; closeReject = no; closeAcknowledged = false;
        closeTimer = setTimeout(() => {
          const rejectClose = closeReject; closeResolve = undefined; closeReject = undefined;
          try { child.kill(); } catch { /* The timeout remains a failed cleanup result. */ }
          rejectClose?.(new Error("department-generation-authority-shutdown-timeout"));
        }, 5_000);
        child.send({ operation: "shutdown", claim: stored.snapshot.claim }, error => { if (error) {
          const rejectClose = closeReject; closeResolve = undefined; closeReject = undefined;
          if (closeTimer) clearTimeout(closeTimer);
          rejectClose?.(error);
        } });
      }) });
    };
    child.on("message", onMessage);
    child.once("error", error => fail(error));
    child.once("exit", code => { if (!settled) fail(new Error(`department-generation-authority-worker-exit-${code ?? "unknown"}`)); });
    child.once("disconnect", () => { if (!settled) fail(new Error("department-generation-authority-worker-disconnected")); });
  });
}

export function isDepartmentGenerationTicket(value: unknown, scope: DepartmentLeaderExecutionScope): value is DepartmentGenerationTicket {
  if (!record(value) || !exactKeys(value, ["id", "registrationId", "target", "selection", "requirements", "localSessionId", "nativeSessionId", "identity", "state"])
    || !identifier(value.id) || !identifier(value.registrationId) || !isCleanupRequirements(value.requirements)
    || !record(value.target) || !(value.target.role === "leader" && exactKeys(value.target, ["role"])
      || value.target.role === "employee" && exactKeys(value.target, ["role", "subtaskId", "attemptId"])
        && identifier(value.target.subtaskId) && identifier(value.target.attemptId))
    || typeof value.localSessionId !== "string" || !value.localSessionId || value.localSessionId.length > 256
    || !(value.nativeSessionId === null || typeof value.nativeSessionId === "string" && identifier(value.nativeSessionId)
      && value.nativeSessionId.length <= 256)
    || !["preparing", "bound", "granted", "started", "released", "unknown"].includes(value.state as string)) return false;
  try {
    const selection = value.selection as DepartmentExecutionSelection;
    const fingerprints = fingerprintDepartmentExecutionSelection(selection);
    if ((selection.role !== "employee" && selection.role !== "leader") || selection.role !== value.target.role) return false;
    if (value.identity === null) return (value.state === "preparing" || value.state === "unknown") && value.nativeSessionId === null;
    if (!isDepartmentExecutionIdentity(value.identity)) return false;
    const identity = value.identity;
    if (selection.cli !== identity.cli || selection.role !== identity.role
      || fingerprints.configFingerprint !== identity.configFingerprint || fingerprints.profileFingerprint !== identity.profileFingerprint
      || (identity.cli === "opencode" ? !/^ses_[A-Za-z0-9]+$/.test(value.nativeSessionId as string)
        : !identifier(value.nativeSessionId))) return false;
    if (value.target.role === "employee" && (identity.role !== "employee" || identity.subtaskId !== value.target.subtaskId
      || identity.attemptId !== value.target.attemptId)) return false;
    if (value.target.role === "leader" && identity.role !== "leader") return false;
    return identity.rootTaskId === scope.rootTaskId && identity.workspace === scope.workspace
      && identity.leaderTaskId === scope.leaderTaskId && identity.moduleId === scope.moduleId
      && identity.generation === scope.generation && identity.session.state === "bound"
      && identity.session.id === value.nativeSessionId && value.state !== "preparing";
  } catch { return false; }
}

function validateRequest(value: unknown): value is Request {
  if (!record(value) || !exactKeys(value, ["version", "requestId", "token", "scope", "expectedClaim", "operation",
    ...(Object.prototype.hasOwnProperty.call(value, "ticket") ? ["ticket"] : []), ...(Object.prototype.hasOwnProperty.call(value, "producerProof") ? ["producerProof"] : []),
    ...(Object.prototype.hasOwnProperty.call(value, "controlId") ? ["controlId"] : []),
    ...(Object.prototype.hasOwnProperty.call(value, "nativeDirectory") ? ["nativeDirectory"] : [])])
    || value.version !== VERSION || !identifier(value.requestId) || typeof value.token !== "string" || value.token.length < 32
    || !isLeaderExecutionScope(value.scope) || !identifier(value.expectedClaim)
    || !["observe", "claim", "ticket", "bind", "grant", "consume", "release", "unknown", "seal", "native-source", "native-stopped", "witness", "control", "recovery", "retire"].includes(value.operation as string)
    || (["control", "recovery", "retire"].includes(value.operation as string) ? !identifier(value.controlId) : value.controlId !== undefined)) return false;
  if (value.operation === "native-source" ? typeof value.nativeDirectory !== "string" || value.nativeDirectory.length > 4096
    || !path.isAbsolute(value.nativeDirectory) || path.normalize(value.nativeDirectory) !== value.nativeDirectory || /[\x00-\x1f]/.test(value.nativeDirectory) : value.nativeDirectory !== undefined) return false;
  return !Object.prototype.hasOwnProperty.call(value, "ticket") || isDepartmentGenerationTicket(value.ticket, value.scope);
}

/** Cross-host coordinator. It authorizes scheduler work only; it never makes an Owner receipt or releases capacity. */
export class DepartmentGenerationAuthorityServer {
  private readonly server = net.createServer(socket => this.accept(socket));
  private readonly lockPath: string;
  private lockFd: number | null = null;
  private socketIdentity: { dev: number; ino: number } | null = null;
  private listening = false;
  private snapshot: DepartmentGenerationAuthoritySnapshot;
  private closing = false;
  private readonly producerProof = randomUUID() + randomUUID();
  private readonly receipts = new Map<string, DepartmentExecutionReceipt>();
  private readonly receiptWork = new Map<string, Promise<void>>();
  // Private original lifecycle provenance; never hydrated from disk or caller receipts.
  private readonly nativeSources = new Map<string, { directory: string; retired: boolean }>();
  private recovery: DepartmentGenerationRecovery | undefined;
  private recoveryWork: Promise<void> | undefined;
  private originalDrainFailed = false;
  private originalDrained = false;

  confirmOriginalDrain(claim: string): void {
    if (claim === this.snapshot.claim && this.snapshot.state === "sealed" && this.snapshot.tickets.length
      && this.snapshot.tickets.every(ticket => ticket.state === "released" && this.receipts.has(ticket.id))) this.originalDrained = true;
  }
  originalDrainResult(id: string, ok: boolean): void {
    if (this.recovery?.id === id && ok) this.confirmOriginalDrain(this.snapshot.claim);
    if (this.recovery?.id === id && !ok) { this.originalDrainFailed = true; this.recovery.state = "unknown"; }
  }

  constructor(private readonly directory: string, private readonly scope: DepartmentLeaderExecutionScope,
    private readonly producerId: string, private readonly token = randomUUID() + randomUUID(),
    private readonly recoveryPorts?: { ownerDirectory: string; drain(id: string): void; originalConnected?(): boolean; retired?(): void }) {
    if (!isLeaderExecutionScope(scope) || !identifier(producerId) || token.length < 32) throw new Error("department-generation-authority-identity-invalid");
    this.directory = path.resolve(directory);
    this.lockPath = path.join(this.directory, "authority.lock");
    this.snapshot = { version: 2, scope: structuredClone(scope), producerId, claim: randomUUID(), state: "open", tickets: [] };
    this.server.maxConnections = MAX_CONNECTIONS;
    this.server.on("connection", socket => socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy()));
    this.server.on("error", () => undefined);
  }

  listen(): Promise<string> {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.lockFd = fs.openSync(this.lockPath, "wx", 0o600);
    const endpoint = departmentGenerationAuthorityEndpoint(this.directory);
    if (process.platform !== "win32" && fs.existsSync(endpoint)) { this.releaseLock(); throw new Error("department-generation-authority-endpoint-unknown"); }
    return new Promise((resolve, reject) => {
      const failed = (error: Error) => { this.server.removeListener("listening", ready); this.releaseLock(); reject(error); };
      const ready = () => {
        this.server.removeListener("error", failed); this.listening = true;
        if (process.platform !== "win32") { fs.chmodSync(endpoint, 0o600); const stat = fs.lstatSync(endpoint); this.socketIdentity = { dev: stat.dev, ino: stat.ino }; }
        this.persist(); resolve(endpoint);
      };
      this.server.once("error", failed); this.server.once("listening", ready); this.server.listen(endpoint);
    });
  }

  snapshotForTest(): DepartmentGenerationAuthoritySnapshot { return structuredClone(this.snapshot); }
  producerProofForBootstrap(): string { return this.producerProof; }

  hasRecoveryController(): boolean { return !!this.recovery; }

  close(): Promise<void> {
    if (this.snapshot.state !== "sealed" || this.snapshot.tickets.some(ticket => ticket.state !== "released"))
      return Promise.reject(new Error("department-generation-authority-responsibility-open"));
    this.closing = true;
    return new Promise((resolve, reject) => this.server.close(error => {
      if (error) { reject(error); return; }
      try { this.removeEndpoint(); this.releaseLock(); this.listening = false; resolve(); } catch (failure) { reject(failure); }
    }));
  }

  private accept(socket: net.Socket): void {
    let buffer = Buffer.alloc(0), handled = false;
    socket.on("data", chunk => {
      if (handled || buffer.length + chunk.length > MAX_BYTES) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]); const newline = buffer.indexOf(10); if (newline < 0) return;
      if (newline !== buffer.length - 1) { socket.destroy(); return; }
      handled = true;
      let input: unknown; try { input = JSON.parse(buffer.subarray(0, newline).toString("utf8")); }
      catch { this.respond(socket, "invalid", { ok: false, reason: "invalid-json" }); return; }
      let result: Response["result"];
      const requestId = record(input) && typeof input.requestId === "string" ? input.requestId : "invalid";
      void this.dispatch(input).then(result => this.respond(socket, requestId, result),
        () => this.respond(socket, requestId, { ok: false, reason: "department-generation-authority-persistence-failed" }));
    });
  }

  private respond(socket: net.Socket, requestId: string, result: Response["result"]): void {
    if (socket.destroyed) return;
    const wire = Buffer.from(JSON.stringify({ version: VERSION, requestId, result }) + "\n", "utf8");
    if (wire.length > MAX_BYTES) { socket.destroy(); return; }
    socket.end(wire);
  }

  private async dispatch(input: unknown): Promise<Response["result"]> {
    if (!validateRequest(input) || input.token !== this.token || leaderExecutionScopeKey(input.scope) !== leaderExecutionScopeKey(this.scope)) return { ok: false, reason: "department-generation-authority-scope-or-auth-conflict" };
    if (input.operation === "native-source" || input.operation === "native-stopped") {
      if (!this.recoveryPorts || this.closing || input.expectedClaim !== this.snapshot.claim
        || input.producerProof !== this.producerProof || !input.ticket)
        return { ok: false, reason: "department-generation-authority-original-producer-required" };
      const ticket = this.snapshot.tickets.find(t => t.id === input.ticket!.id);
      if (!ticket?.identity || ticket.identity.cli !== "opencode"
        || JSON.stringify({ ...ticket, state: input.ticket.state }) !== JSON.stringify(input.ticket))
        return { ok: false, reason: "department-generation-authority-native-source-conflict" };
      const previous = this.nativeSources.get(ticket.id);
      if (input.operation === "native-source") {
        const directory = input.nativeDirectory!;
        let canonical = false;
        try { canonical = fs.realpathSync(directory) === directory && fs.statSync(directory).isDirectory(); }
        catch { /* A missing or unreadable original root cannot establish provenance. */ }
        if (this.snapshot.state !== "open" || !["bound", "started"].includes(ticket.state)
          || previous && previous.directory !== directory || !canonical
          || [...this.nativeSources].some(([id, source]) => id !== ticket.id && source.directory === directory))
          return { ok: false, reason: "department-generation-authority-native-source-conflict" };
        if (!previous) this.nativeSources.set(ticket.id, { directory, retired: false });
      } else {
        // The original private stopped handshake follows the actual full receipt.
        // A caller's path, seal ACK or absent PID cannot certify retirement.
        if (!previous || !this.receipts.has(ticket.id) || fs.lstatSync(previous.directory, { throwIfNoEntry: false }))
          return { ok: false, reason: "department-generation-authority-native-retirement-unconfirmed" };
        previous.retired = true;
      }
      return { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot) };
    }
    if ((input.operation === "witness" || input.operation === "release") && this.recoveryPorts) {
      if (input.producerProof !== this.producerProof || input.expectedClaim !== this.snapshot.claim || !input.ticket)
        return { ok: false, reason: "department-generation-authority-original-producer-required" };
      const ticket = this.snapshot.tickets.find(t => t.id === input.ticket!.id);
      if (!ticket || !ticket.identity || ticket.state !== "started" && ticket.state !== "released"
        || JSON.stringify({ ...ticket, state: input.ticket.state }) !== JSON.stringify(input.ticket))
        return { ok: false, reason: "department-generation-authority-ticket-policy-conflict" };
      try { await this.observeOriginalReceipt(ticket); }
      catch { return { ok: false, reason: "department-generation-authority-original-receipt-unavailable" }; }
      // Re-enter all identity/claim/closing checks after the actual endpoint await.
      if (input.expectedClaim !== this.snapshot.claim || this.closing)
        return { ok: false, reason: "department-generation-authority-stale-claim" };
      if (input.operation === "witness") return { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot) };
    }
    if (input.operation === "observe") return { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot) };
    if (this.closing) return { ok: false, reason: "department-generation-authority-unavailable" };
    const committed = structuredClone(this.snapshot);
    try { return this.mutate(input); }
    catch (error) {
      // A failed persistence step must not leave an uncommitted release/claim
      // usable by later requests in this still-running process.
      this.snapshot = committed;
      this.snapshot.state = "sealed";
      this.closing = true;
      throw error;
    }
  }

  private mutate(input: Request): Response["result"] {
    if (input.operation === "retire") {
      if (!this.recovery || this.recovery.id !== input.controlId || this.recovery.state !== "closed" || input.expectedClaim !== this.snapshot.claim)
        return { ok: false, reason: "department-generation-authority-retirement-unconfirmed" };
      const result: Response["result"] = { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot), recovery: structuredClone(this.recovery) };
      // Close waits for this response's connection to finish. Never timeout-kill a service as success.
      setImmediate(() => { void this.close().then(() => this.recoveryPorts?.retired?.(), () => undefined); });
      return result;
    }
    if (input.operation === "control" || input.operation === "recovery") {
      if (!this.recoveryPorts) return { ok: false, reason: "department-generation-authority-recovery-unavailable" };
      if (input.expectedClaim !== this.snapshot.claim || this.recovery && this.recovery.id !== input.controlId)
        return { ok: false, reason: "department-generation-authority-control-conflict" };
      if (!this.recovery) {
        if (input.operation !== "control") return { ok: false, reason: "department-generation-authority-control-missing" };
        this.snapshot.state = "sealed";
        // A cold controller cannot certify resource-free cancellation of an
        // already registered preparation. Preserve it as unresolved, not absent.
        for (const ticket of this.snapshot.tickets) if (ticket.state === "preparing") ticket.state = "unknown";
        this.persist(); // irrevocable launch fence before notifying original lifecycle
        this.recovery = { id: input.controlId!, state: "draining", closure: null, nativeSources: [] };
        try { if (!this.originalDrained) this.recoveryPorts.drain(this.recovery.id); } catch { /* Original Owner observations below remain authoritative. */ }
      }
      if (!this.recoveryWork && this.recovery.state !== "closed" && !this.originalDrainFailed) {
        this.recoveryWork = this.refreshRecovery().finally(() => { this.recoveryWork = undefined; });
        void this.recoveryWork.catch(() => { if (this.recovery) this.recovery.state = "unknown"; });
      }
      return { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot), recovery: structuredClone(this.recovery) };
    }
    if (input.operation === "claim") {
      if (this.recovery) return { ok: false, reason: "department-generation-authority-control-conflict" };
      if (this.snapshot.state !== "sealed" || input.expectedClaim !== this.snapshot.claim
        || this.snapshot.tickets.length === 0 || this.snapshot.tickets.some(ticket => ticket.state !== "released")) return { ok: false, reason: "department-generation-authority-claim-conflict" };
      this.snapshot.claim = randomUUID(); this.persist();
      return { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot) };
    }
    if (input.expectedClaim !== this.snapshot.claim) return { ok: false, reason: "department-generation-authority-stale-claim" };
    if (["ticket", "bind", "grant", "consume", "release", "unknown", "witness"].includes(input.operation)
      && input.producerProof !== this.producerProof) return { ok: false, reason: "department-generation-authority-original-producer-required" };
    if (input.operation === "seal") {
      this.snapshot.state = "sealed"; this.persist();
      return { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot) };
    }
    if (input.operation === "ticket") {
      if (this.closing || this.snapshot.state !== "open" || !input.ticket || input.ticket.state !== "preparing" || input.ticket.identity !== null) return { ok: false, reason: "department-generation-authority-sealed" };
      const duplicate = this.snapshot.tickets.find(ticket => ticket.id === input.ticket!.id || ticket.registrationId === input.ticket!.registrationId);
      if (duplicate) return JSON.stringify(duplicate) === JSON.stringify(input.ticket) ? { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot) }
        : { ok: false, reason: "department-generation-authority-ticket-conflict" };
      if (this.snapshot.tickets.length >= MAX_TICKETS) return { ok: false, reason: "department-generation-authority-capacity" };
      this.snapshot.tickets.push(structuredClone(input.ticket)); this.persist();
    } else {
      const ticket = input.ticket && this.snapshot.tickets.find(value => value.id === input.ticket!.id);
      if (!ticket || !input.ticket) return { ok: false, reason: "department-generation-authority-ticket-missing" };
      if (JSON.stringify({ ...ticket, state: input.ticket.state, identity: input.ticket.identity, nativeSessionId: input.ticket.nativeSessionId })
        !== JSON.stringify(input.ticket)) return { ok: false, reason: "department-generation-authority-ticket-policy-conflict" };
      if (this.snapshot.state !== "open" && ["bind", "grant", "consume"].includes(input.operation)) return { ok: false, reason: "department-generation-authority-sealed" };
      if (input.operation === "bind" && ticket.state === "preparing" && input.ticket.identity) {
        Object.assign(ticket, { identity: structuredClone(input.ticket.identity), nativeSessionId: input.ticket.nativeSessionId, state: "bound" });
      } else if (input.operation === "grant" && ticket.state === "bound") ticket.state = "granted";
      else if (input.operation === "consume" && (ticket.state === "bound" || ticket.state === "granted"
        || ticket.state === "started" && ticket.target.role === "leader")) ticket.state = "started";
      else if (input.operation === "release" && (ticket.state === "started" || ticket.state === "released") && input.producerProof === this.producerProof) ticket.state = "released";
      else if (input.operation === "unknown" && !["released", "unknown"].includes(ticket.state) && input.producerProof === this.producerProof) ticket.state = "unknown";
      else return { ok: false, reason: "department-generation-authority-transition-invalid" };
      Object.assign(input.ticket, { state: ticket.state, identity: ticket.identity, nativeSessionId: ticket.nativeSessionId });
      this.persist();
    }
    return { ok: true, claim: this.snapshot.claim, snapshot: structuredClone(this.snapshot) };
  }

  /** The independent original service, never a cold client, retains socket-verified
   * receipts before original host shutdown. Disk receipts are deliberately unused. */
  private async observeOriginalReceipt(ticket: DepartmentGenerationTicket): Promise<void> {
    if (this.receipts.has(ticket.id)) return;
    const existing = this.receiptWork.get(ticket.id);
    if (existing) return existing;
    const work = this.captureOriginalReceipt(ticket);
    this.receiptWork.set(ticket.id, work);
    try { await work; } finally { if (this.receiptWork.get(ticket.id) === work) this.receiptWork.delete(ticket.id); }
  }
  private async captureOriginalReceipt(ticket: DepartmentGenerationTicket): Promise<void> {
    if (!this.recoveryPorts || !ticket.identity || ticket.identity.session.state !== "bound")
      throw new Error("department-generation-authority-owner-unbound");
    const client = new DepartmentExecutionOwnerClient(path.join(this.recoveryPorts.ownerDirectory, ticket.identity.ownerId));
    const observed = await client.observeExecution(ticket.identity);
    if (observed.status !== "cleaned") throw new Error("department-generation-authority-owner-not-cleaned");
    // waitForCleanup applies the original full required policy to the actual IPC receipt.
    const receipt = await client.waitForCleanup(ticket.identity, ticket.requirements);
    this.receipts.set(ticket.id, receipt);
  }

  private async refreshRecovery(): Promise<void> {
    const recovery = this.recovery!;
    const tickets = structuredClone(this.snapshot.tickets);
    if (!tickets.length || tickets.filter(t => t.target.role === "leader").length !== 1
      || tickets.some(t => !t.identity || !["started", "released"].includes(t.state))) return;
    const disconnected = this.recoveryPorts?.originalConnected?.() === false;
    for (const ticket of tickets) {
      if (disconnected && !this.receipts.has(ticket.id)) {
        // Stop only the exact original runtime's installed native port. This
        // cannot release an unprovable tab, consumer, root or preparation.
        const client = new DepartmentExecutionOwnerClient(path.join(this.recoveryPorts!.ownerDirectory, ticket.identity!.ownerId));
        await client.sealExecution(ticket.identity!);
      }
      try { await this.observeOriginalReceipt(ticket); } catch { return; }
    }
    // On host loss the original independent authority plus the complete original
    // Owner receipts cover all registered tickets. No replacement producer is involved.
    if (disconnected && tickets.every(t => this.receipts.has(t.id))) this.originalDrained = true;
    if (tickets.some(t => t.identity?.cli === "opencode" && !this.nativeSources.get(t.id)?.retired)) return;
    if (!this.originalDrained || this.originalDrainFailed || this.recovery !== recovery || this.closing
      || JSON.stringify(tickets) !== JSON.stringify(this.snapshot.tickets)) return;
    const before = structuredClone(this.snapshot);
    for (const ticket of this.snapshot.tickets) ticket.state = "released";
    try { this.persist(); } catch { this.snapshot = before; this.snapshot.state = "sealed"; recovery.state = "unknown"; return; }
    recovery.closure = { version: 1, scope: structuredClone(this.scope), producerId: this.producerId, admissionFence: randomUUID() };
    recovery.nativeSources = tickets.filter(t => t.identity?.cli === "opencode").map(t => ({
      identity: structuredClone(t.identity!), selection: structuredClone(t.selection), localSessionId: t.localSessionId,
      directory: this.nativeSources.get(t.id)!.directory,
    }));
    recovery.state = "closed";
  }

  private persist(): void {
    const file = path.join(this.directory, "authority.json"), tmp = `${file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(tmp, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ token: this.token, snapshot: this.snapshot }), "utf8"); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    if (process.platform !== "win32") {
      const directoryFd = fs.openSync(this.directory, "r");
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    }
  }
  private removeEndpoint(): void {
    if (!this.socketIdentity || process.platform === "win32") return;
    const endpoint = departmentGenerationAuthorityEndpoint(this.directory);
    try { const stat = fs.lstatSync(endpoint); if (stat.dev === this.socketIdentity.dev && stat.ino === this.socketIdentity.ino) fs.unlinkSync(endpoint); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  private releaseLock(): void {
    if (this.lockFd === null) return;
    try { const stat = fs.fstatSync(this.lockFd), current = fs.lstatSync(this.lockPath); if (stat.dev === current.dev && stat.ino === current.ino) fs.unlinkSync(this.lockPath); }
    finally { fs.closeSync(this.lockFd); this.lockFd = null; }
  }
}

export function readDepartmentGenerationAuthority(directory: string): { token: string; snapshot: DepartmentGenerationAuthoritySnapshot } | null {
  try {
    const file = path.join(directory, "authority.json"), stat = fs.statSync(file);
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) return null;
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!record(value) || !exactKeys(value, ["token", "snapshot"]) || typeof value.token !== "string" || value.token.length < 32
      || !record(value.snapshot) || !exactKeys(value.snapshot, ["version", "scope", "producerId", "claim", "state", "tickets"])) return null;
    const snapshot = value.snapshot as DepartmentGenerationAuthoritySnapshot;
    if (snapshot.version !== 2 || !isLeaderExecutionScope(snapshot.scope) || !identifier(snapshot.producerId) || !identifier(snapshot.claim)
      || !["open", "sealed"].includes(snapshot.state) || !Array.isArray(snapshot.tickets)
      || snapshot.tickets.length > MAX_TICKETS || snapshot.tickets.some(ticket => !isDepartmentGenerationTicket(ticket, snapshot.scope))) return null;
    return { token: value.token, snapshot };
  } catch { return null; }
}

export function isDepartmentGenerationAuthoritySnapshot(value: unknown): value is DepartmentGenerationAuthoritySnapshot {
  return record(value) && exactKeys(value, ["version", "scope", "producerId", "claim", "state", "tickets"])
    && value.version === 2 && isLeaderExecutionScope(value.scope) && identifier(value.producerId) && identifier(value.claim)
    && (value.state === "open" || value.state === "sealed") && Array.isArray(value.tickets) && value.tickets.length <= MAX_TICKETS
    && value.tickets.every(ticket => isDepartmentGenerationTicket(ticket, value.scope as DepartmentLeaderExecutionScope));
}
