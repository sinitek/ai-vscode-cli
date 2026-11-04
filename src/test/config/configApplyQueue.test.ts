import test = require("node:test");
import assert = require("node:assert/strict");
import { createConfigApplyQueue } from "../../config/configApplyQueue";

test("execution verification cannot supersede an explicit profile switch", async () => {
  const queue = createConfigApplyQueue<"codex">();
  const write = createDeferred();
  const committed: string[] = [];
  const switching = queue.request("codex", {
    apply: () => write.promise,
    commit: () => { committed.push("user-choice"); },
  });
  const execution = await queue.requestIfIdle("codex", {
    apply: async () => { assert.fail("任务不得覆盖用户切换"); },
    commit: () => { assert.fail("任务不得提交激活配置"); },
  });
  assert.equal(execution, "superseded");
  write.resolve();
  assert.equal(await switching, "applied");
  assert.deepEqual(committed, ["user-choice"]);
  assert.equal(await queue.requestIfIdle("codex", { apply: async () => undefined, commit: () => undefined }), "applied");
});

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("applies only the latest pending config and commits it once", async () => {
  const queue = createConfigApplyQueue<"codex">();
  const first = createDeferred();
  const applied: string[] = [];
  const committed: string[] = [];

  const firstResult = queue.request("codex", {
    apply: async () => {
      applied.push("first");
      await first.promise;
    },
    commit: () => {
      committed.push("first");
    },
  });
  const secondResult = queue.request("codex", {
    apply: async () => {
      applied.push("second");
    },
    commit: () => {
      committed.push("second");
    },
  });

  first.resolve();
  assert.equal(await firstResult, "superseded");
  assert.equal(await secondResult, "applied");

  assert.deepEqual(applied, ["first", "second"]);
  assert.deepEqual(committed, ["second"]);
});

test("continues with a newer config after an older apply fails", async () => {
  const queue = createConfigApplyQueue<"opencode">();
  const first = createDeferred();
  const applied: string[] = [];
  const committed: string[] = [];

  const firstResult = queue.request("opencode", {
    apply: async () => {
      applied.push("first");
      await first.promise;
      throw new Error("first failed");
    },
    commit: () => {
      committed.push("first");
    },
  });
  const secondResult = queue.request("opencode", {
    apply: async () => {
      applied.push("second");
    },
    commit: () => {
      committed.push("second");
    },
  });

  first.resolve();
  assert.equal(await firstResult, "superseded");
  assert.equal(await secondResult, "applied");

  assert.deepEqual(applied, ["first", "second"]);
  assert.deepEqual(committed, ["second"]);
});

test("skips pending configs superseded before they start", async () => {
  const queue = createConfigApplyQueue<"codex">();
  const first = createDeferred();
  const applied: string[] = [];
  const committed: string[] = [];

  const firstResult = queue.request("codex", {
    apply: async () => {
      applied.push("first");
      await first.promise;
    },
    commit: () => {
      committed.push("first");
    },
  });
  const secondResult = queue.request("codex", {
    apply: async () => {
      applied.push("second");
    },
    commit: () => {
      committed.push("second");
    },
  });
  const thirdResult = queue.request("codex", {
    apply: async () => {
      applied.push("third");
    },
    commit: () => {
      committed.push("third");
    },
  });

  assert.equal(await secondResult, "superseded");
  first.resolve();
  assert.equal(await firstResult, "superseded");
  assert.equal(await thirdResult, "applied");

  assert.deepEqual(applied, ["first", "third"]);
  assert.deepEqual(committed, ["third"]);
});

test("waitForIdle reports the final active selection", async () => {
  const queue = createConfigApplyQueue<"claude">();
  const deferred = createDeferred();
  let activeConfig = "old";

  const pending = queue.request("claude", {
    apply: async () => {
      await deferred.promise;
      activeConfig = "new";
    },
    commit: () => undefined,
  });

  const ready = queue.waitForIdle("claude");
  deferred.resolve();
  await pending;

  assert.equal(await ready, true);
  assert.equal(activeConfig, "new");
});
