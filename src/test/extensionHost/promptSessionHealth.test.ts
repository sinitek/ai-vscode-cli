import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";
import * as ts from "typescript";
import type { CliName } from "../../cli/types";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";
import { shouldUseClassicLoopProjectInstructions } from "../../extensionHost/promptExecutionShared";
import { createPromptAutoRepairController } from "../../extensionHost/promptAutoRepair";
import { isCliShellCommandNotFoundError } from "../../cli/cliCommandRepair";
import { CLI_LIST } from "../../cli/types";
import { planBoundSubtaskConfigApply } from "../../subtaskCliRoute";
import { createLoopMainQuestionQueue } from "../../loopMainQuestionQueue";
import { applyLoopInvocationModelRouting } from "../../loopModelSwitch";
import type { LoopTaskModelRouting } from "../../loopTaskStore";
import type { PromptRunExecutionOptions } from "../../extensionHost/promptExecutionShared";
import { takeOverSessionTab } from "../../extensionHost/sessionTabOwnership";
import { PromptRunHandoff } from "../../extensionHost/promptRunHandoff";
import { createCompletedLoopSubtaskTabCleanup } from "../../extensionHost/loopSubtaskTabs";
import type { ConversationTabRecord } from "../../sessionTabs";
import type { ChatMessage } from "../../webview/types";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { buildVibeModeTransitionPrompt } = require("../../panelStateBuilder") as typeof import("../../panelStateBuilder");

