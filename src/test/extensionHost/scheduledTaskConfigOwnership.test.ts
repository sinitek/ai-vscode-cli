import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";
import * as ts from "typescript";
import type { PromptRunInput } from "../../promptRunTypes";

test("scheduled tasks dispatch with the current CLI profiles and models instead of their saved snapshots", async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const sourceFile = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.ES2020, true);
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === "executeScheduledTask"
  ));
  assert.ok(declaration);
  const script = ts.transpileModule(declaration.getText(sourceFile), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const mode of ["coding", "loop", "loop_plus"]) {
    let waitSucceeds = true;
    const dispatched: { input: PromptRunInput; route: string }[] = [];
    const execute = vm.runInNewContext(`${script}\nexecuteScheduledTask;`, {
      activeWorkspaceKey: "workspace",
      ensureScheduledTaskTargetTab: () => "tab",
      configApplyQueue: { waitForIdle: async () => waitSucceeds },
      resolveScheduledTaskExecutionConfigForTask: () => ({ interactiveMode: mode }),
      getWorkspaceInteractiveMode: () => mode,
      buildScheduledAttachmentPrompt: () => "执行",
      buildPromptWithAutoContextFromPanelStateBuilder: () => ({ modelPrompt: "执行", contextTags: [] }),
      maybeInjectLongTermMemoryForPromptWithEditorContext: () => "执行",
      buildLongTermMemoryRuntimeSettings: () => ({}),
      getActiveWorkspaceMemoryPaths: () => null,
      logError: () => undefined,
      resolveCodexImagePathsForPrompt: async () => [],
      getActiveConfigIdForCli: (cli: string) => `${cli}-current`,
      getSelectedCliModel: (_cli: string, configId: string) => `${configId}-model`,
      getSelectedLoopCliModel: (_cli: string, role: string, configId: string) => `${configId}-${role}`,
      resolvePromptRunTarget: () => ({ tabId: "tab", cli: "codex", sessionId: null }),
      preloadUserMessageForPrompt: (input: PromptRunInput) => input,
      schedulingModeForInteractiveMode: () => undefined,
      runPrompt: async (input: PromptRunInput) => { dispatched.push({ input, route: "vibe" }); },
      runLoopPrompt: async (input: PromptRunInput) => { dispatched.push({ input, route: "loop" }); },
    }) as (task: Record<string, unknown>) => Promise<void>;
    const task = { workspaceKey: "workspace", cli: "codex", model: "old-model", loopMainModel: "old-main",
      loopSubtaskCli: "grok", loopSubtaskConfigId: "old-profile", loopSubtaskModel: "old-subtask" };
    await execute(task);
    assert.equal(dispatched[0].route, mode === "coding" ? "vibe" : "loop");
    assert.equal(dispatched[0].input.model, "codex-current-model");
    assert.equal(dispatched[0].input.loopMainModel, "codex-current-main");
    assert.equal(dispatched[0].input.loopSubtaskModel, "grok-current-subtask");
    assert.equal(dispatched[0].input.loopSubtaskConfigId, "grok-current");
    waitSucceeds = false;
    await assert.rejects(execute(task), /配置应用失败/);
    assert.equal(dispatched.length, 1);
  }
});
