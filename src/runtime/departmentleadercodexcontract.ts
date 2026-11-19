import { CLEANUP_PARTS, exactKeys, fingerprintDepartmentExecutionSelection, isDepartmentExecutionIdentity,
  isExecutionCleanup, record, type CleanupRequirements, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import { boundedCodexMessage, CODEX_OWNER_MESSAGE_LIMIT } from "./departmentcodexpreparationcontract";
import type { CodexRunnerOptions } from "../interactive/codexRunnerCore";
import type { ExecutionTerminalEvidence } from "./departmentexecutionowner";
import { createHash } from "crypto";

export const LEADER_INVOCATION_LIMIT = 128;
export const LEADER_CALLBACK_LIMIT = 32;
/** Logical UTF-8 JSON args, not base64 wire bytes. Includes callbacks awaiting consumption. */
export const LEADER_CALLBACK_BYTES = 8 * 1024 * 1024;
export const LEADER_CALLBACK_PENDING_BYTES = 16 * 1024 * 1024;
export const LEADER_CALLBACK_CHUNK_BYTES = 24 * 1024;
export const LEADER_CALLBACK_CHUNK_LIMIT = Math.ceil(LEADER_CALLBACK_BYTES / LEADER_CALLBACK_CHUNK_BYTES);
export const LEADER_FRAGMENT_CALLBACKS = ["onAssistantDelta", "onTrace", "onTaskListUpdate", "onEvent",
  "onTokenUsageUpdate", "onSubagentUpdate", "onNotification"] as const;
/** Fixed redacted worker failure stages, authenticated on the original private channel. */
export const LEADER_WORKER_FAILURES = ["preparation-failed", "private-command-rejected", "private-phase-rejected",
  "private-channel-lost", "private-send-failed", "callback-capacity", "callback-message-rejected", "callback-ack-unknown",
  "callback-size-limit", "callback-serialization-failed", "callback-channel-disconnected",
  "invocation-failed", "grant-rejected"] as const;
export const LEADER_REQUIREMENTS: Readonly<CleanupRequirements> = Object.freeze(Object.fromEntries(CLEANUP_PARTS.map((p) => [p, true])) as CleanupRequirements);
export const LEADER_CALLBACKS = ["onAssistantDelta", "onTrace", "onTaskListUpdate", "onThreadId", "onTurnCompleted", "onEvent",
  "onTokenUsageUpdate", "onSubagentUpdate", "onRequest", "onNotification", "logInfo", "logError"] as const;

type CallbackEnvelope = { version: 1; token: string; identity: DepartmentExecutionIdentity; sequence: number };
export type LeaderCallback = { sequence: number; invocationId: string; name: string; args: unknown[] };
const callbackBase = ["version", "token", "identity", "sequence", "type", "invocationId", "name"];
const fragmentNames: readonly string[] = LEADER_FRAGMENT_CALLBACKS;
const callbackNames: readonly string[] = LEADER_CALLBACKS;
const callbackError = (stage: string): never => { throw new Error(stage); };

/** Only private stream data may be fragmented. Serialization is performed before
 * reserving a callback sequence or sending anything; no partial fallback/retry. */
export function leaderCallbackFrames(envelope: CallbackEnvelope, invocationId: string, name: string, args: unknown[]) {
  let json: string, message: string;
  try {
    json = JSON.stringify(args);
    // Snapshot once: custom serialization cannot change the measured args
    // between the small-frame check and the fragmented representation.
    message = JSON.stringify({ ...envelope, type: "callback", invocationId, name, args: JSON.parse(json) });
  }
  catch { return callbackError("callback-serialization-failed"); }
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > LEADER_CALLBACK_BYTES) return callbackError("callback-size-limit");
  if (Buffer.byteLength(message, "utf8") <= CODEX_OWNER_MESSAGE_LIMIT) return { bytes, frames: [JSON.parse(message) as Record<string, unknown>] };
  if (!fragmentNames.includes(name)) return callbackError("callback-size-limit");
  const payload = Buffer.from(json, "utf8"), count = Math.ceil(bytes / LEADER_CALLBACK_CHUNK_BYTES);
  const digest = createHash("sha256").update(payload).digest("hex");
  const frames: Record<string, unknown>[] = [];
  for (let index = 0; index < count; index++) frames.push({ ...envelope, sequence: envelope.sequence + index,
    type: "callback-chunk", invocationId, name, callbackSequence: envelope.sequence, index, count, totalBytes: bytes, digest,
    data: payload.subarray(index * LEADER_CALLBACK_CHUNK_BYTES, (index + 1) * LEADER_CALLBACK_CHUNK_BYTES).toString("base64") });
  if (frames.some((frame) => !boundedCodexMessage(frame))) return callbackError("callback-size-limit");
  return { bytes, frames };
}

