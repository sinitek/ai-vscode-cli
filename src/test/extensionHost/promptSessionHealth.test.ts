import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";
import * as ts from "typescript";
import type { CliName } from "../../cli/types";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import { createPromptAutoRepairController } from "../../extensionHost/promptAutoRepair";
import { CLI_LIST } from "../../cli/types";
import { planBoundSubtaskConfigApply } from "../../subtaskCliRoute";
import type { ConfigApplyResult } from "../../config/configApplyQueue";

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
  activeConfigId?: string | null;
  fallbackConfigId?: string | null;
  loadedActiveConfigId?: string;
  waitForConfigApply?: () => Promise<boolean>;
  applyConfig?: (cli: CliName, configId: string) => Promise<ConfigApplyResult>;
  configExists?: boolean;
  preflightMessage?: string;
}) {
  const tab = { id: "target-tab", cli: options.cli, sessionId: "previous-session" as string | null };
  const events: string[] = [];
  const appliedConfigs: Array<{ cli: CliName; configId: string }> = [];
  const systemMessages: string[] = [];
  const statuses: string[] = [];
  let activeConfigId = options.activeConfigId === undefined ? "selected-config" : options.activeConfigId;
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
    appendSystemMessageForPromptTarget: (_target: PromptRunTarget, message: string) => { systemMessages.push(message); },
    sendRunStatusForTab: (_tabId: string, status: string) => { statuses.push(status); },
    configApplyQueue: { waitForIdle: async (cli: CliName) => {
      assert.equal(cli, tab.cli);
      events.push("wait-config");
      return options.waitForConfigApply ? options.waitForConfigApply() : true;
    } },
    getActiveConfigIdForCli: () => activeConfigId,
    loadConfigState: async () => ({ activeConfigId: options.loadedActiveConfigId ?? null,
      configs: options.fallbackConfigId ? [{ id: options.fallbackConfigId }] : [] }),
    applyConfigById: async (cli: CliName, configId: string) => {
      events.push("apply-config");
      appliedConfigs.push({ cli, configId });
      return options.applyConfig ? options.applyConfig(cli, configId) : "applied";
    },
    configService: { getConfigById: async () => options.configExists === false ? null : {} },
    planBoundSubtaskConfigApply,
    resolveWorkspaceCwd: () => null,
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
    getOpenCodeConfigPreflightMessage: async () => { events.push("preflight"); return options.preflightMessage ?? null; },
    isInteractiveSupported: () => options.runtime === "interactive",
    hasOtherTabRun: () => options.runtime === "parallel",
    runPromptInteractive: dispatch,
    runPromptParallel: dispatch,
    runPromptOneShot: dispatch,
  }) as (input: PromptRunInput) => Promise<void>;
  return { runPrompt, events, dispatched, appliedConfigs, systemMessages, statuses,
    selectConfig: (configId: string) => { activeConfigId = configId; } };
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

