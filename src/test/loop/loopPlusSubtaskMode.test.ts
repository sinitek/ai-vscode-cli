import test = require("node:test");
import assert = require("node:assert/strict");

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import { buildLoopPlusMainModelPrompt, buildLoopPlusSubtaskModelPrompt } from "../../extensionHost/loopPlusPromptBuilders";
import {
  readLoopSubtaskModeField,
  resolveStoredLoopSubtaskMode,
} from "../../loopPlusSubtaskMode";
import { normalizeLoopTaskModelRouting, normalizeLoopTaskRecord } from "../../loopTaskStore";
import {
  ensureCliModelStore,
  loopFullstackRoleNeedsSeed,
  markLoopFullstackRoleSeededInStore,
  selectLoopFullstackCliInStore,
  selectLoopSubtaskModeInStore,
  setLoopRoleExplicitModelInStore,
} from "../../modelSelectionStore";
import { resolveLoopPlusRoleExecution } from "../../subtaskCliRoute";

const baseTask = {
  id: "task-1",
  cli: "codex",
  workspaceKey: "workspace",
  taskStoreFile: "loop-tasks.json",
  rootPrompt: "ship the change",
  status: "running",
  createdAt: 1,
  updatedAt: 1,
  maxRounds: 3,
  currentRound: 0,
  communicationDir: "/tmp/communications",
  mainCommunicationFile: "/tmp/communications/main.md",
  subTasks: [],
  rounds: [],
  completionRoundSummaries: [],
  completionRequirementCoverage: [],
};

test("mode field rejects unknown values and migration keeps legacy routes", () => {
  assert.equal(readLoopSubtaskModeField(undefined), undefined);
  assert.equal(readLoopSubtaskModeField(""), undefined);
  assert.equal(readLoopSubtaskModeField("fullstack"), "fullstack");
  assert.equal(readLoopSubtaskModeField(1), null);
  assert.equal(readLoopSubtaskModeField("both"), null);
  assert.equal(resolveStoredLoopSubtaskMode({}), "fullstack");
  assert.equal(resolveStoredLoopSubtaskMode({
    frontendRoute: { cli: "codex", model: "ui-model" },
  }), "split");
  assert.equal(resolveStoredLoopSubtaskMode({
    loopSubtaskMode: "fullstack",
    frontendRoute: { cli: "codex", model: "ui-model" },
  }), "fullstack");
  assert.equal(resolveStoredLoopSubtaskMode({ loopSubtaskMode: "nope" }), null);

  const legacy = normalizeLoopTaskRecord({
    ...baseTask,
    modelRouting: { main: { model: "main-model" }, subtask: { model: "atomic-model", configId: "codex-a" } },
  });
  assert.equal(legacy?.loopSubtaskMode, undefined);
  assert.equal(legacy?.loopSubtaskModeInvalid, undefined);
  const invalid = normalizeLoopTaskRecord({ ...baseTask, loopSubtaskMode: "nope" });
  assert.equal(invalid?.loopSubtaskMode, undefined);
  assert.equal(invalid?.loopSubtaskModeInvalid, true);
  const explicit = normalizeLoopTaskRecord({ ...baseTask, loopSubtaskMode: "split" });
  assert.equal(explicit?.loopSubtaskMode, "split");
});

test("fullstack coding uses the fullstack CLI config model and thinking, including frontend tasks", () => {
  const execution = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    loopSubtaskMode: "fullstack",
    taskType: "frontend",
    writeFiles: ["src/webview/panel.ts"],
    mainRoute: { model: "main-model", configId: "main-profile" },
    backendRoute: { cli: "codex", configId: "backend-profile", model: "backend-model" },
    frontendRoute: { cli: "grok", configId: "frontend-profile", model: "frontend-model" },
    fullstackRoute: { cli: "dsh", configId: "fullstack-profile", model: "fullstack-model" },
    originProfile: {
      configId: "main-profile",
      mainThinkingMode: "high",
      subtaskThinkingMode: "low",
      subtaskFrontendThinkingMode: "medium",
      subtaskFullstackThinkingMode: "xhigh",
    },
  });
  assert.equal(execution.mode, "fullstack");
  assert.equal(execution.role, "frontend");
  assert.equal(execution.cli, "dsh");
  assert.equal(execution.configId, "fullstack-profile");
  assert.equal(execution.model, "fullstack-model");
  assert.equal(execution.thinkingMode, "xhigh");
  assert.equal(execution.unavailableReason, undefined);

  const backend = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    loopSubtaskMode: "fullstack",
    taskType: "backend",
    fullstackRoute: { cli: "dsh", configId: "fullstack-profile", model: "fullstack-model" },
    originProfile: { configId: "main-profile", subtaskFullstackThinkingMode: "xhigh" },
  });
  assert.equal(backend.cli, "dsh");
  assert.equal(backend.model, "fullstack-model");
  assert.equal(backend.configId, "fullstack-profile");
  assert.equal(backend.thinkingMode, "xhigh");

  const untyped = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    loopSubtaskMode: "fullstack",
    fullstackRoute: { cli: "codex", configId: "fullstack-profile", model: "fullstack-model" },
    originProfile: { configId: "main-profile", subtaskFullstackThinkingMode: "max" },
  });
  assert.equal(untyped.role, "backend");
  assert.equal(untyped.model, "fullstack-model");
  assert.equal(untyped.configId, "fullstack-profile");
  assert.equal(untyped.thinkingMode, "max");
});

