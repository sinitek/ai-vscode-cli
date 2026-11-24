import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import vm = require("node:vm");
import ts = require("typescript");
import { installVscodeMock } from "../../vscodeMock";
import type { RunProcess } from "../../../cli/commandRunner";
import type { ContextCompactionOptions, ContextCompactionRunDeps } from "../../../contextCompactionRunner";
import { LoopMainAutoCompactFlights, settleAutoCompactAfterPrompt } from "../../../loopMainAutoCompact";
import type { LoopMainAutoCompactRequest } from "../../../loopMainAutoCompact";
import type { PromptRunTarget } from "../../../promptRunTypes";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "../../../webview/viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../../webview/viewContentScript/windowMessageDispatch";

installVscodeMock();
const { isAutoContextCompactionCli, runContextCompactionWithDeps } = require("../../../contextCompactionRunner") as typeof import("../../../contextCompactionRunner");

function declarations(fileName: string, source: string, names: string[]) {
  const syntax = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2020, true);
  return names.map((name) => {
    const statement = syntax.statements.find((statement) =>
      (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.name.getText(syntax) === name)));
    assert.ok(statement, `${name} missing from ${fileName}`);
    return statement.getText(syntax);
  }).join("\n");
}

const hostScript = ts.transpileModule(declarations("extension.ts", fs.readFileSync(path.join(process.cwd(), "src/extension.ts"), "utf8"), [
  "AUTO_COMPACT_AFTER_RUN_MIN_DURATION_MS", "AUTO_COMPACT_AFTER_RUN_TIMEOUT_MS",
  "shouldAutoCompactContextAfterRunForTarget", "maybeAutoCompactContextAfterPromptSuccess",
  "runAutoCompactContextAfterPromptSuccess", "runContextCompaction", "sendRunStatus",
]), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

const queueScript = [
  declarations("runStreamAndQueue.js", VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, ["canQueuePrompt", "flushPendingPromptQueue", "continueQueuedPrompts"]),
  declarations("messageRendering.js", VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, ["isTabRunning", "isConversationTabRunning", "isConversationTabBusy"]),
  declarations("coreRuntimeState.js", VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, ["normalizeRunActivity", "buildQueuePausedStatusText"]),
  VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH,
  "({ continueQueuedPrompts, flushPendingPromptQueue });",
].join("\n");

type RunStatus = Parameters<ContextCompactionRunDeps["sendRunStatus"]>[0];
type RunStatusEvent = { status: RunStatus; activity?: string; tabId?: string };
type QueuedPrompt = { prompt: string };
type AutoCompact = (target: PromptRunTarget, sessionId: string | null, durationMs: number | null | undefined, options?: LoopMainAutoCompactRequest) => Promise<void>;
type QueueOutcome = "end" | "stopped" | "skipped";

export function createVibeCompactionQueueFixture(cli: "codex" | "opencode") {
  const tabId = "tab-1";
  const sessionId = "session-1";
  const pendingPromptQueue: QueuedPrompt[] = [{ prompt: "first" }, { prompt: "second" }];
  const runtimeState = { pendingPromptQueue, queueEditingIndex: -1, activeRunActivity: "", lastRunStatus: "" };
  const dispatched: string[] = [];
  const toasts: string[] = [];
  const statuses: RunStatusEvent[] = [];
  const noop = () => undefined;
  let onMessage: (event: { data: RunStatusEvent & { type: "runStatus" } }) => void = () => assert.fail("missing webview listener");
  const queue = vm.runInNewContext(queueScript, {
    window: { addEventListener: (name: string, listener: typeof onMessage) => { if (name === "message") onMessage = listener; } },
    vscode: { postMessage: noop }, updateAppHeight: noop, scheduleAppHeightUpdate: noop,
    state: { currentCli: cli, interactiveMode: "vibe" },
    getActiveConversationTabId: () => tabId,
    getConversationTabSummary: () => ({ id: tabId, cli }),
    getConversationRuntimeState: (id: string) => id === tabId ? runtimeState : undefined,
    getLoopMetaForTabSummary: () => null, isLoopMainTab: () => false, isLoopMainTabCloseLocked: () => false,
    normalizeInteractiveMode: (mode: string) => mode,
    shouldHandleTabScopedEvent: () => true, isRuntimeStateForActiveTab: (id: string) => id === tabId,
    runningTabStartedAtById: {}, assistantRedirects: {}, getTabRunStartedAt: () => 0,
    setTabErrored: noop, resetRunRawStream: noop, updateCurrentRunPrompt: noop, resetTaskListForRunStart: noop,
    settlePromptSubmission: noop, closeTaskListForRunCompletion: noop, updateRunningState: noop,
    syncConversationControlsForActiveTab: noop, syncPendingPromptQueueState: noop, updateQueueIndicator: noop,
    closeQueueOverlay: noop, syncQueueOverlay: noop,
    t: (key: string) => key, showToast: (message: string) => toasts.push(message),
    dispatchPrompt: (payload: QueuedPrompt) => { dispatched.push(payload.prompt); return true; },
    reportWebviewFailure: (_label: string, error: unknown) => { throw error; },
  }) as { continueQueuedPrompts: (id: string) => void; flushPendingPromptQueue: (id: string) => boolean };

  const publish = (event: RunStatusEvent): void => {
    statuses.push(event);
    onMessage({ data: { ...event, type: "runStatus" } });
  };
  const controller = {
    activeRunId: undefined as string | undefined,
    activeProcess: undefined as RunProcess | undefined,
    activeInteractiveStop: null as (() => void) | null,
    activeTabIdForRun: tabId,
    activeCliForRun: cli,
    begin: ({ runId }: { runId: string }) => { controller.activeRunId = runId; },
  };
  let enterNative!: () => void;
  let finishNative!: () => void;
  const nativeStarted = new Promise<void>((resolve) => { enterNative = resolve; });
  const nativeResult = new Promise<void>((resolve) => { finishNative = resolve; });
  let compactWrites = 0;
  let nativeStops = 0;
  const writeCompactResult = () => { compactWrites += 1; };
  const stopNative = () => { nativeStops += 1; };

  const host = vm.runInNewContext(`${hostScript}\n({ maybeAutoCompactContextAfterPromptSuccess, minDuration: AUTO_COMPACT_AFTER_RUN_MIN_DURATION_MS });`, {
    isAutoContextCompactionCli, settleAutoCompactAfterPrompt, loopMainAutoCompactFlights: new LoopMainAutoCompactFlights(),
    isPrimaryRunActive: () => false, getGlobalAutoCompactContextAfterRun: () => true, logInfo: noop,
    departmentTaskForTab: noop, usesDepartmentOwner: () => false, primaryPromptRunController: controller,
    getActiveConversationTabId: () => tabId, isInteractiveSupported: () => true, getCurrentSessionId: () => sessionId,
    resolveInteractiveSessionForResume: async () => sessionId, resolveWorkspaceCwd: () => process.cwd(),
    getActiveConfigIdForCli: () => null, getSelectedCliModel: () => null, getEffectiveThinkingMode: () => "medium",
    getWorkspaceInteractiveMode: () => "vibe", getEffectiveCliArgs: () => [], getCliCommand: () => cli,
    resolveClaudeInteractiveEntrypoint: noop, applyThinkingWorkspaceFiles: noop, logCliStartup: noop,
    loadSessionMessages: () => [], createMessageId: () => "compact-run", getConversationTabById: noop,
    applyProcessTitle: noop, startTaskRun: noop, t: (key: string) => key,
    appendSystemMessageForCli: noop, appendStopMessageToStore: noop, appendCompletionMessage: noop,
    persistActiveMessages: noop, clearActiveRun: () => { controller.activeRunId = undefined; },
    markConversationTabRunStarted: noop, clearTaskListForRunStart: noop, latestOpenCodeTaskListByTabId: new Map(),
    sendPanelMessage: publish, resolveInteractiveMappedId: () => "codex-thread", appendSystemMessage: noop,
    upsertInteractiveMapping: writeCompactResult, adoptSessionId: writeCompactResult,
    sendRawStreamDelta: noop, updateProcessTitle: noop, appendTraceMessage: noop, appendAssistantChunk: noop,
    configService: {}, prepareOpenCodeRuntime: async () => ({}),
    interactiveRunnerManager: {
      beginActiveRun: noop, endActiveRun: noop, setRunner: noop,
      getOrCreateCodexRunner: () => ({
        compactThread: async () => { enterNative(); await nativeResult; return { threadId: "codex-thread", compacted: true }; },
        stopAndRebuild: stopNative,
      }),
    },
    runContextCompactionWithDeps: (deps: ContextCompactionRunDeps, options: ContextCompactionOptions) => runContextCompactionWithDeps({
      ...deps,
      runCliStream: (_cli, _prompt, handlers) => {
        void nativeResult.then(() => {
          handlers.onStdout(`${JSON.stringify({ type: "assistant", sessionID: sessionId, text: "Compacted current session" })}\n`);
          handlers.onExit(0);
        });
        enterNative();
        return { pid: 123, resolvedCommand: "opencode", kill: () => { stopNative(); return true; } };
      },
    }, options),
  }) as { maybeAutoCompactContextAfterPromptSuccess: AutoCompact; minDuration: number };

  return {
    ...host,
    publish,
    async assertSettlement(outcome: QueueOutcome, run: Promise<unknown>, assertModelCompleted: () => void = noop) {
      try {
        if (outcome !== "skipped") {
          assert.equal(await Promise.race([nativeStarted.then(() => "compacting"), run.then(() => "finished")]), "compacting");
          assertModelCompleted();
          assert.equal(runtimeState.activeRunActivity, "contextCompaction");
          assert.deepEqual(statuses.map((event) => event.status), ["start", "start"]);
          assert.equal(queue.flushPendingPromptQueue(tabId), false);
          assert.deepEqual(dispatched, []);
          assert.deepEqual(pendingPromptQueue.map((payload) => payload.prompt), ["first", "second"]);
        }
        if (outcome === "stopped") {
          assert.ok(controller.activeInteractiveStop);
          controller.activeInteractiveStop();
          await run;
        }
      } finally {
        finishNative();
        await run;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      assertModelCompleted();
      assert.deepEqual(statuses.map((event) => event.status), outcome === "skipped" ? ["start", "end"] : ["start", "start", outcome]);
      assert.equal(runtimeState.lastRunStatus, outcome === "stopped" ? "stopped" : "end");
      assert.equal(compactWrites, outcome === "end" ? 1 : 0);
      assert.equal(nativeStops, outcome === "stopped" ? 1 : 0);
      if (outcome === "stopped") {
        assert.deepEqual(toasts, ["toastQueuePaused"]);
        assert.deepEqual(dispatched, []);
        assert.deepEqual(pendingPromptQueue.map((payload) => payload.prompt), ["first", "second"]);
        queue.continueQueuedPrompts(tabId);
      }
      assert.deepEqual(dispatched, ["first"]);
      assert.deepEqual(pendingPromptQueue.map((payload) => payload.prompt), ["second"]);
    },
  };
}
