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
import { CLI_LIST } from "../../cli/types";
import { planBoundSubtaskConfigApply } from "../../subtaskCliRoute";
import { ConfigSelectionChangedError, type VisibleConfigSelection } from "../../config/sharedRuntimeConfig";

const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
const sourceFile = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
const runPromptDeclaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "runPrompt");
assert.ok(runPromptDeclaration);
const runPromptScript = ts.transpileModule(runPromptDeclaration.getText(sourceFile), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

type ConfigLeaseResult = "acquired" | "superseded";

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
  acquireConfigLease?: (cli: CliName, configId: string) => Promise<ConfigLeaseResult>;
  configExists?: boolean;
  preflightMessage?: string;
  loopSessionId?: string;
}) {
  const tab = { id: "target-tab", cli: options.cli, sessionId: "previous-session" as string | null };
  const events: string[] = [];
  const leasedConfigs: Array<{ cli: CliName; configId: string }> = [];
  const systemMessages: string[] = [];
  const statuses: string[] = [];
  const boundConfigs: Array<{ cli: CliName; sessionId: string; configId: string | null }> = [];
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
    shouldUseClassicLoopProjectInstructions,
    readLoopTaskRecord: () => options.loopSessionId ? { id: "parent-loop", subTasks: [] } : null,
    resolvePromptRunTargetSessionId: () => options.loopSessionId ?? null,
    bindLoopSubtaskSession: (subTasks: unknown[], _subtaskId: string,
      binding: { cli: CliName; sessionId: string; configId: string | null }) => {
      boundConfigs.push(binding);
      return subTasks;
    },
    updateLoopTaskRecord: () => undefined,
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
    getSelectedCliModel: () => "current-model",
    getSelectedLoopCliModel: () => "current-loop-model",
    ConfigSelectionChangedError,
    loadConfigState: async () => ({ activeConfigId, revision: `${activeConfigId ?? "native"}-revision`,
      configs: options.fallbackConfigId ? [{ id: options.fallbackConfigId }] : [] }),
    configService: {
      getConfigById: async () => options.configExists === false ? null : {},
      acquireRuntimeConfigExecution: async (cli: CliName, expected: VisibleConfigSelection) => {
        if (expected.configId !== activeConfigId) throw new ConfigSelectionChangedError();
        if (expected.configId) {
          events.push("acquire-config");
          leasedConfigs.push({ cli, configId: expected.configId });
          const result = options.acquireConfigLease ? await options.acquireConfigLease(cli, expected.configId) : "acquired";
          if (result === "superseded") throw new ConfigSelectionChangedError();
        }
        return { selection: expected, release: async () => { events.push("release-config"); } };
      },
    },
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
  return { runPrompt, events, dispatched, leasedConfigs, systemMessages, statuses, boundConfigs,
    selectConfig: (configId: string) => { activeConfigId = configId; } };
}

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

test("dispatches a fresh session after the health gate across interactive, one-shot and parallel execution", async () => {
  for (const runtime of ["interactive", "one-shot", "parallel"] as const) {
    const harness = createHarness({ cli: runtime === "interactive" ? "codex" : "opencode", health: "abnormal", runtime });
    await harness.runPrompt({ displayPrompt: "再次执行", modelPrompt: "执行原始任务", contextTags: [] });

    assert.equal(harness.dispatched.length, 1);
    assert.equal(harness.dispatched[0].target.sessionId, null);
    assert.equal(harness.dispatched[0].input.modelPrompt, "执行原始任务");
    assert.deepEqual(harness.events.slice(0, 3), ["health-check", "dispose-old-runner", "panel-state"]);
    assert.deepEqual(harness.events.slice(-2), ["dispatch", "release-config"]);
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

test("all runtime routes reject switched profiles but accept revisions within the same profile", async () => {
  for (const runtime of ["interactive", "parallel", "one-shot"] as const) {
    const harness = createHarness({ cli: "codex", health: "normal", runtime });
    await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true,
      configSelections: { codex: { configId: "previous-config", revision: "stale-visible-revision" } } }), /本次任务未启动/);
    assert.equal(harness.leasedConfigs.length, 0);
    assert.equal(harness.dispatched.length, 0);
    await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [],
      configSelections: { codex: { configId: "selected-config", revision: "stale-same-profile-revision" } } });
    assert.equal(harness.dispatched.length, 1);
    assert.ok(harness.events.indexOf("dispatch") < harness.events.indexOf("release-config"));
  }
});

