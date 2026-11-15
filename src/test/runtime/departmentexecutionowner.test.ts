import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync, fork, spawn, type ChildProcess } from "child_process";
import * as net from "net";
import { createHash, randomUUID } from "crypto";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { departmentExecutionOwnerEndpoint } from "../../runtime/departmentexecutionowner";
import { isDepartmentExecutionIdentity, type DepartmentExecutionIdentity } from "../../runtime/departmentexecutionidentity";
import { DepartmentExecutionReceiptStore } from "../../runtime/departmentexecutionreceiptstore";

const worker = path.join(__dirname, "fixtures", "departmentexecutionownerworker.js");
function identity(options: { ownerId?: string; executionId?: string; generation?: number; session?: DepartmentExecutionIdentity["session"];
  workspace?: string; rootTaskId?: string; leaderTaskId?: string; moduleId?: string; subtaskId?: string } = {}): DepartmentExecutionIdentity {
  return {
    version: 1, workspace: options.workspace ?? "fixture-workspace", rootTaskId: options.rootTaskId ?? "root-1",
    leaderTaskId: options.leaderTaskId ?? "leader-1", moduleId: options.moduleId ?? "module-1",
    role: "employee", subtaskId: options.subtaskId ?? "subtask-1", attemptId: "attempt-1", generation: options.generation ?? 1, cli: "codex",
    configFingerprint: createHash("sha256").update("fixture-config").digest("hex"),
    profileFingerprint: createHash("sha256").update("fixture-profile").digest("hex"),
    session: options.session ?? { state: "unbound" }, ownerId: options.ownerId ?? "fixture-owner",
    executionId: options.executionId ?? randomUUID(),
  };
}

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "department-owner-test-"));
}

const observerRequirements = { processTerminal: true, turnTerminal: false, streams: true, runner: true,
  executionRoot: true, links: true, temp: true, tab: true };

test("cleanup observer backs off serial live/finalizing IPC to five seconds without an execution deadline", async (t) => {
  const directory = tempDirectory(), value = identity({ session: { state: "bound", id: "bound-session" } });
  const confirmed = { status: "confirmed" as const, evidence: "fixture-confirmed" };
  const receipt = new DepartmentExecutionReceiptStore(directory).makeReceipt(value, 1,
    { processTerminal: confirmed, turnTerminal: { status: "not-applicable", reason: "process-only" }, streams: confirmed,
      runner: confirmed, executionRoot: confirmed, links: confirmed, temp: confirmed, tab: confirmed }, observerRequirements);
  let requests = 0, active = 0, maximumActive = 0;
  const rounds: (() => void)[] = [];
  const roundCompleted = (): Promise<void> => new Promise((resolve) => rounds.push(resolve));
  const server = net.createServer((socket) => {
    active++; maximumActive = Math.max(active, maximumActive);
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString();
      if (!buffer.endsWith("\n")) return;
      const request = JSON.parse(buffer);
      assert.equal(request.operation, "observe");
      requests++;
      socket.end(JSON.stringify({ version: 1, requestId: request.requestId, result: requests === 8
        ? { status: "cleaned", identity: value, receipt } : { status: requests % 2 ? "live" : "finalizing", identity: value, claimGeneration: 1 } }) + "\n");
    });
    socket.once("close", () => { active--; rounds.shift()?.(); });
  });
  await new Promise<void>((resolve) => server.listen(departmentExecutionOwnerEndpoint(directory), resolve));
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); });
  Reflect.apply(t.mock.timers.enable, t.mock.timers, [{ apis: ["setTimeout"] }]);
  let round = roundCompleted();
  const waiting = new DepartmentExecutionOwnerClient(directory).waitForCleanup(value, observerRequirements);
  await round;
  for (const delayMs of [250, 500, 1000, 2000, 4000, 5000, 5000]) {
    const previous = requests;
    t.mock.timers.tick(delayMs - 1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(requests, previous, "no early/repeated request during backoff");
    round = roundCompleted();
    t.mock.timers.tick(1);
    await round;
  }
  assert.deepEqual(await waiting, receipt);
  assert.equal(requests, 8);
  assert.equal(maximumActive, 1);
});

