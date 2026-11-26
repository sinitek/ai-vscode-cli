import assert = require("node:assert/strict");
import test = require("node:test");
import { managedZcodeFixture as fixture } from "./zcodeProcessFixture";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
const { createZcodeInteractiveTurnStrategy } = require("../../extensionHost/interactiveTurnZcode") as typeof import("../../extensionHost/interactiveTurnZcode");

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("actual manager replacement waits for old ZCode exit, close and EOF before resuming", async () => {
  const f = fixture();
  let running: Promise<unknown> | undefined;
  try {
    await f.manager.getOrCreateZcodeRunner(f.options("before")).start();
    running = createZcodeInteractiveTurnStrategy().runAttempt(f.port("after").value);
    void running.catch(() => {});
    await tick();
    assert.equal(f.children.length, 1, "replacement must not spawn while the old process owns the session");
    const old = f.children[0];
    assert.equal(old.requests.filter((r) => r.method === "session/close").length, 1);
    old.emit("exit", 0);
    await tick();
    assert.equal(f.children.length, 1, "exit alone is not release");
    old.emit("close", 0);
    await tick();
    assert.equal(f.children.length, 1, "close without stdout EOF is not release");
    old.stdout.end();
    old.stderr.end();
    await running;
    assert.equal(f.children.length, 2);
    assert.equal(f.children[1].requests[0].method, "session/resume");
  } finally {
    await f.cleanup();
    await running;
  }
});

for (const disposal of ["disposeIfMatches", "disposeForCli", "disposeAll"] as const) {
  test(`${disposal} retains release after deletion and lets other CLI/sessions proceed`, async () => {
    const f = fixture();
    let running: Promise<unknown> | undefined;
    try {
      await f.manager.getOrCreateZcodeRunner(f.options("before")).start();
      if (disposal === "disposeIfMatches") f.manager.disposeIfMatches("zcode", "ui-session");
      else if (disposal === "disposeForCli") f.manager.disposeForCli("zcode");
      else f.manager.disposeAll();
      running = createZcodeInteractiveTurnStrategy().runAttempt(f.port("after").value);
      void running.catch(() => {});
      await createZcodeInteractiveTurnStrategy().runAttempt(f.port("other", "other-session").value);
      await f.manager.waitForPendingDisposal("codex", "ui-session");
      assert.equal(f.children.length, 2, "only the unrelated session may spawn");
      f.release(f.children[0]);
      await running;
      assert.equal(f.children.length, 3);
    } finally {
      await f.cleanup();
      await running;
    }
  });
}

for (const firstToFinish of [0, 1]) {
  test(`consecutive replacements retain all predecessors when predecessor ${firstToFinish} finishes first`, async (context) => {
    const f = fixture();
    const runs: Promise<unknown>[] = [];
    try {
      const first = f.manager.getOrCreateZcodeRunner(f.options("first"));
      await first.start();
      // A second live predecessor is registered by an existing owner. Its disposal
      // must join the first pending release rather than overwrite it.
      const second = new (require("../../interactive/zcodeRunner").ZcodeInteractiveRunner)({ cwd: process.cwd() });
      await second.start();
      f.manager.setRunner("zcode", "ui-session", second, "off", "coding", null, { configFingerprint: "second" });
      const getOrCreate = context.mock.method(f.manager, "getOrCreateZcodeRunner");
      const superseded = f.port("third").value;
      const current = f.port("fourth").value;
      const staleSessionUpdate = context.mock.method(superseded, "updateSessionForNewRun");
      const stalePanelMessage = context.mock.method(superseded, "sendPanelMessage");
      const staleSettle = context.mock.method(superseded, "settleInteractiveAttempt");
      const currentPanelMessage = context.mock.method(current, "sendPanelMessage");
      const strategy = createZcodeInteractiveTurnStrategy();
      const staleRun = strategy.runAttempt(superseded);
      const currentRun = strategy.runAttempt(current);
      runs.push(staleRun, currentRun);
      runs.forEach((run) => { void run.catch(() => {}); });
      const candidate = getOrCreate.mock.calls[0].result!;
      const replacement = getOrCreate.mock.calls[1].result!;
      assert.notEqual(candidate, replacement);
      assert.equal(f.manager.hasZcodeRunner("ui-session", replacement), true);
      await tick();
      assert.equal(f.children.length, 2);
      // Neither completion order may drop the other predecessor or the newer record.
      f.release(f.children[firstToFinish]);
      await tick();
      assert.equal(f.children.length, 2);
      const last = f.children[1 - firstToFinish];
      last.emit("close", 0);
      last.stdout.end();
      await tick();
      assert.equal(f.children.length, 2, "close and EOF still require exit");
      last.emit("exit", 0);
      assert.equal(superseded.isCurrentRunActive(), true, "only the candidate runner is superseded");
      await assert.rejects(staleRun, {
        code: "RUNNER_DISPOSED",
        message: "ZCode 启动期间，当前运行已失效或运行器已被替换。",
      });
      assert.equal(await currentRun, "return");
      assert.equal(f.children.length, 3, "only the final registered runner resumes");
      assert.equal(f.children[2].requests[0].method, "session/resume");
      assert.equal(f.children[2].requests.filter(({ method }) => method === "session/send").length, 1);
      assert.equal(f.children[2].requests.some(({ method }) => method === "session/close"), false);
      assert.equal(f.manager.hasZcodeRunner("ui-session", first), false);
      assert.equal(f.manager.hasZcodeRunner("ui-session", candidate), false);
      assert.equal(f.manager.hasZcodeRunner("ui-session", replacement), true);
      assert.equal(staleSessionUpdate.mock.callCount(), 0);
      assert.equal(stalePanelMessage.mock.callCount(), 0);
      assert.equal(staleSettle.mock.callCount(), 0);
      assert.ok(currentPanelMessage.mock.calls.some(({ arguments: [message] }) => message.type === "contextTokenUsage"));
    } finally {
      await f.cleanup();
      await Promise.allSettled(runs);
    }
  });
}

