/** Generates the second, real Extension Host test entry. It observes durable
 * identities and asks only the original Owner's read-only observe endpoint. */
export type ColdRecoveryWarning = { message: string; rootTaskId: string | null; actionSequence: number };
export type ColdDeadlinePlan = { hostDeadline: number; actionDeadline: number; observationDeadline: number;
  evidenceDeadline: number; warningWindowMs: number };
/** One clock/budget for launch, public control, complete warning window, write and exit. */
export function createColdDeadlinePlan(now: number, timeoutMs: number): ColdDeadlinePlan {
  if (!Number.isFinite(now) || !Number.isFinite(timeoutMs) || timeoutMs < 100) throw new Error("invalid cold EH deadline budget");
  const reserve = Math.min(5000, timeoutMs / 10);
  const hostDeadline = now + timeoutMs;
  return { hostDeadline, actionDeadline: hostDeadline - 3 * reserve, observationDeadline: hostDeadline - 2 * reserve,
    evidenceDeadline: hostDeadline - reserve, warningWindowMs: Math.min(2000, reserve) };
}

export function coldRemaining(deadline: number, now: () => number = Date.now): number {
  const remaining = deadline - now();
  if (remaining <= 0) throw new Error("cold EH absolute deadline exhausted");
  return remaining;
}

export type ColdPublicStopAction = { rootTaskId: string; sequence: number };

/** Passive public-API observer. Install on the API resolved from the production
 * extension path before activation, including panels later reused by the command.
 * Root identity comes from the actual public document/patch, never the viewType. */
export function installColdPublicControlObserver(window: Pick<typeof import("vscode").window, "createWebviewPanel" | "showWarningMessage">) {
  const actions: Array<ColdPublicStopAction & { at: number; panel: number }> = [];
  const warnings: ColdRecoveryWarning[] = [];
  const messages: Array<{ panel: number; type: string; rootTaskId: string | null }> = [];
  const errors: string[] = [];
  const subscriptions: Array<{ dispose(): void }> = [];
  const restores: Array<() => void> = [];
  let active = true, panels = 0;
  const originalCreatePanel = window.createWebviewPanel;
  const originalWarning = window.showWarningMessage;
  const recordError = (error: unknown) => { if (errors.length < 16) errors.push(String(error)); };
  const readIdentity = (html: string, patch?: { subtitleText: string; headingText: string }) => {
    const subtitle = patch?.subtitleText ?? /<p id="panelSubtitle" title="([^"]*)"/.exec(html)?.[1];
    const heading = patch?.headingText ?? /<h1 id="panelHeading"[^>]*>([^<]*)<\/h1>/.exec(html)?.[1];
    // Task IDs are plain identifiers; refuse ambiguous/malformed public captions.
    const rootTaskId = typeof subtitle === "string" && /^[a-zA-Z0-9_-]+$/.test(subtitle) ? subtitle : null;
    return heading === "产研部群聊" && rootTaskId ? rootTaskId : null;
  };
  const wrappedCreate: typeof originalCreatePanel = function (this: unknown, ...args) {
    const panel = originalCreatePanel.apply(this, args);
    if (!active || args[0] !== "sinitek-cli-tools.loopGroupChatChat") return panel;
    const panelId = ++panels;
    if (panelId > 32) { recordError("cold public panel observation budget exceeded"); return panel; }
    let html = panel.webview.html;
    let patch: { subtitleText: string; headingText: string } | undefined;
    const currentIdentity = () => {
      if (html !== panel.webview.html) { html = panel.webview.html; patch = undefined; }
      return readIdentity(html, patch);
    };
    const originalPost = panel.webview.postMessage;
    const wrappedPost: typeof originalPost = function (this: unknown, ...postArgs) {
      if (active && postArgs[0]?.type === "loopGroupChatChat:contentPatch") {
        try { currentIdentity(); patch = { subtitleText: postArgs[0].subtitleText, headingText: postArgs[0].headingText }; }
        catch (error) { recordError(error); }
      }
      return originalPost.apply(this, postArgs);
    };
    panel.webview.postMessage = wrappedPost;
    restores.push(() => { if (panel.webview.postMessage === wrappedPost) panel.webview.postMessage = originalPost; });
    subscriptions.push(panel.webview.onDidReceiveMessage(message => {
      if (!active) return;
      try {
        const rootTaskId = currentIdentity();
        if (messages.length >= 128) { recordError("cold public message observation budget exceeded"); return; }
        messages.push({ panel: panelId, type: typeof message?.type === "string" ? message.type.slice(0, 96) : "unknown", rootTaskId });
        if (message?.type === "loopGroupChatChat:stopTask") {
          if (!rootTaskId) recordError("public stop arrived from an unbound or non-director panel");
          else actions.push({ rootTaskId, sequence: actions.length + 1, at: Date.now(), panel: panelId });
        }
      } catch (error) { recordError(error); }
    }));
    return panel;
  };
  const wrappedWarning: typeof originalWarning = function (this: unknown, ...args: any[]) {
    if (active) {
      if (warnings.length >= 32) recordError("cold public warning observation budget exceeded");
      else warnings.push({ message: String(args[0]), rootTaskId: actions.length === 1 ? actions[0].rootTaskId : null, actionSequence: actions.length });
    }
    return originalWarning.apply(this, args as Parameters<typeof originalWarning>);
  };
  window.createWebviewPanel = wrappedCreate;
  window.showWarningMessage = wrappedWarning;
  return {
    actions, warnings,
    readActions: () => { if (errors.length) throw new Error("cold public observer failed: " + errors.join("; ")); return actions; },
    diagnostics: () => ({ panels, messages, actions, warnings, errors }),
    restore: () => {
      active = false;
      if (window.createWebviewPanel === wrappedCreate) window.createWebviewPanel = originalCreatePanel;
      if (window.showWarningMessage === wrappedWarning) window.showWarningMessage = originalWarning;
      for (const restore of restores) { try { restore(); } catch (error) { recordError(error); } }
      for (const subscription of subscriptions) { try { subscription.dispose(); } catch (error) { recordError(error); } }
    },
  };
}