for (const mode of ["cancel", "owner-disappears", "conflict"] as const) {
  test(`cleanup observer ${mode} during live backoff never infers cleanup`, async (t) => {
    const directory = tempDirectory(), value = identity({ session: { state: "bound", id: "bound-session" } });
    let requests = 0, complete!: () => void;
    const first = new Promise<void>((resolve) => { complete = resolve; });
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (data) => {
        buffer += data.toString(); if (!buffer.endsWith("\n")) return;
        const request = JSON.parse(buffer); requests++;
        socket.end(JSON.stringify({ version: 1, requestId: request.requestId, result: requests === 1
          ? { status: "live", identity: value, claimGeneration: 1 }
          : { status: "conflict", identity: value, reason: "fixture-generation-conflict" } }) + "\n");
      });
      socket.once("close", complete);
    });
    await new Promise<void>((resolve) => server.listen(departmentExecutionOwnerEndpoint(directory), resolve));
    t.after(async () => { if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); });
    Reflect.apply(t.mock.timers.enable, t.mock.timers, [{ apis: ["setTimeout"] }]);
    const controller = new AbortController();
    const waiting = new DepartmentExecutionOwnerClient(directory).waitForCleanup(value, observerRequirements, controller.signal);
    const rejected = assert.rejects(waiting, mode === "cancel" ? /cleanup-observation-cancelled/
      : mode === "conflict" ? /cleanup-observation-conflict/ : /cleanup-observation-unknown:owner-unreachable/);
    await first;
    if (mode === "cancel") controller.abort();
    if (mode === "owner-disappears") await new Promise<void>((resolve) => server.close(() => resolve()));
    t.mock.timers.tick(250);
    await rejected;
    t.mock.timers.tick(60_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(requests, mode === "conflict" ? 2 : 1);
  });
}

test("cleanup observer reconnects to the same cross-process execution without spawning", async (t) => {
  const directory = tempDirectory();
  const executionId = randomUUID();
  const value = identity({ executionId, session: { state: "bound", id: "fixture-session-" + executionId } });
  const owner = await startOwner(directory);
  t.after(async () => { await closeOwner(owner); fs.rmSync(directory, { recursive: true, force: true }); });
  // The start client is a separate process and has already exited before observation.
  assert.equal(runStartClient(directory, value).status, "live");
  const cancelled = new AbortController();
  const first = new DepartmentExecutionOwnerClient(directory).waitForCleanup(value, observerRequirements, cancelled.signal);
  cancelled.abort();
  await assert.rejects(first, /cleanup-observation-cancelled/);
  assert.equal((await new DepartmentExecutionOwnerClient(directory).observeExecution(value)).status, "live");
  const receipt = await new DepartmentExecutionOwnerClient(directory).waitForCleanup(value, observerRequirements);
  assert.deepEqual(receipt.identity, value);
  assert.equal(fs.readFileSync(path.join(directory, "spawn-count.txt"), "utf8").trim().split("\n").length, 1);
  assert.deepEqual(await new DepartmentExecutionOwnerClient(directory).waitForCleanup(value, observerRequirements), receipt);
  await assert.rejects(new DepartmentExecutionOwnerClient(directory).waitForCleanup(value,
    { ...observerRequirements, tab: false }), /identity-or-policy-conflict/);
  await assert.rejects(new DepartmentExecutionOwnerClient(directory).waitForCleanup({ ...value, generation: 2 },
    observerRequirements), /cleanup-observation-conflict/);
  await assert.rejects(new DepartmentExecutionOwnerClient(directory).waitForCleanup({ ...value, session: { state: "unbound" } },
    observerRequirements), /invalid-cleanup-observation-contract/);
});

