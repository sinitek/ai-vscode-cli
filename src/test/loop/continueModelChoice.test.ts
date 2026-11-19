import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

import {
  loopModelRoutingFromPromptInput,
  promptModelsFromContinuePair,
  resolveCurrentLoopModelPair,
  resolveLoopContinueModelPair,
} from "../../continueModelChoice";
import { normalizeLoopTaskModelRouting, normalizeLoopTaskOriginProfile } from "../../loopTaskStore";
import { resolveLoopPlusRoleExecution } from "../../subtaskCliRoute";

for (const crossCli of [false, true]) {
  for (const storedCli of [false, true]) {
    for (const explicitModel of [null, "named-model", ""]) {
      test(`continue current config keeps named role bindings with crossCli=${crossCli}, stored=${storedCli}, explicit=${JSON.stringify(explicitModel)}`, () => {
        const cli = crossCli ? "grok" : "codex";
        const configId = crossCli ? "child-config" : "main-config";
        const pair = resolveCurrentLoopModelPair({
          cli: "codex",
          configId: "main-config",
          getSelectedCliModel: () => "gpt-6.1-sol",
          getSelectedLoopCliModel: (_cli, role) => role === "subtask" ? "gpt-6.1-terra" : "gpt-6.1-sol",
          getSelectedLoopFrontendCli: () => storedCli || crossCli ? cli : null,
          getSelectedLoopFullstackCli: () => storedCli || crossCli ? cli : null,
          getActiveConfigIdForCli: () => "child-config",
          getLoopRoleExplicitModel: () => ({ configured: explicitModel !== null, model: explicitModel ?? "" }),
        });
        const expectedModel = (explicitModel ?? "gpt-6.1-terra") || null;
        assert.equal(pair.fullstack ?? null, expectedModel);
        assert.equal(pair.frontend ?? null, expectedModel);
        assert.equal(pair.fullstackCli, cli);
        assert.equal(pair.frontendCli, cli);
        assert.equal(pair.fullstackConfigId, configId);
        assert.equal(pair.frontendConfigId, configId);
        const prompt = promptModelsFromContinuePair(pair);
        const routing = loopModelRoutingFromPromptInput(prompt, { mainCli: "codex" });
        for (const mode of ["fullstack", "split"]) {
          const execution = resolveLoopPlusRoleExecution({
            mainCli: "codex", loopSubtaskMode: mode, taskType: "frontend",
            fullstackRoute: routing?.subtaskFullstack, frontendRoute: routing?.subtaskFrontend,
            prompt,
          });
          assert.equal(execution.unavailableReason, undefined);
          assert.equal(execution.model ?? null, expectedModel);
        }
      });
    }
  }
}

test("continue model choice keeps recorded models or switches to the current Loop config", () => {
  const original = { main: "original-main", subtask: "original-subtask" };
  const current = { main: "current-main", subtask: "current-subtask" };

  assert.deepEqual(resolveLoopContinueModelPair({
    modelSource: "original",
    original,
    current,
  }), original);
  assert.deepEqual(promptModelsFromContinuePair(original), {
    model: "original-main",
    loopMainModel: "original-main",
    loopSubtaskModel: "original-subtask",
  });
  assert.deepEqual(resolveLoopContinueModelPair({
    modelSource: "current",
    original,
    current,
  }), current);
  assert.deepEqual(resolveLoopContinueModelPair({
    modelSource: null,
    original,
    current,
  }), current);
  assert.deepEqual(resolveLoopContinueModelPair({
    modelSource: "original",
    original: { main: null, subtask: null },
    current,
  }), current);
});

test("new Loop tasks snapshot the prompt main and subtask models", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/extension.ts"), "utf8");
  const file = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const orchestration = file.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "runLoopPromptOrchestration");
  assert.ok(orchestration);
  let creation: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "resolveLoopTaskAtCreationBoundary") creation = node;
    ts.forEachChild(node, visit);
  };
  visit(orchestration);
  assert.ok(creation);
  const options = creation.arguments[0];
  assert.ok(ts.isObjectLiteralExpression(options));
  const callback = options.properties.find((node): node is ts.PropertyAssignment =>
    ts.isPropertyAssignment(node) && node.name.getText(file) === "createTask");
  assert.ok(callback && ts.isArrowFunction(callback.initializer));
  const body = callback.initializer.body.getText(file);
  const createTaskIndex = body.indexOf("let createdTask = createLoopTaskRecord(target.cli, input.displayPrompt");
  const snapshotIndex = body.indexOf("loopModelRoutingFromPromptInput(input, { mainCli: target.cli })", createTaskIndex);
  const originIndex = body.indexOf("captureLoopOriginProfile(", snapshotIndex);
  const persistIndex = body.indexOf("createdTask = updateLoopTaskRecord(createdTask.id,", originIndex);
  const transcriptIndex = body.indexOf("ensureLoopMainSubChatTranscript(createdTask)", persistIndex);
  assert.ok(createTaskIndex >= 0 && snapshotIndex > createTaskIndex && originIndex > snapshotIndex);
  assert.ok(persistIndex > originIndex && transcriptIndex > persistIndex);
  assert.match(body.slice(persistIndex, transcriptIndex), /modelRouting \? \{ modelRouting \}/u);
  assert.match(body.slice(persistIndex, transcriptIndex), /originProfile \? \{ originProfile \}/u);
  assert.ok(body.indexOf("return createdTask", transcriptIndex) > transcriptIndex);
});

test("Loop origin profile keeps config and thinking only when a config id exists", () => {
  assert.equal(normalizeLoopTaskOriginProfile({ configId: "  ", mainThinkingMode: "high" }), undefined);
  assert.deepEqual(normalizeLoopTaskOriginProfile({
    configId: " config-1 ",
    mainThinkingMode: "high",
    subtaskThinkingMode: "nope",
    mainOpenCodeVariant: " max ",
    subtaskOpenCodeVariant: "",
  }), {
    configId: "config-1",
    mainThinkingMode: "high",
    mainOpenCodeVariant: "max",
  });
});
