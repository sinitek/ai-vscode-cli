import * as assert from "node:assert/strict";
import { test } from "node:test";

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  countAliveCodexAppServerConnections,
  countAliveConnections,
} = require("../../interactive/codexAppServerPool") as typeof import("../../interactive/codexAppServerPool");

test("counts only connections whose process is still alive", () => {
  assert.equal(countAliveConnections([]), 0);
  assert.equal(countAliveConnections([
    { isAlive: () => false },
    { isAlive: () => true },
    { isAlive: () => true },
  ]), 2);
  assert.equal(typeof countAliveCodexAppServerConnections(), "number");
  assert.ok(countAliveCodexAppServerConnections() >= 0);
});

test("does not hide a connection liveness failure", () => {
  assert.throws(() => countAliveConnections([
    { isAlive: () => { throw new Error("liveness failed"); } },
  ]), /liveness failed/);
});
