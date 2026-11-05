import test = require("node:test");
import assert = require("node:assert/strict");
import { CLI_LIST, type CliName } from "../../cli/types";
import type { PromptRunInput } from "../../promptRunTypes";
import { installVscodeMock } from "../vscodeMock";
import { withLoopPlusAcceptReviews, loopPlusAcceptanceChecksFixture } from "../loopPlusAcceptFixture";

installVscodeMock();

const { createPromptRunModelsHost } = require("../../extensionHost/promptRunModels") as typeof import("../../extensionHost/promptRunModels");
const { createLoopPlusRuntimeFixture } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const configService = require("../../config/configService") as typeof import("../../config/configService");

function modelsHost() {
  return createPromptRunModelsHost({
    getActiveConfigIdForCli: () => null,
    getSelectedCliModel: () => "unrelated-main",
    getSelectedLoopCliModel: () => "unrelated-subtask",
    getSelectedLoopThinkingMode: () => "medium",
    normalizeThinkingModeForCli: (_cli, mode) => mode,
    getEffectiveThinkingMode: () => "high",
    isThinkingMode: (value): value is import("../../cli/types").ThinkingMode => typeof value === "string" && ["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"].includes(value),
    resolveOpenCodeRoleModelsForConfig: () => ({ main: "provider/stored-main", subtask: "provider/stored-child", fallback: {} }),
  });
}

for (const cli of CLI_LIST) {
  for (const crossCli of [false, true]) {
    for (const mode of ["fullstack", "split"] as const) {
      test(`Loop+ ${cli} ${mode} crossCli=${crossCli} preserves bound model and thinking`, async () => {
        const host = modelsHost();
        const thinkingMode = mode === "fullstack" ? "max" : "ultra";
        const mainCli: CliName = crossCli ? (cli === "codex" ? "grok" : "codex") : cli;
        const fixture = createLoopPlusRuntimeFixture({
          cli: mainCli,
          resolveThinkingMode: (input, targetCli, role, model) => host.resolvePromptRunThinkingModeForRole(input, targetCli, role, model),
        });
        let taskId = "";
        try {
          fixture.queueMain((input, tabId) => {
            taskId = input.loopTaskId!;
            assert.equal(input.model, "main-model");
            assert.equal(input.loopSubtaskFrontendCli, cli);
            assert.equal(input.loopSubtaskFullstackCli, cli);
            fixture.publish(input, tabId, { status: "end", content: JSON.stringify(withLoopPlusAcceptReviews({ status: "dispatch", subtasks: [{ id: "work", title: "验证模型", taskType: mode === "split" ? "frontend" : "backend", prompt: "Implement the isolated routing check. Write the result to result.txt and report the actual verification evidence.", writeFiles: ["result.txt"] }] })) });
          });
          for (let count = 0; count < 3; count += 1) {
            fixture.queueMain((input, tabId) => {
              assert.equal(input.model, "main-model");
              const eventId = input.modelPrompt.match(/Current review eventId: (\S+)/)?.[1];
              fixture.publish(input, tabId, { status: "end", content: JSON.stringify(withLoopPlusAcceptReviews({ status: "completed", ...(eventId && eventId !== "(none)" ? { reviewEventId: eventId } : {}), answerConclusion: "已验证", finalSummary: "已完成", acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "模型路由", passed: true }] })) });
            });
          }
          fixture.setAttemptAction((input, tabId) => {
            assert.equal(input.model, "child-model");
            assert.equal(input.loopSubtaskModel, "child-model");
            assert.equal(input.thinkingModeOverride, thinkingMode);
            assert.equal(fixture.createdSubtaskTargets.at(-1)?.cli, cli);
            fixture.publish(input, tabId, { status: "end", content: "已验证" });
          });
          await fixture.adapter.runEventDriven({
            displayPrompt: "验证角色参数",
            modelPrompt: "验证角色参数",
            contextTags: [],
            model: "main-model", loopMainModel: "main-model", loopMainThinkingMode: "high",
            loopSubtaskCli: cli, loopSubtaskConfigId: "child-config", loopSubtaskModel: "child-model", loopSubtaskThinkingMode: thinkingMode,
            loopSubtaskFrontendCli: cli, loopSubtaskFrontendConfigId: "child-config", loopSubtaskFrontendModel: "child-model", loopSubtaskFrontendThinkingMode: thinkingMode,
            loopSubtaskFullstackCli: cli, loopSubtaskFullstackConfigId: "child-config", loopSubtaskFullstackModel: "child-model", loopSubtaskFullstackThinkingMode: thinkingMode,
            loopSubtaskMode: mode,
          }, { schedulingMode: "event_driven" }, fixture.target);
          assert.equal(fixture.readTask(taskId)?.status, "completed");
          assert.equal(fixture.attemptCalls.length, 1);
        } finally {
          fixture.dispose();
        }
      });
    }
  }
}

