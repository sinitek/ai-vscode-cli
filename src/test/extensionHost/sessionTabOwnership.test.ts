import test = require("node:test");
import assert = require("node:assert/strict");
import type { PromptRunTarget } from "../../promptRunTypes";
import type { ConversationTabRecord } from "../../sessionTabs";
import { takeOverSessionTab, type SessionTabOwnershipDeps } from "../../extensionHost/sessionTabOwnership";

const target: PromptRunTarget = { tabId: "new", cli: "codex", sessionId: "session" };
function tab(id: string, sessionId: string | null = "session", cli: ConversationTabRecord["cli"] = "codex"): ConversationTabRecord {
  return { id, cli, sessionId, sessionIdByCli: { [cli]: sessionId }, createdAt: 1 };
}
function harness(tabs: ConversationTabRecord[], runs: PromptRunTarget[] = []) {
  const events: string[] = [];
  let workspace = "workspace";
  const deps: SessionTabOwnershipDeps = {
    getWorkspaceKey: () => workspace,
    getTabs: () => tabs,
    getActiveRuns: () => runs,
    stopTab: (id) => {
      events.push(`stop:${id}`);
      const index = runs.findIndex((run) => run.tabId === id);
      if (index >= 0) runs.splice(index, 1);
    },
    isTabRunActive: (id) => runs.some((run) => run.tabId === id),
    closeTab: async (id) => {
      events.push(`close:${id}`);
      const index = tabs.findIndex((item) => item.id === id);
      if (index >= 0) tabs.splice(index, 1);
    },
  };
  return { deps, events, tabs, switchWorkspace: () => { workspace = "another"; } };
}

test("takeover stops live owners and closes all idle duplicates while preserving other sessions and CLIs", async () => {
  const h = harness([tab("old"), tab("idle"), tab("new"), tab("other", "other"), tab("claude", "session", "claude")],
    [{ ...target, tabId: "old" }]);
  assert.equal(await takeOverSessionTab(target, h.deps), true);
  assert.deepEqual(h.events, ["stop:old", "close:old", "stop:idle", "close:idle"]);
  assert.deepEqual(h.tabs.map((item) => item.id), ["new", "other", "claude"]);
});

test("takeover uses per-CLI session bindings and catches actual runs whose tab binding lags", async () => {
  const mapped = { ...tab("mapped", "legacy"), sessionIdByCli: { codex: "session" } };
  const h = harness([mapped, tab("lagging", "other"), tab("new")], [{ ...target, tabId: "lagging" }]);
  assert.equal(await takeOverSessionTab(target, h.deps), true);
  assert.deepEqual(h.tabs.map((item) => item.id), ["new"]);
});

test("empty sessions, cancelled requests and missing target tabs do not close other tabs", async () => {
  const h = harness([tab("old"), tab("new")]);
  assert.equal(await takeOverSessionTab({ ...target, sessionId: null }, h.deps), true);
  assert.equal(await takeOverSessionTab(target, h.deps, () => true), false);
  assert.equal(await takeOverSessionTab({ ...target, tabId: "missing" }, h.deps), false);
  assert.deepEqual(h.events, []);
});

test("a failed stop or blocked close cannot admit the replacement run", async () => {
  const h = harness([tab("old"), tab("new")], [{ ...target, tabId: "old" }]);
  h.deps.stopTab = () => undefined;
  await assert.rejects(takeOverSessionTab(target, h.deps), /尚未停止/);
  assert.deepEqual(h.events, []);
  h.deps.isTabRunActive = () => false;
  h.deps.closeTab = async () => undefined;
  await assert.rejects(takeOverSessionTab(target, h.deps), /尚未关闭/);
  h.deps.closeTab = async () => { throw new Error("关闭失败"); };
  await assert.rejects(takeOverSessionTab(target, h.deps), /关闭失败/);
});

