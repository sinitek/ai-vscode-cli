import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { DepartmentExecutionReceiptStore } from "../../runtime/departmentexecutionreceiptstore";
import { departmentExecutionOwnerEndpoint } from "../../runtime/departmentexecutionowner";
import { CLEANUP_PARTS, type DepartmentExecutionIdentity } from "../../runtime/departmentexecutionidentity";

for (const mode of ["valid", "wrong-policy", "wrong-identity", "forged"] as const) test(`original client retains only strict socket completion: ${mode}`, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "r231-client-"));
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    role: "leader", cli: "codex", ownerId: "owner", executionId: "execution", generation: 1, session: { state: "bound", id: "native" },
    configFingerprint: "a".repeat(64), profileFingerprint: "b".repeat(64) };
  const requirements = Object.fromEntries(CLEANUP_PARTS.map((p) => [p, true])) as Record<typeof CLEANUP_PARTS[number], boolean>;
  const receipt = new DepartmentExecutionReceiptStore(directory).makeReceipt(identity, 1,
    Object.fromEntries(CLEANUP_PARTS.map((p) => [p, { status: "confirmed", evidence: "controlled-original-owner" }])) as any, requirements);
  assert.ok(receipt);
  const client = new DepartmentExecutionOwnerClient(directory);
  let requests = 0;
  const server = net.createServer((socket) => {
    socket.once("data", (data) => {
      const request = JSON.parse(data.toString()); requests++;
      socket.end(JSON.stringify({ version: 1, requestId: request.requestId,
        result: { status: "cleaned", identity: mode === "wrong-identity" ? { ...identity, generation: 2 } : identity,
          receipt: mode === "forged" ? { ...receipt, extra: true } : receipt } }) + "\n");
    });
  });
  await new Promise<void>((r) => server.listen(departmentExecutionOwnerEndpoint(directory), r));
  t.after(async () => { if (server.listening) await new Promise<void>((r) => server.close(() => r())); fs.rmSync(directory, { recursive: true, force: true }); });
  if (mode === "valid") {
    const result = await client.waitForCleanup(identity, requirements); result.identity.generation = 999;
    await new Promise<void>((r) => server.close(() => r()));
    assert.deepEqual(await client.waitForCleanup(identity, requirements), receipt, "returned objects cannot poison private cache");
    assert.equal(requests, 1);
    await assert.rejects(new DepartmentExecutionOwnerClient(directory).waitForCleanup(identity, requirements), /unknown/);
    await assert.rejects(client.waitForCleanup(identity, { ...requirements, tab: false }), /policy-conflict/);
    await assert.rejects(client.waitForCleanup({ ...identity, generation: 2 }, requirements), /unknown/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(client.waitForCleanup(identity, requirements, controller.signal), /cancelled/);
  } else {
    await assert.rejects(client.waitForCleanup(identity, mode === "wrong-policy" ? { ...requirements, tab: false } : requirements));
    await new Promise<void>((r) => server.close(() => r()));
    await assert.rejects(client.waitForCleanup(identity, requirements), /unknown/, "invalid reply never populates cache");
  }
});

for (const mode of ["valid", "wrong-identity", "extra-receipt", "extra-reason", "invalid-claim", "unknown", "conflict", "cancel"] as const) {
  test(`finalizing client validation and cancellation: ${mode}`, async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "r372-client-"));
    const identity: DepartmentExecutionIdentity = { version: 1, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
      role: "leader", cli: "codex", ownerId: "owner", executionId: "execution", generation: 1, session: { state: "bound", id: "native" },
      configFingerprint: "a".repeat(64), profileFingerprint: "b".repeat(64) };
    const requirements = Object.fromEntries(CLEANUP_PARTS.map((part) => [part, true])) as Record<typeof CLEANUP_PARTS[number], boolean>;
    const receipt = new DepartmentExecutionReceiptStore(directory).makeReceipt(identity, 1,
      Object.fromEntries(CLEANUP_PARTS.map((part) => [part, { status: "confirmed", evidence: "controlled-original-owner" }])) as any, requirements);
    let requests = 0, active = 0, maximumActive = 0, closed!: () => void;
    let round = new Promise<void>((resolve) => { closed = resolve; });
    const server = net.createServer((socket) => {
      active++; maximumActive = Math.max(active, maximumActive);
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()); requests++;
        let result: Record<string, unknown> = { status: "finalizing", identity, claimGeneration: 1 };
        if (mode === "wrong-identity") result.identity = { ...identity, executionId: "other" };
        if (mode === "extra-receipt") result.receipt = receipt;
        if (mode === "extra-reason") result.reason = "not-part-of-finalizing";
        if (mode === "invalid-claim") result.claimGeneration = 0;
        if (requests > 1 && mode === "valid") result = { status: "cleaned", identity, receipt };
        if (requests > 1 && (mode === "unknown" || mode === "conflict")) result = { status: mode, identity, reason: "cleanup-failed-or-owner-lost" };
        socket.end(JSON.stringify({ version: 1, requestId: request.requestId, result }) + "\n");
      });
      socket.once("close", () => { active--; closed(); });
    });
    await new Promise<void>((resolve) => server.listen(departmentExecutionOwnerEndpoint(directory), resolve));
    t.after(async () => { if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); });
    Reflect.apply(t.mock.timers.enable, t.mock.timers, [{ apis: ["setTimeout"] }]);
    const controller = new AbortController(), client = new DepartmentExecutionOwnerClient(directory);
    let settled = false;
    const waiting = client.waitForCleanup(identity, requirements, controller.signal);
    void waiting.then(() => { settled = true; }, () => { settled = true; });
    const rejected = ["valid", "cancel", "unknown", "conflict"].includes(mode) ? undefined
      : assert.rejects(waiting, /cleanup-observation-unknown:invalid-owner-response/);
    await round;
    if (rejected) { await rejected; assert.equal(requests, 1); }
    else {
      assert.equal(settled, false);
      if (mode === "cancel") {
        controller.abort(); await assert.rejects(waiting, /cancelled/);
        t.mock.timers.tick(60_000); await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(requests, 1);
        assert.equal((await client.observeExecution(identity)).status, "finalizing", "cancel only removed this waiter");
      } else {
        const failure = mode === "valid" ? undefined : assert.rejects(waiting, new RegExp("cleanup-observation-" + mode));
        t.mock.timers.tick(249); await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(requests, 1);
        round = new Promise<void>((resolve) => { closed = resolve; }); t.mock.timers.tick(1); await round;
        if (failure) await failure; else assert.deepEqual(await waiting, receipt);
        assert.equal(requests, 2);
      }
    }
    assert.equal(maximumActive, 1);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (mode !== "valid") await assert.rejects(client.waitForCleanup(identity, requirements), /unknown/, "finalizing cannot populate completion cache");
  });
}
