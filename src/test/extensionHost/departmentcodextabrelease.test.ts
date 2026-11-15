import test = require("node:test");
import assert = require("node:assert/strict");
import { createDepartmentExecutionResources, bindDepartmentExecutionTab, releaseDepartmentExecutionTab,
  type DepartmentExecutionTabTarget } from "../../extensionHost/departmentexecutionresources";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity } from "../../runtime/departmentexecutionidentity";
import { createResourceTabHost } from "./fixtures/departmentresourcetabhost";
import type { ConversationTabsState } from "../../sessionTabs";

import { verifyActualTabPort } from "./fixtures/departmentcodextabreleasehost";
const identity: DepartmentExecutionIdentity = { version: 1, rootTaskId: "root", workspace: "workspace", leaderTaskId: "leader", moduleId: "module", generation: 1,
  role: "leader", cli: "codex", ownerId: "owner", executionId: "execution", session: { state: "unbound" },
  ...fingerprintDepartmentExecutionSelection({ version: 1, cli: "codex", role: "leader", configId: "profile", revision: "revision", model: null, thinkingMode: "medium", openCodeVariant: null }) };
const bound: DepartmentExecutionIdentity = { ...identity, session: { state: "bound", id: "native" } };

test("actual tab host closes exact owned leader only after consumers and keeps ordinary lock semantics", verifyActualTabPort);

for (const conflict of ["active", "borrowed-session", "replacement", "generation", "last-tab", "close-throws"] as const) test(`tab capability ${conflict} never confirms release`, async () => {
  const state: ConversationTabsState = { activeTabId: "main", tabs: [
    { id: "user", cli: "codex", sessionId: "user", sessionIdByCli: { codex: "user" }, createdAt: 1 }, { id: "main", cli: "codex", sessionId: "local_leader", sessionIdByCli: { codex: "local_leader" }, createdAt: 2 },
  ] };
  const running = new Set<string>();
  const h = createResourceTabHost({ state, currentCli: "codex", modes: {}, runningTabIds: running });
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: h.host.getConversationTabById,
    isActive: (id) => running.has(id), owns: () => conflict !== "generation",
    close: async (tab) => { if (conflict === "close-throws") throw new Error("controlled"); await h.host.closeOwnedConversationTabAndRefreshPanel(tab as typeof state.tabs[number]); } });
  resources.recordCreated("main"); const consumer = resources.beginConsumer("main"), capability = bindDepartmentExecutionTab(consumer.target, identity);
  if (conflict === "active") running.add("main");
  if (conflict === "borrowed-session") state.tabs[1].sessionId = "borrowed";
  if (conflict === "replacement") state.tabs[1] = { ...state.tabs[1] };
  if (conflict === "last-tab") state.tabs.splice(0, 1);
  consumer.finish();
  assert.notEqual((await releaseDepartmentExecutionTab(capability, bound)).status, "confirmed");
  assert.ok(h.host.getConversationTabById("main"));
  assert.equal(h.closedTabs.length, 0);
});

test("only exact trusted local-session transition can update a newly created target before binding", async () => {
  const state: ConversationTabsState = { activeTabId: "main", tabs: [
    { id: "user", cli: "codex", sessionId: "user", sessionIdByCli: { codex: "user" }, createdAt: 1 },
    { id: "main", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 2 },
  ] };
  const h = createResourceTabHost({ state, currentCli: "codex", modes: {} });
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: h.host.getConversationTabById, isActive: () => false,
    owns: () => true, close: (tab) => h.host.closeOwnedConversationTabAndRefreshPanel(tab as typeof state.tabs[number]) });
  resources.recordCreated("main"); h.host.updateActiveConversationTabSession("codex", "local_owned");
  assert.throws(() => resources.beginConsumer("main"), /session-changed/);
  assert.throws(() => resources.confirmSessionTransition("main", "borrowed", "local_owned"), /transition-conflict/);
  resources.confirmSessionTransition("main", null, "local_owned");
  const consumer = resources.beginConsumer("main");
  state.tabs[1].sessionId = "borrowed";
  assert.throws(() => bindDepartmentExecutionTab(consumer.target, identity), /session-changed/);
  consumer.finish();
  assert.ok(h.host.getConversationTabById("main"));
});

test("OpenCode employee tab release waits for its original consumer and confirms the exact tab is gone", async () => {
  const state: ConversationTabsState = { activeTabId: "other", tabs: [
    { id: "other", cli: "opencode", sessionId: "other-session", sessionIdByCli: { opencode: "other-session" }, createdAt: 1 },
    { id: "subtask", cli: "opencode", sessionId: "local-attempt", sessionIdByCli: { opencode: "local-attempt" }, createdAt: 2 },
  ] };
  const h = createResourceTabHost({ state, currentCli: "opencode", modes: {} });
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: h.host.getConversationTabById,
    isActive: () => false, owns: (candidate) => candidate.cli === "opencode" && candidate.role === "employee" && candidate.attemptId === "attempt",
    close: (tab) => h.host.closeOwnedConversationTabAndRefreshPanel(tab as typeof state.tabs[number]) });
  const employee = { ...identity, cli: "opencode" as const, role: "employee" as const, subtaskId: "subtask", attemptId: "attempt",
    session: { state: "unbound" as const }, ...fingerprintDepartmentExecutionSelection({ version: 1, cli: "opencode", role: "employee",
      configId: "profile", revision: "revision", model: null, thinkingMode: "medium", openCodeVariant: null }) };
  resources.recordCreated("subtask");
  const consumer = resources.beginConsumer("subtask"), capability = bindDepartmentExecutionTab(consumer.target, employee);
  const boundIdentity = { ...employee, session: { state: "bound" as const, id: "ses_native" } };
  let settled = false;
  const release = releaseDepartmentExecutionTab(capability, boundIdentity).then((value) => { settled = true; return value; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the Owner cannot close a tab while the original output consumer is active");
  consumer.finish();
  assert.equal((await release).status, "confirmed");
  assert.equal(h.host.getConversationTabById("subtask"), null);
  assert.equal(h.closedTabs.length, 1);
});


test("OpenCode stopped transcript reset is a trusted transition before binding, never a native session grant", async () => {
  const tabs = new Map([["employee", { id: "employee", cli: "opencode", sessionId: "ses_original" as string | null }]]);
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: id => tabs.get(id) ?? null,
    isActive: () => false, owns: () => true, close: async tab => { tabs.delete(tab.id); } });
  resources.recordCreated("employee"); const tab = tabs.get("employee")!;
  tab.sessionId = null; // Existing health repair writer resets an interrupted transcript.
  assert.throws(() => resources.beginConsumer("employee"), /session-changed/);
  resources.confirmSessionTransition("employee", "ses_original", null);
  const consumer = resources.beginConsumer("employee");
  const native = { ...bound, cli: "opencode" as const, role: "employee" as const, subtaskId: "source", attemptId: "successor",
    session: { state: "bound" as const, id: "ses_original" } };
  const capability = bindDepartmentExecutionTab(consumer.target, native);
  assert.throws(() => resources.confirmSessionTransition("employee", null, null), /transition-conflict/);
  tab.sessionId = native.session.id; consumer.finish();
  assert.equal((await releaseDepartmentExecutionTab(capability, native)).status, "confirmed");
});