test("cleanup observer rejects real owner cleanup failure and missing owners", async (t) => {
  const directory = tempDirectory();
  const executionId = randomUUID();
  const value = identity({ executionId, session: { state: "bound", id: "fixture-session-" + executionId } });
  const owner = await startOwner(directory, "fixture-owner", "fail-root");
  t.after(async () => { await closeOwner(owner); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(runStartClient(directory, value).status, "live");
  await assert.rejects(new DepartmentExecutionOwnerClient(directory).waitForCleanup(value, observerRequirements),
    /cleanup-observation-unknown/);
  const read = new DepartmentExecutionReceiptStore(directory).read(executionId, value);
  assert.equal(read.kind, "ok");
  if (read.kind === "ok") { assert.equal(read.value.state, "cleanup-failed"); assert.equal(read.value.receipt, undefined); }
  await closeOwner(owner);
  await assert.rejects(new DepartmentExecutionOwnerClient(directory).waitForCleanup(value, observerRequirements),
    /cleanup-observation-unknown:owner-unreachable/);
});

test("cleanup observer rejects a valid receipt belonging to a different execution", async (t) => {
  const directory = tempDirectory();
  const value = identity({ session: { state: "bound", id: "bound-session" } });
  const store = new DepartmentExecutionReceiptStore(directory);
  const other = { ...value, executionId: "another-execution" };
  const confirmed = { status: "confirmed" as const, evidence: "fixture-confirmed" };
  const receipt = store.makeReceipt(other, 1, { processTerminal: confirmed,
    turnTerminal: { status: "not-applicable", reason: "process-only" }, streams: confirmed,
    runner: confirmed, executionRoot: confirmed, links: confirmed, temp: confirmed, tab: confirmed }, observerRequirements);
  let operations: string[] = [];
  const endpoint = departmentExecutionOwnerEndpoint(directory);
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString();
      if (!buffer.endsWith("\n")) return;
      const request = JSON.parse(buffer);
      operations.push(request.operation);
      socket.end(JSON.stringify({ version: 1, requestId: request.requestId,
        result: { status: "cleaned", identity: request.identity, receipt } }) + "\n");
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(endpoint, resolve); });
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); });
  const client = new DepartmentExecutionOwnerClient(directory);
  assert.deepEqual(await client.observeExecution(value), { status: "unknown", identity: value, reason: "invalid-owner-response" });
  await assert.rejects(client.waitForCleanup(value, observerRequirements), /cleanup-observation-unknown:invalid-owner-response/);
  assert.deepEqual(operations, ["observe", "observe"]);
});

test("cleanup observer cancellation closes an unresponsive IPC connection", async (t) => {
  const directory = tempDirectory();
  const value = identity({ session: { state: "bound", id: "bound-session" } });
  let connected!: () => void;
  let disconnected!: () => void;
  const connection = new Promise<void>((resolve) => { connected = resolve; });
  const disconnection = new Promise<void>((resolve) => { disconnected = resolve; });
  const server = net.createServer((socket) => {
    socket.on("data", connected);
    socket.once("close", disconnected);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(departmentExecutionOwnerEndpoint(directory), resolve); });
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); });
  const controller = new AbortController();
  const waiting = new DepartmentExecutionOwnerClient(directory).waitForCleanup(value, observerRequirements, controller.signal);
  await connection;
  controller.abort();
  await assert.rejects(waiting, /cleanup-observation-cancelled/);
  await disconnection;
});

function seedLegacyRecord(directory: string, value: DepartmentExecutionIdentity): void {
  const store = new DepartmentExecutionReceiptStore(directory);
  const stored = store.makeStarting(value, { processTerminal: true, turnTerminal: false, streams: true, runner: true,
    executionRoot: true, links: true, temp: true, tab: true });
  const file = createHash("sha256").update(value.executionId).digest("hex") + ".json";
  fs.writeFileSync(path.join(directory, file), JSON.stringify(stored), { mode: 0o600 });
}

function startOwner(directory: string, ownerId = "fixture-owner", cleanupMode = "ok"): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = fork(worker, ["owner", directory, ownerId, cleanupMode], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const timer = setTimeout(() => reject(new Error("owner-start-timeout")), 5_000);
    child.once("message", (message: unknown) => {
      clearTimeout(timer);
      if (message && typeof message === "object" && (message as { ready?: unknown }).ready === true) resolve(child);
      else reject(new Error("invalid-owner-ready-message"));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("owner-exited-before-ready:" + String(code)));
    });
  });
}

function runStartClient(directory: string, value: DepartmentExecutionIdentity): Record<string, unknown> {
  const output = execFileSync(process.execPath, [worker, "client-start", directory, JSON.stringify(value)], {
    encoding: "utf8", timeout: 5_000,
  });
  return JSON.parse(output.trim()) as Record<string, unknown>;
}

function startClientRequest(directory: string, value: DepartmentExecutionIdentity): ChildProcess {
  return spawn(process.execPath, [worker, "client-start", directory, JSON.stringify(value)], { stdio: ["ignore", "pipe", "pipe"] });
}

