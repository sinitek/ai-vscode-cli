import { randomUUID } from "crypto";
import * as net from "net";
import * as path from "path";
import { CLEANUP_PARTS, canonicalIdentity, isCleanupRequirements, isDepartmentExecutionIdentity, record, sameExecution,
  type CleanupRequirements, type DepartmentExecutionIdentity } from "./departmentexecutionidentity";
import { departmentExecutionOwnerEndpoint, type ExecutionObservation } from "./departmentexecutionowner";
import { identityMatchesQuery, isDepartmentExecutionReceipt, type DepartmentExecutionReceipt } from "./departmentexecutionreceiptstore";

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 3_000;
// Live/finalizing observations never expire an execution. The cap limits steady-state IPC to
// at most 12 requests/minute per waiter (and requests are always serial).
export const CLEANUP_OBSERVATION_INITIAL_DELAY_MS = 250;
export const CLEANUP_OBSERVATION_MAX_DELAY_MS = 5_000;

type OwnerResponse = { version: 1; requestId: string; result: unknown };

export class DepartmentExecutionOwnerClient {
  // Only waitForCleanup can populate this private capability, after strict socket
  // and caller-policy validation. Never hydrate it from a receipt file or caller.
  readonly #completed = new Map<string, DepartmentExecutionReceipt>();
  // Original lifecycle witnesses run before callers can acknowledge cleanup and
  // retire the only authenticated Owner endpoint. Never accepts caller receipts.
  readonly #witnesses = new Set<(identity: DepartmentExecutionIdentity, requirements: CleanupRequirements) => Promise<void>>();
  public retainCleanupWitness(witness: (identity: DepartmentExecutionIdentity, requirements: CleanupRequirements) => Promise<void>): void {
    if (this.#witnesses.size >= 4) throw new Error("cleanup-witness-capacity");
    this.#witnesses.add(witness);
  }
  private async witness(identity: DepartmentExecutionIdentity, requirements: CleanupRequirements): Promise<void> {
    for (const observe of this.#witnesses) await observe(structuredClone(identity), structuredClone(requirements));
  }
  private readonly directory: string;
  private readonly endpoint: string;

  public constructor(directory: string) {
    this.directory = path.resolve(directory);
    this.endpoint = departmentExecutionOwnerEndpoint(this.directory);
  }

  public startExecution(identity: DepartmentExecutionIdentity): Promise<ExecutionObservation> {
    if (!isDepartmentExecutionIdentity(identity)) {
      return Promise.resolve({ status: "conflict", identity, reason: "invalid-client-identity" });
    }
    return this.send({ version: 1, requestId: randomUUID(), operation: "start", identity });
  }

  /** Exact original endpoint only; a seal response is never a cleanup receipt. */
  public sealExecution(identity: DepartmentExecutionIdentity): Promise<ExecutionObservation> {
    if (!isDepartmentExecutionIdentity(identity) || identity.session.state !== "bound")
      return Promise.resolve({ status: "conflict", identity, reason: "invalid-client-identity" });
    return this.send({ version: 1, requestId: randomUUID(), operation: "seal", identity });
  }
  public observeExecution(identity: DepartmentExecutionIdentity): Promise<ExecutionObservation> {
    if (!isDepartmentExecutionIdentity(identity)) return Promise.resolve({ status: "conflict", identity, reason: "invalid-client-identity" });
    return this.send({ version: 1, requestId: randomUUID(), operation: "observe", identity });
  }

  public handoffExecution(identity: DepartmentExecutionIdentity, expectedClaimGeneration: number): Promise<ExecutionObservation> {
    if (!isDepartmentExecutionIdentity(identity) || !Number.isSafeInteger(expectedClaimGeneration) || expectedClaimGeneration < 1) {
      return Promise.resolve({ status: "conflict", identity, reason: "invalid-handoff-claim" });
    }
    return this.send({ version: 1, requestId: randomUUID(), operation: "handoff", identity, expectedClaimGeneration });
  }

  /** Read-only recovery port. It neither starts nor hands off an execution.
   * The caller must supply its persisted, bound identity and trusted cleanup policy.
   * Rejection (including cancellation) NEVER proves cleanup or releases a lease.
   */
  public async waitForCleanup(identity: DepartmentExecutionIdentity, requirements: CleanupRequirements,
    signal?: AbortSignal): Promise<DepartmentExecutionReceipt> {
    if (!isDepartmentExecutionIdentity(identity) || identity.session.state !== "bound"
      || !isCleanupRequirements(requirements)) throw new Error("invalid-cleanup-observation-contract");
    const expected = structuredClone(identity), policy = structuredClone(requirements);
    if (signal?.aborted) throw new Error("cleanup-observation-cancelled");
    const key = canonicalIdentity(expected), cached = this.#completed.get(key);
    if (cached) {
      if (!CLEANUP_PARTS.every((part) => cached.requirements[part] === policy[part]))
        throw new Error("cleanup-observation-identity-or-policy-conflict");
      await this.witness(expected, policy);
      return structuredClone(cached);
    }
    if (this.#completed.size >= 256) throw new Error("cleanup-observation-capacity");
    let delayMs = CLEANUP_OBSERVATION_INITIAL_DELAY_MS;
    for (;;) {
      if (signal?.aborted) throw new Error("cleanup-observation-cancelled");
      const observed = await this.send({ version: 1, requestId: randomUUID(), operation: "observe", identity: expected }, signal);
      if (signal?.aborted) throw new Error("cleanup-observation-cancelled");
      // Another waiter on this ORIGINAL client may have validated the complete
      // receipt and retired the endpoint while this request was in flight.
      // Never use a new client's/disk receipt; reapply this caller's full policy.
      const concurrent = this.#completed.get(key);
      if (concurrent) {
        if (!CLEANUP_PARTS.every(part => concurrent.requirements[part] === policy[part]))
          throw new Error("cleanup-observation-identity-or-policy-conflict");
        await this.witness(expected, policy); return structuredClone(concurrent);
      }
      if (observed.status === "cleaned") {
        if (!sameExecution(observed.identity, expected)
          || !CLEANUP_PARTS.every((part) => observed.receipt.requirements[part] === policy[part])) {
          throw new Error("cleanup-observation-identity-or-policy-conflict");
        }
        if (!this.#completed.has(key) && this.#completed.size >= 256) throw new Error("cleanup-observation-capacity");
        this.#completed.set(key, structuredClone(observed.receipt));
        await this.witness(expected, policy);
        return structuredClone(observed.receipt);
      }
      if (observed.status !== "live" && observed.status !== "finalizing") throw new Error("cleanup-observation-" + observed.status + ":" + observed.reason);
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          reject(new Error("cleanup-observation-cancelled"));
        };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, delayMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
      delayMs = Math.min(delayMs * 2, CLEANUP_OBSERVATION_MAX_DELAY_MS);
    }
  }

  private send(request: Record<string, unknown>, signal?: AbortSignal): Promise<ExecutionObservation> {
    // The identity used to validate the response must not change while IPC is in flight.
    request = structuredClone(request);
    const identity = request.identity as DepartmentExecutionIdentity;
    return new Promise((resolve) => {
      let settled = false;
      let buffer = Buffer.alloc(0);
      const socket = net.createConnection(this.endpoint);
      const finish = (result: ExecutionObservation): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        socket.destroy();
        resolve(result);
      };
      const onAbort = (): void => finish({ status: "unknown", identity, reason: "cleanup-observation-cancelled" });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => finish({ status: "unknown", identity, reason: "owner-response-timeout" }));
      socket.once("connect", () => {
        socket.write(JSON.stringify(request) + "\n");
      });
      socket.on("data", (chunk) => {
        if (buffer.length + chunk.length > MAX_MESSAGE_BYTES) {
          finish({ status: "unknown", identity, reason: "owner-response-too-large" });
          return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) return;
        if (newline !== buffer.length - 1) {
          finish({ status: "unknown", identity, reason: "invalid-owner-frame" });
          return;
        }
        let response: unknown;
        try { response = JSON.parse(buffer.subarray(0, newline).toString("utf8")); }
        catch { finish({ status: "unknown", identity, reason: "invalid-owner-response" }); return; }
        if (!isOwnerResponse(response) || response.requestId !== request.requestId || !isObservation(response.result)
          || !identityMatchesQuery(response.result.identity, identity)) {
          finish({ status: "unknown", identity, reason: "invalid-owner-response" });
          return;
        }
        finish(response.result);
      });
      socket.once("error", () => finish({ status: "unknown", identity, reason: "owner-unreachable" }));
      socket.once("close", () => {
        if (!settled) finish({ status: "unknown", identity, reason: "owner-disconnected" });
      });
    });
  }
}

function isOwnerResponse(value: unknown): value is OwnerResponse {
  return record(value) && Object.keys(value).length === 3 && value.version === PROTOCOL_VERSION
    && typeof value.requestId === "string" && value.requestId.length <= 64 && "result" in value;
}

function isObservation(value: unknown): value is ExecutionObservation {
  if (!record(value) || !["live", "finalizing", "cleaned", "unknown", "conflict"].includes(value.status as string)
    || !isDepartmentExecutionIdentity(value.identity)) return false;
  if (value.status === "live" || value.status === "finalizing") return Object.keys(value).length === 3
    && Number.isSafeInteger(value.claimGeneration) && (value.claimGeneration as number) >= 1;
  if (value.status === "cleaned") return Object.keys(value).length === 3 && isDepartmentExecutionReceipt(value.receipt)
    && sameExecution(value.receipt.identity, value.identity);
  return Object.keys(value).length === 3 && typeof value.reason === "string" && value.reason.length <= 256;
}
