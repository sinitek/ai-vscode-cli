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

test("isolates OpenCode main and subtask overrides by active config", () => {
  let store = ensureCliModelStore();
  store = setOpenCodeRoleModelInStore(store, "config-a", "main", "one/main");
  store = setOpenCodeRoleModelInStore(store, "config-a", "subtask", "one/subtask");
  store = setOpenCodeRoleModelInStore(store, "config-b", "main", "two/main");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "main"), "one/main");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "subtask"), "one/subtask");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "primary"), "one/main");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "small"), "one/subtask");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-b", "main"), "two/main");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-b", "subtask"), null);
  store = setOpenCodeRoleModelInStore(store, "config-a", "subtask", null);
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "subtask"), null);
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "main"), "one/main");
});

test("migrates legacy OpenCode primary and small persisted role selections", () => {
  const legacyStore = {
    selectedByConfigId: {},
    optionsByConfigId: {},
    thinkingByCliAndModel: {},
    openCodeVariantByConfigAndModel: {},
    openCodeVariantByConfigModelAndRole: {
      "config-a": {
        "one/main": { primary: "high" },
        "one/small": { small: "low" },
      },
    },
    selectedLoopByConfigId: {},
    loopRolesByConfigId: {},
    openCodeRoleModelsByConfigId: {
      "config-a": {
        primary: "one/main",
        small: "one/small",
      },
    },
  } as unknown as Parameters<typeof ensureCliModelStore>[0];
  const store = ensureCliModelStore(legacyStore);

  assert.deepEqual(store.openCodeRoleModelsByConfigId["config-a"], {
    main: "one/main",
    subtask: "one/small",
  });
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "main"), "one/main");
  assert.equal(getOpenCodeRoleModelFromStore(store, "config-a", "subtask"), "one/small");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/main", "main"), "high");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/small", "subtask"), "low");
});


test("isolates OpenCode thinking variants by role and active config", () => {
  let store = ensureCliModelStore();
  store = setOpenCodeRoleVariantInStore(store, "config-a", "one/main", "main", "high");
  store = setOpenCodeRoleVariantInStore(store, "config-a", "one/subtask", "subtask", "low");
  store = setOpenCodeRoleVariantInStore(store, "config-b", "one/main", "main", "max");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/main", "main"), "high");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/subtask", "subtask"), "low");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-b", "one/main", "main"), "max");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/main", "subtask"), null);
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/main", "primary"), "high");
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/subtask", "small"), "low");
  store = setOpenCodeRoleVariantInStore(store, "config-a", "one/subtask", "subtask", null);
  assert.equal(getOpenCodeRoleVariantFromStore(store, "config-a", "one/subtask", "subtask"), null);
});

test("does not expose legacy generic or Loop selections for OpenCode", () => {
  const store = ensureCliModelStore({
    selectedByConfigId: { opencode: "legacy/main" },
    optionsByConfigId: { opencode: ["legacy/main"] },
    thinkingByCliAndModel: {},
    loopThinkingByConfigId: {},
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
    loopThinkingByConfigId: {},
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
