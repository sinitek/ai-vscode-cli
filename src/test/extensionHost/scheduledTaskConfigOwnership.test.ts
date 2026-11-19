import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";
import * as ts from "typescript";
import type { PromptRunInput } from "../../promptRunTypes";
import { assertModeAvailable } from "../../modeAvailability";

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
      Error,
      activeWorkspaceKey: "workspace",
      ensureScheduledTaskTargetTab: () => "tab",
      configApplyQueue: { waitForIdle: async () => waitSucceeds },
      readToolSettings: () => ({ loopEnabled: true, loopPlusEnabled: true }),
      assertModeAvailable,
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

test("department schedules reject creation and execution before attachments, tabs or prompt side effects", async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const file = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.ES2020, true);
  const functionScript = (name: string): string => {
    const declaration = file.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(declaration);
    return ts.transpileModule(declaration.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  };
  for (const explicit of [true, false]) {
    let effects = 0;
    const create = vm.runInNewContext(functionScript("schedulePromptTask") + "\nschedulePromptTask;", {
      currentCli: "codex", isCliName: () => true, isInteractiveMode: (mode: unknown) => mode === "department",
      normalizeVisibleInteractiveMode: (mode: unknown) => mode, getWorkspaceInteractiveMode: () => "department",
      readScheduledTasks: () => { effects++; return { tasks: [] }; },
      saveScheduledTaskAttachments: async () => { effects++; return {}; }, t: (key: string) => key,
    }) as (input: Record<string, unknown>) => Promise<{ error?: string }>;
    const created = await create({ prompt: "目标", scheduledAt: Date.now() + 60_000, ...(explicit ? { interactiveMode: "department" } : {}) });
    assert.match(created.error ?? "", /产研部定时任务入口尚未接入/); assert.equal(effects, 0);
    const execute = vm.runInNewContext(functionScript("executeScheduledTask") + "\nexecuteScheduledTask;", {
      activeWorkspaceKey: "workspace", getWorkspaceInteractiveMode: () => "department",
      readToolSettings: () => ({ departmentEnabled: true }), assertModeAvailable,
      resolveScheduledTaskExecutionConfigForTask: (task: { interactiveMode?: string }, fallback: string) => ({ interactiveMode: task.interactiveMode ?? fallback }),
      ensureScheduledTaskTargetTab: () => { effects++; return "tab"; },
      configApplyQueue: { waitForIdle: async () => { effects++; return true; } },
    }) as (task: Record<string, unknown>) => Promise<void>;
    await assert.rejects(execute({ cli: "codex", workspaceKey: "workspace", ...(explicit ? { interactiveMode: "department" } : {}) }), /产研部定时任务入口尚未接入/);
    assert.equal(effects, 0);
  }
});

test("scheduled execution rejects disabled modes and rechecks after asynchronous config wait", async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const file = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.ES2020, true);
  const declaration = file.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === "executeScheduledTask"
  ));
  assert.ok(declaration);
  const script = ts.transpileModule(declaration.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const mode of ["loop", "loop_plus", "department"]) {
    let settings = { loopEnabled: false, loopPlusEnabled: false, departmentEnabled: false };
    let effects = 0;
    const execute = vm.runInNewContext(`${script}\nexecuteScheduledTask;`, {
      Error,
      activeWorkspaceKey: "workspace", getWorkspaceInteractiveMode: () => mode,
      resolveScheduledTaskExecutionConfigForTask: () => ({ interactiveMode: mode }),
      readToolSettings: () => settings, assertModeAvailable,
      ensureScheduledTaskTargetTab: () => { effects++; return "tab"; },
    }) as (task: Record<string, unknown>) => Promise<void>;
    await assert.rejects(execute({ workspaceKey: "workspace", cli: "codex" }), /已在工具设置中关闭/);
    assert.equal(effects, 0);
  }

  let settings = { loopEnabled: true, loopPlusEnabled: true, departmentEnabled: false };
  let effects = 0;
  const execute = vm.runInNewContext(`${script}\nexecuteScheduledTask;`, {
    Error,
    activeWorkspaceKey: "workspace", getWorkspaceInteractiveMode: () => "loop_plus",
    resolveScheduledTaskExecutionConfigForTask: () => ({ interactiveMode: "loop_plus" }),
    readToolSettings: () => settings, assertModeAvailable,
    ensureScheduledTaskTargetTab: () => { effects++; return "tab"; },
    configApplyQueue: { waitForIdle: async () => { settings = { ...settings, loopPlusEnabled: false }; return true; } },
  }) as (task: Record<string, unknown>) => Promise<void>;
  await assert.rejects(execute({ workspaceKey: "workspace", cli: "codex" }), /已在工具设置中关闭/);
  assert.equal(effects, 1);
});
