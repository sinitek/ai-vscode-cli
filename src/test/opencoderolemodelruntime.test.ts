import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

import {
  buildModelState,
  ensureCliModelStore,
  getOpenCodeRoleModelFromStore,
  setOpenCodeRoleModelInStore,
} from "../modelSelectionStore";

test("isolates OpenCode primary and small overrides by active config", () => {
  let store = ensureCliModelStore();
  store = setOpenCodeRoleModelInStore(store, "config-a", "primary", "one/main");
  store = setOpenCodeRoleModelInStore(store, "config-a", "small", "one/small");
  store = setOpenCodeRoleModelInStore(store, "config-b", "primary", "two/main");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "primary"), "one/main");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "small"), "one/small");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-b", "primary"), "two/main");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-b", "small"), null);
  store = setOpenCodeRoleModelInStore(store, "config-a", "small", null);
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "small"), null);
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "primary"), "one/main");
});

test("does not expose legacy generic or Loop selections for OpenCode", () => {
  const store = ensureCliModelStore({
    selectedByConfigId: { opencode: "legacy/main" },
    optionsByConfigId: { opencode: ["legacy/main"] },
    thinkingByCliAndModel: {},
    openCodeVariantByConfigAndModel: {},
    selectedLobsterByConfigId: { opencode: { main: "legacy/main", subtask: "legacy/sub" } },
    lobsterRolesByConfigId: {},
    openCodeRoleModelsByConfigId: {},
  });
  const state = buildModelState(store, () => "opencode", { opencode: "opencode" });
  assert.equal(state.selectedByCli.opencode, null);
  assert.deepEqual(state.optionsByCli.opencode, []);
  assert.equal(state.selectedLobsterByCli?.opencode.main, null);
  assert.equal(state.selectedLobsterByCli?.opencode.subtask, null);
});