const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
const sourceFile = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
const runPromptDeclaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "runPrompt");
const admissionDeclaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "runPromptWithDepartmentAdmission");
const prepareDeclaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "prepareDepartmentInvocation");
const runPromptNowDeclaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "runPromptNow");
assert.ok(runPromptDeclaration);
assert.ok(runPromptNowDeclaration);
assert.ok(admissionDeclaration);
assert.ok(prepareDeclaration);
const runPromptScript = ts.transpileModule([
  runPromptDeclaration.getText(sourceFile),
  admissionDeclaration.getText(sourceFile),
  prepareDeclaration.getText(sourceFile),
  runPromptNowDeclaration.getText(sourceFile),
].join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function createHarness(options: {
  cli: CliName;
  health: "normal" | "abnormal";
  runtime: "interactive" | "parallel" | "one-shot";
  sessionIdAfterWait?: string | null;
  waitForSubtaskCompact?: (cli: CliName, sessionId: string | null) => Promise<void>;
  failures?: Error[];
  repairResult?: boolean;
  commandUnresolved?: boolean;
  activeConfigId?: string | null;
  fallbackConfigId?: string | null;
  loadedActiveConfigId?: string;
  waitForConfigApply?: () => Promise<boolean>;
  configExists?: boolean;
  preflightMessage?: string;
  loopSessionId?: string;
  loopModelRouting?: LoopTaskModelRouting;
  sessionMessages?: ChatMessage[];
}) {
  const tab: ConversationTabRecord = { id: "target-tab", cli: options.cli, sessionId: "previous-session",
    sessionIdByCli: { [options.cli]: "previous-session" }, createdAt: 1 };
  const tabs = [tab];
  const events: string[] = [];
  const systemMessages: string[] = [];
  const errorLogs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const statuses: string[] = [];
  const boundConfigs: Array<{ cli: CliName; sessionId: string; configId: string | null }> = [];
  const questionQueue = createLoopMainQuestionQueue();
  let activeConfigId = options.activeConfigId === undefined ? "selected-config" : options.activeConfigId;
  const dispatched: Array<{ input: PromptRunInput; target: PromptRunTarget; executionOptions: PromptRunExecutionOptions }> = [];
  const dispatch = async (input: PromptRunInput, target: PromptRunTarget, executionOptions: PromptRunExecutionOptions): Promise<void> => {
    events.push("dispatch");
    dispatched.push({ input, target: { ...target }, executionOptions });
    const failure = options.failures?.shift();
    if (failure) {
      throw failure;
    }
  };
  const runPrompt = vm.runInNewContext(`${runPromptScript}\nrunPrompt;`, {
    AbortController,
    isExtensionDeactivating: false,
    // These cases exercise ordinary prompts. Execute the real admission wrapper
    // and preparer, whose metadata check keeps them on the ordinary route.
    departmentProcessPreparation: null,
    departmentCodexPreparation: null,
    departmentOwnerResources: () => null,
    activeWorkspaceKey: "test-workspace",
    completedLoopSubtaskTabs: createCompletedLoopSubtaskTabCleanup({
      getWorkspaceKey: () => "test-workspace",
      getTabs: () => tabs,
      isTabRunActive: () => false,
      closeTab: async () => assert.fail("binding a prompt must not close a tab"),
    }),
    createPerformanceTrace: () => ({
      start: () => () => undefined,
      measure: (_phase: string, operation: () => unknown) => operation(),
    }),
    rememberConversationTaskSummarySubmission: () => null,
    promptAutoRepairController: createPromptAutoRepairController(),
    isCliShellCommandNotFoundError,
    loopMainQuestionQueue: questionQueue,
    promptRunHandoff: new PromptRunHandoff(),
    applyLoopInvocationModelRouting,
    shouldUseClassicLoopProjectInstructions,
    readLoopTaskRecord: () => options.loopSessionId
      ? { id: "parent-loop", cli: options.cli, status: "running", subTasks: [], modelRouting: options.loopModelRouting }
      : null,
    resolvePromptRunTargetSessionId: () => options.loopSessionId ?? null,
    bindLoopSubtaskSession: (subTasks: unknown[], _subtaskId: string,
      binding: { cli: CliName; sessionId: string; configId: string | null }) => {
      boundConfigs.push(binding);
      return subTasks;
    },
    updateLoopTaskRecord: () => undefined,
    getActiveConversationTabId: () => tab.id,
    resolvePromptRunTarget: () => ({ tabId: tab.id, cli: tab.cli, sessionId: tab.sessionId }),
    getConversationTabById: (tabId: string) => tabs.find((item) => item.id === tabId) ?? null,
    takeOverSessionForTab: (target: PromptRunTarget, isAborted?: () => boolean) => takeOverSessionTab(target, {
      getWorkspaceKey: () => "test-workspace",
      getTabs: () => tabs,
      getActiveRuns: () => [],
      isTabRunActive: () => false,
      stopTab: (tabId) => { events.push(`stop:${tabId}`); },
      closeTab: async (tabId) => {
        events.push(`close:${tabId}`);
        const index = tabs.findIndex((item) => item.id === tabId);
        if (index >= 0) tabs.splice(index, 1);
      },
    }, isAborted),
    getConversationTabSessionIdForCli: () => tab.sessionId,
    shouldAwaitCliCommandAutoRepair: () => false,
    getCliCommand: () => "cli",
    waitForCliCommandAutoRepair: async () => undefined,
    inspectUnresolvedCliCommands: () => options.commandUnresolved === false ? [] : [{ cli: options.cli }],
    locateCliExecutableForRepair: async () => options.repairResult === false ? null : "/tmp/repaired-cli",
    buildRepairedCliCommand: () => "/tmp/repaired-cli",
    persistCliCommand: async () => { events.push("persist-command"); },
    appendSystemMessageForPromptTarget: (_target: PromptRunTarget, message: string) => { systemMessages.push(message); },
    sendRunStatusForTab: (_tabId: string, status: string) => { statuses.push(status); },
    configApplyQueue: { waitForIdle: async (cli: CliName) => {
      assert.equal(cli, tab.cli);
      events.push("wait-config");
      return options.waitForConfigApply ? options.waitForConfigApply() : true;
    } },
    getActiveConfigIdForCli: () => activeConfigId,
    getSelectedCliModel: () => "current-model",
    getSelectedLoopCliModel: () => "current-loop-model",
    loadConfigState: async () => ({ activeConfigId, revision: `${activeConfigId ?? "native"}-revision`,
      configs: options.fallbackConfigId ? [{ id: options.fallbackConfigId }] : [] }),
    configService: {
      getConfigById: async () => options.configExists === false ? null : {},
    },
    planBoundSubtaskConfigApply,
    resolveWorkspaceCwd: () => null,
    t: (key: string) => key,
    logInfo: () => undefined,
    logError: (event: string, payload: Record<string, unknown>) => { errorLogs.push({ event, payload }); },
    getErrorInfo: (error: Error & { code?: string }) => ({ message: error.message, name: error.name, code: error.code }),
    isAbortErrorInfo: (info: { name?: string }) => info.name === "AbortError",
    loopMainAutoCompactFlights: { wait: async () => {
      if (options.sessionIdAfterWait !== undefined) {
        tab.sessionId = options.sessionIdAfterWait;
        if (tab.sessionId) tab.sessionIdByCli[tab.cli] = tab.sessionId;
        else delete tab.sessionIdByCli[tab.cli];
      }
    } },
    loopSubtaskAutoCompactions: { wait: async (cli: CliName, sessionId: string | null) => {
      await options.waitForSubtaskCompact?.(cli, sessionId);
    } },
    isTabRunActive: () => false,
    sessionLifecycleController: { prepareSessionForPromptRun: (cli: CliName, sessionId: string | null, tabId: string, prepareOptions?: { forceNewSession?: boolean }) => {
      assert.equal(cli, tab.cli);
      assert.equal(sessionId, tab.sessionId);
      assert.equal(tabId, tab.id);
      events.push("health-check");
      if (options.health === "abnormal" || prepareOptions?.forceNewSession) {
        tab.sessionId = null;
        delete tab.sessionIdByCli[tab.cli];
      }
      return tab.sessionId;
    } },
    disposeInteractiveRunnerIfUnused: (binding: { cli: CliName; sessionId: string }) => {
      assert.equal(binding.cli, tab.cli);
      assert.equal(binding.sessionId, options.sessionIdAfterWait ?? "previous-session");
      events.push("dispose-old-runner");
    },
    postPanelState: async () => { events.push("panel-state"); },
    scheduleLogRetentionCleanup: () => undefined,
    buildVibeModeTransitionPrompt,
    loadSessionMessages: (cli: CliName, sessionId: string) => {
      assert.equal(cli, tab.cli);
      assert.equal(sessionId, tab.sessionId);
      return options.sessionMessages ?? [];
    },
    preloadUserMessageForPrompt: (input: PromptRunInput, target: PromptRunTarget) => {
      assert.equal(target.sessionId, tab.sessionId);
      events.push("preload");
      return input;
    },
    getOpenCodeConfigPreflightMessage: async () => { events.push("preflight"); return options.preflightMessage ?? null; },
    isInteractiveSupported: () => options.runtime === "interactive",
    hasOtherTabRun: () => options.runtime === "parallel",
    runPromptInteractive: dispatch,
    runPromptParallel: dispatch,
    runPromptOneShot: dispatch,
  }) as (input: PromptRunInput, runOptions?: { isAborted?: () => boolean; onStarted?: () => void }) => Promise<void>;
  return { runPrompt, events, dispatched, systemMessages, statuses, boundConfigs, tabs, errorLogs,
    questionQueue,
    selectConfig: (configId: string) => { activeConfigId = configId; } };
}

test("dispatches a Vibe mode transition in the model prompt for every runtime reusing an orchestrated session", async () => {
  const input = { displayPrompt: "继续完成", modelPrompt: "继续完成并检查附加上下文", contextTags: [], preloadedUserMessageId: "current" };
  const sessionMessages: ChatMessage[] = [
    { id: "previous", role: "assistant", content: '{"action":"done"}', taskRole: "main", loopTaskId: "previous-task" },
    { id: "current", role: "user", content: input.displayPrompt },
  ];
  for (const runtime of ["interactive", "parallel", "one-shot"] as const) {
    const harness = createHarness({ cli: runtime === "interactive" ? "codex" : "opencode", health: "normal", runtime, sessionMessages });
    await harness.runPrompt(input);

    assert.equal(harness.dispatched.length, 1);
    assert.equal(harness.dispatched[0].target.sessionId, "previous-session");
    assert.equal(harness.dispatched[0].input.displayPrompt, input.displayPrompt);
    assert.ok(harness.dispatched[0].input.modelPrompt.startsWith(input.modelPrompt));
    assert.match(harness.dispatched[0].input.modelPrompt, /当前执行模式是 Vibe/);
  }
});

test("preserves the original prompt for replacement sessions and Loop questions", async () => {
  const input = { displayPrompt: "继续", modelPrompt: "继续", contextTags: [] };
  const sessionMessages: ChatMessage[] = [
    { id: "previous", role: "assistant", content: "编排结果", taskRole: "main", loopTaskId: "previous-task" },
  ];
  const replacement = createHarness({ cli: "codex", health: "abnormal", runtime: "interactive", sessionMessages });
  await replacement.runPrompt(input);
  assert.equal(replacement.dispatched[0]?.target.sessionId, null);
  assert.equal(replacement.dispatched[0]?.input.modelPrompt, input.modelPrompt);

  const question = createHarness({ cli: "codex", health: "normal", runtime: "interactive", sessionMessages });
  await question.runPrompt({ ...input, loopAsk: true });
  assert.equal(question.dispatched[0]?.input.modelPrompt, input.modelPrompt);
});

test("cancelling main work queued behind a question prevents a late CLI start", async () => {
  const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive", loopSessionId: "main-session" });
  let releaseQuestion: () => void = () => undefined;
  const question = harness.questionQueue.runQuestion("target-tab", { canRun: () => true }, () => (
    new Promise<void>((resolve) => { releaseQuestion = resolve; })
  ));
  let aborted = false;
  let started = false;
  const main = harness.runPrompt({ displayPrompt: "验收", modelPrompt: "验收", contextTags: [], taskRole: "main", loopTaskId: "parent-loop" }, {
    isAborted: () => aborted,
    onStarted: () => { started = true; },
  });
  assert.equal(harness.dispatched.length, 0);
  aborted = true;
  releaseQuestion();
  await Promise.all([main, question]);
  assert.equal(harness.dispatched.length, 0);
  assert.equal(started, false);
});

test("Loop question cancellation reaches every dispatched runtime", async () => {
  for (const runtime of ["interactive", "parallel", "one-shot"] as const) {
    const harness = createHarness({ cli: runtime === "interactive" ? "codex" : "opencode", health: "normal", runtime });
    let aborted = false;
    await harness.runPrompt({ displayPrompt: "提问", modelPrompt: "提问", contextTags: [], loopAsk: true }, {
      isAborted: () => aborted,
    });
    assert.equal(harness.dispatched.length, 1);
    const executionOptions = harness.dispatched[0].executionOptions;
    assert.equal(executionOptions.isAborted?.(), false);
    aborted = true;
    assert.equal(executionOptions.isAborted?.(), true);
  }
});

test("every public runtime takes over duplicate tabs before health checks and rejects a later closed target", async () => {
  for (const runtime of ["interactive", "parallel", "one-shot"] as const) {
    const h = createHarness({ cli: runtime === "interactive" ? "codex" : "opencode", health: "normal", runtime });
    h.tabs.unshift({ ...h.tabs[0], id: "old-tab" });
    await h.runPrompt({ displayPrompt: "继续会话", modelPrompt: "继续会话", contextTags: [] });
    assert.deepEqual(h.events.slice(0, 2), ["stop:old-tab", "close:old-tab"]);
    assert.equal(h.dispatched.length, 1);
    assert.deepEqual(h.tabs.map((item) => item.id), ["target-tab"]);
    assert.equal(h.dispatched[0].executionOptions.isAborted?.(), false);
    h.tabs.splice(0);
    assert.equal(h.dispatched[0].executionOptions.isAborted?.(), true);
  }
});

test("a model switch during config wait reaches the next main CLI invocation", async () => {
  let releaseWait = () => undefined as void;
  let enteredWait = () => undefined as void;
  const waiting = new Promise<void>((resolve) => { enteredWait = resolve; });
  const gate = new Promise<boolean>((resolve) => { releaseWait = () => resolve(true); });
  const routing: LoopTaskModelRouting = {
    main: { configId: "selected-config", model: "old-main" }, subtask: { model: "old-child" },
  };
  const harness = createHarness({
    cli: "codex", health: "normal", runtime: "interactive", loopSessionId: "main-session",
    loopModelRouting: routing, waitForConfigApply: () => { enteredWait(); return gate; },
  });
  const run = harness.runPrompt({
    displayPrompt: "继续", modelPrompt: "继续", contextTags: [], taskRole: "main", loopTaskId: "parent-loop",
    model: "old-main", loopMainModel: "old-main", loopSubtaskModel: "old-child",
  });
  await waiting;
  routing.main.model = "new-main";
  routing.subtask.model = "new-child";
  releaseWait();
  await run;
  assert.equal(harness.dispatched.length, 1);
  assert.equal(harness.dispatched[0].input.model, "new-main");
  assert.equal(harness.dispatched[0].input.loopMainModel, "new-main");
  assert.equal(harness.dispatched[0].input.loopSubtaskModel, "new-child");
});

test("a question cancelled while waiting for compaction never dispatches", async () => {
  let aborted = false;
  const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive",
    waitForSubtaskCompact: async () => { aborted = true; } });
  await harness.runPrompt({ displayPrompt: "提问", modelPrompt: "提问", contextTags: [], loopAsk: true }, { isAborted: () => aborted });
  assert.equal(harness.dispatched.length, 0);
});

