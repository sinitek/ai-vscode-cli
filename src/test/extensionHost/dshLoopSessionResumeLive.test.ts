import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import type { InteractiveTurnAttemptPort } from "../../extensionHost/interactiveTurnStrategy";
import type { DshInteractiveRunner } from "../../interactive/dshRunner";
import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";

const { createLoopPlusRuntimeFixture } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const { createDshInteractiveTurnStrategy, resolveDshLoopWorkspaceCwd } = require("../../extensionHost/interactiveTurnDsh") as typeof import("../../extensionHost/interactiveTurnDsh");
const { prepareDshIsolatedLaunch } = require("../../extensionHost/dshInteractiveLaunch") as typeof import("../../extensionHost/dshInteractiveLaunch");
const { createLoopSubtaskExecutionRoot } = require("../../loopSubtaskExecutionRoot") as typeof import("../../loopSubtaskExecutionRoot");
const { InteractiveRunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");
const { resolveDshConfigPaths } = require("../../config/dshConfig") as typeof import("../../config/dshConfig");
const { toDshModelWireValue } = require("../../cli/dshConfigModels") as typeof import("../../cli/dshConfigModels");
const { DshInteractiveRunner: RealDshRunner } = require("../../interactive/dshRunner") as typeof import("../../interactive/dshRunner");

async function readLiveDshConfig() {
  const config = resolveDshConfigPaths();
  const profile = JSON.parse(await fs.readFile(config.appliedProfilePath, "utf8")) as { acpModel: string; apiKey?: string };
  return {
    config,
    profile,
    modelWire: toDshModelWireValue(profile.acpModel),
    parentEnv: { ...process.env, SINITEK_DSH_API_KEY: profile.apiKey || process.env.SINITEK_DSH_API_KEY },
  };
}

test("real DSH rejects a changed cwd but resumes the same session at its original cwd", {
  skip: process.env.SINITEK_DSH_LOOP_LIVE !== "1",
  timeout: 45_000,
}, async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-cwd-live-"));
  const runners: DshInteractiveRunner[] = [];
  let isolatedHome: string | null = null;
  context.signal.addEventListener("abort", () => runners.forEach((runner) => runner.dispose()), { once: true });
  context.after(async () => {
    await Promise.all(runners.map((runner) => runner.disposeAndWait()));
    await fs.rm(root, { recursive: true, force: true });
    if (isolatedHome) {
      await fs.rm(isolatedHome, { recursive: true, force: true });
    }
  });
  const { config, modelWire, parentEnv } = await readLiveDshConfig();
  const launch = await prepareDshIsolatedLaunch({ sessionKey: `cwd-live-${randomUUID()}`, patchSourcePath: config.patchPath, parentEnv });
  isolatedHome = launch.isolatedHome;
  const initialCwd = path.join(root, "initial");
  const repairCwd = path.join(root, "repair");
  await fs.mkdir(initialCwd);
  await fs.mkdir(repairCwd);
  const createRunner = (cwd: string, localSessionId: string | null = null) => {
    const runner = new RealDshRunner({
      command: process.env.SINITEK_DSH_COMMAND || "dsh", agentArgs: launch.agentArgs,
      env: launch.env, model: modelWire, thinkingMode: "low", cwd, localSessionId,
    });
    runners.push(runner);
    return runner;
  };
  const initial = createRunner(initialCwd);
  const session = await initial.start();
  await initial.disposeAndWait();
  const changed = createRunner(repairCwd, session.acpSessionId);
  await assert.rejects(() => changed.start({ requireResume: true }), /session cwd does not match/);
  const restored = await createRunner(initialCwd, session.acpSessionId).start({ requireResume: true });
  assert.equal(restored.acpSessionId, session.acpSessionId);
  assert.equal(restored.resumed, true);
  context.diagnostic(JSON.stringify({ changedCwdRejected: true, originalCwdResumed: true, sameSession: true }));
});

