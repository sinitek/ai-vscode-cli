import * as assert from "node:assert/strict";
import { test } from "node:test";

import { HEADER_TABS_STYLES } from "../../webview/viewContentStyles/headerTabs";
import { WEBVIEW_I18N } from "../../webview/viewContentI18n";
import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../../webview/viewContentScript/eventBindings";

type Timer = {
  id: number;
  callback: () => void;
  delay: number;
  canceled: boolean;
};

type ButtonDouble = {
  id: string;
  title: string | null;
  describedBy: string | null;
  listeners: Record<string, () => void>;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, listener: () => void) => void;
};

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  let depth = 0;
  let started = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      started = true;
    } else if (char === "}") {
      depth -= 1;
      if (started && depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

function createButton(title: string): ButtonDouble {
  const button: ButtonDouble = {
    id: "newSession",
    title,
    describedBy: null,
    listeners: {},
    getAttribute: (name) => (name === "title" ? button.title : null),
    setAttribute: (name, value) => {
      if (name === "title") {
        button.title = value;
      }
      if (name === "aria-describedby") {
        button.describedBy = value;
      }
    },
    removeAttribute: (name) => {
      if (name === "title") {
        button.title = null;
      }
      if (name === "aria-describedby") {
        button.describedBy = null;
      }
    },
    addEventListener: (type, listener) => {
      button.listeners[type] = listener;
    },
  };
  return button;
}

function createController() {
  const source = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_EVENT_BINDINGS,
    "createCodexLongConnectionTooltipController",
  );
  const factory = new Function(`${source}; return createCodexLongConnectionTooltipController;`)() as (options: {
    button: ButtonDouble;
    tooltip: { id: string; hidden: boolean; textContent: string };
    postMessage: (payload: { type: string; token: number }) => void;
    translate: (key: string, params?: { count?: number }) => string;
    schedule: (callback: () => void, delay: number) => number;
    cancel: (timer: number) => void;
  }) => { applyCount: (data: { token?: unknown; count?: unknown }) => void };
  const button = createButton(WEBVIEW_I18N["zh-CN"].headerNewSession);
  const tooltip = { id: "newSessionConnectionTooltip", hidden: true, textContent: "" };
  const posted: Array<{ type: string; token: number }> = [];
  const timers: Timer[] = [];
  let nextTimerId = 1;
  const controller = factory({
    button,
    tooltip,
    postMessage: (payload) => posted.push(payload),
    translate: (key, params) => {
      const template = WEBVIEW_I18N["zh-CN"][key as keyof typeof WEBVIEW_I18N["zh-CN"]] || key;
      return template.replace("{count}", String(params?.count ?? ""));
    },
    schedule: (callback, delay) => {
      const timer = { id: nextTimerId, callback, delay, canceled: false };
      nextTimerId += 1;
      timers.push(timer);
      return timer.id;
    },
    cancel: (timerId) => {
      const timer = timers.find((item) => item.id === timerId);
      if (timer) {
        timer.canceled = true;
      }
    },
  });
  return {
    button,
    tooltip,
    posted,
    timers,
    controller,
    fire(timer: Timer) {
      if (!timer.canceled) {
        timer.callback();
      }
    },
  };
}

test("shows the Codex connection count only after hovering for 3 seconds", () => {
  const harness = createController();
  assert.match(HEADER_TABS_STYLES, /\.header-hover-tooltip/);
  assert.match(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, /const delayMs = 3000;/);

  harness.button.listeners.pointerenter();
  assert.equal(harness.posted.length, 0);
  assert.equal(harness.timers[0]?.delay, 3000);
  harness.fire(harness.timers[0]);

  assert.deepEqual(harness.posted, [{ type: "queryCodexLongConnectionCount", token: 1 }]);
  harness.controller.applyCount({ token: 1, count: 2.8 });
  assert.equal(harness.tooltip.hidden, false);
  assert.equal(harness.tooltip.textContent, "当前长连接：2");
  assert.equal(harness.button.title, null);
  assert.equal(harness.button.describedBy, "newSessionConnectionTooltip");
});

test("ignores early responses, stale tokens, and invalid counts", () => {
  const harness = createController();
  harness.button.listeners.pointerenter();
  harness.controller.applyCount({ token: 1, count: 9 });
  assert.equal(harness.tooltip.hidden, true);

  harness.fire(harness.timers[0]);
  harness.controller.applyCount({ token: 1, count: Number.NaN });
  assert.equal(harness.tooltip.textContent, "当前长连接：0");

  harness.button.listeners.pointerleave();
  assert.equal(harness.tooltip.hidden, true);
  assert.equal(harness.button.title, "新建会话");
  harness.controller.applyCount({ token: 1, count: 4 });
  assert.equal(harness.tooltip.hidden, true);

  harness.button.listeners.pointerenter();
  harness.button.listeners.pointerleave();
  harness.fire(harness.timers[1]);
  assert.equal(harness.posted.length, 1);
});
