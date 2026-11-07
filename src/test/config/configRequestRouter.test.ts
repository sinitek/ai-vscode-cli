import assert = require("node:assert/strict");
import test = require("node:test");
import { CONFIG_ACTIONS, type ConfigRequestMessage, type ConfigResponseMessage } from "../../webview/configProtocol";
import { routeConfigRequest, type ConfigRequestHandlers } from "../../webview/configRequestRouter";

function response(): ConfigResponseMessage {
  return { type: "config:response", requestId: "response-id", success: true };
}

function request(action: unknown, requestId = "request-id"): ConfigRequestMessage {
  return { type: "config:request", requestId, action } as ConfigRequestMessage;
}

function registry(handler: (message: ConfigRequestMessage, result: ConfigResponseMessage) => void | Promise<void>) {
  return Object.fromEntries(CONFIG_ACTIONS.map((action) => [action, handler])) as ConfigRequestHandlers;
}

for (const action of CONFIG_ACTIONS) {
  test(`router invokes ${action} once with original request and response`, async () => {
    const message = request(action);
    const result = response();
    let calls = 0;
    const handlers = registry((received, target) => {
      calls += 1;
      assert.strictEqual(received, message);
      assert.strictEqual(target, result);
      target.data = action;
    });
    assert.equal(await routeConfigRequest(handlers, message, result), true);
    assert.equal(calls, 1);
    assert.deepEqual(result, { ...response(), data: action });
  });
}

test("router awaits the handler without sharing or serializing response objects", async () => {
  let finishFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { finishFirst = resolve; });
  const handlers = registry(async (message, result) => {
    if (message.requestId === "first") await firstGate;
    result.data = message.requestId;
  });
  const first = response();
  const second = response();
  let firstComplete = false;
  const pending = routeConfigRequest(handlers, request("getList", "first"), first)
    .then((matched) => { firstComplete = true; return matched; });
  assert.equal(await routeConfigRequest(handlers, request("getOrder", "second"), second), true);
  assert.equal(firstComplete, false);
  assert.equal(first.data, undefined);
  assert.equal(second.data, "second");
  finishFirst();
  assert.equal(await pending, true);
  assert.equal(first.data, "first");
});

for (const asynchronous of [false, true]) {
  test(`router propagates ${asynchronous ? "asynchronous" : "synchronous"} errors and retains data`, async () => {
    const failure = new Error("handler failed");
    const result = response();
    const handlers = registry((_message, target) => {
      target.data = "assigned";
      if (asynchronous) return Promise.reject(failure);
      throw failure;
    });
    await assert.rejects(routeConfigRequest(handlers, request("save"), result), (error) => error === failure);
    assert.deepEqual(result, { ...response(), data: "assigned" });
  });
}

test("router rejects unknown, non-string and prototype keys without coercing objects", async () => {
  const handlers = registry(() => assert.fail("unmatched action must not execute"));
  const malicious = {
    [Symbol.toPrimitive]() { assert.fail("action must not be coerced"); },
    toString() { assert.fail("action must not be stringified"); },
  };
  for (const action of ["unknown", "", "toString", "constructor", "__proto__", "hasOwnProperty", null, undefined, 1, true, Symbol("save"), malicious]) {
    const result = response();
    assert.equal(await routeConfigRequest(handlers, request(action), result), false);
    assert.deepEqual(result, response());
  }
});

test("router does not execute a known action inherited from the registry prototype", async () => {
  const handlers = Object.create(registry(() => assert.fail("inherited action must not execute"))) as ConfigRequestHandlers;
  assert.equal(await routeConfigRequest(handlers, request("getList"), response()), false);
});