for (const cli of CLI_LIST) {
  test(`${cli} reapplies the selected config on every run across all execution routes`, async () => {
    for (const runtime of ["interactive", "one-shot", "parallel"] as const) {
      let nativeConfigId = "other-window-config";
      const harness = createHarness({ cli, health: "normal", runtime, applyConfig: async (_cli, configId) => {
        nativeConfigId = configId;
        return "applied";
      } });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        nativeConfigId = "other-window-config";
        await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
        assert.equal(nativeConfigId, "selected-config");
      }
      assert.deepEqual(harness.appliedConfigs, [
        { cli, configId: "selected-config" }, { cli, configId: "selected-config" },
      ]);
      assert.equal(harness.dispatched.length, 2);
      assert.ok(harness.events.indexOf("wait-config") < harness.events.indexOf("apply-config"));
      assert.ok(harness.events.indexOf("apply-config") < harness.events.indexOf("dispatch"));
      if (cli === "opencode") {
        assert.ok(harness.events.indexOf("apply-config") < harness.events.indexOf("preflight"));
      }
    }
  });

  test(`${cli} waits for a pending activation and the startup write before dispatch`, async () => {
    let finishSwitch!: (success: boolean) => void;
    let finishWrite!: (result: ConfigApplyResult) => void;
    const switchPromise = new Promise<boolean>((resolve) => { finishSwitch = resolve; });
    const writePromise = new Promise<ConfigApplyResult>((resolve) => { finishWrite = resolve; });
    const harness = createHarness({ cli, health: "normal", runtime: "one-shot",
      waitForConfigApply: () => switchPromise, applyConfig: () => writePromise });
    const run = harness.runPrompt({ displayPrompt: "排队任务", modelPrompt: "执行", contextTags: [] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(harness.appliedConfigs.length, 0);
    assert.equal(harness.dispatched.length, 0);
    harness.selectConfig("newly-selected-config");
    finishSwitch(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(harness.appliedConfigs, [{ cli, configId: "newly-selected-config" }]);
    assert.equal(harness.dispatched.length, 0);
    finishWrite("applied");
    await run;
    assert.equal(harness.dispatched.length, 1);
  });

  test(`${cli} stops dispatch when activation fails or is superseded`, async () => {
    for (const failure of ["wait", "write", "superseded"] as const) {
      const harness = createHarness({ cli, health: "normal", runtime: "interactive",
        waitForConfigApply: async () => failure !== "wait",
        applyConfig: async () => {
          if (failure === "write") { throw new Error("配置写入失败"); }
          return "superseded";
        } });
      await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }));
      assert.equal(harness.dispatched.length, 0);
      assert.equal(harness.statuses.at(-1), "error");
      assert.equal(harness.systemMessages.length, 1);
      assert.equal(harness.events.includes("preflight"), false);
    }
  });

  test(`${cli} reapplies an unchanged bound subtask profile instead of trusting the cached active ID`, async () => {
    const harness = createHarness({ cli, health: "normal", runtime: "parallel" });
    await harness.runPrompt({ displayPrompt: "子任务", modelPrompt: "执行", contextTags: [],
      taskRole: "subtask", loopSubtaskCli: cli, loopSubtaskConfigId: "selected-config" });
    assert.deepEqual(harness.appliedConfigs, [{ cli, configId: "selected-config" }]);
    assert.equal(harness.dispatched.length, 1);
  });
}

test("command-repair retries reapply the original task profile even if another selection changes", async () => {
  let harness: ReturnType<typeof createHarness>;
  harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive",
    failures: [Object.assign(new Error("spawn cli ENOENT"), { code: "ENOENT" })],
    applyConfig: async () => { harness.selectConfig("another-config"); return "applied"; } });
  await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
  assert.deepEqual(harness.appliedConfigs.map((config) => config.configId), ["selected-config", "selected-config"]);
  assert.equal(harness.dispatched.length, 2);
});

test("an explicit execution snapshot takes precedence over the window selection", async () => {
  const harness = createHarness({ cli: "claude", health: "normal", runtime: "interactive" });
  await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [],
    executionProfile: { configId: "task-profile", model: null } });
  assert.deepEqual(harness.appliedConfigs, [{ cli: "claude", configId: "task-profile" }]);
});

test("a bound subtask takes precedence over an execution snapshot and rejects missing profiles", async () => {
  for (const configExists of [true, false]) {
    const harness = createHarness({ cli: "opencode", health: "normal", runtime: "one-shot", configExists });
    await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], taskRole: "subtask",
      loopSubtaskCli: "opencode", loopSubtaskConfigId: "bound-config", executionProfile: { configId: "other-config", model: null } });
    assert.equal(harness.dispatched.length, configExists ? 1 : 0);
    assert.deepEqual(harness.appliedConfigs, configExists ? [{ cli: "opencode", configId: "bound-config" }] : []);
  }
});

test("startup uses the first ordered profile without idle activation and supports unmanaged native config", async () => {
  for (const fallbackConfigId of ["first-profile", null]) {
    const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive", activeConfigId: null, fallbackConfigId });
    await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
    assert.deepEqual(harness.appliedConfigs, fallbackConfigId ? [{ cli: "codex", configId: fallbackConfigId }] : []);
    assert.equal(harness.dispatched.length, 1);
  }
});

test("startup prefers the loaded active profile over the first ordered profile when no selection is cached", async () => {
  const harness = createHarness({ cli: "claude", health: "normal", runtime: "interactive", activeConfigId: null,
    loadedActiveConfigId: "native-matched-profile", fallbackConfigId: "first-profile" });
  await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
  assert.deepEqual(harness.appliedConfigs, [{ cli: "claude", configId: "native-matched-profile" }]);
});

test("OpenCode preflight errors are visible and stop dispatch after applying the selected profile", async () => {
  const harness = createHarness({ cli: "opencode", health: "normal", runtime: "one-shot", preflightMessage: "配置检查失败" });
  await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }), /配置检查失败/);
  assert.equal(harness.appliedConfigs.length, 1);
  assert.equal(harness.dispatched.length, 0);
  assert.deepEqual(harness.systemMessages, ["配置检查失败"]);
});
