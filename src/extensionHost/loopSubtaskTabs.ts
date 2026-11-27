import { getConversationTabSessionIdForCli, type ConversationTabRecord } from "../sessionTabs";
import type { LoopSubtaskConversationContext } from "../loopConversationPresentation";
import type { LoopTaskRecord } from "../loopTaskStore";
import { normalizeLoopSubtaskSession } from "../loopSubtaskSession";
import type { TaskRunRecord } from "../promptRunState";
import type { ChatMessage } from "../webview/types";
import { createLoopPlusScheduler, type LoopPlusSeenAttempt } from "../loopPlusScheduler";

type LoopSubtaskTabContext = {
  taskId: string;
  subtaskId: string;
  attemptId?: string;
};

type RestoredCleanupEvidence = {
  targetRun: TaskRunRecord;
  latestRuns: ReadonlyMap<string, TaskRunRecord>;
  attempts: readonly LoopPlusSeenAttempt[] | null;
  reservedSessions: ReadonlySet<string>;
};

export function usesCompletedLoopSubtaskTabCleanup(task: Pick<LoopTaskRecord, "department" | "departmentInvalid">): boolean {
  return !task.departmentInvalid && (!task.department
    || (task.department.role === "leader" && task.department.executionMode === "loop-plus"));
}

export function resolveCompletedLoopSubtaskTabBinding(
  task: Pick<LoopTaskRecord, "id" | "workspaceKey" | "department" | "departmentInvalid"> | null,
  workspaceKey: string,
  input: {
    taskRole?: string;
    loopTaskId?: string;
    loopSubtaskId?: string;
    loopRound?: number;
    loopAttemptId?: string;
  },
): { context: LoopSubtaskConversationContext; provisional: boolean } | null {
  if (input.taskRole !== "subtask" || !input.loopTaskId || !input.loopSubtaskId || !input.loopRound) return null;
  const context = {
    taskId: input.loopTaskId,
    subtaskId: input.loopSubtaskId,
    round: input.loopRound,
    attemptId: input.loopAttemptId,
  };
  if (!task) return { context, provisional: true };
  if (task.workspaceKey !== workspaceKey || task.id !== input.loopTaskId || !usesCompletedLoopSubtaskTabCleanup(task)) return null;
  return { context, provisional: false };
}

function sessionKey(cli: ConversationTabRecord["cli"], sessionId: string | null): string {
  return JSON.stringify([cli, sessionId]);
}

export async function retryLoopSubtaskTabClose(
  close: () => Promise<void>,
  onFailure: (error: unknown, attempt: number, retrying: boolean) => void,
  retryDelayMs = 100,
): Promise<number> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await close();
      return attempt;
    } catch (error) {
      const retrying = attempt < 2;
      onFailure(error, attempt, retrying);
      if (!retrying) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error("子任务标签关闭重试未完成。");
}

