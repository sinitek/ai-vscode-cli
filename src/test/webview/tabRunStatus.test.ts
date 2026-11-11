import * as assert from "node:assert/strict";
import { test } from "node:test";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";

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
    "isErrorMessage", "getConversationTabSummary", "isConversationTabRunning", "setTabErrored",
    `${source.slice(start, end)}; return syncTabErrorFromMessage;`,
  )(
    (message: { role?: string; error?: boolean } | null) => Boolean(message?.error),
    (tabId: string) => tabs.get(tabId) ?? null,
    (tab: { running: boolean } | null) => Boolean(tab?.running),
    (tabId: string, value: boolean) => { if (value) errored.add(tabId); else errored.delete(tabId); },
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

test("an idle failure stays visible without letting unrelated or empty messages clear it", () => {
  const { errored, sync } = createErrorSync();
  sync("idle", { role: "system", error: true });
  assert.equal(errored.has("idle"), true);
  sync("idle", null);
  sync("idle", { role: "trace", error: false });
  assert.equal(errored.has("idle"), true);
  assert.equal(errored.has("active"), false);
});
