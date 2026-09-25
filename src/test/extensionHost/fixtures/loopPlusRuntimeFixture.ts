import fs = require("fs");
import os = require("os");
import path = require("path");
import vm = require("vm");
import ts = require("typescript");
import type { ChatMessage } from "../../../webview/types";
import type { PromptRunInput } from "../../../extensionHost/graphRuntime";
import type { LoopTaskRecord } from "../../../loopTaskStore";
import type { TaskRunRecord, TaskRunStatus } from "../../../promptRunState";
import type { LoopPlusPromptTarget } from "../../../extensionHost/loopPlusOrchestration";
import type { LoopPlusSchedulerSnapshot } from "../../../loopPlusScheduler";
import type { LoopPlusRuntimeAdapter } from "../../../extensionHost/loopPlusRuntimeAdapter";

type PublishOptions = {
  status?: TaskRunStatus | null;
  content?: string | null;
  late?: boolean;
  prompt?: string;
  createdAt?: number;
  runStartedAt?: number;
  runEndedAt?: number;
  userCreatedAt?: number;
  assistantId?: string;
};

type ParkedAttempt = {
  input: PromptRunInput;
  tabId: string;
  done: () => void;
};

type MainAction = (input: PromptRunInput, tabId: string) => Promise<void> | void;
type AttemptAction = (input: PromptRunInput, tabId: string) => Promise<void> | void;

export type LoopPlusRuntimeFixture = {
  rootDir: string;
  storeFile: string;
  target: LoopPlusPromptTarget;
  adapter: LoopPlusRuntimeAdapter;
  refreshes: Array<{ taskId: string; snapshot: LoopPlusSchedulerSnapshot | undefined }>;
  hostMessages: string[];
  refusals: string[];
  mainCalls: PromptRunInput[];
  attemptCalls: PromptRunInput[];
  rootsDisposed: number[];
  executionCwds: Array<string | undefined>;
  queueMain: (action: MainAction) => void;
  setAttemptAction: (action: AttemptAction | null) => void;
  setSubtaskConversation: (value: boolean) => void;
  setCompatible: (value: boolean) => void;
  setHoldAbort: (value: boolean) => void;
  setRootFailure: (message: string | null) => void;
  setSubtaskTab: (tabId: string | null) => void;
  setReportFailure: (message: string | null) => void;
  setCancelInvocation: (cancel: ((tabId: string) => void) | null) => void;
  publish: (input: PromptRunInput, tabId: string, options?: PublishOptions) => void;
  seedHistory: (input: PromptRunInput, tabId: string, options: { content: string; status: TaskRunStatus; prompt?: string; assistantId?: string }) => void;
  parkedSubtaskIds: () => string[];
  parkedAttempts: () => Array<{ subtaskId: string; tabId: string; input: PromptRunInput }>;
  peekParked: (subtaskId: string) => { input: PromptRunInput; tabId: string } | null;
  cancelledTabs: string[];
  closedSubtaskTabs: string[];
  setCloseSubtaskTabError: (message: string | null) => void;
  finishParked: (subtaskId: string, options?: PublishOptions) => void;
  releaseParked: (subtaskId: string) => void;
  releaseHeldMain: () => void;
  holdMain: () => Promise<void>;
  readTask: (taskId: string) => LoopTaskRecord | null;
  saveTask: (task: LoopTaskRecord) => void;
  dispose: () => void;
};

