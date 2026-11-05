import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import { CLI_LIST, type ThinkingMode } from "../../cli/types";
import type { PromptRunInput } from "../../promptRunTypes";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createPromptRunModelsHost } = require("../../extensionHost/promptRunModels") as typeof import("../../extensionHost/promptRunModels");

function modelsHost(overrides: Partial<Parameters<typeof createPromptRunModelsHost>[0]> = {}) {
  return createPromptRunModelsHost({
    getActiveConfigIdForCli: () => null,
    getSelectedCliModel: () => "main-model",
    getSelectedLoopCliModel: () => "child-model",
    getSelectedLoopThinkingMode: () => "medium",
    normalizeThinkingModeForCli: (_cli, mode) => mode,
    getEffectiveThinkingMode: () => "high",
    isThinkingMode: (value): value is ThinkingMode => typeof value === "string" && ["off", "on", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value),
    resolveOpenCodeRoleModelsForConfig: () => ({ main: null, subtask: null, fallback: {} }),
    ...overrides,
  });
}

const baseInput: PromptRunInput = { displayPrompt: "验证力度", modelPrompt: "验证力度", contextTags: [] };
const thinkingModes: ThinkingMode[] = ["off", "on", "low", "medium", "high", "xhigh", "max", "ultra"];

for (const cli of CLI_LIST) {
  test("Loop 子任务保留 " + cli + " 用户提交的思考力度", () => {
    const host = modelsHost();
    for (const thinkingMode of thinkingModes) {
      for (const crossCli of [false, true]) {
        const input = {
          ...baseInput,
          loopMainThinkingMode: "low" as const,
          loopSubtaskThinkingMode: thinkingMode,
          ...(crossCli ? { loopSubtaskCli: cli } : {}),
        };
        assert.equal(host.resolvePromptRunThinkingModeForRole(input, cli, "subtask", "child-model"), thinkingMode);
      }
    }
  });
}

test("主任务不继承子任务力度，配置档案选择的高档力度不被截断", () => {
  const host = modelsHost({
    getSelectedLoopThinkingMode: (_cli, role, model, configId) => {
      assert.equal(role, "subtask");
      assert.equal(model, "child-model");
      assert.equal(configId, "child-profile");
      return "ultra";
    },
  });
  assert.equal(host.resolvePromptRunThinkingModeForRole({ ...baseInput, loopMainThinkingMode: "max", loopSubtaskThinkingMode: "low" }, "codex", "main", "main-model"), "max");
  assert.equal(host.resolvePromptRunThinkingModeForRole(baseInput, "codex", "subtask", "child-model", { configId: "child-profile" }), "ultra");
});

test("未指定力度沿用原有默认，非法值不下发，跨 CLI 不继承主 CLI 默认", () => {
  const host = modelsHost({ getSelectedLoopThinkingMode: () => null, getEffectiveThinkingMode: () => "max" });
  assert.equal(host.resolvePromptRunThinkingModeForRole(baseInput, "codex", "subtask", "child-model"), "max");
  assert.equal(host.resolvePromptRunThinkingModeForRole({ ...baseInput, loopSubtaskThinkingMode: "invalid" as ThinkingMode }, "codex", "subtask", "child-model"), "max");
  assert.equal(host.resolvePromptRunThinkingModeForRole({ ...baseInput, loopSubtaskCli: "codex" }, "codex", "subtask", "child-model"), undefined);
  assert.equal(host.resolvePromptRunThinkingModeForRole(baseInput, "opencode", "subtask", "child-model"), undefined);
});

test("经典 Loop 和 Loop+ 共用无上限的角色力度解析器", () => {
  const loopSource = fs.readFileSync(path.join(process.cwd(), "src", "extensionHost", "loopOrchestration.ts"), "utf8");
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const adapterSource = fs.readFileSync(path.join(process.cwd(), "src", "extensionHost", "loopPlusRuntimeAdapter.ts"), "utf8");
  assert.match(loopSource, /const thinkingModeOverride = resolvePromptRunThinkingModeForRole\(routedInput,\s*thinkingCli,\s*role,\s*roleModel,/u);
  assert.match(extensionSource, /resolveThinkingMode:.*resolvePromptRunThinkingModeForRole\(/u);
  assert.match(adapterSource, /promptInput\.thinkingModeOverride = deps\.resolveThinkingMode\(/u);
  assert.doesNotMatch(loopSource + extensionSource + adapterSource, /applySubtaskCap|getGlobalLoopSubtaskMaxThinkingMode/u);
});