test("split routes frontend and backend separately and general always uses the main profile", () => {
  const shared = {
    mainCli: "codex" as const,
    loopSubtaskMode: "split" as const,
    mainRoute: { model: "main-model", configId: "main-profile" },
    backendRoute: { cli: "codex" as const, configId: "backend-profile", model: "backend-model" },
    frontendRoute: { cli: "grok" as const, configId: "frontend-profile", model: "frontend-model" },
    fullstackRoute: { cli: "dsh" as const, configId: "fullstack-profile", model: "fullstack-model" },
    originProfile: {
      configId: "main-profile",
      mainThinkingMode: "high" as const,
      subtaskThinkingMode: "low" as const,
      subtaskFrontendThinkingMode: "medium" as const,
      subtaskFullstackThinkingMode: "xhigh" as const,
    },
  };
  const frontend = resolveLoopPlusRoleExecution({ ...shared, taskType: "frontend" });
  assert.equal(frontend.cli, "grok");
  assert.equal(frontend.configId, "frontend-profile");
  assert.equal(frontend.model, "frontend-model");
  assert.equal(frontend.thinkingMode, "medium");
  const backend = resolveLoopPlusRoleExecution({ ...shared, taskType: "backend" });
  assert.equal(backend.cli, "codex");
  assert.equal(backend.configId, "backend-profile");
  assert.equal(backend.model, "backend-model");
  assert.equal(backend.thinkingMode, "low");
  const general = resolveLoopPlusRoleExecution({ ...shared, taskType: "general" });
  assert.equal(general.cli, "codex");
  assert.equal(general.configId, "main-profile");
  assert.equal(general.model, "main-model");
  assert.equal(general.thinkingMode, "high");
  assert.notEqual(general.model, "backend-model");
  const conflict = resolveLoopPlusRoleExecution({
    ...shared,
    taskType: "general",
    codingDelivery: true,
  });
  assert.match(conflict.unavailableReason || "", /分析任务不能携带编码交付/);
  const missingFrontend = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    loopSubtaskMode: "split",
    taskType: "frontend",
    backendRoute: shared.backendRoute,
    originProfile: shared.originProfile,
  });
  assert.match(missingFrontend.unavailableReason || "", /子-前端配置不可用/);
  assert.notEqual(missingFrontend.model, "backend-model");
});

test("legacy tasks without a mode keep the atomic subtask route and saved frontend routes stay split", () => {
  const legacy = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    taskType: "frontend",
    backendRoute: { cli: "codex", configId: "atomic-profile", model: "atomic-model" },
    originProfile: { configId: "atomic-profile", subtaskThinkingMode: "low", mainThinkingMode: "high" },
    mainRoute: { model: "main-model" },
  });
  assert.equal(legacy.mode, "fullstack");
  assert.equal(legacy.legacyAtomic, true);
  assert.equal(legacy.cli, "codex");
  assert.equal(legacy.configId, "atomic-profile");
  assert.equal(legacy.model, "atomic-model");
  assert.equal(legacy.thinkingMode, "low");

  const migrated = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    frontendRoute: { cli: "grok", configId: "ui-profile", model: "ui-model" },
    backendRoute: { cli: "codex", configId: "api-profile", model: "api-model" },
    taskType: "frontend",
    originProfile: { configId: "main-profile", subtaskFrontendThinkingMode: "high" },
  });
  assert.equal(migrated.mode, "split");
  assert.equal(migrated.cli, "grok");
  assert.equal(migrated.model, "ui-model");
  assert.equal(migrated.configId, "ui-profile");
});

test("failed subtask configuration does not fall back to the main model and same-CLI profiles stay isolated", () => {
  const missing = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    loopSubtaskMode: "fullstack",
    taskType: "backend",
    mainRoute: { model: "main-model", configId: "main-profile" },
    backendRoute: { model: "backend-model", configId: "backend-profile" },
    originProfile: { configId: "main-profile", mainThinkingMode: "high" },
  });
  assert.match(missing.unavailableReason || "", /子-全栈配置不可用/);
  assert.equal(missing.model, undefined);

  const otherProfile = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    loopSubtaskMode: "fullstack",
    taskType: "backend",
    mainRoute: { model: "main-model", configId: "profile-a" },
    fullstackRoute: { cli: "codex", configId: "profile-b", model: "fullstack-on-b" },
    originProfile: { configId: "profile-a", mainThinkingMode: "high", subtaskFullstackThinkingMode: "max" },
    prompt: { loopSubtaskModel: "leaked-main", loopMainModel: "main-model" },
  });
  assert.equal(otherProfile.cli, "codex");
  assert.equal(otherProfile.configId, "profile-b");
  assert.equal(otherProfile.model, "fullstack-on-b");
  assert.equal(otherProfile.thinkingMode, "max");
  assert.notEqual(otherProfile.model, "leaked-main");

  const crossCli = resolveLoopPlusRoleExecution({
    mainCli: "codex",
    loopSubtaskMode: "split",
    taskType: "backend",
    backendRoute: { cli: "grok", model: "grok-backend" },
    mainRoute: { model: "main-model", configId: "codex-profile" },
    originProfile: { configId: "codex-profile" },
  });
  assert.equal(crossCli.crossCli, true);
  assert.equal(crossCli.configId, null);
  assert.match(crossCli.unavailableReason || "", /没有可用配置/);
  assert.notEqual(crossCli.model, "main-model");
});

