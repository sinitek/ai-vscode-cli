import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { cleanupComplete, exactKeys, executionSlot, isCleanupRequirements, isDepartmentExecutionIdentity, isExecutionCleanup,
  record, sameExecution, type CleanupRequirements, type DepartmentExecutionCleanup, type DepartmentExecutionIdentity } from "./departmentexecutionidentity";

export type StoredExecutionState = "starting" | "live" | "cleanup-failed" | "launch-failed" | "cleaned";
export type DepartmentExecutionReceipt = {
  version: 1;
  receiptId: string;
  identity: DepartmentExecutionIdentity;
  ownerId: string;
  claimGeneration: number;
  completedAt: number;
  requirements: CleanupRequirements;
  cleanup: DepartmentExecutionCleanup;
};
export type StoredDepartmentExecution = {
  version: 1;
  identity: DepartmentExecutionIdentity;
  state: StoredExecutionState;
  revision: number;
  claimGeneration: number;
  requirements: CleanupRequirements;
  updatedAt: number;
  receipt?: DepartmentExecutionReceipt;
};
export type ReceiptRead = { kind: "missing" } | { kind: "ok"; value: StoredDepartmentExecution }
  | { kind: "corrupt"; reason: "invalid-json" | "invalid-record" | "identity-conflict" };
const MAX_RECORD_BYTES = 256 * 1024;
const SLOT_INDEX_MARKER = ".slot-index-v1";

export class DepartmentExecutionReceiptStore {
  private readonly directory: string;
  private indexReady = false;
  private indexValid = true;

  public constructor(directory: string) {
    this.directory = path.resolve(directory);
    ensurePrivateDirectory(this.directory);
  }

  public read(executionId: string, expected?: DepartmentExecutionIdentity): ReceiptRead {
    const file = this.file(executionId);
    let raw: string;
    try {
      if (fs.statSync(file).size > MAX_RECORD_BYTES) return { kind: "corrupt", reason: "invalid-record" };
      raw = fs.readFileSync(file, "utf8");
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      throw error;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { kind: "corrupt", reason: "invalid-json" }; }
    if (!isStoredDepartmentExecution(parsed)) return { kind: "corrupt", reason: "invalid-record" };
    if (parsed.identity.executionId !== executionId || (expected && !identityMatchesQuery(parsed.identity, expected))) {
      return { kind: "corrupt", reason: "identity-conflict" };
    }
    return { kind: "ok", value: structuredClone(parsed) };
  }

  public write(value: StoredDepartmentExecution, expectedRevision: number | null): StoredDepartmentExecution {
    if (!isStoredDepartmentExecution(value)) throw new Error("invalid-execution-record");
    const current = this.read(value.identity.executionId);
    if (current.kind === "corrupt") throw new Error("execution-record-" + current.reason);
    if (expectedRevision === null ? current.kind !== "missing"
      : current.kind !== "ok" || current.value.revision !== expectedRevision) {
      throw new Error("execution-record-revision-conflict");
    }
    if (expectedRevision === null) {
      if (value.state !== "starting" || value.revision !== 1) throw new Error("execution-record-must-start-starting");
    } else if (current.kind === "ok" && !validTransition(current.value, value)) {
      throw new Error("execution-record-transition-conflict");
    }
    const next = { ...structuredClone(value), revision: expectedRevision === null ? 1 : expectedRevision + 1, updatedAt: Date.now() };
    if (!isStoredDepartmentExecution(next)) throw new Error("invalid-execution-record");
    if (expectedRevision === null) {
      if (!this.ensureSlotIndex()) throw new Error("execution-slot-index-unverifiable");
      const slot = executionSlot(next.identity);
      const indexed = this.readSlot(slot);
      const indexedRecord = indexed.kind === "ok" ? this.read(indexed.value.executionId, indexed.value.identity) : null;
      if (indexed.kind === "corrupt" || (indexed.kind === "ok"
        && (indexed.value.generation >= next.identity.generation || indexedRecord?.kind !== "ok"
          || indexedRecord.value.state !== "cleaned"))) {
        throw new Error("execution-slot-index-conflict");
      }
      atomicWrite(this.seenFile(slot), "1");
      this.writeSlot(slot, { version: 1, slot, executionId: next.identity.executionId,
        generation: next.identity.generation, identity: structuredClone(next.identity) });
    }
    atomicWrite(this.file(next.identity.executionId), JSON.stringify(next));
    return next;
  }

  public checkSlot(identity: DepartmentExecutionIdentity): "available" | "conflict" | "unknown" {
    if (!this.ensureSlotIndex()) return "unknown";
    const slot = executionSlot(identity);
    const indexed = this.readSlot(slot);
    if (indexed.kind === "missing") return this.slotWasSeen(slot) ? "unknown" : "available";
    if (indexed.kind !== "ok") return "unknown";
    if (indexed.value.generation >= identity.generation) return "conflict";
    const current = this.read(indexed.value.executionId, indexed.value.identity);
    if (current.kind !== "ok" || current.value.identity.generation !== indexed.value.generation) return "unknown";
    return current.value.state === "cleaned" ? "available" : "conflict";
  }

