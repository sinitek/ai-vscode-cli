import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CliName, ThinkingMode } from "../../cli/types";
import { CLI_LIST } from "../../cli/types";
import { installVscodeMock } from "../vscodeMock";
import {
  ensureCliModelStore,
  normalizeCliModelName,
  mergeUniqueModelNames,
  normalizeLoopModelRoleFlags,
  isLoopTaskRoleValue,
} from "../../modelSelectionStoreNormalization";
import type { CliModelStore, ModelSelectionStoreOptions } from "../../modelSelectionStoreTypes";

function normalizeRaw(value: unknown, options?: Pick<ModelSelectionStoreOptions,
  "defaultModelStoreKey" | "isThinkingMode" | "normalizeThinkingModeForCli">): CliModelStore {
  return ensureCliModelStore(value as Partial<CliModelStore>, options);
}

function emptyStore(): CliModelStore {
  return {
    selectedByConfigId: {},
    optionsByConfigId: {},
    thinkingByCliAndModel: {},
    loopThinkingByConfigId: {},
    openCodeVariantByConfigAndModel: {},
    openCodeVariantByConfigModelAndRole: {},
    selectedLoopByConfigId: {},
    selectedLoopFrontendModelByConfigId: {},
    selectedLoopFrontendThinkingByConfigId: {},
    selectedLoopSubtaskCliByConfigId: {},
    selectedLoopFrontendCliByConfigId: {},
    selectedLoopFullstackCliByConfigId: {},
    selectedLoopFullstackThinkingByConfigId: {},
    loopRoleExplicitModelByConfigId: {},
    selectedLoopSubtaskModeByConfigId: {},
    loopFullstackRoleSeededByConfigId: {},
    loopRolesByConfigId: {},
    openCodeRoleModelsByConfigId: {},
  };
}

test("empty and malformed inputs return all 18 fresh top-level containers", () => {
  for (const input of [undefined, null, false, 17, "bad", [], {}, { unknown: 1 }]) {
    const actual = normalizeRaw(input);
    assert.deepEqual(actual, emptyStore());
    assert.equal(Object.keys(actual).length, 18);
    for (const field of Object.keys(actual) as Array<keyof CliModelStore>) {
      assert.notEqual(actual[field], ensureCliModelStore()[field]);
    }
  }
  const malformed = Object.fromEntries(Object.keys(emptyStore()).map((field) => [field, 42]));
  assert.deepEqual(normalizeRaw(malformed), emptyStore());
});