test("Kimi model editing never reapplies or reactivates a stale profile after the coordinated save", async () => {
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "manageKimiCodeModelList");
  assert.ok(declaration);
  const script = ts.transpileModule(declaration.getText(sourceFile), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const calls: string[] = [];
  const manage = vm.runInNewContext(`${script}\nmanageKimiCodeModelList;`, {
    configApplyQueue: { request: async (cli: string, operation: { apply: () => Promise<void>; commit: () => void }) => {
      assert.equal(cli, "kimi-code");
      await operation.apply();
      operation.commit();
      return "applied";
    } },
    modelSettingsHost: { manageKimiCodeModelList: async (_change: unknown, configId: string) => {
      calls.push(configId);
      return { applied: true, model: "new-model", config: {} };
    } },
    configService: { applyConfig: () => { assert.fail("编辑后不应再次激活旧档案"); } },
    setWorkspaceActiveConfigId: () => { assert.fail("编辑不应切换所选档案"); },
  }) as (change: unknown, configId: string) => Promise<{ applied: boolean; model: string }>;
  const result = await manage({ type: "add", model: "new-model" }, "stale-profile");
  assert.deepEqual(calls, ["stale-profile"]);
  assert.equal(result.applied, true);
  assert.equal(result.model, "new-model");
});

