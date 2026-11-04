import test = require("node:test");
import assert = require("node:assert/strict");
import { createHumanInteractionAttentionController, withHumanInteractionAttention, type DesktopAttentionNotificationKind } from "../../humanInteractionAttention";

function harness() {
  const events: string[] = [];
  const errors: string[] = [];
  const state = { focused: false, local: true };
  const settings = { notifications: true, windowAttention: true, taskCompletion: { notifications: true, windowAttention: true } };
  const transport = {
    notify: async (kind?: DesktopAttentionNotificationKind) => { events.push(kind === "task-completed" ? "completed-notify" : "notify"); },
    startAttention: async () => { events.push("start"); },
    stopAttention: async () => { events.push("stop"); },
  };
  const controller = createHumanInteractionAttentionController({
    isFocused: () => state.focused,
    isLocal: () => state.local,
    readSettings: () => settings,
    transport,
    onError: (channel) => { errors.push(channel); },
  });
  return { controller, events, errors, state, settings, transport };
}

test("background requests notify once and stop attention when completed", async () => {
  const env = harness();
  await env.controller.request("ask");
  await env.controller.request("ask");
  assert.deepEqual(env.events, ["notify", "start"]);
  await env.controller.complete("ask");
  assert.deepEqual(env.events, ["notify", "start", "stop"]);
  await env.controller.dispose();
  assert.equal(env.events.length, 3);
});

test("foreground requests wait for focus loss and never notify twice on later focus changes", async () => {
  const env = harness();
  env.state.focused = true;
  await env.controller.request("ask");
  assert.deepEqual(env.events, []);
  env.state.focused = false;
  await env.controller.refresh();
  env.state.focused = true;
  await env.controller.refresh();
  env.state.focused = false;
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start", "stop", "start"]);
  await env.controller.dispose();
});

test("concurrent pending requests retain attention until the final request finishes", async () => {
  const env = harness();
  await env.controller.request("first");
  await env.controller.request("second");
  await env.controller.complete("first");
  assert.deepEqual(env.events, ["notify", "start", "notify"]);
  await env.controller.complete("second");
  assert.deepEqual(env.events, ["notify", "start", "notify", "stop"]);
});

test("requests queued together share a notification and already settled requests stay silent", async () => {
  const env = harness();
  await Promise.all([env.controller.request("first"), env.controller.request("second")]);
  assert.deepEqual(env.events, ["notify", "start"]);
  await env.controller.dispose();
  const settled = harness();
  await Promise.all([settled.controller.request("ask"), settled.controller.complete("ask")]);
  assert.deepEqual(settled.events, []);
});

test("notification and attention preferences update independently for pending requests", async () => {
  const env = harness();
  env.settings.notifications = false;
  await env.controller.request("ask");
  assert.deepEqual(env.events, ["start"]);
  env.settings.notifications = true;
  env.settings.windowAttention = false;
  await env.controller.refresh();
  assert.deepEqual(env.events, ["start", "notify", "stop"]);
  env.settings.notifications = false;
  await env.controller.request("another");
  assert.equal(env.events.length, 3);
});

test("remote extension hosts never execute desktop reminders", async () => {
  const env = harness();
  env.state.local = false;
  await env.controller.request("ask");
  await env.controller.complete("ask");
  assert.deepEqual(env.events, []);
});

test("a failed notification does not suppress attention or block later requests", async () => {
  const env = harness();
  env.transport.notify = async () => { throw new Error("通知工具不可用"); };
  await env.controller.request("ask");
  assert.deepEqual(env.errors, ["notification"]);
  assert.deepEqual(env.events, ["start"]);
  await env.controller.complete("ask");
  await env.controller.request("second");
  assert.deepEqual(env.events, ["start", "stop", "start"]);
  await env.controller.dispose();
});

test("pending notification authorization does not delay focus or completion cleanup", { timeout: 1000 }, async (context) => {
  const env = harness();
  let release = (): void => undefined;
  env.transport.notify = async () => {
    env.events.push("notify");
    await new Promise<void>((resolve) => { release = resolve; });
  };
  context.after(() => release());
  const sending = env.controller.request("ask");
  await Promise.resolve();
  env.state.focused = true;
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start", "stop"]);
  await env.controller.complete("ask");
  await env.controller.dispose();
  release();
  await sending;
});

test("partially failed attention is still cleaned up and cleanup failures do not escape", async () => {
  const env = harness();
  env.transport.startAttention = async () => { throw new Error("窗口提醒失败"); };
  env.transport.stopAttention = async () => { throw new Error("窗口已关闭"); };
  await env.controller.request("ask");
  await env.controller.complete("ask");
  assert.deepEqual(env.errors, ["window", "window"]);
});

test("focus returning during a slow native request removes late attention", async () => {
  const env = harness();
  let release = (): void => undefined;
  env.transport.startAttention = async () => {
    env.events.push("start");
    await new Promise<void>((resolve) => { release = resolve; });
  };
  const started = env.controller.request("ask");
  await new Promise((resolve) => setImmediate(resolve));
  env.state.focused = true;
  const stopped = env.controller.refresh();
  release();
  await Promise.all([started, stopped]);
  assert.deepEqual(env.events, ["notify", "start", "stop"]);
});