test("normalizes all persisted fields with explicit expected values and isolated roles/configs", () => {
  const actual = normalizeRaw({
    selectedByConfigId: { alpha: " Main ", beta: " Other ", "": "ignored", blank: " " },
    optionsByConfigId: { alpha: [" Main ", "main", "Second", 4, "", "SECOND"], beta: [] },
    thinkingByCliAndModel: { grok: { " Grok ": "off" }, codex: { __default__: "high" } },
    loopThinkingByConfigId: { alpha: { main: { " Main ": "ultra" }, subtask: { Child: "low" } } },
    openCodeVariantByConfigAndModel: { alpha: { " Main ": " Fast " } },
    openCodeVariantByConfigModelAndRole: { alpha: { " Main ": { main: " deep ", subtask: " quick " } } },
    selectedLoopByConfigId: { alpha: { main: " Main ", subtask: " Child ", frontend: "no" }, beta: { main: "Other" } },
    selectedLoopFrontendModelByConfigId: { alpha: " Front ", beta: " OtherFront " },
    selectedLoopFrontendThinkingByConfigId: { alpha: { " Front ": "on", __default__: "off" } },
    selectedLoopSubtaskCliByConfigId: { alpha: " GROK " },
    selectedLoopFrontendCliByConfigId: { alpha: " Claude " },
    selectedLoopFullstackCliByConfigId: { alpha: " OpenCode " },
    selectedLoopFullstackThinkingByConfigId: { beta: { " Stack ": "max" } },
    loopRoleExplicitModelByConfigId: { alpha: { frontend: " ", fullstack: " Stack " } },
    selectedLoopSubtaskModeByConfigId: { alpha: " split ", beta: "fullstack", invalid: "SPLIT" },
    loopFullstackRoleSeededByConfigId: { alpha: true, beta: 1, invalid: "true" },
    loopRolesByConfigId: { alpha: { " Main ": { main: false, subtask: true }, Child: { main: false, subtask: false } } },
    openCodeRoleModelsByConfigId: { alpha: { main: " Main ", small: " Small " } },
    unknown: { keep: false },
  });
  assert.deepEqual(actual, {
    selectedByConfigId: { alpha: "Main", beta: "Other" },
    optionsByConfigId: { alpha: ["Main", "Second"], beta: [] },
    thinkingByCliAndModel: { codex: { __default__: "high" }, grok: { Grok: "off" } },
    loopThinkingByConfigId: { alpha: { main: { Main: "ultra" }, subtask: { Child: "low" } } },
    openCodeVariantByConfigAndModel: { alpha: { Main: "Fast" } },
    openCodeVariantByConfigModelAndRole: { alpha: { Main: { main: "deep", subtask: "quick" } } },
    selectedLoopByConfigId: { alpha: { main: "Main", subtask: "Child" }, beta: { main: "Other" } },
    selectedLoopFrontendModelByConfigId: { alpha: "Front", beta: "OtherFront" },
    selectedLoopFrontendThinkingByConfigId: { alpha: { Front: "on", __default__: "off" } },
    selectedLoopSubtaskCliByConfigId: { alpha: "grok" },
    selectedLoopFrontendCliByConfigId: { alpha: "claude" },
    selectedLoopFullstackCliByConfigId: { alpha: "opencode" },
    selectedLoopFullstackThinkingByConfigId: { beta: { Stack: "max" } },
    loopRoleExplicitModelByConfigId: { alpha: { frontend: "", fullstack: "Stack" } },
    selectedLoopSubtaskModeByConfigId: { alpha: "split", beta: "fullstack" },
    loopFullstackRoleSeededByConfigId: { alpha: true },
    loopRolesByConfigId: { alpha: { Main: { main: false, subtask: true }, Child: { main: true, subtask: true } } },
    openCodeRoleModelsByConfigId: { alpha: { main: "Main", subtask: "Small" } },
  });
});

test("invalid members disappear while valid empty option arrays and broad object/array inputs survive", () => {
  const actual = normalizeRaw({
    optionsByConfigId: { empty: [], invalid: {}, "": ["no"] },
    selectedByConfigId: [" First ", null, "Third"],
    selectedLoopByConfigId: { empty: {}, invalid: null, alias: { primary: "no", small: "no" }, bad: { main: 3 } },
    selectedLoopFrontendModelByConfigId: { invalid: 4 },
    selectedLoopSubtaskCliByConfigId: { empty: "", invalid: "not-cli", "": "codex" },
    selectedLoopFrontendCliByConfigId: [" GROK "],
    selectedLoopFullstackCliByConfigId: { invalid: 2 },
    selectedLoopFrontendThinkingByConfigId: { empty: {}, bad: { model: "HIGH", " ": "low" } },
    selectedLoopFullstackThinkingByConfigId: { bad: null },
    thinkingByCliAndModel: { unknown: { model: "high" }, codex: { " ": "high", model: "HIGH" } },
    loopThinkingByConfigId: { bad: { frontend: { model: "low" }, main: { model: "invalid" } } },
    openCodeVariantByConfigAndModel: { bad: { " ": "x", model: 5 }, empty: [] },
    openCodeVariantByConfigModelAndRole: { bad: { model: { unknown: "x" } } },
    openCodeRoleModelsByConfigId: { empty: {}, bad: { main: false } },
    loopRolesByConfigId: { empty: {}, broad: [null] },
    loopRoleExplicitModelByConfigId: { bad: { frontend: null, fullstack: 5 } },
    selectedLoopSubtaskModeByConfigId: { empty: " ", bad: 4 },
  });
  assert.deepEqual(actual, {
    ...emptyStore(),
    optionsByConfigId: { empty: [] },
    selectedByConfigId: { 0: "First", 2: "Third" },
    selectedLoopFrontendCliByConfigId: { 0: "grok" },
    loopRolesByConfigId: { broad: { 0: { main: true, subtask: true } } },
  });
});

