import assert = require("node:assert/strict");
import test = require("node:test");
import type { InteractiveTurnAttemptPort } from "../../extensionHost/interactiveTurnStrategy";
import type { ZcodeStreamHandlers } from "../../interactive/zcodeRunner";
import type { ZcodeWireMessage } from "../../interactive/zcodeAppServerProtocol";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createZcodeInteractiveTurnStrategy } = require("../../extensionHost/interactiveTurnZcode") as typeof import("../../extensionHost/interactiveTurnZcode");

function createReplayHarness(terminalType: "turn.completed" | "turn.failed" = "turn.completed") {
  let active = true;
  let handlers: ZcodeStreamHandlers = {};
  const messages: Record<string, unknown>[] = [];
  const debugEvents: unknown[] = [];
  const events: ZcodeWireMessage[] = [
    { method: "session/event", params: { sessionId: "sess_test", type: "model.streaming", payload: { kind: "text_delta", delta: "已完成\n检查" } } },
    { method: "session/event", params: { sessionId: "sess_test", type: terminalType, payload: terminalType === "turn.failed" ? { message: "任务失败" } : { response: "已完成" } } },
  ];
  const settings = { model: null, thinking: null, thinkingOptions: [], modeId: "yolo" };
  const runner = {
    start: async () => ({ sessionId: "sess_test", usage: null }),
    getSettings: () => settings,
    cancelTurn: () => {},
    prompt: async (_content: string, callbacks: ZcodeStreamHandlers) => {
      handlers = callbacks;
      for (const event of events) {
        callbacks.onEvent?.(event);
      }
      if (terminalType === "turn.failed") {
        throw new Error("任务失败");
      }
      return { text: "已完成" };
    },
  };
  const port = {
    cli: "zcode",
    tabId: "tab_zcode",
    uiSessionId: "sess_test",
    attemptPrompt: "执行任务",
    cwd: process.cwd(),
    zcodeLaunch: { agentArgs: [], env: {}, modeId: "yolo", modelRef: null, thinkingValue: null },
    interactiveRunnerManager: {
      getOrCreateZcodeRunner: () => runner,
      setRunner: () => {},
    },
    resolveInteractiveMappedId: () => "sess_test",
    setStopCurrentTurn: () => {},
    syncInteractiveRunEntry: () => {},
    updateSessionForNewRun: () => {},
    sendPanelMessage: (message: Record<string, unknown>) => { messages.push(message); },
    appendDebugEvent: (event: unknown) => { debugEvents.push(event); },
    isCurrentRunActive: () => active,
    settleInteractiveAttempt: async () => {
      active = false;
      return "return";
    },
  } as unknown as InteractiveTurnAttemptPort;
  return {
    port,
    messages,
    debugEvents,
    events,
    getHandlers: () => handlers,
    setActive: (value: boolean) => { active = value; },
  };
}

test("ZCode sends task replay events to the current tab and the same debug log stream", async () => {
  const harness = createReplayHarness();
  assert.equal(await createZcodeInteractiveTurnStrategy().runAttempt(harness.port), "return");
  const replayMessages = harness.messages.filter((message) => message.type === "rawStreamDelta");
  assert.deepEqual(replayMessages, harness.events.map((event) => ({
    type: "rawStreamDelta", tabId: "tab_zcode", stream: "event", content: `${JSON.stringify(event)}\n`,
  })));
  assert.deepEqual(harness.debugEvents, harness.events);
  harness.getHandlers().onEvent?.(harness.events[0]);
  assert.equal(harness.messages.filter((message) => message.type === "rawStreamDelta").length, 2);
  assert.equal(harness.debugEvents.length, 2);
});

test("ZCode does not send replay events or debug records for an inactive run", async () => {
  const harness = createReplayHarness();
  harness.setActive(false);
  await createZcodeInteractiveTurnStrategy().runAttempt(harness.port);
  assert.deepEqual(harness.messages.filter((message) => message.type === "rawStreamDelta"), []);
  assert.deepEqual(harness.debugEvents, []);
});

test("ZCode keeps the terminal failure in replay before propagating the runner error", async () => {
  const harness = createReplayHarness("turn.failed");
  await assert.rejects(createZcodeInteractiveTurnStrategy().runAttempt(harness.port), /任务失败/);
  const replayMessages = harness.messages.filter((message) => message.type === "rawStreamDelta");
  assert.deepEqual(replayMessages.map((message) => JSON.parse(String(message.content))), harness.events);
  assert.deepEqual(harness.debugEvents, harness.events);
});
