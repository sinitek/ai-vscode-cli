import * as assert from "node:assert/strict";
import { test } from "node:test";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { createRunStatusHarness } from "./tabRunStatusHarness";

function createErrorSync() {
  const source = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING;
  const start = source.indexOf("      function syncTabErrorFromMessage(");
  const end = source.indexOf("\n      function ", start + 1);
  assert.ok(start >= 0 && end > start);
  const tabs = new Map([
    ["active", { id: "active", running: true }],
    ["background", { id: "background", running: true }],
    ["idle", { id: "idle", running: false }],
  ]);
  const errored = new Set<string>();
  const sync = new Function(
    "isErrorMessage", "getConversationTabSummary", "isConversationTabRunning", "setTabErrored", "getConversationRuntimeState",
    `${source.slice(start, end)}; return syncTabErrorFromMessage;`,
  )(
    (message: { role?: string; error?: boolean } | null) => Boolean(message?.error),
    (tabId: string) => tabs.get(tabId) ?? null,
    (tab: { running: boolean } | null) => Boolean(tab?.running),
    (tabId: string, value: boolean) => { if (value) errored.add(tabId); else errored.delete(tabId); },
    () => null,
  ) as (tabId: string, message: unknown) => void;
  return { tabs, errored, sync };
}

test("intermediate trace and system errors do not fail active or background running tabs", () => {
  const { errored, sync } = createErrorSync();
  for (const tabId of ["active", "background"]) {
    for (const role of ["trace", "system"]) {
      sync(tabId, { role, error: true });
      assert.equal(errored.has(tabId), false);
    }
  }
});

for (const tabId of ["active", "background"]) {
  test(`successful ${tabId} tab ignores late error messages and retry notices`, () => {
    const harness = createRunStatusHarness();
    harness.run(tabId, "start");
    harness.run(tabId, "end");
    harness.message(tabId, "replaceMessage", "user", "历史用户消息元信息补齐");
    for (const type of ["appendMessage", "replaceMessage"]) {
      for (const role of ["trace", "system"]) {
        harness.message(tabId, type, role);
        assert.equal(harness.erroredTabIds.has(tabId), false, `${type}:${role}`);
      }
    }
    harness.send({ type: "traceSegment", tabId, content: "error: 迟到的流式错误" });
    assert.equal(harness.erroredTabIds.has(tabId), false);
    harness.message(tabId, "appendMessage", "system", "任务已中断，将在 1 秒后开始第 1 / 2 次自动重试。");
    assert.equal(harness.erroredTabIds.has(tabId), false);
  });
}

test("explicit errors still fail completed tabs and do not affect another tab", () => {
  const harness = createRunStatusHarness();
  harness.run("active", "end");
  harness.run("background", "end");
  harness.run("background", "error");
  assert.equal(harness.erroredTabIds.has("background"), true);
  assert.equal(harness.erroredTabIds.has("active"), false);
  harness.activate("background");
  harness.send({ type: "runStatus", status: "end" });
  harness.message("background");
  assert.equal(harness.erroredTabIds.has("background"), false);
});

test("a new user message or a reset releases the previous completion protection", () => {
  for (const tabId of ["active", "background"]) {
    for (const action of ["user", "reset", "prune"]) {
      const harness = createRunStatusHarness();
      harness.run(tabId, "end");
      if (action === "user") {
        harness.message(tabId, "appendMessage", "user", "开始下一项任务");
      } else if (action === "reset") {
        harness.reset(tabId);
      } else {
        harness.prune([]);
      }
      harness.message(tabId, "appendMessage", "system");
      assert.equal(harness.erroredTabIds.has(tabId), true, `${tabId}:${action}`);
    }
  }
});

test("stopping the next run does not retain an older success protection", () => {
  const harness = createRunStatusHarness();
  harness.run("active", "end");
  harness.run("active", "start");
  harness.run("active", "stopped");
  assert.equal(harness.erroredTabIds.has("active"), false);
  harness.message("active", "appendMessage", "system");
  assert.equal(harness.erroredTabIds.has("active"), true);
});