/** Outer token, identity, global sequence and active invocation are authenticated
 * by bootstrap before entry. Slots/budget stay reserved until the single ACK.
 * Initial arrival order also applies when short callbacks interleave chunks. */
export class LeaderCallbackAssembler {
  private entries = new Map<number, { invocationId: string; name: string; bytes: number; count: number; digest: string;
    parts: Buffer[]; next: number; args?: unknown[]; delivered: boolean }>();
  private queue: number[] = [];
  private bytes = 0;
  get size(): number { return this.entries.size; }
  get incomplete(): boolean { return this.queue.length > 0; }
  clear(): void { this.entries.clear(); this.queue = []; this.bytes = 0; }
  release(sequence: number): void {
    const entry = this.entries.get(sequence);
    if (!entry?.delivered) return callbackError("callback-fragment-rejected");
    this.bytes -= entry.bytes; this.entries.delete(sequence);
  }
  accept(v: Record<string, unknown>): LeaderCallback[] {
    const reject = (): never => callbackError("callback-fragment-rejected");
    if (typeof v.name !== "string" || !callbackNames.includes(v.name) || typeof v.invocationId !== "string") return reject();
    const fragmented = v.type === "callback-chunk";
    if (!exactKeys(v, [...callbackBase, ...(fragmented ? ["callbackSequence", "index", "count", "totalBytes", "digest", "data"] : ["args"])])) return reject();
    let sequence: number, bytes: number, part: Buffer | undefined;
    if (fragmented) {
      if (!fragmentNames.includes(v.name) || !Number.isSafeInteger(v.callbackSequence) || Number(v.callbackSequence) < 1
        || !Number.isSafeInteger(v.index) || Number(v.index) < 0 || !Number.isSafeInteger(v.count) || Number(v.count) < 2
        || Number(v.count) > LEADER_CALLBACK_CHUNK_LIMIT || !Number.isSafeInteger(v.totalBytes) || Number(v.totalBytes) < 1
        || typeof v.digest !== "string" || !/^[a-f0-9]{64}$/.test(v.digest) || typeof v.data !== "string"
        || v.data.length > 4 * Math.ceil(LEADER_CALLBACK_CHUNK_BYTES / 3)) return reject();
      sequence = Number(v.callbackSequence); bytes = Number(v.totalBytes);
      if (bytes > LEADER_CALLBACK_BYTES) return callbackError("callback-size-limit");
      if (Number(v.count) !== Math.ceil(bytes / LEADER_CALLBACK_CHUNK_BYTES) || Number(v.index) >= Number(v.count)
        || Number(v.sequence) < sequence || (v.index === 0 && v.sequence !== sequence)) return reject();
      part = Buffer.from(v.data, "base64");
      if (part.toString("base64") !== v.data || part.length !== Math.min(LEADER_CALLBACK_CHUNK_BYTES,
        bytes - Number(v.index) * LEADER_CALLBACK_CHUNK_BYTES)) return reject();
    } else {
      if (v.type !== "callback" || !Array.isArray(v.args) || v.args.length > 3) return reject();
      sequence = Number(v.sequence); bytes = Buffer.byteLength(JSON.stringify(v.args), "utf8");
    }
    let entry = this.entries.get(sequence);
    if (!entry) {
      if (fragmented && v.index !== 0) return reject();
      if (this.entries.size >= LEADER_CALLBACK_LIMIT) return callbackError("callback-capacity");
      if (this.bytes + bytes > LEADER_CALLBACK_PENDING_BYTES) return callbackError("callback-size-limit");
      entry = { invocationId: v.invocationId, name: v.name, bytes, count: fragmented ? Number(v.count) : 1,
        digest: fragmented ? String(v.digest) : "", parts: [], next: 0, delivered: false };
      this.entries.set(sequence, entry); this.bytes += bytes; this.queue.push(sequence);
    } else if (!fragmented || entry.delivered || entry.args) return reject();
    if (fragmented) {
      if (entry.next !== v.index || entry.count !== v.count || entry.bytes !== bytes || entry.digest !== v.digest
        || entry.name !== v.name || entry.invocationId !== v.invocationId) return reject();
      entry.parts.push(part!); entry.next++;
      if (entry.next === entry.count) {
        const payload = Buffer.concat(entry.parts, bytes);
        if (createHash("sha256").update(payload).digest("hex") !== entry.digest) return reject();
        const json = payload.toString("utf8");
        if (!Buffer.from(json, "utf8").equals(payload)) return reject();
        try { entry.args = JSON.parse(json); } catch { return reject(); }
        if (!Array.isArray(entry.args) || entry.args.length > 3) return reject();
        entry.parts = [];
      }
    } else entry.args = v.args as unknown[];
    const ready: LeaderCallback[] = [];
    while (this.queue.length) {
      const head = this.entries.get(this.queue[0])!;
      if (!head.args) break;
      const seq = this.queue.shift()!;
      ready.push({ sequence: seq, name: head.name, invocationId: head.invocationId, args: head.args });
      head.args = undefined; head.delivered = true;
    }
    return ready;
  }
}
export { isDepartmentLeaderInvocation as isLeaderInvocation } from "./departmentleaderinvocation";
export type { DepartmentLeaderInvocation as LeaderInvocation } from "./departmentleaderinvocation";
export type LeaderCodexDescription = {
  configurationDirectory: string; workspaceDirectory: string; runner: CodexRunnerOptions;
  macTaskShell: "bash" | "zsh"; requestUserInputEnabled: boolean;
};
export type LeaderCodexPreparation = LeaderCodexDescription & {
  version: 1; token: string; identity: DepartmentExecutionIdentity; selection: DepartmentExecutionSelection; ownerDirectory: string;
};
export function isLeaderTerminal(value: unknown): value is ExecutionTerminalEvidence {
  return record(value) && exactKeys(value, ["processTerminal", "turnTerminal", "streams"])
    && isExecutionCleanup({ ...Object.fromEntries(CLEANUP_PARTS.map((p) => [p, { status: "unobservable", reason: "validation" }])), ...value });
}
export function isLeaderCodexPreparation(v: unknown): v is LeaderCodexPreparation {
  if (!record(v) || !exactKeys(v, ["version", "token", "identity", "selection", "ownerDirectory", "configurationDirectory",
    "workspaceDirectory", "runner", "macTaskShell", "requestUserInputEnabled"]) || v.version !== 1
    || typeof v.token !== "string" || !/^[a-f0-9]{64}$/.test(v.token) || !isDepartmentExecutionIdentity(v.identity)
    || v.identity.role !== "leader" || v.identity.cli !== "codex" || !["bash", "zsh"].includes(String(v.macTaskShell))
    || typeof v.requestUserInputEnabled !== "boolean" || ![v.ownerDirectory, v.configurationDirectory, v.workspaceDirectory]
      .every((p) => typeof p === "string" && !!p.trim() && !p.includes("\0"))) return false;
  try {
    const s = v.selection as DepartmentExecutionSelection, f = fingerprintDepartmentExecutionSelection(s);
    if (s.role !== "leader" || s.cli !== "codex" || !s.configId || s.openCodeVariant !== null
      || f.configFingerprint !== v.identity.configFingerprint || f.profileFingerprint !== v.identity.profileFingerprint) return false;
    const r = v.runner;
    if (!record(r) || !exactKeys(r, ["command", "args", "env", "thinkingMode", "interactiveMode", "model", "threadId", "configFingerprint"])
      || typeof r.command !== "string" || !r.command.trim() || r.command.includes("\0") || !Array.isArray(r.args) || r.args.length > 4096
      || !r.args.every((a) => typeof a === "string" && !a.includes("\0")) || !record(r.env)
      || !Object.entries(r.env).every(([k, val]) => !!k && !/[=\0]/.test(k) && (val === undefined || typeof val === "string" && !val.includes("\0")))
      || r.thinkingMode !== s.thinkingMode || !["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"].includes(String(r.thinkingMode))
      || r.model !== s.model || r.configFingerprint !== v.identity.configFingerprint || r.interactiveMode !== "coding"
      || r.threadId !== (v.identity.session.state === "bound" ? v.identity.session.id : null)) return false;
  } catch { return false; }
  return boundedCodexMessage(v, 4 * 1024 * 1024);
}
