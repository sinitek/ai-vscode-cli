import test = require("node:test");
import assert = require("node:assert/strict");

import type { OpenCodeSubagentMonitor } from "../../cli/openCodeSubagentMonitor";
import type { OpenCodePromptSubagentMonitorContext } from "../../extensionHost/openCodePromptRunTemplate";
import type { OpenCodePromptMonitorFactory } from "../../extensionHost/openCodePromptSubagentMonitor";
import { createOpenCodePromptSubagentMonitor } from "../../extensionHost/openCodePromptSubagentMonitor";

const connection = { serverUrl: "http://127.0.0.1:1" };
const runtime = (withConnection: boolean) => ({
  connection: withConnection ? connection : null,
  endpointSource: "unavailable" as const,
  error: null,
  dispose: () => undefined,
});
const context = (withConnection: boolean, attemptNumber: number): OpenCodePromptSubagentMonitorContext => ({
  subagentRuntime: runtime(withConnection),
  attemptNumber,
  directory: "/workspace",
});

function createPorts(kind: "one-shot" | "parallel" = "one-shot") {
  let noticeShown = false;
  let updateAllowed = true;
  let emptyNoticeAllowed = true;
  const callbacks: Array<Parameters<OpenCodePromptMonitorFactory>[0]> = [];
  const events: Array<{ name: string; payload?: unknown }> = [];
  const shown: string[] = [];
  const disabled: OpenCodeSubagentMonitor = {
    setParentSessionId: () => undefined,
    pollNow: async () => undefined,
    finish: () => undefined,
    dispose: () => undefined,
  };
  const ports = {
    kind,
    createMonitor: (options: (typeof callbacks)[number]) => {
      callbacks.push(options);
      return disabled;
    },
    createDisabledMonitor: () => disabled,
    canUpdateProgress: () => updateAllowed,
    canShowEmptyProgressNotice: () => emptyNoticeAllowed,
    hasShownEmptyProgressNotice: () => noticeShown,
    markEmptyProgressNoticeShown: () => { noticeShown = true; },
    updateProgress: (update: unknown) => events.push({ name: "update", payload: update }),
    showEmptyProgressNotice: () => { shown.push("clear-then-append"); },
    getLogContext: () => ({ cli: "opencode" as const, runId: "run", tabId: "tab", sessionId: "ses_live" }),
    pollIntervalMs: 60000,
    logInfo: async (name: string, payload?: unknown) => { events.push({ name, payload }); },
    logDebug: async (name: string, payload?: unknown) => { events.push({ name, payload }); },
    get noticeShown() { return noticeShown; },
    setUpdateAllowed: (value: boolean) => { updateAllowed = value; },
    setEmptyNoticeAllowed: (value: boolean) => { emptyNoticeAllowed = value; },
    callbacks,
    events,
    shown,
  };
  return ports;
}

test("uses the injected disabled monitor without a connection", () => {
  const ports = createPorts();
  const monitor = createOpenCodePromptSubagentMonitor(context(false, 1), ports);
  assert.equal(monitor, ports.createDisabledMonitor());
  assert.equal(ports.callbacks.length, 0);
});

test("empty notices deduplicate across attempts in one run but not across runs", async () => {
  const firstRun = createPorts();
  const firstAttempt = createOpenCodePromptSubagentMonitor(context(true, 1), firstRun);
  firstRun.callbacks[0].onNoChildren?.();
  const retry = createOpenCodePromptSubagentMonitor(context(true, 2), firstRun);
  firstRun.callbacks[1].onNoChildren?.();
  assert.equal(firstAttempt, retry);
  assert.deepEqual(firstRun.shown, ["clear-then-append"]);
  assert.equal(firstRun.events.filter((event) => event.name === "runPrompt-one-shot-subagent-poll-empty").length, 1);
  assert.deepEqual((firstRun.events[0].payload as Record<string, unknown>).attempt, 1);
  assert.deepEqual((firstRun.events[0].payload as Record<string, unknown>).sessionId, "ses_live");

  const secondRun = createPorts();
  createOpenCodePromptSubagentMonitor(context(true, 1), secondRun);
  secondRun.callbacks[0].onNoChildren?.();
  assert.equal(secondRun.shown.length, 1);
});

test("ignores stale callbacks and preserves separate parallel progress and empty-notice gates", () => {
  const ports = createPorts("parallel");
  const monitor = createOpenCodePromptSubagentMonitor(context(true, 1), ports);
  ports.setUpdateAllowed(false);
  ports.callbacks[0].onUpdate({ provider: "opencode", id: "stale" });
  assert.equal(ports.events.some((event) => event.name === "update"), false);

  ports.setEmptyNoticeAllowed(false);
  ports.callbacks[0].onNoChildren?.();
  assert.equal(ports.noticeShown, false);
  assert.equal(ports.shown.length, 0);

  ports.setUpdateAllowed(true);
  ports.callbacks[0].onUpdate({ provider: "opencode", id: "current" });
  assert.equal(ports.events.some((event) => event.name === "update"), true);
  ports.setEmptyNoticeAllowed(true);
  ports.callbacks[0].onNoChildren?.();
  assert.deepEqual(ports.shown, ["clear-then-append"]);
  assert.equal(monitor, ports.createDisabledMonitor());
});

test("logs monitor errors with the current attempt diagnostics", async () => {
  const ports = createPorts();
  createOpenCodePromptSubagentMonitor(context(true, 3), ports);
  ports.callbacks[0].onError?.(new Error("poll failed"));
  await Promise.resolve();
  assert.equal(ports.events[0].name, "runPrompt-one-shot-subagent-monitor-error");
  assert.deepEqual(ports.events[0].payload, {
    cli: "opencode", runId: "run", tabId: "tab", sessionId: "ses_live", attempt: 3, error: "poll failed",
  });
});