function waitForMessage(child: ChildProcess, key: string, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.removeListener("message", onMessage); reject(new Error("owner-message-timeout:" + key)); }, timeoutMs);
    const onMessage = (message: unknown): void => {
      if (!message || typeof message !== "object" || !(key in message)) return;
      clearTimeout(timer);
      child.removeListener("message", onMessage);
      resolve(message as Record<string, unknown>);
    };
    child.on("message", onMessage);
  });
}

function waitForClientOutput(child: ChildProcess, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("client-output-timeout")); }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("client-exit:" + String(code)));
      else {
        try { resolve(JSON.parse(output.trim()) as Record<string, unknown>); }
        catch (error) { reject(error); }
      }
    });
  });
}

function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("child-exit-timeout")), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function closeOwner(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.send({ shutdown: true });
  await waitForExit(child);
}

async function waitForStatus(client: DepartmentExecutionOwnerClient, value: DepartmentExecutionIdentity,
  status: "live" | "cleaned" | "unknown", timeoutMs = 5_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = await client.observeExecution(value);
    if (result.status === status) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("execution-status-timeout:" + status);
}

function sendRaw(directory: string, value: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(departmentExecutionOwnerEndpoint(directory));
    let buffer = "";
    socket.once("connect", () => socket.end(JSON.stringify(value) + "\n"));
    socket.on("data", (chunk) => { buffer += chunk.toString("utf8"); });
    socket.once("end", () => {
      try { resolve(JSON.parse(buffer.trim())); } catch (error) { reject(error); }
    });
    socket.once("error", reject);
  });
}

