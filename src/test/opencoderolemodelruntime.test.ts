import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

import {
  buildModelState,
  ensureCliModelStore,
  getOpenCodeRoleModelFromStore,
  getOpenCodeRoleVariantFromStore,
  setOpenCodeRoleModelInStore,
  setOpenCodeRoleVariantInStore,
} from "../modelSelectionStore";
import { getLegacyLoopPropertyKey } from "../loopLegacyMigration";

test("migrates legacy Loop model-selection keys", () => {
  const store = ensureCliModelStore({
    selectedByConfigId: {},
    optionsByConfigId: {},
    thinkingByCliAndModel: {},
    openCodeVariantByConfigAndModel: {},
    openCodeVariantByConfigModelAndRole: {},
    openCodeRoleModelsByConfigId: {},
    [getLegacyLoopPropertyKey("selectedLoopByConfigId")]: {
      "config-a": { main: "loop-main", subtask: "loop-subtask" },
    },
    [getLegacyLoopPropertyKey("loopRolesByConfigId")]: {
      "config-a": {
        "loop-main": { main: true, subtask: false },
      },
    },
  } as unknown as Parameters<typeof ensureCliModelStore>[0]);

  assert.deepEqual(store.selectedLoopByConfigId, {
    "config-a": { main: "loop-main", subtask: "loop-subtask" },
  });
  assert.deepEqual(store.loopRolesByConfigId, {
    "config-a": {
      "loop-main": { main: true, subtask: false },
    },
  });
});

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



test("isolates OpenCode thinking variants by role and active config", () => {
  let store = ensureCliModelStore();
  store = setOpenCodeRoleVariantInStore(store, "config-a", "one/main", "primary", "high");
  store = setOpenCodeRoleVariantInStore(store, "config-a", "one/small", "small", "low");
  store = setOpenCodeRoleVariantInStore(store, "config-b", "one/main", "primary", "max");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/main", "primary"), "high");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/small", "small"), "low");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-b", "one/main", "primary"), "max");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/main", "small"), null);
  store = setOpenCodeRoleVariantInStore(store, "config-a", "one/small", "small", null);
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/small", "small"), null);
});

test("does not expose legacy generic or Loop selections for OpenCode", () => {
  const store = ensureCliModelStore({
    selectedByConfigId: { opencode: "legacy/main" },
    optionsByConfigId: { opencode: ["legacy/main"] },
    thinkingByCliAndModel: {},
    openCodeVariantByConfigAndModel: {},
    openCodeVariantByConfigModelAndRole: {},
    selectedLoopByConfigId: { opencode: { main: "legacy/main", subtask: "legacy/sub" } },
    loopRolesByConfigId: {},
    openCodeRoleModelsByConfigId: {},
  });
  const state = buildModelState(
    store,
    (cli) => cli === "opencode" ? "opencode" : null,
    { opencode: "opencode" },
  );
  assert.equal(state.selectedByCli.opencode, null);
  assert.deepEqual(state.optionsByCli.opencode, []);
  assert.equal(state.selectedLoopByCli?.opencode, undefined);
  assert.equal(state.loopOptionsByCli?.opencode, undefined);
  assert.deepEqual(state.selectedLoopByCli?.codex, { main: null, subtask: null });
  assert.deepEqual(state.loopOptionsByCli?.codex, { main: [], subtask: [] });
  assert.equal("managedLoopRolesByCli" in state, false);
});

test("exposes Codex Loop role selections alongside the unified model", () => {
  const store = ensureCliModelStore({
    selectedByConfigId: { "config-a": "codex-unified" },
    optionsByConfigId: { "config-a": ["codex-unified", "legacy-main", "legacy-subtask"] },
    thinkingByCliAndModel: {},
    openCodeVariantByConfigAndModel: {},
    openCodeVariantByConfigModelAndRole: {},
    selectedLoopByConfigId: {
      "config-a": { main: "legacy-main", subtask: "legacy-subtask" },
    },
    loopRolesByConfigId: {
      "config-a": {
        "legacy-main": { main: true, subtask: false },
        "legacy-subtask": { main: false, subtask: true },
      },
    },
    openCodeRoleModelsByConfigId: {},
  });

  const state = buildModelState(store, () => "config-a", { codex: "config-a" });
  assert.equal(state.selectedByCli.codex, "codex-unified");
  assert.deepEqual(state.optionsByCli.codex, ["codex-unified", "legacy-main", "legacy-subtask"]);
  assert.deepEqual(state.selectedLoopByCli?.codex, {
    main: "legacy-main",
    subtask: "legacy-subtask",
  });
  assert.deepEqual(state.loopOptionsByCli?.codex, {
    main: ["codex-unified", "legacy-main"],
    subtask: ["codex-unified", "legacy-subtask"],
  });
});