test("continues normal sessions without disposing their runners", async () => {
  for (const cli of ["codex", "claude", "opencode", "grok"] as const) {
    const harness = createHarness({ cli, health: "normal", runtime: cli === "opencode" ? "one-shot" : "interactive" });
    await harness.runPrompt({ displayPrompt: "继续", modelPrompt: "继续", contextTags: [] });
    assert.equal(harness.dispatched[0].target.sessionId, "previous-session");
    assert.equal(harness.events.includes("dispose-old-runner"), false);
  }
});

test("rejects a rebound tab before its health check after waiting for compaction", async () => {
  const harness = createHarness({ cli: "grok", health: "abnormal", runtime: "interactive", sessionIdAfterWait: "newly-adopted-session" });
  await harness.runPrompt({ displayPrompt: "重试", modelPrompt: "重试", contextTags: [] });
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.events.includes("health-check"), false);
  assert.equal(harness.events.includes("dispose-old-runner"), false);
});

test("does not restore an old session ID when the target was cleared while waiting", async () => {
  const harness = createHarness({ cli: "grok", health: "normal", runtime: "interactive", sessionIdAfterWait: null });
  await harness.runPrompt({ displayPrompt: "新任务", modelPrompt: "新任务", contextTags: [] });
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.events.includes("dispose-old-runner"), false);
});