test("real DSH Loop+ resumes after failed acceptance, tab closure and process disposal", {
  skip: process.env.SINITEK_DSH_LOOP_LIVE !== "1",
  timeout: 180_000,
}, async (context) => {
  const workspaceCwd = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-loop-live-"));
  const manager = new InteractiveRunnerManager();
  const runners: DshInteractiveRunner[] = [];
  const register = manager.setRunner.bind(manager);
  context.mock.method(manager, "setRunner", (...args: Parameters<typeof manager.setRunner>) => {
    runners.push(args[2] as DshInteractiveRunner);
    register(...args);
  });
  context.signal.addEventListener("abort", () => manager.disposeAll(), { once: true });
  const homes = new Set<string>();
  context.after(async () => {
    manager.disposeAll();
    await Promise.all(runners.map((runner) => runner.disposeAndWait()));
    await Promise.all([...homes].map((home) => fs.rm(home, { recursive: true, force: true })));
    await fs.rm(workspaceCwd, { recursive: true, force: true });
  });
  const executionCwds: string[] = [];
  const sessions: string[] = [];
  const { config, profile, modelWire, parentEnv } = await readLiveDshConfig();
  const nonce = randomUUID().replace(/-/g, "");
  const strategy = createDshInteractiveTurnStrategy();
  const fixture = createLoopPlusRuntimeFixture({
    configId: "dsh-loop-live-profile",
    executionRootFactory: () => createLoopSubtaskExecutionRoot(workspaceCwd),
  });
  const valueFile = path.join(workspaceCwd, "src", "value.txt");
  const mainFailures: string[] = [];
  const queueMain: typeof fixture.queueMain = (action) => fixture.queueMain(async (input, tabId) => {
    try {
      await action(input, tabId);
    } catch (error) {
      mainFailures.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  });
  let taskId = "";
  const decision = (value: unknown) => JSON.stringify(withLoopPlusAcceptReviews(value));
  const eventId = (prompt: string): string => {
    const id = prompt.match(/Current review eventId: (\S+)/)?.[1];
    assert.ok(id && id !== "(none)");
    return id;
  };
  const subtaskId = "draft";
  const subtask = (prompt: string) => ({
    id: subtaskId, title: subtaskId, taskType: "backend", requiresAcceptance: true, prompt, writeFiles: ["src/value.txt"],
  });
  try {
    await fs.mkdir(path.join(workspaceCwd, "src"));
    await fs.writeFile(valueFile, "initial");
    await fs.writeFile(path.join(workspaceCwd, "AGENTS.md"), "此文件不得出现在隔离执行根中。");
    queueMain((input, tabId) => {
      taskId = input.loopTaskId ?? "";
      fixture.publish(input, tabId, { status: "end", content: decision({
        status: "dispatch",
        subtasks: [subtask(`这是隔离测试。只修改 src/value.txt，写入 draft，不加换行。记住校验码 ${nonce}，不要把校验码写入任何文件，下一轮会用到。必须实际写文件，最终仅回复 draft_written。`)],
      }) });
    });
    queueMain(async (input, tabId) => {
      assert.equal(await fs.readFile(valueFile, "utf8"), "draft");
      assert.ok(fixture.closedSubtaskTabs.includes(fixture.createdSubtaskTargets[0].tabId));
      assert.equal(fixture.readTask(taskId)?.subTasks.find((item) => item.id === subtaskId)?.executionSession?.sessionId, sessions[0]);
      manager.disposeIfMatches("dsh", sessions[0]);
      assert.equal(manager.hasDshRunner(sessions[0], runners[0]), false);
      assert.equal(runners[0].isReusable(), false);
      await runners[0].disposeAndWait();
      const reviewEventId = eventId(input.displayPrompt);
      fixture.publish(input, tabId, { status: "end", content: decision({
        status: "accept",
        progressPercent: 50,
        reviewEventId,
        reviews: [{ reviewEventId, acceptance: "failed", reason: "文件仍是 draft，缺少按原会话校验码生成的最终内容。", subtaskIds: [subtaskId] }],
        acceptance: {
          passed: false,
          checks: loopPlusAcceptanceChecksFixture().map((check) => check.name === "artifacts"
            ? { ...check, passed: false, detail: "已读取文件，当前只有 draft。" }
            : check),
        },
        subtasks: [subtask("上轮验收失败，需要修复。仅修改 src/value.txt，内容改为 ready: 紧接上一轮会话里让你记住的校验码，不加空格、不加换行。禁止在磁盘搜索校验码，只依据原会话上下文恢复。若不记得校验码，明确失败，不猜测。必须实际写文件，最终仅回复 repair_written。")],
      }) });
    });
    queueMain(async (input, tabId) => {
      assert.equal(await fs.readFile(valueFile, "utf8"), `ready:${nonce}`);
      fixture.publish(input, tabId, { status: "end", content: decision({
        status: "completed",
        reviewEventId: eventId(input.displayPrompt),
        answerConclusion: "真实修复完成",
        finalSummary: "原会话上下文、进程重建和文件修复均已验证",
        acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
        requirementCoverage: [{ name: "会话续接修复", passed: true, detail: "重新读取文件，确认内容与首次提示中的随机校验码一致。" }],
      }) });
    });
    fixture.setAttemptAction(async (input, tabId) => {
      const target = fixture.createdSubtaskTargets.find((item) => item.tabId === tabId);
      assert.ok(target);
      assert.equal(input.loopSubtaskId, subtaskId);
      assert.ok(input.loopAttemptId);
      if (fixture.attemptCalls.length === 2) {
        assert.notEqual(input.loopAttemptId, fixture.attemptCalls[0].loopAttemptId);
        assert.notEqual(tabId, fixture.createdSubtaskTargets[0].tabId);
        assert.equal(target.sessionId, sessions[0]);
        assert.equal(String(input.modelPrompt).includes(nonce), false);
      } else {
        assert.equal(fixture.attemptCalls.length, 1);
        assert.ok(String(input.modelPrompt).includes(nonce));
      }
      const launch = await prepareDshIsolatedLaunch({
        sessionKey: target.sessionId ?? `loop-live-${randomUUID()}`,
        patchSourcePath: config.patchPath,
        parentEnv,
      });
      homes.add(launch.isolatedHome);
      const stableCwd = resolveDshLoopWorkspaceCwd(launch.isolatedHome, workspaceCwd);
      let answer = "";
      const port = {
        cli: "dsh",
        tabId,
        runId: tabId,
        cwd: input.executionCwd,
        workspaceCwd,
        dshLaunch: launch,
        dshModelWire: modelWire,
        commandForRunner: process.env.SINITEK_DSH_COMMAND || "dsh",
        thinkingMode: "low",
        interactiveMode: "coding",
        attemptPrompt: input.modelPrompt,
        isolateProjectInstructions: input.isolateProjectInstructions,
        get uiSessionId() { return target.sessionId; },
        interactiveRunnerManager: manager,
        interactiveRunsByTabId: new Map([[tabId, { runId: tabId, stopped: false }]]),
        resolveInteractiveMappedId: () => null,
        updateSessionForNewRun: (id: string) => {
          target.sessionId = id;
          sessions.push(id);
        },
        settleInteractiveAttempt: async () => "return",
        setStopCurrentTurn: () => undefined,
        syncInteractiveRunEntry: () => undefined,
        isCurrentRunActive: () => true,
        logInfo: () => undefined,
        sendPanelMessage: () => undefined,
        appendSystemMessageForTab: () => undefined,
        appendAssistantChunkForTab: (value: string, kind?: string) => {
          if (kind !== "thinking") {
            answer += value;
          }
        },
        appendDebugStdout: () => undefined,
        appendTraceMessageForTab: () => undefined,
        appendTraceLog: () => undefined,
        appendDebugEvent: () => undefined,
        createMessageId: () => randomUUID(),
        t: (key: string) => key,
      } as unknown as InteractiveTurnAttemptPort;
      try {
        await strategy.runAttempt(port);
        executionCwds.push(stableCwd);
        assert.deepEqual(await fs.readdir(stableCwd), []);
        fixture.publish(input, tabId, { status: "end", content: answer });
      } catch (error) {
        fixture.publish(input, tabId, { status: "error", content: "真实 DSH 子任务执行失败" });
        throw error;
      }
    });
    await fixture.adapter.runEventDriven({
      displayPrompt: "执行两阶段文件修复并按验收反馈继续",
      modelPrompt: "执行两阶段文件修复并按验收反馈继续",
      contextTags: [],
      model: "scripted-main",
      loopMainModel: "scripted-main",
      loopSubtaskMode: "fullstack",
      loopSubtaskFullstackCli: "dsh",
      loopSubtaskFullstackConfigId: "dsh-loop-live-profile",
      loopSubtaskFullstackModel: profile.acpModel,
      loopMainThinkingMode: "low",
      loopSubtaskFullstackThinkingMode: "low",
    }, { schedulingMode: "event_driven" }, fixture.target);
    const completed = fixture.readTask(taskId);
    assert.equal(completed?.status, "completed", JSON.stringify({
      mainCalls: fixture.mainCalls.length,
      attempts: fixture.attemptCalls.length,
      failure: completed?.mainAiLastFailureMessage,
      summary: completed?.finalSummary,
      hostMessages: fixture.hostMessages,
      mainFailures,
      subtasks: completed?.subTasks.map(({ id, status, summary }) => ({ id, status, summary })),
    }));
    assert.equal(fixture.attemptCalls.length, 2);
    assert.deepEqual(completed?.subTasks.map(({ id }) => id), [subtaskId]);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0], sessions[1]);
    assert.notEqual(runners[0], runners[1]);
    assert.equal(runners[1].getSessionInfo()?.resumed, true);
    assert.equal(homes.size, 1);
    assert.equal(executionCwds[0], executionCwds[1]);
    assert.notEqual(fixture.attemptCalls[0].executionCwd, fixture.attemptCalls[1].executionCwd);
    assert.equal(fixture.closedSubtaskTabs.length, 2);
    assert.equal(fixture.rootsDisposed.length, 2);
    context.diagnostic(JSON.stringify({
      sameSession: true, sameHome: true, sameCwd: true, originalProcessDisposed: true,
      newTab: true, failedAcceptanceRepaired: true, contextNonceRecovered: true, workspaceUpdated: true,
      scriptedMainModel: true, realDshSubmodel: true,
    }));
  } finally {
    manager.disposeAll();
    fixture.dispose();
  }
});
