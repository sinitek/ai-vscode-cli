import assert = require("node:assert/strict");
import type test = require("node:test");
import { productionWiring, gate } from "./departmentproductionwiringfixture";
import { prepareDepartmentTaskRecord } from "../../../extensionHost/departmentOwnedTaskRepository";
import { createLoopPlusScheduler } from "../../../loopPlusScheduler";

/** Test deadlines are failures, never idle/cleanup evidence. Every tracked
 * operation has both settlement handlers installed before the next await. */
export function settlement<T>(promise: Promise<T>) {
  const state: { status: "pending" | "fulfilled" | "rejected"; value?: T; error?: unknown } = { status: "pending" };
  const done = promise.then((value) => { state.status = "fulfilled"; state.value = value; },
    (error) => { state.status = "rejected"; state.error = error; });
  return { state, done };
}
export async function bounded<T>(promise: Promise<T>, label: string, diagnostic: () => unknown = () => null): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: deadline exceeded; pending=${JSON.stringify(diagnostic())}`)), 12000);
    })]);
  } finally { clearTimeout(timer); }
}
export async function eventually(check: () => boolean, label: string, diagnostic: () => unknown) {
  const deadline = Date.now() + 12000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`${label}: deadline exceeded; pending=${JSON.stringify(diagnostic())}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

const completed = new WeakSet<test.TestContext>();
export const treeFixtureCompleted = (t: test.TestContext) => completed.has(t);

/** The original producer, clients, task store, adapter, Owner and whole-group
 * cleanup from productionWiring. Only fixed Node CLI and UI consumers are free
 * fixtures. No snapshot/state/receipt injection and no alternate producer. */
export async function treeControl(t: test.TestContext) {
  const cleanup: Array<() => unknown> = [];
  const h = await productionWiring({ after: (fn: () => unknown) => cleanup.push(fn) } as unknown as test.TestContext,
    "codex", true, true, 3, { maxEmployees: 1 });
  const releases: Array<() => void> = [];
  const operations: Array<ReturnType<typeof settlement<unknown>>> = [];
  const root = h.read("root")!;
  h.controlTargets.set("root", { tabId: "director-tab", cli: "codex", sessionId: root.sessionId! });
  const other = h.source.create(prepareDepartmentTaskRecord({ ...structuredClone(root), id: "other-root", taskStoreFile: "",
    sessionId: "local_other_director", mainCommunicationFile: h.file("other-root.md") },
    { ...root.department!, rootTaskId: "other-root" }, root.loopPlusAcceptancePlan!));
  assert.ok(h.composition.host.registerRoot(other, other.department, other.loopPlusAcceptancePlan!).ok);
  h.controlTargets.set(other.id, { tabId: "other-director-tab", cli: "codex", sessionId: other.sessionId! });
  const snapshot = (id: string) => createLoopPlusScheduler({ snapshot: h.read(id)?.loopPlus }).snapshot();
  const diagnostic = () => ({ runtime: h.composition.host.runtimeSnapshot("root"), capacity: h.composition.readCapacity("root"),
    entries: h.entries(), logs: h.fixture.logs, wire: h.wire(), mainInvocations: h.mainInvocations,
    operations: operations.map((o) => ({ status: o.state.status, error: String(o.state.error ?? "") })) });
  const track = <T>(promise: Promise<T>) => { const observed = settlement(promise); operations.push(observed); return observed; };
  t.after(async () => {
    // Unblock only callbacks created by this fixture. Rejected stop remains a
    // rejected stop; teardown cannot create cleanup evidence for its null entry.
    releases.forEach((release) => release());
    for (const id of ["root", "other-root"]) track(h.composition.organizationControl.stop(h.read(id)!));
    const failures: unknown[] = [];
    try { await bounded(Promise.all(operations.map((o) => o.done)), "tree fixture lifecycle teardown", diagnostic); }
    catch (error) { failures.push(error); }
    for (const operation of operations) if (operation.state.status === "rejected")
      t.diagnostic("fixture shutdown rejection (not release evidence): " + String(operation.state.error));
    // Always attempt original fixture-only reclamation, even if a lifecycle
    // deadline failed. Neither rejection nor forced reclamation is success.
    for (const close of cleanup) {
      try { await bounded(Promise.resolve().then(close), "original fixture teardown", diagnostic); }
      catch (error) { failures.push(error); }
    }
    try { assert.equal(await bounded(h.source.close(), "controlled source close readback", diagnostic), true); }
    catch (error) { failures.push(error); }
    if (failures.length) throw new Error("tree fixture teardown failed: " + failures.map(String).join("; "));
    completed.add(t);
  });
  return Object.assign(h, { snapshot, diagnostic, track,
    gate() { const value = gate(); releases.push(value.resolve); return value; },
    releaseOnTeardown(release: () => void) { releases.push(release); },
    counts: () => ({ roots: h.fixture.rootsCreated.length, tabs: h.fixture.createdSubtaskTargets.length,
      builders: h.employeeBuilders, mains: h.mainCalls, bindings: h.entries().filter((e) => e.executionId).length,
      tasks: h.fixture.createdTaskIds.length }),
    startOther: () => h.composition.host.startLeader(other.id, { leaderSubtaskId: "module", moduleTitle: "module",
      prompt: "Coordinate this independent department without dispatching employees; preserve its own lifecycle and state." }),
    stop: () => h.composition.organizationControl.stop(h.read("root")!),
    continue: () => h.composition.organizationControl.continue(h.read("root")!, "显式继续原部门并验收已停止的员工"),
  });
}