test("workspace changes and target rebinding during close cancel the pending start", async () => {
  for (const change of ["workspace", "binding", "removed", "cancelled"] as const) {
    const h = harness([tab("old"), tab("idle"), tab("new")]);
    const originalClose = h.deps.closeTab;
    let cancelled = false;
    h.deps.closeTab = async (id) => {
      await originalClose(id);
      if (change === "workspace") h.switchWorkspace();
      if (change === "binding") h.tabs.find((item) => item.id === "new")!.sessionIdByCli.codex = "rebound";
      if (change === "removed") h.tabs.splice(h.tabs.findIndex((item) => item.id === "new"), 1);
      if (change === "cancelled") cancelled = true;
    };
    assert.equal(await takeOverSessionTab(target, h.deps, () => cancelled), false, change);
    assert.deepEqual(h.events, ["stop:old", "close:old"]);
  }
});

test("concurrent preparation cannot resurrect the tab removed by another takeover", async () => {
  const h = harness([tab("old"), tab("new")]);
  const result = await Promise.all([
    takeOverSessionTab(target, h.deps),
    takeOverSessionTab({ ...target, tabId: "old" }, h.deps),
  ]);
  assert.deepEqual(result, [true, false]);
  assert.deepEqual(h.tabs.map((item) => item.id), ["new"]);
});

test("a stale stored binding cannot stop a runner executing another CLI or session", async () => {
  for (const run of [{ ...target, tabId: "old", cli: "claude" as const },
    { ...target, tabId: "old", sessionId: "different" }]) {
    const h = harness([tab("old"), tab("new")], [run]);
    assert.equal(await takeOverSessionTab(target, h.deps), true);
    assert.deepEqual(h.events, []);
  }
});

test("a duplicate rebound while another tab closes is preserved", async () => {
  for (const change of ["cli", "session", "object"] as const) {
    const h = harness([tab("old"), tab("idle"), tab("new")]);
    const close = h.deps.closeTab;
    h.deps.closeTab = async (id) => {
      await close(id);
      if (id !== "old") return;
      const index = h.tabs.findIndex((item) => item.id === "idle");
      if (change === "cli") h.tabs[index].cli = "claude";
      if (change === "session") h.tabs[index].sessionIdByCli.codex = "different";
      if (change === "object") h.tabs[index] = { ...h.tabs[index] };
    };
    if (change === "object") await assert.rejects(takeOverSessionTab(target, h.deps), { code: "SESSION_RUN_ACTIVE" });
    else assert.equal(await takeOverSessionTab(target, h.deps), true);
    assert.deepEqual(h.events, ["stop:old", "close:old"], change);
    assert.deepEqual(h.tabs.map((item) => item.id), ["idle", "new"]);
  }
});

test("a newly appearing owner or a run surviving tab closure prevents takeover", async () => {
  for (const change of ["new-owner", "surviving-run"] as const) {
    const runs: PromptRunTarget[] = [];
    const h = harness([tab("old"), tab("new")], runs);
    const close = h.deps.closeTab;
    h.deps.closeTab = async (id) => {
      await close(id);
      if (change === "new-owner") h.tabs.push(tab("late"));
      else runs.push({ ...target, tabId: id });
    };
    await assert.rejects(takeOverSessionTab(target, h.deps), { code: "SESSION_RUN_ACTIVE" });
  }
});

test("takeover refuses an actual owner whose tab changed CLI or session without closing it", async () => {
  const differentCli = harness([tab("old", "session", "claude"), tab("new")], [{ ...target, tabId: "old" }]);
  await assert.rejects(takeOverSessionTab(target, differentCli.deps), { code: "SESSION_RUN_ACTIVE" });
  assert.deepEqual(differentCli.events, []);

  const h = harness([tab("old"), tab("lagging", "other"), tab("new")], [{ ...target, tabId: "lagging" }]);
  const close = h.deps.closeTab;
  h.deps.closeTab = async (id) => {
    await close(id);
    h.tabs.find((item) => item.id === "lagging")!.sessionIdByCli.codex = "replacement";
  };
  await assert.rejects(takeOverSessionTab(target, h.deps), { code: "SESSION_RUN_ACTIVE" });
  assert.deepEqual(h.events, ["stop:old", "close:old"]);
});