test("disposal during a slow native request cleans up and rejects no task", async () => {
  const env = harness();
  let release = (): void => undefined;
  env.transport.startAttention = async () => {
    env.events.push("start");
    await new Promise<void>((resolve) => { release = resolve; });
  };
  const started = env.controller.request("ask");
  await new Promise((resolve) => setImmediate(resolve));
  const disposed = env.controller.dispose();
  release();
  await Promise.all([started, disposed]);
  await env.controller.request("late");
  assert.deepEqual(env.events, ["notify", "start", "stop"]);
});

test("clarification wrappers clean up on both completion and failure without waiting for native delivery", async () => {
  const env = harness();
  assert.equal(await withHumanInteractionAttention(env.controller, "loop:ask", async () => "answer"), "answer");
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start", "stop"]);
  await assert.rejects(withHumanInteractionAttention(env.controller, "loop:failed", async () => {
    throw new Error("任务已停止");
  }), /任务已停止/);
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "start", "stop", "notify", "start", "stop"]);
  assert.equal(await withHumanInteractionAttention(undefined, "ask", async () => "answer"), "answer");
});

test("background task completion notifies once and retains attention until focus returns", async () => {
  const env = harness();
  await env.controller.taskCompleted("vibe:run");
  await env.controller.taskCompleted("vibe:run");
  await env.controller.complete("unrelated-interaction");
  assert.deepEqual(env.events, ["completed-notify", "start"]);
  env.state.focused = true;
  await env.controller.refresh();
  env.state.focused = false;
  await env.controller.refresh();
  await env.controller.taskCompleted("vibe:run");
  assert.deepEqual(env.events, ["completed-notify", "start", "stop"]);
  await env.controller.dispose();
});

test("foreground and remote completions are never replayed on later focus loss", async () => {
  for (const condition of ["foreground", "remote"] as const) {
    const env = harness();
    env.state.focused = condition === "foreground";
    env.state.local = condition !== "remote";
    await env.controller.taskCompleted("run");
    env.state.focused = false;
    env.state.local = true;
    await env.controller.refresh();
    await env.controller.taskCompleted("run");
    assert.deepEqual(env.events, []);
    await env.controller.dispose();
    await env.controller.taskCompleted("late");
    assert.deepEqual(env.events, []);
  }
});

test("completion preferences are independent of interaction preferences and each other", async () => {
  const env = harness();
  env.settings.notifications = false;
  env.settings.windowAttention = false;
  env.settings.taskCompletion.notifications = false;
  await env.controller.request("ask");
  await env.controller.taskCompleted("run");
  assert.deepEqual(env.events, ["start"]);
  env.settings.taskCompletion.notifications = true;
  env.settings.taskCompletion.windowAttention = false;
  await env.controller.refresh();
  assert.deepEqual(env.events, ["start", "completed-notify", "stop"]);
  env.settings.notifications = true;
  env.settings.windowAttention = true;
  await env.controller.refresh();
  assert.deepEqual(env.events, ["start", "completed-notify", "stop", "notify", "start"]);
  await env.controller.complete("ask");
  assert.equal(env.events[env.events.length - 1], "stop");
  await env.controller.dispose();
});

test("completion and interaction requests share attention without clearing each other", async () => {
  const env = harness();
  await Promise.all([
    env.controller.request("ask"),
    env.controller.taskCompleted("first"),
    env.controller.taskCompleted("second"),
  ]);
  assert.deepEqual(env.events, ["notify", "completed-notify", "start"]);
  env.settings.taskCompletion.windowAttention = false;
  await env.controller.refresh();
  assert.equal(env.events.length, 3);
  env.settings.taskCompletion.windowAttention = true;
  await env.controller.complete("ask");
  assert.equal(env.events.length, 3);
  env.state.focused = true;
  await env.controller.refresh();
  assert.deepEqual(env.events, ["notify", "completed-notify", "start", "stop"]);
  env.state.focused = false;
  await env.controller.refresh();
  assert.equal(env.events.length, 4);
});

test("slow completion delivery does not block focus cleanup", async (context) => {
  const env = harness();
  let release = (): void => undefined;
  env.transport.notify = async () => {
    env.events.push("completed-notify");
    await new Promise<void>((resolve) => { release = resolve; });
  };
  context.after(() => release());
  const sending = env.controller.taskCompleted("run");
  await new Promise((resolve) => setImmediate(resolve));
  env.state.focused = true;
  await env.controller.refresh();
  assert.deepEqual(env.events, ["completed-notify", "start", "stop"]);
  release();
  await sending;
});

test("completion attention failures are contained and disposal removes late attention", async () => {
  const env = harness();
  let release = (): void => undefined;
  env.transport.notify = async () => { throw new Error("拒绝通知"); };
  env.transport.startAttention = async () => {
    env.events.push("start");
    await new Promise<void>((resolve) => { release = resolve; });
  };
  const sending = env.controller.taskCompleted("run");
  await new Promise((resolve) => setImmediate(resolve));
  const disposing = env.controller.dispose();
  release();
  await Promise.all([sending, disposing]);
  assert.deepEqual(env.errors, ["notification"]);
  assert.deepEqual(env.events, ["start", "stop"]);
});
