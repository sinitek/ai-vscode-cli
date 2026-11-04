import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { buildConfigHeartbeatSnapshot, shouldRefreshConfigHeartbeat } = require("../../configHeartbeatSnapshot") as typeof import("../../configHeartbeatSnapshot");
const { ensureCliModelStore } = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
const { loadConfigStateWithDeps } = require("../../webviewCommandCoordinator") as typeof import("../../webviewCommandCoordinator");

test("refreshing native configuration cannot change or invent the user's profile selection", async () => {
  for (const preferred of ["selected", "deleted", undefined]) {
    const commits: (string | null)[] = [];
    const state = await loadConfigStateWithDeps("claude", {
      workspaceSettings: { activeConfigIdByCli: { claude: preferred } },
      getConfigList: async () => ["selected", "native-matched"].map((id) => ({
        id, name: id, platform: "claude", content: JSON.stringify({ profile: id }), createdAt: 1, updatedAt: 1,
      })),
      getConfigOrder: async () => ({}),
      getCurrentConfig: async () => ({ content: '{"profile":"native-matched"}' }),
      setWorkspaceActiveConfigId: (_cli, configId) => { commits.push(configId); },
      setLastConfigStateLoadError: () => undefined,
      logInfo: () => undefined,
      logError: () => undefined,
      errorToMessage: String,
    });
    assert.equal(state.activeConfigId, preferred === "selected" ? "selected" : null);
    assert.deepEqual(commits, preferred === "deleted" ? [null] : []);
  }
});

test("heartbeat follows another window's committed selection instead of the stale local preference or disk match", async () => {
  const commits: (string | null)[] = [];
  const state = await loadConfigStateWithDeps("claude", {
    workspaceSettings: { activeConfigIdByCli: { claude: "before" } },
    getConfigList: async () => ["before", "after"].map((id) => ({ id, name: id, platform: "claude", content: JSON.stringify({ profile: id }), createdAt: 1, updatedAt: 1 })),
    getConfigOrder: async () => ({}),
    getCurrentConfig: async () => ({ content: '{"profile":"before"}' }),
    readSharedConfigSelection: async () => ({ configId: "after", revision: "committed-after", profileDigest: "digest", ready: true }),
    setWorkspaceActiveConfigId: (_cli, configId) => { commits.push(configId); },
    setLastConfigStateLoadError: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
    errorToMessage: String,
  });
  assert.equal(state.activeConfigId, "after");
  assert.equal(state.revision, "committed-after");
  assert.deepEqual(commits, ["after"]);
});

test("same-profile edits refresh the heartbeat when only the committed revision changes", () => {
  const config = { activeConfigId: "same-profile", revision: "before", configs: [{ id: "same-profile", name: "同一档案", platform: "codex" as const }] };
  const store = ensureCliModelStore();
  const deps = { resolveModelConfigIdForCli: () => "same-profile" };
  const before = buildConfigHeartbeatSnapshot("codex", config, store, deps);
  const unchanged = buildConfigHeartbeatSnapshot("codex", config, store, deps);
  const edited = buildConfigHeartbeatSnapshot("codex", { ...config, revision: "after" }, store, deps);
  assert.equal(shouldRefreshConfigHeartbeat(before, unchanged), false);
  assert.equal(shouldRefreshConfigHeartbeat(before, edited), true);
  assert.equal(edited.activeConfigId, before.activeConfigId);
});
