import { randomUUID } from "crypto";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { exactKeys, isDepartmentExecutionIdentity, record, sameExecution,
  type CleanupRequirements, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import { DEPARTMENT_GENERATION_REQUEST_MAX_BYTES, DEPARTMENT_GENERATION_RESPONSE_MAX_BYTES,
  departmentGenerationAuthorityEndpoint, isDepartmentGenerationAuthoritySnapshot, readDepartmentGenerationAuthority,
  type DepartmentGenerationRecovery, type DepartmentGenerationAuthoritySnapshot, type DepartmentGenerationTicket } from "./departmentgenerationauthority";
import { isProducerClosure, isLeaderExecutionScope, leaderExecutionScopeKey, type DepartmentLeaderExecutionScope } from "../extensionHost/departmentleaderexecutionledger";

const TIMEOUT_MS = 3_000;
type Operation = "observe" | "claim" | "ticket" | "bind" | "grant" | "consume" | "release" | "unknown" | "seal" | "native-source" | "native-stopped" | "witness" | "control" | "recovery" | "retire";
type Response = { version: 2; requestId: string; result: { ok: true; claim: string; snapshot: DepartmentGenerationAuthoritySnapshot; recovery?: DepartmentGenerationRecovery }
  | { ok: false; reason: string } };

/** Authenticated client for the original independent generation coordinator. */
export class DepartmentGenerationAuthorityClient {
  private readonly directory: string;
  private readonly scope: DepartmentLeaderExecutionScope;
  private readonly token: string;
  private readonly producerProof?: string;
  private readonly expectedProducerId: string;
  private claim: string;
  constructor(directory: string, scope: DepartmentLeaderExecutionScope, expectedProducerId: string, producerProof?: string, private readonly deadline?: number) {
    this.directory = directory; this.scope = structuredClone(scope); this.expectedProducerId = expectedProducerId;
    if (!isLeaderExecutionScope(scope)) throw new Error("department-generation-authority-scope-invalid");
    const record = readDepartmentGenerationAuthority(directory);
    if (!record || leaderExecutionScopeKey(record.snapshot.scope) !== leaderExecutionScopeKey(scope)
      || record.snapshot.producerId !== expectedProducerId || !record.snapshot.claim) throw new Error("department-generation-authority-unavailable");
    this.token = record.token; this.claim = record.snapshot.claim;
    if (producerProof !== undefined && producerProof.length < 32) throw new Error("department-generation-authority-producer-proof-invalid");
    this.producerProof = producerProof;
  }
  async registerNativeSource(ticket: DepartmentGenerationTicket, directory: string): Promise<void> {
    await this.request("native-source", ticket, this.claim, this.requiredProducerProof(), undefined, directory);
  }
  async nativeStopped(ticket: DepartmentGenerationTicket): Promise<void> {
    await this.request("native-stopped", ticket, this.claim, this.requiredProducerProof());
  }
  async witness(ticket: DepartmentGenerationTicket): Promise<void> { await this.request("witness", ticket, this.claim, this.requiredProducerProof()); }
  async control(id: string): Promise<DepartmentGenerationRecovery> {
    const result = await this.request("control", undefined, this.claim, undefined, id);
    if (!result.recovery) throw new Error("department-generation-authority-recovery-unavailable");
    return result.recovery;
  }
  async retire(id: string): Promise<void> {
    await this.request("retire", undefined, this.claim, undefined, id);
    // ACK only accepts retirement. Wait for the original service to release its
    // own lock/endpoint; never remove either from this client.
    const deadline = Date.now() + TIMEOUT_MS;
    while (fs.existsSync(path.join(this.directory, "authority.lock"))
      || process.platform !== "win32" && fs.existsSync(departmentGenerationAuthorityEndpoint(this.directory))) {
      if (Date.now() >= deadline) throw new Error("department-generation-authority-retirement-unconfirmed");
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
  }
  async recovery(id: string): Promise<DepartmentGenerationRecovery> {
    const result = await this.request("recovery", undefined, this.claim, undefined, id);
    if (!result.recovery) throw new Error("department-generation-authority-recovery-unavailable");
    return result.recovery;
  }
  async observe(): Promise<DepartmentGenerationAuthoritySnapshot> { return (await this.request("observe")).snapshot; }
  async claimSealed(expectedClaim: string): Promise<DepartmentGenerationAuthoritySnapshot> {
    const result = await this.request("claim", undefined, expectedClaim); this.claim = result.claim; return result.snapshot;
  }
  async registerTicket(ticket: DepartmentGenerationTicket): Promise<void> { await this.request("ticket", ticket, this.claim, this.requiredProducerProof()); }
  async bindTicket(ticket: DepartmentGenerationTicket, identity: DepartmentExecutionIdentity): Promise<void> {
    if (!isDepartmentExecutionIdentity(identity) || identity.session.state !== "bound" || identity.session.id !== ticket.nativeSessionId
      || identity.rootTaskId !== this.scope.rootTaskId || identity.workspace !== this.scope.workspace || identity.leaderTaskId !== this.scope.leaderTaskId
      || identity.moduleId !== this.scope.moduleId || identity.generation !== this.scope.generation
      || ticket.target.role !== identity.role || ticket.target.role === "employee" && (identity.role !== "employee"
        || identity.subtaskId !== ticket.target.subtaskId || identity.attemptId !== ticket.target.attemptId)) throw new Error("department-generation-authority-binding-conflict");
    await this.request("bind", { ...structuredClone(ticket), identity: structuredClone(identity), state: "bound" }, this.claim, this.requiredProducerProof()); ticket.identity = structuredClone(identity); ticket.state = "bound";
  }
  async grant(ticket: DepartmentGenerationTicket): Promise<void> { await this.request("grant", { ...structuredClone(ticket), state: "granted" }, this.claim, this.requiredProducerProof()); ticket.state = "granted"; }
  async consume(ticket: DepartmentGenerationTicket): Promise<void> { await this.request("consume", { ...structuredClone(ticket), state: "started" }, this.claim, this.requiredProducerProof()); ticket.state = "started"; }
  async release(ticket: DepartmentGenerationTicket): Promise<void> { await this.request("release", { ...structuredClone(ticket), state: "released" }, this.claim, this.producerProof); ticket.state = "released"; }
  async markUnknown(ticket: DepartmentGenerationTicket): Promise<void> { await this.request("unknown", { ...structuredClone(ticket), state: "unknown" }, this.claim, this.producerProof); ticket.state = "unknown"; }
  async seal(): Promise<DepartmentGenerationAuthoritySnapshot> { return (await this.request("seal")).snapshot; }
  currentClaim(): string { return this.claim; }
  private requiredProducerProof(): string {
    if (!this.producerProof) throw new Error("department-generation-authority-original-producer-required");
    return this.producerProof;
  }
  private async request(operation: Operation, ticket?: DepartmentGenerationTicket, expectedClaim = this.claim,
    producerProof?: string, controlId?: string, nativeDirectory?: string): Promise<{ claim: string; snapshot: DepartmentGenerationAuthoritySnapshot; recovery?: DepartmentGenerationRecovery }> {
    const timeout = Math.min(TIMEOUT_MS, (this.deadline ?? Infinity) - Date.now());
    if (timeout <= 0) throw new Error("department-generation-authority-deadline");
    const requestId = randomUUID();
    const wire = JSON.stringify({ version: 2, requestId, token: this.token, scope: this.scope, expectedClaim, operation,
      ...(ticket ? { ticket } : {}), ...(producerProof ? { producerProof } : {}), ...(controlId ? { controlId } : {}), ...(nativeDirectory ? { nativeDirectory } : {}) }) + "\n";
    if (Buffer.byteLength(wire) > DEPARTMENT_GENERATION_REQUEST_MAX_BYTES) throw new Error("department-generation-authority-frame-too-large");
    const raw = await new Promise<unknown>((resolve, reject) => {
      const socket = net.createConnection(departmentGenerationAuthorityEndpoint(this.directory));
      const chunks: Buffer[] = [];
      let received = 0, settled = false;
      const finish = (error?: Error, value?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => finish(new Error("department-generation-authority-timeout")), timeout);
      socket.on("connect", () => socket.write(wire));
      socket.on("data", chunk => {
        received += chunk.length;
        if (received > DEPARTMENT_GENERATION_RESPONSE_MAX_BYTES) return finish(new Error("department-generation-authority-response-too-large"));
        const newline = chunk.indexOf(10);
        if (newline >= 0 && newline !== chunk.length - 1) return finish(new Error("department-generation-authority-response-framing"));
        chunks.push(chunk);
        if (newline < 0) return;
        try { finish(undefined, JSON.parse(Buffer.concat(chunks, received).toString("utf8", 0, received - 1))); }
        catch { finish(new Error("department-generation-authority-invalid-response")); }
      });
      socket.on("error", () => finish(new Error("department-generation-authority-unreachable")));
      socket.on("close", () => { if (!settled) finish(new Error("department-generation-authority-disconnected")); });
    });
    if (!record(raw) || !exactKeys(raw, ["version", "requestId", "result"]) || raw.version !== 2 || raw.requestId !== requestId || !record(raw.result))
      throw new Error("department-generation-authority-response-invalid");
    if (!record(raw.result)) throw new Error("department-generation-authority-response-invalid");
    if (raw.result.ok === false) {
      if (!exactKeys(raw.result, ["ok", "reason"]) || typeof raw.result.reason !== "string" || !raw.result.reason)
        throw new Error("department-generation-authority-response-invalid");
      throw new Error(raw.result.reason);
    }
    if (raw.result.ok !== true || !exactKeys(raw.result, ["ok", "claim", "snapshot", ...(controlId ? ["recovery"] : [])]))
      throw new Error("department-generation-authority-response-invalid");
    const result = raw.result as Extract<Response["result"], { ok: true }>;
    if (!isDepartmentGenerationAuthoritySnapshot(result.snapshot) || result.snapshot.producerId !== this.expectedProducerId
      || leaderExecutionScopeKey(result.snapshot.scope) !== leaderExecutionScopeKey(this.scope) || result.claim !== result.snapshot.claim)
      throw new Error("department-generation-authority-response-scope-conflict");
    if (controlId) {
      const r = result.recovery;
      if (!record(r) || !exactKeys(r, ["id", "state", "closure", "nativeSources"]) || r.id !== controlId
        || !["draining", "closed", "unknown"].includes(String(r.state))
        || (r.state === "closed" ? !isProducerClosure(r.closure, this.expectedProducerId, this.scope) : r.closure !== null))
        throw new Error("department-generation-authority-recovery-response-invalid");
      if (!Array.isArray(r.nativeSources) || r.nativeSources.length > result.snapshot.tickets.length
        || r.state !== "closed" && r.nativeSources.length !== 0
        || r.nativeSources.some(source => {
          if (!record(source) || !exactKeys(source, ["identity", "selection", "directory", "localSessionId"])
            || !isDepartmentExecutionIdentity(source.identity) || source.identity.cli !== "opencode"
            || typeof source.directory !== "string" || source.directory.length > 4096 || !path.isAbsolute(source.directory)
            || path.normalize(source.directory) !== source.directory || /[\x00-\x1f]/.test(source.directory)) return true;
          return !result.snapshot.tickets.some(t => t.state === "released" && t.identity && sameExecution(t.identity, source.identity as DepartmentExecutionIdentity)
            && JSON.stringify(t.selection) === JSON.stringify(source.selection) && t.localSessionId === source.localSessionId);
        }) || r.state === "closed" && (new Set(r.nativeSources.map(s => s.identity.executionId)).size !== r.nativeSources.length
          || result.snapshot.tickets.filter(t => t.identity?.cli === "opencode").length !== r.nativeSources.length))
        throw new Error("department-generation-authority-native-source-response-invalid");
    }
    if (operation !== "observe" && operation !== "claim" && result.claim !== expectedClaim)
      throw new Error("department-generation-authority-response-claim-conflict");
    this.claim = result.claim;
    return { claim: result.claim, snapshot: result.snapshot, ...(result.recovery ? { recovery: result.recovery } : {}) };
  }
}