export async function waitForColdPublicStopAction(readActions: () => readonly ColdPublicStopAction[], expectedRootTaskId: string,
  deadline: number, pause: (ms: number) => Promise<void>, now: () => number = Date.now): Promise<ColdPublicStopAction> {
  do {
    const actions = readActions();
    if (actions.length > 1 || actions.some(action => action.rootTaskId !== expectedRootTaskId || action.sequence !== 1))
      throw new Error("public cold-recovery stop action was duplicate or belonged to another root: " + JSON.stringify(actions));
    if (actions.length === 1) return actions[0];
    if (now() >= deadline) throw new Error("public stop click signal was not followed by a delivered Webview stop action before its deadline");
    await pause(Math.min(25, Math.max(1, deadline - now())));
  } while (true);
}

/** Observe the whole bounded action window, so an early correct warning cannot
 * hide a later conflicting or duplicate result in that same window. */
export async function waitForColdRecoveryWarning(readWarnings: () => readonly ColdRecoveryWarning[], expectedRootTaskId: string,
  deadline: number, pause: (ms: number) => Promise<void>,
  readActions: () => readonly ColdPublicStopAction[], now: () => number = Date.now): Promise<string> {
  const expected = "部门恢复核验阻塞：live-leader-unverifiable。保留原占用，不能重新派发。";
  do {
    const actions = readActions();
    if (actions.length !== 1 || actions[0].rootTaskId !== expectedRootTaskId || actions[0].sequence !== 1)
      throw new Error("cold recovery action changed during its observation window: " + JSON.stringify(actions));
    const warnings = readWarnings();
    if (warnings.length > 1) throw new Error("cold recovery produced duplicate or mixed warnings: " + JSON.stringify(warnings));
    if (warnings.some(item => item.message !== expected || item.rootTaskId !== expectedRootTaskId || item.actionSequence !== 1))
      throw new Error("cold recovery warning is not the exact current public root action result: " + JSON.stringify(warnings));
    if (now() >= deadline) {
      if (warnings.length === 1) return warnings[0].message;
      throw new Error("cold recovery did not produce the exact action warning before its deadline");
    }
    await pause(Math.min(25, Math.max(1, deadline - now())));
  } while (true);
}

