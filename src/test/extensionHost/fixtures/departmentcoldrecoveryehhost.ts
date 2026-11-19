import { createDepartmentFullEhHostTestEntry, installDepartmentFullEhProtocolObserver, installDepartmentFullEhReceiptObserver } from "./departmentfullehproductionhost";
import { installColdPublicControlObserver } from "./departmentcoldstartproductionhost";

/** Delay only consumption of an ACTUAL successful original aggregate. It starts
 * the original operation once with unchanged receiver/arguments, propagates its
 * original rejection, and never resolves a receipt or a production operation. */
export function delayColdOriginalCleanup<T extends { observe(...args: any[]): { done: Promise<void> } | null }>(
  group: T, ready: (...args: any[]) => void, release: Promise<void>): T {
  const original = group.observe;
  group.observe = function (this: T, ...args: any[]) {
    const observed = original.apply(this, args);
    if (!observed) return observed;
    const done = observed.done.then(async () => { ready(...args); await release; });
    void done.catch(() => undefined);
    return { ...observed, done };
  };
  return group;
}

/** Atomic diagnostic publication; readers never mistake a truncated in-flight
 * JSON write for a production failure. Runtime source files are never touched. */
export function publishColdObservation(file: string, value: unknown): void {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.writeFileSync(file + ".pending", JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(file + ".pending", file);
}

/** Bind the passive OS observer to the actual fork and its original initialization.
 * Only public identity fields are copied. No ref/unref, IPC or cleanup changes. */
export function observeColdWorkerLifetimes(cp: typeof import("node:child_process"),
  record: (value: Record<string, unknown>) => void, failed: (error: unknown) => void): () => void {
  const original = cp.fork;
  const wrapped = new Proxy(original, { apply(target, receiver, args) {
    const child = Reflect.apply(target, receiver, args) as import("node:child_process").ChildProcess;
    const worker = String(args[0]).split(/[\\/]/).pop()!;
    if (!/^department(?:generationauthority|leaderprocessowner|leadercodexowner|codexowner|processowner)worker\.js$/.test(worker)) return child;
    const write = (event: Record<string, unknown>) => { try { record({ pid: child.pid, worker, at: Date.now(), ...event }); }
      catch (error) { try { failed(error); } catch { /* passive */ } } };
    let registered = false;
    child.send = new Proxy(child.send, { apply(send, owner, values) {
      try {
        const value = values[0];
        if (!registered && value && typeof value === "object" && (value.identity || value.scope)) {
          registered = true;
          const source = value.identity ?? value.scope;
          const identity = Object.fromEntries(["version", "rootTaskId", "workspace", "moduleId", "leaderTaskId", "generation", "role", "cli", "subtaskId", "attemptId", "ownerId", "executionId", "session", "configFingerprint", "profileFingerprint"]
            .filter(key => source[key] !== undefined).map(key => [key, structuredClone(source[key])]));
          write({ event: "worker-initialized", identity, ...(value.producerId ? { producerId: value.producerId } : {}) });
        }
      } catch { try { failed(new Error("passive-worker-observation-failed")); } catch { /* passive */ } }
      return Reflect.apply(send, owner, values);
    } });
    child.once("exit", (code, signal) => write({ event: "worker-exit", code, signal }));
    return child;
  } });
  cp.fork = wrapped;
  return () => { if (cp.fork === wrapped) cp.fork = original; };
}

/** First host uses exactly the established public-entry fixture. Only group
 * observation consumption is delayed; no task, receipt or capacity is written. */
export function createDepartmentColdRecoveryFirstEntry(options: { root: string; timeoutMs: number }): string {
  const base = createDepartmentFullEhHostTestEntry(options);
  const needle = "  await extension.activate();";
  if (base.split(needle).length !== 2) throw new Error("cold first activation boundary changed");
  return base.replace(needle, `
  (${observeColdWorkerLifetimes.toString()})(require('node:child_process'),
    event => fs.appendFileSync(path.join(root, 'cold-worker-registrations.ndjson'), JSON.stringify(event) + '\\n', { mode: 0o600 }),
    () => fs.appendFileSync(path.join(root, 'cold-worker-observer-errors.ndjson'), JSON.stringify({ error: 'passive-worker-observer-failed' }) + '\\n', { mode: 0o600 }));
  const cleanup = require(path.join(extension.extensionPath, 'dist/extensionHost/departmentproductioncleanup.js'));
  const factory = cleanup.createDepartmentProductionCleanup;
  cleanup.createDepartmentProductionCleanup = function(...args) {
    return (${delayColdOriginalCleanup.toString()})(Reflect.apply(factory, this, args), (task, generation) => {
      (${publishColdObservation.toString()})(path.join(root, 'cold-first-original-cleanup.json'), { taskId: task.id, generation, at: Date.now() });
    }, new Promise(() => {}));
  };
  const coldApi = require('node:module').createRequire(path.join(extension.extensionPath, 'package.json'))('vscode');
  const publicObserver = (${installColdPublicControlObserver.toString()})(coldApi.window);
  const observationTimer = setInterval(() => (${publishColdObservation.toString()})(path.join(root, 'cold-first-public.json'), publicObserver.diagnostics()), 50);
  observationTimer.unref();
${needle}`);
}

/** Passive observation of the real successful move-session/readback API.
 * Preserve its exact Promise/receiver and never publish private launch payloads. */
export function observeColdNativePreparation(module: { createDepartmentOpenCodeSession: (...args: any[]) => Promise<string> },
  record: (value: unknown) => void, failed: (error: unknown) => void): () => void {
  const original = module.createDepartmentOpenCodeSession;
  const wrapped: typeof original = function (this: unknown, ...args: any[]) {
    const input = args[0];
    const source = input?.retired;
    const evidence = source ? structuredClone({ retired: { identity: source.identity, selection: source.selection, directory: source.directory },
      directory: input.workspaceDirectory }) : null;
    const pending = Reflect.apply(original, this, args) as Promise<string>;
    if (evidence) void pending.then(sessionId => { try { record({ ...evidence, sessionId }); } catch (error) { failed(error); } }, () => undefined);
    return pending;
  };
  module.createDepartmentOpenCodeSession = wrapped;
  return () => { if (module.createDepartmentOpenCodeSession === wrapped) module.createDepartmentOpenCodeSession = original; };
}

/** Second host exercises production activation/session manager and public
 * commands only. Driver controls public DOM; snapshots and observers are passive. */
export function createDepartmentColdRecoverySecondEntry(options: { root: string; home: string; rootTaskId: string; deadline: number }): string {
  return `
const fs = require('node:fs'), path = require('node:path');
const vscode = require('vscode');
exports.run = async () => {
  const { root, home, rootTaskId, deadline } = ${JSON.stringify(options)};
  const extension = vscode.extensions.getExtension('sinitek.sinitek-cli-tools');
  if (!extension || fs.realpathSync(require('node:os').homedir()) !== fs.realpathSync(home)) throw new Error('cold second host isolation/extension mismatch');
  const api = require('node:module').createRequire(path.join(extension.extensionPath, 'package.json'))('vscode');
  const observer = (${installColdPublicControlObserver.toString()})(api.window);
  const { DepartmentRuntimeStore } = require(path.join(extension.extensionPath, 'dist/extensionHost/departmentruntimestore.js'));
  const { DepartmentExecutionOwnerClient } = require(path.join(extension.extensionPath, 'dist/runtime/departmentexecutionownerclient.js'));
  const store = new DepartmentRuntimeStore(path.join(home, '.sinitek_cli/department-runtime'));
  const snapshot = () => {
    const directory = path.join(home, '.sinitek_cli/department-tasks-v1');
    const tasks = fs.readdirSync(directory).filter(n => n.endsWith('.json') && !n.startsWith('.')).flatMap(n => JSON.parse(fs.readFileSync(path.join(directory, n), 'utf8')).tasks);
    const task = tasks.find(t => t.id === rootTaskId);
    const saved = task && store.read(rootTaskId, task.workspaceKey);
    if (!saved?.ok || !saved.value) throw new Error('cold second authoritative root missing');
    return { tasks, runtime: saved.value };
  };
  const publish = (${publishColdObservation.toString()});
  const write = (phase, value) => { const file = path.join(root, 'cold-positive-' + phase + '.json'); if (fs.existsSync(file)) throw new Error('duplicate cold snapshot: ' + phase); publish(file, value); };
  const protocol = [], errors = [], workers = [], nativePreparations = [];
  const nativeModule = require(path.join(extension.extensionPath, 'dist/runtime/departmentopencodesessionpreparation.js'));
  const restoreNativePreparation = (${observeColdNativePreparation.toString()})(nativeModule,
    value => { if (nativePreparations.length >= 64) throw new Error('cold native observation budget'); nativePreparations.push(value); },
    error => errors.push(String(error)));
  const cp = require('node:child_process');
  const restoreWorkers = (${observeColdWorkerLifetimes.toString()})(cp, event => {
    fs.appendFileSync(path.join(root, 'cold-worker-registrations.ndjson'), JSON.stringify(event) + '\\n', { mode: 0o600 });
    workers.push(event);
  }, () => errors.push('passive-worker-observer-failed'));
  const restoreProtocol = (${installDepartmentFullEhProtocolObserver.toString()})(cp, event => {
    if (protocol.length >= 4096) throw new Error('cold protocol observation limit');
    protocol.push(event);
  }, error => errors.push(error), message => {
    const current = snapshot(), id = message.identity;
    const task = current.tasks.find(t => t.id === id.leaderTaskId);
    const record = id.role === 'employee' ? task?.subTasks.find(t => t.id === id.subtaskId) : task;
    return { runtimeOk: true, taskId: task?.id, session: record?.executionSession,
      bindings: current.runtime.executionBindings.filter(b => b.identity.executionId === id.executionId), capacity: current.runtime.capacity };
  });
  const restoreReceipt = (${installDepartmentFullEhReceiptObserver.toString()})(DepartmentExecutionOwnerClient,
    value => fs.appendFileSync(path.join(root, 'original-owner-observations.ndjson'), JSON.stringify(value) + '\\n', { mode: 0o600 }), error => errors.push(String(error)));
  let phase = 'beforeActivation';
  try {
    write(phase, snapshot());
    await extension.activate();
    phase = 'afterActivation'; write(phase, snapshot());
    await api.commands.executeCommand('sinitek-cli-tools.openLoopGroupChat', rootTaskId);
    write('ready', { extensionId: extension.id, extensionPath: extension.extensionPath, vscode: vscode.version });
    while (Date.now() < deadline && !fs.existsSync(path.join(root, 'cold-positive-finish.signal'))) {
      for (const name of ['beforeControl', 'afterControl', 'afterContinue', 'afterFinalStop']) {
        if (fs.existsSync(path.join(root, 'cold-positive-capture-' + name)) && !fs.existsSync(path.join(root, 'cold-positive-' + name + '.json'))) write(name, snapshot());
      }
      publish(path.join(root, 'cold-positive-observer.json'), { ...observer.diagnostics(), protocol, errors, workers, nativePreparations });
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!fs.existsSync(path.join(root, 'cold-positive-finish.signal'))) throw new Error('cold second absolute deadline exhausted');
    if (errors.length || observer.diagnostics().errors.length) throw new Error('cold passive observer failed');
  } catch (error) {
    write('failure', { phase, error: String(error?.stack || error), observer: observer.diagnostics(), protocol, errors, workers, nativePreparations }); throw error;
  } finally { observer.restore(); restoreReceipt(); restoreProtocol(); restoreNativePreparation(); restoreWorkers(); }
};
`;
}
