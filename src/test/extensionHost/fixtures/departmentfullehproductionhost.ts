import * as fs from "node:fs";
import * as path from "node:path";
import type { DepartmentExecutionIdentity, CleanupRequirements } from "../../../runtime/departmentexecutionidentity";
import type { DepartmentExecutionReceipt } from "../../../runtime/departmentexecutionreceiptstore";

/** Passive test observation of the ORIGINAL client's validated return. Returns
 * the same Promise; cannot grant, release, retry or synthesize cleanup. */
export function installDepartmentFullEhReceiptObserver(client: { prototype: {
  waitForCleanup(identity: DepartmentExecutionIdentity, requirements: CleanupRequirements, signal?: AbortSignal): Promise<DepartmentExecutionReceipt>;
} }, record: (value: { source: string; identity: DepartmentExecutionIdentity; requirements: CleanupRequirements; receipt: DepartmentExecutionReceipt }) => void,
  failed: (error: unknown) => void): () => void {
  const original = client.prototype.waitForCleanup;
  const wrapped: typeof original = function (this: typeof client["prototype"], identity, requirements, signal) {
    const expected = structuredClone(identity), policy = structuredClone(requirements);
    const pending = original.call(this, identity, requirements, signal);
    void pending.then((receipt) => {
      try { record({ source: "original-client-waitForCleanup-return", identity: expected, requirements: policy, receipt: structuredClone(receipt) }); }
      catch (error) { failed(error); }
    }, () => undefined);
    return pending;
  };
  client.prototype.waitForCleanup = wrapped;
  return () => { if (client.prototype.waitForCleanup === wrapped) client.prototype.waitForCleanup = original; };
}

/** Passive IPC audit: records only allowlisted protocol fields, never private
 * tokens, prompts or configuration. Observer failures are diagnostic only and
 * must never interrupt the original fork/send protocol. */
export function installDepartmentFullEhProtocolObserver(cp: typeof import("node:child_process"),
  record: (event: Record<string, unknown>) => void,
  failed: (diagnostic: { stage: string }) => void = () => undefined,
  readGrantState?: (message: unknown) => Record<string, unknown>): () => void {
  const original = cp.fork;
  const wrapped = new Proxy(original, { apply(target, receiver, args) {
    const child = Reflect.apply(target, receiver, args) as import("node:child_process").ChildProcess;
    if (!/department(?:leaderprocess|leadercodex|codex|process)ownerworker\.js$/.test(String(args[0]))) return child;
    const grantRequests = new Set<number>();
    const observeFailure = (stage: string): void => { try { failed({ stage }); } catch { /* diagnostics cannot affect execution */ } };
    const write = (event: Record<string, unknown>): void => {
      try { record({ at: Date.now(), pid: child.pid, ...event }); }
      catch { observeFailure("protocol-observation-record-failed"); }
    };
    const isGrantBoundary = (message: unknown): boolean => {
      const value = message as Record<string, unknown> | null;
      if (!value || typeof value !== "object") return false;
      if (value.operation === "launch" || value.operation === "grant") return true;
      if (value.operation !== "ack" || !Number.isSafeInteger(value.requestSequence)) return false;
      const requested = grantRequests.delete(value.requestSequence as number);
      return requested && value.ok === true && value.callbackSequence === undefined;
    };
    const messageFields = (message: unknown): Record<string, unknown> => {
      const value = message as Record<string, unknown> | null;
      if (!value || typeof value !== "object") return {};
      const fields = Object.fromEntries(["type", "operation", "identity", "invocationId", "requestSequence", "callbackSequence", "ok", "terminal", "directory", "retired"]
        .filter((key) => value[key] !== undefined).map((key) => [key, structuredClone(value[key])]));
      if (value.session && typeof value.session === "object") {
        const session = value.session as Record<string, unknown>;
        fields.session = { threadId: session.threadId, connectionId: session.connectionId };
      }
      if (value.selection) fields.selection = structuredClone(value.selection);
      if (value.launch && typeof value.launch === "object") {
        const launch = value.launch as Record<string, unknown>;
        const args = Array.isArray(launch.args) ? launch.args : [];
        const option = (names: string[]) => args.flatMap((arg, index) => names.includes(arg) ? [args[index + 1]]
          : typeof arg === "string" && names.some(name => arg.startsWith(name + "=")) ? [arg.slice(arg.indexOf("=") + 1)] : []);
        const overlay = (launch.overlay ?? value.overlay) as Record<string, unknown> | undefined;
        fields.launchEvidence = { cwd: launch.cwd, sessionId: launch.sessionId, modelArgs: option(["--model", "-m"]),
          sessionArgs: option(["--session", "-s"]), overlayModel: overlay?.primaryModel };
      }
      return fields;
    };
    write({ event: "owner-fork", worker: String(args[0]) });
    child.on("message", (message) => {
      try {
        const fields = messageFields(message);
        if (fields.type === "grant-request" && Number.isSafeInteger(fields.requestSequence)) {
          if (grantRequests.size >= 4096) throw new Error("observer request budget exceeded");
          grantRequests.add(fields.requestSequence as number);
        }
        write({ event: "received", ...fields });
      } catch { observeFailure("protocol-observation-failed"); }
    });
    child.send = new Proxy(child.send, { apply(send, owner, values) {
      try {
        const event = { event: "sent", ...messageFields(values[0]) };
        if (isGrantBoundary(values[0]) && readGrantState) {
          try { Object.assign(event, { preGrantReadback: readGrantState(structuredClone(values[0])) }); }
          catch { observeFailure("protocol-pregrant-readback-failed"); Object.assign(event, { preGrantReadback: { runtimeOk: false } }); }
        }
        write(event);
      } catch { observeFailure("protocol-observation-failed"); }
      return Reflect.apply(send, owner, values);
    } });
    child.once("close", (code, signal) => { grantRequests.clear(); write({ event: "owner-close", code, signal }); });
    return child;
  } });
  cp.fork = wrapped;
  return () => { if (cp.fork === wrapped) cp.fork = original; };
}