test("the unified entry waits for the current subtask session before acquiring config or dispatching", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sessions: Array<string | null> = [];
  const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive", waitForSubtaskCompact: async (cli, sessionId) => {
    assert.equal(cli, "codex");
    sessions.push(sessionId);
    await gate;
  } });
  const run = harness.runPrompt({ displayPrompt: "续接", modelPrompt: "续接", contextTags: [] });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(sessions, ["previous-session"]);
  assert.equal(harness.dispatched.length, 0);
  release();
  await run;
  assert.equal(harness.dispatched[0].target.sessionId, "previous-session");
});

test("the unified entry repairs ENOENT and uses a fresh session across all execution routes", async () => {
  for (const runtime of ["interactive", "one-shot", "parallel"] as const) {
    const failure = Object.assign(new Error("spawn cli ENOENT"), { code: "ENOENT" });
    const harness = createHarness({ cli: runtime === "interactive" ? "codex" : "opencode", health: "normal", runtime, failures: [failure] });
    await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "原始指令", contextTags: [], preloadedUserMessageId: "old-message", thinkingModeOverride: "high" });
    assert.equal(harness.dispatched.length, 2);
    assert.equal(harness.dispatched[0].target.sessionId, "previous-session");
    assert.equal(harness.dispatched[1].target.sessionId, null);
    assert.equal(harness.dispatched[1].input.preloadedUserMessageId, undefined);
    assert.equal(harness.dispatched[1].input.cliCommandRepairAttempted, true);
    assert.equal(harness.dispatched[1].input.thinkingModeOverride, "high");
    assert.equal(harness.events.filter((event) => event === "persist-command").length, 1);
  }
});

