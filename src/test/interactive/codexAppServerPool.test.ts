import * as assert from "node:assert/strict";
import { test } from "node:test";

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  countAliveCodexAppServerConnections,
  countAliveConnections,
  buildCodexAppServerConnectionKey,
  acquireCodexAppServer,
} = require("../../interactive/codexAppServerPool") as typeof import("../../interactive/codexAppServerPool");

test("real protocol subprocesses share an identity but isolate changed configuration while another tab retains the old process", { timeout: 10000 }, async () => {
  const source = `const readline = require("readline");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { pid: process.pid } }) + "\\n");
});`;
  const spec = { command: process.execPath, args: ["-e", source], env: process.env, codexHomeDir: "synthetic-codex-home", initializeParams: {} };
  const listener = (id: string) => ({
    id, isActive: () => false, handleNotification: () => undefined,
    handleServerRequest: () => null, onClosed: () => undefined,
  });
  const beforeKey = buildCodexAppServerConnectionKey({ ...spec, modelProvider: "gateway", configFingerprint: "before" });
  const afterKey = buildCodexAppServerConnectionKey({ ...spec, modelProvider: "gateway", configFingerprint: "after" });
  const before = acquireCodexAppServer({ ...spec, key: beforeKey }, listener("tab-a"));
  const retained = acquireCodexAppServer({ ...spec, key: beforeKey }, listener("tab-b"));
  const after = acquireCodexAppServer({ ...spec, key: afterKey }, listener("tab-a-new"));
  try {
    await Promise.all([before.whenReady(), after.whenReady()]);
    assert.equal(before, retained);
    assert.notEqual(before, after);
    const oldProcess = await before.request<{ pid: number }>("tab-b", "test/pid", {});
    const newProcess = await after.request<{ pid: number }>("tab-a-new", "test/pid", {});
    assert.notEqual(oldProcess.pid, newProcess.pid);
    before.release("tab-a");
    assert.equal(before.isAlive(), true);
    assert.deepEqual(await retained.request("tab-b", "test/pid", {}), oldProcess);
    assert.equal(after.isAlive(), true);
  } finally {
    before.release("tab-a");
    before.release("tab-b");
    after.release("tab-a-new");
  }
});

test("the same provider uses distinct pooled processes after config or auth changes", () => {
  const input = { command: "codex", args: [], cwd: "/workspace", codexHomeDir: "/home/codex", modelProvider: "gateway" };
  const first = buildCodexAppServerConnectionKey({ ...input, configFingerprint: "config-and-auth-before" });
  assert.equal(buildCodexAppServerConnectionKey({ ...input, configFingerprint: "config-and-auth-before" }), first);
  assert.notEqual(buildCodexAppServerConnectionKey({ ...input, configFingerprint: "config-and-auth-after" }), first);
});

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
