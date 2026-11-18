import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as cp from "child_process";
import { setup, until } from "../runtime/fixtures/departmentprocesspreparationfixture";
import { createDepartmentProcessPreparation, startDepartmentProcessInvocation } from "../../extensionHost/departmentprocesspreparation";
import { createDepartmentExecutionResources } from "../../extensionHost/departmentexecutionresources";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { cleanupComplete, sameExecution } from "../../runtime/departmentexecutionidentity";

// Original production facade, fixed production worker, actual Node CLI/descendant,
// original tab capability and consumer gate. No worker or directory test switches.
test("employee facade keeps original observation pending through consumer finalizing and receipt/stopped", { timeout: 20000 }, async (t) => {
  const h = await setup(t);
  let stoppedDelivered = false, releaseShutdown: (() => void) | undefined, owner: cp.ChildProcess | undefined;
  let shutdownRequested!: () => void;
  const shutdown = new Promise<void>((resolve) => { shutdownRequested = resolve; });
  const fork = cp.fork;
  t.mock.method(cp, "fork", (...args: any[]) => {
    const child = Reflect.apply(fork, cp, args) as cp.ChildProcess; owner = child;
    const send = child.send;
    // Hold the HOST request, not stopped delivery: the real worker may disconnect
    // immediately after stopped. No fake worker liveness or altered initialization.
    t.mock.method(child, "send", (...values: any[]) => {
      if (values[0]?.operation === "shutdown") {
        releaseShutdown = () => { releaseShutdown = undefined; Reflect.apply(send, child, values); };
        shutdownRequested(); return true;
      }
      return Reflect.apply(send, child, values);
    });
    child.on("message", (message: any) => { if (message?.type === "stopped") stoppedDelivered = true; });
    return child;
  });
  let original: DepartmentExecutionOwnerClient | undefined;
  h.host.retainOriginalClient = (_binding, client) => { original = client; };
  const bindings = () => {
    const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
    return read.value.executionBindings ?? [];
  };
  const tabs = new Map([["employee-tab", { id: "employee-tab", cli: "opencode", sessionId: "ses_fixture" }]]);
  let tabCloses = 0;
  const resources = createDepartmentExecutionResources({ workspace: () => "workspace", readTab: (id) => tabs.get(id) ?? null,
    isActive: () => false, owns: (identity) => bindings().some((binding) => sameExecution(binding.identity, identity)),
    close: async (tab) => { tabCloses++; tabs.delete(tab.id); } });
  resources.recordCreated("employee-tab"); const consumer = resources.beginConsumer("employee-tab");
  t.after(() => { consumer.finish(); releaseShutdown?.(); });
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
  const service = createDepartmentProcessPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  const observed = service.observe("leader", "attempt", "subtask");
  let settled = false; void observed.done.then(() => { settled = true; assert.equal(stoppedDelivered, true); }, () => { settled = true; });
  let output = "";
  const handle = startDepartmentProcessInvocation(service, "leader", "subtask", { onStdout(chunk) { output += chunk; } },
    h.expected, h.host.prepareLaunch, { tabTarget: consumer.target });
  await until(() => fs.existsSync(path.join(h.directory, "tail-ready")));
  fs.writeFileSync(path.join(h.directory, "exit"), "open"); fs.writeFileSync(path.join(h.directory, "drain"), "open");
  const terminal = await handle.lifecycle!;
  assert.equal(terminal.processTerminal.status, "confirmed"); assert.equal(terminal.streams.status, "confirmed");
  await until(() => finalizingReplies >= 2); // Responses are from the original automatic waitForCleanup chain.
  assert.equal(settled, false); assert.equal(tabCloses, 0); assert.equal(tabs.size, 1);
  const binding = bindings()[0]; assert.ok(binding && original);
  assert.equal(fs.readFileSync(path.join(h.directory, "spawn-count"), "utf8"), "spawn\n");
  consumer.finish();
  await shutdown;
  const receipt = await original.waitForCleanup(binding.identity, binding.requirements);
  assert.ok(cleanupComplete(receipt.cleanup, binding.requirements)); assert.deepEqual(receipt.identity, binding.identity);
  assert.equal(settled, false, "complete receipt alone is insufficient before original stopped delivery");
  releaseShutdown!(); await observed.done;
  await until(() => owner?.exitCode !== null && owner?.exitCode !== undefined);
  assert.equal(stoppedDelivered, true);
  assert.equal(settled, true); assert.equal(tabCloses, 1); assert.equal(tabs.size, 0);
  assert.ok(output.includes("正确会话回答") && output.includes("tail-output"));
  assert.equal(fs.readFileSync(path.join(h.directory, "spawn-count"), "utf8"), "spawn\n");
  assert.deepEqual(await original.waitForCleanup(binding.identity, binding.requirements), receipt, "original strict cache survives stopped");
  assert.equal((await new DepartmentExecutionOwnerClient(path.join(h.host.ownerDirectory, binding.identity.ownerId))
    .observeExecution(binding.identity)).status, "unknown", "cold client cannot import disk receipt");
  // The facade proves cleanup/stopped; actual organizational capacity consumption is a separate consumer.
  const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
  assert.equal(state.value.capacity.employees.length, 1);
});
