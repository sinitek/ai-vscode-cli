import { createDepartmentFullEhHostTestEntry } from "./departmentfullehproductionhost";

/** Passive synchronous observation: preserve receiver, arguments, result and thrown error.
 * Recorder errors are diagnostic; they cannot turn a denial into an admission. */
export function observeAllocationMethod(target: Record<string, any>, key: string,
  record: (args: unknown[], result: unknown, receiver: any) => void, diagnostic: (error: unknown) => void): () => void {
  const original = target[key];
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const result = Reflect.apply(original, this, args);
    try { record(args, result, this); } catch (error) { try { diagnostic(error); } catch { /* preserve original result */ } }
    return result;
  };
  target[key] = wrapped;
  return () => { if (target[key] === wrapped) target[key] = original; };
}

/** Retain only the original ChildProcess observation handle, never ref/kill it.
 * Production deliberately unrefs workers; retaining an observer cannot grant work. */
export function observeAllocationWorkerExits(cp: typeof import("node:child_process"),
  record: (event: Record<string, unknown>) => void, diagnostic: (error: unknown) => void): () => void {
  const children = new Set<import("node:child_process").ChildProcess>();
  const original = cp.fork;
  const wrapped = new Proxy(original, { apply(target, receiver, args) {
    const child = Reflect.apply(target, receiver, args) as import("node:child_process").ChildProcess;
    if (!/department(?:leadercodex|codex)ownerworker\.js$/.test(String(args[0]))) return child;
    children.add(child);
    const write = (event: Record<string, unknown>) => { try { record({ pid: child.pid, at: Date.now(), ...event }); } catch (error) { try { diagnostic(error); } catch { /* observation cannot control the worker */ } } };
    write({ event: "worker-observed", module: String(args[0]) });
    child.once("exit", (code, signal) => { write({ event: "worker-exit", code, signal }); });
    child.once("close", (code, signal) => { write({ event: "worker-close", code, signal }); children.delete(child); });
    return child;
  } });
  cp.fork = wrapped;
  return () => { if (cp.fork === wrapped) cp.fork = original; children.clear(); };
}

/** Reuse the original public-entry/Owner observers; add only allocation evidence.
 * No writer invocation, grant replacement, scheduler mutation or synthetic reply. */
export function createDepartmentEmployeeAllocationEhHostEntry(options: { root: string; timeoutMs: number }): string {
  return createDepartmentFullEhHostTestEntry(options) + String.raw`
const allocationBaseRun = exports.run;
exports.run = async () => {
  const allocationRoot = ${JSON.stringify(options.root)};
  const restores = [], subscriptions = [];
  const record = value => fs.appendFileSync(path.join(allocationRoot, 'allocation-host.ndjson'), JSON.stringify(value) + '\n', { mode: 0o600 });
  const diagnostic = error => fs.appendFileSync(path.join(allocationRoot, 'allocation-observer-errors.ndjson'), JSON.stringify({ error: String(error) }) + '\n', { mode: 0o600 });
  restores.push((${observeAllocationWorkerExits.toString()})(require('node:child_process'), record, diagnostic));
  const extension = vscode.extensions.getExtension('sinitek.sinitek-cli-tools');
  // Observe original composition readers; never invoke them on behalf of production.
  const allocationModule = require(path.join(extension.extensionPath, 'dist/extensionHost/departmentemployeeallocationhost.js'));
  restores.push((${observeAllocationMethod.toString()})(allocationModule, 'createDepartmentEmployeeAllocationHost', (args, host) => {
    restores.push((${observeAllocationMethod.toString()})(host, 'readEmployeeCapacity', (ids, result) => {
      record({ event: 'capacity-reader', rootTaskId: ids[0], leaderTaskId: ids[1], result, at: Date.now() });
    }, diagnostic));
  }, diagnostic));
  const workspaceSettings = () => {
    const dir = path.join(process.env.HOME, '.sinitek_cli/workspace-settings');
    return fs.existsSync(dir) ? Object.fromEntries(fs.readdirSync(dir).filter(n => n.endsWith('.json'))
      .map(n => [n, JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))])) : {};
  };
  const { CliBridgeViewProvider } = require(path.join(extension.extensionPath, 'dist/webview/viewProvider.js'));
  const settingsObserved = new WeakSet();
  restores.push((${observeAllocationMethod.toString()})(CliBridgeViewProvider.prototype, 'resolveWebviewView', (args) => {
    const webview = args[0].webview;
    if (settingsObserved.has(webview)) return;
    settingsObserved.add(webview);
    subscriptions.push(webview.onDidReceiveMessage(message => {
      if (message?.type === 'updateSetting' && /^workspaceDepartmentMax(Leaders|Employees)$/.test(message.key)) {
        try { record({ event: 'settings-request', message, at: Date.now() }); } catch (error) { diagnostic(error); }
      }
    }));
  }, diagnostic));
  restores.push((${observeAllocationMethod.toString()})(CliBridgeViewProvider.prototype, 'postMessage', (args) => {
    const message = args[0];
    if (message?.type === 'workspaceDepartmentCapacitySaved') record({ event: 'settings-saved', message, workspaceSettings: workspaceSettings(), at: Date.now() });
  }, diagnostic));
  restores.push((${observeAllocationMethod.toString()})(CliBridgeViewProvider.prototype, 'postState', (args) => {
    const state = args[0];
    record({ event: 'settings-state', state: { departmentConfigurationScope: state.departmentConfigurationScope,
      departmentMaxLeaders: state.departmentMaxLeaders, departmentMaxEmployees: state.departmentMaxEmployees,
      workspaceDepartmentMaxLeaders: state.workspaceDepartmentMaxLeaders, workspaceDepartmentMaxEmployees: state.workspaceDepartmentMaxEmployees }, at: Date.now() });
  }, diagnostic));
  const { LoopGroupChatPanel } = require(path.join(extension.extensionPath, 'dist/webview/loopGroupChatPanel.js'));
  const observed = new WeakSet();
  restores.push((${observeAllocationMethod.toString()})(LoopGroupChatPanel.prototype, 'show', (args, result, panel) => {
    const webview = panel.panel?.webview;
    if (!webview || observed.has(webview)) return;
    observed.add(webview);
    subscriptions.push(webview.onDidReceiveMessage(message => {
      if (message?.type === 'loopGroupChatChat:updateDepartmentEmployeeLimit') {
        try { record({ event: 'webview-request', message, at: Date.now() }); } catch (error) { diagnostic(error); }
      } else if (message?.type === 'loopGroupChatChat:stopTask') {
        const state = panel.state;
        if (state?.department?.role === 'director' && state.task.id === state.department.rootTaskId) {
          try { record({ event: 'webview-stop', rootTaskId: state.task.id, at: Date.now() }); } catch (error) { diagnostic(error); }
        }
      }
    }));
  }, diagnostic));
  restores.push((${observeAllocationMethod.toString()})(LoopGroupChatPanel.prototype, 'post', (args) => {
    const message = args[0];
    if (message?.type === 'loopGroupChatChat:departmentEmployeeLimitSettled') record({ event: 'webview-settled', message, at: Date.now() });
  }, diagnostic));
  try { await allocationBaseRun(); }
  finally { subscriptions.forEach(s => s.dispose()); restores.reverse().forEach(restore => restore()); }
  if (fs.existsSync(path.join(allocationRoot, 'allocation-observer-errors.ndjson'))) throw new Error('allocation observation failed');
};
`;
}