test("legacy properties migrate before normalization and canonical fields win", () => {
  const raw = {
    lobsterThinkingByConfigId: { alpha: { main: { " Legacy ": "high" } } },
    lobsterRolesByConfigId: { alpha: { Old: { main: false } } },
    loopRolesByConfigId: { beta: { " Current ": { subtask: false } } },
    selectedLoopByConfigId: { alpha: { main: " Current ", lobsterIgnored: "bad" } },
  };
  assert.deepEqual(normalizeRaw(raw), {
    ...emptyStore(),
    loopThinkingByConfigId: { alpha: { main: { Legacy: "high" } } },
    loopRolesByConfigId: { beta: { Current: { main: true, subtask: false } } },
    selectedLoopByConfigId: { alpha: { main: "Current" } },
  });
  assert.equal(raw.lobsterThinkingByConfigId.alpha.main[" Legacy "], "high");
});

test("OpenCode model aliases use nullish fallback, not first valid string", () => {
  const actual = normalizeRaw({ openCodeRoleModelsByConfigId: {
    emptyCanonical: { main: " ", primary: "fallback", subtask: "", small: "fallback" },
    invalidCanonical: { main: 8, primary: "fallback", subtask: false, small: "fallback" },
    nullishCanonical: { main: null, primary: " Primary ", subtask: undefined, small: " Small " },
    canonicalWins: { main: " Main ", primary: "other", subtask: " Child ", small: "other" },
  } });
  assert.deepEqual(actual.openCodeRoleModelsByConfigId, {
    nullishCanonical: { main: "Primary", subtask: "Small" },
    canonicalWins: { main: "Main", subtask: "Child" },
  });
});

test("OpenCode variants instead take first valid canonical/alias string", () => {
  const actual = normalizeRaw({ openCodeVariantByConfigModelAndRole: { alpha: {
    first: { main: " ", primary: " Alias ", subtask: 4, small: " Small " },
    second: { small: "alias", primary: "alias", subtask: " Child ", main: " Main " },
    invalid: { main: null, primary: false, subtask: "", small: [] },
  } } });
  assert.deepEqual(actual.openCodeVariantByConfigModelAndRole, { alpha: {
    first: { main: "Alias", subtask: "Small" }, second: { main: "Main", subtask: "Child" },
  } });
});

test("explicit models only read own role strings, retaining explicit CLI default", () => {
  const inherited = Object.create({ frontend: "inherited" }) as Record<string, unknown>;
  inherited.fullstack = " ";
  const actual = normalizeRaw({ loopRoleExplicitModelByConfigId: {
    alpha: inherited, beta: { frontend: " Front ", fullstack: "", main: "ignored" },
    invalid: { frontend: false, fullstack: 4 },
  } });
  assert.deepEqual(actual.loopRoleExplicitModelByConfigId, {
    alpha: { fullstack: "" }, beta: { frontend: "Front", fullstack: "" },
  });
  assert.equal(Object.hasOwnProperty.call(actual.loopRoleExplicitModelByConfigId.alpha, "frontend"), false);
});