export function createDepartmentFullEhHostTestEntry(options: { root: string; timeoutMs?: number }): string {
  const root = JSON.stringify(options.root);
  const hostTimeout = (options.timeoutMs ?? 180000) + 30000;
  return `
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
exports.run = async () => {
  const root = ${root};
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home || fs.realpathSync(require('node:os').homedir()) !== fs.realpathSync(home)) throw new Error('department EH HOME is not isolated');
  if (!process.env.CODEX_HOME || !fs.realpathSync(process.env.CODEX_HOME).startsWith(fs.realpathSync(home) + path.sep)) throw new Error('department EH CODEX_HOME is not isolated');
  const extensionId = 'sinitek.sinitek-cli-tools';
  const extension = vscode.extensions.getExtension(extensionId);
  if (!extension) throw new Error('production extension is missing');
  const { DepartmentExecutionOwnerClient } = require(path.join(extension.extensionPath, 'dist/runtime/departmentexecutionownerclient.js'));
  const seen = new Set();
  const protocolObservationErrors = path.join(root, 'original-owner-observation-errors.ndjson');
  let protocolObservationFailed = false;
  (${installDepartmentFullEhReceiptObserver.toString()})(DepartmentExecutionOwnerClient, observation => {
    const key = JSON.stringify(observation.identity);
    if (seen.has(key)) return;
    if (seen.size >= 64) throw new Error('original receipt observation budget exceeded');
    seen.add(key);
    fs.appendFileSync(path.join(root, 'original-owner-observations.ndjson'), JSON.stringify(observation) + '\\n', { mode: 0o600 });
  }, error => {
    fs.appendFileSync(path.join(root, 'original-owner-observation-errors.ndjson'), JSON.stringify({ error: String(error) }) + '\\n', { mode: 0o600 });
  });
  let protocolCount = 0;
  (${installDepartmentFullEhProtocolObserver.toString()})(require('node:child_process'), event => {
    if (++protocolCount > 4096) throw new Error('Owner protocol observation budget exceeded');
    fs.appendFileSync(path.join(root, 'original-owner-protocol.ndjson'), JSON.stringify(event) + '\\n', { mode: 0o600 });
  }, diagnostic => {
    protocolObservationFailed = true;
    try { fs.appendFileSync(protocolObservationErrors, JSON.stringify(diagnostic) + '\\n', { mode: 0o600 }); }
    catch { console.error('[department-full-eh] protocol-observer-diagnostic-write-failed'); }
  }, message => {
      const id = message.identity;
      const store = path.join(home, '.sinitek_cli', 'department-tasks-v1');
      const tasks = fs.readdirSync(store).filter(name => name.endsWith('.json') && !name.startsWith('.'))
        .flatMap(name => JSON.parse(fs.readFileSync(path.join(store, name), 'utf8')).tasks);
      const task = tasks.find(value => value.id === id.leaderTaskId);
      const { DepartmentRuntimeStore } = require(path.join(extension.extensionPath, 'dist/extensionHost/departmentruntimestore.js'));
      const saved = new DepartmentRuntimeStore(path.join(home, '.sinitek_cli/department-runtime')).read(id.rootTaskId, id.workspace);
      const target = id.role === 'employee' ? task?.subTasks.find(value => value.id === id.subtaskId) : task;
      const bindings = Array.isArray(saved.value?.executionBindings) ? saved.value.executionBindings : [];
      return { taskId: task?.id, session: target?.executionSession, runtimeOk: saved.ok,
        bindings: bindings.filter(value => value.identity.executionId === id.executionId),
        capacity: saved.value?.capacity };
  });
  await extension.activate();
  await vscode.commands.executeCommand('sinitek-cli-tools.openPanel');
  const taskStore = path.join(home, '.sinitek_cli', 'department-tasks-v1');
  if (fs.existsSync(taskStore)) {
    const entries = fs.readdirSync(taskStore).filter(name => name.endsWith('.json') && !name.startsWith('.'));
    if (entries.length) throw new Error('department task store was not empty at public-entry startup');
  }
  const initialSettings = JSON.parse(fs.readFileSync(path.join(home, '.sinitek_cli', 'settings.json'), 'utf8'));
  if (initialSettings.departmentEnabled === true) throw new Error('departmentEnabled must start disabled and be enabled through the public tool settings UI');
  fs.writeFileSync(path.join(root, 'host-ready.json'), JSON.stringify({ vscode: vscode.version, extensionPath: extension.extensionPath,
    extensionId, taskStoreWasEmpty: true, departmentEnabledAtStartup: false }));
  const deadline = Date.now() + ${hostTimeout};
  while (Date.now() < deadline && !fs.existsSync(path.join(root, 'host-finish.signal'))) await new Promise(resolve => setTimeout(resolve, 100));
  if (!fs.existsSync(path.join(root, 'host-finish.signal'))) throw new Error('public-entry harness did not signal normal host shutdown');
  if (protocolObservationFailed || fs.existsSync(protocolObservationErrors)) throw new Error('original Owner protocol observer reported a diagnostic');
};
`;
}

export function inspectDepartmentFullEhTaskStore(home: string): { empty: boolean; files: string[] } {
  const store = path.join(home, ".sinitek_cli", "department-tasks-v1");
  const files = fs.existsSync(store) ? fs.readdirSync(store).filter((name) => name.endsWith(".json") && !name.startsWith(".")) : [];
  return { empty: files.length === 0, files };
}