test("new runs clear old failures but later real failures remain visible", () => {
  const harness = createRunStatusHarness();
  harness.run("active", "end");
  harness.run("active", "start");
  harness.message("active");
  assert.equal(harness.erroredTabIds.has("active"), false);
  harness.run("active", "error");
  assert.equal(harness.erroredTabIds.has("active"), true);
  harness.run("active", "start");
  assert.equal(harness.erroredTabIds.has("active"), false);
});

test("an idle failure stays visible without letting unrelated or empty messages clear it", () => {
  const { errored, sync } = createErrorSync();
  sync("idle", { role: "system", error: true });
  assert.equal(errored.has("idle"), true);
  sync("idle", null);
  sync("idle", { role: "trace", error: false });
  assert.equal(errored.has("idle"), true);
  assert.equal(errored.has("active"), false);
});

for (const tabId of ["active", "background"]) {
  test(`completed ${tabId} tab preserves real compaction activity and rejects no new execution errors`, () => {
    const view = createRunStatusHarness();
    view.run("main-review", "start");
    view.run(tabId, "start");
    view.run(tabId, "end");
    view.send({ type: "contextTokenUsage", tabId, tokensInContextWindow: 1200,
      modelContextWindow: 8000, contextWindowSource: "zcode-projection" });
    const parent = JSON.stringify(view.tabState("main-review"));

    view.run(tabId, "start", "contextCompaction");
    assert.deepEqual(view.tabState(tabId), {
      running: true, errored: false, activity: "contextCompaction", lastRunStatus: "start",
    });
    assert.equal(view.runtime(tabId).tokensInContextWindow, 1200, "compaction keeps the existing context counter");
    if (tabId === "active") {
      assert.equal(view.elements.runStatusText.textContent, "runStatusCompacting");
      assert.equal(view.elements.runStatusText.classes.has("compacting"), true);
    }
    // Exercise delayed message paths independently of the silent host's log-only failure path.
    for (const role of ["trace", "system"]) {
      view.message(tabId, "appendMessage", role, "error: CODEX_THREAD_HANDOFF_FAILED");
      view.message(tabId, "replaceMessage", role, "error: CODEX_THREAD_HANDOFF_FAILED");
      assert.equal(view.tabState(tabId).errored, false);
    }
    view.send({ type: "traceSegment", tabId, content: "error: CODEX_THREAD_HANDOFF_FAILED" });
    assert.equal(view.tabState(tabId).errored, false);
    view.run(tabId, "end");
    assert.deepEqual(view.tabState(tabId), { running: false, errored: false, activity: "", lastRunStatus: "end" });
    for (const role of ["trace", "system"]) {
      view.message(tabId, "appendMessage", role, "error: late CODEX_THREAD_HANDOFF_FAILED");
      view.message(tabId, "replaceMessage", role, "error: late CODEX_THREAD_HANDOFF_FAILED");
    }
    view.send({ type: "traceSegment", tabId, content: "error: late CODEX_THREAD_HANDOFF_FAILED" });
    assert.equal(view.tabState(tabId).errored, false);
    assert.equal(JSON.stringify(view.tabState("main-review")), parent);
    if (tabId === "active") {
      assert.equal(view.elements.runStatusText.classes.has("compacting"), false);
      assert.equal(view.renderedTraces.length, 2, "error traces reach the active rendering port");
      assert.equal(view.renderedMessages.length, 4, "trace/system errors are delivered, not globally filtered");
    }

    view.message(tabId, "appendMessage", "user", "start a real new execution");
    view.run(tabId, "start");
    assert.equal(view.runtime(tabId).tokensInContextWindow, null, "a normal run clears the old context counter");
    assert.equal(view.runtime(tabId).activeRunActivity, "");
    view.run(tabId, "error");
    assert.deepEqual(view.tabState(tabId), { running: false, errored: true, activity: "", lastRunStatus: "error" });
    view.message(tabId, "appendMessage", "system", "error: actual execution failure");
    assert.equal(view.tabState(tabId).errored, true);
    assert.equal(JSON.stringify(view.tabState("main-review")), parent);
  });
}