test("CLI and loop thinking invoke injected rules with exact CLI order and codex loop identity", () => {
  const validated: unknown[] = [];
  const converted: Array<[CliName, ThinkingMode]> = [];
  const options = {
    defaultModelStoreKey: " ",
    isThinkingMode(value: unknown): value is ThinkingMode {
      validated.push(value);
      return value === "off";
    },
    normalizeThinkingModeForCli(cli: CliName, mode: ThinkingMode): ThinkingMode {
      converted.push([cli, mode]);
      return cli === "codex" ? "low" : mode;
    },
  };
  const actual = normalizeRaw({
    thinkingByCliAndModel: Object.fromEntries([
      ...CLI_LIST.map((cli) => [cli, { " ": "off", " Model ": "off", rejected: "high", "": "off" }]),
      ["unknown", { model: "off" }],
    ]),
    loopThinkingByConfigId: { alpha: { main: { " ": "off" }, subtask: { __default__: "off" }, frontend: { m: "off" } } },
    selectedLoopSubtaskCliByConfigId: { alpha: "grok" },
    selectedLoopFrontendThinkingByConfigId: { alpha: { __default__: "off", " ": "off", Known: "high" } },
    selectedLoopFullstackThinkingByConfigId: { alpha: { __default__: "off", " ": "off", Known: "ultra" } },
  }, options);
  assert.deepEqual(actual.thinkingByCliAndModel, Object.fromEntries(CLI_LIST.map((cli) => [cli, {
    " ": cli === "codex" ? "low" : "off", Model: cli === "codex" ? "low" : "off",
  }])));
  assert.deepEqual(converted, [...CLI_LIST.flatMap((cli): Array<[CliName, ThinkingMode]> => [
    [cli, "off"], [cli, "off"], [cli, "off"],
  ]), ["codex", "off"], ["codex", "off"]]);
  assert.deepEqual(validated, [...CLI_LIST.flatMap(() => ["off", "off", "high", "off"]), "off", "off"]);
  assert.deepEqual(actual.loopThinkingByConfigId, { alpha: { main: { " ": "low" }, subtask: { __default__: "low" } } });
  assert.deepEqual(actual.selectedLoopFrontendThinkingByConfigId, { alpha: { __default__: "off", Known: "high" } });
  assert.deepEqual(actual.selectedLoopFullstackThinkingByConfigId, { alpha: { __default__: "off", Known: "ultra" } });
});

test("built-in thinking accepts known levels exactly and preserves default model keys", () => {
  const levels: ThinkingMode[] = ["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"];
  const modes = Object.fromEntries(levels.map((mode) => [mode, mode]));
  assert.deepEqual(normalizeRaw({ thinkingByCliAndModel: { grok: { ...modes, __default__: "off", " high ": "HIGH" } } })
    .thinkingByCliAndModel, { grok: { ...modes, __default__: "off" } });
  const options: ModelSelectionStoreOptions = {
    modelStoreFile: "unused", defaultModelStoreKey: " DEFAULT ",
    isThinkingMode: (value: unknown): value is ThinkingMode => value === "off",
    normalizeThinkingModeForCli: (_cli, mode) => mode,
  };
  assert.deepEqual(normalizeRaw({ thinkingByCliAndModel: { codex: { " DEFAULT ": "off", __default__: "off", " Model ": "off" } } }, options)
    .thinkingByCliAndModel, { codex: { " DEFAULT ": "off", __default__: "off", Model: "off" } });
});

test("normalization does not mutate frozen inputs, shares no nested mutable output and is idempotent", () => {
  const raw = {
    ...emptyStore(),
    optionsByConfigId: { alpha: [" Main ", "main"] },
    loopRoleExplicitModelByConfigId: { alpha: { frontend: " " } },
    loopRolesByConfigId: { alpha: { Main: { main: false, subtask: true } } },
    thinkingByCliAndModel: { codex: { Main: "high" as const } },
  };
  function freezeTree(value: unknown): void {
    if (value && typeof value === "object") {
      Object.freeze(value);
      for (const child of Object.values(value)) freezeTree(child);
    }
  }
  const snapshot = JSON.stringify(raw);
  freezeTree(raw);
  const first = ensureCliModelStore(raw);
  const second = ensureCliModelStore(raw);
  assert.deepEqual(ensureCliModelStore(first), first);
  first.optionsByConfigId.alpha.push("New");
  first.loopRoleExplicitModelByConfigId.alpha.frontend = "Changed";
  first.loopRolesByConfigId.alpha.Main.main = true;
  first.thinkingByCliAndModel.codex!.Main = "off";
  assert.deepEqual(second.optionsByConfigId.alpha, ["Main"]);
  assert.deepEqual(second.loopRoleExplicitModelByConfigId.alpha, { frontend: "" });
  assert.deepEqual(second.loopRolesByConfigId.alpha.Main, { main: false, subtask: true });
  assert.deepEqual(second.thinkingByCliAndModel.codex, { Main: "high" });
  assert.equal(JSON.stringify(raw), snapshot);
});