test("owner survives a client process, reconnect is idempotent, handoff fences old claims, and receipt persists", async () => {
  const directory = tempDirectory();
  let owner: ChildProcess | undefined;
  try {
    owner = await startOwner(directory);
    const value = identity();
    const first = runStartClient(directory, value);
    assert.equal(first.status, "live");
    assert.equal(fs.readFileSync(path.join(directory, "spawn-count.txt"), "utf8").trim().split("\n").length, 1);

    const client = new DepartmentExecutionOwnerClient(directory);
    const live = await client.observeExecution(value);
    assert.equal(live.status, "live");
    if (live.status !== "live") throw new Error("expected live owner");
    const secondStart = await client.startExecution(value);
    assert.equal(secondStart.status, "live");
    assert.equal(fs.readFileSync(path.join(directory, "spawn-count.txt"), "utf8").trim().split("\n").length, 1);

    const handedOff = await client.handoffExecution(value, live.claimGeneration);
    assert.equal(handedOff.status, "live");
    if (handedOff.status !== "live") throw new Error("expected handoff");
    const stale = await client.handoffExecution(value, live.claimGeneration);
    assert.equal(stale.status, "conflict");

    const cleaned = await waitForStatus(client, value, "cleaned");
    assert.equal(cleaned.status, "cleaned");
    if (cleaned.status !== "cleaned") throw new Error("expected receipt");
    assert.equal(cleaned.receipt.cleanup.processTerminal.status, "confirmed");
    assert.equal(cleaned.receipt.cleanup.turnTerminal.status, "not-applicable");
    assert.equal(cleaned.receipt.cleanup.executionRoot.status, "confirmed");
    const stored = new DepartmentExecutionReceiptStore(directory).read(value.executionId, value);
    assert.equal(stored.kind, "ok");
    if (stored.kind !== "ok") throw new Error("expected persisted record");
    assert.equal(stored.value.state, "cleaned");
    assert.equal(stored.value.receipt?.claimGeneration, handedOff.claimGeneration);

    const sameGeneration = identity({ executionId: randomUUID() });
    assert.equal((await client.startExecution(sameGeneration)).status, "conflict");
    const successor = identity({ executionId: randomUUID(), generation: 2 });
    assert.equal((await client.startExecution(successor)).status, "live");
    await waitForStatus(client, successor, "cleaned");
    await closeOwner(owner);
  } finally {
    if (owner && owner.exitCode === null && owner.signalCode === null) await closeOwner(owner).catch(() => owner?.kill("SIGKILL"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("cleanup failure remains unknown and cannot be converted into a receipt", async () => {
  const directory = tempDirectory();
  let owner: ChildProcess | undefined;
  try {
    owner = await startOwner(directory, "fixture-owner", "fail-root");
    const value = identity();
    const client = new DepartmentExecutionOwnerClient(directory);
    assert.equal((await client.startExecution(value)).status, "live");
    const result = await waitForStatus(client, value, "unknown");
    assert.notEqual(result.status, "cleaned");
    const stored = new DepartmentExecutionReceiptStore(directory).read(value.executionId, value);
    assert.equal(stored.kind, "ok");
    if (stored.kind === "ok") assert.equal(stored.value.state, "cleanup-failed");
    await closeOwner(owner);
  } finally {
    if (owner && owner.exitCode === null && owner.signalCode === null) await closeOwner(owner).catch(() => owner?.kill("SIGKILL"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("owner death and duplicate owner startup do not infer cleanup or start a replacement", async () => {
  const directory = tempDirectory();
  let owner: ChildProcess | undefined;
  let duplicate: ChildProcess | undefined;
  try {
    owner = await startOwner(directory);
    const value = identity();
    const client = new DepartmentExecutionOwnerClient(directory);
    assert.equal((await client.startExecution(value)).status, "live");

    duplicate = fork(worker, ["owner", directory, "fixture-owner", "ok"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    await waitForExit(duplicate);
    assert.equal(duplicate.exitCode, 2);

    owner.kill("SIGKILL");
    await waitForExit(owner);
    const lost = await client.observeExecution(value);
    assert.equal(lost.status, "unknown");
    assert.match(lost.reason, /owner-unreachable|owner-disconnected/);
    assert.equal(fs.readFileSync(path.join(directory, "spawn-count.txt"), "utf8").trim().split("\n").length, 1);
  } finally {
    if (duplicate && duplicate.exitCode === null && duplicate.signalCode === null) duplicate.kill("SIGKILL");
    if (owner && owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupt records and mismatched identities are unknown or conflict, never cleaned", async () => {
  const directory = tempDirectory();
  let owner: ChildProcess | undefined;
  try {
    owner = await startOwner(directory);
    const value = identity();
    const client = new DepartmentExecutionOwnerClient(directory);
    assert.equal((await client.startExecution(value)).status, "live");
    const mismatch = { ...value, generation: value.generation + 1 } as DepartmentExecutionIdentity;
    assert.equal((await client.observeExecution(mismatch)).status, "conflict");
    assert.equal((await client.handoffExecution(value, 99)).status, "conflict");

    const forged = await sendRaw(directory, {
      version: 1, requestId: randomUUID(), operation: "commit-cleaned", identity: value,
      receipt: { version: 1, cleanup: {} },
    }) as { result?: { status?: string } };
    assert.equal(forged.result?.status, "protocol-error");
    const clientRequirements = await sendRaw(directory, {
      version: 1, requestId: randomUUID(), operation: "start", identity: value,
      requirements: { processTerminal: true, turnTerminal: false, streams: true, runner: false,
        executionRoot: false, links: false, temp: false, tab: false },
    }) as { result?: { status?: string } };
    assert.equal(clientRequirements.result?.status, "protocol-error");
    assert.equal((await client.observeExecution(value)).status, "live");
    await waitForStatus(client, value, "cleaned");

    const files = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 1);
    fs.writeFileSync(path.join(directory, files[0]), "{broken");
    assert.equal((await client.observeExecution(value)).status, "unknown");
    await closeOwner(owner);
  } finally {
    if (owner && owner.exitCode === null && owner.signalCode === null) await closeOwner(owner).catch(() => owner?.kill("SIGKILL"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("execution identities reject unknown session states and permissive fields", () => {
  const value = identity();
  assert.equal(isDepartmentExecutionIdentity(value), true);
  assert.equal(isDepartmentExecutionIdentity({ ...value, session: null }), false);
  assert.equal(isDepartmentExecutionIdentity({ ...value, executable: process.execPath }), false);
  assert.equal(isDepartmentExecutionIdentity({ ...value, configFingerprint: "secret-token" }), false);
});

test("close rejects a pending launch without releasing this owner's lock", async () => {
  const directory = tempDirectory();
  let owner: ChildProcess | undefined;
  let client: ChildProcess | undefined;
  try {
    owner = await startOwner(directory, "fixture-owner", "delay-launch");
    const value = identity();
    client = startClientRequest(directory, value);
    await waitForMessage(owner, "launching");

    owner.send({ shutdown: true });
    const rejected = await waitForMessage(owner, "shutdownRejected");
    assert.match(String(rejected.shutdownRejected), /owner-has-live-executions/);
    assert.equal(fs.existsSync(path.join(directory, "owner.lock")), true);

    const duplicate = fork(worker, ["owner", directory, "fixture-owner", "ok"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    await waitForExit(duplicate);
    assert.equal(duplicate.exitCode, 2);

    const startResult = await waitForClientOutput(client);
    assert.equal(startResult.status, "live");
    const observationClient = new DepartmentExecutionOwnerClient(directory);
    await waitForStatus(observationClient, value, "cleaned");

    fs.unlinkSync(path.join(directory, "owner.lock"));
    fs.writeFileSync(path.join(directory, "owner.lock"), "replacement-lock");
    await closeOwner(owner);
    assert.equal(fs.readFileSync(path.join(directory, "owner.lock"), "utf8"), "replacement-lock");
  } finally {
    if (client && client.exitCode === null && client.signalCode === null) client.kill("SIGKILL");
    if (owner && owner.exitCode === null && owner.signalCode === null) await closeOwner(owner).catch(() => owner?.kill("SIGKILL"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("slot index keeps starts bounded after more than 4096 historical records", () => {
  const directory = tempDirectory();
  try {
    const store = new DepartmentExecutionReceiptStore(directory);
    const requirements = { processTerminal: true, turnTerminal: false, streams: true, runner: true,
      executionRoot: true, links: true, temp: true, tab: true } as const;
    for (let index = 0; index < 4_200; index++) {
      const historical = { ...identity({ executionId: "history-" + index }), workspace: "workspace-" + index };
      store.write(store.makeStarting(historical, requirements), null);
    }
    const next = identity({ executionId: "after-history" });
    assert.equal(store.checkSlot(next), "available");
    const started = store.write(store.makeStarting(next, requirements), null);
    assert.equal(started.state, "starting");
    assert.equal(store.read(next.executionId, next).kind, "ok");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy records migrate only after complete validation", () => {
  const directory = tempDirectory();
  try {
    const historical = identity({ executionId: "legacy-single" });
    seedLegacyRecord(directory, historical);
    const store = new DepartmentExecutionReceiptStore(directory);
    assert.equal(store.checkSlot(historical), "conflict");
    assert.equal(fs.readFileSync(path.join(directory, ".slot-index-v1"), "utf8"), "1");
    assert.equal(fs.existsSync(path.join(directory, createHash("sha256").update(historical.executionId).digest("hex") + ".json")), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy migration accepts more than 4096 records", () => {
  const directory = tempDirectory();
  try {
    for (let index = 0; index < 4_200; index++) {
      seedLegacyRecord(directory, identity({ executionId: "legacy-migration-" + index, workspace: "legacy-workspace-" + index }));
    }
    const next = identity({ executionId: "legacy-migration-next", workspace: "legacy-workspace-next" });
    const store = new DepartmentExecutionReceiptStore(directory);
    assert.equal(store.checkSlot(next), "available");
    assert.equal(fs.readFileSync(path.join(directory, ".slot-index-v1"), "utf8"), "1");
    assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith(".json")).length, 4_200);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy same-slot generation conflicts are independent of file creation order", () => {
  for (const order of [[3, 1, 2], [1, 2, 3]]) {
    const directory = tempDirectory();
    try {
      for (const generation of order) {
        seedLegacyRecord(directory, identity({ executionId: "legacy-conflict-" + generation, generation }));
        if (generation === 1) seedLegacyRecord(directory, identity({ executionId: "legacy-conflict-1b", generation }));
      }
      assert.equal(new DepartmentExecutionReceiptStore(directory).checkSlot(identity({ generation: 4 })), "unknown");
      assert.equal(fs.existsSync(path.join(directory, ".slot-index-v1")), false);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test("legacy newer generation cannot mask an older uncleaned execution", () => {
  const directory = tempDirectory();
  try {
    seedLegacyRecord(directory, identity({ executionId: "legacy-open-old", generation: 1 }));
    seedLegacyRecord(directory, identity({ executionId: "legacy-open-new", generation: 2 }));
    assert.equal(new DepartmentExecutionReceiptStore(directory).checkSlot(identity({ generation: 3 })), "unknown");
    assert.equal(fs.existsSync(path.join(directory, ".slot-index-v1")), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy corrupt records keep migration unknown without publishing its marker", () => {
  const directory = tempDirectory();
  try {
    seedLegacyRecord(directory, identity({ executionId: "legacy-corrupt-valid" }));
    fs.writeFileSync(path.join(directory, "corrupt.json"), "{broken");
    assert.equal(new DepartmentExecutionReceiptStore(directory).checkSlot(identity({ executionId: "legacy-corrupt-probe" })), "unknown");
    assert.equal(fs.existsSync(path.join(directory, ".slot-index-v1")), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("partial legacy index publication is retried by a fresh store", () => {
  const directory = tempDirectory();
  const mutableFs = fs as unknown as { renameSync: typeof fs.renameSync };
  const originalRename = mutableFs.renameSync;
  try {
    seedLegacyRecord(directory, identity({ executionId: "legacy-retry-a", workspace: "legacy-retry-a" }));
    seedLegacyRecord(directory, identity({ executionId: "legacy-retry-b", workspace: "legacy-retry-b" }));
    let slotRenames = 0;
    mutableFs.renameSync = ((source: fs.PathLike, destination: fs.PathLike) => {
      if (String(destination).endsWith(".slot") && ++slotRenames === 2) throw new Error("injected-index-write-failure");
      return originalRename(source, destination);
    }) as typeof fs.renameSync;
    assert.equal(new DepartmentExecutionReceiptStore(directory).checkSlot(identity({ workspace: "probe" })), "unknown");
    assert.equal(fs.existsSync(path.join(directory, ".slot-index-v1")), false);
    mutableFs.renameSync = originalRename;

    const retry = new DepartmentExecutionReceiptStore(directory);
    assert.equal(retry.checkSlot(identity({ workspace: "probe" })), "available");
    assert.equal(fs.readFileSync(path.join(directory, ".slot-index-v1"), "utf8"), "1");
    assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith(".json")).length, 2);
  } finally {
    mutableFs.renameSync = originalRename;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const mode of ["success", "failure", "owner-loss", "corrupt"] as const) {
  test(`original cleanup waiter survives real terminal/finalizing until ${mode}`, { timeout: 15000 }, async (t) => {
    const directory = tempDirectory(), executionId = randomUUID();
    const value = identity({ executionId, session: { state: "bound", id: "fixture-session-" + executionId } });
    const owner = await startOwner(directory, "fixture-owner", mode === "failure" ? "gate-cleanup-fail" : "gate-cleanup");
    t.after(async () => {
      if (owner.exitCode === null && owner.signalCode === null) {
        owner.send({ releaseCleanup: executionId });
        await closeOwner(owner).catch(() => owner.kill("SIGKILL"));
      }
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const client = new DepartmentExecutionOwnerClient(directory);
    assert.equal((await client.startExecution(value)).status, "live");
    const terminal = waitForMessage(owner, "cleanupPending");
    owner.send({ releaseExecution: true, executionId });
    await terminal;
    const pending = await client.observeExecution(value);
    assert.deepEqual(pending, { status: "finalizing", identity: value, claimGeneration: 1 });
    assert.deepEqual(await client.startExecution(value), pending, "duplicate start cannot spawn during cleanup");
    assert.deepEqual(await client.handoffExecution(value, 1), pending, "finalizing cannot increment claim");
    assert.deepEqual(await client.handoffExecution(value, 99), pending, "no claim is granted even with stale handoff");
    assert.equal((await client.observeExecution({ ...value, generation: 2 })).status, "conflict");
    assert.equal(fs.readFileSync(path.join(directory, "spawn-count.txt"), "utf8"), executionId + "\n");
    if (mode === "success") {
      const cancelled = new AbortController();
      const cancelledWait = client.waitForCleanup(value, observerRequirements, cancelled.signal);
      cancelled.abort(); await assert.rejects(cancelledWait, /cleanup-observation-cancelled/);
      assert.deepEqual(await client.observeExecution(value), pending, "cancellation leaves original cleanup pending");
      const rejected = waitForMessage(owner, "shutdownRejected"); owner.send({ shutdown: true });
      assert.match(String((await rejected).shutdownRejected), /owner-has-live-executions/);
      assert.ok(fs.existsSync(path.join(directory, "owner.lock")));
      assert.deepEqual(await client.observeExecution(value), pending, "close rejection retains endpoint");
      const duplicate = fork(worker, ["owner", directory, "fixture-owner", "ok"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      await waitForExit(duplicate); assert.equal(duplicate.exitCode, 2);
    }
    // Tap actual socket responses, not the waiter's implementation or cleanup promise.
    let finalizingReplies = 0;
    const connect = net.createConnection;
    t.mock.method(net, "createConnection", (...args: any[]) => {
      const socket = Reflect.apply(connect, net, args) as net.Socket;
      let frame = "";
      socket.on("data", (chunk) => {
        frame += chunk.toString();
        if (frame.endsWith("\n") && JSON.parse(frame).result?.status === "finalizing") finalizingReplies++;
      });
      return socket;
    });
    let settled = false;
    const waiting = client.waitForCleanup(value, observerRequirements);
    void waiting.then(() => { settled = true; }, () => { settled = true; });
    const deadline = Date.now() + 5000;
    while (finalizingReplies < 2) {
      if (Date.now() > deadline) assert.fail("original waiter did not continue observing finalizing");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(settled, false, "terminal and repeated finalizing are neither success nor rejection");
    if (mode === "owner-loss") {
      const rejected = assert.rejects(waiting, /cleanup-observation-unknown:owner-/);
      owner.kill("SIGKILL"); await waitForExit(owner); await rejected;
    } else {
      if (mode === "corrupt") {
        const file = path.join(directory, createHash("sha256").update(executionId).digest("hex") + ".json");
        fs.writeFileSync(file, "{broken");
        assert.equal((await client.observeExecution(value)).status, "unknown");
      }
      const rejected = mode === "success" ? undefined : assert.rejects(waiting, /cleanup-observation-unknown/);
      owner.send({ releaseCleanup: executionId });
      if (rejected) await rejected;
      else {
        const receipt = await waiting;
        assert.deepEqual(receipt.identity, value); assert.equal(receipt.claimGeneration, 1);
        assert.deepEqual(receipt.requirements, observerRequirements);
        assert.equal(receipt.cleanup.tab.status, "confirmed");
        await closeOwner(owner);
        assert.deepEqual(await client.waitForCleanup(value, observerRequirements), receipt, "only original complete receipt enters cache");
      }
    }
    if (mode !== "success") {
      const stored = new DepartmentExecutionReceiptStore(directory).read(executionId, value);
      if (stored.kind === "ok") assert.equal(stored.value.receipt, undefined);
      await assert.rejects(client.waitForCleanup(value, observerRequirements), /cleanup-observation-unknown/, "no failed result was cached");
    }
  });
}

test("settled completion without verified terminal cannot report finalizing", { timeout: 10000 }, async (t) => {
  const directory = tempDirectory(), executionId = randomUUID();
  const value = identity({ executionId, session: { state: "bound", id: "fixture-session-" + executionId } });
  const owner = await startOwner(directory, "fixture-owner", "gate-terminal-unknown");
  t.after(async () => {
    owner.send({ releaseCleanup: executionId }); await closeOwner(owner);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const client = new DepartmentExecutionOwnerClient(directory);
  assert.equal((await client.startExecution(value)).status, "live");
  const pending = waitForMessage(owner, "cleanupPending"); owner.send({ releaseExecution: true, executionId }); await pending;
  assert.equal((await client.observeExecution(value)).status, "unknown");
  await assert.rejects(client.waitForCleanup(value, observerRequirements), /cleanup-observation-unknown/);
  owner.send({ releaseCleanup: executionId });
  const store = new DepartmentExecutionReceiptStore(directory), deadline = Date.now() + 5000;
  for (;;) {
    const read = store.read(executionId, value);
    if (read.kind === "ok" && read.value.state === "cleanup-failed") { assert.equal(read.value.receipt, undefined); break; }
    if (Date.now() > deadline) assert.fail("fixture cleanup did not fail closed");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
});
