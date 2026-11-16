import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection } from "../../../runtime/departmentexecutionidentity";
import { createDepartmentRuntimeSnapshot, type DepartmentExecutionBinding } from "../../../extensionHost/departmentruntimestate";
import { DepartmentRuntimeStore, type DepartmentStoredRuntime } from "../../../extensionHost/departmentruntimestore";
import { DepartmentLeaderExecutionLedger, type DepartmentExecutionResponsibility, type DepartmentLeaderExecutionScope,
  type DepartmentLeaderExecutionProducer, type DepartmentLeaderProducerClosure } from "../../../extensionHost/departmentleaderexecutionledger";

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
/** Test capability ONLY. This fixture's controlled admissions stand in for a
 * future native coordinator lifecycle; it is NOT production producer evidence. */
export class FixtureLeaderProducer implements DepartmentLeaderExecutionProducer {
  readonly producerId = "fixture-producer";
  current = true;
  fenced = false;
  private readonly pending = new Set<Promise<unknown>>();
  beginTracking(): boolean { return this.current && !this.fenced; }
  isCurrent(): boolean { return this.current; }
  withAdmission<T>(_scope: DepartmentLeaderExecutionScope, work: () => Promise<T>): Promise<T> {
    if (this.fenced) return Promise.reject(new Error("fixture-admission-fenced"));
    const operation = work(); this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    return operation;
  }
  async closeAdmissionsAndDrain(scope: DepartmentLeaderExecutionScope): Promise<DepartmentLeaderProducerClosure> {
    this.fenced = true;
    await Promise.allSettled([...this.pending]);
    return { version: 1, scope: structuredClone(scope), producerId: this.producerId, admissionFence: "fixture-native-fence" };
  }
}
export function ledgerSetup(t: import("node:test").TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-ledger-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scope: DepartmentLeaderExecutionScope = { rootTaskId: "root", workspace: "workspace", leaderTaskId: "leader", moduleId: "module", generation: 1 };
  const value: DepartmentStoredRuntime = { version: 1, rootTaskId: "root", workspaceKey: "workspace", runtime: createDepartmentRuntimeSnapshot("root"),
    capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: ["module"],
      employees: ["attempt-1", "attempt-2", "attempt-3"].map((attempt) => JSON.stringify(["leader", attempt])) } };
  value.runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", generation: 1, status: "running" });
  const storeDirectory = path.join(directory, "runtime"), store = new DepartmentRuntimeStore(storeDirectory);
  assert.deepEqual(store.write(value), { ok: true });
  const producer = new FixtureLeaderProducer(), ledger = new DepartmentLeaderExecutionLedger(store, producer);
  const owners = path.join(directory, "owners");
  const binding = (role: "leader" | "employee", index = 1): DepartmentExecutionBinding => {
    const selection: DepartmentExecutionSelection = { version: 1, role, cli: "codex", configId: "profile", revision: "revision-1",
      model: role + "-model", thinkingMode: "off", openCodeVariant: null };
    const executionId = role + "-" + index;
    return { identity: { version: 1, ...scope, role, cli: "codex", ownerId: "owner", executionId,
      session: { state: "bound", id: "fixture-session-" + executionId }, ...fingerprintDepartmentExecutionSelection(selection),
      ...(role === "employee" ? { subtaskId: "subtask-" + index, attemptId: "attempt-" + index } : {}) }, selection,
    requirements: { processTerminal: true, turnTerminal: false, streams: true, runner: true, executionRoot: true, links: true, temp: true, tab: true } } as DepartmentExecutionBinding;
  };
  const responsibility = (b: DepartmentExecutionBinding): DepartmentExecutionResponsibility => ({ registrationId: b.identity.executionId,
    target: b.identity.role === "leader" ? { role: "leader" } : { role: "employee", subtaskId: b.identity.subtaskId, attemptId: b.identity.attemptId },
    selection: structuredClone(b.selection), requirements: structuredClone(b.requirements) });
  const add = async (b: DepartmentExecutionBinding): Promise<void> => ledger.admit(scope, responsibility(b), async (bind) => {
    assert.deepEqual(bind(b), { ok: true });
  });
  const read = () => { const result = store.read("root", "workspace"); assert.ok(result.ok && result.value); return result.value; };
  const file = path.join(storeDirectory, Buffer.from("root").toString("hex") + ".json");
  return { directory, scope, value, storeDirectory, store, producer, ledger, binding, responsibility, add, read, file, owners };
}