  public makeStarting(identity: DepartmentExecutionIdentity, requirements: CleanupRequirements): StoredDepartmentExecution {
    if (!isDepartmentExecutionIdentity(identity) || !isCleanupRequirements(requirements)) throw new Error("invalid-execution-start");
    return { version: 1, identity: structuredClone(identity), state: "starting", revision: 1, claimGeneration: 1,
      requirements: structuredClone(requirements), updatedAt: Date.now() };
  }

  public makeReceipt(identity: DepartmentExecutionIdentity, claimGeneration: number, cleanup: DepartmentExecutionCleanup,
    requirements: CleanupRequirements): DepartmentExecutionReceipt {
    if (!isDepartmentExecutionIdentity(identity) || !isExecutionCleanup(cleanup) || !isCleanupRequirements(requirements)
      || !cleanupComplete(cleanup, requirements) || identity.session.state !== "bound") {
      throw new Error("incomplete-execution-cleanup");
    }
    return { version: 1, receiptId: randomUUID(), identity: structuredClone(identity), ownerId: identity.ownerId,
      claimGeneration, completedAt: Date.now(), requirements: structuredClone(requirements), cleanup: structuredClone(cleanup) };
  }

  private file(executionId: string): string {
    const name = createHash("sha256").update(executionId).digest("hex");
    return path.join(this.directory, name + ".json");
  }

  private readFile(file: string): ReceiptRead {
    let raw: string;
    try {
      if (fs.statSync(file).size > MAX_RECORD_BYTES) return { kind: "corrupt", reason: "invalid-record" };
      raw = fs.readFileSync(file, "utf8");
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      throw error;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { kind: "corrupt", reason: "invalid-json" }; }
    if (!isStoredDepartmentExecution(parsed)) return { kind: "corrupt", reason: "invalid-record" };
    return path.basename(file) === path.basename(this.file(parsed.identity.executionId))
      ? { kind: "ok", value: structuredClone(parsed) }
      : { kind: "corrupt", reason: "identity-conflict" };
  }

  private slotFile(slot: string): string { return path.join(this.directory, slot + ".slot"); }
  private seenFile(slot: string): string { return path.join(this.directory, slot + ".seen"); }

  private slotWasSeen(slot: string): boolean {
    try { fs.readFileSync(this.seenFile(slot), "utf8"); return true; }
    catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  }

  private readSlot(slot: string): { kind: "missing" } | { kind: "ok"; value: SlotPointer } | { kind: "corrupt" } {
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(this.slotFile(slot), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      return { kind: "corrupt" };
    }
    return isSlotPointer(parsed) && parsed.slot === slot ? { kind: "ok", value: parsed } : { kind: "corrupt" };
  }

  private writeSlot(slot: string, pointer: SlotPointer): void {
    atomicWrite(this.slotFile(slot), JSON.stringify(pointer));
  }

  private ensureSlotIndex(): boolean {
    if (this.indexReady) return this.indexValid;
    this.indexReady = true;
    const marker = path.join(this.directory, SLOT_INDEX_MARKER);
    try {
      this.indexValid = fs.readFileSync(marker, "utf8") === "1";
      return this.indexValid;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return this.indexValid = false;
    }

    const bySlot = new Map<string, Map<number, StoredDepartmentExecution>>();
    try {
      for (const name of fs.readdirSync(this.directory).sort()) {
        if (!name.endsWith(".json")) continue;
        const read = this.readFile(path.join(this.directory, name));
        if (read.kind !== "ok") return this.indexValid = false;
        const slot = executionSlot(read.value.identity);
        let generations = bySlot.get(slot);
        if (!generations) bySlot.set(slot, generations = new Map());
        const generation = read.value.identity.generation;
        const previous = generations.get(generation);
        if (previous && previous.identity.executionId !== read.value.identity.executionId) return this.indexValid = false;
        generations.set(generation, read.value);
      }

      const latest = new Map<string, StoredDepartmentExecution>();
      for (const [slot, generations] of bySlot) {
        const ordered = [...generations.entries()].sort(([a], [b]) => a - b);
        const newestGeneration = ordered[ordered.length - 1]?.[0];
        for (const [generation, value] of ordered) {
          if (generation !== newestGeneration && value.state !== "cleaned") return this.indexValid = false;
        }
        const newest = newestGeneration === undefined ? undefined : generations.get(newestGeneration);
        if (!newest) return this.indexValid = false;
        latest.set(slot, newest);
      }

      // No index state is published until every historical receipt has passed validation.
      for (const [slot, value] of latest) {
        atomicWrite(this.seenFile(slot), "1");
        this.writeSlot(slot, { version: 1, slot, executionId: value.identity.executionId,
          generation: value.identity.generation, identity: structuredClone(value.identity) });
      }
      atomicWrite(marker, "1");
      return true;
    } catch { return this.indexValid = false; }
  }
}