export function createCompletedLoopSubtaskTabCleanup(deps: {
  getWorkspaceKey: () => string;
  getTabs: () => readonly ConversationTabRecord[];
  isTabRunActive: (tabId: string) => boolean;
  closeTab: (tab: ConversationTabRecord) => Promise<void>;
  restoredEvidence?: {
    readMessages: (cli: ConversationTabRecord["cli"], sessionId: string, workspace: string) => readonly ChatMessage[];
    readRuns: () => readonly TaskRunRecord[];
    readRunsRevision?: () => string;
    readTask: (taskId: string) => Pick<LoopTaskRecord, "workspaceKey" | "department" | "departmentInvalid" | "schedulingMode" | "loopPlus" | "subTasks"> | null;
  };
}) {
  type Binding = {
    context: LoopSubtaskConversationContext;
    workspace: string;
    cli: ConversationTabRecord["cli"];
    order: number;
    idle: { sessionId: string | null } | null;
    provisional: boolean;
  };
  const bindings = new WeakMap<ConversationTabRecord, Binding>();
  const restoredTabs = new WeakMap<ConversationTabRecord, {
    workspace: string;
    cli: ConversationTabRecord["cli"];
    sessionId: string;
    restoredAt: number;
  }>();
  let order = 0;

  function rememberRestoredTabs(tabs: readonly ConversationTabRecord[]) {
    const workspace = deps.getWorkspaceKey();
    const restoredAt = Date.now();
    for (const tab of tabs) {
      const sessionId = getConversationTabSessionIdForCli(tab, tab.cli);
      if (sessionId) restoredTabs.set(tab, { workspace, cli: tab.cli, sessionId, restoredAt });
    }
  }

  function forgetRestoredTab(tab: ConversationTabRecord) {
    restoredTabs.delete(tab);
  }

  function bindPrompt(tab: ConversationTabRecord, context: LoopSubtaskConversationContext | null, options?: { provisional?: boolean }) {
    forgetRestoredTab(tab);
    if (!context) {
      bindings.delete(tab);
      return undefined;
    }
    const binding: Binding = {
      context: { ...context }, workspace: deps.getWorkspaceKey(), cli: tab.cli, order: ++order, idle: null,
      provisional: options?.provisional === true,
    };
    bindings.set(tab, binding);
    return (sessionId: string | null) => {
      if (bindings.get(tab) === binding && deps.getWorkspaceKey() === binding.workspace
        && tab.cli === binding.cli && getConversationTabSessionIdForCli(tab, binding.cli) === sessionId) {
        binding.idle = { sessionId };
      }
    };
  }

  function readIdleBinding(tab: ConversationTabRecord, workspace: string, requireInactive = true) {
    const binding = bindings.get(tab);
    if (!binding?.idle || binding.workspace !== workspace || binding.cli !== tab.cli
      || binding.idle.sessionId !== getConversationTabSessionIdForCli(tab, tab.cli)
      || (requireInactive && deps.isTabRunActive(tab.id))) return null;
    return binding;
  }

  function readRestoredEvidence(
    tab: ConversationTabRecord,
    workspace: string,
    expected: LoopSubtaskConversationContext,
    tabs: readonly ConversationTabRecord[],
    readSharedEvidence: () => RestoredCleanupEvidence | null,
  ) {
    const restored = restoredTabs.get(tab);
    const evidence = deps.restoredEvidence;
    if (!restored || !evidence || restored.workspace !== workspace || restored.cli !== tab.cli
      || restored.sessionId !== getConversationTabSessionIdForCli(tab, tab.cli) || deps.isTabRunActive(tab.id)
      || tabs.some((other) => other !== tab && other.cli === restored.cli
        && getConversationTabSessionIdForCli(other, restored.cli) === restored.sessionId)) return null;

    let messages: readonly ChatMessage[];
    try {
      messages = evidence.readMessages(restored.cli, restored.sessionId, workspace);
    } catch {
      return null;
    }
    let prompt: ChatMessage | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        prompt = messages[index];
        break;
      }
    }
    if (prompt?.taskRole !== "subtask" || prompt.loopAsk === true || !prompt.id
      || prompt.loopTaskId !== expected.taskId || prompt.loopSubtaskId !== expected.subtaskId
      || typeof prompt.loopRound !== "number" || !Number.isInteger(prompt.loopRound)
      || prompt.loopRound < 1 || prompt.loopRound > expected.round
      || typeof prompt.createdAt !== "number" || !Number.isFinite(prompt.createdAt)
      || !(tab.createdAt <= prompt.createdAt)) return null;

    const shared = readSharedEvidence();
    const key = sessionKey(restored.cli, restored.sessionId);
    if (!shared || shared.reservedSessions.has(key)) return null;
    const run = shared.latestRuns.get(key);
    if (run?.status !== "end" || run.taskRole !== "subtask" || run.loopTaskId !== prompt.loopTaskId
      || run.loopSubtaskId !== prompt.loopSubtaskId || run.loopRound !== prompt.loopRound
      || run.loopAttemptId !== prompt.loopAttemptId || !(tab.createdAt <= run.startedAt)
      || !(prompt.createdAt < run.endedAt && run.startedAt <= run.endedAt
        && run.endedAt < shared.targetRun.startedAt && run.endedAt < restored.restoredAt)) return null;

    const { attempts } = shared;
    if (attempts) {
      if (!run.loopAttemptId || !expected.attemptId) return null;
      const previous = attempts.findIndex((attempt) => attempt.subtaskId === expected.subtaskId && attempt.attemptId === run.loopAttemptId);
      const completing = attempts.findIndex((attempt) => attempt.subtaskId === expected.subtaskId && attempt.attemptId === expected.attemptId);
      if (previous < 0 || previous >= completing || attempts[previous].disposition === "open") return null;
    }
    return JSON.stringify([restored.cli, restored.sessionId, prompt.id, prompt.createdAt, run.id, run.endedAt, run.loopRound, run.loopAttemptId]);
  }

  type CloseIdentityReason =
    | "tab-absent"
    | "workspace-changed"
    | "binding-absent"
    | "context-mismatch"
    | "cli-mismatch"
    | "session-mismatch"
    | "idle-pending"
    | "run-active"
    | "task-unreadable"
    | "cleanup-ineligible"
    | "identity-unknown";
  type CloseIdentityPhase = "bind" | "release" | "commit" | "close";
  type CloseIdentityFlags = {
    tabPresent: boolean;
    workspaceMatch: boolean;
    bindingPresent: boolean;
    contextMatch: boolean;
    cliMatch: boolean;
    sessionMatch: boolean;
    idleSettled: boolean;
    runReleased: boolean;
    taskReadable: boolean;
    cleanupAllowed: boolean;
  };
  type ReadyInspection = { ready: true; tab: ConversationTabRecord; binding: Binding; index: number };
  type FailedInspection = { ready: false; reason: CloseIdentityReason; phase: CloseIdentityPhase; flags: CloseIdentityFlags };

  function blankIdentityFlags(): CloseIdentityFlags {
    return {
      tabPresent: false, workspaceMatch: false, bindingPresent: false, contextMatch: false, cliMatch: false,
      sessionMatch: false, idleSettled: false, runReleased: false, taskReadable: false, cleanupAllowed: false,
    };
  }

  function identityBit(value: boolean): "0" | "1" {
    return value ? "1" : "0";
  }

  function identityRefusal(inspection: FailedInspection): Error {
    const { flags } = inspection;
    const policy = inspection.reason === "task-unreadable" || inspection.reason === "cleanup-ineligible"
      ? ` taskReadable=${identityBit(flags.taskReadable)} cleanupAllowed=${identityBit(flags.cleanupAllowed)}`
      : "";
    const detail = `reason=${inspection.reason} phase=${inspection.phase} tab=${identityBit(flags.tabPresent)} workspace=${identityBit(flags.workspaceMatch)} binding=${identityBit(flags.bindingPresent)} context=${identityBit(flags.contextMatch)} cli=${identityBit(flags.cliMatch)} session=${identityBit(flags.sessionMatch)} idle=${identityBit(flags.idleSettled)} released=${identityBit(flags.runReleased)}${policy}`;
    if (inspection.reason === "workspace-changed") return new Error(`工作区已切换，忽略原子任务标签清理。 ${detail}`);
    if (inspection.reason === "context-mismatch" || inspection.reason === "cli-mismatch" || inspection.reason === "session-mismatch"
      || (inspection.reason === "identity-unknown" && inspection.phase === "bind")) {
      return new Error(`子任务标签当前执行身份已变化，保留当前标签。 ${detail}`);
    }
    return new Error(`子任务标签当前执行身份无法核验，未执行自动关闭。 ${detail}`);
  }

  function inspectCloseTarget(tabId: string, expected: LoopSubtaskConversationContext, workspace: string, requireInactive: boolean): ReadyInspection | FailedInspection {
    const flags = blankIdentityFlags();
    if (deps.getWorkspaceKey() !== workspace) return { ready: false, reason: "workspace-changed", phase: "close", flags };
    flags.workspaceMatch = true;
    const tabs = deps.getTabs();
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return { ready: false, reason: "tab-absent", phase: "close", flags };
    const tab = tabs[index];
    flags.tabPresent = true;
    flags.runReleased = !deps.isTabRunActive(tab.id);
    const binding = bindings.get(tab);
    if (!binding) return { ready: false, reason: "binding-absent", phase: "bind", flags };
    flags.bindingPresent = true;
    flags.contextMatch = binding.context.taskId === expected.taskId && binding.context.subtaskId === expected.subtaskId
      && binding.context.round === expected.round && binding.context.attemptId === expected.attemptId;
    flags.cliMatch = binding.cli === tab.cli;
    if (!flags.contextMatch) return { ready: false, reason: "context-mismatch", phase: "bind", flags };
    if (binding.workspace !== workspace) {
      flags.workspaceMatch = false;
      return { ready: false, reason: "workspace-changed", phase: "close", flags };
    }
    if (!flags.cliMatch) return { ready: false, reason: "cli-mismatch", phase: "bind", flags };
    if (!binding.idle) return { ready: false, reason: "idle-pending", phase: "bind", flags };
    flags.idleSettled = true;
    flags.sessionMatch = binding.idle.sessionId === getConversationTabSessionIdForCli(tab, tab.cli);
    if (!flags.sessionMatch) return { ready: false, reason: "session-mismatch", phase: "bind", flags };
    if (requireInactive && !flags.runReleased) return { ready: false, reason: "run-active", phase: "release", flags };
    return { ready: true, tab, binding, index };
  }

  function provisionalPolicy(binding: Binding, workspace: string, expected: LoopSubtaskConversationContext): FailedInspection | null {
    if (!binding.provisional) return null;
    const evidence = deps.restoredEvidence;
    if (!evidence) {
      const flags = blankIdentityFlags();
      flags.tabPresent = true;
      flags.workspaceMatch = binding.workspace === workspace;
      flags.bindingPresent = true;
      flags.contextMatch = binding.context.taskId === expected.taskId && binding.context.subtaskId === expected.subtaskId
        && binding.context.round === expected.round && binding.context.attemptId === expected.attemptId;
      flags.idleSettled = binding.idle !== null;
      flags.cliMatch = true;
      flags.sessionMatch = flags.idleSettled;
      return { ready: false, reason: "identity-unknown", phase: "commit", flags };
    }
    const flags = blankIdentityFlags();
    flags.tabPresent = true;
    flags.workspaceMatch = true;
    flags.bindingPresent = true;
    flags.contextMatch = true;
    flags.cliMatch = true;
    flags.idleSettled = binding.idle !== null;
    let task: ReturnType<NonNullable<typeof deps.restoredEvidence>["readTask"]> | undefined;
    try {
      task = evidence.readTask(expected.taskId);
    } catch {
      task = undefined;
    }
    const tab = deps.getTabs().find((item) => bindings.get(item) === binding);
    flags.runReleased = tab ? !deps.isTabRunActive(tab.id) : false;
    flags.cliMatch = tab ? binding.cli === tab.cli : false;
    flags.sessionMatch = Boolean(tab && binding.idle && binding.idle.sessionId === getConversationTabSessionIdForCli(tab, tab.cli));
    if (!task) return { ready: false, reason: "task-unreadable", phase: "commit", flags };
    flags.taskReadable = true;
    flags.workspaceMatch = task.workspaceKey === workspace;
    flags.cleanupAllowed = flags.workspaceMatch && usesCompletedLoopSubtaskTabCleanup(task);
    if (!flags.cleanupAllowed) return { ready: false, reason: "cleanup-ineligible", phase: "close", flags };
    return null;
  }

  function captureIdleAnchor(tabId: string, expected: LoopSubtaskConversationContext, workspace: string): { tab: ConversationTabRecord; binding: Binding; cli: ConversationTabRecord["cli"] } | null {
    if (deps.getWorkspaceKey() !== workspace) return null;
    const tab = deps.getTabs().find((item) => item.id === tabId);
    if (!tab) return null;
    const binding = bindings.get(tab);
    if (!binding || binding.workspace !== workspace || binding.cli !== tab.cli || binding.idle) return null;
    if (binding.context.taskId !== expected.taskId || binding.context.subtaskId !== expected.subtaskId
      || binding.context.round !== expected.round || binding.context.attemptId !== expected.attemptId) return null;
    return { tab, binding, cli: binding.cli };
  }

  function prepareClose(tabId: string, expected: LoopSubtaskConversationContext): () => Promise<void> {
    const workspace = deps.getWorkspaceKey();
    const prepared = inspectCloseTarget(tabId, expected, workspace, false);
    const anchor = captureIdleAnchor(tabId, expected, workspace);
    if (!prepared.ready) {
      return async () => {
        if (deps.getWorkspaceKey() !== workspace) {
          throw identityRefusal({ ready: false, reason: "workspace-changed", phase: "close", flags: blankIdentityFlags() });
        }
        if (!anchor) {
          const live = inspectCloseTarget(tabId, expected, workspace, true);
          if (!live.ready) {
            if (live.reason === "tab-absent" && live.flags.workspaceMatch) return;
            throw identityRefusal(live);
          }
          throw identityRefusal({
            ready: false, reason: "identity-unknown", phase: "close",
            flags: { ...blankIdentityFlags(), tabPresent: true, workspaceMatch: true, bindingPresent: true, contextMatch: true, cliMatch: true, sessionMatch: true, idleSettled: true, runReleased: true },
          });
        }
        const tabs = deps.getTabs();
        if (!tabs.includes(anchor.tab)) return;
        const current = tabs.find((item) => item.id === anchor.tab.id);
        const rebound = current !== anchor.tab || bindings.get(anchor.tab) !== anchor.binding || anchor.tab.cli !== anchor.cli;
        if (rebound) {
          const replacement = bindings.get(anchor.tab);
          const flags = blankIdentityFlags();
          flags.tabPresent = true;
          flags.workspaceMatch = true;
          flags.bindingPresent = Boolean(replacement);
          flags.contextMatch = Boolean(replacement && replacement.context.taskId === expected.taskId
            && replacement.context.subtaskId === expected.subtaskId && replacement.context.round === expected.round
            && replacement.context.attemptId === expected.attemptId);
          flags.cliMatch = anchor.tab.cli === anchor.cli;
          flags.idleSettled = Boolean(replacement?.idle);
          flags.sessionMatch = Boolean(replacement?.idle && replacement.idle.sessionId === getConversationTabSessionIdForCli(anchor.tab, anchor.tab.cli));
          flags.runReleased = !deps.isTabRunActive(anchor.tab.id);
          throw identityRefusal({ ready: false, reason: "identity-unknown", phase: "bind", flags });
        }
        const live = inspectCloseTarget(anchor.tab.id, expected, workspace, true);
        if (!live.ready) throw identityRefusal(live);
        await closeVerified(live)();
      };
    }
    return closeVerified(prepared);

    function closeVerified(inspection: ReadyInspection): () => Promise<void> {
    const target = inspection.binding;
    const targetTab = inspection.tab;
    const index = inspection.index;
    const tabs = deps.getTabs();
    const targetSessionId = getConversationTabSessionIdForCli(targetTab, targetTab.cli);
    let history: { revision: string | undefined; latestRuns: Map<string, TaskRunRecord>; targetRun: TaskRunRecord | undefined } | undefined;

    function createSharedEvidenceReader(beforeCommit = false) {
      let shared: RestoredCleanupEvidence | null | undefined;
      return () => shared === undefined ? (shared = readSharedEvidence(beforeCommit)) : shared;
    }

    function readSharedEvidence(beforeCommit: boolean): RestoredCleanupEvidence | null {
      const evidence = deps.restoredEvidence;
      if (!evidence) return null;
      try {
        const revision = evidence.readRunsRevision?.();
        if (!history || revision === undefined || history.revision !== revision) {
          const latestRuns = new Map<string, TaskRunRecord>();
          let targetRun: TaskRunRecord | undefined;
          for (const run of evidence.readRuns()) {
            latestRuns.set(sessionKey(run.cli, run.sessionId), run);
            if (run.cli === targetTab.cli && run.sessionId === targetSessionId && run.status === "end"
              && run.taskRole === "subtask" && run.loopTaskId === expected.taskId
              && run.loopSubtaskId === expected.subtaskId && run.loopRound === expected.round
              && run.loopAttemptId === expected.attemptId) targetRun = run;
          }
          if (revision !== evidence.readRunsRevision?.()) return null;
          history = { revision, latestRuns, targetRun };
        }
        const { targetRun, latestRuns } = history;
        if (!targetRun) return null;
        const task = evidence.readTask(expected.taskId);
        if (task?.workspaceKey !== workspace || !usesCompletedLoopSubtaskTabCleanup(task)) return null;
        const reservedSessions = new Set<string>();
        if (task.schedulingMode !== "event_driven") return { targetRun, latestRuns, attempts: null, reservedSessions };
        const snapshot = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
        const subtasks = new Map(task.subTasks.map((subtask) => [subtask.id, subtask]));
        for (const execution of [...snapshot.pending, ...snapshot.running]) {
          if (execution.subtaskId === expected.subtaskId && execution.attemptId === expected.attemptId) {
            if (beforeCommit) continue;
            return null;
          }
          const subtask = subtasks.get(execution.subtaskId);
          const source = subtasks.get(subtask?.continueFromSubtaskId || execution.subtaskId);
          if (!subtask || !source) return null;
          const continuation = normalizeLoopSubtaskSession(source.executionSession);
          if (continuation) reservedSessions.add(sessionKey(continuation.cli, continuation.sessionId));
          const runningSession = execution.state === "running" ? normalizeLoopSubtaskSession(subtask.executionSession) : undefined;
          if (runningSession) reservedSessions.add(sessionKey(runningSession.cli, runningSession.sessionId));
        }
        return { targetRun, latestRuns, attempts: snapshot.seenAttempts, reservedSessions };
      } catch {
        return null;
      }
    }

    const readBeforeCommit = createSharedEvidenceReader(true);
    type CloseCandidate = {
      tab: ConversationTabRecord;
      binding: Binding | undefined;
      isCurrent: (currentTabs: readonly ConversationTabRecord[], readCurrent: () => RestoredCleanupEvidence | null) => boolean;
    };
    const candidates: CloseCandidate[] = tabs.slice(0, index + 1).flatMap((tab): CloseCandidate[] => {
      const binding = tab.id === tabId ? target : readIdleBinding(tab, workspace);
      if (binding) {
        if (binding.order > target.order || binding.context.round > expected.round
          || binding.context.taskId !== expected.taskId || binding.context.subtaskId !== expected.subtaskId) return [];
        return [{ tab, binding, isCurrent: () => readIdleBinding(tab, workspace) === binding }];
      }
      const evidence = readRestoredEvidence(tab, workspace, expected, tabs, readBeforeCommit);
      return evidence === null ? [] : [{ tab, binding: undefined, isCurrent: (currentTabs, readCurrent) => (
        readRestoredEvidence(tab, workspace, expected, currentTabs, readCurrent) === evidence
      ) }];
    });
    return async () => {
      const failures: string[] = [];
      let readCurrent = createSharedEvidenceReader();
      for (const { tab, binding, isCurrent } of candidates) {
        if (deps.getWorkspaceKey() !== workspace) {
          failures.push("工作区已切换，忽略原子任务标签清理。");
          break;
        }
        const currentTabs = deps.getTabs();
        const current = currentTabs.find((item) => item.id === tab.id);
        if (!current) continue;
        if (current !== tab || !isCurrent(currentTabs, readCurrent)) {
          if (tab.id === tabId) failures.push(`${tab.id}: 子任务标签当前执行身份已变化，保留当前标签。`);
          continue;
        }
        if (binding?.provisional) {
          const policy = provisionalPolicy(binding, workspace, expected);
          if (policy) {
            if (tab.id === tabId) failures.push(identityRefusal(policy).message);
            continue;
          }
        }
        try {
          await deps.closeTab(tab);
          if (deps.getWorkspaceKey() === workspace && deps.getTabs().includes(tab)) {
            throw new Error("子任务标签关闭未生效，保留标签以便重试。");
          }
        } catch (error) {
          failures.push(`${tab.id}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          readCurrent = createSharedEvidenceReader();
        }
      }
      if (failures.length) throw new Error(failures.join("\n"));
    };
    }
  }

  return { bindPrompt, rememberRestoredTabs, forgetRestoredTab, prepareClose };
}

export function findRunningLoopSubtaskConversationTabId(
  context: LoopSubtaskTabContext,
  deps: {
    getTabs: () => readonly ConversationTabRecord[];
    resolveContext: (tab: ConversationTabRecord) => LoopSubtaskTabContext | null;
    isTabRunActive: (tabId: string) => boolean;
  },
): string | null {
  const tabs = deps.getTabs();
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    const tab = tabs[index];
    if (!deps.isTabRunActive(tab.id)) continue;
    const candidate = deps.resolveContext(tab);
    if (candidate?.taskId === context.taskId && candidate.subtaskId === context.subtaskId
      && (context.attemptId === undefined || candidate.attemptId === context.attemptId)) {
      return tab.id;
    }
  }
  return null;
}

export function prepareLoopSubtaskConversationTabClose(
  context: LoopSubtaskTabContext & { tabId?: string | null },
  deps: {
    getTabs: () => readonly ConversationTabRecord[];
    resolveContext: (tab: ConversationTabRecord) => LoopSubtaskTabContext | null;
    isTabRunActive: (tabId: string) => boolean;
    closeTab: (tabId: string) => Promise<void>;
  },
): () => Promise<void> {
  const tabs = [...deps.getTabs()];
  const currentIndex = context.tabId ? tabs.findIndex((tab) => tab.id === context.tabId) : tabs.length - 1;
  const candidates = tabs.slice(0, currentIndex + 1).filter((tab) => {
    if (tab.id === context.tabId) {
      const candidate = deps.resolveContext(tab);
      return context.attemptId === undefined || candidate?.attemptId === context.attemptId;
    }
    const candidate = deps.resolveContext(tab);
    return candidate?.taskId === context.taskId && candidate.subtaskId === context.subtaskId
      && (context.attemptId === undefined || candidate.attemptId === context.attemptId);
  }).map((tab) => ({ tab, cli: tab.cli, sessionId: getConversationTabSessionIdForCli(tab, tab.cli) }));
  return async () => {
    const failures: Array<{ tabId: string; error: unknown }> = [];
    for (const { tab, cli, sessionId } of candidates) {
      const current = deps.getTabs().find((item) => item.id === tab.id);
      if (!current) continue;
      const candidate = deps.resolveContext(current);
      if (current !== tab || current.cli !== cli || getConversationTabSessionIdForCli(current, cli) !== sessionId
        || (candidate && (candidate.taskId !== context.taskId || candidate.subtaskId !== context.subtaskId
          || (context.attemptId !== undefined && candidate.attemptId !== context.attemptId)))
        || (context.attemptId !== undefined && candidate?.attemptId !== context.attemptId)) {
        continue;
      }
      if (deps.isTabRunActive(tab.id)) {
        if (tab.id === context.tabId) {
          failures.push({ tabId: tab.id, error: new Error("子任务标签仍在运行，尚未自动关闭。") });
        }
        continue;
      }
      try {
        await deps.closeTab(tab.id);
        if (deps.getTabs().some((item) => item === tab)) {
          throw new Error("子任务标签关闭未生效，保留标签以便重试。");
        }
      } catch (error) {
        // A stale tab or its panel refresh must not strand the completed tab.
        failures.push({ tabId: tab.id, error });
      }
    }
    if (failures.length > 0) {
      throw new Error(failures.map(({ tabId, error }) => `${tabId}: ${error instanceof Error ? error.message : String(error)}`).join("\n"));
    }
  };
}

export async function closeLoopSubtaskConversationTabs(
  context: Parameters<typeof prepareLoopSubtaskConversationTabClose>[0],
  deps: Parameters<typeof prepareLoopSubtaskConversationTabClose>[1],
): Promise<void> {
  await prepareLoopSubtaskConversationTabClose(context, deps)();
}