for (const cancellation of ["stop", "inactive"] as const) {
  test(`${cancellation} during release ends silently without a late ZCode start`, async (context) => {
    const f = fixture();
    let running: Promise<unknown> | undefined;
    try {
      await f.manager.getOrCreateZcodeRunner(f.options("before")).start();
      const port = f.port("after");
      const updateSession = context.mock.method(port.value, "updateSessionForNewRun");
      const panelMessage = context.mock.method(port.value, "sendPanelMessage");
      const settle = context.mock.method(port.value, "settleInteractiveAttempt");
      running = createZcodeInteractiveTurnStrategy().runAttempt(port.value);
      void running.catch(() => {});
      await tick();
      if (cancellation === "stop") {
        port.stop();
        assert.equal(await running, "return"); // cancellation settles even while the old process is held
      } else port.deactivate();
      f.release(f.children[0]);
      assert.equal(await running, "return");
      assert.equal(f.children.length, 1);
      assert.equal(updateSession.mock.callCount(), 0);
      assert.equal(panelMessage.mock.callCount(), 0);
      assert.equal(settle.mock.callCount(), 0);
    } finally {
      await f.cleanup();
      await running;
    }
  });
}

test("manager consumes a release rejection and all dependent starts receive it", async () => {
  const f = fixture();
  try {
    const old = f.manager.getOrCreateZcodeRunner(f.options("before"));
    const failure = new Error("release failed");
    // Inject only the release failure; start/manager/turn strategy remain real.
    old.dispose = () => Promise.reject(failure);
    f.manager.disposeIfMatches("zcode", "ui-session");
    await tick(); // node:test would report an unhandled rejection here
    for (const fingerprint of ["after", "later"]) {
      await assert.rejects(createZcodeInteractiveTurnStrategy().runAttempt(f.port(fingerprint).value), (e) => e === failure);
    }
    assert.equal(f.children.length, 0);
  } finally {
    await f.cleanup();
  }
});

for (const cancellation of ["stop", "inactive"] as const) {
  test(`release rejection after ${cancellation} is silent for the run but remains in the manager`, async () => {
    const f = fixture();
    try {
      const old = f.manager.getOrCreateZcodeRunner(f.options("before"));
      let reject!: (error: Error) => void;
      old.dispose = () => new Promise<void>((_resolve, fail) => { reject = fail; });
      const port = f.port("after");
      const running = createZcodeInteractiveTurnStrategy().runAttempt(port.value);
      if (cancellation === "stop") {
        port.stop();
        assert.equal(await running, "return");
      } else port.deactivate();
      const failure = new Error("late release failure");
      reject(failure);
      assert.equal(await running, "return");
      await tick();
      await assert.rejects(f.manager.waitForPendingDisposal("zcode", "ui-session"), (e) => e === failure);
      assert.equal(f.children.length, 0);
    } finally {
      await f.cleanup();
    }
  });
}
