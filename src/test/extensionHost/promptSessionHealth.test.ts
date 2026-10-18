import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";
import * as ts from "typescript";
import type { CliName } from "../../cli/types";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import { createPromptAutoRepairController } from "../../extensionHost/promptAutoRepair";

const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
const sourceFile = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
const runPromptDeclaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "runPrompt");
assert.ok(runPromptDeclaration);
const runPromptScript = ts.transpileModule(runPromptDeclaration.getText(sourceFile), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function createHarness(options: {
  cli: CliName;
  health: "normal" | "abnormal";
  runtime: "interactive" | "parallel" | "one-shot";
  sessionIdAfterWait?: string | null;
  failures?: Error[];
  repairResult?: boolean;
  commandUnresolved?: boolean;
}) {
  const tab = { id: "target-tab", cli: options.cli, sessionId: "previous-session" as string | null };
  const events: string[] = [];
  const dispatched: Array<{ input: PromptRunInput; target: PromptRunTarget }> = [];
  const dispatch = async (input: PromptRunInput, target: PromptRunTarget): Promise<void> => {
    events.push("dispatch");
    dispatched.push({ input, target: { ...target } });
    const failure = options.failures?.shift();
    if (failure) {
      throw failure;
    }
  };
  const runPrompt = vm.runInNewContext(`${runPromptScript}\nrunPrompt;`, {
    isExtensionDeactivating: false,
    activeWorkspaceKey: "test-workspace",
    promptAutoRepairController: createPromptAutoRepairController(),
    getActiveConversationTabId: () => tab.id,
    resolvePromptRunTarget: () => ({ tabId: tab.id, cli: tab.cli, sessionId: tab.sessionId }),
    getConversationTabById: () => tab,
    getConversationTabSessionIdForCli: () => tab.sessionId,
    shouldAwaitCliCommandAutoRepair: () => false,
    getCliCommand: () => "cli",
    waitForCliCommandAutoRepair: async () => undefined,
    inspectUnresolvedCliCommands: () => options.commandUnresolved === false ? [] : [{ cli: options.cli }],
    locateCliExecutableForRepair: async () => options.repairResult === false ? null : "/tmp/repaired-cli",
    buildRepairedCliCommand: () => "/tmp/repaired-cli",
    persistCliCommand: async () => { events.push("persist-command"); },
    appendSystemMessageForPromptTarget: () => undefined,
    sendRunStatusForTab: () => undefined,
    t: (key: string) => key,
    logInfo: () => undefined,
    logError: () => undefined,
    getErrorInfo: (error: Error & { code?: string }) => ({ message: error.message, name: error.name, code: error.code }),
    isAbortErrorInfo: (info: { name?: string }) => info.name === "AbortError",
    loopMainAutoCompactFlights: { wait: async () => {
      if (options.sessionIdAfterWait !== undefined) {
        tab.sessionId = options.sessionIdAfterWait;
      }
    } },
    isTabRunActive: () => false,
    sessionLifecycleController: { prepareSessionForPromptRun: (cli: CliName, sessionId: string | null, tabId: string, prepareOptions?: { forceNewSession?: boolean }) => {
      assert.equal(cli, tab.cli);
      assert.equal(sessionId, tab.sessionId);
      assert.equal(tabId, tab.id);
      events.push("health-check");
      if (options.health === "abnormal" || prepareOptions?.forceNewSession) {
        tab.sessionId = null;
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
    preloadUserMessageForPrompt: (input: PromptRunInput, target: PromptRunTarget) => {
      assert.equal(target.sessionId, tab.sessionId);
      events.push("preload");
      return input;
    },
    getOpenCodeConfigPreflightMessage: async () => { events.push("preflight"); return null; },
    isInteractiveSupported: () => options.runtime === "interactive",
    hasOtherTabRun: () => options.runtime === "parallel",
    runPromptInteractive: dispatch,
    runPromptParallel: dispatch,
    runPromptOneShot: dispatch,
  }) as (input: PromptRunInput) => Promise<void>;
  return { runPrompt, events, dispatched };
}

test("dispatches a fresh session after the health gate across interactive, one-shot and parallel execution", async () => {
  for (const runtime of ["interactive", "one-shot", "parallel"] as const) {
    const harness = createHarness({ cli: runtime === "interactive" ? "codex" : "opencode", health: "abnormal", runtime });
    await harness.runPrompt({ displayPrompt: "再次执行", modelPrompt: "执行原始任务", contextTags: [] });

    assert.equal(harness.dispatched.length, 1);
    assert.equal(harness.dispatched[0].target.sessionId, null);
    assert.equal(harness.dispatched[0].input.modelPrompt, "执行原始任务");
    assert.deepEqual(harness.events.slice(0, 3), ["health-check", "dispose-old-runner", "panel-state"]);
    assert.equal(harness.events[harness.events.length - 1], "dispatch");
    if (runtime !== "interactive") {
      assert.ok(harness.events.indexOf("health-check") < harness.events.indexOf("preload"));
    }
  }
});

test("continues normal sessions without disposing their runners", async () => {
  for (const cli of ["codex", "claude", "opencode", "grok"] as const) {
    const harness = createHarness({ cli, health: "normal", runtime: cli === "opencode" ? "one-shot" : "interactive" });
    await harness.runPrompt({ displayPrompt: "继续", modelPrompt: "继续", contextTags: [] });
    assert.equal(harness.dispatched[0].target.sessionId, "previous-session");
    assert.equal(harness.events.includes("dispose-old-runner"), false);
  }
});

test("checks the current tab session instead of the snapshot taken before waiting for compaction", async () => {
  const harness = createHarness({ cli: "grok", health: "abnormal", runtime: "interactive", sessionIdAfterWait: "newly-adopted-session" });
  await harness.runPrompt({ displayPrompt: "重试", modelPrompt: "重试", contextTags: [] });
  assert.equal(harness.dispatched[0].target.sessionId, null);
  assert.equal(harness.events.includes("dispose-old-runner"), true);
});

test("does not restore an old session ID when the target was cleared while waiting", async () => {
  const harness = createHarness({ cli: "grok", health: "normal", runtime: "interactive", sessionIdAfterWait: null });
  await harness.runPrompt({ displayPrompt: "新任务", modelPrompt: "新任务", contextTags: [] });
  assert.equal(harness.dispatched[0].target.sessionId, null);
  assert.equal(harness.events.includes("dispose-old-runner"), false);
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
