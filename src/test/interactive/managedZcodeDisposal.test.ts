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
  test(`consecutive replacements retain all predecessors when predecessor ${firstToFinish} finishes first`, async () => {
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
      runs.push(createZcodeInteractiveTurnStrategy().runAttempt(f.port("third").value));
      runs.push(createZcodeInteractiveTurnStrategy().runAttempt(f.port("fourth").value));
      runs.forEach((run) => { void run.catch(() => {}); });
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
      await Promise.all(runs);
      assert.equal(f.children.length, 3, "only the final registered runner resumes");
      assert.equal(f.manager.hasZcodeRunner("ui-session", first), false);
    } finally {
      await f.cleanup();
      await Promise.all(runs);
    }
  });
}

for (const cancellation of ["stop", "inactive"] as const) {
  test(`${cancellation} during release cannot cause a late ZCode start`, async () => {
    const f = fixture();
    let running: Promise<unknown> | undefined;
    try {
      await f.manager.getOrCreateZcodeRunner(f.options("before")).start();
      const port = f.port("after");
      running = createZcodeInteractiveTurnStrategy().runAttempt(port.value);
      await tick();
      if (cancellation === "stop") {
        port.stop();
        await running; // cancellation settles even while the old process is held
      } else port.deactivate();
      f.release(f.children[0]);
      await running;
      assert.equal(f.children.length, 1);
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

test("release rejection after the waiting turn stops is still consumed", async () => {
  const f = fixture();
  try {
    const old = f.manager.getOrCreateZcodeRunner(f.options("before"));
    let reject!: (error: Error) => void;
    old.dispose = () => new Promise<void>((_resolve, fail) => { reject = fail; });
    const port = f.port("after");
    const running = createZcodeInteractiveTurnStrategy().runAttempt(port.value);
    port.stop();
    await running;
    reject(new Error("late release failure"));
    await tick();
    await assert.rejects(f.manager.waitForPendingDisposal("zcode", "ui-session"), /late release failure/);
    assert.equal(f.children.length, 0);
  } finally {
    await f.cleanup();
  }
});
