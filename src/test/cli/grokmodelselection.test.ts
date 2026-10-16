import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { supportsCliManagedModelSelection } = require("../../cli/modelArgs") as typeof import("../../cli/modelArgs");
const {
  buildModelState,
  deleteCliModelFromStore,
  ensureCliModelStore,
  getManagedModelOptionsForCliFromStore,
  getModelOptionsForCliFromStore,
  getOpenCodeRoleModelFromStore,
  getSelectedCliModelFromStore,
  getSelectedLoopCliModelFromStore,
  moveCliModelInStore,
  renameCliModelInStore,
  selectCliLoopModelInStore,
  selectCliModelInStore,
  setOpenCodeRoleModelInStore,
} = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");

test("stores one Grok model per config id and leaves loop roles codex-only", () => {
  assert.equal(supportsCliManagedModelSelection("grok"), true);
  assert.equal(supportsCliManagedModelSelection("claude"), false);
  let store = ensureCliModelStore();
  store = selectCliModelInStore(store, "grok", "  grok-4  ", "grok-config");
  store = selectCliModelInStore(store, "grok", "grok-ultra", "grok-config");
  assert.equal(getSelectedCliModelFromStore(store, "grok", "grok-config"), "grok-ultra");
  assert.deepEqual(getModelOptionsForCliFromStore(store, "grok", "grok-config"), ["grok-4", "grok-ultra"]);
  assert.deepEqual(getManagedModelOptionsForCliFromStore(store, "grok", "grok-config"), ["grok-4", "grok-ultra"]);
  assert.equal(store.selectedByConfigId["grok-config"], "grok-ultra");

  const renamed = renameCliModelInStore(store, "grok", "grok-4", "grok-4.7", "grok-config");
  assert.equal(renamed.renamedModel, "grok-4.7");
  store = renamed.store;
  const moved = moveCliModelInStore(store, "grok", "grok-ultra", "up", "grok-config");
  assert.equal(moved.movedModel, "grok-ultra");
  store = moved.store;
  assert.deepEqual(getModelOptionsForCliFromStore(store, "grok", "grok-config"), ["grok-ultra", "grok-4.7"]);
  store = deleteCliModelFromStore(store, "grok", "grok-4.7", "grok-config");
  assert.deepEqual(getManagedModelOptionsForCliFromStore(store, "grok", "grok-config"), ["grok-ultra"]);

  store = selectCliModelInStore(store, "codex", "gpt-5", "codex-config");
  store = selectCliLoopModelInStore(store, "codex", "main", "gpt-5", "codex-config");
  store = selectCliLoopModelInStore(store, "codex", "subtask", "gpt-5", "codex-config");
  const grokLoop = selectCliLoopModelInStore(store, "grok", "main", "grok-ultra", "grok-config");
  assert.deepEqual(grokLoop.selectedLoopByConfigId, store.selectedLoopByConfigId);
  assert.equal(getSelectedLoopCliModelFromStore(grokLoop, "grok", "main", "grok-config"), null);
  assert.equal(getSelectedLoopCliModelFromStore(store, "codex", "main", "codex-config"), "gpt-5");

  store = setOpenCodeRoleModelInStore(store, "oc-config", "main", "provider/main-model");
  store = setOpenCodeRoleModelInStore(store, "oc-config", "subtask", "provider/small-model");
  assert.equal(getOpenCodeRoleModelFromStore(store, "oc-config", "main"), "provider/main-model");
  assert.equal(getSelectedLoopCliModelFromStore(store, "opencode", "subtask", "oc-config"), "provider/small-model");

  const claudeStore = selectCliModelInStore(store, "claude", "claude-sonnet", "claude-config");
  assert.equal(getSelectedCliModelFromStore(claudeStore, "claude", "claude-config"), null);

  const state = buildModelState(store, () => null, {
    grok: "grok-config",
    codex: "codex-config",
    opencode: "oc-config",
    claude: "claude-config",
  });
  assert.equal(state.selectedByCli.grok, "grok-ultra");
  assert.deepEqual(state.optionsByCli.grok, ["grok-ultra"]);
  assert.deepEqual(state.managedByCli.grok, ["grok-ultra"]);
  assert.equal(state.selectedLoopByCli?.grok, undefined);
  assert.equal(state.loopOptionsByCli?.grok, undefined);
  assert.equal(state.selectedLoopByCli?.codex?.main, "gpt-5");
  assert.equal(state.selectedLoopByCli?.opencode?.main, "provider/main-model");
  assert.equal(state.selectedLoopByCli?.opencode?.subtask, "provider/small-model");
  assert.equal(state.loopOptionsByCli?.opencode, undefined);
});