type SlotPointer = { version: 1; slot: string; executionId: string; generation: number; identity: DepartmentExecutionIdentity };
function isSlotPointer(value: unknown): value is SlotPointer {
  return record(value) && exactKeys(value, ["version", "slot", "executionId", "generation", "identity"])
    && value.version === 1 && typeof value.slot === "string" && /^[a-f0-9]{64}$/.test(value.slot)
    && typeof value.executionId === "string" && Number.isSafeInteger(value.generation) && (value.generation as number) >= 1
    && isDepartmentExecutionIdentity(value.identity) && value.identity.executionId === value.executionId
    && value.identity.generation === value.generation && executionSlot(value.identity) === value.slot;
}

export function identityMatchesQuery(stored: DepartmentExecutionIdentity, query: DepartmentExecutionIdentity): boolean {
  if (stored.executionId !== query.executionId) return false;
  if (query.session.state === "unbound") {
    return sameExecution({ ...stored, session: { state: "unbound" } } as DepartmentExecutionIdentity,
      { ...query, session: { state: "unbound" } } as DepartmentExecutionIdentity);
  }
  return sameExecution(stored, query);
}

export function isDepartmentExecutionReceipt(value: unknown): value is DepartmentExecutionReceipt {
  if (!record(value) || !exactKeys(value, ["version", "receiptId", "identity", "ownerId", "claimGeneration", "completedAt", "requirements", "cleanup"])) return false;
  return value.version === 1 && typeof value.receiptId === "string" && value.receiptId.length <= 128
    && isDepartmentExecutionIdentity(value.identity) && value.ownerId === value.identity.ownerId
    && Number.isSafeInteger(value.claimGeneration) && (value.claimGeneration as number) >= 1
    && Number.isSafeInteger(value.completedAt) && (value.completedAt as number) >= 0
    && isCleanupRequirements(value.requirements) && isExecutionCleanup(value.cleanup)
    && cleanupComplete(value.cleanup, value.requirements) && value.identity.session.state === "bound";
}

export function isStoredDepartmentExecution(value: unknown): value is StoredDepartmentExecution {
  if (!record(value)) return false;
  const allowed = ["version", "identity", "state", "revision", "claimGeneration", "requirements", "updatedAt", "receipt"];
  if (Object.keys(value).some((key) => !allowed.includes(key))
    || !["version", "identity", "state", "revision", "claimGeneration", "requirements", "updatedAt"].every((key) => key in value)) return false;
  if (value.version !== 1 || !isDepartmentExecutionIdentity(value.identity)
    || !["starting", "live", "cleanup-failed", "launch-failed", "cleaned"].includes(value.state as string)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !Number.isSafeInteger(value.claimGeneration) || (value.claimGeneration as number) < 1
    || !isCleanupRequirements(value.requirements) || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < 0) return false;
  if (value.state === "cleaned") {
    return isDepartmentExecutionReceipt(value.receipt) && sameExecution(value.receipt.identity, value.identity)
      && value.receipt.claimGeneration === value.claimGeneration
      && JSON.stringify(value.receipt.requirements) === JSON.stringify(value.requirements)
      && cleanupComplete(value.receipt.cleanup, value.requirements);
  }
  return value.receipt === undefined;
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("unsafe-owner-directory");
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
}

function atomicWrite(file: string, text: string): void {
  const temporary = path.join(path.dirname(file), "." + path.basename(file) + "." + process.pid + "." + randomUUID() + ".tmp");
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* rename consumed it */ }
  }
}

function validTransition(previous: StoredDepartmentExecution, next: StoredDepartmentExecution): boolean {
  if (!sameIdentityExceptSession(previous.identity, next.identity)
    || JSON.stringify(previous.requirements) !== JSON.stringify(next.requirements)
    || next.claimGeneration < previous.claimGeneration
    || next.claimGeneration > previous.claimGeneration + 1) return false;
  const sessionValid = previous.identity.session.state === "unbound"
    ? next.identity.session.state === "unbound" || next.identity.session.state === "bound"
    : next.identity.session.state === "bound" && next.identity.session.id === previous.identity.session.id;
  if (!sessionValid) return false;
  if (previous.state === "cleaned" || previous.state === "launch-failed" || previous.state === "cleanup-failed") return false;
  const allowed = previous.state === "starting"
    ? ["starting", "live", "launch-failed", "cleanup-failed", "cleaned"]
    : ["live", "cleanup-failed", "cleaned"];
  if (!allowed.includes(next.state)) return false;
  if (next.claimGeneration !== previous.claimGeneration
    && !(previous.state === "live" && next.state === "live" && next.claimGeneration === previous.claimGeneration + 1)) return false;
  return true;
}

function sameIdentityExceptSession(a: DepartmentExecutionIdentity, b: DepartmentExecutionIdentity): boolean {
  return sameExecution({ ...a, session: { state: "unbound" } } as DepartmentExecutionIdentity,
    { ...b, session: { state: "unbound" } } as DepartmentExecutionIdentity);
}