export function createDepartmentColdStartHostTestEntry(options: { root: string; home: string; product: string; rootTaskId: string; timeoutMs?: number; deadlines?: ColdDeadlinePlan }): string {
  const root = JSON.stringify(options.root), home = JSON.stringify(options.home), product = JSON.stringify(options.product);
  const rootTaskId = JSON.stringify(options.rootTaskId);
  const timeout = options.timeoutMs ?? 60000;
  const deadlineFactory = createColdDeadlinePlan.toString();
  const deadlines = options.deadlines ? JSON.stringify(options.deadlines) : `(${deadlineFactory})(Date.now(), ${timeout})`;
  const warningWaiter = waitForColdRecoveryWarning.toString();
  const stopActionWaiter = waitForColdPublicStopAction.toString();
  return `
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
exports.run = async () => {
  const root = ${root}, expectedHome = ${home}, product = ${product};
  // VS Code resolves its API by the requiring extension path. The external test
  // entry's default API is not the production extension's API object.
  const vscode = require('node:module').createRequire(path.join(product, 'package.json'))('vscode');
  const observer = (${installColdPublicControlObserver.toString()})(vscode.window);
  let phase = 'before-activation';
  const waitForCdpCleanup = async () => {
    const file = path.join(root, 'cold-cdp-cleanup.json');
    while (!fs.existsSync(file) && Date.now() < deadlines.hostDeadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (!fs.existsSync(file) || JSON.parse(fs.readFileSync(file, 'utf8')).confirmed !== true)
      throw new Error('cold driver did not confirm owned CDP release before EH exit');
  };
  const waitForColdRecoveryWarning = (${warningWaiter});
  const waitForColdPublicStopAction = (${stopActionWaiter});
  const expectedRootTaskId = ${rootTaskId};
  const deadlines = ${deadlines};
  const remaining = deadline => (${coldRemaining.toString()})(deadline);
  const bounded = async (work, deadline) => {
    let timer;
    try { return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('cold EH phase exceeded its absolute deadline')), remaining(deadline));
    })]); } finally { clearTimeout(timer); }
  };
  if (fs.realpathSync(os.homedir()) !== fs.realpathSync(expectedHome)) throw new Error('cold EH HOME is not isolated');
  if (!process.env.CODEX_HOME || !fs.realpathSync(process.env.CODEX_HOME).startsWith(fs.realpathSync(expectedHome) + path.sep)) throw new Error('cold EH CODEX_HOME is not isolated');
  const extension = vscode.extensions.getExtension('sinitek.sinitek-cli-tools');
  if (!extension || fs.realpathSync(extension.extensionPath) !== fs.realpathSync(product)) throw new Error('cold EH did not load the expected production extension');
  const apiIdentity = { activeAtObserverInstall: extension.isActive,
    productionApiMatches: require('node:module').createRequire(path.join(product, 'dist/extension.js'))('vscode') === vscode,
    externalEntryApiMatches: require('vscode') === vscode };
  if (!apiIdentity.productionApiMatches) throw new Error('cold observer API differs from the production entry API');
  const owned = path.join(expectedHome, '.sinitek_cli', 'department-tasks-v1');
  const markerPath = path.join(owned, '.department-source.json');
  const ownerPath = path.join(owned, '.department-owner.json');
  const identityDir = path.join(expectedHome, '.sinitek_cli', 'loop-task-identities');
  const catalogPath = path.join(identityDir, 'catalog.json');
  const readJson = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const { isDepartmentExecutionBinding } = require(path.join(product, 'dist/extensionHost/departmentruntimestate.js'));
  const { sameExecution } = require(path.join(product, 'dist/runtime/departmentexecutionidentity.js'));
  const { DepartmentRuntimeStore } = require(path.join(product, 'dist/extensionHost/departmentruntimestore.js'));
  const { DepartmentExecutionOwnerClient } = require(path.join(product, 'dist/runtime/departmentexecutionownerclient.js'));
  const { installDepartmentFullEhProtocolObserver } = require(path.join(product, 'dist/test/extensionHost/fixtures/departmentfullehproductionhost.js'));
  const protocolEvents = [];
  const protocolObservationErrors = path.join(root, 'original-owner-observation-errors.ndjson');
  let protocolObservationFailed = false;
  const restoreProtocolObserver = installDepartmentFullEhProtocolObserver(require('node:child_process'), event => {
    if (protocolEvents.length >= 4096) throw new Error('cold EH protocol observation budget exceeded');
    protocolEvents.push(event);
  }, diagnostic => {
    protocolObservationFailed = true;
    try { fs.appendFileSync(protocolObservationErrors, JSON.stringify(diagnostic) + '\\n', { mode: 0o600 }); }
    catch { console.error('[department-cold-start] protocol-observer-diagnostic-write-failed'); }
  });
  try {
  const runtimeStore = new DepartmentRuntimeStore(path.join(expectedHome, '.sinitek_cli', 'department-runtime'));
  const readSnapshot = () => {
    const taskFiles = fs.existsSync(owned) ? fs.readdirSync(owned).filter(name => name.endsWith('.json') && !name.startsWith('.')).sort() : [];
    const tasks = taskFiles.flatMap(file => JSON.parse(fs.readFileSync(path.join(owned, file), 'utf8')).tasks);
    const roots = tasks.filter(task => task.id === expectedRootTaskId && task.department?.role === 'director');
    const observations = [];
    for (const rootTask of roots) {
      const saved = runtimeStore.read(rootTask.id, rootTask.workspaceKey);
      if (!saved.ok || !saved.value) throw new Error('cold EH runtime snapshot unreadable: ' + saved.error);
      const currentScopes = saved.value.runtime.leaders;
      for (const binding of saved.value.executionBindings || []) {
        if (!currentScopes.some(member => member.taskId === binding.identity.leaderTaskId
          && member.leaderSubtaskId === binding.identity.moduleId && member.generation === binding.identity.generation)) continue;
        const identity = binding.identity;
        if (!isDepartmentExecutionBinding(binding)) throw new Error('cold EH execution binding failed the production validator');
        const leader = tasks.find(task => task.id === identity.leaderTaskId);
        const record = identity.role === 'employee' ? leader?.subTasks?.find(task => task.id === identity.subtaskId) : leader;
        const metadata = leader?.department;
        const route = identity.role === 'employee' ? metadata?.routes?.employee : metadata?.routes?.leader;
        if (JSON.stringify(rootTask.department?.routes) !== JSON.stringify(metadata?.routes))
          throw new Error('cold EH root and leader frozen role routes do not match');
        const member = saved.value.runtime.leaders.find(item => item.taskId === leader?.id && item.leaderSubtaskId === identity.moduleId);
        const module = rootTask.subTasks?.find(item => item.id === identity.moduleId);
        if (!leader || !record || rootTask.id !== identity.rootTaskId || rootTask.workspaceKey !== identity.workspace
          || rootTask.department?.role !== 'director' || rootTask.department?.rootTaskId !== rootTask.id
          || rootTask.department?.parentTaskId !== null || rootTask.department?.leaderSubtaskId !== null
          || rootTask.status !== 'running' || leader.status !== 'running'
          || leader.department?.role !== 'leader' || leader.department?.rootTaskId !== rootTask.id
          || leader.department?.parentTaskId !== rootTask.id || leader.department?.leaderSubtaskId !== identity.moduleId
          || leader.workspaceKey !== identity.workspace || !module || module.status !== 'running' || !member || member.generation !== identity.generation
          || record.executionSession?.cli !== identity.cli || record.executionSession?.sessionId !== identity.session.id
          || (record.executionSession?.configId ?? null) !== (binding.selection?.configId ?? null)
          || identity.session.state !== 'bound' || identity.cli !== route?.cli || binding.selection?.cli !== route?.cli
          || binding.selection?.role !== identity.role
          || (binding.selection?.configId ?? null) !== (route?.configId ?? null)
          || (binding.selection?.model ?? null) !== (route?.model ?? null)
          || (binding.selection?.thinkingMode ?? null) !== (route?.thinkingMode ?? null)
          || (binding.selection?.openCodeVariant ?? null) !== (route?.openCodeVariant ?? null))
          throw new Error('cold EH binding does not match the exact root/module/leader/generation/CLI/session/selection identity');
        if (identity.role === 'employee' && (record.status !== 'running'
          || !leader.loopPlus?.running?.some(item => item.subtaskId === identity.subtaskId && item.attemptId === identity.attemptId)))
          throw new Error('cold EH employee binding is not present in the current scheduler running set');
        if (identity.role === 'employee' && !(saved.value.capacity.employees || []).includes(JSON.stringify([identity.leaderTaskId, identity.attemptId])))
          throw new Error('cold EH employee binding has no matching retained capacity');
        if (identity.role === 'leader' && !(saved.value.capacity.leaders || []).includes(identity.moduleId))
          throw new Error('cold EH leader binding has no matching retained capacity');
        observations.push({ identity, selection: binding.selection, requirements: binding.requirements,
          capacity: structuredClone(saved.value.capacity), observation: null });
      }
    }
    return { taskFiles, tasks: structuredClone(tasks), roots: roots.map(rootTask => ({ id: rootTask.id, workspaceKey: rootTask.workspaceKey,
      runtime: runtimeStore.read(rootTask.id, rootTask.workspaceKey).value })), observations };
  };
  const beforeActivation = readSnapshot();
  if (!beforeActivation.roots.length || !beforeActivation.observations.length) throw new Error('cold EH requires real persisted department execution bindings');
  if (!beforeActivation.roots.some(item => item.id === expectedRootTaskId)) throw new Error('cold EH expected root is missing from the authoritative task source');
  if (!beforeActivation.observations.some(item => item.identity.rootTaskId === expectedRootTaskId && item.identity.role === 'employee'))
    throw new Error('cold EH expected root has no exact running employee binding');
  const markersBeforeActivation = { source: readJson(markerPath), owner: readJson(ownerPath), catalog: readJson(catalogPath) };
  phase = 'activating-extension';
  let activationError = null;
  try { await bounded(() => extension.activate(), deadlines.actionDeadline); } catch (error) { activationError = String(error && error.stack || error); }
  const activationUntil = deadlines.actionDeadline;
  while (!extension.isActive && !activationError && Date.now() < activationUntil) await new Promise(resolve => setTimeout(resolve, 50));
  if (!extension.isActive && !activationError) throw new Error('cold EH activation did not settle within its bound');
  if (activationError) {
    if (protocolObservationFailed || fs.existsSync(protocolObservationErrors)) throw new Error('cold EH protocol observer reported a diagnostic');
    const evidence = { phase: 'second-host', vscode: vscode.version, extensionPath: extension.extensionPath, activationError,
      sourceMarker: readJson(markerPath), ownerMarker: readJson(ownerPath), catalog: readJson(catalogPath), beforeActivation,
      productionRecovery: { trigger: null, observed: false, outcome: 'activation-error' }, protocolEvents };
    fs.writeFileSync(path.join(root, 'cold-second-host.json'), JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
    throw new Error('cold EH activation failed: ' + activationError);
  }
  for (const item of beforeActivation.observations) {
    item.observation = await bounded(() => new DepartmentExecutionOwnerClient(path.join(expectedHome, '.sinitek_cli', 'department-execution-owners', item.identity.ownerId))
      .observeExecution(item.identity), deadlines.actionDeadline);
    if (!sameExecution(item.identity, item.observation.identity)) throw new Error('original Owner observation identity differs from its durable binding');
  }
  const afterActivation = readSnapshot();
  const beforeControl = readSnapshot();
  const secondHostWarnings = observer.warnings;
  const actionObservations = observer.actions;
  let recoveryWarning;
  let afterRecoveryControl;
  {
    phase = 'opening-public-panel';
    await bounded(() => vscode.commands.executeCommand('sinitek-cli-tools.openLoopGroupChat', expectedRootTaskId), deadlines.actionDeadline);
    fs.writeFileSync(path.join(root, 'cold-second-host-ready.json'), JSON.stringify({ phase: 'public-recovery-control-ready', rootTaskId: expectedRootTaskId }), { flag: 'wx', mode: 0o600 });
    phase = 'awaiting-public-stop';
    const recoveryDeadline = deadlines.actionDeadline;
    while (!fs.existsSync(path.join(root, 'cold-recovery-check.signal')) && Date.now() < recoveryDeadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (!fs.existsSync(path.join(root, 'cold-recovery-check.signal'))) throw new Error('public recovery action was not triggered before its deadline');
    await waitForColdPublicStopAction(() => observer.readActions(),
      expectedRootTaskId, deadlines.actionDeadline, ms => new Promise(resolve => setTimeout(resolve, ms)));
    if (observer.readActions().length !== 1) throw new Error('exactly one public stop message must reach the expected root panel');
    phase = 'awaiting-production-warning';
    const warningDeadline = Math.min(Date.now() + deadlines.warningWindowMs, deadlines.observationDeadline);
    remaining(warningDeadline);
    recoveryWarning = await waitForColdRecoveryWarning(() => secondHostWarnings, expectedRootTaskId, warningDeadline,
      ms => new Promise(resolve => setTimeout(resolve, ms)), () => observer.readActions());
    remaining(deadlines.evidenceDeadline);
    afterRecoveryControl = readSnapshot();
  }
  fs.writeFileSync(path.join(root, 'cold-public-observer.json'), JSON.stringify({ phase, apiIdentity, ...observer.diagnostics() }, null, 2), { mode: 0o600 });
  const evidence = { phase: 'second-host', vscode: vscode.version, extensionPath: extension.extensionPath, activationError,
    sourceMarker: readJson(markerPath), ownerMarker: readJson(ownerPath), catalog: readJson(catalogPath), markersBeforeActivation, beforeActivation,
    afterActivation, beforeControl, afterControl: afterRecoveryControl,
    originalOwnerObservations: beforeActivation.observations.map(item => ({ identity: item.identity, result: item.observation })),
    productionRecovery: { trigger: 'public-department-stop', actionTriggered: true, observed: true,
      outcome: 'blocked', reason: 'live-leader-unverifiable', warning: recoveryWarning, allWarnings: secondHostWarnings, actionObservations, deadlines, observationWindowMs: deadlines.warningWindowMs,
      markersAfterControl: { source: readJson(markerPath), owner: readJson(ownerPath), catalog: readJson(catalogPath) } },
    protocolEvents };
  if (protocolObservationFailed || fs.existsSync(protocolObservationErrors)) throw new Error('cold EH protocol observer reported a diagnostic');
  remaining(deadlines.evidenceDeadline);
  fs.writeFileSync(path.join(root, 'cold-second-host.json'), JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
  phase = 'awaiting-driver-cdp-release';
  await waitForCdpCleanup();
  } catch (error) {
    // Preserve the earliest concrete failure even when the driver/host deadline
    // subsequently expires. No task contents, credentials or renderer internals.
    try {
      fs.writeFileSync(path.join(root, 'cold-second-host-failure.json'), JSON.stringify({ phase,
        error: String(error && error.stack || error), apiIdentity, observer: observer.diagnostics() }, null, 2), { flag: 'wx', mode: 0o600 });
    } catch (diagnosticError) { console.error('cold observation diagnostic write failed: ' + String(diagnosticError)); }
    try { await waitForCdpCleanup(); } catch (cleanupError) { console.error(String(cleanupError)); }
    throw error;
  } finally { observer.restore(); restoreProtocolObserver(); }
};
`;
}
