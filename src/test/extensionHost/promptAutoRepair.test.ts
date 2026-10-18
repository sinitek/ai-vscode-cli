import assert = require("node:assert/strict");
import test = require("node:test");
import { createPromptAutoRepairController } from "../../extensionHost/promptAutoRepair";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";

const missingCommand = (): Error => Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });

function createHarness(options: { repaired?: boolean; failures?: Error[]; repairError?: Error } = {}) {
  const controller = createPromptAutoRepairController();
  const executions: Array<{ input: PromptRunInput; target: PromptRunTarget }> = [];
  const events: string[] = [];
  const failures = [...(options.failures ?? [missingCommand()])];
  let current = true;
  const input: PromptRunInput = {
    displayPrompt: "执行原任务",
    modelPrompt: "完整原始任务",
    contextTags: ["上下文"],
    preloadedUserMessageId: "old-user-message",
    model: "original-model",
    imagePaths: ["/tmp/image.png"],
    thinkingModeOverride: "high",
    taskRole: "subtask",
    loopTaskId: "loop-task",
    loopRound: 2,
    loopSubtaskId: "subtask",
    graphRunId: "graph-run",
    graphNodeId: "graph-node",
    executionCwd: "/tmp/original-workspace",
    throwOnError: true,
  };
  const target: PromptRunTarget = { tabId: "original-tab", cli: "codex", sessionId: "old-session" };
  const ports = {
    execute: async (attemptInput: PromptRunInput, attemptTarget: PromptRunTarget) => {
      executions.push({ input: attemptInput, target: { ...attemptTarget } });
      const failure = failures.shift();
      if (failure) {
        throw failure;
      }
    },
    repairCommand: async () => {
      events.push("repair");
      if (options.repairError) {
        throw options.repairError;
      }
      return options.repaired ?? true;
    },
    startFreshSession: async () => { events.push("fresh-session"); },
    isTargetCurrent: () => current,
    onRepairStarted: () => { events.push("repair-started"); },
    onRepairFailed: () => { events.push("repair-failed"); },
  };
  return { controller, input, target, ports, executions, events, invalidate: () => { current = false; } };
}

test("repairs once and replays the original input in a fresh session on the same tab", async () => {
  const harness = createHarness();
  await harness.controller.run(harness.input, harness.target, harness.ports);
  assert.equal(harness.executions.length, 2);
  assert.equal(harness.executions[0].target.sessionId, "old-session");
  assert.deepEqual(harness.executions[1].target, { ...harness.target, sessionId: null });
  assert.deepEqual(harness.executions[1].input, {
    ...harness.input,
    preloadedUserMessageId: undefined,
    cliCommandRepairAttempted: true,
  });
  assert.deepEqual(harness.events, ["repair-started", "repair", "fresh-session"]);
  assert.equal(harness.controller.isRepairing(harness.target.tabId), false);
  assert.equal(harness.controller.hasRepairingRuns(), false);
});

test("stops after the single fresh-session retry even when the same error repeats", async () => {
  const failure = missingCommand();
  const harness = createHarness({ failures: [missingCommand(), failure] });
  await assert.rejects(harness.controller.run(harness.input, harness.target, harness.ports), (error) => error === failure);
  assert.equal(harness.executions.length, 2);
  assert.equal(harness.events.filter((event) => event === "repair").length, 1);
});

test("does not repair ordinary failures, successful runs, or already retried inputs", async () => {
  for (const failure of [new Error("Authentication failed"), Object.assign(new Error("aborted"), { name: "AbortError" }), new Error("open /tmp/data ENOENT")]) {
    const harness = createHarness({ failures: [failure] });
    await assert.rejects(harness.controller.run(harness.input, harness.target, harness.ports), (error) => error === failure);
    assert.deepEqual(harness.events, []);
  }
  const successful = createHarness({ failures: [] });
  await successful.controller.run(successful.input, successful.target, successful.ports);
  assert.equal(successful.executions.length, 1);
  assert.deepEqual(successful.events, []);
  const retried = createHarness();
  await assert.rejects(retried.controller.run({ ...retried.input, cliCommandRepairAttempted: true }, retried.target, retried.ports));
  assert.equal(retried.executions.length, 1);
  assert.deepEqual(retried.events, []);
});

test("preserves the original error when command repair cannot finish", async () => {
  for (const options of [{ repaired: false }, { repairError: new Error("settings write failed") }]) {
    const failure = missingCommand();
    const harness = createHarness({ ...options, failures: [failure] });
    await assert.rejects(harness.controller.run(harness.input, harness.target, harness.ports), (error) => error === failure);
    assert.equal(harness.executions.length, 1);
    assert.equal(harness.events.includes("fresh-session"), false);
  }
});

test("does not retry after stop, shutdown, tab removal, or workspace replacement during repair", async () => {
  for (const cancel of ["stop", "shutdown", "stale-target"] as const) {
    const harness = createHarness();
    harness.ports.repairCommand = async () => {
      assert.equal(harness.controller.isRepairing(harness.target.tabId), true);
      assert.equal(harness.controller.hasRepairingRuns(), true);
      if (cancel === "stop") {
        harness.controller.cancel(harness.target.tabId);
      } else if (cancel === "shutdown") {
        harness.controller.cancelAll();
      } else {
        harness.invalidate();
      }
      return true;
    };
    await harness.controller.run(harness.input, harness.target, harness.ports);
    assert.equal(harness.executions.length, 1);
    assert.equal(harness.events.includes("fresh-session"), false);
    assert.equal(harness.controller.isRepairing(harness.target.tabId), false);
  }
});

test("a newer task on the same tab supersedes pending repair without being cancelled by the older cleanup", async () => {
  const harness = createHarness();
  let resolveRepair!: (repaired: boolean) => void;
  harness.ports.repairCommand = () => new Promise<boolean>((resolve) => { resolveRepair = resolve; });
  const original = harness.controller.run(harness.input, harness.target, harness.ports);
  await Promise.resolve();
  const newerExecutions: string[] = [];
  await harness.controller.run({ ...harness.input, displayPrompt: "替代任务" }, harness.target, {
    ...harness.ports,
    execute: async (input) => { newerExecutions.push(input.displayPrompt); },
  });
  resolveRepair(true);
  await original;
  assert.equal(harness.executions.length, 1);
  assert.deepEqual(newerExecutions, ["替代任务"]);
  assert.equal(harness.events.includes("fresh-session"), false);
});