test("the unified entry stops when repair is unavailable or its single retry fails", async () => {
  for (const repairResult of [false, true]) {
    const failure = Object.assign(new Error("spawn cli ENOENT"), { code: "ENOENT" });
    const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive", failures: [failure, failure], repairResult });
    await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }), (error) => error === failure);
    assert.equal(harness.dispatched.length, repairResult ? 2 : 1);
    assert.equal(harness.events.filter((event) => event === "persist-command").length, repairResult ? 1 : 0);
  }
});

test("an ENOENT with a usable CLI command does not repair a missing cwd or unrelated file", async () => {
  const failure = Object.assign(new Error("spawn cli ENOENT"), { code: "ENOENT" });
  const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive", failures: [failure], commandUnresolved: false });
  await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }), (error) => error === failure);
  assert.equal(harness.dispatched.length, 1);
  assert.equal(harness.events.includes("persist-command"), false);
});

test("宿主 PATH 可解析但登录 shell 找不到 Codex 时固定绝对路径并仅重试一次", async () => {
  const failure = new Error("Codex app-server 异常退出（code 127）：zsh:1: command not found: codex");
  const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive", failures: [failure], commandUnresolved: false });
  await harness.runPrompt({ displayPrompt: "继续原任务", modelPrompt: "原始指令", contextTags: [], throwOnError: true });
  assert.equal(harness.dispatched.length, 2);
  assert.equal(harness.dispatched[1].input.cliCommandRepairAttempted, true);
  assert.equal(harness.dispatched[1].target.sessionId, null);
  assert.equal(harness.events.filter((event) => event === "persist-command").length, 1);
});

for (const cli of CLI_LIST) {
}

test("startup never activates the first profile when using unmanaged native config", async () => {
  for (const fallbackConfigId of ["first-profile", null]) {
    const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive", activeConfigId: null, fallbackConfigId });
    await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
    assert.equal(harness.dispatched.length, 1);
  }
});

test("startup does not adopt a native matched profile when no user selection exists", async () => {
  const harness = createHarness({ cli: "claude", health: "normal", runtime: "interactive", activeConfigId: null,
    loadedActiveConfigId: "native-matched-profile", fallbackConfigId: "first-profile" });
  await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
});


test("the current config dispatches across every CLI runtime", async () => {
  for (const cli of CLI_LIST) {
    for (const runtime of ["interactive", "parallel", "one-shot"] as const) {
      const harness = createHarness({ cli, health: "normal", runtime });
      await harness.runPrompt({ displayPrompt: "读取当前配置", modelPrompt: "读取当前配置", contextTags: [] });
      assert.equal(harness.dispatched.length, 1);
    }
  }
});
