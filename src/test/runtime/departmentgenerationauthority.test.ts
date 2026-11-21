import * as assert from "node:assert/strict";
import { fork, type ChildProcess } from "child_process";
import * as fs from "fs";
import type { Server } from "net";
import * as os from "os";
import * as path from "path";
import { test } from "node:test";
import { randomUUID } from "crypto";
import { DepartmentGenerationAuthorityClient } from "../../runtime/departmentgenerationauthorityclient";
import { DepartmentGenerationAuthorityServer, readDepartmentGenerationAuthority, type DepartmentGenerationTicket } from "../../runtime/departmentgenerationauthority";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity } from "../../runtime/departmentexecutionidentity";

const scope = { rootTaskId: "root-authority", workspace: "/tmp/workspace-authority", leaderTaskId: "leader-authority", moduleId: "module-authority", generation: 1 };
const selection = { version: 1 as const, cli: "opencode" as const, role: "employee" as const, configId: "config-authority",
  revision: "revision-authority", model: "model-authority", thinkingMode: null, openCodeVariant: null };
const requirements = { processTerminal: true, turnTerminal: false, streams: true, runner: true, executionRoot: true, links: true, temp: true, tab: true };

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error("authority-worker-start-timeout"); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test("generation authority serializes cross-process claims, tickets, grants and irreversible seal", { timeout: 15000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-generation-authority-"));
  const worker = path.join(__dirname, "../../runtime/departmentgenerationauthorityworker.js");
  const readyFile = path.join(directory, "ready.json");
  let child: ChildProcess | undefined;
  t.after(() => { child?.kill(); fs.rmSync(directory, { recursive: true, force: true }); });
  child = fork(worker, [], { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  child.unref();
  let bootstrap: { producerProof?: string } = {};
  child.on("message", value => { bootstrap = value as typeof bootstrap; });
  child.send({ directory, readyFile, producerId: "producer-authority", scope });
  await waitUntil(() => typeof bootstrap.producerProof === "string");
  assert.equal(JSON.parse(fs.readFileSync(readyFile, "utf8")).producerProof, undefined);
  assert.equal(fs.readFileSync(path.join(directory, "authority.json"), "utf8").includes(bootstrap.producerProof!), false);
  const original = new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority", bootstrap.producerProof);
  const firstClaim = original.currentClaim();
  const contender = new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority");
  const ticket: DepartmentGenerationTicket = { id: randomUUID(), registrationId: "employee-attempt-a",
    target: { role: "employee", subtaskId: "subtask-authority", attemptId: "attempt-authority" }, selection, requirements,
    localSessionId: "local-transcript-session", nativeSessionId: null, identity: null, state: "preparing" };
  await original.registerTicket(ticket);
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: scope.workspace, rootTaskId: scope.rootTaskId,
    leaderTaskId: scope.leaderTaskId, moduleId: scope.moduleId, generation: scope.generation, role: "employee", cli: "opencode",
    configFingerprint: fingerprintDepartmentExecutionSelection(selection).configFingerprint,
    profileFingerprint: fingerprintDepartmentExecutionSelection(selection).profileFingerprint,
    session: { state: "bound", id: "ses_authority" }, ownerId: "owner-authority", executionId: "execution-authority",
    subtaskId: "subtask-authority", attemptId: "attempt-authority" };
  ticket.nativeSessionId = "ses_authority";
  await original.bindTicket(ticket, identity);
  await original.grant(ticket);
  await original.consume(ticket);
  const late = new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority");
  await assert.rejects(late.grant({ ...ticket, id: randomUUID(), registrationId: "employee-attempt-b", state: "bound" }), /original-producer-required/);
  await assert.rejects(late.release(ticket), /original-producer-required/);
  await original.seal();
  await assert.rejects(contender.claimSealed(firstClaim), /claim-conflict/);
  const persisted = readDepartmentGenerationAuthority(directory);
  assert.equal(persisted?.snapshot.state, "sealed");
  assert.equal(persisted?.snapshot.tickets[0].state, "started", "unfinished responsibility is retained by the authority");
  await original.release(ticket);
  assert.equal((await original.seal()).tickets[0].state, "released");
  await contender.claimSealed(firstClaim);
  await assert.rejects(late.claimSealed(firstClaim), /claim-conflict/);
  assert.notEqual((await late.observe()).claim, firstClaim);
});

test("generation authority rejects wrong scope and wrong original producer", { timeout: 10000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-generation-authority-scope-"));
  const worker = path.join(__dirname, "../../runtime/departmentgenerationauthorityworker.js"), readyFile = path.join(directory, "ready.json");
  let child: ChildProcess | undefined;
  t.after(() => { child?.kill(); fs.rmSync(directory, { recursive: true, force: true }); });
  child = fork(worker, [], { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }); child.unref();
  child.send({ directory, readyFile, producerId: "producer-authority", scope });
  await waitUntil(() => fs.existsSync(readyFile));
  assert.throws(() => new DepartmentGenerationAuthorityClient(directory, { ...scope, generation: 2 }, "producer-authority"), /unavailable/);
  assert.throws(() => new DepartmentGenerationAuthorityClient(directory, scope, "replacement-producer"), /unavailable/);
});

test("original authority accepts stop control and returns a full generation larger than a request frame", { timeout: 20000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-generation-large-response-"));
  const readyFile = path.join(directory, "ready.json");
  const child = fork(path.join(__dirname, "../../runtime/departmentgenerationauthorityworker.js"), [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill(); await exited;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let producerProof: string | undefined;
  child.on("message", value => {
    if (value && typeof value === "object" && "producerProof" in value && typeof value.producerProof === "string") producerProof = value.producerProof;
  });
  child.send({ directory, readyFile, ownerDirectory: path.join(directory, "owners"), producerId: "producer-authority", scope });
  await waitUntil(() => !!producerProof);
  const original = new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority", producerProof);
  const wideSelection = { ...selection, model: "模".repeat(256), configId: "配".repeat(256), openCodeVariant: "路".repeat(256) };
  const ticketTotal = 256;
  const createTicket = (index: number): DepartmentGenerationTicket => ({
    id: randomUUID(), registrationId: `registration-${index}`,
    target: { role: "employee", subtaskId: `task-${index}`, attemptId: `attempt-${index}` },
    selection: wideSelection, requirements, localSessionId: "local-transcript", nativeSessionId: null, identity: null, state: "preparing",
  });
  const registrations = Array.from({ length: ticketTotal }, (_, index) => createTicket(index));
  for (const ticket of registrations) await original.registerTicket(ticket);
  await assert.rejects(original.registerTicket(createTicket(ticketTotal)), /department-generation-authority-capacity/);
  const cold = new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority");
  const beforeStop = await cold.observe();
  assert.ok(Buffer.byteLength(JSON.stringify(beforeStop)) > 64 * 1024);
  assert.deepEqual(beforeStop.tickets, registrations);
  const controlId = randomUUID();
  assert.equal((await cold.control(controlId)).state, "draining");
  assert.equal((await cold.recovery(controlId)).closure, null);
  const stopped = await cold.observe();
  assert.equal(stopped.state, "sealed");
  assert.deepEqual(stopped.tickets, registrations.map(ticket => ({ ...ticket, state: "unknown" })));
  await assert.rejects(original.registerTicket(createTicket(ticketTotal)), /department-generation-authority-sealed/);
});

test("disconnected authority stops reachable original Owners despite incomplete tickets and Owner failures", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-generation-partial-stop-"));
  const server = new DepartmentGenerationAuthorityServer(directory, scope, "producer-authority", undefined,
    { ownerDirectory: path.join(directory, "owners"), drain() {}, originalConnected: () => false });
  const endpoint = await server.listen();
  t.after(async () => {
    const listener = (server as unknown as { server: Server }).server;
    await new Promise<void>(resolve => listener.close(() => resolve()));
    if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const original = new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority", server.producerProofForBootstrap());
  const ownerStops: string[] = [];
  t.mock.method(DepartmentExecutionOwnerClient.prototype, "sealExecution", async (identity: DepartmentExecutionIdentity) => {
    ownerStops.push(identity.ownerId);
    if (identity.ownerId === "owner-offline") throw new Error("injected-owner-disconnect");
    return { status: "unknown", identity, reason: "injected-no-cleanup-receipt" };
  });
  for (const suffix of ["unbound", "offline", "reachable"]) {
    const ticket: DepartmentGenerationTicket = { id: randomUUID(), registrationId: `registration-${suffix}`,
      target: { role: "employee", subtaskId: `subtask-${suffix}`, attemptId: `attempt-${suffix}` }, selection, requirements,
      localSessionId: "local-transcript-session", nativeSessionId: null, identity: null, state: "preparing" };
    await original.registerTicket(ticket);
    if (suffix === "unbound") continue;
    const nativeSessionId = `ses_${suffix}`;
    const identity: DepartmentExecutionIdentity = { ...scope, version: 1, role: "employee", cli: "opencode",
      ...fingerprintDepartmentExecutionSelection(selection), session: { state: "bound", id: nativeSessionId },
      ownerId: `owner-${suffix}`, executionId: `execution-${suffix}`, subtaskId: `subtask-${suffix}`, attemptId: `attempt-${suffix}` };
    ticket.nativeSessionId = nativeSessionId;
    await original.bindTicket(ticket, identity);
    await original.grant(ticket);
    await original.consume(ticket);
  }
  const cold = new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority");
  const result = await cold.control(randomUUID());
  assert.deepEqual(ownerStops, ["owner-offline", "owner-reachable"]);
  assert.equal(result.closure, null);
  const stopped = await cold.observe();
  assert.equal(stopped.state, "sealed");
  assert.deepEqual(stopped.tickets.map(ticket => ticket.state), ["unknown", "started", "started"]);
  await assert.rejects(server.close(), /responsibility-open/);
});

test("generation authority rejects persisted snapshot schema extensions", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-generation-authority-schema-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "authority.json"), snapshot = { version: 2, scope, producerId: "producer-authority",
    claim: "claim-authority", state: "open", tickets: [] };
  fs.writeFileSync(file, JSON.stringify({ token: "x".repeat(64), snapshot }), { mode: 0o600 });
  assert.equal(readDepartmentGenerationAuthority(directory)?.snapshot.claim, "claim-authority");
  fs.writeFileSync(file, JSON.stringify({ token: "x".repeat(64), snapshot: { ...snapshot, legacyBooleanOwner: true } }), { mode: 0o600 });
  assert.equal(readDepartmentGenerationAuthority(directory), null);
});

test("real authority preserves identity-free unknown preparation and rejects release and secret selection fields", { timeout: 10000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-generation-unknown-"));
  const readyFile = path.join(directory, "ready.json");
  const child = fork(path.join(__dirname, "../../runtime/departmentgenerationauthorityworker.js"), [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill(); await exited; // Unknown responsibility: test hygiene only.
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let bootstrap: { producerProof?: string } = {};
  child.on("message", value => { bootstrap = value as typeof bootstrap; });
  child.send({ directory, readyFile, producerId: "producer-authority", scope });
  await waitUntil(() => typeof bootstrap.producerProof === "string");
  assert.equal(JSON.parse(fs.readFileSync(readyFile, "utf8")).producerProof, undefined);
  const proof = bootstrap.producerProof!;
  const original = new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority", proof);
  const ticket: DepartmentGenerationTicket = { id: randomUUID(), registrationId: "failed-preparation",
    target: { role: "employee", subtaskId: "subtask-authority", attemptId: "attempt-authority" }, selection, requirements,
    localSessionId: "local-transcript", nativeSessionId: null, identity: null, state: "preparing" };
  await assert.rejects(original.registerTicket({ ...ticket, selection: { ...selection, apiKey: "forbidden-field" } as typeof selection }), /scope-or-auth-conflict/);
  await original.registerTicket(ticket);
  await original.markUnknown(ticket);
  const observed = await new DepartmentGenerationAuthorityClient(directory, scope, "producer-authority").observe();
  assert.equal(observed.tickets[0].state, "unknown");
  assert.equal(observed.tickets[0].identity, null);
  assert.equal(observed.tickets[0].nativeSessionId, null);
  assert.equal(readDepartmentGenerationAuthority(directory)?.snapshot.tickets[0].state, "unknown");
  await assert.rejects(original.release(ticket), /scope-or-auth-conflict|transition-invalid/);
  await original.seal();
  await assert.rejects(original.claimSealed(original.currentClaim()), /claim-conflict/);
  assert.equal(readDepartmentGenerationAuthority(directory)?.snapshot.tickets[0].state, "unknown");
});