test("role settings survive mode toggles and seed only once", () => {
  let store = ensureCliModelStore({
    selectedLoopByConfigId: { "profile-a": { subtask: "atomic-model" } },
    selectedLoopSubtaskCliByConfigId: { "profile-a": "codex" },
  } as never);
  assert.equal(loopFullstackRoleNeedsSeed(store, "profile-a"), true);
  store = selectLoopFullstackCliInStore(store, "profile-a", "dsh");
  store = setLoopRoleExplicitModelInStore(store, "dsh-profile", "fullstack", "fullstack-model");
  store = setLoopRoleExplicitModelInStore(store, "grok-profile", "frontend", "frontend-model");
  store = selectLoopSubtaskModeInStore(store, "profile-a", "split");
  store = selectLoopSubtaskModeInStore(store, "profile-a", "fullstack");
  assert.equal(store.selectedLoopFullstackCliByConfigId["profile-a"], "dsh");
  assert.equal(store.loopRoleExplicitModelByConfigId["dsh-profile"]?.fullstack, "fullstack-model");
  assert.equal(store.loopRoleExplicitModelByConfigId["grok-profile"]?.frontend, "frontend-model");
  assert.equal(store.selectedLoopByConfigId["profile-a"]?.subtask, "atomic-model");
  store = setLoopRoleExplicitModelInStore(store, "dsh-profile", "fullstack", "");
  assert.equal(store.loopRoleExplicitModelByConfigId["dsh-profile"]?.fullstack, "");
  assert.equal(loopFullstackRoleNeedsSeed(markLoopFullstackRoleSeededInStore(store, "profile-a"), "profile-a"), false);
  const roundTrip = ensureCliModelStore(JSON.parse(JSON.stringify(store)));
  assert.equal(roundTrip.selectedLoopSubtaskModeByConfigId["profile-a"], "fullstack");
  assert.equal(roundTrip.loopRoleExplicitModelByConfigId["grok-profile"]?.frontend, "frontend-model");
  assert.equal(normalizeLoopTaskModelRouting({
    main: { model: "main" },
    subtask: { model: "backend" },
    subtaskFrontend: { model: "frontend" },
    subtaskFullstack: { cli: "not-a-cli", model: "stolen" },
  })?.subtaskFullstack?.fallback, "invalid-subtask-cli");
});

test("prompts state the active mode and the launch binding uses that route", () => {
  const subtaskPrompt = buildLoopPlusSubtaskModelPrompt({
    subtask: { title: "ui", prompt: "implement the panel" },
    communicationFile: "attempt.md",
    executionRole: "frontend",
    loopSubtaskMode: "fullstack",
  });
  assert.match(subtaskPrompt, /fullstack sub-model/);
  const { resolveLoopPlusPromptRoleBinding } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
  const binding = resolveLoopPlusPromptRoleBinding({
    role: "subtask",
    executionRole: "frontend",
    task: {
      cli: "codex",
      loopSubtaskMode: "fullstack",
      modelRouting: {
        main: { model: "main-model" },
        subtask: { model: "backend-model", configId: "backend-profile" },
        subtaskFrontend: { cli: "grok", model: "frontend-model", configId: "frontend-profile" },
        subtaskFullstack: { cli: "dsh", model: "fullstack-model", configId: "fullstack-profile" },
      },
      originProfile: {
        configId: "main-profile",
        mainThinkingMode: "high",
        subtaskFullstackThinkingMode: "xhigh",
      },
    },
    live: null,
  });
  assert.equal(binding.model, "fullstack-model");
  assert.equal(binding.loopSubtaskCli, "dsh");
  assert.equal(binding.loopSubtaskConfigId, "fullstack-profile");
  assert.equal(binding.loopSubtaskThinkingMode, "xhigh");
  const generalBinding = resolveLoopPlusPromptRoleBinding({
    role: "subtask",
    executionRole: "general",
    task: {
      cli: "codex",
      loopSubtaskMode: "split",
      modelRouting: {
        main: { model: "main-model" },
        subtask: { model: "backend-model" },
      },
      originProfile: { configId: "main-profile", mainThinkingMode: "high" },
    },
    live: { loopSubtaskModel: "backend-model", loopSubtaskThinkingMode: "low" },
  });
  assert.equal(generalBinding.model, "main-model");
  assert.equal(generalBinding.loopSubtaskCli, undefined);
  assert.equal(generalBinding.loopMainThinkingMode, "high");
});