test("shared public helpers retain trimming, first spelling, flags and role contracts", () => {
  assert.equal(normalizeCliModelName(" Model "), "Model");
  for (const invalid of [null, undefined, false, 4, " "]) assert.equal(normalizeCliModelName(invalid), null);
  assert.deepEqual(mergeUniqueModelNames([" First ", "SECOND"], ["first", "Second", "Third"]), ["First", "SECOND", "Third"]);
  assert.deepEqual(normalizeLoopModelRoleFlags({ main: false, subtask: false }), { main: true, subtask: true });
  assert.deepEqual(normalizeLoopModelRoleFlags({ main: 0, subtask: false }), { main: true, subtask: false });
  assert.deepEqual(normalizeLoopModelRoleFlags(null), { main: true, subtask: true });
  assert.equal(isLoopTaskRoleValue("main"), true);
  assert.equal(isLoopTaskRoleValue("subtask"), true);
  for (const invalid of ["primary", "small", "frontend", null]) assert.equal(isLoopTaskRoleValue(invalid), false);
});

test("facade read stays raw; load protects corrupt files, initializes missing files and records write failures", () => {
  installVscodeMock();
  const { createEmptyModelSelectionStoreState, readModelStore, loadModelStore } =
    require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "model-store-normalization-"));
  const events: string[] = [];
  const options: ModelSelectionStoreOptions = {
    modelStoreFile: path.join(directory, "models.json"), defaultModelStoreKey: "__default__",
    isThinkingMode: (value: unknown): value is ThinkingMode => value === "high",
    normalizeThinkingModeForCli: (_cli, mode) => mode,
    logError: (event) => { events.push(event); },
  };
  try {
    const state = createEmptyModelSelectionStoreState();
    fs.writeFileSync(options.modelStoreFile, '{"selectedByConfigId":{"alpha":" Raw "},"unknown":true}');
    assert.deepEqual(readModelStore(state, options), { selectedByConfigId: { alpha: " Raw " }, unknown: true });
    fs.writeFileSync(options.modelStoreFile, "{broken");
    assert.deepEqual(loadModelStore(state, options), emptyStore());
    assert.ok(state.lastReadError);
    assert.equal(fs.readFileSync(options.modelStoreFile, "utf8"), "{broken");
    assert.deepEqual(events, ["model-store-read-error"]);
    fs.unlinkSync(options.modelStoreFile);
    assert.deepEqual(loadModelStore(state, options), emptyStore());
    assert.equal(state.lastReadError, null);
    assert.equal(state.lastWriteError, null);
    assert.equal(fs.readFileSync(options.modelStoreFile, "utf8"), JSON.stringify(emptyStore(), null, 2));
    const blockedPath = path.join(directory, "blocked");
    fs.writeFileSync(blockedPath, "not a directory");
    assert.deepEqual(loadModelStore(state, { ...options, modelStoreFile: path.join(blockedPath, "models.json") }), emptyStore());
    assert.ok(state.lastWriteError);
    assert.deepEqual(events, ["model-store-read-error", "model-store-write-error"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("old facade exports the same helper implementations and retains its shared type entrypoint", () => {
  installVscodeMock();
  const facade = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
  const legacyTypedStore: import("../../modelSelectionStore").CliModelStore = ensureCliModelStore();
  const legacyTypedOptions: Pick<import("../../modelSelectionStore").ModelSelectionStoreOptions, "defaultModelStoreKey"> = {
    defaultModelStoreKey: "__default__",
  };
  assert.deepEqual(facade.ensureCliModelStore(legacyTypedStore), emptyStore());
  assert.equal(legacyTypedOptions.defaultModelStoreKey, "__default__");
  assert.equal(facade.ensureCliModelStore, ensureCliModelStore);
  assert.equal(facade.normalizeCliModelName, normalizeCliModelName);
  assert.equal(facade.mergeUniqueModelNames, mergeUniqueModelNames);
  assert.equal(facade.normalizeLoopModelRoleFlags, normalizeLoopModelRoleFlags);
  assert.equal(facade.isLoopTaskRoleValue, isLoopTaskRoleValue);
});
