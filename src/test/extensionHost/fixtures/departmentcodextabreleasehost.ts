import assert = require("node:assert/strict");
import { createDepartmentExecutionResources, bindDepartmentExecutionTab, releaseDepartmentExecutionTab,
  type DepartmentExecutionTabTarget } from "../../../extensionHost/departmentexecutionresources";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity } from "../../../runtime/departmentexecutionidentity";
import { createResourceTabHost } from "./departmentresourcetabhost";
import type { ConversationTabsState } from "../../../sessionTabs";

const identity: DepartmentExecutionIdentity = { version: 1, rootTaskId: "root", workspace: "workspace", leaderTaskId: "leader", moduleId: "module", generation: 1,
  role: "leader", cli: "codex", ownerId: "owner", executionId: "execution", session: { state: "unbound" },
  ...fingerprintDepartmentExecutionSelection({ version: 1, cli: "codex", role: "leader", configId: "profile", revision: "revision", model: null, thinkingMode: "medium", openCodeVariant: null }) };
const bound: DepartmentExecutionIdentity = { ...identity, session: { state: "bound", id: "native" } };
export async function verifyActualTabPort() {
  const state: ConversationTabsState = { activeTabId: "main", tabs: [
    { id: "user", cli: "codex", sessionId: "user", sessionIdByCli: { codex: "user" }, createdAt: 1 },
    { id: "main", cli: "codex", sessionId: "local_leader", sessionIdByCli: { codex: "local_leader" }, createdAt: 2 },
  ] };
  const locked = new Set(["main"]), running = new Set<string>();
  const h = createResourceTabHost({ state, currentCli: "codex", modes: {}, lockedTabIds: locked, runningTabIds: running });
  let owns = true;
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: h.host.getConversationTabById,
    isActive: (id) => running.has(id), owns: () => owns,
    close: (tab) => h.host.closeOwnedConversationTabAndRefreshPanel(tab as typeof state.tabs[number]) });
  assert.throws(() => resources.beginConsumer("main"), /not-owned/);
  assert.equal(bindDepartmentExecutionTab({ kind: "department-created-tab" } as DepartmentExecutionTabTarget, identity), undefined);
  resources.recordCreated("main");
  const consumer = resources.beginConsumer("main"), capability = bindDepartmentExecutionTab(consumer.target, identity);
  assert.ok(capability);
  await h.host.closeConversationTabAndRefreshPanel("main");
  assert.ok(h.host.getConversationTabById("main"), "ordinary UI close remains locked");
  assert.notEqual((await releaseDepartmentExecutionTab(capability, { ...bound, generation: 2 })).status, "confirmed");
  let resolved = false;
  const release = releaseDepartmentExecutionTab(capability, bound); void release.then(() => { resolved = true; });
  assert.equal(releaseDepartmentExecutionTab(capability, structuredClone(bound)), release);
  await new Promise((r) => setImmediate(r)); assert.equal(resolved, false);
  assert.ok(h.host.getConversationTabById("main"));
  consumer.finish(); consumer.finish();
  assert.equal((await release).status, "confirmed");
  assert.equal(h.host.getConversationTabById("main"), null); assert.ok(h.host.getConversationTabById("user"));
  assert.deepEqual(h.disposedTabIds, ["main"]); assert.equal(h.closedTabs.length, 1);
  assert.equal((await releaseDepartmentExecutionTab(capability, bound)).status, "confirmed");
  assert.notEqual((await releaseDepartmentExecutionTab(capability, { ...bound, session: { state: "bound", id: "successor" } })).status, "confirmed");
  owns = false;
  return { closedTab: "main", userTabPreserved: true, ordinaryCloseLocked: true, releaseCount: h.closedTabs.length, originalConsumersSettled: true };
}