export async function waitForLoopPlus(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out: ${label}`);
}

export function createLoopPlusRuntimeFixture(options: { maxConcurrency?: number } = {}): LoopPlusRuntimeFixture {
  const { createLoopPlusRuntimeAdapter } = require("../../../extensionHost/loopPlusRuntimeAdapter") as typeof import("../../../extensionHost/loopPlusRuntimeAdapter");
  const { createLoopPlusPersistedTaskRefresher } = require("../../../extensionHost/promptRunRuntime") as typeof import("../../../extensionHost/promptRunRuntime");
  const { readLoopTaskStore, writeLoopTaskStore } = require("../../../loopTaskStore") as typeof import("../../../loopTaskStore");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-plus-runtime-"));
  const storeFile = path.join(rootDir, "loop-tasks.json");
  const target: LoopPlusPromptTarget = { tabId: "tab-main", cli: "codex", sessionId: "session" };
  const messages = new Map<string, ChatMessage[]>();
  const runs: TaskRunRecord[] = [];
  const refreshes: LoopPlusRuntimeFixture["refreshes"] = [];
  const hostMessages: string[] = [];
  const refusals: string[] = [];
  const mainCalls: PromptRunInput[] = [];
  const attemptCalls: PromptRunInput[] = [];
  const executionCwds: Array<string | undefined> = [];
  const rootsDisposed: number[] = [];
  const mainQueue: MainAction[] = [];
  const parked = new Map<string, ParkedAttempt>();
  let sequence = 0;
  let rootSequence = 0;
  let attemptAction: AttemptAction | null = null;
  let subtaskConversation = false;
  let compatible = true;
  let holdAbort = false;
  let rootFailure: string | null = null;
  let releaseMain: (() => void) | null = null;
  let subtaskTabOverride: string | null = null;
  let taskSequence = 0;
  let reportFailure: string | null = null;
  let cancelOverride: ((tabId: string) => void) | null = null;
  const cancelledTabs: string[] = [];
  const closedSubtaskTabs: string[] = [];
  let closeSubtaskTabError: string | null = null;

  function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}`;
  }

  function bucket(tabId: string): ChatMessage[] {
    const existing = messages.get(tabId);
    if (existing) {
      return existing;
    }
    const created: ChatMessage[] = [];
    messages.set(tabId, created);
    return created;
  }

  function readTasks(): LoopTaskRecord[] {
    return readLoopTaskStore(storeFile).tasks;
  }

  function writeTasks(tasks: LoopTaskRecord[]): void {
    writeLoopTaskStore(storeFile, { tasks });
  }

  function readTask(taskId: string): LoopTaskRecord | null {
    return readTasks().find((task) => task.id === taskId) ?? null;
  }

  function saveTask(task: LoopTaskRecord): void {
    const tasks = readTasks().filter((item) => item.id !== task.id);
    tasks.push(task);
    writeTasks(tasks);
  }

  function releaseInvocation(tabId: string): void {
    if (tabId === target.tabId && releaseMain) {
      const release = releaseMain;
      releaseMain = null;
      release();
    }
    if (holdAbort) {
      return;
    }
    for (const [subtaskId, attempt] of Array.from(parked.entries())) {
      if (attempt.tabId === tabId) {
        parked.delete(subtaskId);
        attempt.done();
      }
    }
  }

  function publish(input: PromptRunInput, tabId: string, options: PublishOptions = {}): void {
    const createdAt = typeof options.createdAt === "number"
      ? options.createdAt
      : (options.late ? 1 : Date.now());
    const userCreatedAt = typeof options.userCreatedAt === "number" ? options.userCreatedAt : createdAt;
    const runStartedAt = typeof options.runStartedAt === "number" ? options.runStartedAt : createdAt;
    const runEndedAt = typeof options.runEndedAt === "number" ? options.runEndedAt : createdAt;
    const prompt = options.prompt ?? input.displayPrompt;
    if (!options.late) {
      bucket(tabId).push({
        id: nextId("user"),
        role: "user",
        content: input.displayPrompt,
        createdAt: userCreatedAt,
        merge: false,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      });
    }
    if (typeof options.content === "string") {
      bucket(tabId).push({
        id: options.assistantId ?? nextId("assistant"),
        role: "assistant",
        content: options.content,
        createdAt,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      });
    }
    if (options.status) {
      runs.push({
        id: nextId("run"),
        cli: "codex",
        sessionId: target.sessionId,
        prompt,
        startedAt: runStartedAt,
        endedAt: runEndedAt,
        durationMs: Math.max(0, runEndedAt - runStartedAt),
        status: options.status,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      });
    }
  }

  function releaseParked(subtaskId: string): void {
    const attempt = parked.get(subtaskId);
    if (!attempt) {
      throw new Error(`no parked attempt for ${subtaskId}`);
    }
    parked.delete(subtaskId);
    attempt.done();
  }

  function finishParked(subtaskId: string, options: PublishOptions = {}): void {
    const attempt = parked.get(subtaskId);
    if (!attempt) {
      throw new Error(`no parked attempt for ${subtaskId}`);
    }
    publish(attempt.input, attempt.tabId, options);
    releaseParked(subtaskId);
  }

  const adapter: LoopPlusRuntimeAdapter = createLoopPlusRuntimeAdapter({
    maxConcurrency: options.maxConcurrency,
    launchDelayMs: () => 0,
    delay: async () => undefined,
    readTask,
    createTask: ({ cli, rootPrompt, sessionId, snapshot }) => {
      taskSequence += 1;
      const taskId = `loop-plus-${taskSequence}`;
      const now = Date.now();
      const communicationDir = path.join(rootDir, "comm", taskId);
      fs.mkdirSync(communicationDir, { recursive: true });
      const task: LoopTaskRecord = {
        id: taskId,
        cli,
        workspaceKey: "workspace",
        taskStoreFile: storeFile,
        rootPrompt,
        executionMode: "main_sub_multi_agent",
        schedulingMode: "event_driven",
        loopPlus: snapshot,
        status: "running",
        createdAt: now,
        updatedAt: now,
        maxRounds: 20,
        currentRound: 0,
        communicationDir,
        mainCommunicationFile: path.join(communicationDir, "main.md"),
        sessionId,
        activeSubtaskId: null,
        activeSubtaskIds: [],
        subTasks: [],
        rounds: [],
        supplementalRequirements: [],
        completionRoundSummaries: [],
        completionRequirementCoverage: [],
      };
      saveTask(task);
      return readTask(taskId) ?? task;
    },
    updateTask: createLoopPlusPersistedTaskRefresher({
      updateTask: (taskId: string, patch: Partial<LoopTaskRecord>) => {
        const existing = readTask(taskId);
        if (!existing) {
          return null;
        }
        saveTask({
          ...existing,
          ...patch,
          id: existing.id,
          updatedAt: typeof patch.updatedAt === "number" ? patch.updatedAt : Date.now(),
        });
        return readTask(taskId);
      },
      refreshTaskSurfaces: (taskId: string) => {
        const task = readTask(taskId);
        refreshes.push({
          taskId,
          snapshot: task?.loopPlus as LoopPlusSchedulerSnapshot | undefined,
        });
      },
    }),
    appendHostMessage: (_target, message) => {
      hostMessages.push(message);
    },
    prepareCommunication: (task, subtask, round) => {
      const filePath = path.join(task.communicationDir, `round-${round}-${subtask.id}.md`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `# ${subtask.id}\n`, "utf8");
      }
      return filePath;
    },
    appendAttemptReport: (filePath, content) => {
      if (reportFailure) {
        const message = reportFailure;
        reportFailure = null;
        throw new Error(message);
      }
      if (!filePath.startsWith(rootDir)) {
        throw new Error(`attempt report escaped the fixture directory: ${filePath}`);
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, content, "utf8");
    },
    runPrompt: async (input, promptOptions) => {
      const tabId = promptOptions?.targetTabId ?? target.tabId;
      executionCwds.push(input.executionCwd);
      if (input.taskRole === "subtask") {
        attemptCalls.push(input);
        if (attemptAction) {
          await attemptAction(input, tabId);
          return;
        }
        await new Promise<void>((resolve) => {
          parked.set(input.loopSubtaskId ?? input.displayPrompt, {
            input,
            tabId,
            done: resolve,
          });
        });
        return;
      }
      mainCalls.push(input);
      const action = mainQueue.shift();
      if (!action) {
        throw new Error(`unexpected Loop+ main call ${mainCalls.length}`);
      }
      await action(input, tabId);
    },
    getMessages: (promptTarget) => bucket(promptTarget.tabId),
    readRuns: () => runs,
    resolveThinkingMode: () => "low",
    createExecutionRoot: () => {
      if (rootFailure) {
        throw new Error(rootFailure);
      }
      rootSequence += 1;
      const rootId = rootSequence;
      return {
        cwd: path.join(rootDir, `root-${rootId}`),
        dispose: () => {
          rootsDisposed.push(rootId);
        },
      };
    },
    createSubtaskTarget: (cli) => ({
      tabId: subtaskTabOverride ?? nextId("subtab"),
      cli,
      sessionId: null,
    }),
    closeSubtaskTab: async (tabId) => {
      closedSubtaskTabs.push(tabId);
      messages.delete(tabId);
      if (closeSubtaskTabError) {
        throw new Error(closeSubtaskTabError);
      }
    },
    cancelInvocation: (tabId) => {
      cancelledTabs.push(tabId);
      if (cancelOverride) {
        cancelOverride(tabId);
        return;
      }
      releaseInvocation(tabId);
    },
    appendSubtaskPrompt: (message) => {
      bucket(message.target.tabId).push({
        id: nextId("system"),
        role: "system",
        content: message.content,
        createdAt: Date.now(),
        taskRole: "subtask",
        loopTaskId: message.taskId,
        loopRound: message.round,
        loopSubtaskId: message.subtaskId,
      });
    },
    resolveSessionId: (promptTarget) => promptTarget.sessionId,
    activeWorkspaceKey: () => "workspace",
    isSubtaskConversation: () => subtaskConversation,
    isTaskCompatible: () => compatible,
    bindResumeTarget: (taskId, cli, sessionId) => {
      const existing = readTask(taskId);
      if (!existing) {
        return null;
      }
      saveTask({ ...existing, cli, sessionId, updatedAt: Date.now() });
      return readTask(taskId);
    },
    hiddenContinuePrompt: () => "continue",
    normalizeContinuePrompt: (prompt) => {
      const normalized = prompt.trim();
      return normalized || null;
    },
    appendRefusal: (_promptTarget, kind) => {
      refusals.push(kind);
    },
  });

  return {
    rootDir,
    storeFile,
    target,
    adapter,
    refreshes,
    hostMessages,
    refusals,
    mainCalls,
    attemptCalls,
    rootsDisposed,
    executionCwds,
    queueMain: (action) => {
      mainQueue.push(action);
    },
    setAttemptAction: (action) => {
      attemptAction = action;
    },
    setSubtaskConversation: (value) => {
      subtaskConversation = value;
    },
    setCompatible: (value) => {
      compatible = value;
    },
    setHoldAbort: (value) => {
      holdAbort = value;
    },
    setRootFailure: (message) => {
      rootFailure = message;
    },
    setSubtaskTab: (tabId) => {
      subtaskTabOverride = tabId;
    },
    setReportFailure: (message) => {
      reportFailure = message;
    },
    setCancelInvocation: (cancel) => {
      cancelOverride = cancel;
    },
    publish,
    seedHistory: (input, tabId, options) => {
      const createdAt = Date.now() - 60_000;
      bucket(tabId).push({
        id: options.assistantId ?? nextId("old-assistant"),
        role: "assistant",
        content: options.content,
        createdAt,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound ?? 1,
        loopSubtaskId: input.loopSubtaskId,
      });
      runs.push({
        id: nextId("old-run"),
        cli: "codex",
        sessionId: target.sessionId,
        prompt: options.prompt ?? input.displayPrompt,
        startedAt: createdAt,
        endedAt: createdAt,
        durationMs: 0,
        status: options.status,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound ?? 1,
        loopSubtaskId: input.loopSubtaskId,
      });
    },
    parkedSubtaskIds: () => Array.from(parked.keys()),
    parkedAttempts: () => Array.from(parked.entries()).map(([subtaskId, attempt]) => ({
      subtaskId,
      tabId: attempt.tabId,
      input: attempt.input,
    })),
    peekParked: (subtaskId) => {
      const attempt = parked.get(subtaskId);
      if (!attempt) {
        return null;
      }
      return { input: attempt.input, tabId: attempt.tabId };
    },
    cancelledTabs,
    closedSubtaskTabs,
    setCloseSubtaskTabError: (message) => {
      closeSubtaskTabError = message;
    },
    finishParked,
    releaseParked,
    releaseHeldMain: () => {
      const release = releaseMain;
      releaseMain = null;
      release?.();
    },
    holdMain: () => new Promise((resolve) => {
      releaseMain = resolve;
    }),
    readTask,
    saveTask,
    dispose: () => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

type LoopPlusStopRunner = {
  loopTaskId?: string;
  taskRole?: "main" | "subtask";
  messageTarget: [];
  stop: () => void;
};

type LoopPlusStopContext = {
  taskRole: "main" | "subtask" | null;
  loopTaskId: string | null;
};

type LoopPlusNotedTask = {
  id: string;
  schedulingMode?: string;
  status?: string;
};

type LoopPlusStopScriptExports = {
  cancelInvocation: (tabId: string) => void;
  stopRunForTab: (tabId: string | null) => void;
  stopLoopRunsForTask: (taskId: string) => void;
  preemptActivePromptRun: (tabId: string) => void;
};

export type LoopPlusExtensionStopHarness = {
  wiredCancelSource: string;
  cancelInvocation: (tabId: string) => void;
  stopRunForTab: (tabId: string | null) => void;
  stopLoopRunsForTask: (taskId: string) => void;
  preemptActivePromptRun: (tabId: string) => void;
  noteTab: (tabId: string, context: LoopPlusStopContext) => void;
  noteTask: (task: LoopPlusNotedTask) => void;
  attachInteractive: (tabId: string, spec: { loopTaskId?: string; taskRole?: "main" | "subtask"; onStop?: () => void }) => void;
  attachParallel: (tabId: string, spec: { loopTaskId?: string; taskRole?: "main" | "subtask"; onStop?: () => void }) => void;
  attachPrimary: (tabId: string, spec: { loopTaskId?: string; taskRole?: "main" | "subtask"; graphRunId?: string | null; graphNodeId?: string | null; onStop?: () => void }) => void;
  attachGraph: (tabId: string, graphRunId: string) => void;
  stoppedTabs: string[];
  graphStops: string[];
  fallbackTaskIds: string[];
  parentStopIds: string[];
};

function extensionSourcePath(): string {
  const candidates = [
    path.join(process.cwd(), "src", "extension.ts"),
    path.resolve(__dirname, "../../../../src/extension.ts"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("src/extension.ts was not found for Loop+ stop closure extraction");
}

function extractFunctionText(sourceFile: ts.SourceFile, name: string): string {
  let text = "";
  const visit = (node: ts.Node): void => {
    if (text) {
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      text = node.getText(sourceFile);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!text) {
    throw new Error(`extension.ts is missing ${name}`);
  }
  return text;
}

function extractWiredCancel(sourceFile: ts.SourceFile): string {
  let text = "";
  const visit = (node: ts.Node): void => {
    if (text) {
      return;
    }
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "createLoopPlusRuntimeAdapter"
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (
          ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name)
          && property.name.text === "cancelInvocation"
        ) {
          text = property.initializer.getText(sourceFile);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!text) {
    throw new Error("extension.ts does not wire cancelInvocation into the Loop+ adapter");
  }
  return text;
}

export function createLoopPlusExtensionStopHarness(options: {
  getHost: () => { stopParent: (taskId: string) => void };
  readTask?: (taskId: string) => LoopTaskRecord | null;
}): LoopPlusExtensionStopHarness {
  const sourceText = fs.readFileSync(extensionSourcePath(), "utf8");
  const sourceFile = ts.createSourceFile("extension.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functionNames = [
    "stopLoopPlusInvocationRunner",
    "cancelLoopPlusInvocation",
    "stopRunForTab",
    "stopLoopPlusParent",
    "resolveLoopPlusParentStopContext",
    "preemptActivePromptRun",
    "stopLoopRunsForTask",
    "resolvePrimaryLoopTaskId",
    "collectRunningLoopTaskIds",
    "resolveLoopConversationTabContextFromParallelRun",
    "resolveLoopConversationTabContextFromInteractiveRun",
  ];
  const wiredCancelSource = extractWiredCancel(sourceFile);
  const {
    normalizeLoopTaskId,
    resolveLoopConversationTabContextFromMessages,
    resolveLoopRunConversationTabContext,
  } = require("../../../panelStateBuilder") as typeof import("../../../panelStateBuilder");
  const {
    shouldCloseLoopPlusParentGateBeforeAbort,
  } = require("../../../extensionHost/promptRunRuntime") as typeof import("../../../extensionHost/promptRunRuntime");
  const interactiveRunsByTabId = new Map<string, LoopPlusStopRunner>();
  const parallelRunsByTabId = new Map<string, LoopPlusStopRunner>();
  const contexts = new Map<string, LoopPlusStopContext>();
  const graphTabs = new Map<string, string>();
  const extraTasks = new Map<string, LoopPlusNotedTask>();
  const stoppedTabs: string[] = [];
  const graphStops: string[] = [];
  const fallbackTaskIds: string[] = [];
  const parentStopIds: string[] = [];
  const primary: { tabId: string | null; onStop: (() => void) | null } = { tabId: null, onStop: null };
  const script = [
    ...functionNames.map((name) => extractFunctionText(sourceFile, name)),
    "function getPrimaryRunTabId() { return primary.tabId; }",
    "function isPrimaryRunActive() { return Boolean(primary.tabId); }",
    "function stopParallelRunForTab(tabId) {",
    "  const run = parallelRunsByTabId.get(tabId);",
    "  if (!run) return false;",
    "  parallelRunsByTabId.delete(tabId);",
    "  stoppedTabs.push(tabId);",
    "  run.stop();",
    "  return true;",
    "}",
    "function stopActiveRun() {",
    "  if (!primary.tabId) return;",
    "  const tabId = primary.tabId;",
    "  const onStop = primary.onStop;",
    "  primary.tabId = null;",
    "  primary.onStop = null;",
    "  activeTaskRun = null;",
    "  stoppedTabs.push(tabId);",
    "  if (onStop) onStop();",
    "}",
    "function stopGraphRunForConversationTab(tabId) {",
    "  const graphRunId = graphTabs.get(tabId);",
    "  if (!graphRunId) return false;",
    "  graphTabs.delete(tabId);",
    "  graphStops.push(tabId);",
    "  return true;",
    "}",
    "function stopGraphRunFromConversationTab(graphRunId, tabId) {",
    "  graphStops.push(String(tabId) + ':' + String(graphRunId));",
    "}",
    "function getConversationTabById(tabId) {",
    "  if (!contexts.has(tabId) && !graphTabs.has(tabId)) return null;",
    "  return { id: tabId, cli: 'codex' };",
    "}",
    "function resolveConversationTabLoopContext(tab) {",
    "  return contexts.get(tab.id) || { taskRole: null, loopTaskId: null };",
    "}",
    "function readLoopTaskRecord(taskId) {",
    "  const live = readLiveTask(taskId);",
    "  if (live) return live;",
    "  return extraTasks.get(taskId) || null;",
    "}",
    "function markLoopTaskStoppedByUser(taskId) {",
    "  fallbackTaskIds.push(taskId);",
    "  return null;",
    "}",
    "function postPanelState() { return Promise.resolve(); }",
    "function getLoopPlusOrchestrationHost() {",
    "  return {",
    "    stopParent(taskId) {",
    "      parentStopIds.push(taskId);",
    "      hostProvider().stopParent(taskId);",
    "    },",
    "  };",
    "}",
    `const __wiredCancel = ${wiredCancelSource};`,
    "const __exports = {",
    "  cancelInvocation: __wiredCancel,",
    "  stopRunForTab: stopRunForTab,",
    "  stopLoopRunsForTask: stopLoopRunsForTask,",
    "  preemptActivePromptRun: preemptActivePromptRun,",
    "};",
    "__exports",
  ].join("\n");
  const compiled = ts.transpileModule(script, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2020,
      strict: false,
    },
  }).outputText;
  const sandbox = {
    shouldCloseLoopPlusParentGateBeforeAbort,
    normalizeLoopTaskId,
    normalizeChatGraphRunId: (value: unknown): string | null => (
      typeof value === "string" && value.trim() ? value.trim() : null
    ),
    resolveLoopRunConversationTabContext,
    resolveLoopConversationTabContextFromMessages,
    interactiveRunsByTabId,
    parallelRunsByTabId,
    loopPlusParentGateDepth: 0,
    activeTaskRun: null as {
      loopTaskId?: string;
      taskRole?: "main" | "subtask";
      graphRunId?: string | null;
      graphNodeId?: string | null;
    } | null,
    activeMessageTarget: null as unknown[] | null,
    loopOrchestrationOwnership: {
      collectTaskIds: (): string[] => [],
    },
    parentStopIds,
    fallbackTaskIds,
    graphStops,
    stoppedTabs,
    hostProvider: () => options.getHost(),
    readLiveTask: (taskId: string) => options.readTask?.(taskId) ?? null,
    extraTasks,
    contexts,
    graphTabs,
    primary,
  };
  const context = vm.createContext(sandbox);
  const compiledExports = vm.runInContext(compiled, context) as LoopPlusStopScriptExports;
  return {
    wiredCancelSource,
    cancelInvocation: (tabId) => compiledExports.cancelInvocation(tabId),
    stopRunForTab: (tabId) => compiledExports.stopRunForTab(tabId),
    stopLoopRunsForTask: (taskId) => compiledExports.stopLoopRunsForTask(taskId),
    preemptActivePromptRun: (tabId) => compiledExports.preemptActivePromptRun(tabId),
    noteTab: (tabId, tabContext) => {
      contexts.set(tabId, tabContext);
    },
    noteTask: (task) => {
      extraTasks.set(task.id, task);
    },
    attachInteractive: (tabId, spec) => {
      interactiveRunsByTabId.set(tabId, {
        loopTaskId: spec.loopTaskId,
        taskRole: spec.taskRole,
        messageTarget: [],
        stop: () => {
          if (!interactiveRunsByTabId.has(tabId)) {
            return;
          }
          interactiveRunsByTabId.delete(tabId);
          stoppedTabs.push(tabId);
          spec.onStop?.();
        },
      });
    },
    attachParallel: (tabId, spec) => {
      parallelRunsByTabId.set(tabId, {
        loopTaskId: spec.loopTaskId,
        taskRole: spec.taskRole,
        messageTarget: [],
        stop: () => {
          spec.onStop?.();
        },
      });
    },
    attachPrimary: (tabId, spec) => {
      primary.tabId = tabId;
      primary.onStop = spec.onStop ?? null;
      sandbox.activeTaskRun = {
        loopTaskId: spec.loopTaskId,
        taskRole: spec.taskRole,
        graphRunId: spec.graphRunId ?? null,
        graphNodeId: spec.graphNodeId ?? null,
      };
    },
    attachGraph: (tabId, graphRunId) => {
      graphTabs.set(tabId, graphRunId);
    },
    stoppedTabs,
    graphStops,
    fallbackTaskIds,
    parentStopIds,
  };
}