test("the visible selection gate compares profile identity without comparing revisions", async () => {
  const validators: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "validateVisibleConfigSelections"
      && ts.isArrowFunction(node.initializer)) {
      validators.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(validators.length, 1);
  const script = ts.transpileModule(`const validate = ${validators[0].getText(sourceFile)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let current: { activeConfigId: string | null; revision?: string; configurationError?: string };
  const validate = vm.runInNewContext(`${script}\nvalidate;`, {
    loadConfigState: async () => current,
    ConfigSelectionChangedError,
  }) as (cli: CliName, selections?: Partial<Record<CliName, VisibleConfigSelection>>) => Promise<void>;
  for (const cli of CLI_LIST) {
    for (const configId of ["selected-config", null]) {
      const selections = { [cli]: { configId, revision: "old-revision" } };
      current = { activeConfigId: configId, revision: "new-revision" };
      await validate(cli, selections);
      await assert.rejects(validate(cli), ConfigSelectionChangedError);
      current = { activeConfigId: "other-config", revision: "new-revision" };
      await assert.rejects(validate(cli, selections), ConfigSelectionChangedError);
      current = { activeConfigId: configId, revision: "new-revision", configurationError: "上次配置应用未成功" };
      await assert.rejects(validate(cli, selections), ConfigSelectionChangedError);
      current = { activeConfigId: configId };
      await assert.rejects(validate(cli, selections), ConfigSelectionChangedError);
    }
  }
});

test("all CLIs and task roles accept the same profile with an older revision without warnings", async () => {
  for (const cli of CLI_LIST) {
    for (const runtime of ["interactive", "one-shot", "parallel"] as const) {
      for (const taskRole of [undefined, "main", "subtask"] as const) {
        const harness = createHarness({ cli, health: "normal", runtime });
        await harness.runPrompt({ displayPrompt: "继续执行", modelPrompt: "执行", contextTags: [], taskRole,
          configSelections: { [cli]: { configId: "selected-config", revision: "old-revision" } },
          ...(taskRole === "subtask" ? { loopSubtaskCli: cli, loopSubtaskConfigId: "selected-config" } : {}),
          throwOnError: true });
        assert.equal(harness.dispatched.length, 1);
        assert.deepEqual(harness.leasedConfigs, [{ cli, configId: "selected-config" }]);
        assert.deepEqual(harness.systemMessages, []);
        assert.equal(harness.events.filter((event) => event === "release-config").length, 1);
        assert.ok(harness.events.indexOf("dispatch") < harness.events.indexOf("release-config"));
      }
    }
  }
});

test("runtime errors release the config lease rather than permanently blocking other windows", async () => {
  const harness = createHarness({ cli: "claude", health: "normal", runtime: "interactive", failures: [new Error("synthetic runtime failure")] });
  await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }), /synthetic runtime failure/);
  assert.equal(harness.events.filter((event) => event === "release-config").length, 1);
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
  test(`${cli} acquires the selected profile lease on every run across all execution routes`, async () => {
    for (const runtime of ["interactive", "one-shot", "parallel"] as const) {
      const harness = createHarness({ cli, health: "normal", runtime });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
      }
      assert.deepEqual(harness.leasedConfigs, [
        { cli, configId: "selected-config" }, { cli, configId: "selected-config" },
      ]);
      assert.equal(harness.dispatched.length, 2);
      assert.ok(harness.events.indexOf("wait-config") < harness.events.indexOf("acquire-config"));
      assert.ok(harness.events.indexOf("acquire-config") < harness.events.indexOf("dispatch"));
      if (cli === "opencode") {
        assert.ok(harness.events.indexOf("acquire-config") < harness.events.indexOf("preflight"));
      }
    }
  });

  test(`${cli} waits for pending activation and lease acquisition before dispatch`, async () => {
    let finishSwitch!: (success: boolean) => void;
    let finishWrite!: (result: ConfigLeaseResult) => void;
    const switchPromise = new Promise<boolean>((resolve) => { finishSwitch = resolve; });
    const writePromise = new Promise<ConfigLeaseResult>((resolve) => { finishWrite = resolve; });
    const harness = createHarness({ cli, health: "normal", runtime: "one-shot",
      waitForConfigApply: () => switchPromise, acquireConfigLease: () => writePromise });
    const run = harness.runPrompt({ displayPrompt: "排队任务", modelPrompt: "执行", contextTags: [] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(harness.leasedConfigs.length, 0);
    assert.equal(harness.dispatched.length, 0);
    harness.selectConfig("newly-selected-config");
    finishSwitch(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(harness.leasedConfigs, [{ cli, configId: "newly-selected-config" }]);
    assert.equal(harness.dispatched.length, 0);
    finishWrite("acquired");
    await run;
    assert.equal(harness.dispatched.length, 1);
  });

  test(`${cli} stops dispatch when configuration activation or lease acquisition fails`, async () => {
    for (const runtime of ["interactive", "one-shot", "parallel"] as const) {
      for (const failure of ["wait", "write"] as const) {
        const harness = createHarness({ cli, health: "normal", runtime,
          waitForConfigApply: async () => failure !== "wait",
          acquireConfigLease: async () => { throw new Error("配置租约获取失败"); } });
        await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }), /配置.*失败/);
        assert.equal(harness.dispatched.length, 0);
        assert.equal(harness.statuses.includes("error"), true);
        assert.equal(harness.systemMessages.length, 1);
        assert.match(harness.systemMessages[0], /配置.*失败/);
        assert.equal(harness.leasedConfigs.length, failure === "wait" ? 0 : 1);
        assert.equal(harness.events.includes("preflight"), false);
      }
    }
  });

  test(`${cli} stops dispatch when another profile supersedes lease acquisition`, async () => {
    const harness = createHarness({ cli, health: "normal", runtime: "interactive",
      acquireConfigLease: async () => "superseded" });
    await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }));
    assert.equal(harness.dispatched.length, 0);
    assert.equal(harness.statuses.at(-1), "error");
    assert.equal(harness.systemMessages.length, 1);
    assert.equal(harness.events.includes("preflight"), false);
  });

  test(`${cli} acquires the current subtask profile lease instead of trusting the cached active ID`, async () => {
    const harness = createHarness({ cli, health: "normal", runtime: "parallel" });
    await harness.runPrompt({ displayPrompt: "子任务", modelPrompt: "执行", contextTags: [],
      taskRole: "subtask", loopSubtaskCli: cli, loopSubtaskConfigId: "selected-config" });
    assert.deepEqual(harness.leasedConfigs, [{ cli, configId: "selected-config" }]);
    assert.equal(harness.dispatched.length, 1);
  });
}

test("command-repair retries use the latest selection instead of restoring the original profile", async () => {
  let harness: ReturnType<typeof createHarness>;
  harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive",
    failures: [Object.assign(new Error("spawn cli ENOENT"), { code: "ENOENT" })],
    acquireConfigLease: async () => { harness.selectConfig("another-config"); return "acquired"; } });
  await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
  assert.deepEqual(harness.leasedConfigs.map((config) => config.configId), ["selected-config", "another-config"]);
  assert.equal(harness.dispatched.length, 2);
});

test("failed lease acquisition never dispatches or triggers command repair", async () => {
  const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive",
    failures: [Object.assign(new Error("spawn cli ENOENT"), { code: "ENOENT" })],
    acquireConfigLease: async () => { throw new Error("配置租约获取失败"); } });
  await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }), /配置租约获取失败/);
  assert.equal(harness.leasedConfigs.length, 1);
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.events.includes("persist-command"), false);
  assert.equal(harness.statuses.includes("error"), true);

  await assert.rejects(harness.runPrompt({ displayPrompt: "下一次任务", modelPrompt: "执行", contextTags: [], throwOnError: true }), /配置租约获取失败/);
  assert.equal(harness.leasedConfigs.length, 2);
  assert.equal(harness.dispatched.length, 0);
});

test("an aborted configuration lease acquisition never dispatches a task", async () => {
  for (const runtime of ["interactive", "one-shot", "parallel"] as const) {
    const harness = createHarness({ cli: "codex", health: "normal", runtime,
      acquireConfigLease: async () => { throw Object.assign(new Error("用户取消"), { name: "AbortError" }); } });
    await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true });
    assert.equal(harness.dispatched.length, 0);
    assert.equal(harness.systemMessages.some((message) => message.includes("配置重写失败")), false);
  }
});

test("configuration failures take precedence over runtime errors without dispatching", async () => {
  const failure = new Error("CLI 运行失败");
  const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive",
    failures: [failure], acquireConfigLease: async () => { throw new Error("配置租约获取失败"); } });
  await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }),
    /配置租约获取失败/);
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.statuses.at(-1), "error");
  assert.deepEqual(harness.systemMessages, ["配置租约获取失败"]);
});

test("a historical execution snapshot cannot override the current selection", async () => {
  const harness = createHarness({ cli: "claude", health: "normal", runtime: "interactive" });
  await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [],
    executionProfile: { configId: "task-profile", model: null } });
  assert.deepEqual(harness.leasedConfigs, [{ cli: "claude", configId: "selected-config" }]);
  assert.equal(harness.dispatched[0].input.model, "current-model");
});

test("subtasks use the current profile rather than saved bindings and reject unavailable current profiles", async () => {
  for (const configExists of [true, false]) {
    const harness = createHarness({ cli: "opencode", health: "normal", runtime: "one-shot", configExists });
    await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], taskRole: "subtask",
      loopSubtaskCli: "opencode", loopSubtaskConfigId: "bound-config", executionProfile: { configId: "other-config", model: null } });
    assert.equal(harness.dispatched.length, configExists ? 1 : 0);
    assert.deepEqual(harness.leasedConfigs, configExists ? [{ cli: "opencode", configId: "selected-config" }] : []);
    if (configExists) {
      assert.equal(harness.dispatched[0].input.model, "current-loop-model");
      assert.equal(harness.dispatched[0].input.loopSubtaskConfigId, "selected-config");
    }
  }
});

test("subtask session bindings only record a config ID after successful lease acquisition", async () => {
  for (const result of ["acquired", "wait-failed", "write-failed"] as const) {
    const harness = createHarness({ cli: "codex", health: "normal", runtime: "parallel", loopSessionId: "runtime-session",
      waitForConfigApply: async () => result !== "wait-failed",
      acquireConfigLease: async () => {
        if (result === "write-failed") { throw new Error("配置租约获取失败"); }
        return "acquired";
      } });
    const run = harness.runPrompt({ displayPrompt: "子任务", modelPrompt: "执行", contextTags: [], taskRole: "subtask",
      loopTaskId: "parent-loop", loopSubtaskId: "subtask-1", loopSubtaskCli: "codex", loopSubtaskConfigId: "bound-profile",
      throwOnError: true });
    if (result !== "acquired") {
      await assert.rejects(run, /配置.*失败/);
      assert.equal(harness.dispatched.length, 0);
      assert.equal(harness.boundConfigs.length, 0);
      continue;
    }
    await run;
    assert.equal(harness.dispatched.length, 1);
    assert.equal(harness.boundConfigs.length, 1);
    assert.equal(harness.boundConfigs[0].sessionId, "runtime-session");
    assert.equal(harness.boundConfigs[0].configId, "selected-config");
  }
});

test("startup never activates the first profile when using unmanaged native config", async () => {
  for (const fallbackConfigId of ["first-profile", null]) {
    const harness = createHarness({ cli: "codex", health: "normal", runtime: "interactive", activeConfigId: null, fallbackConfigId });
    await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
    assert.deepEqual(harness.leasedConfigs, []);
    assert.equal(harness.dispatched.length, 1);
  }
});

test("startup does not adopt a native matched profile when no user selection exists", async () => {
  const harness = createHarness({ cli: "claude", health: "normal", runtime: "interactive", activeConfigId: null,
    loadedActiveConfigId: "native-matched-profile", fallbackConfigId: "first-profile" });
  await harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [] });
  assert.deepEqual(harness.leasedConfigs, []);
});

test("OpenCode preflight errors are visible and stop dispatch after acquiring the profile lease", async () => {
  const harness = createHarness({ cli: "opencode", health: "normal", runtime: "one-shot", preflightMessage: "配置检查失败" });
  await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }), /配置检查失败/);
  assert.equal(harness.leasedConfigs.length, 1);
  assert.equal(harness.dispatched.length, 0);
  assert.deepEqual(harness.systemMessages, ["配置检查失败"]);
});

test("OpenCode configuration lease failure stops before preflight and dispatch", async () => {
  const harness = createHarness({ cli: "opencode", health: "normal", runtime: "one-shot", preflightMessage: "配置检查失败",
    acquireConfigLease: async () => { throw new Error("配置租约获取失败"); } });
  await assert.rejects(harness.runPrompt({ displayPrompt: "执行", modelPrompt: "执行", contextTags: [], throwOnError: true }),
    /配置租约获取失败/);
  assert.equal(harness.dispatched.length, 0);
  assert.deepEqual(harness.systemMessages, ["配置租约获取失败"]);
  assert.equal(harness.events.includes("preflight"), false);
});
