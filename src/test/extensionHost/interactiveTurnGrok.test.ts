import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installVscodeMock } from "../vscodeMock";
import type { InteractiveTurnAttemptPort } from "../../extensionHost/interactiveTurnStrategy";
import type { GrokRunnerCreateOptions } from "../../interactive/runnerLifecycleTypes";

installVscodeMock();

const { createGrokInteractiveTurnStrategy } = require("../../extensionHost/interactiveTurnGrok") as typeof import("../../extensionHost/interactiveTurnGrok");

function createFixture(context: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-loop-resume-"));
  const workspaceCwd = path.join(root, "workspace");
  fs.mkdirSync(workspaceCwd);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const created: GrokRunnerCreateOptions[] = [];
  const starts: Array<{ requireResume?: boolean }> = [];
  const sessionId = "grok-native-session";
  let uiSessionId = "local_initial";
  let mappedSessionId: string | null = null;
  let failResume = false;
  let prompts = 0;
  const manager = {
    getOrCreateGrokRunner: (options: GrokRunnerCreateOptions) => {
      created.push(options);
      return {
        start: async (startOptions: { requireResume?: boolean }) => {
          starts.push(startOptions);
          if (failResume && startOptions.requireResume) throw new Error("Path not found.");
          return { acpSessionId: sessionId, resumed: Boolean(startOptions.requireResume), retainedLocalSessionId: null };
        },
        prompt: async (_prompt: string, handlers: { onAssistantDelta?: (text: string) => void; onComplete?: (result: { stopReason: string }) => void }) => {
          prompts += 1;
          handlers.onAssistantDelta?.("completed");
          handlers.onComplete?.({ stopReason: "end_turn" });
        },
        cancelTurn: () => undefined,
        dispose: () => undefined,
        disposeAndWait: async () => undefined,
      };
    },
    setRunner: () => undefined,
    detachRunner: () => undefined,
    hasGrokRunner: () => false,
  };
  const port = (tabId: string, grokLoopResumeSessionId?: string | null): InteractiveTurnAttemptPort => ({
    cli: "grok",
    cwd: workspaceCwd,
    grokLoopResumeSessionId,
    tabId,
    runId: tabId,
    attemptPrompt: "continue the task",
    command: "grok",
    commandForRunner: "grok",
    args: [],
    grokAgentArgs: [],
    dshModelWire: null,
    dshLaunch: null,
    kimiModelWire: null,
    kimiLaunch: null,
    zcodeModelWire: null,
    zcodeLaunch: null,
    thinkingMode: "off",
    interactiveMode: "coding",
    selectedModel: null,
    activeConfigId: "profile",
    claudeEntrypoint: undefined,
    isolateProjectInstructions: grokLoopResumeSessionId !== undefined,
    originalSessionId: uiSessionId,
    get uiSessionId() { return uiSessionId; },
    stopFn: () => undefined,
    interactiveRunnerManager: manager,
    interactiveRunsByTabId: new Map([[tabId, { runId: tabId, stopped: false }]]),
    attemptHadNormalReply: false,
    claudeSawAssistantText: false,
    claudeToolAfterAssistantText: false,
    claudeResultFailed: false,
    claudeSawSuccessfulResult: false,
    claudeSawEndTurn: false,
    observedCodexFinalAnswer: false,
    observedCodexPrimaryTurnCompleted: false,
    observedClaudeFinalAnswer: false,
    observedGrokFinalAnswer: false,
    observedDshFinalAnswer: false,
    observedKimiFinalAnswer: false,
    observedZcodeFinalAnswer: false,
    settleInteractiveAttempt: async () => "return",
    appendAssistantChunkForTab: () => undefined,
    appendTraceMessageForTab: () => undefined,
    appendDebugStdout: () => undefined,
    appendTraceLog: () => undefined,
    appendDebugEvent: () => undefined,
    appendSystemMessageForTab: () => undefined,
    sendPanelMessage: () => undefined,
    updateSessionForNewRun: (next: string) => { uiSessionId = next; mappedSessionId = next; },
    syncInteractiveRunEntry: () => undefined,
    isCurrentRunActive: () => true,
    setStopCurrentTurn: () => undefined,
    updateProcessTitle: () => undefined,
    updateSubagentProgress: () => undefined,
    handleStructuredHumanInteractionRequest: () => undefined,
    canHandleStructuredHumanInteractionRequest: () => false,
    resolveInteractiveMappedId: () => mappedSessionId,
    resolveCodexInteractiveSelection: () => null,
    getConversationTabById: () => null,
    createMessageId: () => "message",
    logInfo: () => undefined,
    t: (key: string) => key,
  } as unknown as InteractiveTurnAttemptPort);
  return {
    workspaceCwd,
    sessionId,
    created,
    starts,
    getPrompts: () => prompts,
    failResume: (value: boolean) => { failResume = value; },
    setMappedSessionId: (value: string | null) => { mappedSessionId = value; },
    port,
  };
}

test("Grok Loop+ loads the selected native session and does not send a prompt when recovery fails", async (context) => {
  const fixture = createFixture(context);
  const strategy = createGrokInteractiveTurnStrategy();
  await strategy.runAttempt(fixture.port("first-tab", null));
  await strategy.runAttempt(fixture.port("repair-tab", fixture.sessionId));
  fixture.failResume(true);
  await assert.rejects(strategy.runAttempt(fixture.port("failed-tab", fixture.sessionId)), /Path not found/);
  await assert.rejects(strategy.runAttempt(fixture.port("wrong-id-tab", "other-native-session")), /Path not found/);
  fixture.failResume(false);
  await assert.rejects(strategy.runAttempt(fixture.port("wrong-id-tab", "other-native-session")), /未恢复原子任务会话/);
  assert.equal(fixture.created[1].localSessionId, fixture.sessionId);
  assert.equal(fixture.created.at(-1)?.localSessionId, "other-native-session");
  assert.deepEqual(fixture.starts.map((options) => options.requireResume), [false, true, true, true, true]);
  assert.equal(fixture.getPrompts(), 2);
});

test("a new Loop+ Grok session ignores a stale UI session mapping", async (context) => {
  const fixture = createFixture(context);
  fixture.setMappedSessionId("stale-session");
  await createGrokInteractiveTurnStrategy().runAttempt(fixture.port("new-session-tab", null));
  assert.equal(fixture.created[0].localSessionId, null);
  assert.deepEqual(fixture.starts, [{ requireResume: false }]);
});

test("Grok Vibe keeps its original cwd and non-strict session startup", async (context) => {
  const fixture = createFixture(context);
  const strategy = createGrokInteractiveTurnStrategy();
  await strategy.runAttempt(fixture.port("vibe-first"));
  await strategy.runAttempt(fixture.port("vibe-resume"));

  assert.deepEqual(fixture.created.map((options) => options.cwd), [fixture.workspaceCwd, fixture.workspaceCwd]);
  assert.deepEqual(fixture.starts, [{ requireResume: false }, { requireResume: false }]);
});
