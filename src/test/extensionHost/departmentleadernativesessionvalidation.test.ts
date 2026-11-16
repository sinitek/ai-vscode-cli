import test = require("node:test");
import assert = require("node:assert/strict");
import { createDepartmentLeaderNativeSessionValidator } from "../../extensionHost/departmentleadernativesessionvalidation";
import type { LoopSubtaskSession } from "../../loopSubtaskSession";

function fixture(localSessionId: string | null | undefined = "local_leader", nativeSessionId = "ses_leader") {
  let saved: LoopSubtaskSession | undefined = { cli: "opencode", sessionId: nativeSessionId, configId: "profile" };
  let reads = 0;
  let readError: Error | undefined;
  // There is deliberately no mapping writer: task/Owner bindings are the source.
  const createCallback = () => createDepartmentLeaderNativeSessionValidator({
    localSessionId, configId: "profile",
    readExecutionSession: () => {
      reads++;
      if (readError) throw readError;
      return saved;
    },
  });
  return {
    createCallback, reads: () => reads,
    save(value: LoopSubtaskSession | undefined) { saved = value; },
    failRead(value: Error | undefined) { readError = value; },
  };
}

test("repeated native observations only validate the durable binding on every callback", () => {
  const f = fixture(), observe = f.createCallback();
  for (let chunk = 0; chunk < 100; chunk++) assert.equal(observe("ses_leader"), undefined);
  assert.equal(f.reads(), 100);
});

test("a later conflicting output ID is rejected without replacing the observed ID", () => {
  const f = fixture(), observe = f.createCallback();
  observe("ses_leader");
  assert.throws(() => observe("ses_other"), /持久绑定冲突/);
  observe("ses_leader");
  assert.equal(f.reads(), 3);
});

test("every observation rejects missing binding, changed CLI, native session or config", () => {
  const invalid: Array<LoopSubtaskSession | undefined> = [
    undefined,
    { cli: "codex", sessionId: "ses_leader", configId: "profile" },
    { cli: "opencode", sessionId: "ses_other", configId: "profile" },
    { cli: "opencode", sessionId: "ses_leader", configId: "other" },
    { cli: "opencode", sessionId: "ses_leader", configId: null },
  ];
  for (const changed of invalid) {
    const f = fixture(), observe = f.createCallback();
    observe("ses_leader");
    f.save(changed);
    assert.throws(() => observe("ses_leader"), /持久绑定冲突/);
    assert.equal(f.reads(), 2);
  }
});

test("a changed persisted ID cannot replace the observed ID within the same invocation", () => {
  const f = fixture(), observe = f.createCallback();
  observe("ses_leader");
  f.save({ cli: "opencode", sessionId: "ses_other", configId: "profile" });
  assert.throws(() => observe("ses_other"), /持久绑定冲突/);
  assert.equal(f.reads(), 2);
});

test("initial read failure propagates unchanged and does not pin an unverified ID", () => {
  const f = fixture(), observe = f.createCallback(), failure = new Error("controlled-read-failure");
  f.failRead(failure);
  assert.throws(() => observe("ses_leader"), (error: unknown) => error === failure);
  f.failRead(undefined);
  f.save({ cli: "opencode", sessionId: "ses_verified", configId: "profile" });
  observe("ses_verified");
  assert.equal(f.reads(), 2);
});

test("read failure after a successful observation cannot bypass validation or clear the pinned ID", () => {
  const f = fixture(), observe = f.createCallback(), failure = new Error("controlled-read-failure");
  observe("ses_leader");
  f.failRead(failure);
  assert.throws(() => observe("ses_leader"), (error: unknown) => error === failure);
  f.failRead(undefined);
  f.save({ cli: "opencode", sessionId: "ses_other", configId: "profile" });
  assert.throws(() => observe("ses_other"), /持久绑定冲突/);
  f.save({ cli: "opencode", sessionId: "ses_leader", configId: "profile" });
  observe("ses_leader");
  assert.equal(f.reads(), 4);
});

test("invocations, tasks and local tabs keep independent observed-ID state", () => {
  const a = fixture(), b = fixture("local_other_tab", "ses_other_task");
  const first = a.createCallback(), second = a.createCallback(), other = b.createCallback();
  first("ses_leader");
  other("ses_other_task");
  a.save({ cli: "opencode", sessionId: "ses_next_invocation", configId: "profile" });
  second("ses_next_invocation");
  assert.throws(() => first("ses_next_invocation"), /持久绑定冲突/);
  assert.throws(() => other("ses_next_invocation"), /持久绑定冲突/);
  second("ses_next_invocation");
  other("ses_other_task");
  assert.equal(a.reads(), 4);
  assert.equal(b.reads(), 3);
});

test("a missing fixed local transcript key is rejected even with a valid native binding", () => {
  for (const localSessionId of [null, ""]) {
    const f = fixture(localSessionId);
    assert.throws(() => f.createCallback()("ses_leader"), /缺少固定本地会话/);
    assert.equal(f.reads(), 1);
  }
});