for (const frontendConfigId of [undefined, "frontend-profile"]) {
  test(`Loop+ dispatches and accepts a saved frontend route without CLI and profile=${frontendConfigId ?? "origin"}`, async () => {
    const fixture = createLoopPlusRuntimeFixture();
    let taskId = "";
    try {
      fixture.queueMain((input, tabId) => {
        taskId = input.loopTaskId!;
        const task = fixture.readTask(taskId);
        assert.ok(task);
        fixture.saveTask({
          ...task,
          loopSubtaskMode: "split",
          modelRouting: {
            main: { model: "main-model" },
            subtask: { model: "backend-model" },
            subtaskFrontend: { model: "frontend-model", ...(frontendConfigId ? { configId: frontendConfigId } : {}) },
          },
          originProfile: { configId: "main-profile", subtaskFrontendThinkingMode: "low" },
        });
        fixture.publish(input, tabId, { status: "end", content: JSON.stringify(withLoopPlusAcceptReviews({
          status: "dispatch",
          subtasks: [{ id: "frontend", title: "前端实现", taskType: "frontend", prompt: "Implement the isolated frontend change in result.txt and report the actual verification evidence.", writeFiles: ["result.txt"] }],
        })) });
      });
      for (let count = 0; count < 3; count += 1) {
        fixture.queueMain((input, tabId) => {
          const eventId = input.modelPrompt.match(/Current review eventId: (\S+)/)?.[1];
          fixture.publish(input, tabId, { status: "end", content: JSON.stringify(withLoopPlusAcceptReviews({
            status: "completed",
            ...(eventId && eventId !== "(none)" ? { reviewEventId: eventId } : {}),
            answerConclusion: "已验证",
            finalSummary: "前端路由已验收",
            acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
            requirementCoverage: [{ name: "前端路由", passed: true }],
          })) });
        });
      }
      fixture.setAttemptAction((input, tabId) => {
        assert.equal(input.model, "frontend-model");
        assert.equal(input.loopSubtaskModel, "frontend-model");
        assert.equal(input.loopSubtaskConfigId, frontendConfigId ?? "main-profile");
        assert.equal(input.loopSubtaskThinkingMode, "low");
        assert.equal(fixture.createdSubtaskTargets.at(-1)?.cli, "codex");
        fixture.publish(input, tabId, { status: "end", content: "前端实现已完成" });
      });
      await fixture.adapter.runEventDriven({
        displayPrompt: "验证已有前端路由",
        modelPrompt: "验证已有前端路由",
        contextTags: [],
        model: "main-model",
        loopSubtaskModel: "backend-model",
        loopSubtaskMode: "split",
      }, { schedulingMode: "event_driven" }, fixture.target);
      assert.equal(fixture.attemptCalls.length, 1);
      assert.equal(fixture.readTask(taskId)?.status, "completed");
    } finally {
      fixture.dispose();
    }
  });
}

test("OpenCode hydration keeps the selected subtask model instead of restoring the main model", async () => {
  const original = configService.getCurrentConfig;
  configService.getCurrentConfig = async () => ({ content: "{}" }) as Awaited<ReturnType<typeof configService.getCurrentConfig>>;
  try {
    const host = modelsHost();
    for (const loopSubtaskCli of [undefined, "opencode"] as const) {
      const input: PromptRunInput = { displayPrompt: "test", modelPrompt: "test", contextTags: [], taskRole: "subtask", model: "provider/bound-child", loopMainModel: "provider/main", loopSubtaskModel: "provider/child", loopSubtaskCli };
      assert.equal((await host.hydrateOpenCodePromptRoleModels(input, "opencode")).model, "provider/bound-child");
      assert.equal((await host.hydrateOpenCodePromptRoleModels({ ...input, model: undefined }, "opencode")).model, "provider/child");
      assert.equal((await host.hydrateOpenCodePromptRoleModels({ ...input, taskRole: "main", loopSubtaskCli: undefined }, "opencode")).model, "provider/main");
    }
  } finally {
    configService.getCurrentConfig = original;
  }
});

test("OpenCode leaves unspecified thinking to its role-specific variant preparation", () => {
  const host = modelsHost();
  const input: PromptRunInput = { displayPrompt: "test", modelPrompt: "test", contextTags: [] };
  assert.equal(host.resolvePromptRunThinkingModeForRole(input, "opencode", "subtask", "provider/child"), undefined);
  assert.equal(host.resolvePromptRunThinkingModeForRole({ ...input, loopSubtaskThinkingMode: "low" }, "opencode", "subtask", "provider/child"), "low");
});
